import { produce, Draft } from 'immer';
import isEqual from 'lodash.isequal';
import isPlainObject from 'lodash.isplainobject';
import last from 'lodash.last';
import {
  Id,
  idCompare,
  idIndex,
  idToString,
  nextStateHash,
  ZERO_ID,
  ZERO_STATE_HASH,
} from './id';
import {
  JsonCacheDatum,
  JsonCacheStructureMarker,
  NonEmptyJsonCacheDatum,
} from './json-cache';
import { Op, SavePoint, SaveState, StateSummary } from './save-state';
import {
  AbsolutePathArray,
  Failure,
  Json,
  JsonScalar,
  JsonArray,
  JsonObject,
  PathArray,
} from './types';
import { Change, ScalarAction, actionToChanges } from './actions';
import { JsonDraftAdapter, followPath } from './json-adapter';
import assert from 'assert';

export interface IdMappedJson {
  readonly root: JsonObject;
  readonly idToPath: { readonly [key: string]: AbsolutePathArray };
  readonly pathToId: PathToIdTree;
}

export interface PathToIdTree {
  readonly ids: readonly Id[];
  readonly subtree?: PathToIdSubtree;
}

export type PathToIdSubtree =
  | readonly PathToIdTree[]
  | { readonly [key: string]: PathToIdTree };

export interface State<Metadata> extends IdMappedJson, StateSummary {
  readonly ops: readonly Op[];
  readonly failures: readonly (Failure & { readonly id: Id })[];
  readonly savePoints: readonly (SavePoint & IdMappedJson)[];
  readonly metadata: Metadata;
}

export interface InMemorySaveStateArgs<Metadata>
  extends Partial<State<Metadata>> {
  readonly metadata: Metadata;
}

const MIN_SAVE_POINT_SIZE = 4;

function getIdsOfPath(path: PathArray, tree: PathToIdTree): readonly Id[] {
  for (const key of path) {
    const subtree = tree.subtree;
    if (!subtree || !Object.prototype.hasOwnProperty.call(subtree, key)) {
      return [];
    }
    tree = subtree[key];
  }
  return tree.ids;
}

function pathToIdSubtree(
  path: PathArray,
  tree: Draft<PathToIdTree>
): Draft<PathToIdTree> {
  for (const key of path) {
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
  from: AbsolutePathArray,
  to: AbsolutePathArray
) {
  const fromTree = pathToIdSubtree(from, pathToId);
  const toTree = pathToIdSubtree(to, pathToId);
  toTree.ids = fromTree.ids;
  toTree.subtree = fromTree.subtree;
  fromTree.ids = [];
  delete fromTree.subtree;

  function moveSubtree(tree: Draft<PathToIdTree>, subpath: PathArray) {
    const path = [...to, ...subpath] as Draft<AbsolutePathArray>;
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

function addIfAbsent<T>(a: T[], b: readonly T[]): void {
  for (const x of b) {
    if (a.every((y) => !isEqual(x, y))) {
      a.push(x);
    }
  }
}

function applyChange(change: Change, id: Id, state: Draft<State<unknown>>) {
  // TODO: Unlink IDs of removed subtrees
  switch (change.type) {
    case 'Put': {
      const parent = change.path.slice(0, change.path.length - 1);
      const index = change.path[change.path.length - 1];
      const { found, value } = followPath(parent, state.root, JsonDraftAdapter);
      if (found && (Array.isArray(value) || isPlainObject(value))) {
        (value as JsonArray | JsonObject)[index] = change.value;
      }
      state.idToPath[idToString(id)] = change.path as Draft<AbsolutePathArray>;
      pathToIdSubtree(change.path, state.pathToId).ids = [id];
      break;
    }
    case 'Delete': {
      const parent = change.path.slice(0, change.path.length - 1);
      const index = change.path[change.path.length - 1];
      const { found, value } = followPath(parent, state.root, JsonDraftAdapter);
      if (found) {
        if (Array.isArray(value) && index === value.length - 1) {
          value.pop();
        } else {
          delete (value as Draft<JsonArray | JsonObject>)[index];
        }
      }
      const subtree = pathToIdSubtree(change.path, state.pathToId);
      const ids = subtree.ids;
      subtree.ids = [];
      for (const id of ids) {
        delete state.idToPath[idToString(id)];
      }
      break;
    }
    case 'Touch':
      state.idToPath[idToString(id)] = change.path as Draft<AbsolutePathArray>;
      addIfAbsent(pathToIdSubtree(change.path, state.pathToId).ids, [id]);
      break;
    case 'Move': {
      const fromParent = change.from.slice(0, change.from.length - 1);
      const toParent = change.to.slice(0, change.to.length - 1);
      const fromIndex = change.from[change.from.length - 1];
      const toIndex = change.to[change.to.length - 1];
      const from = followPath(fromParent, state.root, JsonDraftAdapter);
      const to = followPath(toParent, state.root, JsonDraftAdapter);
      if (from.found && to.found) {
        const moved = (from.value as JsonArray | JsonObject)[fromIndex];
        if (Array.isArray(from.value) && fromIndex === from.value.length - 1) {
          from.value.pop();
        } else {
          delete (from.value as Draft<JsonArray | JsonObject>)[fromIndex];
        }
        (to.value as Draft<JsonArray | JsonObject>)[toIndex] = moved;
      }
      moveTree(state, change.from, change.to);
      break;
    }
  }
}

function applyOp<M>(
  op: Op,
  state: State<M>
): {
  state: State<M>;
  changes: Change[];
  failures: Failure[];
} {
  assert(idIndex(op.id, state.ops, true) < 0, 'op applied twice');
  // FIXME: Transactions get split up into multiple IDs, this is unfinished
  let changes: Change[] = [];
  const failures: Failure[] = [];
  const scalarOps: (ScalarAction<unknown> & Op)[] =
    op.action === 'Transaction'
      ? op.payload.map((a, i) => ({
          ...a,
          id: { author: op.id.author, index: op.id.index + i },
        }))
      : [op];
  let newState = produce(state, (state) => {
    state.hash = nextStateHash(state.hash as Uint8Array, op.id);
    state.ops.push(op as Draft<Op>);
    state.latestIndexes[op.id.author] = Math.max(
      state.latestIndexes[op.id.author] || 0,
      op.id.index
    );
    scalarOps.forEach((op) => {
      const result = actionToChanges(
        op,
        state.root,
        JsonDraftAdapter,
        (id) => state.idToPath[idToString(id)]
      );
      for (const change of result.changes) {
        applyChange(change, op.id, state);
        changes.push(change);
      }
      failures.push(...result.failures);
    });
    state.failures.push(
      ...failures.map((f) => ({ id: op.id, ...(f as Draft<Failure>) }))
    );
    updateSavePoints(state);
  });
  if (op.action === 'Transaction' && failures.length) {
    changes = [];
    const { hash, latestIndexes, ops, failures } = newState;
    newState = { ...state, hash, latestIndexes, ops, failures };
  }
  return { state: newState, changes, failures };
}

function updateSavePoints({
  root,
  idToPath,
  pathToId,
  savePoints,
  ops,
  hash,
  latestIndexes,
}: Draft<State<unknown>>): boolean {
  if (
    ops.length < MIN_SAVE_POINT_SIZE ||
    idCompare(
      ops[ops.length - MIN_SAVE_POINT_SIZE].id,
      last(savePoints)?.id || ZERO_ID
    ) <= 0
  ) {
    return false;
  }
  for (let i = 2; i < savePoints.length; i++) {
    if (savePoints[i].width === savePoints[i - 2].width) {
      savePoints[i - 2].width *= 2;
      savePoints.splice(i - 1, 1);
      break;
    }
  }
  const id = (last(ops) as Op).id;
  savePoints.push({
    root,
    idToPath,
    pathToId,
    id,
    width: MIN_SAVE_POINT_SIZE,
    hash,
    latestIndexes,
  });
  return true;
}

export default class InMemorySaveState<
  Metadata extends { readonly [key: string]: string }
> implements SaveState<Metadata> {
  protected state: State<Metadata>;

  constructor(args: InMemorySaveStateArgs<Metadata>) {
    this.state = {
      root: args.root ?? {},
      idToPath: args.idToPath ?? {},
      pathToId: args.pathToId ?? { ids: [] },
      hash: args.hash ?? ZERO_STATE_HASH,
      latestIndexes: args.latestIndexes ?? {},
      ops: args.ops ?? [],
      failures: args.failures ?? [],
      savePoints: args.savePoints ?? [
        {
          root: {},
          idToPath: {},
          pathToId: { ids: [] },
          id: ZERO_ID,
          width: MIN_SAVE_POINT_SIZE,
          hash: ZERO_STATE_HASH,
          latestIndexes: {},
        },
      ],
      metadata: args.metadata,
    };
  }

  private jsonToDatum(json: Json): JsonScalar | JsonCacheStructureMarker;
  private jsonToDatum(
    json: Json | undefined
  ): JsonScalar | JsonCacheStructureMarker | undefined;

  private jsonToDatum(
    json: Json | undefined
  ): JsonScalar | JsonCacheStructureMarker | undefined {
    if (Array.isArray(json)) {
      return JsonCacheStructureMarker.Array;
    } else if (isPlainObject(json)) {
      return JsonCacheStructureMarker.Object;
    } else {
      return json as JsonScalar | undefined;
    }
  }

  private lookupValue(path: PathArray): Json | undefined {
    let value: Json = this.state.root;
    for (const key of path) {
      if (Array.isArray(value) && typeof key === 'number') {
        value = value[key];
      } else if (isPlainObject(value) && typeof key === 'string') {
        value = (value as JsonObject)[key];
      } else {
        return undefined;
      }
    }
    return value;
  }

  lookupByPath(path: PathArray): JsonCacheDatum {
    return {
      value: this.jsonToDatum(this.lookupValue(path)),
      ids: getIdsOfPath(path, this.state.pathToId),
    };
  }

  lookupById(
    id: Id
  ): (JsonCacheDatum & { readonly path: AbsolutePathArray }) | null {
    const path = this.state.idToPath[idToString(id)] as readonly [
      string,
      ...PathArray
    ];
    if (path) {
      return {
        ...this.lookupByPath(path),
        path,
      };
    }
    return null;
  }

  listObject(
    path: PathArray
  ): readonly (NonEmptyJsonCacheDatum & { key: string })[] {
    const obj = this.lookupValue(path);
    if (isPlainObject(obj)) {
      return [...Object.entries(obj as JsonObject)].map(([key, value]) => ({
        key,
        value: this.jsonToDatum(value),
        ids: getIdsOfPath([...path, key], this.state.pathToId),
      }));
    }
    return [];
  }

  listArray(path: PathArray): readonly NonEmptyJsonCacheDatum[] {
    const arr = this.lookupValue(path);
    if (Array.isArray(arr)) {
      return arr.map((value, key) => ({
        value: this.jsonToDatum(value),
        ids: getIdsOfPath([...path, key], this.state.pathToId),
      }));
    }
    return [];
  }

  insert(
    ops: Op[]
  ): {
    changes: readonly Change[];
    failures: readonly Failure[];
  } {
    ops = ops
      .filter(({ id }) => idIndex(id, this.state.ops, true) < 0)
      .sort((x, y) => idCompare(x.id, y.id));
    if (!ops.length) {
      return { changes: [], failures: [] };
    }

    const changes: Change[] = [];
    const failures: Failure[] = [];
    let insertAfterState = this.state;
    if (idCompare(last(this.state.ops)?.id || ZERO_ID, ops[0].id) >= 0) {
      const opsAfterInsert = this.rewind(ops[0].id);
      insertAfterState = opsAfterInsert.reduce((state, op) => {
        while (ops.length && idCompare(ops[0].id, op.id) < 0) {
          const nextResult = applyOp(ops.shift() as Op, state);
          changes.push(...nextResult.changes);
          failures.push(...nextResult.failures);
          state = nextResult.state;
        }
        const nextResult = applyOp(op, state);
        changes.push(...nextResult.changes);
        return nextResult.state;
      }, this.state);
    }
    this.state = ops.reduce((state, op) => {
      const nextResult = applyOp(op, state);
      changes.push(...nextResult.changes);
      failures.push(...nextResult.failures);
      return nextResult.state;
    }, insertAfterState);
    return { changes, failures };
  }

  ops(maxLength?: number): readonly Op[] {
    if (maxLength == null) {
      return this.state.ops;
    }
    return this.state.ops.slice(
      Math.max(0, this.state.ops.length - maxLength),
      this.state.ops.length
    );
  }

  failures(maxLength?: number): readonly Failure[] {
    if (maxLength == null) {
      return this.state.failures;
    }
    return this.state.failures.slice(
      Math.max(0, this.state.failures.length - maxLength),
      this.state.failures.length
    );
  }

  rewind(latestId: Id): readonly Op[] {
    for (let i = this.state.savePoints.length - 1; i >= 0; i--) {
      const savePoint = this.state.savePoints[i];
      if (idCompare(savePoint.id, latestId) <= 0) {
        const failureRewindIndex = idIndex(latestId, this.state.failures);
        let rewindIndex = idIndex(latestId, this.state.ops);
        if (isEqual(this.state.ops[rewindIndex].id, latestId)) {
          rewindIndex++;
        }
        const savePointIndex = idIndex(savePoint.id, this.state.ops, true) + 1;
        const droppedOps = this.state.ops.slice(rewindIndex);
        const appliedOps = this.state.ops.slice(savePointIndex, rewindIndex);
        this.state = appliedOps.reduce(
          (state, op) => applyOp(op, state).state,
          {
            ...this.state,
            ...savePoint,
            ops: this.state.ops.slice(0, savePointIndex),
            failures: this.state.failures.slice(0, failureRewindIndex),
            savePoints: this.state.savePoints.slice(0, i + 1),
          }
        );
        return droppedOps;
      }
    }
    throw new Error(
      `Cannot rewind to ID ${idToString(
        latestId
      )}. This is earlier than the oldest ID in this store's history.`
    );
  }

  savePoints(): readonly SavePoint[] {
    return this.state.savePoints.map(({ id, hash, width, latestIndexes }) => ({
      id,
      hash,
      width,
      latestIndexes,
    }));
  }

  metadata(): Metadata {
    return this.state.metadata;
  }

  setMetadata(metadata: Metadata): void {
    this.state = { ...this.state, metadata: { ...metadata } };
  }

  stateSummary(): StateSummary {
    return { hash: this.state.hash, latestIndexes: this.state.latestIndexes };
  }
}
