import { expect } from 'chai';
import Chance from 'chance';
import { describe, it } from 'mocha';
import {
  binaryPathSplit,
  binaryPathToArray,
  EMPTY_PATH,
  pathArrayToBinary,
} from '../src/binary-path';

describe('BinaryPath', function () {
  const chance = new Chance();

  it('should encode and decode a 7-bit number', function () {
    expect(binaryPathToArray(pathArrayToBinary([0]))).to.deep.equal([0]);
    expect(binaryPathToArray(pathArrayToBinary([1]))).to.deep.equal([1]);
    expect(binaryPathToArray(pathArrayToBinary([91]))).to.deep.equal([91]);
  });

  it('should encode and decode an 8-bit number', function () {
    expect(binaryPathToArray(pathArrayToBinary([191]))).to.deep.equal([191]);
  });

  it('should encode and decode a 16-bit number', function () {
    expect(binaryPathToArray(pathArrayToBinary([1234]))).to.deep.equal([1234]);
  });

  it('should encode and decode a 32-bit number', function () {
    expect(binaryPathToArray(pathArrayToBinary([1234567]))).to.deep.equal([
      1234567,
    ]);
  });

  it('should encode and decode a 5-bit string', function () {
    expect(binaryPathToArray(pathArrayToBinary(['']))).to.deep.equal(['']);
    expect(binaryPathToArray(pathArrayToBinary(['foo']))).to.deep.equal([
      'foo',
    ]);
    expect(binaryPathToArray(pathArrayToBinary(['foo', 1]))).to.deep.equal([
      'foo',
      1,
    ]);
  });

  it('should encode and decode an 8-bit string', function () {
    const word = chance.word({ length: 123 });
    expect(binaryPathToArray(pathArrayToBinary([word]))).to.deep.equal([word]);
    expect(binaryPathToArray(pathArrayToBinary([word, 1]))).to.deep.equal([
      word,
      1,
    ]);
  });

  it('should encode and decode a 16-bit string', function () {
    const word = chance.word({ length: 1234 });
    expect(binaryPathToArray(pathArrayToBinary([word]))).to.deep.equal([word]);
    expect(binaryPathToArray(pathArrayToBinary([word, 1]))).to.deep.equal([
      word,
      1,
    ]);
  });

  it('should encode and decode a 32-bit string', function () {
    const word = chance.word({ length: 70000 });
    expect(binaryPathToArray(pathArrayToBinary([word]))).to.deep.equal([word]);
    expect(binaryPathToArray(pathArrayToBinary([word, 1]))).to.deep.equal([
      word,
      1,
    ]);
  });

  it('should encode and decode empty paths', function () {
    expect(pathArrayToBinary([])).to.deep.equal(EMPTY_PATH);
    expect(binaryPathToArray(EMPTY_PATH)).to.deep.equal([]);
  });

  it('should encode and decode long paths', function () {
    const examples = [
      ['foo', 'bar', 'baz'],
      [0, 1, 2, 3],
      ['foo', 0, '', '', 0, 'bar'],
      [1000, 'fhqwhgads', 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
    ];
    for (const path of examples) {
      expect(binaryPathToArray(pathArrayToBinary(path))).to.deep.equal(path);
    }
  });

  it('should split paths', function () {
    expect(binaryPathSplit(pathArrayToBinary(['foo', 'bar', 1]))).to.deep.equal(
      {
        index: 1,
        parent: pathArrayToBinary(['foo', 'bar']),
      }
    );
    expect(binaryPathSplit(pathArrayToBinary(['foo']))).to.deep.equal({
      index: 'foo',
      parent: EMPTY_PATH,
    });
  });

  it('fuzz test', function () {
    this.timeout(20000);
    for (let i = 0; i < 1000; i++) {
      const path = [...new Array(chance.natural({ min: 0, max: 100 }))].map(
        () =>
          chance.pickone([
            () => chance.natural({ min: 0, max: 100 }),
            () => chance.natural({ min: 0, max: 1_000_000_000 }),
            () => chance.word({ length: chance.natural({ min: 0, max: 50 }) }),
            () =>
              chance.paragraph({
                sentences: chance.natural({ min: 1, max: 20 }),
              }),
          ])()
      );
      try {
        expect(binaryPathToArray(pathArrayToBinary(path))).to.deep.equal(path);
      } catch (e) {
        console.error(path);
        throw e;
      }
    }
  });
});
