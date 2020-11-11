import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  compileJsonPath,
  querySlots,
  queryPaths,
  queryValues,
} from '../src/jsonpath';

describe('JsonPath', function () {
  it('should compile a simple path', function () {
    expect(compileJsonPath('$.foo.bar.baz')).to.deep.equal([
      { type: 'Key', query: 'foo' },
      { type: 'Key', query: 'bar' },
      { type: 'Key', query: 'baz' },
    ]);
  });

  it('should compile a path without a leading $', function () {
    expect(compileJsonPath('.foo.bar.baz')).to.deep.equal([
      { type: 'Key', query: 'foo' },
      { type: 'Key', query: 'bar' },
      { type: 'Key', query: 'baz' },
    ]);
  });

  it('should compile all JsonPath segment types', function () {
    [
      '$',
      '$.foo',
      '$["foo"]',
      '$[1]',
      '$..foo',
      '$..[1]',
      '$[(null)]',
      '$[?(null)]',
    ].forEach((it) => {
      expect(compileJsonPath(it)).to.exist;
    });
  });

  it('should compile all JsonPath expression types', function () {
    [
      '$[(@)]',
      '$[(@.foo)]',
      '$[(@[1])]',
      '$[(null)]',
      '$[(true)]',
      '$[(false)]',
      '$[(3.14)]',
      "$[('foo')]",
      '$[("foo")]',
      '$[(-(1))]',
      '$[(!!1)]',
      '$[(1 + 1)]',
      '$[(1 - 1)]',
      '$[(1 * 1)]',
      '$[(1 / 1)]',
      '$[(1 % 1)]',
      '$[(1 < 1)]',
      '$[(1 <= 1)]',
      '$[(1 > 1)]',
      '$[(1 >= 1)]',
      '$[(1 == 1)]',
      '$[(1 != 1)]',
      '$[(1 && 1)]',
      '$[(1 || 1)]',
      '$[(1 ? 1 : 1)]',
    ].forEach((it) => {
      expect(compileJsonPath(it)).to.exist;
    });
  });

  const fooBarJson = {
    foo: {
      bar: 1,
      baz: 2,
    },
    bar: {
      foo: 3,
      bar: 4,
      baz: 5,
    },
  };

  it('should match a literal path with querySlots', function () {
    expect(querySlots(fooBarJson, compileJsonPath('$.foo.bar'))).to.deep.equal([
      ['foo', 'bar'],
    ]);
  });

  it('should match a literal path with queryPaths', function () {
    expect(queryPaths(fooBarJson, compileJsonPath('$.foo.bar'))).to.deep.equal([
      ['foo', 'bar'],
    ]);
  });

  it('should match a potential path with querySlots', function () {
    expect(querySlots(fooBarJson, compileJsonPath('$.foo.qux'))).to.deep.equal([
      ['foo', 'qux'],
    ]);
  });

  it('should not match a potential path with queryPaths', function () {
    expect(queryPaths(fooBarJson, compileJsonPath('$.foo.qux'))).to.deep.equal(
      []
    );
  });

  it('should extract a value with queryValues', function () {
    expect(
      queryValues(fooBarJson, compileJsonPath('$.foo.bar'))
    ).to.deep.equal([1]);
  });

  it('should match multiple paths with querySlots and ..', function () {
    expect(querySlots(fooBarJson, compileJsonPath('$..bar')))
      .to.have.length(3)
      .and.to.deep.contain(['bar'])
      .and.to.deep.contain(['bar', 'bar'])
      .and.to.deep.contain(['foo', 'bar']);
  });

  it('should match multiple paths with queryPaths and ..', function () {
    expect(queryPaths(fooBarJson, compileJsonPath('$..bar')))
      .to.have.length(3)
      .and.to.deep.contain(['bar'])
      .and.to.deep.contain(['bar', 'bar'])
      .and.to.deep.contain(['foo', 'bar']);
  });

  it('should extract multiple values with queryValues and ..', function () {
    expect(queryValues(fooBarJson, compileJsonPath('$..bar')))
      .to.have.length(3)
      .and.to.contain(1)
      .and.to.contain(4)
      .and.to.deep.contain({ foo: 3, bar: 4, baz: 5 });
  });
});
