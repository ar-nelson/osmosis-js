import { readFileSync, statSync, writeFile } from 'fs';
import produce, { Draft } from 'immer';
import * as uuid from 'uuid';
import { Id, idIndex, Uuid } from './id';
import { Op, SavePoint, SaveState } from './store';

enum WriteState {
  Idle,
  Pending,
  Writing,
}

interface SaveFile {
  readonly uuid: Uuid;
  readonly ops: readonly Op[];
  readonly savePoints: readonly SavePoint[];
}

export default class JsonFileSaveState implements SaveState {
  private writeState: WriteState = WriteState.Idle;
  private saveFile: SaveFile;

  constructor(public readonly filename: string) {
    const stat = statSync(filename);
    if (stat.isDirectory()) {
      throw new Error(
        `cannot write JSON file at path "${filename}" because it is a directory`
      );
    }
    try {
      if (!stat.isFile) {
        throw true;
      }
      const json = readFileSync(filename, { encoding: 'utf8' });
      this.saveFile = JSON.parse(json);
    } catch (e) {
      this.saveFile = {
        uuid: uuid.v4(),
        ops: [],
        savePoints: [],
      };
      this.scheduleWrite();
    }
  }

  private performWrite() {
    this.writeState = WriteState.Writing;
    writeFile(this.filename, JSON.stringify(this.saveFile), (err) => {
      if (err) {
        console.error(err);
      }
      if (this.writeState === WriteState.Pending) {
        this.performWrite();
      }
    });
  }

  private scheduleWrite() {
    switch (this.writeState) {
      case WriteState.Idle:
        this.writeState = WriteState.Pending;
        setImmediate(() => this.performWrite());
        break;
      case WriteState.Writing:
        this.writeState = WriteState.Pending;
        break;
    }
  }

  load(): SaveFile {
    return this.saveFile;
  }

  addOp(op: Op): void {
    this.saveFile = produce(this.saveFile, ({ ops }) => {
      ops.push(op as Draft<Op>);
    });
    this.scheduleWrite();
  }

  addSavePoint(savePoint: SavePoint): void {
    this.saveFile = produce(this.saveFile, ({ savePoints }) => {
      savePoints.push(savePoint as Draft<SavePoint>);
    });
    this.scheduleWrite();
  }

  deleteSavePoint(at: Id): void {
    this.saveFile = produce(this.saveFile, ({ savePoints }) => {
      const i = idIndex(at, savePoints);
      if (i > 0) {
        savePoints.splice(i, 1);
      }
    });
    this.scheduleWrite();
  }

  deleteEverythingAfter(exclusiveLowerBound: Id): void {
    this.saveFile = produce(this.saveFile, ({ savePoints, ops }) => {
      const i = idIndex(exclusiveLowerBound, savePoints);
      savePoints.splice(i, savePoints.length - i);
      const j = idIndex(exclusiveLowerBound, ops);
      ops.splice(j, ops.length - j);
    });
    this.scheduleWrite();
  }
}
