import { Id } from './id';
import {
  followPath,
  isJsonEqual,
  JsonAdapter,
  JsonJsonAdapter,
  toJsonWithAdapter,
} from './json-adapter';
import {
  CompiledJsonIdPath,
  CompiledJsonPath,
  jsonPathToString,
  queryPaths,
} from './jsonpath';
import { AbsolutePathArray, Failure, Json, PathArray } from './types';
import { flatMap, flatMapAsync, last } from './utils';

export type Change =
  | {
      type: 'Put';
      path: AbsolutePathArray;
      value: Json;
    }
  | {
      type: 'Delete';
      path: AbsolutePathArray;
    }
  | {
      type: 'Touch';
      path: AbsolutePathArray;
    }
  | {
      type: 'Move';
      to: AbsolutePathArray;
      from: AbsolutePathArray;
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

function isValidPath(path: PathArray): path is AbsolutePathArray {
  return !!path.length;
}

async function fillNulls<T>(
  changes: Change[],
  path: AbsolutePathArray,
  json: T,
  adapter: JsonAdapter<T>
) {
  const index = last(path);
  if (typeof index !== 'number') {
    return;
  }
  const parent = path.slice(0, path.length - 1);
  const { value } = await followPath(parent, json, adapter);
  const length = await adapter.arrayLength(value as T);
  if (length == null || length >= index) {
    return;
  }
  for (let i = length; i < index; i++) {
    changes.push({
      type: 'Put',
      path: ([...parent, i] as unknown) as AbsolutePathArray,
      value: null,
    });
  }
}

export function actionToChanges<T>(
  action: ScalarAction<CompiledJsonPath>,
  json: T,
  adapter: JsonAdapter<T>
): Promise<{
  failures: Failure[];
  changes: Change[];
}>;

export function actionToChanges<T>(
  action: ScalarAction<CompiledJsonPath | CompiledJsonIdPath>,
  json: T,
  adapter: JsonAdapter<T>,
  idToPath: (id: Id) => PathArray | undefined
): Promise<{
  failures: Failure[];
  changes: Change[];
}>;

export async function actionToChanges<T>(
  action: ScalarAction<CompiledJsonPath | CompiledJsonIdPath>,
  json: T,
  adapter: JsonAdapter<T>,
  idToPath: (id: Id) => PathArray | undefined = () => undefined
): Promise<{
  failures: Failure[];
  changes: Change[];
}> {
  const changes: Change[] = [];
  const { existing, potential, failures } = await queryPaths(
    action.path,
    json,
    adapter,
    idToPath
  );
  switch (action.action) {
    case 'Set':
      for (const path of [...existing, ...potential]) {
        if (isValidPath(path)) {
          await fillNulls(changes, path, json, adapter);
          changes.push({ type: 'Put', path, value: action.payload });
        } else {
          failures.push({ message: 'Set: cannot set root', path });
        }
      }
      break;
    case 'Delete':
      for (const path of existing) {
        if (isValidPath(path)) {
          const index = last(path);
          if (typeof index === 'number') {
            const parent = (path.slice(
              0,
              path.length - 1
            ) as unknown) as AbsolutePathArray;
            const { value } = await followPath(parent, json, adapter);
            const length = await adapter.arrayLength(value as T);
            if (length && length > index + 1) {
              for (let i = index + 1; i < length; i++) {
                changes.push({
                  type: 'Move',
                  from: [...parent, i],
                  to: [...parent, i - 1],
                });
              }
              continue;
            }
          }
          changes.push({ type: 'Delete', path });
        } else {
          failures.push({ message: 'Delete: cannot delete root', path });
        }
      }
      break;
    case 'Add':
      for (const path of existing) {
        const { found, value } = await followPath(path, json, adapter);
        if (
          found &&
          isValidPath(path) &&
          adapter.typeOf(value as T) === 'number'
        ) {
          changes.push({
            type: 'Put',
            path,
            value: (adapter.numberValue(value as T) as number) + action.payload,
          });
        } else {
          failures.push({ message: 'Add: not a number', path });
        }
      }
      break;
    case 'Multiply':
      for (const path of existing) {
        const { found, value } = await followPath(path, json, adapter);
        if (
          found &&
          isValidPath(path) &&
          adapter.typeOf(value as T) === 'number'
        ) {
          changes.push({
            type: 'Put',
            path,
            value: (adapter.numberValue(value as T) as number) * action.payload,
          });
        } else {
          failures.push({ message: 'Multiply: not a number', path });
        }
      }
      break;
    case 'InitArray':
      for (const path of [...existing, ...potential]) {
        if (isValidPath(path)) {
          const { found, value } = await followPath(path, json, adapter);
          if (found && adapter.typeOf(value as T) === 'array') {
            changes.push({ type: 'Touch', path });
          } else {
            await fillNulls(changes, path, json, adapter);
            changes.push({ type: 'Put', path, value: [] });
          }
        } else {
          failures.push({ message: 'InitArray: cannot set root', path });
        }
      }
      break;
    case 'InitObject':
      for (const path of [...existing, ...potential]) {
        if (isValidPath(path)) {
          const { found, value } = await followPath(path, json, adapter);
          if (found && adapter.typeOf(value as T) === 'object') {
            changes.push({ type: 'Touch', path });
          } else {
            await fillNulls(changes, path, json, adapter);
            changes.push({ type: 'Put', path, value: {} });
          }
        }
      }
      break;
    case 'InsertBefore':
    case 'InsertAfter':
      for (const path of [...existing, ...potential]) {
        let index = last(path);
        if (typeof index === 'number' && isValidPath(path)) {
          if (action.action === 'InsertAfter') {
            index++;
          }
          const parent = (path.slice(
            0,
            path.length - 1
          ) as unknown) as AbsolutePathArray;
          const { value } = await followPath(parent, json, adapter);
          const length = (await adapter.arrayLength(value as T)) || 0;
          if (index > length) {
            index = length;
          }
          for (let i = length; i > index; i--) {
            changes.push({
              type: 'Move',
              from: [...parent, i - 1],
              to: [...parent, i],
            });
          }
          changes.push({
            type: 'Put',
            path: [...parent, index],
            value: action.payload,
          });
        } else {
          failures.push({
            message: `${action.action}: not an array index`,
            path,
          });
        }
      }
      break;
    case 'InsertUnique':
      nextPath: for (const path of existing) {
        const { value } = await followPath(path, json, adapter);
        const length = await adapter.arrayLength(value as T);
        if (length != null) {
          for (const [i, element] of (await adapter.listEntries(json)) || []) {
            if (
              await isJsonEqual(
                element,
                action.payload,
                adapter,
                JsonJsonAdapter
              )
            ) {
              changes.push({
                type: 'Touch',
                path: ([...path, i] as unknown) as AbsolutePathArray,
              });
              continue nextPath;
            }
          }
          changes.push({
            type: 'Put',
            path: ([...path, length] as unknown) as AbsolutePathArray,
            value: action.payload,
          });
        } else {
          failures.push({ message: 'InsertUnique: not an array', path });
        }
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
      } else if (!isValidPath(destinations[0])) {
        failures.push({ message: 'Move: cannot move to root', path: [] });
      }
      const { existing: sources, failures: sourceFailures } = await queryPaths(
        action.payload,
        json,
        adapter,
        idToPath
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
      } else if (!isValidPath(sources[0])) {
        failures.push({ message: 'Move: cannot move root', path: [] });
      }
      if (canMove) {
        const [to] = (potential as unknown) as AbsolutePathArray[];
        const [from] = (sources as unknown) as AbsolutePathArray[];
        await fillNulls(changes, to as AbsolutePathArray, json, adapter);
        changes.push({ type: 'Move', from, to });
        const index = last(from);
        if (typeof index === 'number') {
          const parent = (from.slice(
            0,
            from.length - 1
          ) as unknown) as AbsolutePathArray;
          const { value } = await followPath(parent, json, adapter);
          const length = await adapter.arrayLength(value as T);
          if (length && length > index) {
            for (let i = index; i < length; i++) {
              changes.push({
                type: 'Move',
                from: [...parent, i + 1],
                to: [...parent, i],
              });
            }
          }
        }
      }
      break;
    }
    case 'Copy': {
      const { existing: sources, failures: sourceFailures } = await queryPaths(
        action.payload,
        json,
        adapter,
        idToPath
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
        } else if (!isValidPath(sources[0])) {
          failures.push({ message: 'Copy: cannot copy root', path: [] });
        } else {
          const [from] = sources;
          const { value } = await followPath(from, json, adapter);
          const jsonValue = await toJsonWithAdapter(value as T, adapter);
          for (const path of [...existing, ...potential]) {
            if (isValidPath(path)) {
              await fillNulls(changes, path, json, adapter);
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
