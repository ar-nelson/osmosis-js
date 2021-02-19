import { Draft } from 'immer';
import { Json, JsonScalar, PathArray } from './types';
import { isObject } from './utils';

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
  arrayLength(t: T): Promise<number | undefined>;
  getIndex(t: T, index: number): Promise<JsonAdapterResult<T>>;
  getKey(t: T, key: string): Promise<JsonAdapterResult<T>>;
  listEntries(
    t: T
  ): Promise<readonly (readonly [string | number, T])[] | undefined>;
}

export const JsonJsonAdapter: JsonAdapter<Json> = Object.freeze({
  typeOf(
    json: Json
  ): 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object' {
    if (json === null) {
      return 'null';
    } else if (Array.isArray(json)) {
      return 'array';
    } else if (isObject(json)) {
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

  async arrayLength(json: Json): Promise<number | undefined> {
    return Array.isArray(json) ? json.length : undefined;
  },

  async getIndex(json: Json, index: number): Promise<JsonAdapterResult<Json>> {
    if (Array.isArray(json)) {
      if (index >= 0 && index < json.length) {
        return { canExist: true, exists: true, value: json[index] };
      }
      return { canExist: true, exists: false, value: undefined };
    }
    return NO_RESULT;
  },

  async getKey(json: Json, key: string): Promise<JsonAdapterResult<Json>> {
    if (isObject(json)) {
      if (Object.prototype.hasOwnProperty.call(json, key)) {
        return { canExist: true, exists: true, value: json[key] };
      }
      return { canExist: true, exists: false, value: undefined };
    }
    return NO_RESULT;
  },

  async listEntries(
    json: Json
  ): Promise<readonly (readonly [string | number, Json])[] | undefined> {
    if (Array.isArray(json)) {
      return json.map((v, k) => [k, v]);
    } else if (isObject(json)) {
      return [...Object.entries(json)];
    }
    return undefined;
  },
});

export const JsonDraftAdapter = JsonJsonAdapter as JsonAdapter<Draft<Json>>;

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

  async arrayLength(t: JsonScalar | T): Promise<number | undefined> {
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

  async getIndex(
    t: JsonScalar | T,
    index: number
  ): Promise<JsonAdapterResult<T>> {
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

  async getKey(t: JsonScalar | T, key: string): Promise<JsonAdapterResult<T>> {
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

  async listEntries(
    t: JsonScalar | T
  ): Promise<readonly (readonly [string | number, T])[] | undefined> {
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
}

export async function followPath<T>(
  path: PathArray,
  json: T,
  adapter: JsonAdapter<T>
): Promise<{ found: boolean; longestSubpath: PathArray; value?: T }> {
  const longestSubpath: (string | number)[] = [];
  for (const key of path) {
    const { exists, value } = await (typeof key === 'number'
      ? adapter.getIndex(json, key)
      : adapter.getKey(json, key));
    if (!exists) {
      return { found: false, longestSubpath };
    }
    json = value as T;
    longestSubpath.push(key);
  }
  return { found: true, longestSubpath, value: json };
}

export async function toJsonWithAdapter<T>(
  t: T,
  adapter: JsonAdapter<T>
): Promise<Json> {
  switch (adapter.typeOf(t)) {
    case 'null':
      return null;
    case 'boolean':
      return adapter.booleanValue(t);
    case 'number':
      return adapter.numberValue(t) as number;
    case 'string':
      return adapter.stringValue(t) as string;
    case 'array': {
      const out: Json[] = [];
      for (const [key, value] of (await adapter.listEntries(t)) || []) {
        out[key as number] = await toJsonWithAdapter(value, adapter);
      }
      return out;
    }
    case 'object': {
      const out: { [key: string]: Json } = {};
      for (const [key, value] of (await adapter.listEntries(t)) || []) {
        out[key as string] = await toJsonWithAdapter(value, adapter);
      }
      return out;
    }
  }
}

export async function isJsonEqual<T, U>(
  lhs: T,
  rhs: U,
  ladapter: JsonAdapter<T>,
  radapter: JsonAdapter<U>
): Promise<boolean> {
  const ltype = ladapter.typeOf(lhs);
  const rtype = radapter.typeOf(rhs);
  if (ltype !== rtype) {
    return false;
  }
  switch (ltype) {
    case 'object': {
      const lentries = [...((await ladapter.listEntries(lhs)) || [])];
      const rentries = [...((await radapter.listEntries(rhs)) || [])];
      if (lentries.length !== rentries.length) {
        return false;
      }
      lentries.sort(([a], [b]) => (a as string).localeCompare(b as string));
      rentries.sort(([a], [b]) => (a as string).localeCompare(b as string));
      for (let i = 0; i < lentries.length; i++) {
        if (
          lentries[i][0] !== rentries[i][0] ||
          !(await isJsonEqual(
            lentries[i][1],
            rentries[i][1],
            ladapter,
            radapter
          ))
        ) {
          return false;
        }
      }
      return true;
    }
    case 'array': {
      const lentries = (await ladapter.listEntries(lhs)) || [];
      const rentries = (await radapter.listEntries(rhs)) || [];
      if (lentries.length !== rentries.length) {
        return false;
      }
      for (let i = 0; i < lentries.length; i++) {
        if (
          !(await isJsonEqual(
            lentries[i][1],
            rentries[i][1],
            ladapter,
            radapter
          ))
        ) {
          return false;
        }
      }
      return true;
    }
    default:
      return (
        (await toJsonWithAdapter(lhs, ladapter)) ===
        (await toJsonWithAdapter(rhs, radapter))
      );
  }
}
