import nearley from 'nearley';
import { Action, mapAction, ScalarAction } from './actions';
import {
  BinaryPath,
  binaryPathAppend,
  binaryPathToArray,
  EMPTY_PATH,
  pathArrayToBinary,
} from './binary-path';
import { Id } from './id';
import {
  JsonNode,
  JsonSource,
  JsonStructure,
  sourceToJson,
} from './json-source';
import grammar from './jsonpath.grammar';
import { Failure, Json, JsonScalar, PathArray } from './types';
import { flatMap, flatMapAsync, isEqual, reduceAsync } from './utils';

export type JsonPath = string;

export type CompiledJsonPath = readonly JsonPathSegment[];

export type CompiledJsonIdPath = readonly [
  IdSegment | JsonPathSegment,
  ...JsonPathSegment[]
];

export type Vars = { readonly [name: string]: Json } | readonly Json[];

export type JsonPathScalarAction = ScalarAction<JsonPath> & {
  readonly vars?: Vars;
};

export interface JsonPathTransaction {
  action: 'Transaction';
  payload: JsonPathScalarAction[];
}

export type JsonPathAction = JsonPathTransaction | JsonPathScalarAction;

export type JsonPathSegment =
  | WildcardSegment
  | KeySegment
  | IndexSegment
  | MultiKeySegment
  | MultiIndexSegment
  | ExprIndexSegment
  | SliceSegment
  | ExprSliceSegment
  | FilterSegment
  | RecursiveSegment;

export type JsonPathExpr =
  | UnaryExpr
  | BinaryExpr
  | IfExpr
  | LiteralExpr
  | readonly ['self'];

export interface WildcardSegment {
  readonly type: 'Wildcard';
}

export interface KeySegment {
  readonly type: 'Key';
  readonly query: string;
}

export interface IndexSegment {
  readonly type: 'Index';
  readonly query: number;
}

export interface MultiKeySegment {
  readonly type: 'MultiKey';
  readonly query: readonly [string, ...string[]];
}

export interface MultiIndexSegment {
  readonly type: 'MultiIndex';
  readonly query: readonly [number, ...number[]];
}

export interface ExprIndexSegment {
  readonly type: 'ExprIndex';
  readonly query: readonly [JsonPathExpr, ...JsonPathExpr[]];
}

export interface SliceSegment {
  readonly type: 'Slice';
  readonly query: {
    readonly from?: number;
    readonly to?: number;
    readonly step?: number;
  };
}

export interface ExprSliceSegment {
  readonly type: 'ExprSlice';
  readonly query: {
    readonly from?: JsonPathExpr;
    readonly to?: JsonPathExpr;
    readonly step?: JsonPathExpr;
  };
}

export interface FilterSegment {
  readonly type: 'Filter';
  readonly query: JsonPathExpr;
}

export interface RecursiveSegment {
  readonly type: 'Recursive';
  readonly query: readonly [JsonPathSegment, ...JsonPathSegment[]];
}

export interface IdSegment {
  readonly type: 'Id';
  readonly query: {
    readonly id: Id;
    readonly path: PathArray;
  };
}

export type UnaryExpr = readonly ['neg' | '!', JsonPathExpr];

export type BinaryExpr = readonly [
  (
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
    | '<'
    | '<='
    | '>'
    | '>='
    | '=='
    | '!='
    | '&&'
    | '||'
    | 'subscript'
  ),
  JsonPathExpr,
  JsonPathExpr
];

export type IfExpr = readonly ['if', JsonPathExpr, JsonPathExpr, JsonPathExpr];

export type LiteralExpr = readonly ['literal', JsonScalar];

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export type TaggedNode = JsonScalar | (JsonStructure & { path: BinaryPath });

export async function getTaggedNode(
  source: JsonSource,
  path: BinaryPath
): Promise<TaggedNode | undefined> {
  const node = await source.getByPath(path);
  if (node && typeof node === 'object') {
    return { ...node, path };
  }
  return node;
}

export async function evalJsonPathExpr(
  self: TaggedNode,
  source: JsonSource,
  expr: JsonPathExpr
): Promise<TaggedNode> {
  async function expectNumber(
    op: string,
    json: Promise<TaggedNode>
  ): Promise<number> {
    const n = await json;
    if (typeof n !== 'number') {
      throw new ExprError(`${op}: expected number, got ${JSON.stringify(n)}`);
    }
    return n;
  }

  switch (expr[0]) {
    case 'literal':
      return expr[1];
    case 'self':
      return self;
    case 'subscript': {
      const parent = await evalJsonPathExpr(self, source, expr[1]);
      if (!parent || typeof parent !== 'object') {
        throw new ExprError(
          `subscript: ${JSON.stringify(parent)} is not an array or object`
        );
      }
      const subscript = await evalJsonPathExpr(self, source, expr[2]);
      if (typeof subscript !== 'number' && typeof subscript !== 'string') {
        throw new ExprError(
          `subscript: ${JSON.stringify(subscript)} is not a valid index or key`
        );
      }
      const path = binaryPathAppend(parent.path, subscript);
      const result = await getTaggedNode(source, path);
      if (result === undefined) {
        throw new ExprError(
          `subscript: element ${JSON.stringify(subscript)} does not exist`
        );
      }
      return result;
    }
    case 'neg':
      return -expectNumber('-', evalJsonPathExpr(self, source, expr[1]));
    case '!':
      return !evalJsonPathExpr(self, source, expr[1]);
    case '+':
      return (
        (await expectNumber('+', evalJsonPathExpr(self, source, expr[1]))) +
        (await expectNumber('+', evalJsonPathExpr(self, source, expr[2])))
      );
    case '-':
      return (
        (await expectNumber('-', evalJsonPathExpr(self, source, expr[1]))) -
        (await expectNumber('-', evalJsonPathExpr(self, source, expr[2])))
      );
    case '*':
      return (
        (await expectNumber('*', evalJsonPathExpr(self, source, expr[1]))) *
        (await expectNumber('*', evalJsonPathExpr(self, source, expr[2])))
      );
    case '/':
      return (
        (await expectNumber('/', evalJsonPathExpr(self, source, expr[1]))) /
        (await expectNumber('/', evalJsonPathExpr(self, source, expr[2])))
      );
    case '%':
      return (
        (await expectNumber('%', evalJsonPathExpr(self, source, expr[1]))) %
        (await expectNumber('%', evalJsonPathExpr(self, source, expr[2])))
      );
    case '<':
      return (
        (await expectNumber('<', evalJsonPathExpr(self, source, expr[1]))) <
        (await expectNumber('<', evalJsonPathExpr(self, source, expr[2])))
      );
    case '<=':
      return (
        (await expectNumber('<=', evalJsonPathExpr(self, source, expr[1]))) <=
        (await expectNumber('<=', evalJsonPathExpr(self, source, expr[2])))
      );
    case '>':
      return (
        (await expectNumber('>', evalJsonPathExpr(self, source, expr[1]))) >
        (await expectNumber('>', evalJsonPathExpr(self, source, expr[2])))
      );
    case '>=':
      return (
        (await expectNumber('>=', evalJsonPathExpr(self, source, expr[1]))) >=
        (await expectNumber('>=', evalJsonPathExpr(self, source, expr[2])))
      );
    case '==':
    case '!=': {
      const a = await evalJsonPathExpr(self, source, expr[1]);
      const b = await evalJsonPathExpr(self, source, expr[1]);
      return (
        isEqual(
          a && typeof a === 'object' ? await sourceToJson(source, a.path) : a,
          b && typeof b === 'object' ? await sourceToJson(source, b.path) : b
        ) ===
        (expr[0] === '==')
      );
    }
    case '&&': {
      const first = await evalJsonPathExpr(self, source, expr[1]);
      return first ? evalJsonPathExpr(self, source, expr[2]) : first;
    }
    case '||': {
      const first = await evalJsonPathExpr(self, source, expr[1]);
      return first ? first : evalJsonPathExpr(self, source, expr[2]);
    }
    case 'if':
      return (await evalJsonPathExpr(self, source, expr[1]))
        ? evalJsonPathExpr(self, source, expr[2])
        : evalJsonPathExpr(self, source, expr[3]);
    default:
      throw new ExprError(`not an expression: ${expr[0]}`);
  }
}

function adjustIndex(index: number, array: { length: number }): number {
  let i = Math.floor(index);
  if (array.length > 0) {
    while (i < 0) {
      i += array.length;
    }
  }
  return i;
}

function isArray(
  node: JsonNode | undefined
): node is { type: 'array'; length: number } {
  return !!node && typeof node == 'object' && node.type === 'array';
}

function isObject(
  node: JsonNode | undefined
): node is { type: 'object'; keys: string[] } {
  return !!node && typeof node == 'object' && node.type === 'object';
}

export async function queryPaths1(
  source: JsonSource,
  segment: JsonPathSegment,
  path: BinaryPath
): Promise<{
  existing: BinaryPath[];
  potential: BinaryPath[];
  failures: Failure[];
}> {
  let existing: BinaryPath[] = [];
  const potential: BinaryPath[] = [];
  const failures: Failure[] = [];
  switch (segment.type) {
    case 'Wildcard': {
      const node = await source.getByPath(path);
      if (isArray(node)) {
        existing = [...new Array(node.length)].map((_, i) =>
          binaryPathAppend(path, i)
        );
      } else if (isObject(node)) {
        existing = node.keys.map((k) => binaryPathAppend(path, k));
      }
      break;
    }
    case 'Key': {
      const subpath = binaryPathAppend(path, segment.query);
      if ((await source.getByPath(subpath)) === undefined) {
        if (!isObject(await source.getByPath(path))) {
          failures.push({
            path: binaryPathToArray(subpath),
            message: 'path does not exist',
          });
        } else {
          potential.push(subpath);
        }
      } else {
        existing.push(subpath);
      }
      break;
    }
    case 'Index': {
      const subpath = binaryPathAppend(path, segment.query);
      if ((await source.getByPath(subpath)) === undefined) {
        if (!isArray(await source.getByPath(path))) {
          failures.push({
            path: binaryPathToArray(subpath),
            message: 'path does not exist',
          });
        } else {
          potential.push(subpath);
        }
      } else {
        existing.push(subpath);
      }
      break;
    }
    case 'MultiKey':
      if (!isObject(await source.getByPath(path))) {
        failures.push(
          ...segment.query.map((key) => ({
            path: [...binaryPathToArray(path), key],
            message: 'path does not exist',
          }))
        );
      }
      for (const key of segment.query) {
        const subpath = binaryPathAppend(path, key);
        if ((await source.getByPath(subpath)) === undefined) {
          potential.push(subpath);
        } else {
          existing.push(subpath);
        }
      }
      break;
    case 'MultiIndex':
      if (!isArray(await source.getByPath(path))) {
        failures.push(
          ...segment.query.map((index) => ({
            path: [...binaryPathToArray(path), index],
            message: 'path does not exist',
          }))
        );
        break;
      }
      for (const index of segment.query) {
        const subpath = binaryPathAppend(path, index);
        if ((await source.getByPath(subpath)) === undefined) {
          potential.push(subpath);
        } else {
          existing.push(subpath);
        }
      }
      break;
    case 'ExprIndex': {
      const parent = await getTaggedNode(source, path);
      if (!parent || typeof parent !== 'object') {
        failures.push({
          path: binaryPathToArray(path),
          message: 'path is not an array or object',
        });
        break;
      }
      const expectedType = parent.type === 'array' ? 'number' : 'string';
      for (const expr of segment.query) {
        let key: JsonNode;
        try {
          key = await evalJsonPathExpr(parent, source, expr);
        } catch (e) {
          failures.push({
            path: binaryPathToArray(path),
            message: `[JsonPath expression] ${e?.message || e}`,
          });
          break;
        }
        if (typeof key === expectedType) {
          const subpath = binaryPathAppend(path, key as string | number);
          if ((await source.getByPath(subpath)) === undefined) {
            potential.push(subpath);
          } else {
            existing.push(subpath);
          }
          break;
        } else {
          failures.push({
            path: binaryPathToArray(path),
            message: `[JsonPath expression] subscript: expected ${expectedType}, got ${JSON.stringify(
              key
            )}`,
          });
        }
      }
      break;
    }
    case 'Slice': {
      const node = await source.getByPath(path);
      if (!isArray(node)) {
        failures.push({
          path: binaryPathToArray(path),
          message: 'slice on non-array',
        });
        break;
      }
      const { from = 0, to = node.length, step = 1 } = segment.query;
      if (step === 0) {
        failures.push({
          path: [],
          message: 'slice step cannot be 0',
        });
        break;
      }
      const start = adjustIndex(step > 0 ? from : to, node);
      const end = adjustIndex(step > 0 ? to : from, node);
      for (let i = start; i < end; i += step) {
        if (i < node.length) {
          existing.push(binaryPathAppend(path, i));
        } else {
          potential.push(binaryPathAppend(path, i));
        }
      }
      break;
    }
    case 'ExprSlice': {
      const node = await getTaggedNode(source, path);
      if (!isArray(node)) {
        failures.push({
          path: binaryPathToArray(path),
          message: 'slice on non-array',
        });
        break;
      }
      let from: number, to: number, step: number;
      try {
        const expectNumberExpr = async (expr) => {
          const evald = await evalJsonPathExpr(node, source, expr);
          if (typeof evald !== 'number') {
            throw new ExprError(
              `slice: expected number, got ${JSON.stringify(evald)}`
            );
          }
          return evald;
        };
        from = segment.query.from
          ? await expectNumberExpr(segment.query.from)
          : 0;
        to = segment.query.to
          ? await expectNumberExpr(segment.query.to)
          : node.length;
        step = segment.query.step
          ? await expectNumberExpr(segment.query.step)
          : 1;
      } catch (e) {
        failures.push({
          path: binaryPathToArray(path),
          message: `[JsonPath expression] ${e?.message || e}`,
        });
        break;
      }
      if (step === 0) {
        failures.push({
          path: binaryPathToArray(path),
          message: 'slice step cannot be 0',
        });
        break;
      }
      const start = await adjustIndex(step > 0 ? from : to, node);
      const end = await adjustIndex(step > 0 ? to : from, node);
      for (let i = start; i < end; i += step) {
        if (i < node.length) {
          existing.push(binaryPathAppend(path, i));
        } else {
          potential.push(binaryPathAppend(path, i));
        }
      }
      break;
    }
    case 'Filter': {
      const node = await source.getByPath(path);
      let entries: BinaryPath[];
      if (isArray(node)) {
        entries = [...new Array(node.length)].map((_, i) =>
          binaryPathAppend(path, i)
        );
      } else if (isObject(node)) {
        entries = node.keys.map((k) => binaryPathAppend(path, k));
      } else {
        failures.push({
          path: binaryPathToArray(path),
          message: 'filter on non-array, non-object',
        });
        break;
      }
      for (const path of entries) {
        try {
          if (
            await evalJsonPathExpr(
              (await getTaggedNode(source, path)) as TaggedNode,
              source,
              segment.query
            )
          ) {
            existing.push(path);
          }
        } catch (e) {
          failures.push({
            path: binaryPathToArray(path),
            message: `[JsonPath expression] ${e?.message || e}`,
          });
        }
      }
      break;
    }
    case 'Recursive': {
      const node = await source.getByPath(path);
      let entries: BinaryPath[] = [];
      if (isArray(node)) {
        entries = [...new Array(node.length)].map((_, i) =>
          binaryPathAppend(path, i)
        );
      } else if (isObject(node)) {
        entries = node.keys.map((k) => binaryPathAppend(path, k));
      }
      existing.push(
        ...(await queryPaths(segment.query, source, path)).existing,
        ...(await flatMapAsync(
          entries,
          async (path) => (await queryPaths1(source, segment, path)).existing
        ))
      );
    }
  }
  return { existing, potential, failures };
}

export async function queryPaths(
  jsonPath: CompiledJsonPath | CompiledJsonIdPath,
  source: JsonSource,
  rootPath: BinaryPath = EMPTY_PATH
): Promise<{
  existing: BinaryPath[];
  potential: BinaryPath[];
  failures: Failure[];
}> {
  if (jsonPath.length && jsonPath[0].type === 'Id') {
    const idPath = Buffer.concat([
      rootPath,
      (await source.getPathById(jsonPath[0].query.id)) ||
        pathArrayToBinary(jsonPath[0].query.path),
    ]);
    const node = await source.getByPath(idPath);
    if (node !== undefined) {
      return queryPaths(jsonPath.slice(1) as CompiledJsonPath, source, idPath);
    } else {
      return {
        existing: [],
        potential: [],
        failures: [
          {
            path: binaryPathToArray(idPath),
            message: 'path does not exist',
          },
        ],
      };
    }
  }
  const potential: BinaryPath[] = [];
  const failures: Failure[] = [];
  const existing = await reduceAsync<JsonPathSegment, BinaryPath[]>(
    jsonPath as CompiledJsonPath,
    [rootPath],
    async (paths, segment, i) =>
      flatMapAsync(paths, async (path) => {
        const result = await queryPaths1(source, segment, path);
        failures.push(...result.failures);
        if (i === jsonPath.length - 1) {
          potential.push(...result.potential);
        } else {
          failures.push(
            ...result.potential.map((p) => ({
              path: binaryPathToArray(p),
              message: 'path does not exist',
            }))
          );
        }
        return result.existing;
      })
  );
  return { existing, potential, failures };
}

export async function queryValues(
  jsonPath: CompiledJsonPath,
  source: JsonSource,
  rootPath: BinaryPath = EMPTY_PATH
): Promise<Json[]> {
  const { existing } = await queryPaths(jsonPath, source, rootPath);
  return Promise.all(existing.map((p) => sourceToJson(source, p)));
}

export function canMatchAbsolutePath(
  queryPath: CompiledJsonPath,
  absolutePath: PathArray
): boolean {
  const length = Math.min(queryPath.length, absolutePath.length);
  for (let i = 0; i < length; i++) {
    const segment = queryPath[i];
    switch (segment.type) {
      case 'Index':
      case 'Key':
        if (segment.query !== absolutePath[i]) {
          return false;
        }
        break;
      case 'MultiIndex':
      case 'MultiKey':
        if (
          (segment.query as readonly (string | number)[]).every(
            (k) => k !== absolutePath[i]
          )
        ) {
          return false;
        }
        break;
      // TODO: Handle Recursive segments
    }
  }
  return true;
}

export function isSingularPath(
  path: CompiledJsonPath | CompiledJsonIdPath
): boolean {
  return path.every((p: JsonPathSegment | IdSegment) => {
    switch (p.type) {
      case 'Index':
      case 'Key':
      case 'Id':
        return true;
      case 'MultiIndex':
      case 'MultiKey':
      case 'ExprIndex':
        return p.query.length === 1;
      default:
        return false;
    }
  });
}

export function splitIntoSingularPaths(
  path: CompiledJsonPath
): CompiledJsonPath[] {
  let paths: JsonPathSegment[][] = [[]];
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    switch (segment.type) {
      case 'Key':
      case 'Index':
        paths.forEach((p) => p.push(segment));
        break;
      case 'MultiIndex':
        paths = flatMap(segment.query, (query) =>
          paths.map((p) => [...p, { type: 'Index', query } as IndexSegment])
        );
        break;
      case 'MultiKey':
        paths = flatMap(segment.query, (query) =>
          paths.map((p) => [...p, { type: 'Key', query } as KeySegment])
        );
        break;
      case 'ExprIndex':
        paths = flatMap(segment.query, (expr) =>
          paths.map((p) => [
            ...p,
            { type: 'ExprIndex', query: [expr] } as ExprIndexSegment,
          ])
        );
        break;
      default:
        return paths.map((p) => [...p, ...path.slice(i)]);
    }
  }
  return paths;
}

function interpolateExpr([car, ...cdr]: readonly [string, ...any[]]): (
  vars: Vars
) => JsonPathExpr {
  if (car === 'variable') {
    const [varName] = cdr;
    return (vars) => {
      if (varName in vars) {
        return ['literal', vars[varName]];
      }
      throw new Error(`missing variable in JsonPath: {${varName}}`);
    };
  }
  const interpolated = cdr.map((e) =>
    Array.isArray(e) && typeof e[0] === 'string'
      ? interpolateExpr(e as any)
      : () => e
  );
  return (vars) => [car, ...interpolated.map((e) => e(vars))] as any;
}

function compileIndex(
  index: readonly [string, ...any[]]
): (vars: Vars) => JsonPathExpr {
  switch (index[0]) {
    case 'expression':
      return interpolateExpr(index[1]);
    case 'index':
    case 'key':
      return () => ['literal', index[1]];
    default:
      throw new Error(`not an index: ${JSON.stringify(index)}`);
  }
}

function compileSegment(
  segment: readonly [string, ...any[]]
): (vars: Vars) => JsonPathSegment {
  let seg: JsonPathSegment;
  switch (segment[0]) {
    case 'key':
      seg = { type: 'Key', query: segment[1] };
      break;
    case 'index':
      seg = { type: 'Index', query: segment[1] };
      break;
    case 'expression': {
      const expr = interpolateExpr(segment[1]);
      return (vars) => ({ type: 'ExprIndex', query: [expr(vars)] });
    }
    case 'filter':
      seg = { type: 'Filter', query: segment[1] };
      break;
    case 'multi': {
      const subscripts = segment.slice(1);
      if (subscripts.every((i) => i[0] === 'index')) {
        seg = {
          type: 'MultiIndex',
          query: subscripts.map((x) => x[1]) as [any, ...any[]],
        };
      } else if (subscripts.every((i) => i[0] === 'key')) {
        seg = {
          type: 'MultiKey',
          query: subscripts.map((x) => x[1]) as [any, ...any[]],
        };
      } else {
        const exprs = subscripts.map(compileIndex);
        return (vars) => ({
          type: 'ExprIndex',
          query: exprs.map((e) => e(vars)) as [any, ...any[]],
        });
      }
      break;
    }
    case 'slice': {
      if (segment.slice(1, 4).every((i) => !i || i[0] === 'index')) {
        const query: any = {};
        if (segment[1]?.[1]) {
          query.from = segment[1][1];
        }
        if (segment[2]?.[1]) {
          query.to = segment[2][1];
        }
        if (segment[3]?.[1]) {
          query.step = segment[3][1];
        }
        seg = { type: 'Slice', query };
        break;
      }
      const from = segment[1] && compileIndex(segment[1]);
      const to = segment[2] && compileIndex(segment[2]);
      const step = segment[3] && compileIndex(segment[3]);
      return (vars) => {
        const query: any = {};
        if (from) {
          query.from = from(vars);
        }
        if (to) {
          query.to = to(vars);
        }
        if (step) {
          query.step = step(vars);
        }
        return { type: 'ExprSlice', query };
      };
    }
    case 'recursive': {
      const segs = segment.slice(1).map(compileSegment);
      return (vars) => ({
        type: 'Recursive',
        query: segs.map((f) => f(vars)) as [any, ...any[]],
      });
    }
    case 'wildcard':
      seg = { type: 'Wildcard' };
      break;
    default:
      throw new Error(`not a segment: ${segment}`);
  }
  return () => seg;
}

const compileCache = new Map<string, (vars: Vars) => CompiledJsonPath>();

function compileUncachedJsonPath(
  path: JsonPath
): (vars: Vars) => CompiledJsonPath {
  const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar));
  parser.feed(path);
  const segments = parser.results[0].map(compileSegment);
  const compiled = (vars) => segments.map((f) => f(vars));
  compileCache.set(path, compiled);
  return compiled;
}

export function compileJsonPath(
  path: JsonPath,
  vars: Vars = {}
): CompiledJsonPath {
  const compiled = compileCache.get(path) || compileUncachedJsonPath(path);
  return compiled(vars);
}

export function compileJsonPathAction(
  action: JsonPathAction
): Action<CompiledJsonPath> {
  if (action.action === 'Transaction') {
    return {
      action: 'Transaction',
      payload: action.payload.map((a) =>
        mapAction(a, (p) => compileJsonPath(p, a.vars))
      ),
    };
  }
  return mapAction(action, (p) => compileJsonPath(p, action.vars));
}

function exprToString(expr: JsonPathExpr, parens = true): string {
  switch (expr[0]) {
    case 'self':
      return '@';
    case 'literal':
      return JSON.stringify(expr[1]);
    case 'neg':
      return `-${exprToString(expr[1])}`;
    case '!':
      return `!${exprToString(expr[1])}`;
    case 'if': {
      const str = `${exprToString(expr[1], false)} ? ${exprToString(
        expr[2],
        false
      )} : ${exprToString(expr[3], false)}`;
      return parens ? `(${str})` : str;
    }
    case 'subscript':
      return `${exprToString(expr[1])}[${(exprToString(expr[2]), false)}]`;
    default: {
      const str = `${exprToString(expr[1])} ${expr[0]} ${exprToString(
        expr[2]
      )}`;
      return parens ? `(${str})` : str;
    }
  }
}

function topLevelExprToString(expr: JsonPathExpr): string {
  if (expr[0] === 'literal') {
    if (typeof expr[1] === 'string' || typeof expr[1] === 'number') {
      return JSON.stringify(expr[1]);
    }
  }
  return `(${exprToString(expr, false)})`;
}

export function jsonPathToString(
  path: CompiledJsonIdPath | CompiledJsonPath
): JsonPath {
  let str = '$';
  let segments = [...path];
  let next: JsonPathSegment | IdSegment | undefined;
  while ((next = segments.shift()) != null) {
    switch (next.type) {
      case 'Wildcard':
        str += '.*';
        break;
      case 'Key':
        if (/^[a-z_]\w+$/i.test(next.query)) {
          str += `.${next.query}`;
          break;
        }
      // fallthrough
      case 'Index':
        str += `[${JSON.stringify(next.query)}]`;
        break;
      case 'MultiKey':
      case 'MultiIndex':
        str += `[${(next.query as [unknown, ...unknown[]])
          .map((i) => JSON.stringify(i))
          .join(', ')}]`;
        break;
      case 'ExprIndex':
        str += `[${next.query.map(topLevelExprToString).join(', ')}]`;
        break;
      case 'Slice':
        str += `[${next.query.from ?? ''}:${next.query.to ?? ''}:${
          next.query.step ?? ''
        }]`;
        break;
      case 'ExprSlice':
        str += `[${
          next.query.from ? topLevelExprToString(next.query.from) : ''
        }:${next.query.to ? topLevelExprToString(next.query.to) : ''}:${
          next.query.step ? topLevelExprToString(next.query.step) : ''
        }]`;
        break;
      case 'Filter':
        str += `[?{${exprToString(next.query, false)})]`;
        break;
      case 'Recursive': {
        const first = next.query[0];
        if (first.type === 'Wildcard') {
          str += '..*';
          segments = next.query.slice(1);
        } else if (first.type === 'Key' && /^[a-z_]\w+$/i.test(first.query)) {
          str += `..${first.query}`;
          segments = next.query.slice(1);
        } else {
          str += '..';
          segments = [...next.query];
        }
        break;
      }
      case 'Id':
        segments = [
          ...next.query.path.map(
            (query) =>
              ({
                type: typeof query === 'number' ? 'Index' : 'Key',
                query,
              } as JsonPathSegment)
          ),
          ...segments,
        ];
    }
  }
  return str;
}

export async function anchorPathToId(
  source: JsonSource,
  path: CompiledJsonPath
): Promise<CompiledJsonPath | CompiledJsonIdPath> {
  let lastId: Id | null = null;
  let lastIdIndex = 0;
  let queryPath: PathArray = [];
  const queryPathAccum: (string | number)[] = [];
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    if (segment.type === 'Index' || segment.type === 'Key') {
      queryPathAccum.push(segment.query);
      const ids = await source.getIdsByPath(pathArrayToBinary(queryPathAccum));
      if (ids.length) {
        lastId = ids[0];
        lastIdIndex = i;
        queryPath = [...queryPathAccum];
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
