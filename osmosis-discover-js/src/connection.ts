import * as grpc from '@grpc/grpc-js';
import Logger from 'bunyan';
import { EventEmitter } from 'events';
import getPort from 'get-port';
import { random, util as forgeUtil } from 'node-forge';
import { promisify } from 'util';
import * as uuid from 'uuid';
import * as protoGrpc from './osmosis_grpc_pb';
import * as proto from './osmosis_pb';
import {
  configPeerList,
  PeerConfig,
  rootCertPem,
  UUID_LENGTH,
} from './peer-config';
import PeerFinder, { HEARTBEAT_DELAY } from './peer-finder';
import { binaryEqual, ipAddressFromUint, ipAddressToUint } from './utils';

const PAIR_TIMEOUT_MS = 30 * 1000;

interface VisiblePeer {
  readonly peerId: string;
  readonly peerName: string;
  readonly ipAddress: string;
  readonly interfaceAddress: string;
  readonly port: number;
  readonly certFingerprint: Uint8Array;
  expiresAt: Date;
}

interface ConnectedPeer {
  readonly peerId: string;
  readonly ipAddress: string;
  readonly serverPort: number;
  readonly server: grpc.Server;
  clientPort?: number;
  client?: protoGrpc.ConnectionClient;
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

declare interface Connection {
  on<U extends keyof ConnectionEvents>(
    event: U,
    listener: ConnectionEvents[U]
  ): this;

  emit<U extends keyof ConnectionEvents>(
    event: U,
    ...args: Parameters<ConnectionEvents[U]>
  ): boolean;
}

class Connection extends EventEmitter {
  private peerFinder?: PeerFinder;
  private gatewayPort?: number;
  private gatewayServer?: grpc.Server;
  private visiblePeers = new Map<string, VisiblePeer>();
  private connectedPeers = new Map<string, ConnectedPeer>();
  private serverCredentials: Promise<grpc.ServerCredentials>;
  private clientCredentials: Promise<grpc.ChannelCredentials>;
  private pairRequests = new Map<string, (pin: number | false) => void>();
  private services: {
    readonly service: grpc.ServiceDefinition<grpc.UntypedServiceImplementation>;
    readonly implementation: grpc.UntypedServiceImplementation;
  }[] = [];

  constructor(
    public readonly config: PeerConfig,
    private readonly log: Logger = Logger.createLogger({ name: 'osmosis' })
  ) {
    super();
    this.serverCredentials = (async () =>
      grpc.ServerCredentials.createSsl(
        await rootCertPem,
        [
          {
            private_key: Buffer.from(config.privateKey, 'ascii'),
            cert_chain: Buffer.from(config.certificate, 'ascii'),
          },
        ],
        true
      ))();
    this.clientCredentials = (async () =>
      grpc.credentials.createSsl(
        await rootCertPem,
        Buffer.from(config.privateKey, 'ascii'),
        Buffer.from(config.certificate, 'ascii')
      ))();
    this.start();
  }

  async start(): Promise<void> {
    if (this.peerFinder || this.gatewayPort || this.gatewayServer) {
      this.log.warn('Tried to start connection when already started');
      return;
    }
    this.log.info('Starting connection');
    this.gatewayPort = await getPort();
    this.gatewayServer = new grpc.Server();
    this.gatewayServer.addService(protoGrpc.GatewayService, {
      Pair: this.onPair.bind(this),
      Connect: this.onConnect.bind(this),
    });
    await promisify(this.gatewayServer.bindAsync.bind(this.gatewayServer))(
      `0.0.0.0:${this.gatewayPort}`,
      await this.serverCredentials
    );
    this.gatewayServer.start();
    this.log.info('Gateway service active on port %d', this.gatewayPort);
    this.peerFinder = new PeerFinder(
      this.config,
      this.gatewayPort,
      (peerId) =>
        this.config.pairedPeers.find((p) => p.peerId === peerId)?.secretToken,
      this.log
    );
    this.peerFinder.on('heartbeat', this.receiveHeartbeat.bind(this));
    this.emit('start');
  }

  stop(): void {
    if (!this.peerFinder && !this.gatewayPort && !this.gatewayServer) {
      this.log.warn('Tried to stop connection when already stopped');
      return;
    }
    this.log.info('Stopping connection');
    const gateway = this.gatewayServer;
    if (gateway) {
      gateway.tryShutdown((err) => {
        this.log.error({ err }, 'Failed to stop gateway service');
        gateway.forceShutdown();
      });
      this.gatewayServer = undefined;
    }
    this.gatewayPort = undefined;
    this.peerFinder?.stop();
    this.peerFinder = undefined;
    this.emit('stop');
  }

  private receiveHeartbeat({
    heartbeat,
    interfaceAddress,
  }: {
    heartbeat: proto.Heartbeat.Payload;
    interfaceAddress: string;
  }) {
    const peerId = uuid.stringify(heartbeat.getPeerid_asU8());
    const ipAddress = ipAddressFromUint(heartbeat.getIpaddress());
    let visible = this.visiblePeers.get(peerId);
    const pushVisible = !visible;
    const now = new Date();
    if (!visible || visible.expiresAt < now) {
      visible = {
        peerId,
        peerName: heartbeat.getPeername(),
        ipAddress,
        interfaceAddress,
        port: heartbeat.getPort(),
        certFingerprint: heartbeat.getCertfingerprint_asU8(),
        expiresAt: now,
      };
    }
    if (
      ipAddress !== visible.ipAddress ||
      heartbeat.getPort() !== visible.port
    ) {
      this.log.warn(
        'Multiple heartbeats for peerId %s (existing %s:%d, ignored %s:%d)',
        peerId,
        visible.ipAddress,
        visible.port,
        ipAddress,
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
        visible.ipAddress,
        visible.port
      );
      this.visiblePeers.set(peerId, visible);
    }
  }

  private async onPair(peerInfo: proto.PeerInfo): Promise<proto.PairResponse> {
    const response = new proto.PairResponse();
    if (
      peerInfo.getPeerid_asU8().byteLength !== UUID_LENGTH ||
      peerInfo.getSecrettoken_asU8().byteLength !== UUID_LENGTH
    ) {
      this.log.error('Received malformed pair request');
      response.setStatus(proto.PairResponse.Status.REJECTED);
      return response;
    }
    const peerId = uuid.stringify(peerInfo.getPeerid_asU8());
    if (this.pairRequests.has(peerId)) {
      this.log.warn({ peerId }, 'Received overlapping pair request');
      response.setStatus(proto.PairResponse.Status.REJECTED);
      return response;
    }
    if (this.config.pairedPeers.find((p) => p.peerId === peerId)) {
      this.log.warn(
        { peerId },
        'Received pair request for already-paired peer'
      );
      response.setStatus(proto.PairResponse.Status.ALREADY_PAIRED);
      return response;
    }

    const pin = await new Promise<number | false>((resolve) => {
      const timeout = setTimeout(() => {
        this.log.warn({ peerId }, 'Pair request timed out');
        resolve(false);
      }, PAIR_TIMEOUT_MS);
      this.pairRequests.set(peerId, (x) => {
        clearTimeout(timeout);
        resolve(x);
      });

      this.emit('pairRequest', { id: peerId, name: peerInfo.getPeername() });
    });

    this.pairRequests.delete(peerId);

    if (pin === false) {
      this.log.info({ peerId }, 'Sending rejection for pair request');
      response.setStatus(proto.PairResponse.Status.REJECTED);
    } else {
      this.log.info({ peerId, pin }, 'Sending acceptance for pair request');
      response.setStatus(proto.PairResponse.Status.ACCEPTED);
      response.setPin(pin);
      const ourInfo = new proto.PeerInfo();
      ourInfo.setPeerid(uuid.parse(this.config.peerId) as Uint8Array);
      ourInfo.setPeername(this.config.peerName);
      ourInfo.setSecrettoken(uuid.parse(this.config.secretToken) as Uint8Array);
      ourInfo.setCertfingerprint(
        forgeUtil.binary.hex.decode(this.config.certFingerprint)
      );
      response.setPeer(ourInfo);
    }

    return response;
  }

  // TODO: Add more security to this
  private onConfirmPair(req: proto.PairConfirm): proto.PairConfirm {
    this.log.trace('Got pair confirm');
    const rsp = new proto.PairConfirm();
    rsp.setPeerid(uuid.parse(this.config.peerId) as Uint8Array);
    rsp.setAccepted(
      req.getAccepted() &&
        req.getPeerid_asU8().byteLength === UUID_LENGTH &&
        this.config.pairedPeers
          .map((p) => p.peerId)
          .includes(uuid.stringify(req.getPeerid_asU8()))
    );
    return rsp;
  }

  private async onConnect(
    req: proto.ConnectRequest
  ): Promise<proto.ConnectResponse> {
    const response = new proto.ConnectResponse();
    try {
      const peerId = uuid.stringify(req.getPeerid_asU8());
      const secretToken = uuid.stringify(req.getSecrettoken_asU8());
      const ipAddress = ipAddressFromUint(req.getIpaddress());
      const paired = this.config.pairedPeers.find((p) => p.peerId === peerId);
      if (!paired) {
        this.log.warn(
          `Rejected connection attempt fron unpaired peer %s`,
          peerId
        );
        response.setStatus(proto.ConnectResponse.Status.NOT_PAIRED);
      } else if (paired.secretToken !== secretToken) {
        this.log.warn(
          `Rejected connection attempt from apparent peer %s due to wrong secret token`,
          peerId
        );
        response.setStatus(proto.ConnectResponse.Status.BAD_TOKEN);
      } else {
        this.log.info('Connection request from peer %s', peerId);
        const { server, serverPort } = await this.createConnectionServer(
          peerId
        );
        const connectedPeer: ConnectedPeer = {
          peerId,
          ipAddress,
          serverPort,
          server,
        };
        this.connectedPeers.set(peerId, connectedPeer);
        try {
          const client = new protoGrpc.ConnectionClient(
            `${ipAddress}:${req.getPort()}`,
            await this.clientCredentials
          );
          connectedPeer.client = client;
          await promisify(client.sharePeers.bind(client))(
            configPeerList(this.config)
          );
          this.log.trace(
            'Successfully connected to %s, sending response',
            peerId
          );
          response.setPort(serverPort);
          response.setSecrettoken(
            uuid.parse(this.config.secretToken) as Uint8Array
          );
        } catch (err) {
          this.log.error(
            { err },
            "Connection to %s failed: our client could not connect to peer's server",
            peerId
          );
          this.disconnectPeer(peerId);
          response.setStatus(proto.ConnectResponse.Status.CONNECT_FAILED);
        }
      }
    } catch (err) {
      this.log.error({ err }, 'Error processing Connect request');
      response.setStatus(proto.ConnectResponse.Status.INTERNAL_ERROR);
    }
    return response;
  }

  private getInfo(): proto.PeerInfo {
    const info = new proto.PeerInfo();
    info.setPeerid(uuid.parse(this.config.peerId) as Uint8Array);
    info.setPeername(this.config.peerName);
    info.setSecrettoken(uuid.parse(this.config.secretToken) as Uint8Array);
    info.setCertfingerprint(
      forgeUtil.binary.hex.decode(this.config.certFingerprint)
    );
    return info;
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
    const pinBytes = await promisify(random.getBytes)(4);
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
      peer.ipAddress,
      peer.port
    );
    this.emit('pairPin', pin);
    const client = new protoGrpc.GatewayClient(
      `${peer.ipAddress}:${peer.port}`,
      await this.clientCredentials
    );
    let accepted = false;
    try {
      const response: proto.PairResponse = await promisify(
        client.pair.bind(client)
      )(this.getInfo());
      switch (response.getStatus()) {
        case proto.PairResponse.Status.ACCEPTED: {
          if (response.getPin() !== pin) {
            this.log.warn(
              { expected: pin, received: response.getPin() },
              'Incorrect pairing PIN from %s; pair request rejected',
              peerId
            );
            break;
          }
          this.log.info('Pair request to %s was accepted', peerId);
          const peerData = response.getPeer();
          if (
            !peerData ||
            peerData.getPeerid_asU8().byteLength !== UUID_LENGTH ||
            peerData.getSecrettoken_asU8().byteLength !== UUID_LENGTH ||
            uuid.stringify(peerData.getPeerid_asU8()) !== peerId ||
            !binaryEqual(
              peerData.getCertfingerprint_asU8(),
              peer.certFingerprint
            )
          ) {
            this.log.error('Malformed pair response from %s', peerId);
            break;
          }
          this.config.pairedPeers.push({
            peerId,
            peerName: peerData.getPeername(),
            secretToken: uuid.stringify(peerData.getSecrettoken_asU8()),
            certFingerprint: forgeUtil.binary.hex.encode(peer.certFingerprint),
          });
          accepted = true;
          break;
        }
        case proto.PairResponse.Status.REJECTED:
          this.log.info('Pair request to %s was rejected', peerId);
          break;
        case proto.PairResponse.Status.ALREADY_PAIRED:
          this.log.warn(
            'Pair request to %s is redundant; this peer is already paired',
            peerId
          );
          break;
      }
    } finally {
      client.close();
    }
    this.emit('pairResponse', { peer: this.exportPeer(peer), accepted });
    if (accepted) {
      this.connectPeer(peer);
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

  private async createConnectionServer(peerId: string) {
    const serverPort = await getPort();
    this.log.trace(
      'Creating connection server for peer %s on port %s',
      peerId,
      serverPort
    );
    const server = new grpc.Server();
    server.addService(protoGrpc.ConnectionService, {
      Pair(req, cb) {
        this.onPair(req).then((rsp) => cb(null, rsp), cb);
      },
      Connect(req, cb) {
        this.onConnect(req).then((rsp) => cb(null, rsp), cb);
      },
      ConfirmPair: this.onConfirmPair.bind(this),
    });
    this.services.forEach(({ service, implementation }) => {
      server.addService(service, implementation);
    });
    await promisify(server.bindAsync.bind(this.gatewayServer))(
      `0.0.0.0:${serverPort}`,
      await this.serverCredentials
    );
    server.start();
    return { server, serverPort };
  }

  private async connectPeer(peer: VisiblePeer): Promise<void> {
    const { server, serverPort } = await this.createConnectionServer(
      peer.peerId
    );
    this.log.info(
      'Connecting to %s at %s:%d',
      peer.peerId,
      peer.ipAddress,
      peer.port
    );

    const connectedPeer: ConnectedPeer = {
      peerId: peer.peerId,
      ipAddress: peer.ipAddress,
      serverPort,
      server,
    };
    this.connectedPeers.set(peer.peerId, connectedPeer);

    const req = new proto.ConnectRequest();
    req.setIpaddress(ipAddressToUint(peer.interfaceAddress));
    req.setPort(serverPort);
    req.setPeerid(uuid.parse(this.config.peerId) as Uint8Array);
    req.setSecrettoken(uuid.parse(this.config.secretToken) as Uint8Array);
    const gatewayClient = new protoGrpc.GatewayClient(
      `${peer.ipAddress}:${peer.port}`,
      await this.clientCredentials
    );
    try {
      const response: proto.ConnectResponse = await promisify(
        gatewayClient.connect.bind(gatewayClient)
      )(req);
      switch (response.getStatus()) {
        case proto.ConnectResponse.Status.OK:
          this.log.trace('OK connection response from %s', peer.peerId);
          connectedPeer.clientPort = response.getPort();
          try {
            const client = new protoGrpc.ConnectionClient(
              `${peer.ipAddress}:${response.getPort()}`,
              await this.clientCredentials
            );
            connectedPeer.client = client;
            await promisify(client.sharePeers.bind(client))(
              configPeerList(this.config)
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
          break;
        case proto.ConnectResponse.Status.BAD_TOKEN:
          this.log.error('Connection to %s failed: bad token', peer.peerId);
          break;
        case proto.ConnectResponse.Status.NOT_PAIRED:
          this.log.error('Connection to %s failed: not paired', peer.peerId);
          break;
        case proto.ConnectResponse.Status.CONNECT_FAILED:
          this.log.error(
            "Connection to %s failed: peer's client could not connect to our server",
            peer.peerId
          );
          break;
        case proto.ConnectResponse.Status.INTERNAL_ERROR:
          this.log.error(
            'Connection to %s failed: internal error',
            peer.peerId
          );
          break;
      }
    } finally {
      gatewayClient.close();
    }
  }

  async disconnectPeer(peerId: string): Promise<boolean> {
    const connected = this.connectedPeers.get(peerId);
    if (!connected) {
      this.log.trace('Cannot disconnect peer %s: not connected', peerId);
      return false;
    }
    this.log.trace('Disconnecting peer %s', peerId);
    connected.server.tryShutdown((err) => {
      this.log.error(
        { err },
        'Failed to stop connection service for %s',
        peerId
      );
      connected.server.forceShutdown();
    });
    connected.client?.close();
    this.connectedPeers.delete(peerId);
    return true;
  }

  addService<Impl extends grpc.UntypedServiceImplementation>(
    service: grpc.ServiceDefinition<Impl>,
    implementation: Impl
  ): void {
    this.connectedPeers.forEach(({ server }) => {
      server?.addService(service, implementation);
    });
    this.services.push({ service, implementation });
  }

  private exportPeer(peer: VisiblePeer): Peer {
    return {
      id: peer.peerId,
      name: peer.peerName,
      ipAddress: peer.ipAddress,
      paired: !!this.config.pairedPeers.find((p) => p.peerId === peer.peerId),
      connected: this.connectedPeers.has(peer.peerId),
    };
  }

  get peers(): Peer[] {
    return [...this.visiblePeers.values()].map(this.exportPeer.bind(this));
  }
}

export default Connection;
