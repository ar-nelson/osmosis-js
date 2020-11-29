export type Json = null | boolean | number | string | JsonArray | JsonObject;

export interface JsonArray extends ReadonlyArray<Json> {}

export interface JsonObject {
  readonly [key: string]: Json;
}

export type PathArray = ReadonlyArray<string | number>;

export type Uuid = string;

export interface Cancelable {
  cancel(): void;
}

export interface Failure {
  path: PathArray;
  message: string;
  id?: Timestamp;
}

export interface Timestamp {
  author: Uuid;
  index: number;
}

export function timestampToString({ author, index }: Timestamp) {
  return `${index.toString(32).padStart(11, '0')}@${author}`;
}

export class OsmosisFailureError extends Error {
  constructor(when: string, public readonly failures: readonly Failure[]) {
    super(`Failure${failures.length > 1 ? 's' : ''} occurred when ${when}:
${failures.map((f) => JSON.stringify(f, null, 2)).join('\n')}`);
  }
}
