import { readFile } from 'fs';
import { pki } from 'node-forge';
import { join, normalize } from 'path';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

// Magic number to identify broadcast messages: 05-M-05-15
const MAGIC = Uint8Array.of(0x05, 0x4d, 0x05, 0x15);

// Paths to root certificate.
// There's nothing secret about this root cert or its passphrase,
// it's just a formality to generate new certs for each peer.
const ROOT_KEY = normalize(join(__dirname, '..', 'cert', 'osmosis-root.key'));
const ROOT_PEM = normalize(join(__dirname, '..', 'cert', 'osmosis-root.pem'));
const ROOT_PASSPHRASE = 'Osmosis';

const rootCertPem = promisify(readFile)(ROOT_PEM, { encoding: 'utf8' });

export interface PeerInfo {
  readonly peerId: Uint8Array;
  readonly peerName: string;
  readonly heartbeatKey: Uint8Array;
  readonly certFingerprint: string;
}

export interface PeerConfig extends PeerInfo {
  readonly appId: Uint8Array;
  readonly privateKey: string;
  readonly certificate: string;
  readonly knownPeers: PeerInfo[];
}

function randomUuid(): Uint8Array {
  const uuid = new Uint8Array(16);
  uuidv4({}, uuid);
  return uuid;
}

export async function generateConfig(
  peerName: string,
  appId: Uint8Array = randomUuid()
): Promise<PeerConfig> {
  const rootKeyPem = await promisify(readFile)(ROOT_KEY, { encoding: 'utf8' });
  const rootKey = pki.decryptRsaPrivateKey(rootKeyPem, ROOT_PASSPHRASE);
  const rootCert = pki.certificateFromPem(await rootCertPem);
  const keys = await promisify(pki.rsa.generateKeyPair)({ bits: 2048 });
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(
    cert.validity.notBefore.getFullYear() + 100
  );
  cert.setSubject([
    {
      name: 'commonName',
      value: peerName,
    },
    {
      name: 'countryName',
      value: 'US',
    },
    {
      shortName: 'ST',
      value: 'Massachusetts',
    },
    {
      name: 'localityName',
      value: 'N/A',
    },
    {
      name: 'organizationName',
      value: 'N/A',
    },
    {
      shortName: 'OU',
      value: 'N/A',
    },
  ]);
  cert.setIssuer(rootCert.issuer.attributes);
  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: true,
    },
    {
      name: 'keyUsage',
      keyCertSign: true,
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      dataEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
      clientAuth: true,
      codeSigning: false,
      emailProtection: false,
      timeStamping: true,
    },
    {
      name: 'nsCertType',
      client: true,
      server: true,
      email: false,
      objsign: false,
      sslCA: false,
      emailCA: false,
      objCA: false,
    },
    {
      name: 'subjectKeyIdentifier',
    },
  ]);
  cert.sign(rootKey);
  return {
    appId,
    peerId: randomUuid(),
    peerName,
    heartbeatKey: randomUuid(),
    privateKey: pki.privateKeyToPem(keys.privateKey),
    certificate: pki.certificateToPem(cert),
    certFingerprint: pki.getPublicKeyFingerprint(keys.publicKey).toHex(),
    knownPeers: [],
  };
}

export class Node {
  constructor(
    public readonly config: PeerConfig,
    private pairings: string[] = []
  ) {}

  private sendHeartbeat() {}

  private receiveHeartbeat() {}
}

export interface Peer {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly paired: boolean;
}
