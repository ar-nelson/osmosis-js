import isPlainObject from 'lodash.isplainobject';
import { Json, JsonObject, JsonScalar, PathArray } from './types';
import { Draft } from 'immer';

export const NO_RESULT = Object.freeze({
  canExist: false,
  exists: false,
  value: undefined,
});

export type JsonAdapterResult<T> =
  | { canExist: true; exists: true; value: T }
  | { canExist: boolean; exists: boolean; value: T | undefined };

export interface JsonAdapter<T> {
  typeOf(t: T): 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';
  booleanValue(t: T): boolean;
  numberValue(t: T): number | undefined;
  stringValue(t: T): string | undefined;
  arrayLength(t: T): number | undefined;
  getIndex(t: T, index: number): JsonAdapterResult<T>;
  getKey(t: T, key: string): JsonAdapterResult<T>;
  listEntries(t: T): readonly (readonly [string | number, T])[] | undefined;
  toJson(t: T): Json;
}

export const JsonJsonAdapter: JsonAdapter<Json> = Object.freeze({
  typeOf(
    json: Json
  ): 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object' {
    if (json === null) {
      return 'null';
    } else if (Array.isArray(json)) {
      return 'array';
    } else if (isPlainObject(json)) {
      return 'object';
    } else {
      return typeof json as 'boolean' | 'number' | 'string';
    }
  },

  booleanValue(json: Json): boolean {
    return !!json;
  },

  numberValue(json: Json): number | undefined {
    return typeof json === 'number' ? json : undefined;
  },

  stringValue(json: Json): string | undefined {
    return typeof json === 'string' ? json : undefined;
  },

  arrayLength(json: Json): number | undefined {
    return Array.isArray(json) ? json.length : undefined;
  },

  getIndex(json: Json, index: number): JsonAdapterResult<Json> {
    if (Array.isArray(json)) {
      if (index >= 0 && index < json.length) {
        return { canExist: true, exists: true, value: json[index] };
      }
      return { canExist: true, exists: false, value: undefined };
    }
    return NO_RESULT;
  },

  getKey(json: Json, key: string): JsonAdapterResult<Json> {
    if (isPlainObject(json)) {
      if (Object.prototype.hasOwnProperty.call(json, key)) {
        return {
          canExist: true,
          exists: true,
          value: (json as JsonObject)[key],
        };
      }
      return { canExist: true, exists: false, value: undefined };
    }
    return NO_RESULT;
  },

  listEntries(
    json: Json
  ): readonly (readonly [string | number, Json])[] | undefined {
    if (Array.isArray(json)) {
      return json.map((v, k) => [k, v]);
    } else if (isPlainObject(json)) {
      return [...Object.entries(json as JsonObject)];
    }
    return undefined;
  },

  toJson(json: Json): Json {
    return json;
  },
});

export const JsonDraftAdapter: JsonAdapter<Draft<Json>> = {
  ...(JsonJsonAdapter as JsonAdapter<Draft<Json>>),

  toJson(t: Draft<Json>): Json {
    return JSON.parse(JSON.stringify(t));
  },
};

export class PlusScalarAdapter<T> implements JsonAdapter<JsonScalar | T> {
  constructor(private readonly childAdapter: JsonAdapter<T>) {}

  typeOf(
    t: JsonScalar | T
  ): 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object' {
    if (t === null) {
      return 'null';
    }
    const type = typeof t;
    switch (type) {
      case 'boolean':
      case 'number':
      case 'string':
        return type;
      default:
        return this.childAdapter.typeOf(t as T);
    }
  }

  booleanValue(t: JsonScalar | T): boolean {
    if (t === null) {
      return false;
    }
    switch (typeof t) {
      case 'boolean':
      case 'number':
      case 'string':
        return !!t;
      default:
        return this.childAdapter.booleanValue(t);
    }
  }

  numberValue(t: JsonScalar | T): number | undefined {
    if (t === null) {
      return undefined;
    }
    switch (typeof t) {
      case 'number':
        return t;
      case 'boolean':
      case 'string':
        return undefined;
      default:
        return this.childAdapter.numberValue(t);
    }
  }

  stringValue(t: JsonScalar | T): string | undefined {
    if (t === null) {
      return undefined;
    }
    switch (typeof t) {
      case 'string':
        return t;
      case 'boolean':
      case 'number':
        return undefined;
      default:
        return this.childAdapter.stringValue(t);
    }
  }

  arrayLength(t: JsonScalar | T): number | undefined {
    if (t === null) {
      return undefined;
    }
    switch (typeof t) {
      case 'boolean':
      case 'number':
      case 'string':
        return undefined;
      default:
        return this.childAdapter.arrayLength(t);
    }
  }

  getIndex(t: JsonScalar | T, index: number): JsonAdapterResult<T> {
    if (t === null) {
      return NO_RESULT;
    }
    switch (typeof t) {
      case 'boolean':
      case 'number':
      case 'string':
        return NO_RESULT;
      default:
        return this.childAdapter.getIndex(t, index);
    }
  }

  getKey(t: JsonScalar | T, key: string): JsonAdapterResult<T> {
    if (t === null) {
      return NO_RESULT;
    }
    switch (typeof t) {
      case 'boolean':
      case 'number':
      case 'string':
        return NO_RESULT;
      default:
        return this.childAdapter.getKey(t, key);
    }
  }

  listEntries(
    t: JsonScalar | T
  ): readonly (readonly [string | number, T])[] | undefined {
    if (t === null) {
      return undefined;
    }
    switch (typeof t) {
      case 'boolean':
      case 'number':
      case 'string':
        return undefined;
      default:
        return this.childAdapter.listEntries(t);
    }
  }

  toJson(t: JsonScalar | T): Json {
    if (t === null) {
      return null;
    }
    switch (typeof t) {
      case 'boolean':
      case 'number':
      case 'string':
        return t;
      default:
        return this.childAdapter.toJson(t);
    }
  }
}

export function followPath<T>(
  path: PathArray,
  json: T,
  adapter: JsonAdapter<T>
): { found: boolean; longestSubpath: PathArray; value?: T } {
  const longestSubpath: (string | number)[] = [];
  for (const key of path) {
    const { exists, value } =
      typeof key === 'number'
        ? adapter.getIndex(json, key)
        : adapter.getKey(json, key);
    if (!exists) {
      return { found: false, longestSubpath };
    }
    json = value as T;
    longestSubpath.push(key);
  }
  return { found: true, longestSubpath, value: json };
}

export function isJsonEqual<T, U>(
  lhs: T,
  rhs: U,
  ladapter: JsonAdapter<T>,
  radapter: JsonAdapter<U>
): boolean {
  const ltype = ladapter.typeOf(lhs);
  const rtype = radapter.typeOf(rhs);
  if (ltype !== rtype) {
    return false;
  }
  switch (ltype) {
    case 'object': {
      const lentries = [...(ladapter.listEntries(lhs) || [])];
      const rentries = [...(radapter.listEntries(rhs) || [])];
      if (lentries.length !== rentries.length) {
        return false;
      }
      lentries.sort(([a], [b]) => (a as string).localeCompare(b as string));
      rentries.sort(([a], [b]) => (a as string).localeCompare(b as string));
      for (let i = 0; i < lentries.length; i++) {
        if (
          lentries[i][0] !== rentries[i][0] ||
          !isJsonEqual(lentries[i][1], rentries[i][1], ladapter, radapter)
        ) {
          return false;
        }
      }
      return true;
    }
    case 'array': {
      const lentries = ladapter.listEntries(lhs) || [];
      const rentries = radapter.listEntries(rhs) || [];
      if (lentries.length !== rentries.length) {
        return false;
      }
      for (let i = 0; i < lentries.length; i++) {
        if (!isJsonEqual(lentries[i][1], rentries[i][1], ladapter, radapter)) {
          return false;
        }
      }
      return true;
    }
    default:
      return ladapter.toJson(lhs) === radapter.toJson(rhs);
  }
}
