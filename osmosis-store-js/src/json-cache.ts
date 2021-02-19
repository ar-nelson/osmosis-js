import { Id, idToString } from './id';
import { JsonAdapter, JsonAdapterResult, NO_RESULT } from './json-adapter';
import { CompiledJsonIdPath, CompiledJsonPath, queryValues } from './jsonpath';
import {
  AbsolutePathArray,
  Json,
  JsonArray,
  JsonObject,
  JsonScalar,
  PathArray,
} from './types';

export type JsonCacheValue = JsonScalar | JsonCacheArray | JsonCacheObject;

const JsonCacheArrayMarker = Symbol('JsonCacheArrayMarker');
const JsonCacheObjectMarker = Symbol('JsonCacheObjectMarker');
export type JsonCacheStructureMarker =
  | typeof JsonCacheArrayMarker
  | typeof JsonCacheObjectMarker;
export const JsonCacheStructureMarker: {
  Array: typeof JsonCacheArrayMarker;
  Object: typeof JsonCacheObjectMarker;
} = {
  Array: JsonCacheArrayMarker,
  Object: JsonCacheObjectMarker,
};

export interface JsonCacheDatum {
  readonly value: JsonScalar | JsonCacheStructureMarker | undefined;
  readonly ids: readonly Id[];
}

export interface NonEmptyJsonCacheDatum extends JsonCacheDatum {
  readonly value: JsonScalar | JsonCacheStructureMarker;
}

export interface JsonCacheEntry<Key extends string | number> {
  readonly key: Key;
  readonly ids: readonly Id[];
  readonly value: JsonCacheValue | undefined;
  readonly parentPath: PathArray;
}

export interface NonEmptyJsonCacheEntry<Key extends string | number>
  extends JsonCacheEntry<Key> {
  readonly value: JsonCacheValue;
}

export interface CacheSource {
  lookupByPath(path: PathArray): Promise<JsonCacheDatum>;
  lookupById(
    id: Id
  ): Promise<(JsonCacheDatum & { readonly path: AbsolutePathArray }) | null>;
  listObject(
    path: PathArray
  ): Promise<readonly (NonEmptyJsonCacheDatum & { key: string })[]>;
  listArray(path: PathArray): Promise<readonly NonEmptyJsonCacheDatum[]>;
}

export class JsonCache {
  public readonly root: JsonCacheObject;
  private readonly entriesById = new Map<
    string,
    JsonCacheEntry<string | number> | null
  >();

  constructor(private readonly source: CacheSource) {
    this.root = new JsonCacheObject([], source);
  }

  async lookupByPath(
    path: PathArray
  ): Promise<{ found: boolean; entry: JsonCacheEntry<string | number> }> {
    let lastEntry: JsonCacheEntry<string | number> | null = null;
    let value: JsonCacheValue | undefined = this.root;
    for (const key of path) {
      if (typeof key === 'string' && value instanceof JsonCacheObject) {
        lastEntry = await value.getKey(key);
        value = lastEntry.value;
      } else if (typeof key === 'number' && value instanceof JsonCacheArray) {
        lastEntry = await value.getKey(key);
        value = lastEntry.value;
      } else {
        return {
          found: false,
          entry: lastEntry as JsonCacheEntry<string | number>,
        };
      }
    }
    return { found: true, entry: lastEntry as JsonCacheEntry<string | number> };
  }

  async lookupById(id: Id): Promise<JsonCacheEntry<string | number> | null> {
    const idString = idToString(id);
    const cached = this.entriesById.get(idString);
    if (cached !== undefined) {
      return cached;
    }
    const lookup = await this.source.lookupById(id);
    if (lookup == null) {
      this.entriesById.set(idString, null);
      return null;
    }
    const { found, entry } = await this.lookupByPath(
      lookup.path as [string, ...PathArray]
    );
    if (!found) {
      this.entriesById.set(idString, null);
      return null;
    }
    this.entriesById.set(idString, entry);
    return entry;
  }

  async expirePath(path: AbsolutePathArray): Promise<boolean> {
    if (path.length === 1) {
      return this.root.expireKey(path[0]);
    }
    const { found, entry: parent } = await this.lookupByPath(
      path.slice(0, path.length - 1) as [string, ...PathArray]
    );
    if (!found || !(parent.value instanceof JsonCacheStructure)) {
      return false;
    }
    return (parent.value as JsonCacheStructure<string | number>).expireKey(
      path[path.length - 1]
    );
  }

  async expireId(id: Id): Promise<boolean> {
    const idString = idToString(id);
    const cached = this.entriesById.get(idString);
    this.entriesById.delete(idString);
    if (cached == null) {
      return cached === null;
    }
    if (cached.parentPath.length) {
      ((await this.lookupByPath(cached.parentPath)).entry
        .value as JsonCacheStructure<string | number>).expireKey(cached.key);
    } else {
      this.root.expireKey(cached.key as string);
    }
    return true;
  }

  expireIdsAfter(id: Id): void {
    const idString = idToString(id);
    for (const key of this.entriesById.keys()) {
      if (key > idString) {
        this.entriesById.delete(key);
      }
    }
    this.root.expireIdsAfter(id);
  }

  async queryValues(
    path: CompiledJsonPath | CompiledJsonIdPath
  ): Promise<readonly JsonCacheValue[]> {
    let root: JsonCacheValue = this.root;
    if (!path.length) {
      return [root];
    }
    if (path[0].type === 'Id') {
      let idMatch = await this.lookupById(path[0].query.id);
      if (!idMatch) {
        const { found, entry } = await this.lookupByPath(path[0].query.path);
        if (found) {
          idMatch = entry;
        }
      }
      if (!idMatch || idMatch.value === undefined) {
        return [];
      }
      root = idMatch.value;
      path = path.slice(1) as CompiledJsonPath;
    }
    return queryValues(path as CompiledJsonPath, root, JsonCacheAdapter);
  }

  async anchorPathToId(
    path: CompiledJsonPath
  ): Promise<CompiledJsonPath | CompiledJsonIdPath> {
    let struct: JsonCacheStructure<string | number> = this.root;
    let lastId: Id | null = null;
    let lastIdIndex = 0;
    let queryPath: PathArray = [];
    const queryPathAccum: (string | number)[] = [];
    for (let i = 0; i < path.length; i++) {
      const segment = path[i];
      if (segment.type === 'Index' || segment.type === 'Key') {
        const entry = await struct.getKey(segment.query);
        queryPathAccum.push(segment.query);
        if (entry.ids.length) {
          lastId = entry.ids[0];
          lastIdIndex = i;
          queryPath = [...queryPathAccum];
        }
        if (entry.value instanceof JsonCacheStructure) {
          struct = entry.value;
          continue;
        }
      }
      break;
    }
    if (!lastId) {
      return path;
    }
    return [
      { type: 'Id', query: { id: lastId, path: queryPath } },
      ...path.slice(lastIdIndex + 1),
    ];
  }
}

export abstract class JsonCacheStructure<Key extends string | number> {
  protected readonly entriesByKey = new Map<Key, JsonCacheEntry<Key>>();

  constructor(
    protected readonly path: PathArray,
    protected readonly source: CacheSource
  ) {}

  protected datumToEntry(
    datum: NonEmptyJsonCacheDatum,
    key: Key
  ): NonEmptyJsonCacheEntry<Key>;
  protected datumToEntry(datum: JsonCacheDatum, key: Key): JsonCacheEntry<Key>;
  protected datumToEntry(datum: JsonCacheDatum, key: Key): JsonCacheEntry<Key> {
    let value: JsonCacheValue | undefined;
    switch (datum.value) {
      case JsonCacheStructureMarker.Object:
        value = new JsonCacheObject([...this.path, key], this.source);
        break;
      case JsonCacheStructureMarker.Array:
        value = new JsonCacheArray([...this.path, key], this.source);
        break;
      default:
        value = datum.value;
    }
    return {
      ...datum,
      value,
      key,
      parentPath: this.path,
    };
  }

  async getKey(key: Key): Promise<JsonCacheEntry<Key>> {
    const cached = this.entriesByKey.get(key);
    if (cached != null) {
      return cached;
    }
    const loaded = this.datumToEntry(
      await this.source.lookupByPath([...this.path, key]),
      key
    );
    this.entriesByKey.set(key, loaded);
    return loaded;
  }

  expireKey(key: Key): boolean {
    this.expireEntries();
    return this.entriesByKey.delete(key);
  }

  expireIdsAfter(id: Id): void {
    const idString = idToString(id);
    for (const [key, entry] of this.entriesByKey) {
      if (entry.ids.every((id) => idToString(id) > idString)) {
        this.expireKey(key);
      } else if (entry.value instanceof JsonCacheStructure) {
        entry.value.expireIdsAfter(id);
      }
    }
  }

  abstract expireEntries(): void;
  abstract entries(): Promise<readonly NonEmptyJsonCacheEntry<Key>[]>;
  abstract toJson(): Promise<Json>;
}

export class JsonCacheObject extends JsonCacheStructure<string> {
  private hasAllEntries = false;

  constructor(path: PathArray, source: CacheSource) {
    super(path, source);
  }

  expireEntries(): void {
    this.hasAllEntries = false;
  }

  async entries(): Promise<readonly NonEmptyJsonCacheEntry<string>[]> {
    if (this.hasAllEntries) {
      return [...this.entriesByKey.values()].filter(
        (x) => x.value !== undefined
      ) as NonEmptyJsonCacheEntry<string>[];
    }
    this.hasAllEntries = true;
    return (await this.source.listObject(this.path)).map((datum) => {
      const entry = this.datumToEntry(datum, datum.key);
      this.entriesByKey.set(entry.key, entry);
      return entry;
    });
  }

  async toJson(): Promise<JsonObject> {
    const json: { [key: string]: Json } = {};
    for (const { key, value } of await this.entries()) {
      json[key] =
        value instanceof JsonCacheStructure ? await value.toJson() : value;
    }
    return json;
  }
}

export class JsonCacheArray extends JsonCacheStructure<number> {
  private cachedLength = -1;

  constructor(path: PathArray, source: CacheSource) {
    super(path, source);
  }

  async length(): Promise<number> {
    if (this.cachedLength >= 0) {
      return this.cachedLength;
    }
    return (await this.entries()).length;
  }

  expireEntries(): void {
    this.cachedLength = -1;
  }

  async entries(): Promise<readonly NonEmptyJsonCacheEntry<number>[]> {
    if (this.cachedLength >= 0) {
      return [...new Array(this.cachedLength)].map(
        (_, i) => this.entriesByKey.get(i) as NonEmptyJsonCacheEntry<number>
      );
    }
    const list = await this.source.listArray(this.path);
    this.cachedLength = list.length;
    return list.map((datum, key) => {
      const entry = this.datumToEntry(datum, key);
      this.entriesByKey.set(entry.key, entry);
      return entry;
    });
  }

  async toJson(): Promise<JsonArray> {
    const json: Json[] = [];
    for (const { key, value } of await this.entries()) {
      json[key] =
        value instanceof JsonCacheStructure ? await value.toJson() : value;
    }
    return json;
  }
}

export const JsonCacheAdapter: JsonAdapter<JsonCacheValue> = Object.freeze({
  typeOf(
    json: JsonCacheValue
  ): 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object' {
    if (json === null) {
      return 'null';
    }
    const type = typeof json;
    switch (type) {
      case 'boolean':
      case 'number':
      case 'string':
        return type;
      default:
        return json instanceof JsonCacheArray ? 'array' : 'object';
    }
  },

  booleanValue(json: JsonCacheValue): boolean {
    return !!json;
  },

  numberValue(json: JsonCacheValue): number | undefined {
    return typeof json === 'number' ? json : undefined;
  },

  stringValue(json: JsonCacheValue): string | undefined {
    return typeof json === 'string' ? json : undefined;
  },

  async arrayLength(json: JsonCacheValue): Promise<number | undefined> {
    return json instanceof JsonCacheArray ? json.length() : undefined;
  },

  async getIndex(
    json: JsonCacheValue,
    index: number
  ): Promise<JsonAdapterResult<JsonCacheValue>> {
    if (json instanceof JsonCacheArray) {
      const entry = await json.getKey(index);
      return {
        canExist: true,
        exists: entry.value !== undefined,
        value: entry.value,
      };
    }
    return NO_RESULT;
  },

  async getKey(
    json: JsonCacheValue,
    key: string
  ): Promise<JsonAdapterResult<JsonCacheValue>> {
    if (json instanceof JsonCacheObject) {
      const entry = await json.getKey(key);
      return {
        canExist: true,
        exists: entry.value !== undefined,
        value: entry.value,
      };
    }
    return NO_RESULT;
  },

  async listEntries(
    json: JsonCacheValue
  ): Promise<
    readonly (readonly [string | number, JsonCacheValue])[] | undefined
  > {
    if (json instanceof JsonCacheStructure) {
      return ((await json.entries()) as readonly NonEmptyJsonCacheEntry<
        string | number
      >[]).map((e) => [e.key, e.value]);
    }
    return undefined;
  },
});
