// SQLite WASM running inside a Worker, persisted to OPFS via the SAH-pool VFS.
// SyncAccessHandle (which the SAH-pool VFS needs) is only available in a Worker,
// which is exactly what the storage probe confirmed works in this WebView.
//
// This file is served verbatim from public/ and is NOT processed by webpack. It
// imports the sqlite-wasm library straight from its static URL so the library's
// own `new URL("…", import.meta.url)` lookups resolve its sibling .wasm and OPFS
// async-proxy assets against /sqlite3/ — webpack can't mangle those paths here.
// scripts/copy-wasm.mjs stages all three files into public/sqlite3/ at build time.
//
// Exposes a tiny key/value protocol (put/get/del/batch + a stepping iterator)
// over two BLOB-keyed tables: "engine" (the RAILGUN LevelDB) and "artifacts"
// (the zk proving artifacts). BLOB primary keys sort by memcmp, which matches
// LevelDB's bytewise key ordering, so range scans come out in the right order.

import sqlite3InitModule from "/sqlite3/index.mjs";

const TABLES = { engine: "engine", artifacts: "artifacts" };
const tbl = (t) => {
  const name = TABLES[t];
  if (!name) throw new Error("Unknown table: " + t);
  return name;
};

let db;
const stmtCache = new Map();
const iterators = new Map();
let iterSeq = 0;

// Unsolicited progress messages so the main thread can see where init gets to.
const post = (msg) => self.postMessage({ type: "log", msg: `[worker] ${msg}` });
post("evaluated");

const ready = (async () => {
  post("loading sqlite wasm…");
  const sqlite3 = await sqlite3InitModule({
    print: (m) => post("sqlite: " + m),
    printErr: (m) => post("sqlite-err: " + m),
  });
  post("wasm loaded; installing OPFS SAH-pool VFS…");
  const pool = await sqlite3.installOpfsSAHPoolVfs({
    name: "railgun-sahpool",
    directory: ".railgun-sqlite",
    initialCapacity: 6,
  });
  post("VFS installed; opening DB…");
  db = new pool.OpfsSAHPoolDb("/railgun.sqlite3");
  db.exec("PRAGMA journal_mode=DELETE;");
  for (const name of Object.values(TABLES)) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${name} (k BLOB PRIMARY KEY, v BLOB) WITHOUT ROWID;`,
    );
  }
  post("DB ready");
})();

ready.catch((e) => post("INIT FAILED: " + (e && e.message ? e.message : e)));

const prep = (sql) => {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
};

const run = (sql, binds) => {
  const s = prep(sql);
  try {
    if (binds && binds.length) s.bind(binds);
    s.step();
  } finally {
    s.reset();
    s.clearBindings();
  }
};

const queryOne = (sql, binds) => {
  const s = prep(sql);
  try {
    if (binds && binds.length) s.bind(binds);
    return s.step() ? s.get(0) : null;
  } finally {
    s.reset();
    s.clearBindings();
  }
};

const putSql = (t) => `INSERT OR REPLACE INTO ${tbl(t)} (k, v) VALUES (?, ?)`;
const getSql = (t) => `SELECT v FROM ${tbl(t)} WHERE k = ?`;
const delSql = (t) => `DELETE FROM ${tbl(t)} WHERE k = ?`;

const buildIterator = (t, o) => {
  const cond = [];
  const binds = [];
  if (o.gt) {
    cond.push("k > ?");
    binds.push(o.gt);
  }
  if (o.gte) {
    cond.push("k >= ?");
    binds.push(o.gte);
  }
  if (o.lt) {
    cond.push("k < ?");
    binds.push(o.lt);
  }
  if (o.lte) {
    cond.push("k <= ?");
    binds.push(o.lte);
  }
  let sql = `SELECT k, v FROM ${tbl(t)}`;
  if (cond.length) sql += " WHERE " + cond.join(" AND ");
  sql += " ORDER BY k " + (o.reverse ? "DESC" : "ASC");
  if (typeof o.limit === "number" && o.limit >= 0)
    sql += " LIMIT " + Math.floor(o.limit);
  const stmt = db.prepare(sql);
  if (binds.length) stmt.bind(binds);
  return stmt;
};

const handlers = {
  init: () => true,

  put: ({ table, key, value }) => {
    run(putSql(table), [key, value]);
    return true;
  },

  get: ({ table, key }) => queryOne(getSql(table), [key]),

  del: ({ table, key }) => {
    run(delSql(table), [key]);
    return true;
  },

  batch: ({ table, ops }) => {
    db.transaction(() => {
      for (const op of ops) {
        if (op.type === "put") run(putSql(table), [op.key, op.value]);
        else if (op.type === "del") run(delSql(table), [op.key]);
      }
    });
    return true;
  },

  "iterator:new": ({ table, options }) => {
    const id = ++iterSeq;
    iterators.set(id, buildIterator(table, options || {}));
    return id;
  },

  "iterator:next": ({ iterId }) => {
    const stmt = iterators.get(iterId);
    if (!stmt) return null;
    if (stmt.step()) return { key: stmt.get(0), value: stmt.get(1) };
    return null;
  },

  "iterator:end": ({ iterId }) => {
    const stmt = iterators.get(iterId);
    if (stmt) {
      stmt.finalize();
      iterators.delete(iterId);
    }
    return true;
  },

  estimate: async () => {
    if (navigator.storage && navigator.storage.estimate)
      return navigator.storage.estimate();
    return null;
  },
};

self.onmessage = async ({ data }) => {
  const { id, op } = data;
  try {
    await ready;
    const handler = handlers[op];
    if (!handler) throw new Error("Unknown op: " + op);
    const result = await handler(data);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({
      id,
      error: err && err.message ? err.message : String(err),
    });
  }
};
