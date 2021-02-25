import {
  generatePeerConfig,
  OsmosisConnection,
  JsonPeerConfig,
  serializePeerConfig,
  deserializePeerConfig,
  RpcMetadata,
} from '@nels.onl/osmosis-net-js';
import {
  Cancelable,
  Failure,
  Id,
  idCompare,
  idIndex,
  InMemorySaveState,
  Json,
  JsonObject,
  JsonPath,
  MetaStore,
  nextStateHash,
  Op,
  OsmosisFailureError,
  Queryable,
  SaveState,
  StateSummary,
  Store,
  Vars,
} from '@nels.onl/osmosis-store-js';
import TypedEventEmitter from '@nels.onl/typed-event-emitter';
import Logger from 'bunyan';
import * as uuid from 'uuid';
import { Action } from './action';
import AsyncQueueMap from './async-queue-map';
import EventMetadataSource from './metadata/event-metadata-source';
import LogMetadataSource from './metadata/log-metadata-source';
import OsmosisConfig from './osmosis-config';
import assert from 'assert';

type OsmosisEvents = {
  pairRequest: ({ peerId: Uuid, peerName: string }) => void;
  pairResponse: ({ peerId: Uuid, peerName: string, accepted: boolean }) => void;
};

interface SerializedStateSummary {
  readonly hash: string;
  readonly latestIndexes: { readonly [author: string]: number };
}

function serializeSummary({
  hash,
  latestIndexes,
}: StateSummary): SerializedStateSummary {
  return {
    hash: Buffer.from(hash).toString('hex'),
    latestIndexes,
  };
}

type OsmosisMethods = {
  'osmosis.sync.stateSummary': (args: {
    state: SerializedStateSummary;
    session: string;
  }) => Promise<void>;
  'osmosis.sync.sessionUpdate': (args: {
    ops: readonly Op[];
    session: string;
  }) => Promise<void>;
  'osmosis.sync.liveUpdate': (args: { ops: readonly Op[] }) => Promise<string>;
  'osmosis.sync.findLastSharedHistory': (args: {
    savePoints: readonly { readonly hash: string; readonly id: Id }[];
    session: string;
  }) => Promise<Id | null>;
  'osmosis.sync.endSession': (args: { session: string }) => Promise<void>;
};

enum SessionEvent {
  ReceivedSummary,
  AppliedOps,
  LastShared,
}

const CODE_BUSY_WITH_SESSION_UPDATE = 101;

export default class Osmosis
  extends TypedEventEmitter<OsmosisEvents>
  implements Queryable {
  private visibleToPeers: boolean;
  private syncEnabled: boolean;
  private sessionId: string | null = null;
  private readonly sessionResponses = new AsyncQueueMap<
    SessionEvent,
    SerializedStateSummary
  >();
  private readonly actionQueue: ((arg: null) => void)[] = [];
  private readonly saveState: SaveState<JsonPeerConfig>;
  private readonly data: Store;
  private readonly metadata: MetaStore;
  private readonly connection: Promise<OsmosisConnection<OsmosisMethods>>;
  private readonly log: Logger;
  private readonly configMetadata: EventMetadataSource;
  private readonly peersMetadata = new EventMetadataSource([]);
  private readonly failuresMetadata = new EventMetadataSource([]);
  private readonly actionsMetadata = new EventMetadataSource([]);

  constructor(private readonly config: OsmosisConfig) {
    super();
    this.visibleToPeers = config.visibleToPeers ?? true;
    this.syncEnabled = config.syncEnabled ?? true;
    this.saveState = config.saveState ?? new InMemorySaveState({});
    this.data = new Store(this.saveState);
    const parentLogger = config.log ?? new Logger({ name: 'osmosis' });
    const logMetadata = new LogMetadataSource();
    this.log = parentLogger.child({
      streams: [{ type: 'raw', level: 'info', stream: logMetadata }],
    });
    this.configMetadata = new EventMetadataSource({
      appId: config.appId,
      visibleToPeers: this.visibleToPeers,
      syncEnabled: this.syncEnabled,
    });

    this.metadata = new MetaStore({
      config: this.configMetadata,
      actions: this.actionsMetadata,
      failures: this.failuresMetadata,
      peers: this.peersMetadata,
      log: logMetadata,
    });

    this.connection = this.saveState
      .initMetadata(async () => {
        this.log.info('Generating new Peer ID and keys');
        return serializePeerConfig(
          await generatePeerConfig(config.appId, config.peerName)
        );
      })
      .then(async () => {
        const localPeerConfig = await this.saveState.metadata;
        this.configMetadata.update({
          ...((localPeerConfig as unknown) as JsonObject),
          visibleToPeers: this.visibleToPeers,
          syncEnabled: this.syncEnabled,
        });
        const conn = new OsmosisConnection(
          deserializePeerConfig(localPeerConfig),
          {
            'osmosis.sync.stateSummary': this.onStateSummary.bind(this),
            'osmosis.sync.sessionUpdate': this.onSessionUpdate.bind(this),
            'osmosis.sync.liveUpdate': this.onLiveUpdate.bind(this),
            'osmosis.sync.findLastSharedHistory': this.onFindLastSharedHistory.bind(
              this
            ),
            'osmosis.sync.endSession': this.onEndSession.bind(this),
          },
          this.log,
          this.visibleToPeers && this.syncEnabled
        );
        const updatePeers = () => {
          this.peersMetadata.update((conn.peers as unknown) as JsonObject[]);
        };
        conn.on('peerAppeared', updatePeers);
        conn.on('peerDisappeared', updatePeers);
        conn.on('peerConnected', (peer) => {
          updatePeers();
          if (peer.id < localPeerConfig.peerId) {
            this.openSyncSession(peer.id);
          }
        });
        conn.on('peerDisconnected', updatePeers);
        conn.on('pairRequest', (e) => this.emit('pairRequest', e));
        conn.on('pairResponse', ({ peer, accepted }) =>
          this.emit('pairResponse', {
            peerId: peer.id,
            peerName: peer.name,
            accepted,
          })
        );
        conn.on('configUpdated', (config) => {
          const serialized = serializePeerConfig(config);
          this.saveState.setMetadata(serialized);
          this.configMetadata.update({
            ...((serialized as unknown) as JsonObject),
            visibleToPeers: this.visibleToPeers,
            syncEnabled: this.syncEnabled,
          });
        });
        conn.on('start', () => {
          this.sessionResponses.clear();
          this.sessionId = null;
        });
        conn.on('beforeStop', () => {
          this.sessionResponses.fail(new Error('Osmosis connection closed'));
          this.sessionResponses.clear();
          this.sessionId = null;
        });
        return conn;
      });
  }

  private async findMissingOps(
    localIndexes: { readonly [author: string]: number },
    remoteIndexes: { readonly [author: string]: number }
  ) {
    const opsToSend: Op[] = [];
    for (const [author, localIndex] of Object.entries(localIndexes)) {
      const remoteIndex = remoteIndexes[author] || 0;
      if (remoteIndex < localIndex) {
        const potentialOps = await this.data.opsRange(
          { author, index: remoteIndex },
          { author, index: localIndex }
        );
        this.log.trace(
          { ops: potentialOps, author, remoteIndex, localIndex },
          'Found ops to send to peer'
        );
        opsToSend.push(...potentialOps.filter((o) => o.id.author === author));
      }
    }
    return opsToSend;
  }

  private async openSyncSession(peerId: string): Promise<void> {
    const conn = await this.connection;
    let timeoutMs = 500;
    while (this.sessionId) {
      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      timeoutMs *= 2; // exponential backoff
      if (!conn.peers.find((p) => p.id === peerId && p.connected)) {
        return;
      }
    }
    const session = (this.sessionId = uuid.v4());
    this.log.info({ session, peerId }, 'Initiating full sync session');
    try {
      let localSummary = serializeSummary(await this.data.stateSummary);
      conn.callMethod(
        peerId,
        'osmosis.sync.stateSummary',
        { state: localSummary, session },
        true
      );
      let remoteSummary = await this.sessionResponses.take(
        SessionEvent.ReceivedSummary,
        3000
      );
      conn.callMethod(
        peerId,
        'osmosis.sync.sessionUpdate',
        {
          ops: await this.findMissingOps(
            localSummary.latestIndexes,
            remoteSummary.latestIndexes
          ),
          session,
        },
        true
      );
      localSummary = await this.sessionResponses.take(
        SessionEvent.AppliedOps,
        60000
      );
      conn.callMethod(
        peerId,
        'osmosis.sync.stateSummary',
        { state: localSummary, session },
        true
      );
      remoteSummary = await this.sessionResponses.take(
        SessionEvent.ReceivedSummary,
        10000
      );
      if (localSummary.hash !== remoteSummary.hash) {
        const lastSharedId = await conn.callMethod(
          peerId,
          'osmosis.sync.findLastSharedHistory',
          {
            savePoints: (await this.data.savePoints).map((sp) => ({
              hash: Buffer.from(sp.hash).toString('hex'),
              id: sp.id,
            })),
            session,
          }
        );
        conn.callMethod(
          peerId,
          'osmosis.sync.sessionUpdate',
          {
            ops: await this.data.opsRange(lastSharedId, null),
            session,
          },
          true
        );
        localSummary = await this.sessionResponses.take(
          SessionEvent.AppliedOps,
          60000
        );
        conn.callMethod(
          peerId,
          'osmosis.sync.stateSummary',
          { state: localSummary, session },
          true
        );
        remoteSummary = await this.sessionResponses.take(
          SessionEvent.ReceivedSummary,
          10000
        );
        if (localSummary.hash !== remoteSummary.hash) {
          this.log.error(
            { peerId },
            'States still inconsistent after full sync'
          );
        }
      }
    } catch (err) {
      this.log.error({ err, peerId }, 'Full sync session failed');
      conn.callMethod(peerId, 'osmosis.sync.endSession', { session }, true);
    }
    this.sessionId = null;
    this.sessionResponses.clear();
    while (this.actionQueue.length) {
      this.actionQueue.shift()?.(null);
    }
  }

  private async receiveSyncSession(
    peerId: string,
    session: string,
    remoteSummary: SerializedStateSummary
  ): Promise<void> {
    const conn = await this.connection;
    if (this.sessionId && this.sessionId !== session) {
      return conn.callMethod(
        peerId,
        'osmosis.sync.endSession',
        { session },
        true
      );
    }
    this.log.info({ session, peerId }, 'Full sync session initiated by peer');
    this.sessionId = session;
    try {
      let localSummary = serializeSummary(await this.data.stateSummary);
      conn.callMethod(
        peerId,
        'osmosis.sync.stateSummary',
        { state: localSummary, session },
        true
      );
      conn.callMethod(
        peerId,
        'osmosis.sync.sessionUpdate',
        {
          ops: await this.findMissingOps(
            localSummary.latestIndexes,
            remoteSummary.latestIndexes
          ),
          session,
        },
        true
      );
      localSummary = await this.sessionResponses.take(
        SessionEvent.AppliedOps,
        60000
      );
      remoteSummary = await this.sessionResponses.take(
        SessionEvent.ReceivedSummary,
        3000
      );
      if (localSummary.hash !== remoteSummary.hash) {
        const lastSharedIdSummary = await this.sessionResponses.take(
          SessionEvent.LastShared,
          10000
        );
        const [[author, index]] = Object.entries(
          lastSharedIdSummary.latestIndexes
        );
        conn.callMethod(
          peerId,
          'osmosis.sync.sessionUpdate',
          {
            ops: await this.data.opsRange({ author, index }, null),
            session,
          },
          true
        );
        localSummary = await this.sessionResponses.take(
          SessionEvent.AppliedOps,
          60000
        );
        conn.callMethod(
          peerId,
          'osmosis.sync.stateSummary',
          { state: localSummary, session },
          true
        );
        remoteSummary = await this.sessionResponses.take(
          SessionEvent.ReceivedSummary,
          10000
        );
        if (localSummary.hash !== remoteSummary.hash) {
          this.log.error(
            { peerId },
            'States still inconsistent after full sync'
          );
        }
      }
    } catch (err) {
      this.log.error({ err, peerId }, 'Full sync session failed');
      conn.callMethod(peerId, 'osmosis.sync.endSession', { session }, true);
    }
    this.sessionId = null;
    this.sessionResponses.clear();
    while (this.actionQueue.length) {
      this.actionQueue.shift()?.(null);
    }
  }

  private async onStateSummary(
    { state, session }: { state: SerializedStateSummary; session: string },
    { remotePeerId }: RpcMetadata
  ) {
    if (this.sessionId === session) {
      this.sessionResponses.insert(SessionEvent.ReceivedSummary, state);
    } else {
      return this.receiveSyncSession(remotePeerId, session, state);
    }
  }

  private async onSessionUpdate(
    args: { ops: readonly Op[]; session?: string },
    { remotePeerId }: RpcMetadata
  ) {
    if (args.session === this.sessionId) {
      await this.data.mergeOps(args.ops);
      this.sessionResponses.insert(
        SessionEvent.AppliedOps,
        serializeSummary(await this.data.stateSummary)
      );
    } else {
      this.log.error(
        {
          remotePeerId,
          receivedSession: args.session,
          actualSession: this.sessionId,
        },
        'Received sessionUpdate call for a different session ID'
      );
    }
  }

  private async onLiveUpdate(args: { ops: readonly Op[] }): Promise<string> {
    if (this.sessionId) {
      throw {
        code: CODE_BUSY_WITH_SESSION_UPDATE,
        message: 'Busy with session update; retry later',
      };
    }
    // FIXME: These should be merged into one atomic action;
    // mergeOps should return a hash or a StateSummary.
    await this.data.mergeOps(args.ops);
    return Buffer.from((await this.data.stateSummary).hash).toString('hex');
  }

  private async onFindLastSharedHistory({
    savePoints,
    session,
  }: {
    savePoints: readonly { readonly hash: string; readonly id: Id }[];
    session: string;
  }): Promise<Id | null> {
    const ops = await this.data.ops;
    for (const { hash, id } of savePoints) {
      const theirHash = Buffer.from(hash, 'hex');
      const mySavePoint = (await this.data.savePoints).find(
        (my) => idCompare(id, my.id) >= 0
      );
      if (!mySavePoint) {
        return null;
      }
      let i = idIndex(mySavePoint.id, ops, true);
      assert(i >= 0 && i < ops.length);
      let myHash = mySavePoint.hash;
      let comparison = idCompare(id, mySavePoint.id);
      while (comparison >= 0 && i < ops.length - 1) {
        if (comparison === 0 && theirHash.equals(mySavePoint.hash)) {
          if (session === this.sessionId) {
            this.sessionResponses.insert(SessionEvent.LastShared, {
              hash: Buffer.from(myHash).toString('hex'),
              latestIndexes: { [ops[i].id.author]: ops[i].id.index },
            });
          }
          return ops[i].id;
        }
        comparison = idCompare(id, ops[++i].id);
        myHash = nextStateHash(myHash, ops[i].id);
      }
    }
    return null;
  }

  private async onEndSession({ session }: { session: string }) {
    if (this.sessionId && session === this.sessionId) {
      this.sessionResponses.fail(new Error('Session terminated by peer'));
    }
  }

  dispatch(action: Action, returnFailures: true): Promise<readonly Failure[]>;
  dispatch(action: Action, returnFailures?: boolean): Promise<undefined>;

  async dispatch(
    action: Action,
    returnFailures = false
  ): Promise<readonly Failure[] | undefined> {
    const conn = await this.connection;
    if (this.sessionId) {
      await new Promise((resolve: (arg: null) => void) => {
        this.actionQueue.push(resolve);
      });
    }
    switch (action.action) {
      case 'RequestPair':
        await conn.pair(action.payload.id, action.payload.secret);
        break;
      case 'AcceptPair':
        await conn.acceptPairRequest(action.payload.id, action.payload.secret);
        break;
      case 'RejectPair':
        await conn.rejectPairRequest(action.payload);
        break;
      case 'Unpair':
        throw 'not implemented';
      case 'SetVisibleToPeers':
        this.visibleToPeers = action.payload;
        if (this.visibleToPeers && this.syncEnabled) {
          conn.start();
        } else {
          conn.stop();
        }
        break;
      case 'SetSyncEnabled':
        this.syncEnabled = action.payload;
        if (this.visibleToPeers && this.syncEnabled) {
          conn.start();
        } else {
          conn.stop();
        }
        break;
      default: {
        const { failures, ops } = await this.data.dispatch(action);
        const localHash = Buffer.from(
          (await this.data.stateSummary).hash
        ).toString('hex');
        conn.peers
          .filter((p) => p.connected)
          .forEach(async (peer) => {
            let timeoutMs = 500;
            while (peer.connected) {
              try {
                const remoteHash = await conn.callMethod(
                  peer.id,
                  'osmosis.sync.liveUpdate',
                  { ops }
                );
                if (localHash !== remoteHash) {
                  this.openSyncSession(peer.id);
                }
                return;
              } catch (err) {
                if (err?.code !== CODE_BUSY_WITH_SESSION_UPDATE) {
                  console.error(
                    { remotePeerId: peer.id, err },
                    'Failed to send liveUpdate to peer'
                  );
                  return;
                }
              }
              await new Promise((resolve) => setTimeout(resolve, timeoutMs));
              timeoutMs *= 2; // exponential backoff
            }
          });
        if (returnFailures) {
          return failures;
        } else if (failures.length) {
          throw new OsmosisFailureError(
            `dispatching action ${JSON.stringify(action)}`,
            failures
          );
        }
      }
    }
  }

  subscribe(
    query: JsonPath,
    vars: Vars,
    callback: (json: Json) => void
  ): Cancelable;
  subscribe(query: JsonPath, callback: (json: Json[]) => void): Cancelable;

  subscribe(
    query: JsonPath,
    arg1: unknown,
    arg2?: (json: Json) => void
  ): Cancelable {
    return this.data.subscribe(query, arg1 as any, arg2 as any);
  }

  queryOnce(query: JsonPath, vars: Vars = {}): Promise<Json[]> {
    return this.data.queryOnce(query, vars);
  }

  subscribeMeta(
    query: JsonPath,
    vars: Vars,
    callback: (json: Json) => void
  ): Cancelable;
  subscribeMeta(query: JsonPath, callback: (json: Json[]) => void): Cancelable;

  subscribeMeta(
    query: JsonPath,
    arg1: unknown,
    arg2?: (json: Json) => void
  ): Cancelable {
    return this.metadata.subscribe(query, arg1 as any, arg2 as any);
  }

  queryOnceMeta(query: JsonPath, vars: Vars = {}): Promise<Json[]> {
    return this.metadata.queryOnce(query, vars);
  }

  async stop(): Promise<void> {
    (await this.connection).stop();
  }
}
