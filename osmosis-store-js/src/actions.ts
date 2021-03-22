import assert from 'assert';
import isEqual from 'lodash.isequal';
import {
  BinaryPath,
  binaryPathAppend,
  binaryPathSplit,
  binaryPathToArray,
} from './binary-path';
import { CausalTree, Id } from './id';
import {
  JsonSource,
  jsonToSource,
  moveJson,
  MutableJsonSource,
  sourceToJson,
} from './json-source';
import {
  CompiledJsonIdPath,
  CompiledJsonPath,
  jsonPathToString,
  queryPaths,
} from './jsonpath';
import OverlayJsonSource from './overlay-json-source';
import { Failure, Json } from './types';
import { flatMap, flatMapAsync } from './utils';

export type Change =
  | {
      type: 'Put';
      path: BinaryPath;
      value: Json;
    }
  | {
      type: 'Delete';
      path: BinaryPath;
    }
  | {
      type: 'Touch';
      path: BinaryPath;
    }
  | {
      type: 'Move';
      to: BinaryPath;
      from: BinaryPath;
    };

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

export type Action<Path> = ScalarAction<Path> | Transaction<Path>;

async function fillNulls(
  changes: Change[],
  path: BinaryPath,
  source: JsonSource
) {
  const { parent, index } = binaryPathSplit(path);
  if (typeof index !== 'number') {
    return;
  }
  const node = await source.getByPath(parent);
  if (!node || typeof node !== 'object' || node.type !== 'array') {
    return;
  }
  for (let i = node.length; i < index; i++) {
    changes.push({
      type: 'Put',
      path: binaryPathAppend(parent, i),
      value: null,
    });
  }
}

export async function actionToChanges(
  action: Action<CompiledJsonPath | CompiledJsonIdPath>,
  id: Id,
  source: JsonSource
): Promise<{
  failures: (Failure & CausalTree)[];
  changes: (Change & CausalTree)[];
  index: number;
}> {
  if (action.action === 'Transaction') {
    const changes: (Change & CausalTree)[] = [];
    const overlay = new OverlayJsonSource(source);
    let index = id.index;
    for (const scalar of action.payload) {
      const result = await scalarActionToChanges(scalar, overlay);
      if (result.failures.length) {
        return {
          changes: [],
          failures: result.failures.map((f) => ({ id, ...f })),
          index: id.index + action.payload.length - 1,
        };
      }
      for (const change of result.changes) {
        const thisId = { ...id, index };
        changes.push({ ...change, id: thisId });
        await applyChange(change, thisId, overlay);
      }
      index++;
    }
    return { changes, failures: [], index: index - 1 };
  }
  const { changes, failures } = await scalarActionToChanges(action, source);
  return {
    changes: changes.map((c) => ({ ...c, id })),
    failures: failures.map((f) => ({ id, ...f })),
    index: id.index,
  };
}

export async function scalarActionToChanges(
  action: ScalarAction<CompiledJsonPath | CompiledJsonIdPath>,
  source: JsonSource
): Promise<{
  failures: Failure[];
  changes: Change[];
}> {
  const changes: Change[] = [];
  const { existing, potential, failures } = await queryPaths(
    action.path,
    source
  );
  switch (action.action) {
    case 'Set':
      for (const path of [...existing, ...potential]) {
        if (!path.byteLength) {
          failures.push({
            message: 'Set: cannot set root',
            path: binaryPathToArray(path),
          });
          continue;
        }
        await fillNulls(changes, path, source);
        changes.push({ type: 'Put', path, value: action.payload });
      }
      break;
    case 'Delete':
      for (const path of existing) {
        if (!path.byteLength) {
          failures.push({
            message: 'Delete: cannot delete root',
            path: binaryPathToArray(path),
          });
          continue;
        }
        const { parent, index } = binaryPathSplit(path);
        if (typeof index === 'number') {
          const node = await source.getByPath(parent);
          assert(node && typeof node == 'object' && node.type === 'array');
          if (node.length > index + 1) {
            for (let i = index + 1; i < node.length; i++) {
              changes.push({
                type: 'Move',
                from: binaryPathAppend(parent, i),
                to: binaryPathAppend(parent, i - 1),
              });
            }
            continue;
          }
        }
        changes.push({ type: 'Delete', path });
      }
      break;
    case 'Add':
    case 'Multiply':
      for (const path of existing) {
        const node = await source.getByPath(path);
        if (typeof node !== 'number') {
          failures.push({
            message: `${action.action}: not a number`,
            path: binaryPathToArray(path),
          });
          continue;
        }
        changes.push({
          type: 'Put',
          path,
          value:
            action.action === 'Add'
              ? node + action.payload
              : node * action.payload,
        });
      }
      break;
    case 'InitArray':
      for (const path of [...existing, ...potential]) {
        if (!path.byteLength) {
          failures.push({ message: 'InitArray: cannot set root', path: [] });
          continue;
        }
        const node = await source.getByPath(path);
        if (node && typeof node === 'object' && node.type === 'array') {
          changes.push({ type: 'Touch', path });
        } else {
          await fillNulls(changes, path, source);
          changes.push({ type: 'Put', path, value: [] });
        }
      }
      break;
    case 'InitObject':
      for (const path of [...existing, ...potential]) {
        if (!path.byteLength) {
          continue;
        }
        const node = await source.getByPath(path);
        if (node && typeof node === 'object' && node.type === 'object') {
          changes.push({ type: 'Touch', path });
        } else {
          await fillNulls(changes, path, source);
          changes.push({ type: 'Put', path, value: {} });
        }
      }
      break;
    case 'InsertBefore':
    case 'InsertAfter':
      for (const path of [...existing, ...potential]) {
        // eslint-disable-next-line prefer-const
        let { index, parent } = binaryPathSplit(path);
        if (typeof index !== 'number') {
          failures.push({
            message: `${action.action}: not an array index`,
            path: binaryPathToArray(path),
          });
          continue;
        }
        if (action.action === 'InsertAfter') {
          index++;
        }
        const node = await source.getByPath(parent);
        assert(node && typeof node === 'object' && node.type === 'array');
        if (index > node.length) {
          index = node.length;
        }
        for (let i = node.length; i > index; i--) {
          changes.push({
            type: 'Move',
            from: binaryPathAppend(parent, i - 1),
            to: binaryPathAppend(parent, i),
          });
        }
        changes.push({
          type: 'Put',
          path: binaryPathAppend(parent, index),
          value: action.payload,
        });
      }
      break;
    case 'InsertUnique':
      nextPath: for (const path of existing) {
        const node = await source.getByPath(path);
        if (!node || typeof node !== 'object' || node.type !== 'array') {
          failures.push({
            message: 'InsertUnique: not an array',
            path: binaryPathToArray(path),
          });
          continue;
        }
        for (let i = 0; i < node.length; i++) {
          const subpath = binaryPathAppend(path, i);
          // FIXME: use isJsonEqual to avoid pulling entire array into memory
          if (isEqual(action.payload, await sourceToJson(source, subpath))) {
            changes.push({ type: 'Touch', path: subpath });
            continue nextPath;
          }
        }
        changes.push({
          type: 'Put',
          path: binaryPathAppend(path, node.length),
          value: action.payload,
        });
      }
      break;
    case 'Move': {
      let canMove = !failures.length;
      const destinations = [...existing, ...potential];
      if (!destinations.length) {
        if (!failures.length) {
          failures.push({
            message: 'Move: no destination path',
            path: jsonPathToString(action.path),
          });
        }
        canMove = false;
      } else if (destinations.length > 1) {
        failures.push({
          message: 'Move: more than one destination path',
          path: jsonPathToString(action.path),
        });
        canMove = false;
      } else if (!destinations[0].byteLength) {
        failures.push({ message: 'Move: cannot move to root', path: [] });
      }
      const { existing: sources, failures: sourceFailures } = await queryPaths(
        action.payload,
        source
      );
      failures.push(...sourceFailures);
      if (sourceFailures.length) {
        canMove = false;
      }
      if (!sources.length) {
        if (!sourceFailures.length) {
          failures.push({
            message: 'Move: no source path',
            path: jsonPathToString(action.payload),
          });
        }
        canMove = false;
      } else if (sources.length > 1) {
        failures.push({
          message: 'Move: more than one source path',
          path: jsonPathToString(action.payload),
        });
        canMove = false;
      } else if (!sources[0].byteLength) {
        failures.push({ message: 'Move: cannot move root', path: [] });
      }
      if (canMove) {
        const [to] = potential;
        const [from] = sources;
        await fillNulls(changes, to, source);
        changes.push({ type: 'Move', from, to });
        const { parent, index } = binaryPathSplit(from);
        if (typeof index === 'number') {
          const node = await source.getByPath(parent);
          assert(node && typeof node === 'object' && node.type === 'array');
          for (let i = index; i < node.length; i++) {
            changes.push({
              type: 'Move',
              from: binaryPathAppend(parent, i + 1),
              to: binaryPathAppend(parent, i),
            });
          }
        }
      }
      break;
    }
    case 'Copy': {
      const { existing: sources, failures: sourceFailures } = await queryPaths(
        action.payload,
        source
      );
      failures.push(...sourceFailures);
      if (!sourceFailures.length) {
        if (!sources.length) {
          failures.push({
            message: 'Copy: no source path',
            path: jsonPathToString(action.payload),
          });
        } else if (sources.length > 1) {
          failures.push({
            message: 'Copy: more than one source path',
            path: jsonPathToString(action.payload),
          });
        } else if (!sources[0].byteLength) {
          failures.push({ message: 'Copy: cannot copy root', path: [] });
        } else {
          const [from] = sources;
          const jsonValue = await sourceToJson(source, from);
          for (const path of [...existing, ...potential]) {
            if (path.byteLength) {
              await fillNulls(changes, path, source);
              changes.push({ type: 'Put', path, value: jsonValue });
            } else {
              failures.push({ message: 'Copy: cannot copy to root', path: [] });
            }
          }
        }
      }
      break;
    }
    default:
      failures.push({
        message: `not a scalar action type: ${(action as any).action}`,
        path: jsonPathToString((action as any).path),
      });
  }
  return { changes, failures };
}

async function addParentKey(path: BinaryPath, dest: MutableJsonSource) {
  const { parent, index } = binaryPathSplit(path);
  if (typeof index === 'string') {
    const keys = ((await dest.getByPath(parent)) as any)?.keys ?? [];
    if (!keys.includes(index)) {
      await dest.setByPath(parent, {
        type: 'object',
        keys: [...keys, index],
      });
    }
  } else if (typeof index === 'number') {
    const length = ((await dest.getByPath(parent)) as any)?.length ?? 0;
    if (index >= length) {
      await dest.setByPath(parent, { type: 'array', length: index + 1 });
    }
  }
}

async function deleteParentKey(path: BinaryPath, dest: MutableJsonSource) {
  const { parent, index } = binaryPathSplit(path);
  if (typeof index === 'string') {
    const keys: string[] = ((await dest.getByPath(parent)) as any)?.keys ?? [];
    await dest.setByPath(parent, {
      type: 'object',
      keys: keys.filter((k) => k !== index),
    });
  } else if (typeof index === 'number') {
    const length = ((await dest.getByPath(parent)) as any)?.length ?? 0;
    if (index === length - 1) {
      await dest.setByPath(parent, { type: 'array', length: index });
    }
  }
}

export async function applyChange(
  change: Change,
  id: Id,
  dest: MutableJsonSource
): Promise<void> {
  switch (change.type) {
    case 'Put':
      await jsonToSource(change.value, dest, change.path);
      await dest.setIdsByPath(change.path, [id]);
      await addParentKey(change.path, dest);
      break;
    case 'Delete':
      await dest.deleteByPath(change.path);
      await deleteParentKey(change.path, dest);
      break;
    case 'Touch':
      await dest.setIdsByPath(change.path, [id]);
      break;
    case 'Move':
      await deleteParentKey(change.from, dest);
      await moveJson(change.from, change.to, dest);
      await addParentKey(change.to, dest);
      break;
  }
}

export function mapAction<T, U>(
  action: ScalarAction<T>,
  f: (path: T) => U
): ScalarAction<U>;

export function mapAction<T, U>(
  action: Action<T>,
  f: (path: T) => U
): Action<U> {
  switch (action.action) {
    case 'Transaction':
      return {
        ...action,
        payload: action.payload.map((a) => mapAction(a, f) as ScalarAction<U>),
      };
    case 'Copy':
    case 'Move':
      return { ...action, path: f(action.path), payload: f(action.payload) };
    default:
      return { ...action, path: f(action.path) };
  }
}

export async function mapActionToList<T, U>(
  action: Action<T>,
  f: (path: T) => Promise<U[]>
): Promise<Action<U>[]> {
  switch (action.action) {
    case 'Transaction':
      return [
        {
          ...action,
          payload: await flatMapAsync(
            action.payload,
            (a) => mapActionToList(a, f) as Promise<ScalarAction<U>[]>
          ),
        },
      ];
    case 'Copy': {
      const path = await f(action.path);
      if (path.length !== 1) {
        throw new Error('Copy action must have exactly one source path');
      }
      return flatMap(await f(action.payload), (payload) => ({
        ...action,
        path: path[0],
        payload,
      }));
    }
    case 'Move': {
      const path = await f(action.path);
      const payload = await f(action.payload);
      if (path.length !== 1) {
        throw new Error('Move action must have exactly one source path');
      }
      if (payload.length !== 1) {
        throw new Error('Move action must have exactly one destination path');
      }
      return [{ ...action, path: path[0], payload: payload[0] }];
    }
    default:
      return flatMap(await f(action.path), (path) => ({ ...action, path }));
  }
}
