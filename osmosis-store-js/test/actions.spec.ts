import { expect } from 'chai';
import { describe, it } from 'mocha';
import { scalarActionToChanges } from '../src/actions';
import { ConstantJsonSource } from '../src/json-source';
import { Delete, Index, Key, Move, Put, Touch } from './mock-constructors';

describe('JSON Action', function () {
  describe('Set', async function () {
    it('should set a key on the root object', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'Set', path: [Key('foo')], payload: 2 },
          new ConstantJsonSource({ foo: 1 })
        )
      ).to.deep.equal({
        changes: [Put(['foo'], 2)],
        failures: [],
      });
    });

    it('should set multi-level paths', async function () {
      expect(
        await scalarActionToChanges(
          {
            action: 'Set',
            path: [Key('foo'), Key('bar'), Index(1), Key('baz')],
            payload: 'qux',
          },
          new ConstantJsonSource({ foo: { bar: [{}, {}] } })
        )
      ).to.deep.equal({
        changes: [Put(['foo', 'bar', 1, 'baz'], 'qux')],
        failures: [],
      });
    });

    it('should overwrite existing array elements', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'Set', path: [Key('foo'), Index(1)], payload: 25 },
          new ConstantJsonSource({ foo: [10, 20, 30] })
        )
      ).to.deep.equal({
        changes: [Put(['foo', 1], 25)],
        failures: [],
      });
    });

    it('should add a trailing array element', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'Set', path: [Key('foo'), Index(3)], payload: 40 },
          new ConstantJsonSource({ foo: [10, 20, 30] })
        )
      ).to.deep.equal({
        changes: [Put(['foo', 3], 40)],
        failures: [],
      });
    });

    it('should add an element past the end of an array, inserting nulls in between', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'Set', path: [Key('foo'), Index(6)], payload: 40 },
          new ConstantJsonSource({ foo: [10, 20, 30] })
        )
      ).to.deep.equal({
        changes: [
          Put(['foo', 3], null),
          Put(['foo', 4], null),
          Put(['foo', 5], null),
          Put(['foo', 6], 40),
        ],
        failures: [],
      });
    });

    it('should report failure when a path does not exist', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'Set', path: [Key('baz'), Key('qux')], payload: 3 },
          new ConstantJsonSource({ foo: 1, bar: 2 })
        )
      ).to.deep.equal({
        changes: [],
        failures: [
          {
            path: ['baz'],
            message: 'path does not exist',
          },
        ],
      });
    });
  });

  describe('Delete', async function () {
    it('should delete a key on the root object', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'Delete', path: [Key('bar')] },
          new ConstantJsonSource({ foo: 1, bar: 2 })
        )
      ).to.deep.equal({
        changes: [Delete(['bar'])],
        failures: [],
      });
    });

    it('should delete deep object keys', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'Delete', path: [Key('foo'), Key('bar'), Key('baz')] },
          new ConstantJsonSource({ foo: { bar: { baz: { qux: {} } } } })
        )
      ).to.deep.equal({
        changes: [Delete(['foo', 'bar', 'baz'])],
        failures: [],
      });
    });

    it('should delete trailing array elements', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'Delete', path: [Key('foo'), Index(2)] },
          new ConstantJsonSource({ foo: [1, 2, 3] })
        )
      ).to.deep.equal({
        changes: [Delete(['foo', 2])],
        failures: [],
      });
    });

    it('should shift remaining array elements to fill a deleted space', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'Delete', path: [Key('foo'), Index(1)] },
          new ConstantJsonSource({ foo: [1, 2, 3, 4] })
        )
      ).to.deep.equal({
        changes: [Move(['foo', 2], ['foo', 1]), Move(['foo', 3], ['foo', 2])],
        failures: [],
      });
    });

    it('should report failure when a path does not exist', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'Delete', path: [Key('baz'), Key('qux')] },
          new ConstantJsonSource({ foo: 1, bar: 2 })
        )
      ).to.deep.equal({
        changes: [],
        failures: [
          {
            path: ['baz'],
            message: 'path does not exist',
          },
        ],
      });
    });
  });

  describe('InitArray', async function () {
    it('should set a non-array key to []', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'InitArray', path: [Key('foo')] },
          new ConstantJsonSource({ foo: {} })
        )
      ).to.deep.equal({
        changes: [Put(['foo'], [])],
        failures: [],
      });
    });

    it('should set a nonexistent key to []', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'InitArray', path: [Key('bar')] },
          new ConstantJsonSource({ foo: 1 })
        )
      ).to.deep.equal({
        changes: [Put(['bar'], [])],
        failures: [],
      });
    });

    it('should ignore an existing array', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'InitArray', path: [Key('foo')] },
          new ConstantJsonSource({ foo: [1, 2, 3] })
        )
      ).to.deep.equal({
        changes: [Touch(['foo'])],
        failures: [],
      });
    });

    it('should report failure when a path does not exist', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'InitArray', path: [Key('baz'), Key('qux')] },
          new ConstantJsonSource({ foo: 1, bar: 2 })
        )
      ).to.deep.equal({
        changes: [],
        failures: [
          {
            path: ['baz'],
            message: 'path does not exist',
          },
        ],
      });
    });
  });

  describe('InitObject', async function () {
    it('should set a non-object key to {}', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'InitObject', path: [Key('foo')] },
          new ConstantJsonSource({ foo: [] })
        )
      ).to.deep.equal({
        changes: [Put(['foo'], {})],
        failures: [],
      });
    });

    it('should set a nonexistent key to {}', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'InitObject', path: [Key('bar')] },
          new ConstantJsonSource({ foo: 1 })
        )
      ).to.deep.equal({
        changes: [Put(['bar'], {})],
        failures: [],
      });
    });

    it('should ignore an existing object', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'InitObject', path: [Key('foo')] },
          new ConstantJsonSource({ foo: { bar: 'baz' } })
        )
      ).to.deep.equal({
        changes: [Touch(['foo'])],
        failures: [],
      });
    });

    it('should report failure when a path does not exist', async function () {
      expect(
        await scalarActionToChanges(
          { action: 'InitObject', path: [Key('baz'), Key('qux')] },
          new ConstantJsonSource({ foo: 1, bar: 2 })
        )
      ).to.deep.equal({
        changes: [],
        failures: [
          {
            path: ['baz'],
            message: 'path does not exist',
          },
        ],
      });
    });
  });
});
