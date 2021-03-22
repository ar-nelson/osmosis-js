import Monocypher from 'monocypher-wasm';
import { actionToChanges, applyChange, Change } from './actions';
import { BinaryPath } from './binary-path';
import {
  CausalTree,
  Id,
  idCompare,
  idIndex,
  idToString,
  nextStateHash,
  ZERO_ID,
  ZERO_STATE_HASH,
} from './id';
import { JsonNode } from './json-source';
import OverlayJsonSource, { SerializedJsonSource } from './overlay-json-source';
import { Op, SavePoint, SaveState, StateSummary } from './save-state';
import { Failure } from './types';
import { isEqual, last, reduceAsync } from './utils';

const MIN_SAVE_POINT_SIZE = 4;

function idIndexAfter(id: Id, ops: readonly CausalTree[]): number {
  const i = idIndex(id, ops);
  if (idCompare(ops[i].id, id) === 0) {
    return i + i;
  }
  return i;
}

export interface SerializedSavePoint
  extends Readonly<SerializedJsonSource>,
    StateSummary {
  readonly width: number;
  readonly id: Id;
  readonly ops: readonly Op[];
  readonly failures: readonly (Failure & CausalTree)[];
}

export interface SerializedSaveState<Metadata>
  extends Readonly<SerializedJsonSource>,
    StateSummary {
  readonly savePoints: readonly SerializedSavePoint[];
  readonly ops: readonly Op[];
  readonly failures: readonly (Failure & CausalTree)[];
  readonly metadata: Metadata;
}

export default class InMemorySaveState<Metadata> extends SaveState<Metadata> {
  protected data: OverlayJsonSource;
  protected _ops: Op[];
  protected _failures: (Failure & CausalTree)[];
  protected _savePoints: (SavePoint & { data: OverlayJsonSource })[];
  protected _stateSummary: StateSummary;
  protected _metadata: Promise<Metadata>;
  private onInitMetadata?: (metadata: Metadata) => void;

  constructor(args: Partial<SerializedSaveState<Metadata>> = {}) {
    super();
    const { savePoints, ops, failures } = (args.savePoints ?? []).reduce(
      ({ savePoints, ops, failures }, savePoint) => {
        const data = new OverlayJsonSource(last(savePoints)?.data);
        data.deserialize(savePoint);
        const { hash, latestIndexes, width, id } = savePoint;
        return {
          savePoints: [...savePoints, { data, hash, latestIndexes, width, id }],
          ops: [...ops, ...savePoint.ops],
          failures: [...failures, ...savePoint.failures],
        };
      },
      {
        savePoints: [] as (SavePoint & { data: OverlayJsonSource })[],
        ops: [] as Op[],
        failures: [] as (Failure & CausalTree)[],
      }
    );
    this._savePoints = savePoints.length
      ? savePoints
      : [
          {
            data: new OverlayJsonSource(),
            id: ZERO_ID,
            width: MIN_SAVE_POINT_SIZE,
            hash: ZERO_STATE_HASH,
            latestIndexes: {},
          },
        ];
    this._ops = [...ops, ...(args.ops ?? [])];
    this._failures = [...failures, ...(args.failures ?? [])];
    if ('metadata' in args) {
      this._metadata = Promise.resolve(args.metadata as Metadata);
    } else {
      this._metadata = new Promise((resolve) => {
        this.onInitMetadata = resolve;
      });
    }
    this.data = new OverlayJsonSource(last(savePoints)?.data);
    if (args.pathToValue && args.pathToIds && args.idToPath) {
      this.data.deserialize(args as SerializedJsonSource);
    }
    if (args.hash && args.latestIndexes) {
      this._stateSummary = {
        hash: args.hash,
        latestIndexes: args.latestIndexes,
      };
    } else {
      this._stateSummary = { hash: ZERO_STATE_HASH, latestIndexes: {} };
    }
  }

  getByPath(path: BinaryPath): Promise<JsonNode | undefined> {
    return this.data.getByPath(path);
  }
  getById(id: Id): Promise<JsonNode | undefined> {
    return this.data.getById(id);
  }
  getPathById(id: Id): Promise<BinaryPath | undefined> {
    return this.data.getPathById(id);
  }
  getIdsByPath(path: BinaryPath): Promise<Id[]> {
    return this.data.getIdsByPath(path);
  }
  getIdsAfter(
    id: Id
  ): Promise<Iterable<{ readonly id: Id; readonly path: BinaryPath }>> {
    return this.data.getIdsAfter(id);
  }

  protected savePointAdded(
    savePoint: SavePoint & { data: OverlayJsonSource }
  ): void {
    // override point
  }

  protected savePointUpdated(
    savePoint: SavePoint & { data: OverlayJsonSource }
  ): void {
    // override point
  }

  protected savePointDeleted(id: Id): void {
    // override point
  }

  async insert(
    ops: Op[]
  ): Promise<{
    changes: readonly Change[];
    failures: readonly Failure[];
  }> {
    ops = ops
      .filter(({ id }) => idIndex(id, this._ops, true) < 0)
      .sort((x, y) => idCompare(x.id, y.id));
    if (!ops.length) {
      return { changes: [], failures: [] };
    }

    const changes: Change[] = [];
    const failures: Failure[] = [];
    if (idCompare(last(this._ops)?.id || ZERO_ID, ops[0].id) >= 0) {
      const opsAfterInsert = await this.rewind(ops[0].id);
      for (const op of opsAfterInsert) {
        while (ops.length && idCompare(ops[0].id, op.id) < 0) {
          const nextResult = await this.applyOp(ops.shift() as Op);
          changes.push(...nextResult.changes);
          failures.push(...nextResult.failures);
        }
        const nextResult = await this.applyOp(op);
        changes.push(...nextResult.changes);
      }
    }
    for (const op of ops) {
      const nextResult = await this.applyOp(op);
      changes.push(...nextResult.changes);
      failures.push(...nextResult.failures);
    }
    return { changes, failures };
  }

  protected async applyOp(
    op: Op
  ): Promise<{
    changes: readonly Change[];
    failures: readonly (Failure & CausalTree)[];
  }> {
    await Monocypher.ready;
    const { changes, failures, index } = await actionToChanges(
      op,
      op.id,
      this.data
    );
    this._ops.push(op);
    this._failures.push(...failures);
    this._stateSummary = {
      hash: nextStateHash(this._stateSummary.hash, op.id),
      latestIndexes: {
        ...this._stateSummary.latestIndexes,
        [op.id.author]: index,
      },
    };
    for (const change of changes) {
      await applyChange(change, change.id, this.data);
    }
    this.updateSavePoints();
    return { changes, failures };
  }

  protected updateSavePoints():
    | (SavePoint & { data: OverlayJsonSource })
    | undefined {
    if (
      this._ops.length < MIN_SAVE_POINT_SIZE ||
      idCompare(
        this._ops[this._ops.length - MIN_SAVE_POINT_SIZE].id,
        last(this._savePoints)?.id || ZERO_ID
      ) <= 0
    ) {
      return;
    }
    const newSavePoint = {
      data: this.data,
      id: (last(this._ops) as Op).id,
      width: MIN_SAVE_POINT_SIZE,
      ...this._stateSummary,
    };
    this._savePoints.push(newSavePoint);
    this.savePointAdded(newSavePoint);
    this.data = new OverlayJsonSource(this.data);
    let repeat = true;
    while (repeat) {
      repeat = false;
      for (let i = this._savePoints.length - 4; i >= 0; i--) {
        if (this._savePoints[i].width === this._savePoints[i + 2].width) {
          this.removeSavePointAfter(i);
          repeat = true;
          break;
        }
      }
    }
    return newSavePoint;
  }

  protected removeSavePointAfter(
    index: number
  ): SavePoint & { data: OverlayJsonSource } {
    const [before, removed, merged] = this._savePoints.slice(index, index + 3);
    removed.data.mergeChild(merged.data);
    const newBefore = {
      ...before,
      width: before.width * 2,
    };
    const newMerged = {
      ...merged,
      data: removed.data,
    };
    if (index + 3 < this._savePoints.length) {
      this._savePoints[index + 3].data.parent = newMerged.data;
    } else {
      this.data.parent = newMerged.data;
    }
    this._savePoints.splice(index, 3, newBefore, newMerged);
    this.savePointDeleted(removed.id);
    this.savePointUpdated(newBefore);
    this.savePointUpdated(newMerged);
    return newMerged;
  }

  async opsRange(
    earliestId: Id | null,
    latestId: Id | null
  ): Promise<readonly Op[]> {
    return this._ops.slice(
      earliestId ? idIndex(earliestId, this._ops) : 0,
      latestId ? idIndexAfter(latestId, this._ops) : undefined
    );
  }

  async failuresRange(
    earliestId: Id | null,
    latestId: Id | null
  ): Promise<readonly (Failure & CausalTree)[]> {
    return this._failures.slice(
      earliestId ? idIndex(earliestId, this._failures) : 0,
      latestId ? idIndexAfter(latestId, this._failures) : undefined
    );
  }

  async garbageCollect(earliestId: Id): Promise<void> {
    await Monocypher.ready;
    const savePointIndex = idIndex(earliestId, this._savePoints);
    const fromSavePoint = this._savePoints[savePointIndex];
    const matchesSavePoint = idCompare(earliestId, fromSavePoint.id) === 0;
    const earliestSavePoint = matchesSavePoint
      ? fromSavePoint
      : this._savePoints[savePointIndex + 1];
    let newSavePoints = this._savePoints.slice(savePointIndex);
    const newData = this.savePoints[0].data;
    this._savePoints
      .slice(0, savePointIndex)
      .forEach((sp) => newData.mergeChild(sp.data));
    if (!matchesSavePoint) {
      const newBase: SavePoint & {
        data: OverlayJsonSource;
      } = await reduceAsync(
        await this.opsRange(fromSavePoint.id, earliestId),
        fromSavePoint,
        async (savePoint, op) => {
          const { changes, index } = await actionToChanges(
            op,
            op.id,
            savePoint.data
          );
          for (const change of changes) {
            await applyChange(change, change.id, savePoint.data);
          }
          return {
            ...fromSavePoint,
            id: op.id,
            width: fromSavePoint.width - 1,
            hash: nextStateHash(fromSavePoint.hash, op.id),
            latestIndexes: {
              ...fromSavePoint.latestIndexes,
              [op.id.author]: index,
            },
          };
        }
      );
      newSavePoints = [newBase, ...newSavePoints];
    }
    (this._ops = earliestSavePoint
      ? this._ops.slice(idIndexAfter(earliestSavePoint.id, this._ops))
      : []),
      (this._failures = earliestSavePoint
        ? this._failures.slice(
            idIndexAfter(earliestSavePoint.id, this._failures)
          )
        : []),
      (this._savePoints = newSavePoints);
  }

  async rewind(latestId: Id): Promise<readonly Op[]> {
    for (let i = this._savePoints.length - 1; i >= 0; i--) {
      const savePoint = this._savePoints[i];
      if (idCompare(savePoint.id, latestId) <= 0) {
        const failureRewindIndex = idIndex(latestId, this._failures);
        let rewindIndex = idIndex(latestId, this._ops);
        if (isEqual(this._ops[rewindIndex].id, latestId)) {
          rewindIndex++;
        }
        const savePointIndex = idIndex(savePoint.id, this._ops, true) + 1;
        const droppedOps = this._ops.slice(rewindIndex);
        const appliedOps = this._ops.slice(savePointIndex, rewindIndex);
        this._ops = this._ops.slice(0, savePointIndex);
        this._failures = this._failures.slice(0, failureRewindIndex);
        this._savePoints = this._savePoints.slice(0, i + 1);
        this.data = new OverlayJsonSource(savePoint.data);
        const { hash, latestIndexes } = savePoint;
        this._stateSummary = { hash, latestIndexes };
        for (const op of appliedOps) {
          await this.applyOp(op);
        }
        return droppedOps;
      }
    }
    throw new Error(
      `Cannot rewind to ID ${idToString(
        latestId
      )}. This is earlier than the oldest ID in this store's history.`
    );
  }

  get savePoints(): Promise<readonly SavePoint[]> {
    return Promise.resolve(
      this._savePoints.map(({ id, hash, width, latestIndexes }) => ({
        id,
        hash,
        width,
        latestIndexes,
      }))
    );
  }

  get metadata(): Promise<Metadata> {
    return Promise.resolve(this._metadata);
  }

  async setMetadata(metadata: Metadata): Promise<void> {
    if (this.onInitMetadata) {
      this.onInitMetadata(metadata);
      delete this.onInitMetadata;
    } else {
      this._metadata = Promise.resolve(metadata);
    }
  }

  async initMetadata(initializer: () => Promise<Metadata>): Promise<void> {
    if (this.onInitMetadata) {
      this.onInitMetadata(await initializer());
      delete this.onInitMetadata;
    }
  }

  get stateSummary(): Promise<StateSummary> {
    return Promise.resolve(this._stateSummary);
  }
}
