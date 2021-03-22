export { default as flatMap } from 'lodash.flatmap';
export { default as isEqual } from 'lodash.isequal';
export { default as last } from 'lodash.last';
import isPlainObject from 'lodash.isplainobject';

export async function reduceAsync<T, U>(
  xs: readonly T[],
  init: U,
  f: (u: U, t: T, i: number) => Promise<U>
): Promise<U> {
  let accum = init;
  for (let i = 0; i < xs.length; i++) {
    accum = await f(accum, xs[i], i);
  }
  return accum;
}

export async function flatMapAsync<T, U>(
  xs: readonly T[],
  f: (t: T) => Promise<U[]>
): Promise<U[]> {
  return ([] as U[]).concat(...(await Promise.all(xs.map(f))));
}

export function isObject(it: unknown): it is object {
  return isPlainObject(it);
}

export function sortedIndex<T>(
  array: T[],
  value: T,
  compare: (a: T, b: T) => number
): { index: number; match: boolean };
export function sortedIndex<T, V>(
  array: T[],
  value: V,
  compare: (a: V, b: V) => number,
  extract: (x: T) => V
): { index: number; match: boolean };

export function sortedIndex<T, V>(
  array: T[],
  value: V,
  compare: (a: V, b: V) => number,
  extract: (x: T) => V = (x) => (x as unknown) as V
): { index: number; match: boolean } {
  let low = 0,
    high = array.length,
    cmp = -1;

  while (low < high) {
    const mid = (low + high) >>> 1;
    cmp = compare(extract(array[mid]), value);
    if (cmp === 0) {
      return { index: mid, match: true };
    } else if (cmp < 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return { index: high, match: false };
}
