import isEqual from 'lodash.isequal';
import {
  BinaryPath,
  binaryPathAppend,
  EMPTY_PATH,
  iterateBinaryPath,
} from './binary-path';
import { Id } from './id';
import { Json, JsonScalar } from './types';
import { isObject } from './utils';

export type JsonNode = JsonScalar | JsonStructure;
export type JsonStructure =
  | {
      readonly type: 'array';
      readonly length: number;
    }
  | {
      readonly type: 'object';
      readonly keys: string[];
    };

export interface JsonSource {
  getByPath(path: BinaryPath): Promise<JsonNode | undefined>;
  getById(id: Id): Promise<JsonNode | undefined>;
  getPathById(id: Id): Promise<BinaryPath | undefined>;
  getIdsByPath(path: BinaryPath): Promise<Id[]>;
  getIdsAfter(
    id: Id
  ): Promise<Iterable<{ readonly id: Id; readonly path: BinaryPath }>>;
}

export interface MutableJsonSource extends JsonSource {
  setByPath(path: BinaryPath, value: JsonNode, id?: Id): Promise<void>;
  deleteByPath(path: BinaryPath): Promise<JsonNode | undefined>;
  addIdToPath(path: BinaryPath, id: Id): Promise<void>;
  setIdsByPath(path: BinaryPath, ids: Id[]): Promise<void>;
}

export abstract class AnonymousJsonSource implements JsonSource {
  abstract getByPath(path: BinaryPath): Promise<JsonNode | undefined>;
  async getById(): Promise<undefined> {
    return;
  }
  async getPathById(): Promise<undefined> {
    return;
  }
  async getIdsByPath(): Promise<never[]> {
    return [];
  }
  async getIdsAfter(): Promise<never[]> {
    return [];
  }
}

export class ConstantJsonSource extends AnonymousJsonSource {
  constructor(readonly json: Json) {
    super();
  }

  async getByPath(path: BinaryPath): Promise<JsonNode | undefined> {
    let json: Json = this.json;
    for (const index of iterateBinaryPath(path)) {
      if (typeof index === 'string' && isObject(json)) {
        json = json[index];
      } else if (typeof index === 'number' && Array.isArray(json)) {
        json = json[index];
      } else {
        return;
      }
    }
    if (isObject(json)) {
      return { type: 'object', keys: Object.keys(json) };
    } else if (Array.isArray(json)) {
      return { type: 'array', length: json.length };
    }
    return json;
  }
}

type StjEntry =
  | [BinaryPath, number, Json[]]
  | [BinaryPath, string, { [key: string]: Json }];

export async function sourceToJson(
  source: JsonSource,
  root: BinaryPath = EMPTY_PATH
): Promise<Json> {
  const rootNode = await source.getByPath(root);
  if (!rootNode || typeof rootNode !== 'object') {
    return rootNode ?? null;
  }
  function enumerate(
    path: BinaryPath,
    struct: JsonStructure
  ): [Json[] | { [key: string]: Json }, StjEntry[]] {
    if (struct.type === 'array') {
      const value = [];
      return [
        value,
        [...new Array(struct.length)].map(
          (_, i) => [binaryPathAppend(path, i), i, value] as StjEntry
        ),
      ];
    }
    const value = {};
    return [
      value,
      struct.keys.map((k) => [binaryPathAppend(path, k), k, value] as StjEntry),
    ];
  }
  const [rootValue, queue] = enumerate(root, rootNode);
  while (queue.length) {
    const [path, index, struct] = queue.shift() as StjEntry;
    const node = await source.getByPath(path);
    if (node && typeof node === 'object') {
      const [value, newEntries] = enumerate(path, node);
      queue.push(...newEntries);
      struct[index] = value;
    } else {
      struct[index] = node;
    }
  }
  return rootValue;
}

export async function jsonToSource(
  json: Json,
  source: MutableJsonSource,
  root: BinaryPath = EMPTY_PATH
): Promise<void> {
  if (Array.isArray(json)) {
    await source.setByPath(root, { type: 'array', length: json.length });
    await Promise.all(
      json.map((x, i) => jsonToSource(x, source, binaryPathAppend(root, i)))
    );
  } else if (isObject(json)) {
    await source.setByPath(root, { type: 'object', keys: Object.keys(json) });
    await Promise.all(
      Object.entries(json).map(([k, v]) =>
        jsonToSource(v, source, binaryPathAppend(root, k))
      )
    );
  } else {
    await source.setByPath(root, json);
  }
}

type MoveEntry = {
  from: BinaryPath;
  to: BinaryPath;
  node: JsonNode;
  ids: Id[];
};

export async function moveJson(
  from: BinaryPath,
  to: BinaryPath,
  source: MutableJsonSource,
  dest: MutableJsonSource = source
): Promise<void> {
  const entries: MoveEntry[] = [];
  const queue: BinaryPath[] = [from];
  while (queue.length) {
    const path = queue.shift() as BinaryPath;
    const ids = await source.getIdsByPath(path);
    const node = await source.getByPath(path);
    if (node === undefined) {
      continue;
    }
    entries.push({
      from: path,
      to: Buffer.concat([to, path.subarray(from.byteLength)]),
      node,
      ids,
    });
    if (node && typeof node === 'object') {
      if (node.type === 'array') {
        for (let i = 0; i < node.length; i++) {
          queue.push(binaryPathAppend(path, i));
        }
      } else {
        queue.push(...node.keys.map((k) => binaryPathAppend(path, k)));
      }
    }
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    source.deleteByPath(entries[i].from);
  }
  for (const { to, node, ids } of entries) {
    dest.setByPath(to, node);
    dest.setIdsByPath(to, ids);
  }
}

export async function isJsonEqual(
  path1: BinaryPath,
  path2: BinaryPath,
  source1: JsonSource,
  source2: JsonSource = source1
): Promise<boolean> {
  const node1 = await source1.getByPath(path1);
  const node2 = await source2.getByPath(path2);
  if (!isEqual(node1, node2)) {
    return false;
  }
  if (node1 && typeof node1 === 'object') {
    const elements = await Promise.all(
      node1.type === 'array'
        ? [...new Array(node1.length)].map((_, i) =>
            isJsonEqual(
              binaryPathAppend(path1, i),
              binaryPathAppend(path2, i),
              source1,
              source2
            )
          )
        : node1.keys.map((k) =>
            isJsonEqual(
              binaryPathAppend(path1, k),
              binaryPathAppend(path2, k),
              source1,
              source2
            )
          )
    );
    return elements.every((x) => x);
  }
  return true;
}
