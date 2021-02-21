export default class AsyncQueueMap<K, V> {
  private supply = new Map<K, V[]>();
  private demand = new Map<
    K,
    ((args: { value: V } | { error: Error }) => void)[]
  >();
  private error: Error | null = null;

  take(key: K, timeoutMs = 1000): Promise<V> {
    if (this.error) {
      return Promise.reject(this.error);
    }
    const supply = this.supply.get(key) ?? [];
    if (supply.length) {
      return Promise.resolve(supply.shift() as V);
    }
    if (!this.demand.has(key)) {
      this.demand.set(key, []);
    }
    const demand = this.demand.get(key) as ((
      args: { value: V } | { error: Error }
    ) => void)[];
    return new Promise((resolve, reject) => {
      demand.push(handler);
      const timer = setTimeout(() => {
        if (demand.indexOf(handler) >= 0) {
          demand.splice(demand.indexOf(handler), 1);
        }
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      function handler(args: { value: V } | { error: Error }): void {
        clearTimeout(timer);
        if ('error' in args) {
          reject(args.error);
        } else {
          resolve(args.value);
        }
      }
    });
  }

  insert(key: K, value: V): void {
    const demand = this.demand.get(key) ?? [];
    if (demand.length) {
      setImmediate(() => demand.shift()?.({ value }));
    } else if (this.supply.has(key)) {
      this.supply.get(key)?.push(value);
    } else {
      this.supply.set(key, [value]);
    }
  }

  fail(error: Error): void {
    this.error = error;
    for (const listeners of [...this.demand.values()]) {
      for (const listener of listeners) {
        setImmediate(() => listener({ error }));
      }
    }
    this.demand.clear();
  }

  clear(): void {
    this.supply.clear();
    this.error = null;
  }
}
