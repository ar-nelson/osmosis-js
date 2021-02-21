import { JsonPathAction, Uuid } from '@nels.onl/osmosis-store-js';
export {
  Action as DataAction,
  MathAction,
  MoveAction,
  ScalarAction,
  SetAction,
  Transaction,
  VoidAction,
} from '@nels.onl/osmosis-store-js';

export interface RequestPairAction {
  readonly action: 'RequestPair';
  readonly payload: {
    readonly id: Uuid;
    readonly secret: string;
  };
}

export interface AcceptPairAction {
  readonly action: 'AcceptPair';
  readonly payload: {
    readonly id: Uuid;
    readonly secret: string;
  };
}

export interface RejectPairAction {
  readonly action: 'RejectPair';
  readonly payload: Uuid;
}

export interface UnpairAction {
  readonly action: 'Unpair';
  readonly payload: Uuid;
}

export interface SettingToggleAction {
  readonly action: 'SetVisibleToPeers' | 'SetSyncEnabled';
  readonly payload: boolean;
}

export type NetworkAction =
  | RequestPairAction
  | AcceptPairAction
  | RejectPairAction
  | UnpairAction
  | SettingToggleAction;

export type Action = JsonPathAction | NetworkAction;
