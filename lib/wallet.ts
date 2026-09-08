import {
  initRailgun,
  getShieldedBalances,
  resolveTokenMeta,
  XRPL_EVM_NETWORK,
} from "./railgun";
import { SqliteKV } from "./sqlite/kv";
import { SqliteLevelDown } from "./sqlite/leveldown";
import { createSqliteArtifactStore } from "./artifact-store";
import { getXumm } from "./xumm-client";
import { fetchXrplTokens } from "./xrpl";
import { shieldViaAxelar } from "./axelar";
import { buildShieldPayload } from "./shield-payload";
import { DEV_ACCOUNT } from "./dev-account";
import { trimAmount } from "./tokens";
import { transferViaBroadcaster, unshieldViaBroadcaster } from "./broadcaster";
import { quoteFees, type FeeQuoteContext } from "./fees";
import { Mnemonic, sha256, parseUnits } from "ethers";
import type {
  FeeQuoteParams,
  LogFn,
  ShieldParams,
  ShieldedTokenBalance,
  TransferParams,
  UnshieldParams,
  WalletApi,
  XrplTokens,
} from "./types";

const NETWORK = XRPL_EVM_NETWORK;

// A fee quote runs while the user types, and fetchXrplTokens opens a WebSocket
// to the ledger every call — so quotes read a short-lived snapshot instead. Only
// the token's issuer/currency code and the account address are taken from it;
// both are stable for the session. Submissions still read the ledger fresh.
const XRPL_SNAPSHOT_MS = 30_000;

const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);

export type StartWalletCallbacks = {
  /** progress/status messages */
  log: LogFn;
  /** the RAILGUN (0zk) address */
  onAddress: (addr: string) => void;
  /** all shielded token balances (XRP is just another entry) */
  onShieldedTokens: (tokens: ShieldedTokenBalance[]) => void;
  /** shielded UTXO merkletree scan phase, once scanning actually begins */
  onScanState: (state: "scanning" | "complete") => void;
};

/**
 * Boot the shielded wallet: XRPL sign-in -> derive keys -> open SQLite (OPFS) ->
 * start the RAILGUN engine, then poll the shielded balance. Returns a controller
 * exposing the tab actions and a `stop()` cleanup that ends the balance polling.
 */
export async function startWallet({
  log,
  onAddress,
  onShieldedTokens,
  onScanState,
}: StartWalletCallbacks): Promise<WalletApi> {
  log("Deriving shielded account…");
  const { mnemonic, encryptionKey } = await deriveShieldedAccount(log);

  // On-device persistence: SQLite in a Worker, stored in OPFS (SAH-pool VFS).
  // This is cleared when XAMAN is closed but survives reloads of the page/xApp.
  log("opening SQLite worker…");
  const kv = new SqliteKV(log);

  // The worker bundle is large so it can take a while to load and initialize the
  // SQLite WASM. Wait up to 90s for it to be ready.
  await withTimeout(kv.ready, 90000, "SQLite init");
  log("SQLite ready");

  const db = new SqliteLevelDown(kv, "engine");
  const artifactStore = createSqliteArtifactStore(kv);

  // Push the latest shielded balances to the UI as a single per-token list
  // (labelled + decimals-aware), in getShieldedBalances' picker order: XRP
  // first, then highest balance.
  const render = () => {
    void pushShieldedTokens();
  };

  const pushShieldedTokens = async () => {
    const balances = await getShieldedBalances(NETWORK);
    onShieldedTokens(
      balances.map(({ address, symbol, formatted }) => ({
        address,
        symbol,
        balance: trimAmount(formatted),
      })),
    );
  };

  // Only reveal the balance once it's actually been computed (the balance-update
  // callback, which fires *after* the merkletree scan completes). Reporting scan-
  // complete earlier would briefly show a stale 0.00. Until then we stay in the
  // "scanning" state so the UI keeps a dashed balance.
  let balancesReady = false;

  const { wallet, networkName } = await initRailgun(
    db,
    artifactStore,
    {
      mnemonic,
      encryptionKey,
      networkName: NETWORK,
      onScanUpdate: () => {
        if (!balancesReady) onScanState("scanning");
      },
      onBalanceUpdate: () => {
        balancesReady = true;
        render();
        onScanState("complete");
      },
    },
    log,
  );

  onAddress(wallet.railgunAddress);

  render();
  // Fallback refresh in case a later balance change lands without re-firing.
  const timer = setInterval(render, 3000);

  log(`RAILGUN ready on ${networkName}`);

  // Real shield: bridge the chosen XRPL asset to the EVM-sidechain shielded pool
  // via Axelar. The form gives us the token id + amount; re-read the wallet to
  // recover the account and full token (issuer/raw currency code) it refers to.
  const shield = async ({
    tokenId,
    amount,
    recipientAddress,
  }: ShieldParams) => {
    const { account, tokens } = await fetchXrplTokens();
    const token = tokens.find((t) => t.id === tokenId);
    if (!token) throw new Error(`Token ${tokenId} not found in XRPL wallet`);

    // Shield to a caller-supplied 0zk address if given, else to our own wallet.
    const railgunAddress = recipientAddress || wallet.railgunAddress;
    if (!railgunAddress.startsWith("0zk")) {
      throw new Error("Recipient must be a 0zk RAILGUN address");
    }

    // The router builds the ShieldRequest from the amount it actually receives,
    // so the payload only needs to name the 0zk recipient — no value to predict.
    const payload = await buildShieldPayload({ railgunAddress });

    return shieldViaAxelar({ account, token, amount, payload }, log);
  };

  // Private transfer: move shielded funds to another 0zk address via a RAILGUN
  // broadcaster (the proof is too large for an XRPL memo, so it goes over Waku
  // rather than Axelar). Funds stay in the pool; the broadcaster pays EVM gas.
  const transfer = async ({
    recipientAddress,
    amount,
    tokenAddress,
    memoText,
  }: TransferParams) => {
    const { decimals } = await resolveTokenMeta(tokenAddress, networkName);
    return transferViaBroadcaster(
      {
        networkName,
        railgunWalletID: wallet.id,
        encryptionKey,
        recipientAddress,
        tokenAddress,
        amount: parseUnits(String(amount), decimals),
        memoText,
      },
      log,
      (pct) => log(`proof ${Math.round(pct * 100)}%`),
    );
  };

  // Unshield: withdraw a shielded balance back to XRPL. Unshields to the RAILGUN
  // RelayAdapt contract, which multicalls the Axelar ITS to bridge the funds to
  // an XRPL account. Defaults the destination to the connected XRPL account (the
  // "account holder"); the broadcaster submits it and pays EVM gas.
  const unshield = async ({
    tokenAddress,
    amount,
    xrplRecipient,
  }: UnshieldParams) => {
    const recipient = xrplRecipient || (await fetchXrplTokens()).account;
    const { decimals } = await resolveTokenMeta(tokenAddress, networkName);
    return unshieldViaBroadcaster(
      {
        networkName,
        railgunWalletID: wallet.id,
        encryptionKey,
        xrplRecipient: recipient,
        tokenAddress,
        amount: parseUnits(String(amount), decimals),
      },
      log,
      (pct) => log(`proof ${Math.round(pct * 100)}%`),
    );
  };

  // Cached XRPL read for the quote path (see XRPL_SNAPSHOT_MS). Single-flighted
  // so a burst of keystrokes opens one socket, not one each.
  let snapshot: { value: XrplTokens; at: number } | undefined;
  let snapshotInFlight: Promise<XrplTokens> | undefined;
  const xrplSnapshot = (): Promise<XrplTokens> => {
    if (snapshot && Date.now() - snapshot.at < XRPL_SNAPSHOT_MS) {
      return Promise.resolve(snapshot.value);
    }
    snapshotInFlight ??= fetchXrplTokens()
      .then((value) => {
        snapshot = { value, at: Date.now() };
        return value;
      })
      .finally(() => {
        snapshotInFlight = undefined;
      });
    return snapshotInFlight;
  };

  // Live fee breakdown for the amount in a form. Quote logs go to the console
  // only — the activity log is for things the user asked for, not for repricing
  // on every keystroke.
  const feeContext: FeeQuoteContext = {
    networkName,
    railgunWalletID: wallet.id,
    encryptionKey,
    railgunAddress: wallet.railgunAddress,
    resolveXrplToken: async (tokenId: string) => {
      const { tokens } = await xrplSnapshot();
      const token = tokens.find((t) => t.id === tokenId);
      if (!token) throw new Error(`Token ${tokenId} not found in XRPL wallet`);
      return token;
    },
    getXrplAccount: async () => (await xrplSnapshot()).account,
    // eslint-disable-next-line no-console
    log: (msg: string) => console.log("[quote]", msg),
  };

  // Snapshot the current shielded balances as pickable tokens for the Transfer/
  // Unshield tabs, labelled with each token's real symbol and formatted with its
  // own decimals (via resolveTokenMeta) so non-18-decimal assets are correct.
  const getShieldedTokens = async () =>
    (await getShieldedBalances(networkName)).map(
      ({ address, symbol, formatted }) => ({
        id: address,
        currency: symbol,
        issuer: null,
        balance: formatted,
        label: symbol,
      }),
    );

  return {
    railgunAddress: wallet.railgunAddress,
    network: networkName,
    // Real: the spendable assets in the connected XRPL wallet.
    getXrplTokens: () => fetchXrplTokens(),
    getShieldedTokens,
    shield,
    transfer,
    unshield,
    quoteFees: (params: FeeQuoteParams) => quoteFees(feeContext, params),
    // Regular <a> links don't escape the xApp WebView; route external URLs
    // (e.g. Axelarscan) through the Xaman xApp browser instead. In a regular
    // browser there is no xApp bridge, so just open a new tab.
    openBrowser: (url: string) => {
      const xumm = getXumm();
      if (xumm.runtime.xapp) xumm.xapp?.openBrowser({ url });
      else window.open(url, "_blank", "noopener,noreferrer");
    },
    stop: () => clearInterval(timer),
  };
}

async function deriveShieldedAccount(
  log: LogFn,
): Promise<{ mnemonic: string; encryptionKey: string }> {
  // Dev override: skip the Xaman sign-in and reuse a fixed wallet across
  // reloads. Only set when `.env.local` provides the values (see dev-account.ts).
  if (DEV_ACCOUNT) {
    log("⚠️  DEV_ACCOUNT override active — skipping Xaman sign-in");
    return DEV_ACCOUNT;
  }

  const xumm = getXumm();

  const sub = await xumm.payload!.createAndSubscribe(
    {
      txjson: { TransactionType: "SignIn" },
      custom_meta: { instruction: "Sign in to shielded account" },
    },
    // The socket emits several messages (opened, expiry ticks, …); `signed` is
    // only present on the FINAL outcome. Resolve on that, for both true & false.
    (event: any) => {
      if (typeof event.data.signed !== "undefined") return event.data;
    },
  );

  // Present the sign request. Inside the Xaman xApp we can open it natively on
  // the same device; in a regular browser (Xaman "browser/web3" mode) there is
  // no xApp bridge, so open the hosted sign page — it deep-links into Xaman on
  // mobile and shows a QR to scan on desktop.
  if (xumm.runtime.xapp) {
    await xumm.xapp!.openSignRequest({ uuid: sub.created.uuid });
  } else {
    const signUrl = sub.created.next.always;
    const opened = window.open(signUrl, "_blank", "noopener,noreferrer");
    if (!opened) log(`Open this link in Xaman to sign in: ${signUrl}`);
  }

  const resolved = (await sub.resolved) as any; // this is event.data
  if (!resolved.signed) throw new Error("User declined sign-in");

  const full = await xumm.payload!.get(sub.created.uuid);

  const hex = full!.response.hex as string;
  log(`Sign-in successful; signed payload: ${hex}`);

  // The signed SignIn blob is deterministic per account/key, so we use it as
  // the seed for the shielded wallet. Hash it into a stable 32-byte value, then
  // domain-separate that into the BIP39 mnemonic and the RAILGUN encryption key.
  const seed = sha256("0x" + hex.replace(/^0x/, ""));
  const mnemonic = Mnemonic.fromEntropy(seed.slice(0, 34)).phrase; // 16 bytes -> 12 words
  const encryptionKey = sha256(seed).slice(2); // 64-char hex, no 0x prefix

  return { mnemonic, encryptionKey };
}
