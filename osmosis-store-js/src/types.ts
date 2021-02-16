import { Id } from './id';

export type Json = JsonScalar | JsonArray | JsonObject;

export type JsonScalar = null | boolean | number | string;

export interface JsonArray extends ReadonlyArray<Json> {}

export interface JsonObject {
  readonly [key: string]: Json;
}

export type PathArray = ReadonlyArray<string | number>;

export type AbsolutePathArray = readonly [string, ...PathArray];

export interface Cancelable {
  cancel(): void;
}

export interface Failure {
  path: PathArray | string;
  message: string;
  id?: Id;
}

export class OsmosisFailureError extends Error {
  constructor(when: string, public readonly failures: readonly Failure[]) {
    super(`Failure${failures.length > 1 ? 's' : ''} occurred when ${when}:
${failures.map((f) => JSON.stringify(f, null, 2)).join('\n')}`);
  }
}
