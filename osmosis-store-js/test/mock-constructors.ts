import { Change } from '../src/actions';
import { pathArrayToBinary } from '../src/binary-path';
import { JsonPathSegment } from '../src/jsonpath';
import { AbsolutePathArray, Json } from '../src/types';

export function Key(query: string): JsonPathSegment {
  return { type: 'Key', query };
}

export function Index(query: number): JsonPathSegment {
  return { type: 'Index', query };
}

export function Put(path: AbsolutePathArray, value: Json): Change {
  return { type: 'Put', path: pathArrayToBinary(path), value };
}

export function Delete(path: AbsolutePathArray): Change {
  return { type: 'Delete', path: pathArrayToBinary(path) };
}

export function Touch(path: AbsolutePathArray): Change {
  return { type: 'Touch', path: pathArrayToBinary(path) };
}

export function Move(from: AbsolutePathArray, to: AbsolutePathArray): Change {
  return {
    type: 'Move',
    from: pathArrayToBinary(from),
    to: pathArrayToBinary(to),
  };
}
