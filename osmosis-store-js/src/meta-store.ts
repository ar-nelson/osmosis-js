import {
  BinaryPath,
  binaryPathToArray,
  EMPTY_PATH,
  pathArrayToBinary,
} from './binary-path';
import { AnonymousJsonSource, JsonNode, JsonSource } from './json-source';
import {
  compileJsonPath,
  JsonPath,
  queryPaths1,
  queryValues,
  Vars,
} from './jsonpath';
import Queryable from './queryable';
import { Cancelable, Json } from './types';

export interface MetadataSource extends JsonSource {
  subscribe(listener: () => void): Cancelable;
}

export class MetaStore extends AnonymousJsonSource implements Queryable {
  constructor(private readonly sources: Record<string, MetadataSource>) {
    super();
  }

  subscribe(
    query: JsonPath,
    vars: Vars,
    callback: (json: Json) => void
  ): Cancelable;

  subscribe(query: JsonPath, callback: (json: Json[]) => void): Cancelable;

  subscribe(
    query: JsonPath,
    arg1: Vars | ((json: Json) => void),
    arg2?: (json: Json) => void
  ): Cancelable {
    const path = compileJsonPath(query, typeof arg1 === 'function' ? {} : arg1);
    const callback =
      typeof arg1 === 'function' ? arg1 : (arg2 as (json: Json) => void);
    const onUpdate = async () => callback(await queryValues(path, this));
    const subscriptions = (async () => {
      const sourcePaths = path.length
        ? [
            ...new Set(
              (await queryPaths1(this, path[0], EMPTY_PATH)).existing.map(
                (p) => binaryPathToArray(p)[0]
              )
            ),
          ]
        : Object.keys(this.sources);
      return sourcePaths.map((key) => this.sources[key].subscribe(onUpdate));
    })();
    setImmediate(onUpdate);
    return {
      cancel() {
        subscriptions.then((s) => s.forEach((c) => c.cancel()));
      },
    };
  }

  async queryOnce(query: JsonPath, vars: Vars = {}): Promise<Json[]> {
    return queryValues(compileJsonPath(query, vars), this);
  }

  async getByPath(path: BinaryPath): Promise<JsonNode | undefined> {
    if (!path.byteLength) {
      return { type: 'object', keys: Object.keys(this.sources) };
    }
    const [head, ...subpath] = binaryPathToArray(path);
    return this.sources[head]?.getByPath(pathArrayToBinary(subpath));
  }
}
