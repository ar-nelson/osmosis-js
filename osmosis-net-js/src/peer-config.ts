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
