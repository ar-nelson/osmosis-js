import { Action } from './actions';
import { CausalTree, Id } from './id';
import { CacheSource } from './json-cache';
import { CompiledJsonIdPath, CompiledJsonPath } from './jsonpath';
import { Failure } from './types';
import { Change } from './actions';

export type Op = CausalTree & Action<CompiledJsonPath | CompiledJsonIdPath>;

export interface StateSummary {
  readonly hash: Uint8Array;
  readonly latestIndexes: { readonly [peerId: string]: number };
}

export interface SavePoint extends StateSummary {
  readonly id: Id;
  readonly width: number;
}

export interface SaveState<Metadata extends { readonly [key: string]: string }>
  extends CacheSource {
  insert(
    ops: Op[]
  ): {
    changes: readonly Change[];
    failures: readonly Failure[];
  };
  ops(maxLength?: number): readonly Op[];
  failures(maxLength?: number): readonly Failure[];
  rewind(latestId: Id): readonly Op[];
  savePoints(): readonly SavePoint[];
  metadata(): Metadata;
  setMetadata(metadata: Metadata): void;
  stateSummary(): StateSummary;
}
