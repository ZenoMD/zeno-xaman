import {
  initRailgun,
  getShieldedBalance,
  getShieldedTokens as getRawShieldedTokens,
  WETH_ADDRESS,
  XRPL_EVM_NETWORK,
} from "./railgun";
import { SqliteKV } from "./sqlite/kv";
import { SqliteLevelDown } from "./sqlite/leveldown";
import { createSqliteArtifactStore } from "./artifact-store";
import { getXumm } from "./xumm-client";
import { fetchXrplTokens } from "./xrpl";
import { shieldViaAxelar } from "./axelar";
import { buildShieldPayload } from "./shield-payload";
import { transferViaBroadcaster } from "./broadcaster";
import { Mnemonic, sha256, formatEther, parseEther } from "ethers";
import type { LogFn, ShieldParams, TransferParams, WalletApi } from "./types";

const NETWORK = XRPL_EVM_NETWORK;

// Human label for a shielded ERC20 address. The wrapped-native token is the
// pool's XRP; anything else falls back to a shortened address.
const shieldedTokenSymbol = (tokenAddress: string, networkName: string): string =>
  tokenAddress.toLowerCase() === WETH_ADDRESS[networkName]?.toLowerCase()
    ? "XRP"
    : `${tokenAddress.slice(0, 6)}…${tokenAddress.slice(-4)}`;

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
  /** formatted WETH balance */
  onBalance: (balance: string) => void;
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
  onBalance,
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

  // Push the latest shielded XRP balance to the UI.
  const render = () => {
    const wei = getShieldedBalance(WETH_ADDRESS[NETWORK]);
    onBalance(Number(formatEther(wei)).toFixed(4));
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
  const transfer = ({
    recipientAddress,
    amount,
    tokenAddress,
    memoText,
  }: TransferParams) =>
    transferViaBroadcaster(
      {
        networkName,
        railgunWalletID: wallet.id,
        encryptionKey,
        recipientAddress,
        tokenAddress,
        amount: parseEther(String(amount)),
        memoText,
      },
      log,
      (pct) => log(`proof ${Math.round(pct * 100)}%`),
    );

  // Snapshot the current shielded balances as pickable tokens for the Transfer
  // tab. All shielded assets here are 18-decimal (native XRP is the only one
  // today), so format with formatEther and label known addresses.
  const getShieldedTokens = async () =>
    getRawShieldedTokens().map(({ tokenAddress, amount }) => {
      const symbol = shieldedTokenSymbol(tokenAddress, networkName);
      return {
        id: tokenAddress,
        currency: symbol,
        issuer: null,
        balance: formatEther(amount),
        label: symbol,
      };
    });

  return {
    railgunAddress: wallet.railgunAddress,
    network: networkName,
    // Real: the spendable assets in the connected XRPL wallet.
    getXrplTokens: () => fetchXrplTokens(),
    getShieldedTokens,
    shield,
    transfer,
    stop: () => clearInterval(timer),
  };
}

async function deriveShieldedAccount(
  log: LogFn,
): Promise<{ mnemonic: string; encryptionKey: string }> {
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

  // Open it natively on the same device instead of showing a QR.
  await xumm.xapp!.openSignRequest({ uuid: sub.created.uuid });

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
