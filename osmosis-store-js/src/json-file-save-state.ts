import { readFileSync, statSync, writeFile } from 'fs';
import { Change } from './actions';
import { Id } from './id';
import InMemorySaveState, { State } from './in-memory-save-state';
import { Op } from './save-state';
import { Failure, JsonObject } from './types';

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

async function stateToJson(
  state: State<Promise<unknown>>
): Promise<JsonObject> {
  return ({
    ...state,
    hash: Buffer.from(state.hash).toString('hex'),
    savePoints: state.savePoints.map((sp) => ({
      ...sp,
      hash: Buffer.from(sp.hash).toString('hex'),
    })),
    metadata: await state.metadata,
  } as unknown) as JsonObject;
}

export default class JsonFileSaveState<
  Metadata
> extends InMemorySaveState<Metadata> {
  private writeState: WriteState = WriteState.Idle;

  constructor(public readonly filename = 'osmosis.json') {
    super(readJsonFile(filename));

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

  private async performWrite() {
    this.writeState = WriteState.Writing;
    writeFile(
      this.filename,
      JSON.stringify(await stateToJson(this.state)),
      (err) => {
        if (err) {
          console.error(err);
        }
        if (this.writeState === WriteState.Pending) {
          this.performWrite();
        }
      }
    );
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
  ): Promise<{
    changes: readonly Change[];
    failures: readonly Failure[];
  }> {
    this.scheduleWrite();
    return super.insert(ops);
  }

  rewind(latestId: Id): Promise<readonly Op[]> {
    this.scheduleWrite();
    return super.rewind(latestId);
  }

  setMetadata(metadata: Metadata): Promise<void> {
    this.scheduleWrite();
    return super.setMetadata(metadata);
  }

  initMetadata(initializer: () => Promise<Metadata>): Promise<void> {
    return super.initMetadata(() => {
      this.scheduleWrite();
      return initializer();
    });
  }
}
