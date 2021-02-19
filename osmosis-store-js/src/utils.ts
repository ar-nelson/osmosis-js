export { default as flatMap } from 'lodash.flatmap';
export { default as last } from 'lodash.last';
export { default as isEqual } from 'lodash.isequal';
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
