import { NetworkName } from '@railgun-community/shared-models';
import { initRailgun } from './railgun.js';
import { SqliteKV } from './sqlite/kv.js';
import { SqliteLevelDown } from './sqlite/leveldown.js';
import { createSqliteArtifactStore } from './artifact-store.js';

const NETWORK = NetworkName.EthereumSepolia;
const DEMO_MNEMONIC =
  'test test test test test test test test test test test junk';
const DEMO_ENCRYPTION_KEY =
  '0101010101010101010101010101010101010101010101010101010101010101';

const panel = document.createElement('pre');
panel.style.cssText = 'text-align:left;white-space:pre-wrap;word-break:break-word;font-size:12px;padding:8px;';
document.body.appendChild(panel);
const statusEl = document.getElementById('status');

const log = (msg) => {
  // eslint-disable-next-line no-console
  console.log('[railgun]', msg);
  if (statusEl) statusEl.textContent = msg;
  panel.textContent += `${new Date().toISOString().slice(11, 19)}  ${msg}\n`;
};

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);

async function main() {
  log('boot: script running');

  // On-device persistence: SQLite in a Worker, stored in OPFS (SAH-pool VFS).
  // This is cleared when XAMAN is closed but survives reloads of the page/xApp
  log('opening SQLite worker…');
  const kv = new SqliteKV(log);

  // The worker bundle is large so it can take a while to load and initialize the SQLite WASM. Wait up to 90s for it to be ready.
  await withTimeout(kv.ready, 90000, 'SQLite init');
  log('SQLite ready');

  const db = new SqliteLevelDown(kv, 'engine');
  const artifactStore = createSqliteArtifactStore(kv);

  const { wallet, networkName } = await initRailgun(
    db,
    artifactStore,
    { mnemonic: DEMO_MNEMONIC, encryptionKey: DEMO_ENCRYPTION_KEY, networkName: NETWORK },
    log,
  );

  log(`RAILGUN ready on ${networkName}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  log(`FATAL: ${err && err.stack ? err.stack : err}`);
});