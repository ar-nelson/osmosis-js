import assert from 'assert';
import { hostname } from 'os';
import * as Monocypher from 'monocypher-wasm';
import { randomBytes } from 'crypto';
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

export interface JsonPeerInfo {
  readonly peerId: string;
  readonly peerName: string;
  readonly publicKey: string;
}

export interface JsonPeerConfig extends JsonPeerInfo {
  readonly appId: string;
  readonly privateKey: string;
  readonly pairedPeers: readonly JsonPeerInfo[];
}

export function serializePeerConfig(config: PeerConfig): JsonPeerConfig {
  return {
    ...config,
    publicKey: config.publicKey.toString('base64'),
    privateKey: config.privateKey.toString('base64'),
    pairedPeers: config.pairedPeers.map((p) => ({
      ...p,
      publicKey: p.publicKey.toString('base64'),
    })),
  };
}

export function deserializePeerConfig(config: JsonPeerConfig): PeerConfig {
  return {
    ...config,
    publicKey: Buffer.from(config.publicKey, 'base64'),
    privateKey: Buffer.from(config.privateKey, 'base64'),
    pairedPeers: config.pairedPeers.map((p) => ({
      ...p,
      publicKey: Buffer.from(p.publicKey, 'base64'),
    })),
  };
}

export async function generateConfig(
  appId: string = uuid.v4(),
  peerName: string = hostname()
): Promise<PeerConfig> {
  assert(uuid.validate(appId), 'appId must be a UUID');
  await Monocypher.ready;
  const privateKey = randomBytes(Monocypher.KEY_BYTES);
  const publicKey = Buffer.from(
    Monocypher.crypto_key_exchange_public_key(privateKey)
  );
  return {
    appId,
    peerId: uuid.v4(),
    peerName,
    publicKey,
    privateKey,
    pairedPeers: [],
  };
}
