import { AbstractLevelDOWN, AbstractIterator } from 'abstract-leveldown';
import { Buffer } from 'buffer';
import { toU8 } from './kv.js';

// AbstractLevelDOWN backed by the SQLite Worker (OPFS-persisted). This is the
// store RAILGUN's engine uses; it replaces the remote userstore for the heavy,
// high-write merkletree/balance data.

class SqliteIterator extends AbstractIterator {
  constructor(db, options) {
    super(db);
    this._options = options;
    this._iterId = null;
    this._opened = null;
  }

  _open() {
    if (!this._opened) {
      const o = this._options;
      this._opened = this.db._kv
        .call('iterator:new', {
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
        .then((id) => {
          this._iterId = id;
        });
    }
    return this._opened;
  }

  async _next(callback) {
    try {
      await this._open();
      const row = await this.db._kv.call('iterator:next', { iterId: this._iterId });
      if (!row) return this._nextTick(callback);
      const key = this._options.keyAsBuffer === false ? Buffer.from(row.key).toString() : Buffer.from(row.key);
      const value =
        this._options.valueAsBuffer === false ? Buffer.from(row.value).toString() : Buffer.from(row.value);
      this._nextTick(callback, null, key, value);
    } catch (err) {
      this._nextTick(callback, err);
    }
  }

  async _end(callback) {
    try {
      if (this._iterId != null) await this.db._kv.call('iterator:end', { iterId: this._iterId });
      this._nextTick(callback);
    } catch (err) {
      this._nextTick(callback, err);
    }
  }
}

export class SqliteLevelDown extends AbstractLevelDOWN {
  constructor(kv, table = 'engine') {
    super();
    this._kv = kv;
    this._table = table;
  }

  _open(_options, callback) {
    this._kv.ready.then(() => this._nextTick(callback)).catch((e) => this._nextTick(callback, e));
  }

  _close(callback) {
    this._nextTick(callback);
  }

  async _get(key, options, callback) {
    try {
      const value = await this._kv.call('get', { table: this._table, key: toU8(key) });
      if (value == null) return this._nextTick(callback, new Error('NotFound'));
      const buf = Buffer.from(value);
      this._nextTick(callback, null, options.asBuffer === false ? buf.toString() : buf);
    } catch (err) {
      this._nextTick(callback, err);
    }
  }

  async _put(key, value, _options, callback) {
    try {
      await this._kv.call('put', { table: this._table, key: toU8(key), value: toU8(value) });
      this._nextTick(callback);
    } catch (err) {
      this._nextTick(callback, err);
    }
  }

  async _del(key, _options, callback) {
    try {
      await this._kv.call('del', { table: this._table, key: toU8(key) });
      this._nextTick(callback);
    } catch (err) {
      this._nextTick(callback, err);
    }
  }

  async _batch(operations, _options, callback) {
    try {
      const ops = operations.map((op) =>
        op.type === 'put'
          ? { type: 'put', key: toU8(op.key), value: toU8(op.value) }
          : { type: 'del', key: toU8(op.key) },
      );
      await this._kv.call('batch', { table: this._table, ops });
      this._nextTick(callback);
    } catch (err) {
      this._nextTick(callback, err);
    }
  }

  _iterator(options) {
    return new SqliteIterator(this, options);
  }
}
