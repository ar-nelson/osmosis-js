import { Draft } from 'immer';
import flatMap from 'lodash.flatmap';
import isEqual from 'lodash.isequal';
import isPlainObject from 'lodash.isplainobject';
import nearley from 'nearley';
import { Action, mapAction, ScalarAction } from './actions';
import { Id } from './id';
import grammar from './jsonpath.grammar';
import { Failure, Json, JsonObject, PathArray } from './types';

const isObject: (
  json: Draft<Json>
) => json is Draft<JsonObject> = isPlainObject as any;

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

export type LiteralExpr = readonly ['literal', Json];

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function expectNumber(op: string, json: Json): number {
  if (typeof json !== 'number') {
    throw new ExprError(`${op}: expected number, got ${JSON.stringify(json)}`);
  }
  return json;
}

export function evalJsonPathExpr(self: Json, expr: JsonPathExpr): Json {
  switch (expr[0]) {
    case 'literal':
      return expr[1];
    case 'self':
      return self;
    case 'subscript': {
      const parent = evalJsonPathExpr(self, expr[1]);
      const key = evalJsonPathExpr(self, expr[2]);
      let result: Json | undefined = undefined;
      if (typeof key === 'number') {
        if (!Array.isArray(parent)) {
          throw new ExprError(
            `subscript: ${JSON.stringify(
              key
            )} is not a valid index for non-array value ${JSON.stringify(
              parent
            )}`
          );
        }
        result = parent[key];
      } else if (typeof key === 'string') {
        if (!isObject(parent)) {
          throw new ExprError(
            `subscript: ${JSON.stringify(
              key
            )} is not a valid key for non-object value ${JSON.stringify(
              parent
            )}`
          );
        }
        result = parent[key];
      } else {
        throw new ExprError(
          `subscript: ${JSON.stringify(key)} is not a valid index or key`
        );
      }
      if (result === undefined) {
        throw new ExprError(
          `subscript: element ${JSON.stringify(key)} does not exist`
        );
      }
      return result;
    }
    case 'neg':
      return -expectNumber('-', evalJsonPathExpr(self, expr[1]));
    case '!':
      return !evalJsonPathExpr(self, expr[1]);
    case '+':
      return (
        expectNumber('+', evalJsonPathExpr(self, expr[1])) +
        expectNumber('+', evalJsonPathExpr(self, expr[2]))
      );
    case '-':
      return (
        expectNumber('-', evalJsonPathExpr(self, expr[1])) -
        expectNumber('-', evalJsonPathExpr(self, expr[2]))
      );
    case '*':
      return (
        expectNumber('*', evalJsonPathExpr(self, expr[1])) *
        expectNumber('*', evalJsonPathExpr(self, expr[2]))
      );
    case '/':
      return (
        expectNumber('/', evalJsonPathExpr(self, expr[1])) /
        expectNumber('/', evalJsonPathExpr(self, expr[2]))
      );
    case '%':
      return (
        expectNumber('%', evalJsonPathExpr(self, expr[1])) %
        expectNumber('%', evalJsonPathExpr(self, expr[2]))
      );
    case '<':
      return (
        expectNumber('<', evalJsonPathExpr(self, expr[1])) <
        expectNumber('<', evalJsonPathExpr(self, expr[2]))
      );
    case '<=':
      return (
        expectNumber('<=', evalJsonPathExpr(self, expr[1])) <=
        expectNumber('<=', evalJsonPathExpr(self, expr[2]))
      );
    case '>':
      return (
        expectNumber('>', evalJsonPathExpr(self, expr[1])) >
        expectNumber('>', evalJsonPathExpr(self, expr[2]))
      );
    case '>=':
      return (
        expectNumber('>=', evalJsonPathExpr(self, expr[1])) >=
        expectNumber('>=', evalJsonPathExpr(self, expr[2]))
      );
    case '==':
      return isEqual(
        evalJsonPathExpr(self, expr[1]),
        evalJsonPathExpr(self, expr[2])
      );
    case '!=':
      return !isEqual(
        evalJsonPathExpr(self, expr[1]),
        evalJsonPathExpr(self, expr[2])
      );
    case '&&':
      return evalJsonPathExpr(self, expr[1]) && evalJsonPathExpr(self, expr[2]);
    case '||':
      return evalJsonPathExpr(self, expr[1]) || evalJsonPathExpr(self, expr[2]);
    case 'if':
      return evalJsonPathExpr(self, expr[1])
        ? evalJsonPathExpr(self, expr[2])
        : evalJsonPathExpr(self, expr[3]);
    default:
      throw new ExprError(`not an expression: ${expr[0]}`);
  }
}

function adjustIndex(index: number, array: readonly any[]): number {
  let i = Math.floor(index);
  const len = array.length;
  if (len > 0) {
    while (i < 0) {
      i += len;
    }
  }
  return i;
}

function queryPaths1(
  json: Json,
  segment: JsonPathSegment
): {
  existing: PathArray[];
  potential: PathArray[];
  failures: Failure[];
} {
  let existing: PathArray[] = [];
  const potential: PathArray[] = [];
  let failures: Failure[] = [];
  switch (segment.type) {
    case 'Wildcard':
      if (Array.isArray(json)) {
        existing = json.map((x, i) => [i]);
      } else if (isObject(json)) {
        existing = Object.keys(json).map((x) => [x]);
      }
      break;
    case 'Key':
      if (isObject(json)) {
        if (Object.prototype.hasOwnProperty.call(json, segment.query)) {
          existing.push([segment.query]);
        } else {
          potential.push([segment.query]);
        }
      } else {
        failures.push({
          path: [segment.query],
          message: 'path does not exist',
        });
      }
      break;
    case 'Index':
      if (Array.isArray(json)) {
        if (segment.query < json.length) {
          existing.push([adjustIndex(segment.query, json)]);
        } else {
          potential.push([segment.query]);
        }
      } else {
        failures.push({
          path: [segment.query],
          message: 'path does not exist',
        });
      }
      break;
    case 'MultiKey':
      if (isObject(json)) {
        segment.query.forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(json, key)) {
            existing.push([key]);
          } else {
            potential.push([key]);
          }
        });
      } else {
        failures = segment.query.map((x) => ({
          path: [x],
          message: 'path does not exist',
        }));
      }
      break;
    case 'MultiIndex':
      if (Array.isArray(json)) {
        segment.query.forEach((key) => {
          if (key < json.length) {
            existing.push([adjustIndex(key, json)]);
          } else {
            potential.push([key]);
          }
        });
      } else {
        failures = segment.query.map((x) => ({
          path: [x],
          message: 'path does not exist',
        }));
      }
      break;
    case 'ExprIndex':
      segment.query.forEach((expr) => {
        let key: Json;
        try {
          key = evalJsonPathExpr(json, expr);
        } catch (e) {
          failures.push({
            path: [],
            message: `[JsonPath expression] ${e?.message || e}`,
          });
          return;
        }
        if (typeof key === 'string') {
          if (isObject(json)) {
            if (Object.prototype.hasOwnProperty.call(json, key)) {
              existing.push([key]);
            } else {
              potential.push([key]);
            }
          } else {
            failures.push({
              path: [key],
              message: 'path does not exist',
            });
          }
        } else if (typeof key === 'number') {
          if (Array.isArray(json)) {
            if (key < json.length) {
              existing.push([adjustIndex(key, json)]);
            } else {
              potential.push([key]);
            }
          } else {
            failures.push({
              path: [key],
              message: 'path does not exist',
            });
          }
        } else {
          failures.push({
            path: [],
            message: `[JsonPath expression] subscript: ${JSON.stringify(
              key
            )} is not a valid index or key`,
          });
        }
      });
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
        const start = adjustIndex(step > 0 ? from : to, json);
        const end = adjustIndex(step > 0 ? to : from, json);
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
    case 'ExprSlice':
      if (Array.isArray(json)) {
        let from = 0;
        let to = json.length;
        let step = 1;
        try {
          if (segment.query.from) {
            from = expectNumber(
              'slice',
              evalJsonPathExpr(json, segment.query.from)
            );
          }
          if (segment.query.to) {
            to = expectNumber(
              'slice',
              evalJsonPathExpr(json, segment.query.to)
            );
          }
          if (segment.query.step) {
            step = Math.floor(
              expectNumber('slice', evalJsonPathExpr(json, segment.query.step))
            );
          }
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
        const start = adjustIndex(step > 0 ? from : to, json);
        const end = adjustIndex(step > 0 ? to : from, json);
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
    case 'Filter':
      if (Array.isArray(json)) {
        json.forEach((x, i) => {
          try {
            if (evalJsonPathExpr(x, segment.query)) {
              existing.push([i]);
            }
          } catch (e) {
            failures.push({
              path: [i],
              message: `[JsonPath expression] ${e?.message || e}`,
            });
          }
        });
      } else if (isObject(json)) {
        Object.entries(json).forEach(([k, v]) => {
          try {
            if (evalJsonPathExpr(v, segment.query)) {
              existing.push([k]);
            }
          } catch (e) {
            failures.push({
              path: [k],
              message: `[JsonPath expression] ${e?.message || e}`,
            });
          }
        });
      } else {
        failures.push({
          path: [],
          message: 'filter on non-array, non-object',
        });
      }
      break;
    case 'Recursive':
      if (Array.isArray(json)) {
        existing.push(
          ...queryPaths(json, segment.query).existing,
          ...flatMap(json, (x, i) =>
            queryPaths1(x, segment).existing.map((p) => [i, ...p])
          )
        );
      } else if (isObject(json)) {
        existing.push(
          ...queryPaths(json, segment.query).existing,
          ...flatMap(Object.entries(json), ([k, v]) =>
            queryPaths1(v, segment).existing.map((p) => [k, ...p])
          )
        );
      }
  }
  return { existing, potential, failures };
}

function queryValues1(json: Json, segment: JsonPathSegment): Json[] {
  return queryPaths1(json, segment)
    .existing.map((p) => p.reduce((j, i) => j?.[i], json))
    .filter((x) => x !== undefined);
}

export function queryPaths(
  json: Json,
  jsonPath: CompiledJsonPath
): {
  existing: PathArray[];
  potential: PathArray[];
  failures: Failure[];
} {
  const potential: PathArray[] = [];
  const failures: Failure[] = [];
  const existing = jsonPath
    .reduce<{ json: Json; path: PathArray }[]>(
      (paths, segment, i) =>
        flatMap(paths, ({ json, path }) => {
          const result = queryPaths1(json, segment);
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

export function queryValues(json: Json, path: CompiledJsonPath): Json[] {
  return path.reduce(
    (jsons, segment) => flatMap(jsons, (json) => queryValues1(json, segment)),
    [json]
  );
}

export function isSingularPath(
  path: CompiledJsonPath | CompiledJsonIdPath
): boolean {
  return path.every((p: JsonPathSegment | IdSegment) => {
    switch (p.type) {
      case 'Key':
      case 'Index':
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
