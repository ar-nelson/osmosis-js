import { Failure, Uuid } from './types';

export interface MergeFailureEvent {
  event: 'MergeFailure';
  payload: Failure[];
}

export interface PeerEvent {
  event: 'PeerAppeared' | 'PeerDisappeared';
  payload: {
    address: string;
    uuid: Uuid;
    paired: boolean;
  };
}

export interface JoinRequestEvent {
  event: 'JoinRequest';
  payload: {
    pin: string;
    address: string;
    uuid: Uuid;
    message: string;
    groupName: string;
    groupUuid: string;
  };
}

export interface JoinedEvent {
  event: 'Joined';
  payload: {
    groupName: string;
    groupUuid: Uuid;
  };
}

export interface PinGeneratedEvent {
  event: 'PinGenerated';
  payload: {
    pin: string;
    uuid: Uuid;
  };
}

export type NetworkEvent =
  | MergeFailureEvent
  | PeerEvent
  | JoinRequestEvent
  | JoinedEvent
  | PinGeneratedEvent;
