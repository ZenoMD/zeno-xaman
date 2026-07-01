import { AbstractLevelDOWN, AbstractIterator } from "abstract-leveldown";
import { Buffer } from "buffer";
import { SqliteKV, toU8 } from "./kv";

// AbstractLevelDOWN backed by the SQLite Worker (OPFS-persisted). This is the
// store RAILGUN's engine uses; it replaces the remote userstore for the heavy,
// high-write merkletree/balance data.
//
// abstract-leveldown is subclassed via `_`-prefixed hooks (`_get`, `_put`,
// `_iterator`, …) and helpers (`_nextTick`) that its @types don't model, so we
// extend the base loosely and type our own logic on top.

type NodeCallback = (err?: Error | null, ...args: unknown[]) => void;

const AbstractLevelDOWNBase = AbstractLevelDOWN as unknown as {
  new (...args: unknown[]): any;
};
const AbstractIteratorBase = AbstractIterator as unknown as {
  new (db: unknown): any;
};

type IteratorOptions = {
  gt?: Uint8Array | string;
  gte?: Uint8Array | string;
  lt?: Uint8Array | string;
  lte?: Uint8Array | string;
  reverse?: boolean;
  limit?: number;
  keyAsBuffer?: boolean;
  valueAsBuffer?: boolean;
};

class SqliteIterator extends AbstractIteratorBase {
  _options: IteratorOptions;
  _iterId: number | null;
  _opened: Promise<void> | null;

  constructor(db: SqliteLevelDown, options: IteratorOptions) {
    super(db);
    this._options = options;
    this._iterId = null;
    this._opened = null;
  }

  _open(): Promise<void> {
    if (!this._opened) {
      const o = this._options;
      this._opened = this.db._kv
        .call("iterator:new", {
          table: this.db._table,
          options: {
            gt: o.gt && toU8(o.gt),
            gte: o.gte && toU8(o.gte),
            lt: o.lt && toU8(o.lt),
            lte: o.lte && toU8(o.lte),
            reverse: !!o.reverse,
            limit: o.limit,
          },
        })
        .then((id: unknown) => {
          this._iterId = id as number;
        });
    }
    return this._opened!;
  }

  async _next(callback: NodeCallback): Promise<void> {
    try {
      await this._open();
      const row = (await this.db._kv.call("iterator:next", {
        iterId: this._iterId,
      })) as { key: Uint8Array; value: Uint8Array } | null;
      if (!row) return this._nextTick(callback);
      const key =
        this._options.keyAsBuffer === false
          ? Buffer.from(row.key).toString()
          : Buffer.from(row.key);
      const value =
        this._options.valueAsBuffer === false
          ? Buffer.from(row.value).toString()
          : Buffer.from(row.value);
      this._nextTick(callback, null, key, value);
    } catch (err) {
      this._nextTick(callback, err);
    }
  }

  async _end(callback: NodeCallback): Promise<void> {
    try {
      if (this._iterId != null)
        await this.db._kv.call("iterator:end", { iterId: this._iterId });
      this._nextTick(callback);
    } catch (err) {
      this._nextTick(callback, err);
    }
  }
}

export class SqliteLevelDown extends AbstractLevelDOWNBase {
  _kv: SqliteKV;
  _table: string;

  constructor(kv: SqliteKV, table = "engine") {
    super();
    this._kv = kv;
    this._table = table;
  }

  _open(_options: unknown, callback: NodeCallback): void {
    this._kv.ready
      .then(() => this._nextTick(callback))
      .catch((e: Error) => this._nextTick(callback, e));
  }

  _close(callback: NodeCallback): void {
    this._nextTick(callback);
  }

  async _get(
    key: Uint8Array | string,
    options: { asBuffer?: boolean },
    callback: NodeCallback,
  ): Promise<void> {
    try {
      const value = (await this._kv.call("get", {
        table: this._table,
        key: toU8(key),
      })) as Uint8Array | null;
      if (value == null) return this._nextTick(callback, new Error("NotFound"));
      const buf = Buffer.from(value);
      this._nextTick(
        callback,
        null,
        options.asBuffer === false ? buf.toString() : buf,
      );
    } catch (err) {
      this._nextTick(callback, err);
    }
  }

  async _put(
    key: Uint8Array | string,
    value: Uint8Array | string,
    _options: unknown,
    callback: NodeCallback,
  ): Promise<void> {
    try {
      await this._kv.call("put", {
        table: this._table,
        key: toU8(key),
        value: toU8(value),
      });
      this._nextTick(callback);
    } catch (err) {
      this._nextTick(callback, err);
    }
  }

  async _del(
    key: Uint8Array | string,
    _options: unknown,
    callback: NodeCallback,
  ): Promise<void> {
    try {
      await this._kv.call("del", { table: this._table, key: toU8(key) });
      this._nextTick(callback);
    } catch (err) {
      this._nextTick(callback, err);
    }
  }

  async _batch(
    operations: Array<{
      type: "put" | "del";
      key: Uint8Array | string;
      value?: Uint8Array | string;
    }>,
    _options: unknown,
    callback: NodeCallback,
  ): Promise<void> {
    try {
      const ops = operations.map((op) =>
        op.type === "put"
          ? { type: "put", key: toU8(op.key), value: toU8(op.value!) }
          : { type: "del", key: toU8(op.key) },
      );
      await this._kv.call("batch", { table: this._table, ops });
      this._nextTick(callback);
    } catch (err) {
      this._nextTick(callback, err);
    }
  }

  _iterator(options: IteratorOptions): SqliteIterator {
    return new SqliteIterator(this, options);
  }
}
