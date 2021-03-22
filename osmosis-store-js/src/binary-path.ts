import assert from 'assert';
import { PathArray } from './types';

export type BinaryPath = Buffer;

export const EMPTY_PATH = Buffer.alloc(0);

export function pathIndexToBinary(index: number | string): BinaryPath {
  if (typeof index === 'number') {
    assert(index >= 0);
    if (index < 128) {
      return Buffer.from([index]);
    } else if (index < 0xff) {
      return Buffer.from([0xcc, index]);
    } else if (index < 0xffff) {
      const buf = Buffer.alloc(3);
      buf[0] = 0xcd;
      buf.writeUInt16BE(index, 1);
      return buf;
    } else {
      const buf = Buffer.alloc(5);
      buf[0] = 0xce;
      buf.writeUInt32BE(index, 1);
      return buf;
    }
  }
  const bin = Buffer.from(index, 'utf8');
  if (bin.byteLength < 32) {
    return Buffer.concat([Buffer.from([0b1010_0000 | bin.byteLength]), bin]);
  } else if (bin.byteLength < 0xff) {
    const buf = Buffer.alloc(bin.byteLength + 2);
    buf[0] = 0xd9;
    buf[1] = bin.byteLength;
    buf.set(bin, 2);
    return buf;
  } else if (bin.byteLength < 0xffff) {
    const buf = Buffer.alloc(bin.byteLength + 3);
    buf[0] = 0xda;
    buf.writeUInt16BE(bin.byteLength, 1);
    buf.set(bin, 3);
    return buf;
  } else {
    const buf = Buffer.alloc(bin.byteLength + 5);
    buf[0] = 0xdb;
    buf.writeUInt32BE(bin.byteLength, 1);
    buf.set(bin, 5);
    return buf;
  }
}

export function pathArrayToBinary(path: PathArray): BinaryPath {
  return Buffer.concat(path.map(pathIndexToBinary));
}

export function* iterateBinaryPath(
  path: BinaryPath
): Iterable<number | string> {
  let i = 0;
  while (i < path.length) {
    const b = path[i];
    if (b < 128) {
      yield b;
      i += 1;
    } else if ((b & 0b1010_0000) === 0b1010_0000) {
      const length = b & 0b0001_1111;
      yield path.subarray(i + 1, i + 1 + length).toString('utf8');
      i += 1 + length;
    } else {
      switch (b) {
        case 0xd9: {
          const length = path.readUInt8(i + 1);
          yield path.subarray(i + 2, i + 2 + length).toString('utf8');
          i += 2 + length;
          break;
        }
        case 0xcc:
          yield path.readUInt8(i + 1);
          i += 2;
          break;
        case 0xda: {
          const length = path.readUInt16BE(i + 1);
          yield path.subarray(i + 3, i + 3 + length).toString('utf8');
          i += 3 + length;
          break;
        }
        case 0xcd:
          yield path.readUInt16BE(i + 1);
          i += 3;
          break;
        case 0xce:
          yield path.readUInt32BE(i + 1);
          i += 5;
          break;
        case 0xdb: {
          const length = path.readUInt32BE(i + 1);
          yield path.subarray(i + 5, i + 5 + length).toString('utf8');
          i += 5 + length;
          break;
        }
        default:
          assert(false, `unexpected byte ${b} at index ${i} of binary path`);
          return;
      }
    }
  }
}

export function binaryPathToArray(path: BinaryPath): PathArray {
  return [...iterateBinaryPath(path)];
}

export function binaryPathAppend(
  path: BinaryPath,
  index: number | string
): BinaryPath {
  return Buffer.concat([path, pathIndexToBinary(index)]);
}

export function binaryPathSplit(
  path: BinaryPath
): { parent: BinaryPath; index: number | string | null } {
  if (!path.byteLength) {
    return { parent: path, index: null };
  }
  // TODO: Make this more efficient
  const entries = Array.from(iterateBinaryPath(path));
  return {
    parent: pathArrayToBinary(entries.slice(0, entries.length - 1)),
    index: entries[entries.length - 1],
  };
}

export function binaryCompare(a: Buffer, b: Buffer): number {
  const max = Math.min(a.byteLength, b.byteLength);
  for (let i = 0; i < max; i++) {
    const cmp = a[i] - b[i];
    if (cmp) {
      return cmp;
    }
  }
  return a.byteLength - b.byteLength;
}
