import sortedIndexBy from 'lodash.sortedindexby';
import * as uuid from 'uuid';

export type Uuid = string;

export interface Id {
  readonly author: Uuid;
  readonly index: number;
}

export interface CausalTree {
  readonly id: Id;
}

export const ZERO_ID: Id = { author: uuid.NIL, index: 0 };

export function idToString({ author, index }: Id): string {
  return `${index.toString(32).padStart(11, '0')}@${author}`;
}

export function idIndex(
  id: Id,
  ops: readonly CausalTree[],
  expectMatch = false
): number {
  const i = sortedIndexBy(ops, { id }, (x) => idToString(x.id));
  if (
    !expectMatch ||
    (ops[i]?.id?.author === id.author && ops[i]?.id?.index === id.index)
  ) {
    return i;
  }
  return -1;
}
