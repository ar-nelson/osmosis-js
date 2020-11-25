import { expect } from 'chai';
import { describe, it } from 'mocha';
import { monotonicFactory } from 'ulid';
import { DataAction } from '../src/actions';
import { Store, timestampIndex, ZERO_TIMESTAMP } from '../src/store';
import { Json, timestampToString } from '../src/types';
import MockSaveState from './mock-save-state';

describe('Store', function () {
  const ulid = monotonicFactory();
  const now = +Date.now();
  const UUID1 = ulid(now);
  const UUID2 = ulid(now);

  it('should set and query a single value', function () {
    const store = new Store(new MockSaveState(UUID1));
    const failures = store.dispatch({
      action: 'Set',
      path: '$.foo',
      payload: 'bar',
    });
    expect(failures).to.be.empty;
    const results = store.queryOnce('$');
    expect(results).to.deep.equal([{ foo: 'bar' }]);
  });

  it('should add each compiled op to the ops list', function () {
    const saveState = new MockSaveState(UUID1);
    const store = new Store(saveState);
    expect(
      store.dispatch({
        action: 'Set',
        path: '$.foo',
        payload: 1,
      })
    ).to.be.empty;
    const op1 = {
      action: 'Set',
      path: [{ type: 'Key', query: 'foo' }],
      payload: 1,
      timestamp: { author: UUID1, index: 1 },
    };
    expect(store.ops).to.deep.equal([op1]);
    expect(saveState.load().ops).to.deep.equal([op1]);
    expect(
      store.dispatch({
        action: 'Set',
        path: '$.bar',
        payload: 2,
      })
    ).to.be.empty;
    const op2 = {
      action: 'Set',
      path: [{ type: 'Key', query: 'bar' }],
      payload: 2,
      timestamp: { author: UUID1, index: 2 },
    };
    expect(store.ops).to.deep.equal([op1, op2]);
    expect(saveState.load().ops).to.deep.equal([op1, op2]);
  });

  it('should create an initial save point', function () {
    const saveState = new MockSaveState(UUID1);
    const store = new Store(saveState);
    expect(
      store.dispatch({
        action: 'Set',
        path: '$.foo',
        payload: 1,
      })
    ).to.be.empty;
    const savePoint = {
      root: {},
      idToPath: {},
      pathToId: { ids: [] },
      timestamp: ZERO_TIMESTAMP,
      width: 4,
    };
    expect(store.savePoints).to.deep.equal([savePoint]);
    expect(saveState.load().savePoints).to.deep.equal([savePoint]);
  });

  it('should create a new save point every 4 ops', function () {
    const saveState = new MockSaveState(UUID1);
    const store = new Store(saveState);
    ['foo', 'bar', 'baz', 'qux', 'quux', 'corge', 'grault', 'garply'].forEach(
      (key, payload) => {
        expect(
          store.dispatch({
            action: 'Set',
            path: '$.{key}',
            vars: { key },
            payload,
          })
        ).to.be.empty;
      }
    );
    const ts = (index) => ({ author: UUID1, index });
    const savePoints = [
      {
        root: {},
        idToPath: {},
        pathToId: { ids: [] },
        timestamp: ZERO_TIMESTAMP,
        width: 4,
      },
      {
        root: {
          foo: 0,
          bar: 1,
          baz: 2,
          qux: 3,
        },
        idToPath: {
          [timestampToString(ts(1))]: ['foo'],
          [timestampToString(ts(2))]: ['bar'],
          [timestampToString(ts(3))]: ['baz'],
          [timestampToString(ts(4))]: ['qux'],
        },
        pathToId: {
          ids: [],
          subtree: {
            foo: { ids: [ts(1)] },
            bar: { ids: [ts(2)] },
            baz: { ids: [ts(3)] },
            qux: { ids: [ts(4)] },
          },
        },
        timestamp: ts(4),
        width: 4,
      },
      {
        root: {
          foo: 0,
          bar: 1,
          baz: 2,
          qux: 3,
          quux: 4,
          corge: 5,
          grault: 6,
          garply: 7,
        },
        idToPath: {
          [timestampToString(ts(1))]: ['foo'],
          [timestampToString(ts(2))]: ['bar'],
          [timestampToString(ts(3))]: ['baz'],
          [timestampToString(ts(4))]: ['qux'],
          [timestampToString(ts(5))]: ['quux'],
          [timestampToString(ts(6))]: ['corge'],
          [timestampToString(ts(7))]: ['grault'],
          [timestampToString(ts(8))]: ['garply'],
        },
        pathToId: {
          ids: [],
          subtree: {
            foo: { ids: [ts(1)] },
            bar: { ids: [ts(2)] },
            baz: { ids: [ts(3)] },
            qux: { ids: [ts(4)] },
            quux: { ids: [ts(5)] },
            corge: { ids: [ts(6)] },
            grault: { ids: [ts(7)] },
            garply: { ids: [ts(8)] },
          },
        },
        timestamp: ts(8),
        width: 4,
      },
    ];
    expect(store.savePoints).to.deep.equal(savePoints);
    expect(saveState.load().savePoints).to.deep.equal(savePoints);
  });

  it('should reference existing locations by timestamp', function () {
    const saveState = new MockSaveState(UUID1);
    const store = new Store(saveState);
    expect(
      store.dispatch({
        action: 'Set',
        path: '$.foo',
        payload: 1,
      })
    ).to.be.empty;
    const op1 = {
      action: 'Set',
      path: [{ type: 'Key', query: 'foo' }],
      payload: 1,
      timestamp: { author: UUID1, index: 1 },
    };
    expect(store.ops).to.deep.equal([op1]);
    expect(
      store.dispatch({
        action: 'Set',
        path: '$.foo',
        payload: 2,
      })
    ).to.be.empty;
    const op2 = {
      action: 'Set',
      path: [
        {
          type: 'Id',
          query: { id: { author: UUID1, index: 1 }, path: ['foo'] },
        },
      ],
      payload: 2,
      timestamp: { author: UUID1, index: 2 },
    };
    expect(store.ops).to.deep.equal([op1, op2]);
  });

  it('should write existing locations by timestamp', function () {
    const saveState = new MockSaveState(UUID1);
    const store = new Store(saveState);
    expect(
      store.dispatch({
        action: 'Set',
        path: '$.foo',
        payload: 1,
      })
    ).to.be.empty;
    expect(
      store.dispatch({
        action: 'Set',
        path: '$.foo',
        payload: 2,
      })
    ).to.be.empty;
    expect(store.queryOnce('$')).to.deep.equal([{ foo: 2 }]);
  });

  it('should report failures when dispatching an action', function () {
    const store = new Store(new MockSaveState(UUID1));
    expect(
      store.dispatch({
        action: 'Set',
        path: '$.foo.bar',
        payload: 1,
      })
    ).to.have.length(1);
  });

  it('should support all action types', function () {
    const saveState = new MockSaveState(UUID1);
    const store = new Store(saveState);
    expect(
      store.dispatch({
        action: 'InitArray',
        path: '$.foo',
      })
    ).to.eql([]);
    expect(
      store.dispatch({
        action: 'InsertUnique',
        path: '$.foo',
        payload: 'a',
      })
    ).to.eql([]);
    expect(
      store.dispatch({
        action: 'InsertBefore',
        path: '$.foo[0]',
        payload: 'b',
      })
    ).to.eql([]);
    expect(
      store.dispatch({
        action: 'InsertAfter',
        path: '$.foo[0]',
        payload: 'c',
      })
    ).to.eql([]);
    expect(
      store.dispatch({
        action: 'Set',
        path: '$.foo[3]',
        payload: 'd',
      })
    ).to.eql([]);
    expect(
      store.dispatch({
        action: 'InitObject',
        path: '$.bar',
      })
    ).to.eql([]);
    expect(
      store.dispatch({
        action: 'Copy',
        path: '$.foo',
        payload: '$.bar.baz',
      })
    ).to.eql([]);
    expect(
      store.dispatch({
        action: 'Delete',
        path: '$.foo[1]',
      })
    ).to.eql([]);
    expect(
      store.dispatch({
        action: 'Move',
        path: '$.foo',
        payload: '$.bar.qux',
      })
    ).to.eql([]);
    expect(store.queryOnce('$')).to.deep.equal([
      {
        bar: {
          baz: ['b', 'c', 'a', 'd'],
          qux: ['b', 'a', 'd'],
        },
      },
    ]);
  });

  it('should know how to locate timestamps in a list', function () {
    const list = [
      { entry: 1, timestamp: { author: UUID1, index: 1 } },
      { entry: 2, timestamp: { author: UUID1, index: 2 } },
      { entry: 3, timestamp: { author: UUID2, index: 2 } },
      { entry: 4, timestamp: { author: UUID1, index: 4 } },
    ];

    expect(timestampIndex({ author: UUID1, index: 1 }, list)).to.equal(0);
    expect(timestampIndex({ author: UUID1, index: 2 }, list)).to.equal(1);
    expect(timestampIndex({ author: UUID2, index: 2 }, list, true)).to.equal(2);
    expect(timestampIndex({ author: UUID1, index: 4 }, list, true)).to.equal(3);
    expect(timestampIndex({ author: UUID1, index: 3 }, list, true)).to.equal(
      -1
    );
    expect(timestampIndex({ author: UUID1, index: 3 }, list)).to.equal(3);
    expect(timestampIndex({ author: UUID2, index: 4 }, list, true)).to.equal(
      -1
    );
  });

  function storeSync(
    steps: [DataAction<string>[], DataAction<string>[]][],
    store1 = new Store(new MockSaveState(UUID1)),
    store2 = new Store(new MockSaveState(UUID2)),
    allowFailures = false
  ): Json {
    let lastOp1 = store1.ops.length;
    let lastOp2 = store2.ops.length;

    steps.forEach(([actions1, actions2]) => {
      actions1.forEach((a) => {
        const failures = store1.dispatch(a);
        if (!allowFailures) {
          expect(failures).to.eql([], `failure in action ${JSON.stringify(a)}`);
        }
      });
      actions2.forEach((a) => {
        const failures = store2.dispatch(a);
        if (!allowFailures) {
          expect(failures).to.eql([], `failure in action ${JSON.stringify(a)}`);
        }
      });
      const { failures: failures1 } = store1.mergeOps(
        store2.ops.slice(lastOp2)
      );
      if (!allowFailures) {
        expect(failures1).to.eql([], 'failure merging store2 into store1');
      }
      const { failures: failures2 } = store2.mergeOps(
        store1.ops.slice(lastOp1)
      );
      if (!allowFailures) {
        expect(failures1).to.eql([], 'failure merging store1 into store2');
      }
      lastOp1 = store1.ops.length;
      lastOp2 = store2.ops.length;
    });

    expect(store2.queryOnce('$')).to.deep.equal(
      store1.queryOnce('$'),
      'store JSON state does not match'
    );
    expect(store2.ops).to.deep.equal(
      store1.ops,
      'store ops list does not match'
    );
    expect(store2.savePoints).to.deep.equal(
      store1.savePoints,
      'store save point list does not match'
    );
    expect(store1.saveState.load().ops).to.deep.equal(
      store1.ops,
      'save state ops list does not match (store 1)'
    );
    expect(store1.saveState.load().savePoints).to.deep.equal(
      store1.savePoints,
      'save state save point list does not match (store 1)'
    );
    expect(store2.saveState.load().ops).to.deep.equal(
      store2.ops,
      'save state ops list does not match (store 2)'
    );
    expect(store2.saveState.load().savePoints).to.deep.equal(
      store2.savePoints,
      'save state save point list does not match (store 2)'
    );

    return store1.queryOnce('$')[0];
  }

  it('should merge changes to unrelated subtrees', function () {
    expect(
      storeSync([
        [
          [
            { action: 'InitObject', path: '$.foo' },
            { action: 'Set', path: '$.foo.bar', payload: 1 },
          ],
          [
            { action: 'InitObject', path: '$.baz' },
            { action: 'Set', path: '$.baz.qux', payload: 2 },
          ],
        ],
      ])
    ).to.deep.equal({ foo: { bar: 1 }, baz: { qux: 2 } });
  });

  it('should merge changes to the same subtree', function () {
    expect(
      storeSync([
        [
          [
            { action: 'InitArray', path: '$.foo' },
            { action: 'InitObject', path: '$.foo[0]' },
            { action: 'Set', path: '$.foo[0].bar', payload: 1 },
            { action: 'Set', path: '$.foo[0].baz', payload: 2 },
          ],
          [
            { action: 'InitArray', path: '$.foo' },
            { action: 'InitObject', path: '$.foo[0]' },
            { action: 'Set', path: '$.foo[0].qux', payload: 3 },
            { action: 'Set', path: '$.foo[0].quux', payload: 4 },
          ],
        ],
      ])
    ).to.deep.equal({ foo: [{ bar: 1, baz: 2, qux: 3, quux: 4 }] });
  });
});
