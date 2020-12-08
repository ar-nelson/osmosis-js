import { v4 as uuidv4 } from 'uuid';

export function randomUuid(): Uint8Array {
  const uuid = new Uint8Array(16);
  uuidv4({}, uuid);
  return uuid;
}

export function ipAddressToUint(address: string): number {
  const [, a, b, c, d] = /(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(
    address
  ) as RegExpExecArray;
  return +a * (1 << 24) + +b * (1 << 16) + +c * (1 << 8) + +d;
}

export function ipAddressFromUint(uint: number): string {
  const a = (uint >> 24) & 0xff;
  const b = (uint & 0xff0000) >> 16;
  const c = (uint & 0xff00) >> 8;
  const d = uint & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

export function binaryEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
