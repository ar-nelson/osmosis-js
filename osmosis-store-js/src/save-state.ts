import { Action, Change } from './actions';
import { CausalTree, Id } from './id';
import {
  CacheSource,
  JsonCacheDatum,
  NonEmptyJsonCacheDatum,
} from './json-cache';
import { CompiledJsonIdPath, CompiledJsonPath } from './jsonpath';
import { AbsolutePathArray, Failure, PathArray } from './types';

export type Op = CausalTree & Action<CompiledJsonPath | CompiledJsonIdPath>;

export interface StateSummary {
  readonly hash: Uint8Array;
  readonly latestIndexes: { readonly [peerId: string]: number };
}

export interface SavePoint extends StateSummary {
  readonly id: Id;
  readonly width: number;
}

export abstract class SaveState<Metadata> implements CacheSource {
  abstract insert(
    ops: Op[]
  ): Promise<{
    changes: readonly Change[];
    failures: readonly Failure[];
  }>;
  get ops(): Promise<readonly Op[]> {
    return this.opsRange(null, null);
  }
  get failures(): Promise<readonly Failure[]> {
    return this.failuresRange(null, null);
  }
  abstract opsRange(
    earliestId: Id | null,
    latestId: Id | null
  ): Promise<readonly Op[]>;
  abstract failuresRange(
    earliestId: Id | null,
    latestId: Id | null
  ): Promise<readonly Failure[]>;
  abstract rewind(latestId: Id): Promise<readonly Op[]>;
  abstract savePoints: Promise<readonly SavePoint[]>;
  abstract metadata: Promise<Metadata>;
  abstract setMetadata(metadata: Metadata): Promise<void>;
  abstract initMetadata(initializer: () => Promise<Metadata>): Promise<void>;
  abstract stateSummary: Promise<StateSummary>;
  abstract lookupByPath(path: PathArray): Promise<JsonCacheDatum>;
  abstract lookupById(
    id: Id
  ): Promise<(JsonCacheDatum & { readonly path: AbsolutePathArray }) | null>;
  abstract listObject(
    path: PathArray
  ): Promise<readonly (NonEmptyJsonCacheDatum & { key: string })[]>;
  abstract listArray(
    path: PathArray
  ): Promise<readonly NonEmptyJsonCacheDatum[]>;
}
