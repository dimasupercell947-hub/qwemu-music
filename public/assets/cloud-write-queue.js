/** Serialize mutations per account/key so stale requests cannot overwrite newer state. */
export class CloudWriteQueue {
  constructor() {
    this.pending = new Map();
  }

  enqueue(key, operation) {
    if (typeof operation !== 'function') {
      return Promise.reject(new TypeError('Cloud write operation must be a function.'));
    }
    const previous = this.pending.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.pending.set(key, current);
    current.finally(() => {
      if (this.pending.get(key) === current) this.pending.delete(key);
    }).catch(() => undefined);
    return current;
  }

  async drain() {
    while (this.pending.size) {
      await Promise.all([...this.pending.values()].map(operation => operation.catch(() => undefined)));
    }
  }
}
