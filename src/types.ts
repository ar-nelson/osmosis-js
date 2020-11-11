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
