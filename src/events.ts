import { JsonPath } from './jsonpath';
import { PathArray } from './types';

export interface Failure {
  path: JsonPath | PathArray;
  message: string;
}

export interface MergeFailureEvent {
  event: 'MergeFailure';
  payload: Failure[];
}

export interface PeerEvent {
  event: 'PeerAppeared' | 'PeerDisappeared';
  payload: {
    address: string;
    uuid: string;
    paired: boolean;
  };
}

export interface JoinRequestEvent {
  event: 'JoinRequest';
  payload: {
    pin: string;
    address: string;
    uuid: string;
    message: string;
    groupName: string;
    groupUuid: string;
  };
}

export interface JoinedEvent {
  event: 'Joined';
  payload: {
    groupName: string;
    groupUuid: string;
  };
}

export interface PinGeneratedEvent {
  event: 'PinGenerated';
  payload: {
    pin: string;
    uuid: string;
  };
}

export type NetworkEvent =
  | MergeFailureEvent
  | PeerEvent
  | JoinRequestEvent
  | JoinedEvent
  | PinGeneratedEvent;
