import produce, { Draft } from 'immer';
import flatMap from 'lodash.flatmap';
import last from 'lodash.last';
import { Action, mapActionToList } from './actions';
import Dispatchable from './dispatchable';
import {
  CausalTree,
  Id,
  idIndex,
  idToString,
  nextStateHash,
  Uuid,
  ZERO_ID,
  ZERO_STATE_HASH,
} from './id';
import {
  anchorPathToId,
  applyIdMappedAction,
  IdMappedJson,
  queryValues,
  splitIntoActionsWithDirectPaths,
} from './id-mapped-json';
import {
  CompiledJsonIdPath,
  CompiledJsonPath,
  compileJsonPath,
  compileJsonPathAction,
  JsonPath,
  JsonPathAction,
  splitIntoSingularPaths,
  Vars,
} from './jsonpath';
import Queryable from './queryable';
import {
  Cancelable,
  Failure,
  Json,
  OsmosisFailureError,
  PathArray,
} from './types';

export type Op = CausalTree & Action<CompiledJsonPath | CompiledJsonIdPath>;

export interface StateSummary {
  readonly hash: Uint8Array;
  readonly latestIndexes: { readonly [peerId: string]: number };
}

export interface SavePoint extends IdMappedJson, StateSummary {
  readonly id: Id;
  readonly width: number;
}

interface State extends IdMappedJson, StateSummary {
  readonly ops: readonly Op[];
  readonly savePoints: readonly SavePoint[];
}

interface QueryListener {
  readonly path: CompiledJsonPath;
  readonly callback: (results: Json[]) => void;
}

enum SaveChanges {
  Always,
  WhenChanged,
  Never,
}

const MIN_SAVE_POINT_SIZE = 4;

export class Store implements Dispatchable<JsonPathAction>, Queryable {
  private state: State;
  private readonly uuid: Uuid;
  private nextIndex = 1;
  private queryListeners: QueryListener[] = [];

  constructor(public readonly saveState: SaveState) {
    // eslint-disable-next-line prefer-const
    let { uuid, ops, savePoints } = saveState.load();
    if (!savePoints.length) {
      const firstSavePoint = {
        root: {},
        idToPath: {},
        pathToId: { ids: [] },
        id: ZERO_ID,
        width: MIN_SAVE_POINT_SIZE,
        hash: ZERO_STATE_HASH,
        latestIndexes: {},
      };
      savePoints = [firstSavePoint];
      saveState.addSavePoint(firstSavePoint);
    }
    const savePoint = last(savePoints) as SavePoint;
    this.uuid = uuid;
    this.state = ops
      .slice(idIndex(savePoint.id, ops, true))
      .reduce((state, op) => this.applyOp(op, SaveChanges.Never, state).state, {
        root: savePoint.root,
        idToPath: savePoint.idToPath,
        pathToId: savePoint.pathToId,
        ops,
        savePoints,
        hash: ZERO_STATE_HASH,
        latestIndexes: {},
      });
  }

  dispatch(action: JsonPathAction, returnFailures: true): Failure[];
  dispatch(action: JsonPathAction, returnFailures?: boolean): void;

  dispatch(
    action: JsonPathAction,
    returnFailures = false
  ): Failure[] | undefined {
    const processedActions = mapActionToList(
      compileJsonPathAction(action),
      (path) =>
        splitIntoSingularPaths(path).map((path) =>
          anchorPathToId(this.state, path)
        )
    );
    const ops: Op[] = processedActions.map((action) => {
      const id: Id = { author: this.uuid, index: this.nextIndex };
      this.nextIndex +=
        action.action === 'Transaction' ? action.payload.length : 1;
      return { ...action, id };
    });
    const failures = flatMap(ops, (op) => {
      const { state, changed, failures } = this.applyOp(
        op,
        SaveChanges.WhenChanged
      );
      if (changed.length) {
        this.state = state;
      }
      return failures;
    });
    if (returnFailures) {
      return failures;
    } else if (failures.length) {
      throw new OsmosisFailureError(
        `dispatching action ${JSON.stringify(action)}`,
        failures
      );
    }
  }

  mergeOps(ops: Op[]): { changed: PathArray[]; failures: Failure[] } {
    if (!ops.length) {
      return { changed: [], failures: [] };
    }

    let earliestInsertionIndex = this.state.ops.length;
    const { ops: opsWithInsertions } = produce(this.state, (state) => {
      (ops as Draft<Op>[]).forEach((op) => {
        if (idIndex(op.id, this.state.ops, true) >= 0) {
          return;
        }
        const index = idIndex(op.id, state.ops);
        state.ops.splice(index, 0, op);
        earliestInsertionIndex = Math.min(earliestInsertionIndex, index);
      });
    });
    const earliestInsertionTimestamp = idToString(
      opsWithInsertions[earliestInsertionIndex].id
    );

    let opIndexOfLastSavePoint = -1;
    const initialState = produce(this.state, (state) => {
      let indexOfLastSavePoint = -1;
      let lastSavePoint: Draft<SavePoint> | undefined;
      for (let i = state.savePoints.length - 1; i >= 0; i--) {
        if (idToString(state.savePoints[i].id) <= earliestInsertionTimestamp) {
          lastSavePoint = state.savePoints[i];
          indexOfLastSavePoint = i;
          break;
        }
      }
      if (!lastSavePoint) {
        throw new Error(
          `FATAL: No save point before ${earliestInsertionTimestamp}. Cannot apply new ops.`
        );
      }
      opIndexOfLastSavePoint = idIndex(lastSavePoint.id, state.ops);
      state.root = lastSavePoint.root;
      state.idToPath = lastSavePoint.idToPath;
      state.pathToId = lastSavePoint.pathToId;
      state.savePoints = state.savePoints.slice(0, indexOfLastSavePoint);
      state.ops = state.ops.slice(0, opIndexOfLastSavePoint);
      state.hash = lastSavePoint.hash;
      state.latestIndexes = lastSavePoint.latestIndexes;
      this.saveState.deleteEverythingAfter(lastSavePoint.id);
    });

    const totalChanged: PathArray[] = [];
    const totalFailures: Failure[] = [];

    this.state = opsWithInsertions
      .slice(opIndexOfLastSavePoint)
      .reduce((lastState, op) => {
        const { state, changed, failures } = this.applyOp(
          op,
          SaveChanges.Always,
          lastState
        );
        totalChanged.push(...changed);
        totalFailures.push(...failures);
        return state;
      }, initialState);

    return { changed: totalChanged, failures: totalFailures };
  }

  private applyOp(
    op: Op,
    saveChanges: SaveChanges,
    state: State = this.state
  ): { state: State; changed: PathArray[]; failures: Failure[] } {
    const {
      actions,
      failures: totalFailures,
    } = splitIntoActionsWithDirectPaths(op, state, op.id);
    let totalChanged: PathArray[] = [];
    const directActions = flatMap(actions, (a) =>
      a.action === 'Transaction' ? a.payload : [a]
    );
    let newState = produce(state, (state) => {
      state.hash = nextStateHash(state.hash as Uint8Array, op.id);
      state.latestIndexes[op.id.author] = Math.max(
        state.latestIndexes[op.id.author] || 0,
        op.id.index
      );
      directActions.forEach((action) => {
        const result = applyIdMappedAction(action, state);
        if (result.failed) {
          totalFailures.push(result.failure);
        } else {
          totalChanged.push(...result.changed);
        }
      });
    });
    if (op.action === 'Transaction' && totalFailures.length) {
      totalChanged = [];
      // FIXME: We can't drop failed transactions completely.
      // This would cause hashes to not line up, because an op would be missing.
      // Undo the changes to the JSON state, but not the op list or hash.
      newState = state;
    }
    if (
      saveChanges === SaveChanges.Always ||
      (totalChanged.length && saveChanges === SaveChanges.WhenChanged)
    ) {
      let addedSavePoint = false;
      newState = produce(newState, (state) => {
        state.ops.push(op as Draft<Op>);
        addedSavePoint = this.updateSavePoints(state);
      });
      this.saveState.addOp(op);
      if (addedSavePoint) {
        this.saveState.addSavePoint(last(newState.savePoints) as SavePoint);
      }
    }
    this.nextIndex = Math.max(this.nextIndex, op.id.index + 1);
    return { state: newState, changed: totalChanged, failures: totalFailures };
  }

  private updateSavePoints({
    root,
    idToPath,
    pathToId,
    savePoints,
    ops,
    hash,
    latestIndexes,
  }: Draft<State>): boolean {
    if (
      ops.length < MIN_SAVE_POINT_SIZE ||
      idToString(ops[ops.length - MIN_SAVE_POINT_SIZE].id) <=
        idToString(last(savePoints)?.id || ZERO_ID)
    ) {
      return false;
    }
    for (let i = 2; i < savePoints.length; i++) {
      if (savePoints[i].width === savePoints[i - 2].width) {
        this.saveState.deleteSavePoint(savePoints[i - 1].id);
        savePoints[i - 2].width *= 2;
        savePoints.splice(i - 1, 1);
        break;
      }
    }
    const id = (last(ops) as Op).id;
    savePoints.push({
      root,
      idToPath,
      pathToId,
      id,
      width: MIN_SAVE_POINT_SIZE,
      hash,
      latestIndexes,
    });
    return true;
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
    const entry = { path, callback };
    this.queryListeners.push(entry);
    setImmediate(() => callback(queryValues(this.state, path)));
    return {
      cancel() {
        this.queryListeners = this.queryListeners.filter((x) => x !== entry);
      },
    };
  }

  queryOnce(query: JsonPath, vars: Vars = {}): Json[] {
    return queryValues(this.state, compileJsonPath(query, vars));
  }

  get ops(): readonly Op[] {
    return this.state.ops;
  }

  get savePoints(): readonly SavePoint[] {
    return this.state.savePoints;
  }

  get stateSummary(): StateSummary {
    return {
      hash: this.state.hash,
      latestIndexes: this.state.latestIndexes,
    };
  }
}

export interface SaveState {
  load(): {
    readonly uuid: Uuid;
    readonly ops: readonly Op[];
    readonly savePoints: readonly SavePoint[];
  };
  addOp(op: Op): void;
  addSavePoint(savePoint: SavePoint): void;
  deleteSavePoint(at: Id): void;
  deleteEverythingAfter(exclusiveLowerBound: Id): void;
}
