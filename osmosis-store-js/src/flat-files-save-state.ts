import * as fs from 'fs';
import * as Monocypher from 'monocypher-wasm';
import { pack, unpack } from 'msgpackr';
import * as path from 'path';
import * as tmp from 'tmp-promise';
import { promisify } from 'util';
import { Change } from './actions';
import { Id, idCompare, idToBinary, ZERO_ID } from './id';
import InMemorySaveState, {
  SerializedSavePoint,
  SerializedSaveState,
} from './in-memory-save-state';
import OverlayJsonSource from './overlay-json-source';
import { Op, SavePoint } from './save-state';
import SortedArrayMap from './sorted-array-map';
import { Failure } from './types';
import { last, sortedIndex } from './utils';

const close = promisify(fs.close);
const rename = promisify(fs.rename);
const rm = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);

const deleteFile = Symbol('deleteFile');
const metadataFilename = 'osmosis-metadata.msgpack';
const recentFilename = 'osmosis-recent.msgpack';
const savePointFilename = /^savepoint-([0-9a-f]{64})\.msgpack$/i;

function loadFlatFiles<Metadata>(
  rootPath: string
): Partial<SerializedSaveState<Metadata>> {
  // TODO: Handle errors, apply a schema to files
  const metadataPath = path.join(rootPath, metadataFilename);
  const recentPath = path.join(rootPath, recentFilename);
  if (
    !fs.statSync(rootPath).isDirectory() ||
    !fs.statSync(metadataPath).isFile()
  ) {
    return {};
  }
  const metadata = unpack(fs.readFileSync(metadataPath));
  const recent = fs.statSync(recentPath).isFile()
    ? unpack(fs.readFileSync(recentPath))
    : {};
  const savePoints: SerializedSavePoint[] = [];
  const dir = fs.opendirSync(rootPath);
  for (let entry = dir.readSync(); entry != null; entry = dir.readSync()) {
    const match = entry.isFile() && savePointFilename.exec(entry.name);
    if (match) {
      savePoints.push(unpack(fs.readFileSync(path.join(rootPath, entry.name))));
    }
  }
  savePoints.sort((a, b) => idCompare(a.id, b.id));
  return {
    ...recent,
    metadata,
    savePoints,
  };
}

class FileWriter<T> {
  private readonly process: AsyncGenerator<void, void, T | typeof deleteFile>;
  private next: T | typeof deleteFile | undefined = undefined;
  private canWrite = false;

  constructor(public readonly filename: string) {
    this.process = this.writeLoop();
  }

  write(value: T) {
    if (this.next === deleteFile) {
      return;
    } else if (this.canWrite) {
      this.process.next(value);
    } else {
      this.next = value;
    }
  }

  delete() {
    this.next = deleteFile;
    this.process.next(deleteFile);
  }

  private takeNext(): T | typeof deleteFile | undefined {
    if (this.next == null) {
      this.canWrite = true;
      return undefined;
    }
    const value = this.next;
    this.next = undefined;
    return value;
  }

  private async *writeLoop(): AsyncGenerator<
    void,
    void,
    T | typeof deleteFile
  > {
    for (
      let next = this.takeNext() ?? (yield);
      next !== deleteFile;
      next = this.takeNext() ?? (yield)
    ) {
      this.canWrite = false;
      const encoded = pack(next);
      const { fd, path } = await tmp.file();
      await writeFile(fd, encoded);
      await close(fd);
      await rename(path, this.filename);
    }
    await rm(this.filename);
    this.canWrite = true;
    yield;
    throw new Error(`write after delete: ${this.filename}`);
  }
}

export default class FlatFilesSaveState<
  Metadata
> extends InMemorySaveState<Metadata> {
  private readonly metadataWriter: FileWriter<Metadata>;
  private readonly recentWriter: FileWriter<
    Omit<Omit<SerializedSaveState<Metadata>, 'savePoints'>, 'metadata'>
  >;
  private readonly savePointWriters = new SortedArrayMap<
    Id,
    FileWriter<SerializedSavePoint>
  >(idCompare);

  constructor(public readonly dbPath = 'osmosis-data') {
    super(loadFlatFiles(dbPath));
    fs.mkdirSync(dbPath, { recursive: true });
    this.metadataWriter = new FileWriter(path.join(dbPath, metadataFilename));
    this.recentWriter = new FileWriter(path.join(dbPath, recentFilename));
    this.savePoints.then(async (sp) => {
      await Monocypher.ready;
      sp.forEach(({ id }) => {
        this.savePointWriters.set(
          id,
          new FileWriter(
            path.join(
              dbPath,
              `savepoint-${Buffer.from(
                Monocypher.crypto_blake2b_general(32, null, idToBinary(id))
              ).toString('hex')}.msgpack`
            )
          )
        );
      });
    });
  }

  async insert(
    ops: Op[]
  ): Promise<{
    changes: readonly Change[];
    failures: readonly Failure[];
  }> {
    const result = await super.insert(ops);
    this.recentWriter.write({
      ...this.data.serialize(),
      ...this._stateSummary,
      ops: await this.opsRange(
        last(this._savePoints)?.id ?? ZERO_ID,
        last(this._ops)?.id ?? ZERO_ID
      ),
      failures: await this.failuresRange(
        last(this._savePoints)?.id ?? ZERO_ID,
        last(this._ops)?.id ?? ZERO_ID
      ),
    });
    return result;
  }

  setMetadata(metadata: Metadata): Promise<void> {
    this.metadataWriter.write(metadata);
    return super.setMetadata(metadata);
  }

  initMetadata(initializer: () => Promise<Metadata>): Promise<void> {
    return super.initMetadata(async () => {
      const metadata = await initializer();
      this.metadataWriter.write(metadata);
      return metadata;
    });
  }

  protected savePointAdded(
    savePoint: SavePoint & { data: OverlayJsonSource }
  ): void {
    Monocypher.ready.then(() => {
      const hash = Monocypher.crypto_blake2b_general(
        32,
        null,
        idToBinary(savePoint.id)
      );
      const filename = `savePoint-${Buffer.from(hash).toString('hex')}.msgpack`;
      this.savePointWriters.set(
        savePoint.id,
        new FileWriter(path.join(this.dbPath, filename))
      );
      this.savePointUpdated(savePoint);
    });
  }

  protected savePointUpdated(
    savePoint: SavePoint & { data: OverlayJsonSource }
  ): void {
    (async () => {
      const { width, id, hash, latestIndexes } = savePoint;
      const { index } = sortedIndex(
        this._savePoints,
        savePoint.id,
        idCompare,
        (x) => x.id
      );
      this.savePointWriters.get(savePoint.id)?.write({
        ...savePoint.data.serialize(),
        ops: await this.opsRange(
          index > 0 ? this._savePoints[index - 1].id : ZERO_ID,
          savePoint.id
        ),
        failures: await this.failuresRange(
          index > 0 ? this._savePoints[index - 1].id : ZERO_ID,
          savePoint.id
        ),
        width,
        id,
        hash,
        latestIndexes,
      });
    })();
  }

  protected savePointDeleted(id: Id): void {
    this.savePointWriters.delete(id)?.delete();
  }
}
