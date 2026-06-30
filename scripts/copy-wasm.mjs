// The SQLite worker (public/sqlite3-worker.mjs) imports the sqlite-wasm library
// directly from a static path instead of going through webpack. The library
// locates its sibling assets (the .wasm and the OPFS async proxy) via
// `new URL("…", import.meta.url)`, so they must sit next to index.mjs at the
// served URL. Copy the whole set into public/sqlite3/ so they resolve cleanly.
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "node_modules/@sqlite.org/sqlite-wasm/dist");
const destDir = join(root, "public/sqlite3");

mkdirSync(destDir, { recursive: true });

for (const file of ["index.mjs", "sqlite3.wasm", "sqlite3-opfs-async-proxy.js"]) {
  copyFileSync(join(distDir, file), join(destDir, file));
  console.log(`copied ${file} -> public/sqlite3/${file}`);
}
