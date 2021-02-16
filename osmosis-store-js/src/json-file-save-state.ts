import { readFileSync, statSync, writeFile } from 'fs';
import InMemorySaveState, { State } from './in-memory-save-state';
import { Failure, JsonObject } from './types';
import { Op } from './save-state';
import { Change } from './actions';
import { Id } from './id';

enum WriteState {
  Idle,
  Pending,
  Writing,
}

function readJsonFile(filename: string): any {
  try {
    const json = JSON.parse(readFileSync(filename, { encoding: 'utf8' }));
    return {
      ...json,
      hash: Buffer.from(json.hash, 'hex'),
      savePoints: json.savePoints.map((sp) => ({
        ...sp,
        hash: Buffer.from(sp.hash, 'hex'),
      })),
    };
  } catch (e) {
    return undefined;
  }
}

function stateToJson(state: State<unknown>): JsonObject {
  return ({
    ...state,
    hash: Buffer.from(state.hash).toString('hex'),
    savePoints: state.savePoints.map((sp) => ({
      ...sp,
      hash: Buffer.from(sp.hash).toString('hex'),
    })),
  } as unknown) as JsonObject;
}

export default class JsonFileSaveState<
  Metadata extends { readonly [key: string]: string }
> extends InMemorySaveState<Metadata> {
  private writeState: WriteState = WriteState.Idle;

  constructor(
    initMetadata: () => Metadata,
    public readonly filename = 'osmosis.json'
  ) {
    super(readJsonFile(filename) || { metadata: initMetadata() });

    const stat = statSync(filename);
    if (stat.isDirectory()) {
      throw new Error(
        `cannot write JSON file at path "${filename}" because it is a directory`
      );
    }
    if (!stat.isFile()) {
      this.scheduleWrite();
    }
  }

  private performWrite() {
    this.writeState = WriteState.Writing;
    writeFile(this.filename, JSON.stringify(stateToJson(this.state)), (err) => {
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

  insert(
    ops: Op[]
  ): {
    changes: readonly Change[];
    failures: readonly Failure[];
  } {
    this.scheduleWrite();
    return super.insert(ops);
  }

  rewind(latestId: Id): readonly Op[] {
    this.scheduleWrite();
    return super.rewind(latestId);
  }

  setMetadata(metadata: Metadata): void {
    this.scheduleWrite();
    return super.setMetadata(metadata);
  }
}
