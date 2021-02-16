import { expect } from 'chai';
import { describe, it } from 'mocha';
import { actionToChanges } from '../src/actions';
import { JsonJsonAdapter } from '../src/json-adapter';
import { Key, Index, Put, Delete, Touch, Move } from './mock-constructors';

describe('JSON Action', function () {
  describe('Set', function () {
    it('should set a key on the root object', function () {
      expect(
        actionToChanges(
          { action: 'Set', path: [Key('foo')], payload: 2 },
          { foo: 1 },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Put(['foo'], 2)],
        failures: [],
      });
    });

    it('should set multi-level paths', function () {
      expect(
        actionToChanges(
          {
            action: 'Set',
            path: [Key('foo'), Key('bar'), Index(1), Key('baz')],
            payload: 'qux',
          },
          { foo: { bar: [{}, {}] } },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Put(['foo', 'bar', 1, 'baz'], 'qux')],
        failures: [],
      });
    });

    it('should overwrite existing array elements', function () {
      expect(
        actionToChanges(
          { action: 'Set', path: [Key('foo'), Index(1)], payload: 25 },
          { foo: [10, 20, 30] },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Put(['foo', 1], 25)],
        failures: [],
      });
    });

    it('should add a trailing array element', function () {
      expect(
        actionToChanges(
          { action: 'Set', path: [Key('foo'), Index(3)], payload: 40 },
          { foo: [10, 20, 30] },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Put(['foo', 3], 40)],
        failures: [],
      });
    });

    it('should add an element past the end of an array, inserting nulls in between', function () {
      expect(
        actionToChanges(
          { action: 'Set', path: [Key('foo'), Index(6)], payload: 40 },
          { foo: [10, 20, 30] },
          JsonJsonAdapter
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

    it('should report failure when a path does not exist', function () {
      expect(
        actionToChanges(
          { action: 'Set', path: [Key('baz'), Key('qux')], payload: 3 },
          { foo: 1, bar: 2 },
          JsonJsonAdapter
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

  describe('Delete', function () {
    it('should delete a key on the root object', function () {
      expect(
        actionToChanges(
          { action: 'Delete', path: [Key('bar')] },
          { foo: 1, bar: 2 },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Delete(['bar'])],
        failures: [],
      });
    });

    it('should delete deep object keys', function () {
      expect(
        actionToChanges(
          { action: 'Delete', path: [Key('foo'), Key('bar'), Key('baz')] },
          { foo: { bar: { baz: { qux: {} } } } },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Delete(['foo', 'bar', 'baz'])],
        failures: [],
      });
    });

    it('should delete trailing array elements', function () {
      expect(
        actionToChanges(
          { action: 'Delete', path: [Key('foo'), Index(2)] },
          { foo: [1, 2, 3] },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Delete(['foo', 2])],
        failures: [],
      });
    });

    it('should shift remaining array elements to fill a deleted space', function () {
      expect(
        actionToChanges(
          { action: 'Delete', path: [Key('foo'), Index(1)] },
          { foo: [1, 2, 3, 4] },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Move(['foo', 2], ['foo', 1]), Move(['foo', 3], ['foo', 2])],
        failures: [],
      });
    });

    it('should report failure when a path does not exist', function () {
      expect(
        actionToChanges(
          { action: 'Delete', path: [Key('baz'), Key('qux')] },
          { foo: 1, bar: 2 },
          JsonJsonAdapter
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

  describe('InitArray', function () {
    it('should set a non-array key to []', function () {
      expect(
        actionToChanges(
          { action: 'InitArray', path: [Key('foo')] },
          { foo: {} },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Put(['foo'], [])],
        failures: [],
      });
    });

    it('should set a nonexistent key to []', function () {
      expect(
        actionToChanges(
          { action: 'InitArray', path: [Key('bar')] },
          { foo: 1 },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Put(['bar'], [])],
        failures: [],
      });
    });

    it('should ignore an existing array', function () {
      expect(
        actionToChanges(
          { action: 'InitArray', path: [Key('foo')] },
          { foo: [1, 2, 3] },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Touch(['foo'])],
        failures: [],
      });
    });

    it('should report failure when a path does not exist', function () {
      expect(
        actionToChanges(
          { action: 'InitArray', path: [Key('baz'), Key('qux')] },
          { foo: 1, bar: 2 },
          JsonJsonAdapter
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

  describe('InitObject', function () {
    it('should set a non-object key to {}', function () {
      expect(
        actionToChanges(
          { action: 'InitObject', path: [Key('foo')] },
          { foo: [] },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Put(['foo'], {})],
        failures: [],
      });
    });

    it('should set a nonexistent key to {}', function () {
      expect(
        actionToChanges(
          { action: 'InitObject', path: [Key('bar')] },
          { foo: 1 },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Put(['bar'], {})],
        failures: [],
      });
    });

    it('should ignore an existing object', function () {
      expect(
        actionToChanges(
          { action: 'InitObject', path: [Key('foo')] },
          { foo: { bar: 'baz' } },
          JsonJsonAdapter
        )
      ).to.deep.equal({
        changes: [Touch(['foo'])],
        failures: [],
      });
    });

    it('should report failure when a path does not exist', function () {
      expect(
        actionToChanges(
          { action: 'InitObject', path: [Key('baz'), Key('qux')] },
          { foo: 1, bar: 2 },
          JsonJsonAdapter
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
