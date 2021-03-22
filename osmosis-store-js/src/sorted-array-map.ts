import { sortedIndex } from './utils';

export default class SortedArrayMap<K, V> {
  private readonly array: { readonly key: K; readonly value: V }[] = [];

  constructor(private readonly compare: (a: K, b: K) => number) {}

  get(key: K): V | undefined {
    const { index, match } = sortedIndex(
      this.array,
      key,
      this.compare,
      (x) => x.key
    );
    return match ? this.array[index].value : undefined;
  }

  set(key: K, value: V): V | undefined {
    const { index, match } = sortedIndex(
      this.array,
      key,
      this.compare,
      (x) => x.key
    );
    if (match) {
      const replaced = this.array[index].value;
      this.array.splice(index, 1, { key, value });
      return replaced;
    } else {
      this.array.splice(index, 0, { key, value });
    }
  }

  delete(key: K): V | undefined {
    const { index, match } = sortedIndex(
      this.array,
      key,
      this.compare,
      (x) => x.key
    );
    if (match) {
      const deleted = this.array[index].value;
      this.array.splice(index, 1);
      return deleted;
    }
  }

  *keys(): Iterable<K> {
    for (const { key } of this.array) {
      yield key;
    }
  }

  *values(): Iterable<V> {
    for (const { value } of this.array) {
      yield value;
    }
  }

  *entries(): Iterable<{ readonly key: K; readonly value: V }> {
    for (const entry of this.array) {
      yield entry;
    }
  }

  *range(from: K, to?: K): Iterable<{ readonly key: K; readonly value: V }> {
    const { index: start } = sortedIndex(
      this.array,
      from,
      this.compare,
      (x) => x.key
    );
    const end =
      to === undefined
        ? this.array.length
        : sortedIndex(this.array, to, this.compare, (x) => x.key).index;
    for (let i = start; i < end; i++) {
      yield this.array[i];
    }
  }
}
