import { expect } from 'chai';
import { describe, it } from 'mocha';
import { JsonJsonAdapter } from '../src/json-adapter';
import { compileJsonPath, queryPaths, queryValues } from '../src/jsonpath';

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
    expect(compileJsonPath('$')).to.deep.equal([]);
    expect(compileJsonPath('$.foo')).to.deep.equal([
      { type: 'Key', query: 'foo' },
    ]);
    expect(compileJsonPath('$["foo"]')).to.deep.equal([
      { type: 'Key', query: 'foo' },
    ]);
    expect(compileJsonPath("$['foo']")).to.deep.equal([
      { type: 'Key', query: 'foo' },
    ]);
    expect(compileJsonPath('$[1]')).to.deep.equal([
      { type: 'Index', query: 1 },
    ]);
    expect(compileJsonPath("$['foo','bar']")).to.deep.equal([
      { type: 'MultiKey', query: ['foo', 'bar'] },
    ]);
    expect(compileJsonPath('$[1,2]')).to.deep.equal([
      { type: 'MultiIndex', query: [1, 2] },
    ]);
    expect(compileJsonPath('$[:]')).to.deep.equal([
      { type: 'Slice', query: {} },
    ]);
    expect(compileJsonPath('$[1:]')).to.deep.equal([
      { type: 'Slice', query: { from: 1 } },
    ]);
    expect(compileJsonPath('$[:2]')).to.deep.equal([
      { type: 'Slice', query: { to: 2 } },
    ]);
    expect(compileJsonPath('$[1:2]')).to.deep.equal([
      { type: 'Slice', query: { from: 1, to: 2 } },
    ]);
    expect(compileJsonPath('$[1:2:3]')).to.deep.equal([
      { type: 'Slice', query: { from: 1, to: 2, step: 3 } },
    ]);
    expect(compileJsonPath('$[(@):]')).to.deep.equal([
      { type: 'ExprSlice', query: { from: ['self'] } },
    ]);
    expect(compileJsonPath('$[:(@)]')).to.deep.equal([
      { type: 'ExprSlice', query: { to: ['self'] } },
    ]);
    expect(compileJsonPath('$[1:(@)]')).to.deep.equal([
      { type: 'ExprSlice', query: { from: ['literal', 1], to: ['self'] } },
    ]);
    expect(compileJsonPath('$[1:2:(@)]')).to.deep.equal([
      {
        type: 'ExprSlice',
        query: { from: ['literal', 1], to: ['literal', 2], step: ['self'] },
      },
    ]);
    expect(compileJsonPath('$..foo')).to.deep.equal([
      { type: 'Recursive', query: [{ type: 'Key', query: 'foo' }] },
    ]);
    expect(compileJsonPath('$..[1]')).to.deep.equal([
      { type: 'Recursive', query: [{ type: 'Index', query: 1 }] },
    ]);
    expect(compileJsonPath('$[(@)]')).to.deep.equal([
      { type: 'ExprIndex', query: [['self']] },
    ]);
    expect(compileJsonPath('$[?(@)]')).to.deep.equal([
      { type: 'Filter', query: ['self'] },
    ]);
  });

  it('should compile all JsonPath expression types', function () {
    expect(
      compileJsonPath('$[(@)]')
    ).to.have.deep.nested.property('[0].query[0]', ['self']);
    expect(
      compileJsonPath('$[(@.foo)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      'subscript',
      ['self'],
      ['literal', 'foo'],
    ]);
    expect(
      compileJsonPath('$[(@[1])]')
    ).to.have.deep.nested.property('[0].query[0]', [
      'subscript',
      ['self'],
      ['literal', 1],
    ]);
    expect(
      compileJsonPath('$[(@.length)]')
    ).to.have.deep.nested.property('[0].query[0]', ['length', ['self']]);
    expect(
      compileJsonPath('$[(null)]')
    ).to.have.deep.nested.property('[0].query[0]', ['literal', null]);
    expect(
      compileJsonPath('$[(true)]')
    ).to.have.deep.nested.property('[0].query[0]', ['literal', true]);
    expect(
      compileJsonPath('$[(false)]')
    ).to.have.deep.nested.property('[0].query[0]', ['literal', false]);
    expect(
      compileJsonPath('$[(3.14)]')
    ).to.have.deep.nested.property('[0].query[0]', ['literal', 3.14]);
    expect(
      compileJsonPath("$[('foo')]")
    ).to.have.deep.nested.property('[0].query[0]', ['literal', 'foo']);
    expect(
      compileJsonPath('$[("foo")]')
    ).to.have.deep.nested.property('[0].query[0]', ['literal', 'foo']);
    expect(
      compileJsonPath('$[(-(1))]')
    ).to.have.deep.nested.property('[0].query[0]', ['neg', ['literal', 1]]);
    expect(
      compileJsonPath('$[(!!1)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '!',
      ['!', ['literal', 1]],
    ]);
    expect(
      compileJsonPath('$[(1 + 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '+',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 - 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '-',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 * 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '*',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 / 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '/',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 % 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '%',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 < 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '<',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 <= 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '<=',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 > 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '>',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 >= 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '>=',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 == 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '==',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 = 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '==',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 != 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '!=',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 && 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '&&',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 || 2)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      '||',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[(1 ? 2 : 3)]')
    ).to.have.deep.nested.property('[0].query[0]', [
      'if',
      ['literal', 1],
      ['literal', 2],
      ['literal', 3],
    ]);
  });

  it('should compile paths with expression variables', function () {
    expect(
      compileJsonPath('$[({foo} + {bar})]', { foo: 1, bar: 2 })
    ).to.have.deep.nested.property('[0].query[0]', [
      '+',
      ['literal', 1],
      ['literal', 2],
    ]);
    expect(
      compileJsonPath('$[({0}.{1})]', [[1, 2, 3], 2])
    ).to.have.deep.nested.property('[0].query[0]', [
      'subscript',
      ['literal', [1, 2, 3]],
      ['literal', 2],
    ]);
  });

  it('should compile paths with subscript variables', function () {
    expect(
      compileJsonPath('$.{foo}[{bar}]', { foo: 'qux', bar: 2 })
    ).to.deep.equal([
      { type: 'ExprIndex', query: [['literal', 'qux']] },
      { type: 'ExprIndex', query: [['literal', 2]] },
    ]);
    expect(compileJsonPath('$[{0}].{1}', ['qux', 2])).to.deep.equal([
      { type: 'ExprIndex', query: [['literal', 'qux']] },
      { type: 'ExprIndex', query: [['literal', 2]] },
    ]);
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

  it('should query an existing literal path', async function () {
    expect(
      await queryPaths(
        compileJsonPath('$.foo.bar'),
        fooBarJson,
        JsonJsonAdapter
      )
    ).to.deep.equal({
      existing: [['foo', 'bar']],
      potential: [],
      failures: [],
    });
  });

  it('should query a potential literal path', async function () {
    expect(
      await queryPaths(
        compileJsonPath('$.foo.qux'),
        fooBarJson,
        JsonJsonAdapter
      )
    ).to.deep.equal({
      existing: [],
      potential: [['foo', 'qux']],
      failures: [],
    });
  });

  it('should report a failure on a query for a missing literal path', async function () {
    expect(
      await queryPaths(
        compileJsonPath('$.baz.qux'),
        fooBarJson,
        JsonJsonAdapter
      )
    ).to.deep.equal({
      existing: [],
      potential: [],
      failures: [{ path: ['baz'], message: 'path does not exist' }],
    });
  });

  it('should extract a value with queryValues', async function () {
    expect(
      await queryValues(
        compileJsonPath('$.foo.bar'),
        fooBarJson,
        JsonJsonAdapter
      )
    ).to.deep.equal([1]);
  });

  it('should query multiple existing paths with ..', async function () {
    const { existing, potential, failures } = await queryPaths(
      compileJsonPath('$..bar'),
      fooBarJson,
      JsonJsonAdapter
    );
    expect(potential).to.be.empty;
    expect(failures).to.be.empty;
    expect(existing)
      .to.have.length(3)
      .and.to.deep.contain(['bar'])
      .and.to.deep.contain(['bar', 'bar'])
      .and.to.deep.contain(['foo', 'bar']);
  });

  it('should extract multiple values with queryValues and ..', async function () {
    expect(
      await queryValues(compileJsonPath('$..bar'), fooBarJson, JsonJsonAdapter)
    )
      .to.have.length(3)
      .and.to.contain(1)
      .and.to.contain(4)
      .and.to.deep.contain({ foo: 3, bar: 4, baz: 5 });
  });
});
