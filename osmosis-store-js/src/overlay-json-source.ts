import { binaryCompare, BinaryPath, binaryPathAppend } from './binary-path';
import { Id, idCompare } from './id';
import { JsonNode, JsonSource, MutableJsonSource } from './json-source';
import SortedArrayMap from './sorted-array-map';

export type Tombstone = { readonly type: 'tombstone' };

export interface SerializedJsonSource {
  pathToValue: [BinaryPath, JsonNode | Tombstone][];
  pathToIds: [BinaryPath, ...Id[]][];
  idToPath: [Id, BinaryPath | null][];
}

export default class OverlayJsonSource implements MutableJsonSource {
  protected readonly pathToValue = new SortedArrayMap<
    BinaryPath,
    JsonNode | Tombstone
  >(binaryCompare);
  protected readonly pathToIds = new SortedArrayMap<BinaryPath, Set<Id>>(
    binaryCompare
  );
  protected readonly idToPath = new SortedArrayMap<Id, BinaryPath | null>(
    idCompare
  );

  constructor(public parent?: JsonSource) {}

  async getByPath(path: BinaryPath): Promise<JsonNode | undefined> {
    const value = this.pathToValue.get(path);
    if (value && typeof value === 'object' && value.type === 'tombstone') {
      return undefined;
    } else if (value === undefined && this.parent) {
      return this.parent.getByPath(path);
    }
    if (!path.byteLength && value === undefined) {
      return { type: 'object', keys: [] };
    }
    return value;
  }

  async setByPath(path: BinaryPath, value: JsonNode, id?: Id): Promise<void> {
    if ((value as any)?.type !== ((await this.getByPath(path)) as any)?.type) {
      await this.deleteChildren(path);
    }
    this.pathToValue.set(path, value);
    this.pathToIds.set(path, id ? new Set([id]) : new Set());
    if (id) {
      this.idToPath.set(id, path);
    }
  }

  private async deleteChildren(path: BinaryPath) {
    const existing = await this.getByPath(path);
    if (existing && typeof existing === 'object') {
      if (existing.type === 'array') {
        for (let i = 0; i < existing.length; i++) {
          await this.deleteByPath(binaryPathAppend(path, i));
        }
      } else {
        for (const key of existing.keys) {
          await this.deleteByPath(binaryPathAppend(path, key));
        }
      }
    }
    return existing;
  }

  async deleteByPath(path: BinaryPath): Promise<JsonNode | undefined> {
    const existing = await this.deleteChildren(path);
    if (this.parent) {
      for (const id of await this.getIdsByPath(path)) {
        this.idToPath.set(id, null);
      }
      this.pathToIds.set(path, new Set());
      this.pathToValue.set(path, { type: 'tombstone' });
    } else {
      for (const id of await this.getIdsByPath(path)) {
        this.idToPath.delete(id);
      }
      this.pathToIds.delete(path);
      this.pathToValue.delete(path);
    }
    return existing;
  }

  async getById(id: Id): Promise<JsonNode | undefined> {
    const path = await this.getPathById(id);
    return path && this.getByPath(path);
  }

  async getPathById(id: Id): Promise<BinaryPath | undefined> {
    const path = this.idToPath.get(id);
    if (path == null) {
      return undefined;
    } else if (!path && this.parent) {
      return this.parent.getPathById(id);
    }
    return path;
  }

  async getIdsByPath(path: BinaryPath): Promise<Id[]> {
    const ids = this.pathToIds.get(path);
    if (ids) {
      return [...ids];
    }
    return this.parent ? await this.parent.getIdsByPath(path) : [];
  }

  async getIdsAfter(
    id: Id
  ): Promise<Iterable<{ readonly id: Id; readonly path: BinaryPath }>> {
    const iter = this.idToPath.range(id);
    return (function* () {
      for (const { key, value } of iter) {
        if (value != null) {
          yield { id: key, path: value };
        }
      }
    })();
  }

  async addIdToPath(path: BinaryPath, id: Id): Promise<void> {
    this.idToPath.set(id, path);
    const ids = this.pathToIds.get(path);
    if (ids) {
      ids.add(id);
    } else if (this.parent) {
      this.pathToIds.set(
        path,
        new Set([id, ...(await this.parent.getIdsByPath(path))])
      );
    } else {
      this.pathToIds.set(path, new Set([id]));
    }
  }

  async setIdsByPath(path: BinaryPath, ids: Id[]): Promise<void> {
    ids.forEach((id) => this.idToPath.set(id, path));
    this.pathToIds.set(path, new Set(ids));
  }

  mergeChild(child: OverlayJsonSource): void {
    for (const { key, value } of child.pathToValue.entries()) {
      this.pathToValue.set(key, value);
    }
    for (const { key, value } of child.idToPath.entries()) {
      this.idToPath.set(key, value);
    }
    for (const { key, value } of child.pathToIds.entries()) {
      this.pathToIds.set(key, value);
    }
  }

  serialize(): SerializedJsonSource {
    // TODO: optimize for performance, avoid allocating an extra array
    return {
      pathToValue: [...this.pathToValue.entries()].map(({ key, value }) => [
        key,
        value,
      ]),
      pathToIds: [...this.pathToIds.entries()].map(({ key, value }) => [
        key,
        ...value,
      ]),
      idToPath: [...this.idToPath.entries()].map(({ key, value }) => [
        key,
        value,
      ]),
    };
  }

  deserialize({
    pathToValue,
    pathToIds,
    idToPath,
  }: SerializedJsonSource): void {
    for (const [k, v] of pathToValue) {
      this.pathToValue.set(k, v);
    }
    for (const [k, ...vs] of pathToIds) {
      this.pathToIds.set(k, new Set(vs));
    }
    for (const [k, v] of idToPath) {
      this.idToPath.set(k, v);
    }
  }
}
