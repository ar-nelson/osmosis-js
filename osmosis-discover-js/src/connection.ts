import Logger from 'bunyan';
import TypedEventEmitter from './typed-event-emitter';
import getPort from 'get-port';
import * as uuid from 'uuid';
import { PeerConfig } from './peer-config';
import PeerFinder, { HEARTBEAT_DELAY } from './peer-finder';
import {
  RpcServer,
  RpcSocket,
  RpcMetadata,
  MethodHandlers,
} from './rpc-sockets';
import * as proto from './osmosis_pb';
import { randomBytes } from 'crypto';
import assert from 'assert';

const PAIR_TIMEOUT_MS = 30 * 1000;

interface PairRequest {
  peerName: string;
  publicKey: string;
}

interface PairResponse {
  peerName: string;
  publicKey: string;
  pin: number;
}

type GatewayMethods = {
  'osmosis.net.pair': (params: PairRequest) => Promise<PairResponse>;
  'osmosis.net.connect': (params: {
    port: number;
  }) => Promise<{ port: number }>;
};

type ConnectionMethods = {
  'osmosis.net.sharePeers': (
    peers: { peerId: string; peerName: string; publicKey: string }[]
  ) => Promise<void>;
  'osmosis.net.unpair': (params: {}) => Promise<void>;
};

interface VisiblePeer {
  readonly peerId: string;
  readonly peerName: string;
  readonly localAddress: string;
  readonly remoteAddress: string;
  readonly port: number;
  readonly publicKey: Buffer;
  expiresAt: Date;
}

interface ConnectedPeer {
  readonly peerId: string;
  readonly ipAddress: string;
  clientPort?: number;
  client?: RpcSocket<ConnectionMethods>;
}

export interface Peer {
  readonly id: string;
  readonly name: string;
  readonly ipAddress: string;
  readonly paired: boolean;
  readonly connected: boolean;
}

export interface ConnectionEvents {
  peerAppeared: (peer: Peer) => void;
  peerDisappeared: (peer: Peer) => void;
  peerConnected: (peer: Peer) => void;
  peerDisconnected: (peer: Peer) => void;
  pairRequest: (peer: { id: string; name: string }) => void;
  pairResponse: ({ peer: Peer, accepted: boolean }) => void;
  pairPin: (pin: number) => void;
  start: () => void;
  stop: () => void;
}

class Connection<
  Methods extends MethodHandlers
> extends TypedEventEmitter<ConnectionEvents> {
  private peerFinder?: PeerFinder;
  private gatewayPort?: number;
  private gatewayServer?: RpcServer<GatewayMethods>;
  private connectionPort?: number;
  private connectionServer?: RpcServer<ConnectionMethods & Methods>;
  private visiblePeers = new Map<string, VisiblePeer>();
  private connectedPeers = new Map<string, ConnectedPeer>();
  private pairRequests = new Map<string, (pin: number | false) => void>();

  constructor(
    public readonly config: PeerConfig,
    private readonly methodHandlers: Methods,
    private readonly log: Logger = Logger.createLogger({ name: 'osmosis' })
  ) {
    super();
    this.start();
  }

  async start(): Promise<void> {
    if (this.peerFinder || this.gatewayPort || this.gatewayServer) {
      this.log.warn('Tried to start connection when already started');
      return;
    }
    this.log.info('Starting connection');
    this.gatewayPort = await getPort();
    this.gatewayServer = new RpcServer<GatewayMethods>({
      port: this.gatewayPort,
      peerId: this.config.peerId,
      privateKey: this.config.privateKey,
      publicKey: this.config.publicKey,
      peerIdToPublicKey: this.peerIdToPublicKey.bind(this),
      sendCompressed: false,
      allowCompression: false,
      logger: this.log,
      methodHandlers: {
        'osmosis.net.pair': this.onPair.bind(this),
        'osmosis.net.connect': this.onConnect.bind(this),
      },
    });
    this.log.info('Gateway service active on port %d', this.gatewayPort);
    this.connectionPort = await getPort();
    this.connectionServer = new RpcServer<ConnectionMethods & Methods>({
      port: this.connectionPort,
      peerId: this.config.peerId,
      privateKey: this.config.privateKey,
      publicKey: this.config.publicKey,
      peerIdToPublicKey: this.peerIdToPublicKey.bind(this),
      logger: this.log,
      methodHandlers: {
        ...this.methodHandlers,
        'osmosis.net.sharePeers': this.onSharePeers.bind(this),
        'osmosis.net.unpair': this.onUnpair.bind(this),
      },
    });
    this.log.info('Connection service active on port %d', this.connectionPort);
    this.peerFinder = new PeerFinder(
      this.config,
      this.gatewayPort,
      (peerId) =>
        this.config.pairedPeers.find((p) => p.peerId === peerId)?.publicKey,
      this.log
    );
    this.peerFinder.on('heartbeat', this.receiveHeartbeat.bind(this));
    this.emit('start');
  }

  protected peerIdToPublicKey(peerId: string): Buffer | undefined {
    return this.visiblePeers.get(peerId)?.publicKey;
  }

  stop(): void {
    if (!this.peerFinder && !this.gatewayPort && !this.gatewayServer) {
      this.log.warn('Tried to stop connection when already stopped');
      return;
    }
    this.log.info('Stopping connection');
    const gateway = this.gatewayServer;
    if (gateway) {
      gateway.close();
      this.gatewayServer = undefined;
    }
    this.gatewayPort = undefined;
    const connection = this.connectionServer;
    if (connection) {
      connection.close();
      this.connectionServer = undefined;
    }
    this.connectionPort = undefined;
    this.peerFinder?.stop();
    this.peerFinder = undefined;
    this.emit('stop');
  }

  private receiveHeartbeat({
    heartbeat,
    localAddress,
    remoteAddress,
  }: {
    heartbeat: proto.Heartbeat;
    localAddress: string;
    remoteAddress: string;
  }) {
    const peerId = uuid.stringify(heartbeat.getPeerid_asU8());
    let visible = this.visiblePeers.get(peerId);
    const pushVisible = !visible;
    const now = new Date();
    if (!visible || visible.expiresAt < now) {
      visible = {
        peerId,
        peerName: heartbeat.getPeername(),
        remoteAddress,
        localAddress,
        port: heartbeat.getPort(),
        publicKey: Buffer.from(heartbeat.getPublickey_asU8()),
        expiresAt: now,
      };
    }
    if (
      remoteAddress !== visible.remoteAddress ||
      heartbeat.getPort() !== visible.port
    ) {
      this.log.warn(
        'Multiple heartbeats for peerId %s (existing %s:%d, ignored %s:%d)',
        peerId,
        visible.remoteAddress,
        visible.port,
        remoteAddress,
        heartbeat.getPort()
      );
      return;
    }

    const paired = this.config.pairedPeers.find((p) => p.peerId === peerId);
    if (paired && !this.connectedPeers.has(peerId)) {
      this.connectPeer(visible);
    }

    visible.expiresAt = new Date(now.getTime() + HEARTBEAT_DELAY * 3);
    if (pushVisible) {
      this.log.info(
        'New peer found: %s (%s) at %s:%d',
        visible.peerName,
        peerId,
        visible.remoteAddress,
        visible.port
      );
      this.visiblePeers.set(peerId, visible);
    }
  }

  private async onPair(
    request: PairRequest,
    { remotePeerId }: RpcMetadata
  ): Promise<PairResponse> {
    const publicKey = Buffer.from(request.publicKey, 'base64');
    if (this.pairRequests.has(remotePeerId)) {
      this.log.warn(
        { remotePeerId: remotePeerId },
        'Received overlapping pair request'
      );
      throw {
        code: 101,
        message: 'Received overlapping pair request',
      };
    }
    if (this.config.pairedPeers.find((p) => p.peerId === remotePeerId)) {
      this.log.warn(
        { remotePeerId: remotePeerId },
        'Received pair request for already-paired peer'
      );
      throw {
        code: 102,
        message: 'Received pair request for already-paired peer',
      };
    }

    const pin = await new Promise<number | false>((resolve) => {
      const timeout = setTimeout(() => {
        this.log.warn({ remotePeerId: remotePeerId }, 'Pair request timed out');
        resolve(false);
      }, PAIR_TIMEOUT_MS);
      this.pairRequests.set(remotePeerId, (x) => {
        clearTimeout(timeout);
        resolve(x);
      });

      this.emit('pairRequest', { id: remotePeerId, name: request.peerName });
    });

    this.pairRequests.delete(remotePeerId);

    if (pin === false) {
      this.log.info({ remotePeerId }, 'Sending rejection for pair request');
      throw {
        code: 103,
        message: 'Pair request rejected',
      };
    } else {
      this.log.info(
        { remotePeerId, pin },
        'Sending acceptance for pair request'
      );
      this.config.pairedPeers.push({
        peerId: remotePeerId,
        peerName: request.peerName,
        publicKey,
      });
      return {
        pin,
        peerName: this.config.peerName,
        publicKey: this.config.publicKey.toString('base64'),
      };
    }
  }

  private async onConnect(
    params: { port: number },
    { remotePeerId, remoteAddress }: RpcMetadata
  ): Promise<{ port: number }> {
    const paired = this.config.pairedPeers.find(
      (p) => p.peerId === remotePeerId
    );
    if (!paired) {
      this.log.warn(
        `Rejected connection attempt fron unpaired peer %s`,
        remotePeerId
      );
      throw {
        code: 201,
        message: 'Not paired',
      };
    } else {
      this.log.info('Connection request from peer %s', remotePeerId);
      const connectedPeer: ConnectedPeer = {
        peerId: remotePeerId,
        ipAddress: remoteAddress,
        clientPort: params.port,
      };
      this.connectedPeers.set(remotePeerId, connectedPeer);
      try {
        assert(this.connectionServer != null);
        const client = await this.connectionServer.connect(
          params.port,
          remoteAddress
        );
        connectedPeer.client = client;
        client.callMethod(
          'osmosis.net.sharePeers',
          this.config.pairedPeers.map((p) => ({
            ...p,
            publicKey: p.publicKey.toString('base64'),
          })),
          true
        );
        this.log.trace(
          'Successfully connected to %s, sending response',
          remotePeerId
        );
        return { port: this.connectionPort as number };
      } catch (err) {
        this.log.error(
          { err },
          "Connection to %s failed: our client could not connect to peer's server",
          remotePeerId
        );
        this.disconnectPeer(remotePeerId);
        throw {
          code: 202,
          message: 'Could not establish RPC connection',
        };
      }
    }
  }

  private async onSharePeers(
    peers: { peerName: string; peerId: string; publicKey: string }[]
  ) {
    for (const { peerName, peerId, publicKey } of peers) {
      if (
        peerId === this.config.peerId ||
        this.config.pairedPeers.find((p) => p.peerId === peerId)
      ) {
        continue;
      }
      this.config.pairedPeers.push({
        peerId,
        peerName,
        publicKey: Buffer.from(publicKey, 'base64'),
      });
    }
  }

  private async onUnpair() {
    throw new Error('Not yet implemented');
  }

  async pair(peerId: string): Promise<boolean> {
    if (this.config.pairedPeers.find((p) => p.peerId === peerId)) {
      this.log.error(`Pairing failed: already paired with ${peerId}`);
      return false;
    }
    const peer = this.visiblePeers.get(peerId);
    if (!peer) {
      this.log.error(`Pairing failed: no visible peer with ID ${peerId}`);
      return false;
    }
    const pinBytes = randomBytes(4);
    const pin =
      (pinBytes[0] * (1 << 24) +
        pinBytes[1] * (1 << 16) +
        pinBytes[2] * (1 << 8) +
        pinBytes[3]) %
      10000;
    this.log.info(
      { pin },
      'Sending pair request to %s at %s:%d',
      peerId,
      peer.remoteAddress,
      peer.port
    );
    this.emit('pairPin', pin);
    assert(this.gatewayServer != null);
    const socket = await this.gatewayServer.connect(
      peer.port,
      peer.remoteAddress,
      Buffer.from(peer.publicKey)
    );
    let accepted = false;
    try {
      const response = await socket.callMethod(
        'osmosis.net.pair',
        {
          peerName: this.config.peerName,
          publicKey: this.config.publicKey.toString('base64'),
        },
        false,
        PAIR_TIMEOUT_MS + 1000
      );
      if (response.pin !== pin) {
        this.log.warn(
          { expected: pin, received: response.pin },
          'Incorrect pairing PIN from %s; pair request rejected',
          peerId
        );
        return false;
      }
      this.log.info('Pair request to %s was accepted', peerId);
      this.config.pairedPeers.push({
        peerId,
        peerName: peer.peerName,
        publicKey: this.config.publicKey,
      });
      accepted = true;
      this.connectPeer(peer);
    } catch (error) {
      switch (error.code) {
        case 201:
          this.log.warn(
            'Pair request to %s is redundant; this peer is already paired',
            peerId
          );
          break;
        case 202:
          this.log.info('Pair request to %s was rejected', peerId);
          break;
        default:
          if (error instanceof Error) {
            this.log.error(
              { err: error },
              'Unhandled exception when sending pair request'
            );
          } else {
            this.log.warn({ error }, 'Got error response from pair request');
          }
      }
      return false;
    } finally {
      this.emit('pairResponse', { peer: this.exportPeer(peer), accepted });
      socket.close();
    }
    return accepted;
  }

  acceptPairRequest(peerId: string, pin: number): boolean {
    const resolver = this.pairRequests.get(peerId);
    resolver?.(pin);
    return !!resolver;
  }

  rejectPairRequest(peerId: string): boolean {
    const resolver = this.pairRequests.get(peerId);
    resolver?.(false);
    return !!resolver;
  }

  private async connectPeer(peer: VisiblePeer): Promise<void> {
    this.log.info(
      'Connecting to %s at %s:%d',
      peer.peerId,
      peer.remoteAddress,
      peer.port
    );

    const connectedPeer: ConnectedPeer = {
      peerId: peer.peerId,
      ipAddress: peer.remoteAddress,
    };
    this.connectedPeers.set(peer.peerId, connectedPeer);

    assert(this.gatewayServer != null);
    const gatewaySocket = await this.gatewayServer.connect(
      peer.port,
      peer.remoteAddress,
      Buffer.from(peer.publicKey)
    );
    try {
      assert(this.connectionPort != null);
      const { port } = await gatewaySocket.callMethod('osmosis.net.connect', {
        port: this.connectionPort,
      });
      this.log.trace('OK connection response from %s', peer.peerId);
      connectedPeer.clientPort = port;
      try {
        assert(this.connectionServer != null);
        const client = await this.connectionServer.connect(
          port,
          peer.remoteAddress
        );
        connectedPeer.client = client;
        client.callMethod(
          'osmosis.net.sharePeers',
          this.config.pairedPeers.map((p) => ({
            ...p,
            publicKey: p.publicKey.toString('base64'),
          })),
          true
        );
        this.log.trace('Successfully connected to %s', peer.peerId);
      } catch (err) {
        this.log.error(
          { err },
          "Connection to %s failed: our client could not connect to peer's server",
          peer.peerId
        );
        this.disconnectPeer(peer.peerId);
      }
    } catch (err) {
      if (err.code && err.message) {
        this.log.error('Connection to %s failed: %s', err.message);
      } else {
        this.log.error(
          { err },
          'Unhandled exception when sending connection request'
        );
      }
    } finally {
      gatewaySocket.close();
    }
  }

  async disconnectPeer(peerId: string): Promise<boolean> {
    const connected = this.connectedPeers.get(peerId);
    if (!connected) {
      this.log.trace('Cannot disconnect peer %s: not connected', peerId);
      return false;
    }
    this.log.trace('Disconnecting peer %s', peerId);
    connected.client?.close();
    this.connectedPeers.delete(peerId);
    return true;
  }

  private exportPeer(peer: VisiblePeer): Peer {
    return {
      id: peer.peerId,
      name: peer.peerName,
      ipAddress: peer.remoteAddress,
      paired: !!this.config.pairedPeers.find((p) => p.peerId === peer.peerId),
      connected: this.connectedPeers.has(peer.peerId),
    };
  }

  get peers(): Peer[] {
    return [...this.visiblePeers.values()].map(this.exportPeer.bind(this));
  }
}

export default Connection;
