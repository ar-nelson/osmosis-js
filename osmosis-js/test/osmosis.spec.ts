import { expect } from 'chai';
import { afterEach, describe, it } from 'mocha';
import Osmosis from '../src/osmosis';
import { Json } from '@nels.onl/osmosis-store-js';
import * as uuid from 'uuid';
import Logger from 'bunyan';

describe('OsmosisConnection', function () {
  const log = Logger.createLogger({
    name: 'test',
    serializers: { err: Logger.stdSerializers.err },
    streams: [{ path: `${__dirname}/../test.log`, level: 'info' }],
  });

  let os1: Osmosis;
  let os2: Osmosis;

  beforeEach(function () {
    const appId = uuid.v4();
    os1 = new Osmosis({ appId, log });
    os2 = new Osmosis({ appId, log });
  });

  afterEach(async function () {
    await os1?.stop();
    await os2?.stop();
  });

  async function pair() {
    const firstPeer: any = await new Promise((resolve) => {
      os1.subscribeMeta('$.peers', (results) => {
        if (Array.isArray(results[0]) && results[0].length) {
          resolve(results[0][0]);
        }
      });
    });
    const responder = new Promise((resolve) => {
      os2.on('pairRequest', async ({ peerId }) => {
        await os2.dispatch({
          action: 'AcceptPair',
          payload: {
            id: peerId,
            secret: '1234',
          },
        });
        resolve(null);
      });
    });
    await os1.dispatch({
      action: 'RequestPair',
      payload: {
        id: firstPeer.id,
        secret: '1234',
      },
    });
    await responder;
  }

  async function queryBothUntil(
    path: string,
    predicate: (json: Json[]) => boolean
  ): Promise<Json[]> {
    const vals1: Json[] = await new Promise((resolve) => {
      os1.subscribe(path, (results) => {
        if (predicate(results)) {
          resolve(results);
        }
      });
    });
    const vals2: Json[] = await new Promise((resolve) => {
      os2.subscribe(path, (results) => {
        if (predicate(results)) {
          resolve(results);
        }
      });
    });
    expect(vals2).to.deep.equal(vals1);
    return vals1;
  }

  it('should find peers', async function () {
    const peerId2 = await new Promise((resolve) => {
      os2.subscribeMeta('$.config.peerId', (results) => {
        if (results.length && results[0] != null) {
          resolve(results[0]);
        }
      });
    });
    expect(peerId2).to.be.a('string');
    const peers = await new Promise((resolve) => {
      os1.subscribeMeta('$.peers', (results) => {
        if (Array.isArray(results[0]) && results[0].length) {
          resolve(results[0]);
        }
      });
    });
    expect(peers).to.be.an('array');
    expect((peers as any)?.[0]).to.deep.include({
      id: peerId2,
      connected: false,
      paired: false,
    });
  });

  it('should pair two peers', async function () {
    await pair();
    const firstPeer: any = await new Promise((resolve) => {
      os1.subscribeMeta('$.peers', (results) => {
        if (
          Array.isArray(results[0]) &&
          results[0].length &&
          results[0][0].connected
        ) {
          resolve(results[0][0]);
        }
      });
    });
    expect(firstPeer).to.have.property('paired').be.true;
  });

  it('should sync unrelated actions on pairing', async function () {
    await os1.dispatch({ action: 'Set', path: '$.foo', payload: 1 });
    await os1.dispatch({ action: 'Set', path: '$.bar', payload: 2 });
    await os2.dispatch({ action: 'Set', path: '$.baz', payload: 3 });
    await os2.dispatch({ action: 'Set', path: '$.qux', payload: 4 });
    await pair();
    const [json] = await queryBothUntil(
      '$',
      ([json]) => Object.keys(json as object).length === 4
    );
    expect(json).to.deep.equal({ foo: 1, bar: 2, baz: 3, qux: 4 });
  });

  it('should sync unrelated actions after pairing', async function () {
    await pair();
    await os1.dispatch({ action: 'Set', path: '$.foo', payload: 1 });
    await os1.dispatch({ action: 'Set', path: '$.bar', payload: 2 });
    await os2.dispatch({ action: 'Set', path: '$.baz', payload: 3 });
    await os2.dispatch({ action: 'Set', path: '$.qux', payload: 4 });
    const [json] = await queryBothUntil(
      '$',
      ([json]) => Object.keys(json as object).length === 4
    );
    expect(json).to.deep.equal({ foo: 1, bar: 2, baz: 3, qux: 4 });
  });

  it('should sync related actions before pairing', async function () {
    await os1.dispatch({ action: 'InitObject', path: '$.foo' });
    await os1.dispatch({ action: 'Set', path: '$.foo.bar', payload: 1 });
    await os1.dispatch({ action: 'Set', path: '$.foo.baz', payload: 2 });
    await os1.dispatch({ action: 'Set', path: '$.foo.done1', payload: 1 });
    await os2.dispatch({ action: 'InitObject', path: '$.foo' });
    await os2.dispatch({ action: 'Set', path: '$.foo.baz', payload: 3 });
    await os2.dispatch({ action: 'Set', path: '$.foo.bar', payload: 4 });
    await os2.dispatch({ action: 'Set', path: '$.foo.done2', payload: 2 });
    await pair();
    const [json] = await queryBothUntil(
      '$',
      ([json]) =>
        'foo' in (json as object) && Object.keys((json as any).foo).length === 4
    );
    expect(json).to.deep.equal({
      foo: { bar: 4, baz: 2, done1: 1, done2: 2 },
    });
  });

  it('should sync related actions after pairing', async function () {
    await pair();
    await os1.dispatch({ action: 'InitObject', path: '$.foo' });
    await os1.dispatch({ action: 'Set', path: '$.foo.bar', payload: 1 });
    await os1.dispatch({ action: 'Set', path: '$.foo.baz', payload: 2 });
    await os1.dispatch({ action: 'Set', path: '$.foo.done1', payload: 1 });
    await os2.dispatch({ action: 'InitObject', path: '$.foo' });
    await os2.dispatch({ action: 'Set', path: '$.foo.baz', payload: 3 });
    await os2.dispatch({ action: 'Set', path: '$.foo.bar', payload: 4 });
    await os2.dispatch({ action: 'Set', path: '$.foo.done2', payload: 2 });
    const [json] = await queryBothUntil(
      '$',
      ([json]) =>
        'foo' in (json as object) && Object.keys((json as any).foo).length === 4
    );
    expect(json).to.deep.equal({
      foo: { bar: 4, baz: 2, done1: 1, done2: 2 },
    });
  });

  it('should sync related actions before and after pairing', async function () {
    await os1.dispatch({ action: 'InitObject', path: '$.foo' });
    await os1.dispatch({ action: 'Set', path: '$.foo.bar', payload: 1 });
    await os2.dispatch({ action: 'InitObject', path: '$.foo' });
    await os2.dispatch({ action: 'Set', path: '$.foo.baz', payload: 3 });
    await pair();
    await os1.dispatch({ action: 'Set', path: '$.foo.baz', payload: 2 });
    await os1.dispatch({ action: 'Set', path: '$.foo.done1', payload: 1 });
    await os2.dispatch({ action: 'Set', path: '$.foo.bar', payload: 4 });
    await os2.dispatch({ action: 'Set', path: '$.foo.done2', payload: 2 });
    const [json] = await queryBothUntil(
      '$',
      ([json]) =>
        'foo' in (json as object) && Object.keys((json as any).foo).length === 4
    );
    expect(json).to.deep.equal({
      foo: { bar: 4, baz: 2, done1: 1, done2: 2 },
    });
  });

  it('should sync, just, too many actions. way too many.', async function () {
    this.timeout(20000);
    const SIZE = 500;
    await os1.dispatch({ action: 'InitArray', path: '$.foo' });
    await os2.dispatch({ action: 'InitArray', path: '$.bar' });
    for (let i = 0; i < SIZE; i++) {
      await os1.dispatch({
        action: 'Set',
        path: '$.foo.{0}',
        vars: [i],
        payload: i,
      });
      await os2.dispatch({
        action: 'Set',
        path: '$.bar.{0}',
        vars: [i],
        payload: i,
      });
    }
    await pair();
    const [json] = await queryBothUntil(
      '$',
      ([json]: any[]) =>
        json?.foo?.length === SIZE && json?.bar?.length === SIZE
    );
    expect(json).to.deep.equal({
      foo: [...new Array(SIZE)].map((_, i) => i),
      bar: [...new Array(SIZE)].map((_, i) => i),
    });
  });
});
