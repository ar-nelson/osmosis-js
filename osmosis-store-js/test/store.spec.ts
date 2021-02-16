import { expect } from 'chai';
import { describe, it } from 'mocha';
import { Action } from '../src/actions';
import { idIndex, nextStateHash, ZERO_ID, ZERO_STATE_HASH } from '../src/id';
import InMemorySaveState from '../src/in-memory-save-state';
import Store from '../src/store';
import { Json } from '../src/types';

describe('Store', function () {
  const UUID1 = '1cca2959-e698-4bf2-853b-2957a51a86cc';
  const UUID2 = 'ecdb8ebf-e896-45e9-8bf9-1cf99db583b0';

  it('should set and query a single value', function () {
    const store = new Store(
      new InMemorySaveState({ metadata: { uuid: UUID1 } })
    );
    store.dispatch({
      action: 'Set',
      path: '$.foo',
      payload: 'bar',
    });
    const results = store.queryOnce('$');
    expect(results).to.deep.equal([{ foo: 'bar' }]);
  });

  it('should add each compiled op to the ops list', function () {
    const saveState = new InMemorySaveState({ metadata: { uuid: UUID1 } });
    const store = new Store(saveState);
    store.dispatch({
      action: 'Set',
      path: '$.foo',
      payload: 1,
    });
    const op1 = {
      action: 'Set',
      path: [{ type: 'Key', query: 'foo' }],
      payload: 1,
      id: { author: UUID1, index: 1 },
    };
    expect(store.ops).to.deep.equal([op1]);
    expect(saveState.ops()).to.deep.equal([op1]);
    store.dispatch({
      action: 'Set',
      path: '$.bar',
      payload: 2,
    });
    const op2 = {
      action: 'Set',
      path: [{ type: 'Key', query: 'bar' }],
      payload: 2,
      id: { author: UUID1, index: 2 },
    };
    expect(store.ops).to.deep.equal([op1, op2]);
    expect(saveState.ops()).to.deep.equal([op1, op2]);
  });

  it('should create an initial save point', function () {
    const saveState = new InMemorySaveState({ metadata: { uuid: UUID1 } });
    const store = new Store(saveState);
    store.dispatch({
      action: 'Set',
      path: '$.foo',
      payload: 1,
    });
    const savePoint = {
      id: ZERO_ID,
      width: 4,
      hash: ZERO_STATE_HASH,
      latestIndexes: {},
    };
    expect(store.savePoints).to.have.length(1);
    expect(saveState.savePoints()).to.have.length(1);
    expect(store.savePoints[0]).to.deep.include(savePoint);
    expect(saveState.savePoints()[0]).to.deep.include(savePoint);
  });

  it('should create a new save point every 4 ops', function () {
    const saveState = new InMemorySaveState({ metadata: { uuid: UUID1 } });
    const store = new Store(saveState);
    ['foo', 'bar', 'baz', 'qux', 'quux', 'corge', 'grault', 'garply'].forEach(
      (key, payload) => {
        store.dispatch({
          action: 'Set',
          path: '$.{key}',
          vars: { key },
          payload,
        });
      }
    );
    const ts = (index) => ({ author: UUID1, index });
    const savePoints = [
      {
        id: ZERO_ID,
        width: 4,
        hash: ZERO_STATE_HASH,
        latestIndexes: {},
      },
      {
        id: ts(4),
        width: 4,
        hash: [1, 2, 3, 4].reduce(
          (hash, i) => nextStateHash(hash, ts(i)),
          ZERO_STATE_HASH
        ),
        latestIndexes: { [UUID1]: 4 },
      },
      {
        id: ts(8),
        width: 4,
        hash: [1, 2, 3, 4, 5, 6, 7, 8].reduce(
          (hash, i) => nextStateHash(hash, ts(i)),
          ZERO_STATE_HASH
        ),
        latestIndexes: { [UUID1]: 8 },
      },
    ];
    expect(store.savePoints).to.deep.equal(savePoints);
    expect(saveState.savePoints()).to.deep.equal(savePoints);
  });

  it('should reference existing locations by id', function () {
    const saveState = new InMemorySaveState({ metadata: { uuid: UUID1 } });
    const store = new Store(saveState);
    store.dispatch({
      action: 'Set',
      path: '$.foo',
      payload: 1,
    });
    const op1 = {
      action: 'Set',
      path: [{ type: 'Key', query: 'foo' }],
      payload: 1,
      id: { author: UUID1, index: 1 },
    };
    expect(store.ops).to.deep.equal([op1]);
    store.dispatch({
      action: 'Set',
      path: '$.foo',
      payload: 2,
    });
    const op2 = {
      action: 'Set',
      path: [
        {
          type: 'Id',
          query: { id: { author: UUID1, index: 1 }, path: ['foo'] },
        },
      ],
      payload: 2,
      id: { author: UUID1, index: 2 },
    };
    expect(store.ops).to.deep.equal([op1, op2]);
  });

  it('should write existing locations by id', function () {
    const saveState = new InMemorySaveState({ metadata: { uuid: UUID1 } });
    const store = new Store(saveState);
    store.dispatch({
      action: 'Set',
      path: '$.foo',
      payload: 1,
    });
    store.dispatch({
      action: 'Set',
      path: '$.foo',
      payload: 2,
    });
    expect(store.queryOnce('$')).to.deep.equal([{ foo: 2 }]);
  });

  it('should report failures when dispatching an action', function () {
    const store = new Store(
      new InMemorySaveState({ metadata: { uuid: UUID1 } })
    );
    expect(
      store.dispatch(
        {
          action: 'Set',
          path: '$.foo.bar',
          payload: 1,
        },
        true
      )
    ).to.have.length(1);
  });

  it('should support all action types', function () {
    const saveState = new InMemorySaveState({ metadata: { uuid: UUID1 } });
    const store = new Store(saveState);
    store.dispatch({
      action: 'InitArray',
      path: '$.foo',
    });
    store.dispatch({
      action: 'InsertUnique',
      path: '$.foo',
      payload: 'a',
    });
    store.dispatch({
      action: 'InsertBefore',
      path: '$.foo[0]',
      payload: 'b',
    });
    store.dispatch({
      action: 'InsertAfter',
      path: '$.foo[0]',
      payload: 'c',
    });
    store.dispatch({
      action: 'Set',
      path: '$.foo[3]',
      payload: 'd',
    });
    store.dispatch({
      action: 'InitObject',
      path: '$.bar',
    });
    store.dispatch({
      action: 'Copy',
      path: '$.bar.baz',
      payload: '$.foo',
    });
    store.dispatch({
      action: 'Delete',
      path: '$.foo[1]',
    });
    store.dispatch({
      action: 'Move',
      path: '$.bar.qux',
      payload: '$.foo',
    });
    expect(store.queryOnce('$')).to.deep.equal([
      {
        bar: {
          baz: ['b', 'c', 'a', 'd'],
          qux: ['b', 'a', 'd'],
        },
      },
    ]);
  });

  it('should know how to locate ids in a list', function () {
    const list = [
      { entry: 1, id: { author: UUID1, index: 1 } },
      { entry: 2, id: { author: UUID1, index: 2 } },
      { entry: 3, id: { author: UUID2, index: 2 } },
      { entry: 4, id: { author: UUID1, index: 4 } },
    ];

    expect(idIndex({ author: UUID1, index: 1 }, list)).to.equal(0);
    expect(idIndex({ author: UUID1, index: 2 }, list)).to.equal(1);
    expect(idIndex({ author: UUID2, index: 2 }, list, true)).to.equal(2);
    expect(idIndex({ author: UUID1, index: 4 }, list, true)).to.equal(3);
    expect(idIndex({ author: UUID1, index: 3 }, list, true)).to.equal(-1);
    expect(idIndex({ author: UUID1, index: 3 }, list)).to.equal(3);
    expect(idIndex({ author: UUID2, index: 4 }, list, true)).to.equal(-1);
  });

  function storeSync(
    steps: [Action<string>[], Action<string>[]][],
    store1 = new Store(new InMemorySaveState({ metadata: { uuid: UUID1 } })),
    store2 = new Store(new InMemorySaveState({ metadata: { uuid: UUID2 } })),
    allowFailures = false
  ): Json {
    steps.forEach(([actions1, actions2]) => {
      const lastOp1 = store1.ops.length;
      const lastOp2 = store2.ops.length;
      actions1.forEach((a) => {
        store1.dispatch(a, allowFailures);
      });
      actions2.forEach((a) => {
        store2.dispatch(a, allowFailures);
      });
      const ops1 = store1.ops.slice(lastOp1);
      const ops2 = store2.ops.slice(lastOp2);
      const { failures: failures1 } = store1.mergeOps(ops2);
      if (!allowFailures) {
        expect(failures1).to.eql([], 'failure merging store2 into store1');
      }
      const { failures: failures2 } = store2.mergeOps(ops1);
      if (!allowFailures) {
        expect(failures2).to.eql([], 'failure merging store1 into store2');
      }
    });

    expect({
      json: store2.queryOnce('$'),
      ops: store2.ops,
      savePoints: store2.savePoints,
    }).to.deep.equal(
      {
        json: store1.queryOnce('$'),
        ops: store1.ops,
        savePoints: store1.savePoints,
      },
      'stores do not match after merge'
    );
    expect(store1.saveState.ops()).to.deep.equal(
      store1.ops,
      'save state ops list does not match (store 1)'
    );
    expect(store1.saveState.savePoints()).to.deep.equal(
      store1.savePoints,
      'save state save point list does not match (store 1)'
    );
    expect(store2.saveState.ops()).to.deep.equal(
      store2.ops,
      'save state ops list does not match (store 2)'
    );
    expect(store2.saveState.savePoints()).to.deep.equal(
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
