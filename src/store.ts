import produce, { Draft } from 'immer';
import flatMap from 'lodash.flatmap';
import last from 'lodash.last';
import sortedIndexBy from 'lodash.sortedindexby';
import { DataAction, mapActionToList } from './actions';
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
  JsonPathDataAction,
  splitIntoSingularPaths,
} from './jsonpath';
import {
  Cancelable,
  Failure,
  Json,
  PathArray,
  Timestamp,
  timestampToString,
  Uuid,
} from './types';

export const ZERO_UUID: Uuid = '00000000000000000000000000';
export const ZERO_TIMESTAMP: Timestamp = { author: ZERO_UUID, index: 0 };

export interface CausalTree {
  readonly timestamp: Timestamp;
}

export type Op = CausalTree & DataAction<CompiledJsonPath | CompiledJsonIdPath>;

export interface SavePoint extends IdMappedJson {
  readonly timestamp: Timestamp;
  readonly width: number;
}

interface State extends IdMappedJson {
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

export function timestampIndex(
  timestamp: Timestamp,
  ops: readonly { timestamp: Timestamp }[],
  expectMatch: boolean = false
): number {
  const i = sortedIndexBy(ops, { timestamp }, (x) =>
    timestampToString(x.timestamp)
  );
  if (
    !expectMatch ||
    (ops[i]?.timestamp?.author === timestamp.author &&
      ops[i]?.timestamp?.index === timestamp.index)
  ) {
    return i;
  }
  return -1;
}

export class Store {
  private state: State;
  private readonly uuid: Uuid;
  private nextIndex = 1;
  private queryListeners: QueryListener[] = [];

  constructor(public readonly saveState: SaveState) {
    let { uuid, ops, savePoints } = saveState.load();
    if (!savePoints.length) {
      const firstSavePoint = {
        root: {},
        idToPath: {},
        pathToId: { ids: [] },
        timestamp: ZERO_TIMESTAMP,
        width: MIN_SAVE_POINT_SIZE,
      };
      savePoints = [firstSavePoint];
      saveState.addSavePoint(firstSavePoint);
    }
    const savePoint = last(savePoints) as SavePoint;
    this.uuid = uuid;
    this.state = ops
      .slice(timestampIndex(savePoint.timestamp, ops, true))
      .reduce((state, op) => this.applyOp(op, SaveChanges.Never, state).state, {
        root: savePoint.root,
        idToPath: savePoint.idToPath,
        pathToId: savePoint.pathToId,
        ops,
        savePoints,
      });
  }

  dispatch(action: JsonPathDataAction): Failure[] {
    const processedActions = mapActionToList(
      compileJsonPathAction(action),
      (path) =>
        splitIntoSingularPaths(path).map((path) =>
          anchorPathToId(this.state, path)
        )
    );
    const ops: Op[] = processedActions.map((action) => {
      const timestamp: Timestamp = { author: this.uuid, index: this.nextIndex };
      this.nextIndex +=
        action.action === 'Transaction' ? action.payload.length : 1;
      return { ...action, timestamp };
    });
    return flatMap(ops, (op) => {
      const { state, changed, failures } = this.applyOp(
        op,
        SaveChanges.WhenChanged
      );
      if (changed.length) this.state = state;
      return failures;
    });
  }

  mergeOps(ops: Op[]): { changed: PathArray[]; failures: Failure[] } {
    if (!ops.length) return { changed: [], failures: [] };

    let earliestInsertionIndex = this.state.ops.length;
    const { ops: opsWithInsertions } = produce(this.state, (state) => {
      (ops as Draft<Op>[]).forEach((op) => {
        if (timestampIndex(op.timestamp, this.state.ops, true) >= 0) return;
        const index = timestampIndex(op.timestamp, state.ops);
        state.ops.splice(index, 0, op);
        earliestInsertionIndex = Math.min(earliestInsertionIndex, index);
      });
    });
    const earliestInsertionTimestamp = timestampToString(
      opsWithInsertions[earliestInsertionIndex].timestamp
    );

    let opIndexOfLastSavePoint: number = -1;
    let initialState = produce(this.state, (state) => {
      let indexOfLastSavePoint = -1;
      let lastSavePoint: Draft<SavePoint> | undefined;
      for (let i = state.savePoints.length - 1; i >= 0; i--) {
        if (
          timestampToString(state.savePoints[i].timestamp) <=
          earliestInsertionTimestamp
        ) {
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
      opIndexOfLastSavePoint = timestampIndex(
        lastSavePoint.timestamp,
        state.ops
      );
      state.root = lastSavePoint.root;
      state.idToPath = lastSavePoint.idToPath;
      state.pathToId = lastSavePoint.pathToId;
      state.savePoints = state.savePoints.slice(0, indexOfLastSavePoint);
      state.ops = state.ops.slice(0, opIndexOfLastSavePoint);
      this.saveState.deleteEverythingAfter(lastSavePoint.timestamp);
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
    let { actions, failures: totalFailures } = splitIntoActionsWithDirectPaths(
      op,
      state,
      op.timestamp
    );
    let totalChanged: PathArray[] = [];
    const directActions = flatMap(actions, (a) =>
      a.action === 'Transaction' ? a.payload : [a]
    );
    let newState = produce(state, (state) => {
      directActions.forEach((action) => {
        const result = applyIdMappedAction(action, state);
        if (result.failed) totalFailures.push(result.failure);
        else totalChanged.push(...result.changed);
      });
    });
    if (op.action === 'Transaction' && totalFailures.length) {
      totalChanged = [];
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
    return { state: newState, changed: totalChanged, failures: totalFailures };
  }

  private updateSavePoints({
    root,
    idToPath,
    pathToId,
    savePoints,
    ops,
  }: Draft<State>): boolean {
    if (
      ops.length < MIN_SAVE_POINT_SIZE ||
      timestampToString(ops[ops.length - MIN_SAVE_POINT_SIZE].timestamp) <=
        timestampToString(last(savePoints)?.timestamp || ZERO_TIMESTAMP)
    ) {
      return false;
    }
    for (let i = 2; i < savePoints.length; i++) {
      if (savePoints[i].width === savePoints[i - 2].width) {
        this.saveState.deleteSavePoint(savePoints[i - 1].timestamp);
        savePoints[i - 2].width *= 2;
        savePoints.splice(i - 1, 1);
        break;
      }
    }
    const timestamp = (last(ops) as Op).timestamp;
    savePoints.push({
      root,
      idToPath,
      pathToId,
      timestamp,
      width: MIN_SAVE_POINT_SIZE,
    });
    return true;
  }

  query(query: JsonPath, callback: (json: Json) => void): Cancelable {
    const path = compileJsonPath(query);
    const entry = { path, callback };
    this.queryListeners.push(entry);
    setImmediate(() => callback(queryValues(this.state, path)));
    return {
      cancel() {
        this.queryListeners = this.queryListeners.filter((x) => x !== entry);
      },
    };
  }

  queryOnce(query: JsonPath): Json[] {
    return queryValues(this.state, compileJsonPath(query));
  }

  get ops(): readonly Op[] {
    return this.state.ops;
  }

  get savePoints(): readonly SavePoint[] {
    return this.state.savePoints;
  }
}

export interface SaveState {
  load(): {
    readonly uuid: Uuid;
    readonly ops: readonly Op[];
    readonly savePoints: readonly SavePoint[];
  };
  addOp(op: Op);
  addSavePoint(savePoint: SavePoint);
  deleteSavePoint(at: Timestamp);
  deleteEverythingAfter(exclusiveLowerBound: Timestamp);
}
