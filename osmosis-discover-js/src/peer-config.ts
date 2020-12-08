import assert from 'assert';
import { readFile } from 'fs';
import { pki } from 'node-forge';
import { hostname } from 'os';
import { join, normalize } from 'path';
import { promisify } from 'util';
import * as uuid from 'uuid';

// Paths to root certificate.
// There's nothing secret about this root cert or its passphrase,
// it's just a formality to generate new certs for each peer.
const ROOT_KEY = normalize(join(__dirname, '..', 'cert', 'osmosis-root.key'));
const ROOT_PEM = normalize(join(__dirname, '..', 'cert', 'osmosis-root.pem'));
const ROOT_PASSPHRASE = 'Osmosis';

const rootCertPem = promisify(readFile)(ROOT_PEM, { encoding: 'utf8' });

export const MAX_PEER_NAME_LENGTH = 64;
export const UUID_LENGTH = 16;

export interface PeerInfo {
  readonly peerId: string;
  readonly peerName: string;
  readonly heartbeatKey: string;
  readonly certFingerprint: string;
}

export interface PeerConfig extends PeerInfo {
  readonly appId: string;
  readonly privateKey: string;
  readonly certificate: string;
  readonly pairedPeers: PeerInfo[];
}

export async function generateConfig(
  appId: string = uuid.v4(),
  peerName: string = hostname()
): Promise<PeerConfig> {
  assert(uuid.validate(appId), 'appId must be a UUID');
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
    peerId: uuid.v4(),
    peerName: peerName.slice(0, MAX_PEER_NAME_LENGTH),
    heartbeatKey: uuid.v4(),
    privateKey: pki.privateKeyToPem(keys.privateKey),
    certificate: pki.certificateToPem(cert),
    certFingerprint: pki.getPublicKeyFingerprint(keys.publicKey).toHex(),
    pairedPeers: [],
  };
}
