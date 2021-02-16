import { JsonPathSegment } from '../src/jsonpath';
import { Change } from '../src/actions';
import { AbsolutePathArray, Json } from '../src/types';

export function Key(query: string): JsonPathSegment {
  return { type: 'Key', query };
}

export function Index(query: number): JsonPathSegment {
  return { type: 'Index', query };
}

export function Put(path: AbsolutePathArray, value: Json): Change {
  return { type: 'Put', path, value };
}

export function Delete(path: AbsolutePathArray): Change {
  return { type: 'Delete', path };
}

export function Touch(path: AbsolutePathArray): Change {
  return { type: 'Touch', path };
}

export function Move(from: AbsolutePathArray, to: AbsolutePathArray): Change {
  return { type: 'Move', from, to };
}
