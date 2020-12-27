import { Draft } from 'immer';
import flatMap from 'lodash.flatmap';
import isPlainObject from 'lodash.isplainobject';
import last from 'lodash.last';
import {
  Action,
  applyAction,
  mapAction,
  mapActionToList,
  ScalarAction,
} from './actions';
import { Id, idToString } from './id';
import * as JsonPath from './jsonpath';
import { CompiledJsonIdPath, CompiledJsonPath } from './jsonpath';
import { Failure, Json, JsonObject, PathArray } from './types';

export interface IdMappedJson {
  readonly root: JsonObject;
  readonly idToPath: { readonly [key: string]: PathArray };
  readonly pathToId: PathToIdTree;
}

export interface PathToIdTree {
  readonly ids: readonly Id[];
  readonly subtree?: PathToIdSubtree;
}

export type PathToIdSubtree =
  | readonly PathToIdTree[]
  | { readonly [key: string]: PathToIdTree };

function followPath(
  path: PathArray,
  tree: Draft<PathToIdTree>
): Draft<PathToIdTree> {
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    let subtree = tree.subtree;
    if (!subtree) {
      subtree = typeof key === 'number' ? [] : {};
      tree.subtree = subtree;
    }
    if (!Object.prototype.hasOwnProperty.call(subtree, key)) {
      subtree[key] = { ids: [] };
    }
    tree = subtree[key];
  }
  return tree;
}

function moveTree(
  { idToPath, pathToId }: Draft<IdMappedJson>,
  from: PathArray,
  to: PathArray
) {
  const fromTree = followPath(from, pathToId);
  const toTree = followPath(to, pathToId);
  toTree.ids = fromTree.ids;
  toTree.subtree = fromTree.subtree;
  fromTree.ids = [];
  delete fromTree.subtree;

  function moveSubtree(tree: Draft<PathToIdTree>, subpath: PathArray) {
    const path = [...to, ...subpath] as Draft<PathArray>;
    tree.ids.forEach((id) => (idToPath[idToString(id)] = path));
    if (Array.isArray(tree.subtree)) {
      tree.subtree.forEach((t, i) => moveSubtree(t, [...subpath, i]));
    } else if (isPlainObject(tree.subtree)) {
      Object.entries(tree.subtree as object).forEach(([k, v]) =>
        moveSubtree(v, [...subpath, k])
      );
    }
  }

  moveSubtree(toTree, []);
}

export function applyIdMappedAction(
  action: ScalarAction<{ id?: Id; path: PathArray }>,
  { root, idToPath, pathToId }: Draft<IdMappedJson>
):
  | {
      failed?: false;
      changed: PathArray[];
    }
  | {
      failed: true;
      failure: Failure;
    } {
  const result = applyAction(
    mapAction(action, (x) => x.path),
    root
  );
  if (result.failed || !action.path.id) {
    return result;
  }
  const { path, id } = action.path;
  switch (action.action) {
    case 'Set':
    case 'InsertUnique':
    case 'Copy': {
      if (result.changed.length) {
        const [path] = result.changed;
        const tree = followPath(path, pathToId);
        for (const id of tree.ids) {
          delete idToPath[idToString(id)];
        }
        tree.ids = [id];
        idToPath[idToString(id)] = path as Draft<PathArray>;
      }
      break;
    }
    case 'Delete':
      if (result.changed.length) {
        const tree = followPath(path, pathToId);
        for (const id of tree.ids) {
          delete idToPath[idToString(id)];
        }
        tree.ids = [];
        if (typeof last(path) === 'number') {
          const parentPath = path.slice(0, path.length - 1);
          const indexes = result.changed.map(last).sort() as number[];
          indexes.forEach((i) => {
            moveTree(
              { root, idToPath, pathToId },
              [...parentPath, i + 1],
              [...parentPath, i]
            );
          });
        }
      }
      break;
    case 'InitArray':
    case 'InitObject':
      if (result.changed.length) {
        followPath(path, pathToId).ids = [id];
      } else {
        followPath(path, pathToId).ids.push(id);
      }
      idToPath[idToString(id)] = path as Draft<PathArray>;
      break;
    case 'Move':
      if (result.changed.length) {
        moveTree({ root, idToPath, pathToId }, path, action.payload.path);
      }
      break;
    case 'InsertBefore':
    case 'InsertAfter':
      if (result.changed.length) {
        const parentPath = path.slice(0, path.length - 1);
        const indexes = result.changed.map(last).sort() as number[];
        indexes.forEach((i) => {
          moveTree(
            { root, idToPath, pathToId },
            [...parentPath, i],
            [...parentPath, i + 1]
          );
        });
        followPath([...parentPath, indexes[0]], pathToId).ids = [id];
        idToPath[idToString(id)] = [...parentPath, indexes[0]];
      }
  }
  return result;
}

export function splitIntoActionsWithDirectPaths(
  action: Action<CompiledJsonPath | CompiledJsonIdPath>,
  json: IdMappedJson,
  id?: Id
): {
  actions: Action<{ id?: Id; path: PathArray }>[];
  failures: Failure[];
} {
  if (action.action === 'Transaction') {
    try {
      return {
        actions: [
          {
            ...action,
            payload: flatMap(action.payload, (action) => {
              const { actions, failures } = splitIntoActionsWithDirectPaths(
                action,
                json,
                id
              );
              if (failures.length) {
                throw failures.map((f) => ({ ...f, id }));
              }
              if (id) {
                id = { ...id, index: id.index + 1 };
              }
              return actions as ScalarAction<any>[];
            }),
          },
        ],
        failures: [],
      };
    } catch (failures) {
      if (Array.isArray(failures)) {
        return { actions: [], failures };
      }
      throw failures;
    }
  }
  // eslint-disable-next-line prefer-const
  let { existing, potential, failures } = queryPaths(json, action.path);
  failures = failures.map((f) => ({ ...f, id }));
  switch (action.action) {
    case 'Set':
    case 'InitArray':
    case 'InitObject':
      return {
        actions: mapActionToList(action, (p) => {
          const assignedId = id && JsonPath.isSingularPath(p) ? id : undefined;
          return [...existing, ...potential].map((path) => ({
            id: assignedId,
            path,
          }));
        }),
        failures,
      };
    case 'Move': {
      failures.push(
        ...potential.map((path) => ({
          path,
          id,
          message: 'path does not exist',
        }))
      );
      const to = queryPaths(json, action.payload);
      failures.push(...to.failures);
      const [path] = existing;
      const [payload] = [...to.existing, ...to.potential];
      return {
        actions: [
          { ...action, path: { id, path }, payload: { id, path: payload } },
        ],
        failures,
      };
    }
    case 'Copy': {
      failures.push(
        ...potential.map((path) => ({
          path,
          id,
          message: 'path does not exist',
        }))
      );
      const to = queryPaths(json, action.payload);
      failures.push(...to.failures);
      const [path] = existing;
      const assignedId =
        id && JsonPath.isSingularPath(action.path) ? id : undefined;
      return {
        actions: [...to.existing, ...to.potential].map((payload) => ({
          ...action,
          path: { id: assignedId, path },
          payload: { id: assignedId, path: payload },
        })),
        failures,
      };
    }
    default:
      failures.push(
        ...potential.map((path) => ({
          path,
          id,
          message: 'path does not exist',
        }))
      );
      return {
        actions: mapActionToList(action, (p) => {
          const assignedId = id && JsonPath.isSingularPath(p) ? id : undefined;
          return existing.map((path) => ({ id: assignedId, path }));
        }),
        failures,
      };
  }
}

export function queryPaths(
  { root, idToPath }: IdMappedJson,
  path: CompiledJsonPath | CompiledJsonIdPath
): {
  existing: PathArray[];
  potential: PathArray[];
  failures: Failure[];
} {
  if (!path.length) {
    return {
      existing: [[]],
      potential: [],
      failures: [],
    };
  }
  const [first, ...rest] = path as CompiledJsonIdPath;
  if (first.type === 'Id') {
    const idPath = idToPath[idToString(first.query.id)];
    if (idPath) {
      const subroot = idPath.reduce((j, i) => j?.[i], root);
      if (subroot) {
        const result = JsonPath.queryPaths(subroot, rest);
        return {
          existing: result.existing.map((p) => [...idPath, ...p]),
          potential: result.potential.map((p) => [...idPath, ...p]),
          failures: result.failures.map((f) => ({
            ...f,
            path: [...idPath, ...f.path],
          })),
        };
      }
    }
    path = [
      ...(first.query.path.map((query) => ({
        type: typeof query === 'number' ? 'Index' : 'Key',
        query,
      })) as CompiledJsonPath),
      ...rest,
    ];
  }
  return JsonPath.queryPaths(root, path as CompiledJsonPath);
}

export function queryValues(
  { root, idToPath }: IdMappedJson,
  path: CompiledJsonPath | CompiledJsonIdPath
): Json[] {
  if (!path.length) {
    return [root];
  }
  const [first, ...rest] = path as CompiledJsonIdPath;
  if (first.type === 'Id') {
    const idPath = idToPath[idToString(first.query.id)];
    if (idPath) {
      const subroot = idPath.reduce((j, i) => j?.[i], root);
      if (subroot) {
        return JsonPath.queryValues(subroot, rest);
      }
    }
    path = [
      ...(first.query.path.map((query) => ({
        type: typeof query === 'number' ? 'Index' : 'Key',
        query,
      })) as CompiledJsonPath),
      ...rest,
    ];
  }
  return JsonPath.queryValues(root, path as CompiledJsonPath);
}

export function anchorPathToId(
  { pathToId }: IdMappedJson,
  path: CompiledJsonPath
): CompiledJsonPath | CompiledJsonIdPath {
  let lastIdIndex = -1;
  let lastId: Id | undefined;
  let tree = pathToId;
  const queryPath: (string | number)[] = [];
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    if (tree?.subtree && (segment.type === 'Index' || segment.type === 'Key')) {
      if (!Object.prototype.hasOwnProperty.call(tree.subtree, segment.query)) {
        break;
      }
      tree = tree.subtree[segment.query];
      queryPath.push(segment.query);
      if (tree?.ids?.length) {
        lastIdIndex = i;
        lastId = tree.ids[0];
      }
    } else {
      break;
    }
  }
  if (!lastId) {
    return path;
  }
  return [
    { type: 'Id', query: { id: lastId, path: queryPath } },
    ...path.slice(lastIdIndex + 1),
  ];
}
