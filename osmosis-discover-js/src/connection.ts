import broadcastInterfaces from 'broadcast-interfaces';
import Logger from 'bunyan';
import * as dgram from 'dgram';
import getPort from 'get-port';
import { md, util as forgeUtil } from 'node-forge';
import { promisify } from 'util';
import * as uuid from 'uuid';
import * as proto from './osmosis_pb';
import { MAX_PEER_NAME_LENGTH, PeerConfig, UUID_LENGTH } from './peer-config';
import { binaryEqual, ipAddressToUint } from './utils';

// Magic number to identify broadcast messages: 05-M-05-15
const MAGIC = Uint8Array.of(0x05, 0x4d, 0x05, 0x15);

const HEARTBEAT_PORT = 5150;
const HEARTBEAT_DELAY = 60 * 1000; // 1 minute
const INITIAL_HEARTBEAT_DELAYS = [1, 2, 6, 10, 30].map((x) => x * 1000);

interface HeartbeatInterface {
  readonly name: string;
  readonly address: string;
  readonly broadcastAddress: string;
  readonly initialDelays: number[];
  readonly sendSocket: dgram.Socket;
  readonly recvSocket: dgram.Socket;
}

interface FaultyInterface {
  readonly address: string;
  failures: number;
  expiresAt: Date;
}

interface VisiblePeer {
  readonly peerId: string;
  peerName: string;
  ipAddress: string;
  port: number;
  readonly certFingerprint: Uint8Array;
  expiresAt: Date;
}

function heartbeatPacket(
  config: PeerConfig,
  ifa: HeartbeatInterface,
  gatewayPort: number
): Uint8Array {
  const payload = new proto.Heartbeat.Payload();
  payload.setAppid(uuid.parse(config.appId) as Uint8Array);
  payload.setPeerid(uuid.parse(config.peerId) as Uint8Array);
  payload.setPeername(config.peerName);
  payload.setIpaddress(ipAddressToUint(ifa.address));
  payload.setPort(gatewayPort);
  payload.setCertfingerprint(
    forgeUtil.binary.hex.decode(config.certFingerprint)
  );

  const heartbeat = new proto.Heartbeat();
  heartbeat.setPayload(payload);
  heartbeat.setSignature(heartbeatSignature(payload, config.heartbeatKey));

  const unprefixed = heartbeat.serializeBinary();
  const prefixed = new Uint8Array(unprefixed.byteLength + MAGIC.byteLength);
  prefixed.set(MAGIC, 0);
  prefixed.set(unprefixed, MAGIC.byteLength);
  return prefixed;
}

function heartbeatSignature(
  payload: proto.Heartbeat.Payload,
  heartbeatKey: string
): Uint8Array {
  const hash = md.sha256.create();
  hash.update(forgeUtil.binary.raw.encode(payload.serializeBinary()), 'raw');
  hash.update(
    forgeUtil.binary.raw.encode(uuid.parse(heartbeatKey) as Uint8Array),
    'raw'
  );
  return forgeUtil.binary.hex.decode(hash.digest().toHex());
}

function jitter(time: number): number {
  return Math.ceil(time - time * 0.25 + Math.random() * time * 0.5);
}

export default class Connection {
  private gatewayPort?: number;
  private intervalTimer?: ReturnType<typeof setInterval>;
  private interfaces: HeartbeatInterface[] = [];
  private faultyInterfaces: FaultyInterface[] = [];
  private visiblePeers: VisiblePeer[] = [];

  constructor(
    public readonly config: PeerConfig,
    private readonly log: Logger = Logger.createLogger({ name: 'osmosis' })
  ) {
    this.start();
  }

  async start(): Promise<void> {
    this.log.info('Starting connection');
    this.gatewayPort = await getPort();
    this.log.info('Gateway service active on port %d', this.gatewayPort);
    this.intervalTimer = setInterval(() => {
      this.scanInterfaces();
    }, HEARTBEAT_DELAY);
    this.scanInterfaces();
  }

  stop(): void {
    this.log.info('Stopping connection');
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }
    for (const ifa of this.interfaces) {
      this.shutdownInterface(ifa);
    }
    this.interfaces = [];
  }

  private shutdownInterface(ifa: HeartbeatInterface) {
    this.log.trace('Shutting down interface %s (%s)', ifa.name, ifa.address);
    ifa.sendSocket.close();
    ifa.recvSocket.close();
  }

  private scanInterfaces() {
    const interfaces = broadcastInterfaces().filter(
      (x) => x.running && !x.internal
    );
    this.interfaces = this.interfaces.filter((ifa) => {
      if (interfaces.find((found) => ifa.address === found.address)) {
        return true;
      }
      this.shutdownInterface(ifa);
      return false;
    });
    for (const ifa of interfaces) {
      if (
        this.interfaces.find((existing) => ifa.address === existing.address)
      ) {
        continue;
      }
      const faulty = this.faultyInterfaces.find(
        (faulty) => ifa.address === faulty.address
      );
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
        this.faultyInterfaces = this.faultyInterfaces.filter(
          (x) => x !== faulty
        );
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
            HEARTBEAT_PORT
          );
          recvSocket.setBroadcast(true);
          this.sendHeartbeat(ifa.address);
        });
        recvSocket.on('message', (msg, { address }) => {
          this.receiveHeartbeat(msg, address);
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
          port: HEARTBEAT_PORT,
        });
        this.interfaces.push({
          name: ifa.name,
          address: ifa.address,
          broadcastAddress: ifa.broadcast,
          initialDelays: [...INITIAL_HEARTBEAT_DELAYS],
          sendSocket,
          recvSocket,
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
    this.interfaces = this.interfaces.filter((ifa) => {
      if (ifa.address !== address) {
        return true;
      }
      this.shutdownInterface(ifa);
      return false;
    });

    const faulty = this.faultyInterfaces.find((f) => address === f.address) || {
      address,
      failures: 0,
      expiresAt: new Date(),
    };
    if (faulty.failures < 1) {
      this.faultyInterfaces.push(faulty);
    }
    faulty.failures += 1;
    faulty.expiresAt = new Date(
      new Date().getTime() + HEARTBEAT_DELAY * Math.pow(2, faulty.failures)
    );
  }

  private async sendHeartbeat(address: string) {
    const ifa = this.interfaces.find((ifa) => ifa.address === address);
    if (!ifa || !this.gatewayPort) {
      this.log.trace(
        'Cannot send heartbeat: no active interface for %s',
        address
      );
      return;
    }
    try {
      this.log.trace(
        'Sending heartbeat on interface %s (%s)',
        ifa.name,
        address
      );
      const message = heartbeatPacket(this.config, ifa, this.gatewayPort);
      await promisify(ifa.sendSocket.send.bind(ifa.sendSocket))(
        message,
        0,
        message.byteLength,
        HEARTBEAT_PORT,
        ifa.broadcastAddress
      );
      setTimeout(
        () => this.sendHeartbeat(address),
        jitter(
          (ifa.initialDelays.length && ifa.initialDelays.shift()) ||
            HEARTBEAT_DELAY
        )
      );
    } catch (err) {
      this.log.warn(
        { err },
        'Failed to send heartbeat on interface %s (%s)',
        ifa.name,
        address
      );
    }
  }

  private receiveHeartbeat(packet: Uint8Array, ipAddress: string) {
    try {
      if (!binaryEqual(MAGIC, packet.subarray(0, MAGIC.byteLength))) {
        this.log.trace(
          'Ignoring broadcast packet from %s: not a heartbeat',
          ipAddress
        );
        return;
      }
      const heartbeat = proto.Heartbeat.deserializeBinary(
        packet.subarray(MAGIC.byteLength)
      );
      const payload = heartbeat.getPayload();
      if (
        !payload ||
        this.config.appId !== uuid.stringify(payload.getAppid_asU8())
      ) {
        this.log.trace(
          'Ignoring heartbeat from %s: different appId',
          ipAddress
        );
        return;
      }
      if (
        ipAddressToUint(ipAddress) !== payload.getIpaddress() ||
        payload.getPeerid_asU8().byteLength !== UUID_LENGTH ||
        payload.getPeername().length > MAX_PEER_NAME_LENGTH ||
        payload.getPort() < 1024 ||
        payload.getPort() > 65535
      ) {
        this.log.warn(
          'Ignoring heartbeat from %s: malformed heartbeat packet',
          ipAddress
        );
        return;
      }
      const peerId = uuid.stringify(payload.getPeerid_asU8());
      if (peerId === this.config.peerId) {
        return;
      }

      let visible = this.visiblePeers.find((p) => p.peerId === peerId);
      const pushVisible = !visible;
      if (!visible || new Date() >= visible.expiresAt) {
        visible = {
          peerId,
          peerName: payload.getPeername(),
          ipAddress,
          port: payload.getPort(),
          certFingerprint: payload.getCertfingerprint_asU8(),
          expiresAt: new Date(),
        };
      }
      if (
        ipAddress !== visible.ipAddress ||
        payload.getPort() !== visible.port
      ) {
        this.log.warn(
          'Multiple heartbeats for peerId %s (existing %s:%d, ignored %s:%d)',
          peerId,
          visible.ipAddress,
          visible.port,
          ipAddress,
          payload.getPort()
        );
        return;
      }

      const paired = this.config.pairedPeers.find((p) => p.peerId === peerId);
      if (paired) {
        const expectedSignature = heartbeatSignature(
          payload,
          paired.heartbeatKey
        );
        if (!binaryEqual(heartbeat.getSignature_asU8(), expectedSignature)) {
          this.log.warn(
            'Apparent peer %s at %s:%d does not have valid heartbeat signature',
            peerId,
            ipAddress,
            payload.getPort()
          );
          return;
        }
        // TODO: Connect to paired peer when first seen
      }

      visible.expiresAt = new Date(new Date().getTime() + HEARTBEAT_DELAY * 3);
      if (pushVisible) {
        this.log.trace(
          'New peer found: %s (%s) at %s:%d',
          visible.peerName,
          peerId,
          visible.ipAddress,
          visible.port
        );
        this.visiblePeers.push(visible);
      }
    } catch (err) {
      this.log.warn(
        { err },
        'Exception when receiving heartbeat packet from %s',
        ipAddress
      );
    }
  }
}
