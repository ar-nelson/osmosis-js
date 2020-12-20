import assert from 'assert';
import { hostname } from 'os';
import {
  crypto_box_keypair,
  crypto_box_PUBLICKEYBYTES,
  crypto_box_SECRETKEYBYTES,
  sodium_malloc,
} from 'sodium-native';
import * as uuid from 'uuid';

export const MAX_PEER_NAME_LENGTH = 64;

export interface PeerInfo {
  readonly peerId: string;
  readonly peerName: string;
  readonly publicKey: Buffer;
}

export interface PeerConfig extends PeerInfo {
  readonly appId: string;
  readonly privateKey: Buffer;
  readonly pairedPeers: PeerInfo[];
}

export function generateConfig(
  appId: string = uuid.v4(),
  peerName: string = hostname()
): PeerConfig {
  assert(uuid.validate(appId), 'appId must be a UUID');
  const publicKey = sodium_malloc(crypto_box_PUBLICKEYBYTES);
  const privateKey = sodium_malloc(crypto_box_SECRETKEYBYTES);
  crypto_box_keypair(publicKey, privateKey);
  return {
    appId,
    peerId: uuid.v4(),
    peerName,
    publicKey,
    privateKey,
    pairedPeers: [],
  };
}
