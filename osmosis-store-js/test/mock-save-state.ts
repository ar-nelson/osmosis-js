import produce, { Draft } from 'immer';
import { Id, idIndex, Uuid } from '../src/id';
import { Op, SavePoint, SaveState } from '../src/store';

interface SaveFile {
  readonly uuid: Uuid;
  readonly ops: readonly Op[];
  readonly savePoints: readonly SavePoint[];
}

export default class MockSaveState implements SaveState {
  private saveFile: SaveFile;

  constructor(uuid: Uuid) {
    this.saveFile = {
      uuid,
      ops: [],
      savePoints: [],
    };
  }

  load(): SaveFile {
    return this.saveFile;
  }

  addOp(op: Op): void {
    this.saveFile = produce(this.saveFile, ({ ops }) => {
      ops.push(op as Draft<Op>);
    });
  }

  addSavePoint(savePoint: SavePoint): void {
    this.saveFile = produce(this.saveFile, ({ savePoints }) => {
      savePoints.push(savePoint as Draft<SavePoint>);
    });
  }

  deleteSavePoint(at: Id): void {
    this.saveFile = produce(this.saveFile, ({ savePoints }) => {
      const i = idIndex(at, savePoints);
      if (i > 0) {
        savePoints.splice(i, 1);
      }
    });
  }

  deleteEverythingAfter(exclusiveLowerBound: Id): void {
    const newFile = produce(this.saveFile, ({ savePoints, ops }) => {
      const i = idIndex(exclusiveLowerBound, savePoints);
      savePoints.splice(i, savePoints.length);
      const j = idIndex(exclusiveLowerBound, ops);
      ops.splice(j, ops.length);
    });
    this.saveFile = newFile;
  }
}
