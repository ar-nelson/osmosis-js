import { describe, it } from 'mocha';
import { expect } from 'chai';
import { applyAction } from '../src/actions';

describe('JSON Action', function () {
  describe('Set', function () {
    it('should set a key on the root object', function () {
      const json = { foo: 1 };
      const result = applyAction(
        { action: 'Set', path: ['bar'], payload: 2 },
        json
      );
      expect(json).to.deep.equal({ foo: 1, bar: 2 });
      expect(result).not.to.have.property('failure');
      expect(result)
        .to.have.property('changed')
        .deep.equal([['bar']]);
    });

    it('should set multi-level paths', function () {
      const json = { foo: { bar: [{}, {}] } };
      const result = applyAction(
        { action: 'Set', path: ['foo', 'bar', 1, 'baz'], payload: 'qux' },
        json
      );
      expect(json).to.deep.equal({ foo: { bar: [{}, { baz: 'qux' }] } });
      expect(result).not.to.have.property('failure');
      expect(result)
        .to.have.property('changed')
        .deep.equal([['foo', 'bar', 1, 'baz']]);
    });

    it('should overwrite existing object keys', function () {
      const json = { foo: 1, bar: 2 };
      const result = applyAction(
        { action: 'Set', path: ['foo'], payload: 3 },
        json
      );
      expect(json).to.deep.equal({ foo: 3, bar: 2 });
      expect(result).not.to.have.property('failure');
      expect(result)
        .to.have.property('changed')
        .deep.equal([['foo']]);
    });

    it('should overwrite existing array elements', function () {
      const json = { foo: [10, 20, 30] };
      const result = applyAction(
        { action: 'Set', path: ['foo', 1], payload: 25 },
        json
      );
      expect(json).to.deep.equal({ foo: [10, 25, 30] });
      expect(result).not.to.have.property('failure');
      expect(result)
        .to.have.property('changed')
        .deep.equal([['foo', 1]]);
    });

    it('should add a trailing array element', function () {
      const json = { foo: [10, 20, 30] };
      const result = applyAction(
        { action: 'Set', path: ['foo', 3], payload: 40 },
        json
      );
      expect(json).to.deep.equal({ foo: [10, 20, 30, 40] });
      expect(result).not.to.have.property('failure');
      expect(result)
        .to.have.property('changed')
        .deep.equal([['foo', 3]]);
    });

    it('should report failure when a path does not exist', function () {
      const json = { foo: 1, bar: 2 };
      const result = applyAction(
        { action: 'Set', path: ['baz', 'qux'], payload: 3 },
        json
      );
      expect(json).to.deep.equal({ foo: 1, bar: 2 });
      expect(result.failed).to.be.true;
      expect(result)
        .to.have.property('failure')
        .deep.equal({
          path: ['baz', 'qux'],
          message: 'path does not exist',
        });
    });
  });

  describe('Delete', function () {
    it('should delete a key on the root object', function () {
      const json = { foo: 1, bar: 2 };
      const result = applyAction({ action: 'Delete', path: ['bar'] }, json);
      expect(json).to.deep.equal({ foo: 1 });
      expect(result).not.to.have.property('failure');
      expect(result)
        .to.have.property('changed')
        .deep.equal([['bar']]);
    });

    it('should delete deep object keys', function () {
      const json = { foo: { bar: { baz: { qux: {} } } } };
      const result = applyAction(
        { action: 'Delete', path: ['foo', 'bar', 'baz'] },
        json
      );
      expect(json).to.deep.equal({ foo: { bar: {} } });
      expect(result).not.to.have.property('failure');
      expect(result)
        .to.have.property('changed')
        .deep.equal([['foo', 'bar', 'baz']]);
    });

    it('should delete trailing array elements', function () {
      const json = { foo: [1, 2, 3] };
      const result = applyAction({ action: 'Delete', path: ['foo', 2] }, json);
      expect(json).to.deep.equal({ foo: [1, 2] });
      expect(result).not.to.have.property('failure');
      expect(result)
        .to.have.property('changed')
        .deep.equal([['foo', 2]]);
    });

    it('should shift remaining array elements to fill a deleted space', function () {
      const json = { foo: [1, 2, 3, 4] };
      const result = applyAction({ action: 'Delete', path: ['foo', 1] }, json);
      expect(json).to.deep.equal({ foo: [1, 3, 4] });
      expect(result).not.to.have.property('failure');
      expect(result)
        .to.have.property('changed')
        .deep.equal([
          ['foo', 1],
          ['foo', 2],
          ['foo', 3],
        ]);
    });

    it('should report failure when a path does not exist', function () {
      const json = { foo: 1, bar: 2 };
      const result = applyAction(
        { action: 'Delete', path: ['baz', 'qux'] },
        json
      );
      expect(json).to.deep.equal({ foo: 1, bar: 2 });
      expect(result.failed).to.be.true;
      expect(result)
        .to.have.property('failure')
        .deep.equal({
          path: ['baz', 'qux'],
          message: 'path does not exist',
        });
    });
  });
});
