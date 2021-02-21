import { Change, mapActionToList } from './actions';
import { Id, Uuid } from './id';
import { toJsonWithAdapter } from './json-adapter';
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
import { Cancelable, Failure, Json } from './types';
import { flatMap } from './utils';

interface QueryListener {
  readonly path: CompiledJsonPath;
  readonly callback: (results: Json[]) => void;
}

export default class Store implements Queryable {
  private readonly cache: JsonCache;
  private readonly uuid: Promise<Uuid>;
  private nextIndex;
  private queryListeners: QueryListener[] = [];

  constructor(public readonly saveState: SaveState<{ readonly peerId: Uuid }>) {
    this.cache = new JsonCache(saveState);
    this.uuid = saveState.metadata.then((x) => x.peerId);
    saveState.stateSummary.then(({ latestIndexes }) => {
      this.nextIndex =
        [...Object.values(latestIndexes)].reduce((x, y) => Math.max(x, y), 0) +
        1;
    });
  }

  async dispatch(
    action: JsonPathAction
  ): Promise<{
    failures: readonly Failure[];
    ops: readonly Op[];
  }> {
    const processedActions = await mapActionToList(
      compileJsonPathAction(action),
      (path) =>
        Promise.all(
          splitIntoSingularPaths(path).map((path) =>
            this.cache.anchorPathToId(path)
          )
        )
    );
    const ops = [] as Op[];
    for (const action of processedActions) {
      const id: Id = { author: await this.uuid, index: this.nextIndex };
      this.nextIndex +=
        action.action === 'Transaction' ? action.payload.length : 1;
      ops.push({ ...action, id });
    }
    const { failures } = await this.mergeOps(ops);
    return { failures, ops };
  }

  async mergeOps(
    ops: readonly Op[]
  ): Promise<{ changes: readonly Change[]; failures: readonly Failure[] }> {
    const { changes, failures } = await this.saveState.insert(ops);
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
          await Promise.all(
            (await this.cache.queryValues(listener.path)).map((j) =>
              toJsonWithAdapter(j, JsonCacheAdapter)
            )
          )
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
    setImmediate(async () =>
      callback(
        await Promise.all(
          (await this.cache.queryValues(path)).map((j) =>
            toJsonWithAdapter(j, JsonCacheAdapter)
          )
        )
      )
    );
    return {
      cancel() {
        this.queryListeners = this.queryListeners.filter((x) => x !== entry);
      },
    };
  }

  async queryOnce(query: JsonPath, vars: Vars = {}): Promise<Json[]> {
    return Promise.all(
      (await this.cache.queryValues(compileJsonPath(query, vars))).map((j) =>
        toJsonWithAdapter(j, JsonCacheAdapter)
      )
    );
  }

  opsRange(earliestId: Id | null, latestId: Id | null): Promise<readonly Op[]> {
    return this.saveState.opsRange(earliestId, latestId);
  }

  failuresRange(
    earliestId: Id | null,
    latestId: Id | null
  ): Promise<readonly Failure[]> {
    return this.saveState.failuresRange(earliestId, latestId);
  }

  get ops(): Promise<readonly Op[]> {
    return this.saveState.ops;
  }

  get failures(): Promise<readonly Failure[]> {
    return this.saveState.failures;
  }

  get savePoints(): Promise<readonly SavePoint[]> {
    return this.saveState.savePoints;
  }

  get stateSummary(): Promise<StateSummary> {
    return this.saveState.stateSummary;
  }
}
