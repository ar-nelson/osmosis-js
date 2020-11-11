import isPlainObject from 'lodash.isplainobject';
import flatMap from 'lodash.flatmap';
import isEqual from 'lodash.isequal';
import produce, { Draft } from 'immer';
import nearley from 'nearley';
import grammar from './jsonpath.grammar';
import { Json, JsonObject, PathArray } from './types';
import { IdMappedJson, PathToIdTree } from './path-to-id-tree';

const isObject: (
  json: Draft<Json>
) => json is Draft<JsonObject> = isPlainObject as any;

export type JsonPath = string;

export type CompiledJsonPath = JsonPathSegment[];

export type CompiledJsonIdPath = JsonIdPathSegment[];

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

export type JsonIdPathSegment = JsonPathSegment | IdSegment | MultiIdSegment;

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
  readonly query: string[];
}

export interface MultiIndexSegment {
  readonly type: 'MultiIndex';
  readonly query: number[];
}

export interface ExprIndexSegment {
  readonly type: 'ExprIndex';
  readonly query: JsonPathExpr[];
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
  readonly query: JsonPathSegment[];
}

export interface IdSegment {
  readonly type: 'Id';
  readonly query: string;
}

export interface MultiIdSegment {
  readonly type: 'MultiId';
  readonly query: string[];
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

export type LiteralExpr = readonly [
  'literal',
  number | string | boolean | null
];

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

function querySlots1(json: Json, segment: JsonPathSegment): PathArray[] {
  switch (segment.type) {
    case 'Wildcard':
      if (Array.isArray(json)) {
        return json.map((x, i) => [i]);
      }
      if (isObject(json)) {
        return Object.keys(json).map((x) => [x]);
      }
      return [];
    case 'Key':
      return isObject(json) ? [[segment.query]] : [];
    case 'Index':
      return Array.isArray(json) && segment.query >= 0 ? [[segment.query]] : [];
    case 'MultiKey':
      return isObject(json) ? segment.query.map((x) => [x]) : [];
    case 'MultiIndex':
      return Array.isArray(json)
        ? segment.query.filter((x) => x >= 0).map((x) => [x])
        : [];
    case 'ExprIndex':
      return segment.query
        .map((expr) => evalJsonPathExpr(json, expr))
        .filter(
          (x) =>
            (Array.isArray(json) && typeof x === 'number') ||
            (isObject(json) && typeof x === 'string')
        )
        .map((x) => [x as string | number]);
    case 'Slice': {
      if (!Array.isArray(json)) return [];
      const { from = 0, to = json.length, step = 1 } = segment.query;
      const paths: PathArray[] = [];
      for (let i = from; i < Math.min(json.length, to); i += step) {
        paths.push([i]);
      }
      return paths;
    }
    case 'ExprSlice': {
      if (!Array.isArray(json)) return [];
      const from = segment.query.from
        ? expectNumber('slice', evalJsonPathExpr(json, segment.query.from))
        : 0;
      const to = segment.query.to
        ? expectNumber('slice', evalJsonPathExpr(json, segment.query.to))
        : json.length;
      const step = segment.query.step
        ? expectNumber('slice', evalJsonPathExpr(json, segment.query.step))
        : 1;
      const paths: PathArray[] = [];
      for (let i = from; i < Math.min(json.length, to); i += step) {
        paths.push([i]);
      }
      return paths;
    }
    case 'Filter':
      if (Array.isArray(json)) {
        return flatMap(json, (x, i) =>
          evalJsonPathExpr(x, segment.query) ? [[i]] : []
        );
      }
      if (isObject(json)) {
        return flatMap(Object.entries(json), ([k, v]) =>
          evalJsonPathExpr(v, segment.query) ? [[k]] : []
        );
      }
      return [];
    case 'Recursive':
      if (Array.isArray(json)) {
        return [
          ...querySlots(json, segment.query),
          ...flatMap(json, (x, i) =>
            querySlots1(x, segment).map((p) => [i, ...p])
          ),
        ];
      }
      if (isObject(json)) {
        return [
          ...querySlots(json, segment.query),
          ...flatMap(Object.entries(json), ([k, v]) =>
            querySlots1(v, segment).map((p) => [k, ...p])
          ),
        ];
      }
      return [];
  }
}

function queryPaths1(json: Json, segment: JsonPathSegment): PathArray[] {
  return querySlots1(json, segment).filter(
    (p) => p.reduce((j, i) => j?.[i], json) !== undefined
  );
}

function queryValues1(json: Json, segment: JsonPathSegment): Json[] {
  return querySlots1(json, segment)
    .map((p) => p.reduce((j, i) => j?.[i], json))
    .filter((x) => x !== undefined);
}

export function querySlots(json: Json, path: CompiledJsonPath): PathArray[] {
  return path
    .reduce<{ json: Json; path: PathArray }[]>(
      (paths, segment, i) => {
        const query = i < path.length - 1 ? queryPaths1 : querySlots1;
        return flatMap(paths, ({ json, path }) =>
          query(json, segment).map((p) => ({
            json: p.reduce((j, i) => j?.[i], json),
            path: [...path, ...p],
          }))
        );
      },
      [{ json, path: [] }]
    )
    .map((x) => x.path);
}

export function queryPaths(json: Json, path: CompiledJsonPath): PathArray[] {
  return path
    .reduce<{ json: Json; path: PathArray }[]>(
      (paths, segment) =>
        flatMap(paths, ({ json, path }) =>
          queryPaths1(json, segment).map((p) => ({
            json: p.reduce((j, i) => j?.[i], json),
            path: [...path, ...p],
          }))
        ),
      [{ json, path: [] }]
    )
    .map((x) => x.path);
}

export function queryValues(json: Json, path: CompiledJsonPath): Json[] {
  return path.reduce(
    (jsons, segment) => flatMap(jsons, (json) => queryValues1(json, segment)),
    [json]
  );
}

function compileIndex(index: [string, ...any]): JsonPathExpr {
  switch (index[0]) {
    case 'expression':
      return index[1];
    case 'index':
    case 'key':
      return ['literal', index[1]];
    default:
      throw new Error(`not an index: ${index}`);
  }
}

function compileSegment(segment: [string, ...any]): JsonPathSegment {
  switch (segment[0]) {
    case 'key':
      return { type: 'Key', query: segment[1] };
    case 'index':
      return { type: 'Index', query: segment[1] };
    case 'expression':
      return { type: 'ExprIndex', query: [segment[1]] };
    case 'filter':
      return { type: 'Filter', query: segment[1] };
    case 'multi':
      if (segment.slice(1).every((i) => i[0] === 'index')) {
        return { type: 'MultiIndex', query: segment.slice(1).map((x) => x[1]) };
      }
      if (segment.slice(1).every((i) => i[0] === 'key')) {
        return { type: 'MultiKey', query: segment.slice(1).map((x) => x[1]) };
      }
      return { type: 'ExprIndex', query: segment.slice(1).map(compileIndex) };
    case 'slice':
      if (segment.slice(1, 4).every((i) => i[0] === 'index')) {
        return {
          type: 'Slice',
          query: {
            from: segment[1]?.[1],
            to: segment[2]?.[1],
            step: segment[3]?.[1],
          },
        };
      }
      return {
        type: 'ExprSlice',
        query: {
          from: segment[1] && compileIndex(segment[1]),
          to: segment[2] && compileIndex(segment[2]),
          step: segment[3] && compileIndex(segment[3]),
        },
      };
    case 'recursive':
      return { type: 'Recursive', query: segment.slice(1).map(compileSegment) };
    case 'wildcard':
      return { type: 'Wildcard' };
    default:
      throw new Error(`not a segment: ${segment}`);
  }
}

export function compileJsonPath(path: JsonPath): CompiledJsonPath {
  const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar));
  parser.feed(path);
  return parser.results[0].map(compileSegment);
}
