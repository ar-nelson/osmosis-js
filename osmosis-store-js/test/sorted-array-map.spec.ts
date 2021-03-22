import { expect } from 'chai';
import Chance from 'chance';
import { describe, it } from 'mocha';
import { binaryCompare } from '../src/binary-path';
import { Id, idCompare } from '../src/id';
import SortedArrayMap from '../src/sorted-array-map';

describe('SortedArrayMap', function () {
  const chance = new Chance();

  it('should set and get one item', function () {
    const map = new SortedArrayMap<number, string>((a, b) => a - b);
    expect(map.set(1, 'foo')).to.be.undefined;
    expect(map.get(1)).to.equal('foo');
    expect(map.get(0)).to.be.undefined;
    expect(map.get(2)).to.be.undefined;
  });

  it('should set and get 100 items in sequence', function () {
    const map = new SortedArrayMap<number, string>((a, b) => a - b);
    for (let i = 0; i < 100; i++) {
      expect(map.set(i, `v${100 - i}`)).to.be.undefined;
    }
    for (let i = 0; i < 100; i++) {
      expect(map.get(i)).to.equal(`v${100 - i}`);
    }
  });

  it('should set and get 100 items in random order', function () {
    const map = new SortedArrayMap<number, string>((a, b) => a - b);
    const keys = chance.shuffle([...new Array(100)].map((_, i) => i));
    const entries = keys.map((k, i) => ({ k, v: `v${i}` }));
    for (const { k, v } of entries) {
      expect(map.set(k, v)).to.be.undefined;
    }
    for (const { k, v } of entries) {
      expect(map.get(k)).to.equal(v);
    }
  });

  it('should index by IDs', function () {
    const map = new SortedArrayMap<Id, string>(idCompare);
    const entries: [Id, string][] = [
      [{ author: '93b74f15-2d9b-4f2c-95f9-32c20500ebf1', index: 1 }, 'one'],
      [{ author: '93b74f15-2d9b-4f2c-95f9-32c20500ebf1', index: 2 }, 'two'],
      [{ author: '93b74f15-2d9b-4f2c-95f9-32c20500ebf1', index: 3 }, 'three'],
      [{ author: '1cb20923-8cb2-4e70-bfe0-fe4bb1962bdf', index: 1 }, 'four'],
      [{ author: '1cb20923-8cb2-4e70-bfe0-fe4bb1962bdf', index: 2 }, 'five'],
    ];
    for (const [k, v] of entries) {
      expect(map.set(k, v)).to.be.undefined;
    }
    for (const [k, v] of entries) {
      expect(map.get(k)).to.equal(v);
    }
    expect([...map.values()]).to.deep.equal([
      'four',
      'one',
      'five',
      'two',
      'three',
    ]);
  });

  it('should index by binary buffers', function () {
    const map = new SortedArrayMap<Buffer, string>(binaryCompare);
    const entries: [Buffer, string][] = [
      [Buffer.from('foo', 'utf8'), 'one'],
      [Buffer.from('bar', 'utf8'), 'two'],
      [Buffer.from('baz', 'utf8'), 'three'],
      [Buffer.from('qux', 'utf8'), 'four'],
      [Buffer.from('quux', 'utf8'), 'five'],
    ];
    for (const [k, v] of entries) {
      expect(map.set(k, v)).to.be.undefined;
    }
    for (const [k, v] of entries) {
      expect(map.get(k)).to.equal(v);
    }
    expect([...map.values()]).to.deep.equal([
      'two',
      'three',
      'one',
      'five',
      'four',
    ]);
  });
});
