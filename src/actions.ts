import { Draft } from 'immer';
import isPlainObject from 'lodash.isplainobject';
import isEqual from 'lodash.isequal';
import flatMap from 'lodash.flatmap';
import { Json, JsonArray, JsonObject, PathArray } from './types';
import { Failure } from './events';

export interface SetAction<Path> {
  path: Path;
  action: 'Set' | 'InsertBefore' | 'InsertAfter' | 'InsertUnique';
  payload: any;
}

export interface MathAction<Path> {
  path: Path;
  action: 'Add' | 'Multiply';
  payload: number;
}

export interface VoidAction<Path> {
  path: Path;
  action: 'InitArray' | 'InitObject' | 'Delete';
}

export interface MoveAction<Path> {
  path: Path;
  action: 'Move' | 'Copy';
  payload: Path;
}

export type ScalarAction<Path> =
  | SetAction<Path>
  | MathAction<Path>
  | VoidAction<Path>
  | MoveAction<Path>;

export interface Transaction<Path> {
  action: 'Transaction';
  payload: ScalarAction<Path>[];
}

export interface RequestPairAction {
  action: 'RequestPair';
  payload: {
    uuid: string;
    message: string;
  };
}

export interface AcceptPairAction {
  action: 'AcceptPair';
  payload: {
    uuid: string;
    pin: string;
  };
}

export type NetworkAction = RequestPairAction | AcceptPairAction;

export type DataAction<Path> = ScalarAction<Path> | Transaction<Path>;

export type Action<Path> = NetworkAction | DataAction<Path>;

function followPath(
  path: PathArray,
  json: Draft<Json>
):
  | {
      failed?: false;
      key: string | number;
      parent: Draft<JsonArray | JsonObject>;
      value?: Draft<Json>;
    }
  | {
      failed: true;
      failure: Failure;
    } {
  if (!path.length) {
    return {
      failed: true,
      failure: {
        path,
        message: 'cannot apply action directly to root',
      },
    };
  }
  const parent = path
    .slice(0, path.length - 1)
    .reduce(
      (j, p) => (Array.isArray(j) || isPlainObject(j)) && (j as any)[p],
      json
    );
  if (parent && (Array.isArray(parent) || isPlainObject(parent))) {
    const key = path[path.length - 1];
    return { parent, key, value: parent[key] };
  }
  return { failed: true, failure: { path, message: 'path does not exist' } };
}

function elementsAfter(path: PathArray, length: number): PathArray[] {
  const elements: PathArray[] = [];
  const parentPath = path.slice(0, path.length - 1);
  for (
    let i = Math.min(path[path.length - 1] as number, length - 1);
    i < length;
    i++
  ) {
    elements.push([...parentPath, i]);
  }
  return elements;
}

export function applyAction(
  action: ScalarAction<PathArray>,
  json: Draft<Json>
):
  | {
      failed?: false;
      changed: PathArray[];
    }
  | {
      failed: true;
      failure: Failure;
    } {
  const { path } = action;
  const foundPath = followPath(path, json);
  if (foundPath.failed) return foundPath;
  const { key, parent, value } = foundPath;
  switch (action.action) {
    case 'Set':
      parent[key] = action.payload;
      return { changed: [path] };
    case 'Delete':
      if (value === undefined) return { changed: [] };
      if (Array.isArray(parent) && typeof key === 'number') {
        parent.splice(key as number, 1);
        return { changed: elementsAfter(path, parent.length + 1) };
      } else {
        delete parent[key];
        return { changed: [path] };
      }
    case 'Add':
    case 'Multiply':
      if (typeof value === 'number') {
        if (action.action === 'Multiply') parent[key] *= action.payload;
        else parent[key] += action.payload;
        return { changed: [path] };
      } else {
        return {
          failed: true,
          failure: { path, message: `${action.action}: not a number` },
        };
      }
    case 'InitArray':
      if (Array.isArray(value)) return { changed: [] };
      parent[key] = [];
      return { changed: [path] };
    case 'InitObject':
      if (isPlainObject(value)) return { changed: [] };
      parent[key] = {};
      return { changed: [path] };
    case 'InsertBefore':
    case 'InsertAfter':
      const parentPath = path.slice(0, path.length - 1);
      if (Array.isArray(parent) && typeof key === 'number') {
        if (key >= parent.length) parent.push(action.payload);
        else if (key < 0) parent.splice(0, 0, action.payload);
        else
          parent.splice(
            action.action === 'InsertAfter' ? key + 1 : key,
            0,
            action.payload
          );
        return { changed: elementsAfter(path, parent.length) };
      }
      return {
        failed: true,
        failure: {
          path: parentPath,
          message: `${action.action}: not an array`,
        },
      };
    case 'InsertUnique':
      if (Array.isArray(value)) {
        if (!value.some((x) => isEqual(x, action.payload))) {
          value.push(action.payload);
          return { changed: [[...path, value.length - 1]] };
        }
      }
      return {
        failed: true,
        failure: { path, message: 'InsertUnique: not an array' },
      };
    case 'Move':
    case 'Copy':
      if (value === undefined) {
        return {
          failed: true,
          failure: {
            path,
            message: `${action.action}: source path does not exist`,
          },
        };
      }
      const toPath = followPath(action.payload, json);
      if (toPath.failed) return toPath;
      toPath.parent[toPath.key] = value;
      if (action.action === 'Move') {
        if (Array.isArray(parent)) parent[key] = null;
        else delete parent[key];
        return { changed: [path, action.payload] };
      }
      return { changed: [action.payload] };
    default:
      return {
        failed: true,
        failure: {
          path,
          message: `not a scalar data action: ${(action as any).action}`,
        },
      };
  }
}
