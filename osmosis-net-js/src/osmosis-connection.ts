import Logger from 'bunyan';
import TypedEventEmitter from '@nels.onl/typed-event-emitter';
import getPort from 'get-port';
import { PeerConfig, PeerInfo } from './peer-config';
import PeerFinder, { Heartbeat, HEARTBEAT_DELAY } from './peer-finder';
import * as Monocypher from 'monocypher-wasm';
import {
  RpcServer,
  RpcSocket,
  RpcMetadata,
  MethodHandlers,
} from './rpc-sockets';
import { randomBytes } from 'crypto';
import assert from 'assert';
import { createConnection, Socket } from 'net';

const VISIBLE_PEER_LIFETIME = HEARTBEAT_DELAY * 3;
const PAIR_TIMEOUT_MS = 30 * 1000;

interface PairRequest {
  peerName: string;
  publicKey: string;
}

interface PairResponse {
  peerName: string;
  publicKey: string;
  secret: string;
}

interface ConnectRequest {
  publicKey: string;
}

interface ConnectResponse {
  publicKey: string;
  port: number;
}

type GatewayMethods = {
  'osmosis.net.pair': (params: PairRequest) => Promise<PairResponse>;
  'osmosis.net.connect': (params: ConnectRequest) => Promise<ConnectResponse>;
};

type ConnectionMethods = {
  'osmosis.net.sharePeers': (
    peers: { peerId: string; peerName: string; publicKey: string }[]
  ) => Promise<void>;
  'osmosis.net.unpair': (params: any) => Promise<void>;
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
  readonly peerName: string;
  readonly remoteAddress: string;
  port?: number;
  server?: RpcServer<ConnectionMethods>;
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
  pairRequest: (peer: { peerId: string; peerName: string }) => void;
  pairResponse: ({ peer: Peer, accepted: boolean }) => void;
  configUpdated: (config: PeerConfig) => void;
  start: () => void;
  stop: () => void;
}

class OsmosisConnection<
  Methods extends MethodHandlers
> extends TypedEventEmitter<ConnectionEvents> {
  private _config: PeerConfig;
  private _started: boolean;
  private peerFinder?: PeerFinder;
  private expireTimer?: ReturnType<typeof setInterval>;
  private gatewayPort?: number;
  private gatewayServer?: RpcServer<GatewayMethods>;
  private visiblePeers = new Map<string, VisiblePeer>();
  private connectedPeers = new Map<string, ConnectedPeer>();
  private pairRequests = new Map<string, (secret: string | false) => void>();

  constructor(
    config: PeerConfig,
    private readonly methodHandlers: Methods,
    private readonly log: Logger = Logger.createLogger({ name: 'osmosis' }),
    autostart = true
  ) {
    super();
    this._config = config;
    if (autostart) {
      this.start();
    }
  }

  get config(): PeerConfig {
    return this._config;
  }

  get started(): boolean {
    return this._started;
  }

  async start(): Promise<void> {
    if (this.started) {
      this.log.warn('Tried to start connection when already started');
      return;
    }
    this._started = true;
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
    this.peerFinder = new PeerFinder(
      this.config,
      this.gatewayPort,
      (peerId) =>
        this.config.pairedPeers.find((p) => p.peerId === peerId)?.publicKey,
      this.log
    );
    this.peerFinder.on('heartbeat', this.receiveHeartbeat.bind(this));
    this.expireTimer = setInterval(
      this.expirePeers.bind(this),
      HEARTBEAT_DELAY
    );
    this.emit('start');
  }

  protected peerIdToPublicKey(peerId: string): Buffer | undefined {
    return this.visiblePeers.get(peerId)?.publicKey;
  }

  stop(): void {
    if (!this.started) {
      this.log.warn('Tried to stop connection when already stopped');
      return;
    }
    this._started = false;
    this.log.info('Stopping connection');
    const gateway = this.gatewayServer;
    if (gateway) {
      gateway.close();
      this.gatewayServer = undefined;
    }
    this.gatewayPort = undefined;
    this.connectedPeers.forEach((peer) => {
      peer.client?.close();
      peer.server?.close();
    });
    this.connectedPeers.clear();
    this.peerFinder?.stop();
    this.peerFinder = undefined;
    if (this.expireTimer) {
      clearInterval(this.expireTimer);
      this.expireTimer = undefined;
    }
    this.emit('stop');
  }

  private receiveHeartbeat({
    heartbeat: { peerId, peerName, port, publicKey },
    localAddress,
    remoteAddress,
  }: {
    heartbeat: Heartbeat;
    localAddress: string;
    remoteAddress: string;
  }) {
    let visible = this.visiblePeers.get(peerId);
    const pushVisible = !visible;
    const now = new Date();
    if (!visible || visible.expiresAt < now) {
      visible = {
        peerId,
        peerName,
        remoteAddress,
        localAddress,
        port,
        publicKey,
        expiresAt: now,
      };
    }
    if (remoteAddress !== visible.remoteAddress || port !== visible.port) {
      this.log.warn(
        {
          peerId,
          existing: {
            remoteAddress: visible.remoteAddress,
            port: visible.port,
          },
          ignored: {
            remoteAddress,
            port,
          },
        },
        'Multiple heartbeats for same peerId'
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
        {
          peerId,
          peerName: visible.peerName,
          remoteAddress: visible.remoteAddress,
          port: visible.port,
        },
        'New peer found'
      );
      this.visiblePeers.set(peerId, visible);
      this.emit('peerAppeared', this.exportPeer(visible));
    }
  }

  private expirePeers() {
    this.visiblePeers.forEach((peer) => {
      if (
        peer.expiresAt < new Date() &&
        !this.connectedPeers.has(peer.peerId)
      ) {
        this.log.info(
          {
            peerId: peer.peerId,
            peerName: peer.peerName,
            remoteAddress: peer.remoteAddress,
            port: peer.port,
          },
          'Peer expired after %dms with no heartbeat',
          VISIBLE_PEER_LIFETIME
        );
        this.visiblePeers.delete(peer.peerId);
        this.emit('peerDisappeared', this.exportPeer(peer));
      }
    });
  }

  private addPairedPeer(peer: PeerInfo): void {
    this._config = {
      ...this._config,
      pairedPeers: [...this._config.pairedPeers, peer],
    };
    this.emit('configUpdated', this._config);
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

    const secret = await new Promise<string | false>((resolve) => {
      const timeout = setTimeout(() => {
        this.log.warn({ remotePeerId: remotePeerId }, 'Pair request timed out');
        resolve(false);
      }, PAIR_TIMEOUT_MS);
      this.pairRequests.set(remotePeerId, (x) => {
        clearTimeout(timeout);
        resolve(x);
      });

      this.emit('pairRequest', {
        peerId: remotePeerId,
        peerName: request.peerName,
      });
    });

    this.pairRequests.delete(remotePeerId);

    if (secret === false) {
      this.log.info({ remotePeerId }, 'Sending rejection for pair request');
      throw {
        code: 103,
        message: 'Pair request rejected',
      };
    } else {
      this.log.info(
        { remotePeerId, secret },
        'Sending acceptance for pair request'
      );
      this.addPairedPeer({
        peerId: remotePeerId,
        peerName: request.peerName,
        publicKey,
      });
      return {
        secret,
        peerName: this.config.peerName,
        publicKey: this.config.publicKey.toString('base64'),
      };
    }
  }

  private async onConnect(
    params: ConnectRequest,
    { remotePeerId, remoteAddress }: RpcMetadata
  ): Promise<ConnectResponse> {
    await Monocypher.ready;
    const visible = this.visiblePeers.get(remotePeerId);
    if (!visible) {
      this.log.warn(
        { remotePeerId, remoteAddress },
        `Rejected connection attempt from peer with no visible heartbeat`
      );
      throw {
        code: 201,
        message: 'Heartbeat not received first',
      };
    }
    const paired = this.config.pairedPeers.find(
      (p) => p.peerId === remotePeerId
    );
    if (!paired) {
      this.log.warn(
        { remotePeerId, remoteAddress },
        `Rejected connection attempt fron unpaired peer`
      );
      throw {
        code: 202,
        message: 'Not paired',
      };
    }
    this.log.info({ remotePeerId, remoteAddress }, 'Got connection request');
    const remotePublicKey = Buffer.from(params.publicKey, 'base64');
    const localPrivateKey = randomBytes(Monocypher.KEY_BYTES);
    const localPublicKey = Buffer.from(
      Monocypher.crypto_key_exchange_public_key(localPrivateKey)
    );
    const port = await getPort();
    const server = new RpcServer<ConnectionMethods & Methods>({
      port,
      peerId: this.config.peerId,
      privateKey: localPrivateKey,
      publicKey: localPublicKey,
      peerIdToPublicKey(peerId) {
        if (peerId === remotePeerId) {
          return remotePublicKey;
        }
      },
      logger: this.log,
      methodHandlers: {
        ...this.methodHandlers,
        'osmosis.net.sharePeers': this.onSharePeers.bind(this),
        'osmosis.net.unpair': this.onUnpair.bind(this),
      },
    });
    this.log.trace(
      { remotePeerId, remoteAddress, port },
      'Opened private RPC port for connection'
    );
    const connectedPeer: ConnectedPeer = {
      peerId: remotePeerId,
      peerName: visible.peerName,
      remoteAddress,
      port,
      server,
    };
    this.connectedPeers.set(remotePeerId, connectedPeer);
    const timer = setTimeout(() => {
      this.log.error(
        { remotePeerId, remoteAddress, port },
        'Connection attempt timed out'
      );
      this.disconnectPeer(remotePeerId);
    }, 5000);
    server.on('connection', (client) => {
      if (
        client.socket.remoteAddress !== remoteAddress ||
        connectedPeer.client
      ) {
        client.close();
        return;
      }
      this.log.trace(
        { remotePeerId, remoteAddress, port },
        'Got connection on private port'
      );
      clearTimeout(timer);
      client.on('close', () => this.disconnectPeer(remotePeerId));
      connectedPeer.client = client;
      client.callMethod(
        'osmosis.net.sharePeers',
        this.config.pairedPeers.map((p) => ({
          ...p,
          publicKey: p.publicKey.toString('base64'),
        })),
        true
      );
      this.emit('peerConnected', this.exportPeer(visible));
    });
    return {
      port,
      publicKey: localPublicKey.toString('base64'),
    };
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
      this.addPairedPeer({
        peerId,
        peerName,
        publicKey: Buffer.from(publicKey, 'base64'),
      });
    }
  }

  private async onUnpair() {
    throw new Error('Not yet implemented');
  }

  async pair(peerId: string, secret: string): Promise<boolean> {
    if (this.config.pairedPeers.find((p) => p.peerId === peerId)) {
      this.log.error(`Pairing failed: already paired with ${peerId}`);
      return false;
    }
    const peer = this.visiblePeers.get(peerId);
    if (!peer) {
      this.log.error(`Pairing failed: no visible peer with ID ${peerId}`);
      return false;
    }
    this.log.info(
      { secret },
      'Sending pair request to %s at %s:%d',
      peerId,
      peer.remoteAddress,
      peer.port
    );
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
      if (response.secret !== secret) {
        this.log.warn(
          { expected: secret, received: response.secret },
          'Incorrect pairing secret from %s; pair request rejected',
          peerId
        );
        return false;
      }
      this.log.info('Pair request to %s was accepted', peerId);
      this.addPairedPeer({
        peerId,
        peerName: peer.peerName,
        publicKey: peer.publicKey,
      });
      accepted = true;
      this.connectPeer(peer);
    } catch (error) {
      switch (error.code) {
        case 102:
          this.log.warn(
            'Pair request to %s is redundant; this peer is already paired',
            peerId
          );
          break;
        case 103:
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

  acceptPairRequest(peerId: string, secret: string): boolean {
    const resolver = this.pairRequests.get(peerId);
    resolver?.(secret);
    return !!resolver;
  }

  rejectPairRequest(peerId: string): boolean {
    const resolver = this.pairRequests.get(peerId);
    resolver?.(false);
    return !!resolver;
  }

  private async connectPeer(peer: VisiblePeer): Promise<void> {
    await Monocypher.ready;
    this.log.info(
      {
        peerId: peer.peerId,
        remoteAddress: peer.remoteAddress,
        port: peer.port,
      },
      'Sending connection request'
    );

    const localPrivateKey = randomBytes(Monocypher.KEY_BYTES);
    const localPublicKey = Buffer.from(
      Monocypher.crypto_key_exchange_public_key(localPrivateKey)
    );

    assert(this.gatewayServer != null);
    const gatewaySocket = await this.gatewayServer.connect(
      peer.port,
      peer.remoteAddress,
      Buffer.from(peer.publicKey)
    );

    let response: ConnectResponse;
    try {
      response = await gatewaySocket.callMethod('osmosis.net.connect', {
        publicKey: localPublicKey.toString('base64'),
      });
    } finally {
      gatewaySocket.close();
    }
    this.log.trace(
      {
        peerId: peer.peerId,
        remoteAddress: peer.remoteAddress,
        port: response.port,
      },
      'Got connection response with private server port'
    );

    const remotePublicKey = Buffer.from(response.publicKey, 'base64');
    const socket: Socket = await new Promise((resolve) => {
      let socket: Socket;
      // eslint-disable-next-line prefer-const
      socket = createConnection(response.port, peer.remoteAddress, () =>
        resolve(socket)
      );
    });
    try {
      const client = new RpcSocket(
        socket,
        {
          port: response.port,
          peerId: this.config.peerId,
          privateKey: localPrivateKey,
          publicKey: localPublicKey,
          peerIdToPublicKey(peerId) {
            if (peerId === peer.peerId) {
              return remotePublicKey;
            }
          },
          logger: this.log,
          methodHandlers: {
            ...this.methodHandlers,
            'osmosis.net.sharePeers': this.onSharePeers.bind(this),
            'osmosis.net.unpair': this.onUnpair.bind(this),
          },
        },
        remotePublicKey
      );
      const connectedPeer: ConnectedPeer = {
        peerId: peer.peerId,
        peerName: peer.peerName,
        remoteAddress: peer.remoteAddress,
        port: response.port,
        client,
      };
      this.connectedPeers.set(peer.peerId, connectedPeer);
      client.callMethod(
        'osmosis.net.sharePeers',
        this.config.pairedPeers.map((p) => ({
          ...p,
          publicKey: p.publicKey.toString('base64'),
        })),
        true
      );
      this.emit('peerConnected', this.exportPeer(peer));
    } catch (err) {
      this.log.error(
        { err },
        "Connection to %s failed: our client could not connect to peer's server",
        peer.peerId
      );
      socket.unref();
      socket.destroy();
      this.disconnectPeer(peer.peerId);
    }
  }

  async disconnectPeer(peerId: string): Promise<boolean> {
    const connected = this.connectedPeers.get(peerId);
    if (!connected) {
      this.log.trace('Cannot disconnect peer %s: not connected', peerId);
      return false;
    }
    this.log.trace('Disconnecting peer %s', peerId);
    connected.server?.close();
    connected.client?.close();
    this.connectedPeers.delete(peerId);
    this.emit('peerDisconnected', {
      id: peerId,
      name: connected.peerName,
      ipAddress: connected.remoteAddress,
      paired: true,
      connected: false,
    });
    return true;
  }

  callMethod<M extends keyof Methods>(
    peerId: string,
    method: M,
    params: Parameters<Methods[M]>[0],
    notification?: boolean,
    timeout?: number
  ): Promise<ReturnType<Methods[M]>>;

  callMethod<M extends keyof Methods>(
    peerId: string,
    method: M,
    params: Parameters<Methods[M]>[0],
    notification: true
  ): Promise<void>;

  callMethod<M extends keyof Methods>(
    peerId: string,
    method: M,
    params: Parameters<Methods[M]>[0],
    notification = false,
    timeout?: number
  ): Promise<any> {
    if (!this._started) {
      this.log.error(
        { peerId, method },
        'Cannot call JSON-RPC method: Connection is stopped'
      );
      if (notification) {
        return Promise.resolve(undefined);
      } else {
        throw new Error('Cannot call JSON-RPC method: Connection is stopped');
      }
    }
    const peer = this.connectedPeers.get(peerId);
    if (!peer || !peer.client) {
      this.log.error(
        { peerId, method },
        'Cannot call JSON-RPC method: Peer not connected'
      );
      if (notification) {
        return Promise.resolve(undefined);
      } else {
        throw new Error('Cannot call JSON-RPC method: Peer not connected');
      }
    }
    return peer.client.callMethod(method as any, params, notification, timeout);
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

export default OsmosisConnection;
