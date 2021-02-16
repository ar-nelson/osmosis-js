import sortedIndexBy from 'lodash.sortedindexby';
import { crypto_blake2b, HASH_BYTES } from 'monocypher-wasm';
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

export function idCompare(id1: Id, id2: Id): number {
  const str1 = idToString(id1);
  const str2 = idToString(id2);
  return str1.localeCompare(str2, 'en');
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

export const ZERO_STATE_HASH = new Uint8Array(HASH_BYTES);

export function nextStateHash(lastStateHash: Uint8Array, id: Id): Uint8Array {
  const buffer = Buffer.alloc(HASH_BYTES + 16 + 8);
  buffer.set(lastStateHash, 0);
  buffer.set(uuid.parse(id.author), HASH_BYTES);
  buffer.writeBigUInt64BE(BigInt(id.index), HASH_BYTES + 16);
  return crypto_blake2b(buffer);
}
