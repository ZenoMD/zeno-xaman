import { initRailgun, getShieldedBalance, WETH_ADDRESS, XRPL_EVM_NETWORK } from "./railgun.js";
import { SqliteKV } from "./sqlite/kv.js";
import { SqliteLevelDown } from "./sqlite/leveldown.js";
import { createSqliteArtifactStore } from "./artifact-store.js";
import { getXumm } from "./xumm-client.js";
import { fetchXrplTokens } from "./xrpl.js";
import { shieldViaAxelar } from "./axelar.js";
import { buildShieldPayload } from "./shield-payload.js";
import { transferViaBroadcaster } from "./broadcaster.js";
import { Mnemonic, sha256, formatEther, parseEther } from "ethers";

const NETWORK = XRPL_EVM_NETWORK;

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);

/**
 * Boot the shielded wallet: XRPL sign-in -> derive keys -> open SQLite (OPFS) ->
 * start the RAILGUN engine, then poll the shielded balance.
 *
 * @param {object} cb
 * @param {(msg: string) => void} cb.log        progress/status messages
 * @param {(addr: string) => void} cb.onAddress the RAILGUN (0zk) address
 * @param {(weth: string) => void} cb.onBalance formatted WETH balance
 * @returns {Promise<object>} a controller exposing the tab actions and a
 *   `stop()` cleanup that ends the balance polling.
 */
export async function startWallet({ log, onAddress, onBalance }) {
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

  const { wallet, networkName } = await initRailgun(
    db,
    artifactStore,
    { mnemonic, encryptionKey, networkName: NETWORK },
    log,
  );

  onAddress(wallet.railgunAddress);

  // The scan runs in the background, so the balance fills in (and updates) over
  // the session rather than being known up front — poll the latest value.
  const render = () => {
    const wei = getShieldedBalance(WETH_ADDRESS[networkName]);
    onBalance(Number(formatEther(wei)).toFixed(4));
  };
  render();
  const timer = setInterval(render, 3000);

  log(`RAILGUN ready on ${networkName}`);

  // Real shield: bridge the chosen XRPL asset to the EVM-sidechain shielded pool
  // via Axelar. The form gives us the token id + amount; re-read the wallet to
  // recover the account and full token (issuer/raw currency code) it refers to.
  const shield = async ({ tokenId, amount, recipientAddress }) => {
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
  const transfer = ({ recipientAddress, amount, memoText }) =>
    transferViaBroadcaster(
      {
        networkName,
        railgunWalletID: wallet.id,
        encryptionKey,
        recipientAddress,
        tokenAddress: WETH_ADDRESS[networkName],
        amount: parseEther(String(amount)),
        memoText,
      },
      log,
      (pct) => log(`proof ${Math.round(pct * 100)}%`),
    );

  return {
    railgunAddress: wallet.railgunAddress,
    network: networkName,
    // Real: the spendable assets in the connected XRPL wallet.
    getXrplTokens: () => fetchXrplTokens(),
    shield,
    transfer,
    stop: () => clearInterval(timer),
  };
}

async function deriveShieldedAccount(log) {
  const xumm = getXumm();

  const sub = await xumm.payload.createAndSubscribe(
    {
      txjson: { TransactionType: "SignIn" },
      custom_meta: { instruction: "Sign in to shielded account" },
    },
    // The socket emits several messages (opened, expiry ticks, …); `signed` is
    // only present on the FINAL outcome. Resolve on that, for both true & false.
    (event) => {
      if (typeof event.data.signed !== "undefined") return event.data;
    },
  );

  // Open it natively on the same device instead of showing a QR.
  await xumm.xapp.openSignRequest({ uuid: sub.created.uuid });

  const resolved = await sub.resolved; // this is event.data
  if (!resolved.signed) throw new Error("User declined sign-in");

  const full = await xumm.payload.get(sub.created.uuid);

  log(`Sign-in successful; signed payload: ${full.response.hex}`);

  // The signed SignIn blob is deterministic per account/key, so we use it as
  // the seed for the shielded wallet. Hash it into a stable 32-byte value, then
  // domain-separate that into the BIP39 mnemonic and the RAILGUN encryption key.
  const seed = sha256("0x" + full.response.hex.replace(/^0x/, ""));
  const mnemonic = Mnemonic.fromEntropy(seed.slice(0, 34)).phrase; // 16 bytes -> 12 words
  const encryptionKey = sha256(seed).slice(2); // 64-char hex, no 0x prefix

  return { mnemonic, encryptionKey };
}
