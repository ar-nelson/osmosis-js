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

export interface SaveState<Metadata> extends CacheSource {
  insert(
    ops: Op[]
  ): Promise<{
    changes: readonly Change[];
    failures: readonly Failure[];
  }>;
  ops(maxLength?: number): Promise<readonly Op[]>;
  failures(maxLength?: number): Promise<readonly Failure[]>;
  rewind(latestId: Id): Promise<readonly Op[]>;
  savePoints(): Promise<readonly SavePoint[]>;
  metadata(): Promise<Metadata>;
  setMetadata(metadata: Metadata): Promise<void>;
  initMetadata(initializer: () => Promise<Metadata>): Promise<void>;
  stateSummary(): Promise<StateSummary>;
}
