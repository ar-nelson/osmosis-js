import { Action, Change } from './actions';
import { BinaryPath } from './binary-path';
import { CausalTree, Id } from './id';
import { JsonNode, JsonSource } from './json-source';
import { CompiledJsonIdPath, CompiledJsonPath } from './jsonpath';
import { Failure } from './types';

export type Op = CausalTree & Action<CompiledJsonPath | CompiledJsonIdPath>;

export interface StateSummary {
  readonly hash: Uint8Array;
  readonly latestIndexes: { readonly [peerId: string]: number };
}

export interface SavePoint extends StateSummary {
  readonly id: Id;
  readonly width: number;
}

export abstract class SaveState<Metadata> implements JsonSource {
  abstract insert(
    ops: readonly Op[]
  ): Promise<{
    changes: readonly Change[];
    failures: readonly Failure[];
  }>;
  get ops(): Promise<readonly Op[]> {
    return this.opsRange(null, null);
  }
  get failures(): Promise<readonly (Failure & CausalTree)[]> {
    return this.failuresRange(null, null);
  }
  abstract opsRange(
    earliestId: Id | null,
    latestId: Id | null
  ): Promise<readonly Op[]>;
  abstract failuresRange(
    earliestId: Id | null,
    latestId: Id | null
  ): Promise<readonly (Failure & CausalTree)[]>;
  abstract garbageCollect(earliestId: Id): Promise<void>;
  abstract rewind(latestId: Id): Promise<readonly Op[]>;
  abstract savePoints: Promise<readonly SavePoint[]>;
  abstract metadata: Promise<Metadata>;
  abstract setMetadata(metadata: Metadata): Promise<void>;
  abstract initMetadata(initializer: () => Promise<Metadata>): Promise<void>;
  abstract stateSummary: Promise<StateSummary>;
  abstract getByPath(path: BinaryPath): Promise<JsonNode | undefined>;
  abstract getById(id: Id): Promise<JsonNode | undefined>;
  abstract getPathById(id: Id): Promise<BinaryPath | undefined>;
  abstract getIdsByPath(path: BinaryPath): Promise<Id[]>;
  abstract getIdsAfter(
    id: Id
  ): Promise<Iterable<{ readonly id: Id; readonly path: BinaryPath }>>;
}
