import { expect } from 'chai';
import { before, beforeEach, describe, it } from 'mocha';
import * as Monocypher from 'monocypher-wasm';
import * as uuid from 'uuid';
import {
  Change,
  Id,
  idCompare,
  InMemorySaveState,
  nextStateHash,
  Op,
  StateSummary,
  ZERO_STATE_HASH,
} from '../src';
import { EMPTY_PATH, pathArrayToBinary } from '../src/binary-path';
import { JsonNode } from '../src/json-source';
import { PathArray } from '../src/types';
import { Index, Key, Move, Put, Touch } from './mock-constructors';

describe('SaveState', function () {
  let saveState: InMemorySaveState<{}>;

  before(async () => {
    await Monocypher.ready;
  });

  beforeEach(() => {
    saveState = new InMemorySaveState({ metadata: {} });
  });

  async function expectRoot(...keys: string[]) {
    const root = (await saveState.getByPath(EMPTY_PATH)) as {
      type: 'object';
      keys: string[];
    };
    expect(root).to.include({ type: 'object' });
    expect(root.keys).to.have.length(keys.length);
    for (const key of keys) {
      expect(root.keys).to.include(key);
    }
  }

  async function expectPath(path: PathArray, value: JsonNode, ...ids: Id[]) {
    const binPath = pathArrayToBinary(path);
    const node = await saveState.getByPath(binPath);
    expect(node).to.deep.equal(value);
    const actualIds = await saveState.getIdsByPath(binPath);
    expect(actualIds).to.have.length(ids.length);
    for (const id of ids) {
      expect(actualIds).to.deep.include(id);
      expect(await saveState.getPathById(id)).to.deep.equal(binPath);
    }
  }

  it('should set and query a single value', async function () {
    const { changes, failures } = await saveState.insert([
      {
        action: 'Set',
        path: [{ type: 'Key', query: 'foo' }],
        payload: 'bar',
        id: { author: uuid.NIL, index: 1 },
      },
    ]);
    expect(failures).to.deep.equal([]);
    expect(
      changes.map((c) => {
        delete (c as any).id;
        return c;
      })
    ).to.deep.equal([Put(['foo'], 'bar')]);
    expectRoot('foo');
    expectPath(['foo'], 'bar', { author: uuid.NIL, index: 1 });
  });

  function testInMultipleOrders(
    name: string,
    ops: Op[],
    expectedChanges: Change[][],
    finalTests: () => Promise<void> = async () => null
  ) {
    const sorted = [...ops].sort((x, y) => idCompare(x.id, y.id));
    const latestIndexes: { [uuid: string]: number } = {};
    sorted.forEach(
      ({ id: { author, index } }) => (latestIndexes[author] = index)
    );
    const stateSummary: Promise<StateSummary> = Monocypher.ready.then(() => ({
      hash: sorted.reduce(
        (hash, { id }) => nextStateHash(hash, id),
        ZERO_STATE_HASH
      ),
      latestIndexes,
    }));
    describe(name, function () {
      it('should apply in order in one insert', async function () {
        const { changes, failures } = await saveState.insert(ops);
        changes.forEach((c: any) => delete c.id);
        expect(failures).to.deep.equal([]);
        for (const cs of expectedChanges) {
          for (const c of cs) {
            expect(changes).to.deep.include(c);
          }
        }
        expect(await saveState.ops).to.deep.equal(sorted);
        expect(await saveState.failures).to.be.empty;
        expect(await saveState.stateSummary).to.deep.equal(await stateSummary);
        await finalTests();
      });

      it('should apply in order in multiple inserts', async function () {
        for (let i = 0; i < ops.length; i++) {
          const { changes, failures } = await saveState.insert([ops[i]]);
          changes.forEach((c: any) => delete c.id);
          if (i === 0) {
            expect(failures).to.deep.equal([]);
          }
          if (!failures.length) {
            expect(changes).to.deep.equal(expectedChanges[i]);
          }
        }
        expect(await saveState.ops).to.deep.equal(sorted);
        expect(await saveState.failures).to.be.empty;
        expect(await saveState.stateSummary).to.deep.equal(await stateSummary);
        await finalTests();
      });

      it('should apply in reverse order in one insert', async function () {
        const { changes, failures } = await saveState.insert(
          [...ops].reverse()
        );
        changes.forEach((c: any) => delete c.id);
        expect(failures).to.deep.equal([]);
        for (const cs of expectedChanges) {
          for (const c of cs) {
            expect(changes).to.deep.include(c);
          }
        }
        expect(await saveState.ops).to.deep.equal(sorted);
        expect(await saveState.failures).to.be.empty;
        expect(await saveState.stateSummary).to.deep.equal(await stateSummary);
        await finalTests();
      });

      it('should apply in reverse order in multiple inserts', async function () {
        this.timeout(10000);
        const allChanges: Change[] = [];
        for (let i = ops.length - 1; i >= 0; i--) {
          const { changes, failures } = await saveState.insert([ops[i]]);
          if (i === 0) {
            expect(failures).to.deep.equal([]);
          }
          allChanges.push(...changes);
        }
        allChanges.forEach((c: any) => delete c.id);
        for (const cs of expectedChanges) {
          for (const c of cs) {
            expect(allChanges).to.deep.include(c);
          }
        }
        expect(await saveState.ops).to.deep.equal(sorted);
        expect(await saveState.failures).to.be.empty;
        expect(await saveState.stateSummary).to.deep.equal(await stateSummary);
        await finalTests();
      });
    });
  }

  testInMultipleOrders(
    'set three different object keys',
    [
      {
        action: 'Set',
        path: [Key('foo')],
        payload: 1,
        id: { author: uuid.NIL, index: 1 },
      },
      {
        action: 'Set',
        path: [Key('bar')],
        payload: 2,
        id: { author: uuid.NIL, index: 2 },
      },
      {
        action: 'Set',
        path: [Key('baz')],
        payload: 3,
        id: { author: uuid.NIL, index: 3 },
      },
    ],
    [[Put(['foo'], 1)], [Put(['bar'], 2)], [Put(['baz'], 3)]],
    async () => {
      expectRoot('foo', 'bar', 'baz');
      expectPath(['foo'], 1, { author: uuid.NIL, index: 1 });
      expectPath(['bar'], 2, { author: uuid.NIL, index: 2 });
      expectPath(['baz'], 3, { author: uuid.NIL, index: 3 });
    }
  );

  testInMultipleOrders(
    'set three different object keys from different Peer IDs',
    [
      {
        action: 'Set',
        path: [Key('foo')],
        payload: 1,
        id: { author: '0b189e54-98ba-48ef-8129-cf4079a0df7b', index: 1 },
      },
      {
        action: 'Set',
        path: [Key('bar')],
        payload: 2,
        id: { author: 'a4259bce-45f5-4a31-b1d0-9bcc93b1abe6', index: 1 },
      },
      {
        action: 'Set',
        path: [Key('baz')],
        payload: 3,
        id: { author: 'ab92f44f-2a3b-418b-8f39-f66932bf6170', index: 1 },
      },
    ],
    [[Put(['foo'], 1)], [Put(['bar'], 2)], [Put(['baz'], 3)]],
    async () => {
      expectRoot('foo', 'bar', 'baz');
      expectPath(['foo'], 1, {
        author: '0b189e54-98ba-48ef-8129-cf4079a0df7b',
        index: 1,
      });
      expectPath(['bar'], 2, {
        author: 'a4259bce-45f5-4a31-b1d0-9bcc93b1abe6',
        index: 1,
      });
      expectPath(['baz'], 3, {
        author: 'ab92f44f-2a3b-418b-8f39-f66932bf6170',
        index: 1,
      });
    }
  );

  testInMultipleOrders(
    'set 100 different object keys',
    [...new Array(100)].map((_, i) => ({
      action: 'Set',
      path: [Key(`k${i}`)],
      payload: i,
      id: { author: uuid.NIL, index: i + 1 },
    })),
    [...new Array(100)].map((_, i) => [Put([`k${i}`], i)]),
    async () => {
      expectRoot(...[...new Array(100)].map((_, i) => `k${i}`));
    }
  );

  testInMultipleOrders(
    'set one object key three times',
    [
      {
        action: 'Set',
        path: [{ type: 'Key', query: 'foo' }],
        payload: 1,
        id: { author: uuid.NIL, index: 1 },
      },
      {
        action: 'Set',
        path: [{ type: 'Key', query: 'foo' }],
        payload: 2,
        id: { author: uuid.NIL, index: 2 },
      },
      {
        action: 'Set',
        path: [{ type: 'Key', query: 'foo' }],
        payload: 3,
        id: { author: uuid.NIL, index: 3 },
      },
    ],
    [[Put(['foo'], 1)], [Put(['foo'], 2)], [Put(['foo'], 3)]],
    async () => {
      expectRoot('foo');
      expectPath(['foo'], 3, { author: uuid.NIL, index: 3 });
    }
  );

  testInMultipleOrders(
    'set one object key 100 times',
    [...new Array(100)].map((_, i) => ({
      action: 'Set',
      path: [Key('foo')],
      payload: i,
      id: { author: uuid.NIL, index: i + 1 },
    })),
    [...new Array(100)].map((_, i) => [Put(['foo'], i)]),
    async () => {
      expectRoot('foo');
      expectPath(['foo'], 99, { author: uuid.NIL, index: 100 });
    }
  );

  testInMultipleOrders(
    'set three array indexes directly',
    [
      {
        action: 'InitArray',
        path: [Key('foo')],
        id: { author: uuid.NIL, index: 1 },
      },
      {
        action: 'Set',
        path: [Key('foo'), Index(0)],
        payload: 'a',
        id: { author: uuid.NIL, index: 2 },
      },
      {
        action: 'Set',
        path: [Key('foo'), Index(1)],
        payload: 'b',
        id: { author: uuid.NIL, index: 3 },
      },
      {
        action: 'Set',
        path: [Key('foo'), Index(2)],
        payload: 'c',
        id: { author: uuid.NIL, index: 4 },
      },
    ],
    [
      [Put(['foo'], [])],
      [Put(['foo', 0], 'a')],
      [Put(['foo', 1], 'b')],
      [Put(['foo', 2], 'c')],
    ],
    async () => {
      expectRoot('foo');
      expectPath(
        ['foo'],
        { type: 'array', length: 3 },
        { author: uuid.NIL, index: 1 }
      );
      expectPath(['foo', 0], 'a', { author: uuid.NIL, index: 2 });
      expectPath(['foo', 1], 'b', { author: uuid.NIL, index: 3 });
      expectPath(['foo', 2], 'c', { author: uuid.NIL, index: 4 });
    }
  );

  testInMultipleOrders(
    'insert three array items at end',
    [
      {
        action: 'InitArray',
        path: [Key('foo')],
        id: { author: uuid.NIL, index: 1 },
      },
      {
        action: 'Set',
        path: [Key('foo'), Index(0)],
        payload: 'a',
        id: { author: uuid.NIL, index: 2 },
      },
      {
        action: 'InsertAfter',
        path: [Key('foo'), Index(0)],
        payload: 'b',
        id: { author: uuid.NIL, index: 3 },
      },
      {
        action: 'InsertAfter',
        path: [Key('foo'), Index(1)],
        payload: 'c',
        id: { author: uuid.NIL, index: 4 },
      },
    ],
    [
      [Put(['foo'], [])],
      [Put(['foo', 0], 'a')],
      [Put(['foo', 1], 'b')],
      [Put(['foo', 2], 'c')],
    ],
    async () => {
      expectRoot('foo');
      expectPath(
        ['foo'],
        { type: 'array', length: 3 },
        { author: uuid.NIL, index: 1 }
      );
      expectPath(['foo', 0], 'a', { author: uuid.NIL, index: 2 });
      expectPath(['foo', 1], 'b', { author: uuid.NIL, index: 3 });
      expectPath(['foo', 2], 'c', { author: uuid.NIL, index: 4 });
    }
  );

  testInMultipleOrders(
    'insert three array items at beginning',
    [
      {
        action: 'InitArray',
        path: [Key('foo')],
        id: { author: uuid.NIL, index: 1 },
      },
      {
        action: 'Set',
        path: [Key('foo'), Index(0)],
        payload: 'c',
        id: { author: uuid.NIL, index: 2 },
      },
      {
        action: 'InsertBefore',
        path: [Key('foo'), Index(0)],
        payload: 'b',
        id: { author: uuid.NIL, index: 3 },
      },
      {
        action: 'InsertBefore',
        path: [Key('foo'), Index(0)],
        payload: 'a',
        id: { author: uuid.NIL, index: 4 },
      },
    ],
    [
      [Put(['foo'], [])],
      [Put(['foo', 0], 'c')],
      [Move(['foo', 0], ['foo', 1]), Put(['foo', 0], 'b')],
      [
        Move(['foo', 1], ['foo', 2]),
        Move(['foo', 0], ['foo', 1]),
        Put(['foo', 0], 'a'),
      ],
    ],
    async () => {
      expectRoot('foo');
      expectPath(
        ['foo'],
        { type: 'array', length: 3 },
        { author: uuid.NIL, index: 1 }
      );
      expectPath(['foo', 0], 'a', { author: uuid.NIL, index: 4 });
      expectPath(['foo', 1], 'b', { author: uuid.NIL, index: 3 });
      expectPath(['foo', 2], 'c', { author: uuid.NIL, index: 2 });
    }
  );

  testInMultipleOrders(
    'InitObject 3 times on the same location',
    [
      {
        action: 'InitObject',
        path: [Key('foo')],
        id: { author: uuid.NIL, index: 1 },
      },
      {
        action: 'InitObject',
        path: [Key('foo')],
        id: { author: uuid.NIL, index: 2 },
      },
      {
        action: 'InitObject',
        path: [Key('foo')],
        id: { author: uuid.NIL, index: 3 },
      },
    ],
    [[Put(['foo'], {})], [Touch(['foo'])], [Touch(['foo'])]],
    async () => {
      expectRoot('foo');
      expectPath(
        ['foo'],
        { type: 'object', keys: [] },
        { author: uuid.NIL, index: 1 },
        { author: uuid.NIL, index: 2 },
        { author: uuid.NIL, index: 3 }
      );
    }
  );
});
