import produce, { Draft } from 'immer';
import { Op, SavePoint, SaveState, timestampIndex } from '../src/store';
import { Timestamp, Uuid } from '../src/types';

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

  addOp(op: Op) {
    this.saveFile = produce(this.saveFile, ({ ops }) => {
      ops.push(op as Draft<Op>);
    });
  }

  addSavePoint(savePoint: SavePoint) {
    this.saveFile = produce(this.saveFile, ({ savePoints }) => {
      savePoints.push(savePoint as Draft<SavePoint>);
    });
  }

  deleteSavePoint(at: Timestamp) {
    this.saveFile = produce(this.saveFile, ({ savePoints }) => {
      const i = timestampIndex(at, savePoints);
      if (i > 0) savePoints.splice(i, 1);
    });
  }

  deleteEverythingAfter(exclusiveLowerBound: Timestamp) {
    this.saveFile = produce(this.saveFile, ({ savePoints, ops }) => {
      const i = timestampIndex(exclusiveLowerBound, savePoints);
      if (i > 0) savePoints.splice(i, savePoints.length - i);
      const j = timestampIndex(exclusiveLowerBound, ops);
      if (j > 0) ops.splice(j, ops.length - j);
    });
  }
}
