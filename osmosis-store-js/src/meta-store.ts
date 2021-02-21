import { JsonJsonAdapter } from './json-adapter';
import { compileJsonPath, JsonPath, queryValues, Vars } from './jsonpath';
import Queryable from './queryable';
import { Cancelable, Json, JsonObject } from './types';

export interface MetadataSource {
  readonly initialState: Json;
  subscribe(listener: (json: Json) => void): void;
  unsubscribe(listener: (json: Json) => void): void;
}

export class MetaStore implements Queryable {
  private state: JsonObject;

  constructor(private readonly sources: Record<string, MetadataSource>) {
    this.state = {};
    for (const key in sources) {
      if (Object.prototype.hasOwnProperty.call(sources, key)) {
        this.state = { ...this.state, [key]: sources[key].initialState };
        sources[key].subscribe((json) => {
          this.state = { ...this.state, [key]: json };
        });
      }
    }
  }

  subscribe(
    query: JsonPath,
    vars: Vars,
    callback: (json: Json) => void
  ): Cancelable;

  subscribe(query: JsonPath, callback: (json: Json[]) => void): Cancelable;

  subscribe(
    query: JsonPath,
    arg1: any,
    arg2?: (json: Json) => void
  ): Cancelable {
    const path = compileJsonPath(query, arg2 ? arg1 : {});
    const callback = arg2 || arg1;
    let keys: readonly string[] = Object.keys(this.sources);
    switch (path[0]?.type) {
      case 'Key':
        keys = [path[0].query];
        break;
      case 'MultiKey':
        keys = path[0].query;
        break;
      case 'Index':
      case 'MultiIndex':
      case 'Slice':
      case 'ExprSlice':
        keys = [];
        break;
    }
    const handlers = keys.map((key) => async (json: Json) =>
      callback(
        await queryValues(path, { ...this.state, [key]: json }, JsonJsonAdapter)
      )
    );
    for (let i = 0; i < keys.length; i++) {
      this.sources[keys[i]].subscribe(handlers[i]);
    }
    setImmediate(async () =>
      callback(await queryValues(path, this.state, JsonJsonAdapter))
    );
    return {
      cancel() {
        for (let i = 0; i < keys.length; i++) {
          this.sources[keys[i]].unsubscribe(handlers[i]);
        }
      },
    };
  }

  async queryOnce(query: JsonPath, vars: Vars = {}): Promise<Json[]> {
    return queryValues(
      compileJsonPath(query, vars),
      this.state,
      JsonJsonAdapter
    );
  }
}

export class ConstantMetadataSource implements MetadataSource {
  constructor(readonly initialState: Json) {}

  subscribe(listener: (json: Json) => void): void {
    listener(this.initialState);
  }

  unsubscribe(): void {
    // do nothing
  }
}
