import { JsonPath, Vars } from './jsonpath';
import { Cancelable, Json } from './types';

export default interface Queryable {
  subscribe(
    query: JsonPath,
    vars: Vars,
    callback: (json: Json) => void
  ): Cancelable;

  subscribe(query: JsonPath, callback: (json: Json[]) => void): Cancelable;

  queryOnce(query: JsonPath, vars: Vars): Json[];
}
