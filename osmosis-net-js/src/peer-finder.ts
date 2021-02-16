import broadcastInterfaces from 'broadcast-interfaces';
import Logger from 'bunyan';
import * as dgram from 'dgram';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import * as uuid from 'uuid';
import { MAX_PEER_NAME_LENGTH, PeerConfig } from './peer-config';
import { binaryEqual, UUID_LENGTH } from './utils';
import { KEY_BYTES } from 'monocypher-wasm';

// Magic number to identify broadcast messages: 05-M-05-15
const MAGIC = Uint8Array.of(0x05, 0x4d, 0x05, 0x15);

const OFFSET_APP_ID = MAGIC.byteLength;
const OFFSET_PEER_ID = OFFSET_APP_ID + UUID_LENGTH;
const OFFSET_PUBLIC_KEY = OFFSET_PEER_ID + UUID_LENGTH;
const OFFSET_PORT = OFFSET_PUBLIC_KEY + KEY_BYTES;
const OFFSET_PEER_NAME_LENGTH = OFFSET_PORT + 2;
const OFFSET_PEER_NAME = OFFSET_PEER_NAME_LENGTH + 1;

export const HEARTBEAT_DELAY = 60 * 1000; // 1 minute

export interface NetworkInterface {
  readonly name: string;
  readonly address: string;
  readonly broadcastAddress: string;
}

interface HeartbeatInterface extends NetworkInterface {
  readonly sendSocket: dgram.Socket;
  readonly recvSocket: dgram.Socket;
}

interface FaultyInterface {
  readonly address: string;
  failures: number;
  expiresAt: Date;
}

export interface Heartbeat {
  readonly appId: string;
  readonly peerId: string;
  readonly publicKey: Buffer;
  readonly port: number;
  readonly peerName: string;
}

function heartbeatPacket(config: PeerConfig, gatewayPort: number): Uint8Array {
  const peerNameBinary = Buffer.from(config.peerName, 'utf8').slice(
    0,
    MAX_PEER_NAME_LENGTH
  );
  const heartbeatBytes = OFFSET_PEER_NAME + peerNameBinary.byteLength;
  const heartbeat = Buffer.alloc(heartbeatBytes);
  heartbeat.set(MAGIC, 0);
  heartbeat.set(uuid.parse(config.appId), OFFSET_APP_ID);
  heartbeat.set(uuid.parse(config.peerId), OFFSET_PEER_ID);
  heartbeat.set(config.publicKey, OFFSET_PUBLIC_KEY);
  heartbeat.writeUInt16BE(gatewayPort, OFFSET_PORT);
  heartbeat.writeUInt8(peerNameBinary.byteLength, OFFSET_PEER_NAME_LENGTH);
  heartbeat.set(peerNameBinary, OFFSET_PEER_NAME);
  return heartbeat;
}

function jitter(time: number): number {
  return Math.ceil(time - time * 0.25 + Math.random() * time * 0.5);
}

export function heartbeatPortFromAppId(appId: string): number {
  const bytes = uuid.parse(appId);
  return bytes[0] | (bytes[1] << 8) | 0x8000;
}

export interface PeerFinderEvents {
  heartbeat: (evt: {
    heartbeat: Heartbeat;
    localAddress: string;
    remoteAddress: string;
  }) => void;
  interfaceUp: (ifa: NetworkInterface) => void;
  interfaceDown: (ifa: NetworkInterface) => void;
  start: () => void;
  stop: () => void;
}

declare interface PeerFinder {
  on<U extends keyof PeerFinderEvents>(
    event: U,
    listener: PeerFinderEvents[U]
  ): this;

  emit<U extends keyof PeerFinderEvents>(
    event: U,
    ...args: Parameters<PeerFinderEvents[U]>
  ): boolean;
}

class PeerFinder extends EventEmitter {
  private intervalTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  private readonly heartbeatPort: number;
  private interfaces = new Map<string, HeartbeatInterface>();
  private faultyInterfaces = new Map<string, FaultyInterface>();
  private readonly recentPeers = new Map<string, Date>();

  constructor(
    private readonly config: PeerConfig,
    private gatewayPort: number,
    private peerIdToPublicKey: (peerId: string) => Buffer | undefined = () =>
      undefined,
    private readonly log: Logger = Logger.createLogger({
      name: 'osmosis-peer-finder',
    })
  ) {
    super();
    this.heartbeatPort = heartbeatPortFromAppId(config.appId);
    this.start();
  }

  async start(): Promise<void> {
    this.log.info('Starting peer finder');
    this.intervalTimer = setInterval(() => {
      this.scanInterfaces();
    }, HEARTBEAT_DELAY);
    this.scanInterfaces();
    this.emit('start');
  }

  stop(): void {
    this.log.info('Stopping peer finder');
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    for (const [, ifa] of this.interfaces) {
      this.shutdownInterface(ifa);
    }
    this.interfaces.clear();
    this.emit('stop');
  }

  private shutdownInterface(ifa: HeartbeatInterface) {
    this.log.trace('Shutting down interface %s (%s)', ifa.name, ifa.address);
    ifa.sendSocket.close();
    ifa.recvSocket.close();
    this.emit('interfaceDown', {
      name: ifa.name,
      address: ifa.address,
      broadcastAddress: ifa.broadcastAddress,
    });
  }

  scanInterfaces(): void {
    const interfaces = broadcastInterfaces().filter(
      (x) => x.running && !x.internal
    );
    const missing = [...this.interfaces.keys()].filter(
      (a) => !interfaces.find((ifa) => ifa.address === a)
    );
    missing.forEach((a) => {
      const ifa = this.interfaces.get(a);
      if (ifa) {
        this.shutdownInterface(ifa);
        this.interfaces.delete(a);
      }
    });
    for (const ifa of interfaces) {
      if (this.interfaces.has(ifa.address)) {
        continue;
      }
      const faulty = this.faultyInterfaces.get(ifa.address);
      if (faulty) {
        if (new Date() < faulty.expiresAt) {
          this.log.trace(
            'Skipping heartbeat for %s: interface flagged as faulty',
            ifa.address
          );
          continue;
        }
        this.log.trace(
          'Retrying heartbeat for %s (faulty flag expired)',
          ifa.address
        );
        this.faultyInterfaces.delete(ifa.address);
      }
      this.log.info('New interface found: %s (%s)', ifa.name, ifa.address);
      try {
        const sendSocket = dgram.createSocket({
          type: 'udp4',
          reuseAddr: true,
        });
        const recvSocket = dgram.createSocket({
          type: 'udp4',
          reuseAddr: true,
        });
        recvSocket.on('listening', () => {
          this.log.trace(
            'Interface %s bound to UDP port %d',
            ifa.address,
            this.heartbeatPort
          );
          recvSocket.setBroadcast(true);
          this.heartbeatLoop(ifa.address);
        });
        recvSocket.on('message', (msg, { address }) => {
          this.receiveHeartbeat(msg, address, ifa.address);
        });
        const onError = (err) => {
          this.log.warn(
            { err },
            `Error occurred on interface %s (%s)`,
            ifa.name,
            ifa.address
          );
          this.reportFaultyInterface(ifa.address);
        };
        sendSocket.on('error', onError);
        recvSocket.on('error', onError);
        sendSocket.bind({ address: ifa.address }, () =>
          sendSocket.setBroadcast(true)
        );
        recvSocket.bind({
          address: ifa.broadcast,
          port: this.heartbeatPort,
        });
        this.interfaces.set(ifa.address, {
          name: ifa.name,
          address: ifa.address,
          broadcastAddress: ifa.broadcast,
          sendSocket,
          recvSocket,
        });
        this.emit('interfaceUp', {
          name: ifa.name,
          address: ifa.address,
          broadcastAddress: ifa.broadcast,
        });
      } catch (err) {
        this.log.warn(
          { err },
          `Failed to bind to interface %s (%s)`,
          ifa.name,
          ifa.address
        );
        this.reportFaultyInterface(ifa.address);
      }
    }
  }

  private reportFaultyInterface(address: string) {
    const ifa = this.interfaces.get(address);
    if (ifa) {
      this.shutdownInterface(ifa);
      this.interfaces.delete(address);
    }

    const faulty = this.faultyInterfaces.get(address) || {
      address,
      failures: 0,
      expiresAt: new Date(),
    };
    if (faulty.failures < 1) {
      this.faultyInterfaces.set(address, faulty);
    }
    faulty.failures += 1;
    faulty.expiresAt = new Date(
      new Date().getTime() + HEARTBEAT_DELAY * Math.pow(2, faulty.failures)
    );
  }

  private async heartbeatLoop(interfaceAddress: string) {
    for (const seconds of [1, 2, 6, 10, 30]) {
      if (!(await this.sendHeartbeat(interfaceAddress))) {
        return;
      }
      await new Promise(
        (resolve) =>
          (this.heartbeatTimer = setTimeout(resolve, jitter(seconds * 1000)))
      );
    }
    while (await this.sendHeartbeat(interfaceAddress)) {
      await new Promise(
        (resolve) =>
          (this.heartbeatTimer = setTimeout(resolve, jitter(HEARTBEAT_DELAY)))
      );
    }
  }

  async sendHeartbeat(interfaceAddress: string): Promise<boolean> {
    const ifa = this.interfaces.get(interfaceAddress);
    if (!ifa || !this.gatewayPort) {
      this.log.trace(
        'Cannot send heartbeat: no active interface for %s',
        interfaceAddress
      );
      return false;
    }
    try {
      this.log.trace(
        'Sending heartbeat on interface %s (%s)',
        ifa.name,
        interfaceAddress
      );
      const message = heartbeatPacket(this.config, this.gatewayPort);
      await promisify(ifa.sendSocket.send.bind(ifa.sendSocket))(
        message,
        0,
        message.byteLength,
        this.heartbeatPort,
        ifa.broadcastAddress
      );
    } catch (err) {
      this.log.warn(
        { err },
        'Failed to send heartbeat on interface %s (%s)',
        ifa.name,
        interfaceAddress
      );
      return false;
    }
    return true;
  }

  private receiveHeartbeat(
    packet: Buffer,
    remoteAddress: string,
    localAddress: string
  ) {
    try {
      if (
        !binaryEqual(MAGIC, packet.subarray(0, MAGIC.byteLength)) ||
        packet.byteLength < OFFSET_PEER_NAME
      ) {
        this.log.trace(
          'Ignoring broadcast packet from %s: not a heartbeat',
          remoteAddress
        );
        return;
      }
      const heartbeat: Heartbeat = {
        appId: uuid.stringify(
          packet.subarray(OFFSET_APP_ID, OFFSET_APP_ID + UUID_LENGTH)
        ),
        peerId: uuid.stringify(
          packet.subarray(OFFSET_PEER_ID, OFFSET_PEER_ID + UUID_LENGTH)
        ),
        publicKey: packet.subarray(
          OFFSET_PUBLIC_KEY,
          OFFSET_PUBLIC_KEY + KEY_BYTES
        ),
        port: packet.readUInt16BE(OFFSET_PORT),
        peerName: packet
          .subarray(
            OFFSET_PEER_NAME,
            OFFSET_PEER_NAME + packet.readUInt8(OFFSET_PEER_NAME_LENGTH)
          )
          .toString('utf8'),
      };
      if (this.config.appId !== heartbeat.appId) {
        this.log.trace(
          'Ignoring heartbeat from %s: different appId',
          remoteAddress
        );
        return;
      }
      if (
        heartbeat.peerName.length > MAX_PEER_NAME_LENGTH ||
        heartbeat.port < 1024 ||
        heartbeat.port > 65535
      ) {
        this.log.warn(
          'Ignoring heartbeat from %s: malformed heartbeat packet',
          remoteAddress
        );
        return;
      }
      const peerId = heartbeat.peerId;
      if (peerId === this.config.peerId) {
        return;
      }

      const publicKey = this.peerIdToPublicKey(peerId);
      if (publicKey) {
        if (!binaryEqual(publicKey, heartbeat.publicKey)) {
          this.log.warn(
            'Apparent peer %s at %s:%d has wrong public key',
            peerId,
            remoteAddress,
            heartbeat.port
          );
          return;
        }
      }

      this.log.trace(
        'Received heartbeat for %s at %s:%d',
        peerId,
        remoteAddress,
        heartbeat.port
      );

      // Send a pingback to new peers, to ensure they see us
      const expiration = this.recentPeers.get(peerId);
      const now = new Date();
      if (!expiration || expiration < now) {
        this.log.trace('Sending pingback heartbeat to %s', peerId);
        this.sendHeartbeat(localAddress);
      }
      this.recentPeers.set(
        peerId,
        new Date(now.getTime() + HEARTBEAT_DELAY * 2)
      );

      this.emit('heartbeat', { heartbeat, localAddress, remoteAddress });
    } catch (err) {
      this.log.warn(
        { err },
        'Exception when receiving heartbeat packet from %s',
        remoteAddress
      );
    }
  }
}

export default PeerFinder;
