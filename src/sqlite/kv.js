// Main-thread client for the SQLite Worker: a promise-based RPC over postMessage.
import { Buffer } from 'buffer';

export class SqliteKV {
  constructor(onLog = () => {}) {
    this.onLog = onLog;
    this.worker = new Worker(new URL('./worker.js', import.meta.url), {
      type: 'module',
    });
    this.seq = 0;
    this.pending = new Map();
    this.worker.onmessage = ({ data }) => {
      if (data && data.type === 'log') return this.onLog(data.msg);
      const { id, result, error } = data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    };
    this.worker.onerror = (e) => {
      // Surface worker boot/import failures instead of hanging forever.
      for (const p of this.pending.values()) p.reject(new Error('SQLite worker error: ' + (e.message || 'unknown')));
      this.pending.clear();
    };
    this.ready = this.call('init');
  }

  call(op, payload = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, ...payload });
    });
  }

  estimate() {
    return this.call('estimate');
  }
}

// Convert a LevelDB key/value (Buffer or string) into a fresh Uint8Array so it
// survives the structured-clone postMessage hop cleanly.
export const toU8 = (x) =>
  x instanceof Uint8Array ? new Uint8Array(x) : new Uint8Array(Buffer.from(x));
