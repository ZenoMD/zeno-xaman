import { ArtifactStore } from '@railgun-community/wallet';
import { Buffer } from 'buffer';
import { toU8 } from './sqlite/kv.js';

const pathKey = (path) => String(path);

// Returns an ArtifactStore backed by a SqliteKV instance
// Used by RAILGUN to store the proving keys and other large, static files it needs to generate proofs
export const createSqliteArtifactStore = (kv) =>
  new ArtifactStore(
    async (path) => {
      const v = await kv.call('get', { table: 'artifacts', key: pathKey(path) });
      return v == null ? null : Buffer.from(v);
    },
    async (_dir, path, item) => {
      const value = typeof item === 'string' ? new TextEncoder().encode(item) : toU8(item);
      await kv.call('put', { table: 'artifacts', key: pathKey(path), value });
    },
    async (path) => {
      const v = await kv.call('get', { table: 'artifacts', key: pathKey(path) });
      return v != null;
    },
  );
