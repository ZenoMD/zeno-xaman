import { NetworkName } from "@railgun-community/shared-models";
import { initRailgun, getShieldedBalance, WETH_ADDRESS } from "./railgun.js";
import { SqliteKV } from "./sqlite/kv.js";
import { SqliteLevelDown } from "./sqlite/leveldown.js";
import { createSqliteArtifactStore } from "./artifact-store.js";
import { Xumm } from "xumm";
import { XUMM_API_KEY } from "./xumm-api-key.js";
import { Mnemonic, sha256, formatEther } from "ethers";

const NETWORK = NetworkName.EthereumSepolia;

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
 * @returns {Promise<() => void>} cleanup that stops the balance polling
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

  return () => clearInterval(timer);
}

async function deriveShieldedAccount(log) {
  const xumm = new Xumm(XUMM_API_KEY);

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
