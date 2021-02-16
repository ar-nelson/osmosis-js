import flatMap from 'lodash.flatmap';
import isEqual from 'lodash.isequal';
import nearley from 'nearley';
import { Action, mapAction, ScalarAction } from './actions';
import { Id } from './id';
import {
  JsonAdapter,
  JsonAdapterResult,
  PlusScalarAdapter,
  followPath,
} from './json-adapter';
import grammar from './jsonpath.grammar';
import { Failure, Json, JsonScalar, PathArray } from './types';

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

export function evalJsonPathExpr<T>(
  self: T,
  adapter: PlusScalarAdapter<T>,
  expr: JsonPathExpr
): JsonScalar | T {
  function expectNumber(op: string, json: JsonScalar | T): number {
    const n = adapter.numberValue(json);
    if (n == null) {
      throw new ExprError(
        `${op}: expected number, got ${JSON.stringify(adapter.toJson(json))}`
      );
    }
    return n;
  }

  switch (expr[0]) {
    case 'literal':
      return expr[1];
    case 'self':
      return self;
    case 'subscript': {
      const parent = evalJsonPathExpr(self, adapter, expr[1]);
      const subscript = evalJsonPathExpr(self, adapter, expr[2]);
      let result: JsonAdapterResult<JsonScalar | T> | undefined = undefined;
      const index = adapter.numberValue(subscript);
      if (index) {
        result = adapter.getIndex(self, index);
      } else {
        const key = adapter.stringValue(subscript);
        if (key) {
          result = adapter.getKey(self, key);
        }
      }
      if (!result) {
        throw new ExprError(
          `subscript: ${JSON.stringify(
            adapter.toJson(subscript)
          )} is not a valid index or key`
        );
      } else if (!result.canExist) {
        // FIXME: It's dangerous to stringify a potentially huge object like this
        throw new ExprError(
          `subscript: ${JSON.stringify(
            adapter.toJson(subscript)
          )} is not a valid index for non-array value ${JSON.stringify(
            adapter.toJson(parent)
          )}`
        );
      } else if (!result.exists) {
        throw new ExprError(
          `subscript: element ${JSON.stringify(
            adapter.toJson(subscript)
          )} does not exist`
        );
      }
      return result.value as JsonScalar | T;
    }
    case 'neg':
      return -expectNumber('-', evalJsonPathExpr(self, adapter, expr[1]));
    case '!':
      return !evalJsonPathExpr(self, adapter, expr[1]);
    case '+':
      return (
        expectNumber('+', evalJsonPathExpr(self, adapter, expr[1])) +
        expectNumber('+', evalJsonPathExpr(self, adapter, expr[2]))
      );
    case '-':
      return (
        expectNumber('-', evalJsonPathExpr(self, adapter, expr[1])) -
        expectNumber('-', evalJsonPathExpr(self, adapter, expr[2]))
      );
    case '*':
      return (
        expectNumber('*', evalJsonPathExpr(self, adapter, expr[1])) *
        expectNumber('*', evalJsonPathExpr(self, adapter, expr[2]))
      );
    case '/':
      return (
        expectNumber('/', evalJsonPathExpr(self, adapter, expr[1])) /
        expectNumber('/', evalJsonPathExpr(self, adapter, expr[2]))
      );
    case '%':
      return (
        expectNumber('%', evalJsonPathExpr(self, adapter, expr[1])) %
        expectNumber('%', evalJsonPathExpr(self, adapter, expr[2]))
      );
    case '<':
      return (
        expectNumber('<', evalJsonPathExpr(self, adapter, expr[1])) <
        expectNumber('<', evalJsonPathExpr(self, adapter, expr[2]))
      );
    case '<=':
      return (
        expectNumber('<=', evalJsonPathExpr(self, adapter, expr[1])) <=
        expectNumber('<=', evalJsonPathExpr(self, adapter, expr[2]))
      );
    case '>':
      return (
        expectNumber('>', evalJsonPathExpr(self, adapter, expr[1])) >
        expectNumber('>', evalJsonPathExpr(self, adapter, expr[2]))
      );
    case '>=':
      return (
        expectNumber('>=', evalJsonPathExpr(self, adapter, expr[1])) >=
        expectNumber('>=', evalJsonPathExpr(self, adapter, expr[2]))
      );
    case '==':
      return isEqual(
        adapter.toJson(evalJsonPathExpr(self, adapter, expr[1])),
        adapter.toJson(evalJsonPathExpr(self, adapter, expr[2]))
      );
    case '!=':
      return !isEqual(
        adapter.toJson(evalJsonPathExpr(self, adapter, expr[1])),
        adapter.toJson(evalJsonPathExpr(self, adapter, expr[2]))
      );
    case '&&': {
      const first = evalJsonPathExpr(self, adapter, expr[1]);
      return adapter.booleanValue(first)
        ? evalJsonPathExpr(self, adapter, expr[2])
        : first;
    }
    case '||': {
      const first = evalJsonPathExpr(self, adapter, expr[1]);
      return adapter.booleanValue(first)
        ? first
        : evalJsonPathExpr(self, adapter, expr[2]);
    }
    case 'if':
      return adapter.booleanValue(evalJsonPathExpr(self, adapter, expr[1]))
        ? evalJsonPathExpr(self, adapter, expr[2])
        : evalJsonPathExpr(self, adapter, expr[3]);
    default:
      throw new ExprError(`not an expression: ${expr[0]}`);
  }
}

function adjustIndex<T>(
  index: number,
  array: T,
  adapter: JsonAdapter<T>
): number {
  let i = Math.floor(index);
  const len = adapter.arrayLength(array) || 0;
  if (len > 0) {
    while (i < 0) {
      i += len;
    }
  }
  return i;
}

function queryPaths1<T>(
  json: T,
  adapter: JsonAdapter<T>,
  segment: JsonPathSegment
): {
  existing: PathArray[];
  potential: PathArray[];
  failures: Failure[];
} {
  let existing: PathArray[] = [];
  const potential: PathArray[] = [];
  const failures: Failure[] = [];
  function pushOne(
    index: string | number,
    { canExist, exists }: JsonAdapterResult<T>
  ) {
    if (canExist) {
      (exists ? existing : potential).push([index]);
    } else {
      failures.push({
        path: [index],
        message: 'path does not exist',
      });
    }
  }
  switch (segment.type) {
    case 'Wildcard':
      existing = adapter.listEntries(json)?.map(([k]) => [k]) || [];
      break;
    case 'Key':
      pushOne(segment.query, adapter.getKey(json, segment.query));
      break;
    case 'Index':
      pushOne(
        segment.query,
        adapter.getIndex(json, adjustIndex(segment.query, json, adapter))
      );
      break;
    case 'MultiKey':
      for (const key of segment.query) {
        pushOne(key, adapter.getKey(json, key));
      }
      break;
    case 'MultiIndex':
      for (const index of segment.query) {
        pushOne(
          index,
          adapter.getIndex(json, adjustIndex(index, json, adapter))
        );
      }
      break;
    case 'ExprIndex':
      for (const expr of segment.query) {
        let key: JsonScalar | T;
        try {
          key = evalJsonPathExpr(json, new PlusScalarAdapter(adapter), expr);
        } catch (e) {
          failures.push({
            path: [],
            message: `[JsonPath expression] ${e?.message || e}`,
          });
          break;
        }
        switch (typeof key) {
          case 'string':
            pushOne(key, adapter.getKey(json, key));
            break;
          case 'number':
            pushOne(
              key,
              adapter.getIndex(json, adjustIndex(key, json, adapter))
            );
            break;
          default:
            failures.push({
              path: [],
              message: `[JsonPath expression] subscript: ${JSON.stringify(
                key
              )} is not a valid index or key`,
            });
        }
      }
      break;
    case 'Slice':
      if (Array.isArray(json)) {
        const { from = 0, to = json.length, step = 1 } = segment.query;
        if (step === 0) {
          failures.push({
            path: [],
            message: 'slice step cannot be 0',
          });
          break;
        }
        const start = adjustIndex(step > 0 ? from : to, json, adapter);
        const end = adjustIndex(step > 0 ? to : from, json, adapter);
        for (let i = start; i < end; i += step) {
          if (i < json.length) {
            existing.push([i]);
          } else {
            potential.push([i]);
          }
        }
      } else {
        failures.push({
          path: [],
          message: 'slice on non-array',
        });
      }
      break;
    case 'ExprSlice': {
      const length = adapter.arrayLength(json);
      if (length != null) {
        let from: number, to: number, step: number;
        try {
          // eslint-disable-next-line no-inner-declarations
          function expectNumberExpr(expr) {
            const plusAdapter = new PlusScalarAdapter(adapter);
            const evald = evalJsonPathExpr(json, plusAdapter, expr);
            const n = plusAdapter.numberValue(evald);
            if (n == null) {
              throw new ExprError(
                `slice: expected number, got ${JSON.stringify(
                  plusAdapter.toJson(evald)
                )}`
              );
            }
            return n;
          }
          from = segment.query.from ? expectNumberExpr(segment.query.from) : 0;
          to = segment.query.to ? expectNumberExpr(segment.query.to) : length;
          step = segment.query.step ? expectNumberExpr(segment.query.step) : 1;
        } catch (e) {
          failures.push({
            path: [],
            message: `[JsonPath expression] ${e?.message || e}`,
          });
          break;
        }
        if (step === 0) {
          failures.push({
            path: [],
            message: 'slice step cannot be 0',
          });
          break;
        }
        const start = adjustIndex(step > 0 ? from : to, json, adapter);
        const end = adjustIndex(step > 0 ? to : from, json, adapter);
        for (let i = start; i < end; i += step) {
          if (i < length) {
            existing.push([i]);
          } else {
            potential.push([i]);
          }
        }
      } else {
        failures.push({
          path: [],
          message: 'slice on non-array',
        });
      }
      break;
    }
    case 'Filter': {
      const entries = adapter.listEntries(json);
      if (entries != null) {
        const plusAdapter = new PlusScalarAdapter(adapter);
        for (const [key, value] of entries) {
          try {
            if (
              plusAdapter.booleanValue(
                evalJsonPathExpr(value, plusAdapter, segment.query)
              )
            ) {
              existing.push([key]);
            }
          } catch (e) {
            failures.push({
              path: [key],
              message: `[JsonPath expression] ${e?.message || e}`,
            });
          }
        }
      } else {
        failures.push({
          path: [],
          message: 'filter on non-array, non-object',
        });
      }
      break;
    }
    case 'Recursive':
      existing.push(
        ...queryPaths(segment.query, json, adapter).existing,
        ...flatMap(adapter.listEntries(json) || [], ([key, value]) =>
          queryPaths1(value, adapter, segment).existing.map((p) => [key, ...p])
        )
      );
  }
  return { existing, potential, failures };
}

function queryValues1<T>(
  segment: JsonPathSegment,
  json: T,
  adapter: JsonAdapter<T>
): T[] {
  return queryPaths1(json, adapter, segment)
    .existing.map((p) => followPath(p, json, adapter))
    .filter((r) => r.found)
    .map((r) => r.value as T);
}

export function queryPaths<T>(
  jsonPath: CompiledJsonPath,
  json: T,
  adapter: JsonAdapter<T>
): {
  existing: PathArray[];
  potential: PathArray[];
  failures: Failure[];
};

export function queryPaths<T>(
  jsonPath: CompiledJsonPath | CompiledJsonIdPath,
  json: T,
  adapter: JsonAdapter<T>,
  idToPath: (id: Id) => PathArray | undefined
): {
  existing: PathArray[];
  potential: PathArray[];
  failures: Failure[];
};

export function queryPaths<T>(
  jsonPath: CompiledJsonPath | CompiledJsonIdPath,
  json: T,
  adapter: JsonAdapter<T>,
  idToPath: (id: Id) => PathArray | undefined = () => undefined
): {
  existing: PathArray[];
  potential: PathArray[];
  failures: Failure[];
} {
  if (jsonPath.length && jsonPath[0].type === 'Id') {
    const idPath = idToPath(jsonPath[0].query.id) || jsonPath[0].query.path;
    const { found, value } = followPath(idPath, json, adapter);
    if (found) {
      const { potential, failures, existing } = queryPaths(
        jsonPath.slice(1) as CompiledJsonPath,
        value as T,
        adapter
      );
      return {
        existing: existing.map((p) => [...idPath, ...p]),
        potential: potential.map((p) => [...idPath, ...p]),
        failures: failures.map((f) => ({
          ...f,
          path: [...idPath, ...f.path],
        })),
      };
    } else {
      return {
        existing: [],
        potential: [],
        failures: [
          {
            path: idPath,
            message: 'path does not exist',
          },
        ],
      };
    }
  }
  const potential: PathArray[] = [];
  const failures: Failure[] = [];
  const existing = (jsonPath as CompiledJsonPath)
    .reduce<{ json: T; path: PathArray }[]>(
      (paths, segment, i) =>
        flatMap(paths, ({ json, path }) => {
          const result = queryPaths1(json, adapter, segment);
          failures.push(
            ...result.failures.map((f) => ({
              ...f,
              path: [...path, ...f.path],
            }))
          );
          if (i === jsonPath.length - 1) {
            potential.push(...result.potential.map((p) => [...path, ...p]));
          } else {
            failures.push(
              ...result.potential.map((p) => ({
                path: [...path, ...p],
                message: 'path does not exist',
              }))
            );
          }
          return result.existing.map((p) => ({
            json: p.reduce((j, i) => j?.[i], json),
            path: [...path, ...p],
          }));
        }),
      [{ json, path: [] }]
    )
    .map((x) => x.path);
  return { existing, potential, failures };
}

export function queryValues<T>(
  path: CompiledJsonPath,
  json: T,
  adapter: JsonAdapter<T>
): T[] {
  return path.reduce(
    (jsons, segment) =>
      flatMap(jsons, (json) => queryValues1(segment, json, adapter)),
    [json]
  );
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
