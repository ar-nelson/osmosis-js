import {
  binaryCompare,
  BinaryPath,
  binaryPathAppend,
  binaryPathSplit,
} from './binary-path';
import { Id, idCompare } from './id';
import { JsonNode, JsonSource } from './json-source';
import SortedArrayMap from './sorted-array-map';

type Tombstone = { readonly type: 'tombstone' };

export default class JsonCache implements JsonSource {
  private readonly pathToValue = new SortedArrayMap<
    BinaryPath,
    JsonNode | Tombstone
  >(binaryCompare);
  private readonly pathToIds = new SortedArrayMap<BinaryPath, Id[]>(
    binaryCompare
  );
  private readonly idToPath = new SortedArrayMap<Id, BinaryPath | null>(
    idCompare
  );

  constructor(private readonly source: JsonSource) {}

  async getByPath(path: BinaryPath): Promise<JsonNode | undefined> {
    let value = this.pathToValue.get(path);
    if (value && typeof value === 'object' && value.type === 'tombstone') {
      return undefined;
    } else if (value === undefined) {
      value = await this.source.getByPath(path);
      this.pathToValue.set(
        path,
        value === undefined ? { type: 'tombstone' } : value
      );
    }
    return value;
  }

  async getById(id: Id): Promise<JsonNode | undefined> {
    const path = await this.getPathById(id);
    return path && this.getByPath(path);
  }

  async getPathById(id: Id): Promise<BinaryPath | undefined> {
    let path = this.idToPath.get(id);
    if (path == null) {
      return undefined;
    } else if (!path && this.source) {
      path = await this.source.getPathById(id);
      this.idToPath.set(id, path || null);
    }
    return path;
  }

  async getIdsByPath(path: BinaryPath): Promise<Id[]> {
    let ids = this.pathToIds.get(path);
    if (!ids) {
      ids = await this.source.getIdsByPath(path);
      this.pathToIds.set(path, ids);
    }
    return ids;
  }

  getIdsAfter(
    id: Id
  ): Promise<Iterable<{ readonly id: Id; readonly path: BinaryPath }>> {
    return this.source.getIdsAfter(id);
  }

  expirePath(path: BinaryPath, isDeleted = true): void {
    const existing = this.pathToValue.get(path);
    if (existing && typeof existing === 'object') {
      if (existing.type === 'array') {
        for (let i = 0; i < existing.length; i++) {
          this.expirePath(binaryPathAppend(path, i), false);
        }
      } else if (existing.type === 'object') {
        for (const key of existing.keys) {
          this.expirePath(binaryPathAppend(path, key), false);
        }
      }
    }
    const ids = this.pathToIds.get(path) || [];
    for (const id of ids) {
      this.idToPath.delete(id);
    }
    this.pathToValue.delete(path);
    this.pathToIds.delete(path);
    if (isDeleted) {
      this.pathToValue.delete(binaryPathSplit(path).parent);
    }
  }

  expireId(id: Id, isDeleted = true): void {
    const path = this.idToPath.delete(id);
    if (path) {
      this.expirePath(path, isDeleted);
    }
  }

  async expireIdsAfter(firstId: Id): Promise<void> {
    for (const { id, path } of await this.source.getIdsAfter(firstId)) {
      this.expireId(id, true);
      this.expirePath(path, true);
    }
  }
}
