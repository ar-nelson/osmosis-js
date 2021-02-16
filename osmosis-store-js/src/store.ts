import flatMap from 'lodash.flatmap';
import { mapActionToList, Change } from './actions';
import Dispatchable from './dispatchable';
import { Id, Uuid } from './id';
import { JsonCache, JsonCacheAdapter } from './json-cache';
import {
  canMatchAbsolutePath,
  CompiledJsonPath,
  compileJsonPath,
  compileJsonPathAction,
  JsonPath,
  JsonPathAction,
  splitIntoSingularPaths,
  Vars,
} from './jsonpath';
import Queryable from './queryable';
import { Op, SavePoint, SaveState, StateSummary } from './save-state';
import { Cancelable, Failure, Json, OsmosisFailureError } from './types';

interface QueryListener {
  readonly path: CompiledJsonPath;
  readonly callback: (results: Json[]) => void;
}

export default class Store implements Dispatchable<JsonPathAction>, Queryable {
  private readonly cache: JsonCache;
  private readonly uuid: Uuid;
  private nextIndex;
  private queryListeners: QueryListener[] = [];

  constructor(public readonly saveState: SaveState<{ uuid: Uuid }>) {
    this.cache = new JsonCache(saveState);
    this.uuid = saveState.metadata().uuid;
    this.nextIndex =
      [...Object.values(saveState.stateSummary)].reduce(
        (x, y) => Math.max(x, y),
        0
      ) + 1;
  }

  dispatch(action: JsonPathAction, returnFailures: true): Failure[];
  dispatch(action: JsonPathAction, returnFailures?: boolean): void;

  dispatch(
    action: JsonPathAction,
    returnFailures = false
  ): readonly Failure[] | undefined {
    const processedActions = mapActionToList(
      compileJsonPathAction(action),
      (path) =>
        splitIntoSingularPaths(path).map((path) =>
          this.cache.anchorPathToId(path)
        )
    );
    const ops: Op[] = processedActions.map((action) => {
      const id: Id = { author: this.uuid, index: this.nextIndex };
      this.nextIndex +=
        action.action === 'Transaction' ? action.payload.length : 1;
      return { ...action, id };
    });
    const { failures } = this.mergeOps(ops);
    if (returnFailures) {
      return failures;
    } else if (failures.length) {
      throw new OsmosisFailureError(
        `dispatching action ${JSON.stringify(action)}`,
        failures
      );
    }
  }

  mergeOps(
    ops: Op[]
  ): { changes: readonly Change[]; failures: readonly Failure[] } {
    const { changes, failures } = this.saveState.insert(ops);
    const changedPaths = flatMap(changes, (change) => {
      switch (change.type) {
        case 'Put':
        case 'Delete':
          return [change.path];
        case 'Move':
          return [change.from, change.to];
        default:
          return [];
      }
    });
    changedPaths.forEach((path) => this.cache.expirePath(path));
    for (const listener of this.queryListeners) {
      if (changedPaths.some((p) => canMatchAbsolutePath(listener.path, p))) {
        listener.callback(
          this.cache.queryValues(listener.path).map(JsonCacheAdapter.toJson)
        );
      }
    }
    return { changes, failures };
  }

  subscribe(
    query: JsonPath,
    vars: Vars,
    callback: (json: Json) => void
  ): Cancelable;

  subscribe(query: JsonPath, callback: (json: Json[]) => void): Cancelable;

  subscribe(
    query: JsonPath,
    arg1: Vars | ((json: Json[]) => void),
    arg2?: (json: Json) => void
  ): Cancelable {
    const path = compileJsonPath(query, typeof arg1 === 'object' ? arg1 : {});
    const callback =
      typeof arg1 === 'function' ? arg1 : (arg2 as (json: Json) => void);
    const entry = { path, callback };
    this.queryListeners.push(entry);
    setImmediate(() =>
      callback(this.cache.queryValues(path).map(JsonCacheAdapter.toJson))
    );
    return {
      cancel() {
        this.queryListeners = this.queryListeners.filter((x) => x !== entry);
      },
    };
  }

  queryOnce(query: JsonPath, vars: Vars = {}): Json[] {
    return this.cache
      .queryValues(compileJsonPath(query, vars))
      .map(JsonCacheAdapter.toJson);
  }

  get ops(): readonly Op[] {
    return this.saveState.ops();
  }

  get savePoints(): readonly SavePoint[] {
    return this.saveState.savePoints();
  }

  get stateSummary(): StateSummary {
    return this.saveState.stateSummary();
  }
}
