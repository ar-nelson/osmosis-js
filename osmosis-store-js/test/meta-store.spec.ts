import { expect } from 'chai';
import { EventEmitter } from 'events';
import { describe, it } from 'mocha';
import { BinaryPath } from '../src/binary-path';
import { AnonymousJsonSource, ConstantJsonSource } from '../src/json-source';
import { MetadataSource, MetaStore } from '../src/meta-store';
import { Json } from '../src/types';

class MockMetadataSource extends AnonymousJsonSource implements MetadataSource {
  private readonly events = new EventEmitter();
  private source: ConstantJsonSource;

  constructor(initialState: Json) {
    super();
    this.source = new ConstantJsonSource(initialState);
  }

  setState(newState: Json) {
    this.source = new ConstantJsonSource(newState);
    this.events.emit('update');
  }

  getByPath(path: BinaryPath) {
    return this.source.getByPath(path);
  }

  subscribe(listener: () => void) {
    this.events.on('update', listener);
    return {
      cancel: () => this.events.off('update', listener),
    };
  }
}

describe('MetaStore', function () {
  it('should query a static data source', async function () {
    const data = new MockMetadataSource(['foo', 'bar', 'baz']);
    const store = new MetaStore({ data });
    expect(await store.queryOnce('$')).to.deep.equal([
      { data: ['foo', 'bar', 'baz'] },
    ]);
    expect(await store.queryOnce('$.data[0, 1]')).to.deep.equal(['foo', 'bar']);
  });

  it('should query multiple static data sources', async function () {
    const foo = new MockMetadataSource([1, 2, 3]);
    const bar = new MockMetadataSource({ a: 10, b: 20 });
    const store = new MetaStore({ foo, bar });
    expect(await store.queryOnce('$')).to.deep.equal([
      { foo: [1, 2, 3], bar: { a: 10, b: 20 } },
    ]);
    expect(await store.queryOnce('$.foo[0, 2]')).to.deep.equal([1, 3]);
  });

  it('should query a static data source after an update', async function () {
    const data = new MockMetadataSource(['foo', 'bar', 'baz']);
    const store = new MetaStore({ data });
    expect(await store.queryOnce('$.data[0, 1]')).to.deep.equal(['foo', 'bar']);
    data.setState(['baz', 'qux', 'quux']);
    expect(await store.queryOnce('$.data[0, 1]')).to.deep.equal(['baz', 'qux']);
  });

  it('should subscribe to a dynamic data source', function (done) {
    const data = new MockMetadataSource(['foo', 'bar', 'baz']);
    const store = new MetaStore({ data });
    const results: Json[] = [];
    store.subscribe('$.data[1]', (jsons) => {
      results.push(...jsons);
      if (results.length >= 3) {
        try {
          expect(results).to.deep.equal(['bar', 2, 'quux']);
        } catch (err) {
          done(err);
        }
        done();
      }
    });
    setImmediate(() => {
      data.setState([1, 2, 3]);
      setImmediate(() => {
        data.setState(['qux', 'quux', 'quuux']);
      });
    });
  });
});
