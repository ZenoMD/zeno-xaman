import { ArtifactStore } from "@railgun-community/wallet";
import { Buffer } from "buffer";
import { SqliteKV, toU8 } from "./sqlite/kv";

// The engine addresses artifacts by a path string (e.g. "getters/vkey"); use it
// verbatim as the KV row key. A stable 1:1 mapping is all that's needed.
const pathKey = (path: string): string => String(path);

// Returns an ArtifactStore backed by a SqliteKV instance
// Used by RAILGUN to store the proving keys and other large, static files it needs to generate proofs
export const createSqliteArtifactStore = (kv: SqliteKV): ArtifactStore =>
  new ArtifactStore(
    async (path: string) => {
      const v = (await kv.call("get", {
        table: "artifacts",
        key: pathKey(path),
      })) as Uint8Array | null;
      return v == null ? null : Buffer.from(v);
    },
    async (_dir: string, path: string, item: string | Uint8Array) => {
      const value =
        typeof item === "string" ? new TextEncoder().encode(item) : toU8(item);
      await kv.call("put", { table: "artifacts", key: pathKey(path), value });
    },
    async (path: string) => {
      const v = await kv.call("get", {
        table: "artifacts",
        key: pathKey(path),
      });
      return v != null;
    },
  );
