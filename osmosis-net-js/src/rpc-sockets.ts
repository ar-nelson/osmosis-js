import isPlainObject from 'lodash.isplainobject';
import { Server, Socket } from 'net';
import { promisify } from 'util';
import EncryptedSocket from './encrypted-socket';
import {
  CODE_CLOSED,
  CODE_COMPRESSION_NOT_ALLOWED,
  CODE_DECOMPRESSION_ERROR,
  CODE_DECRYPTION_ERROR,
  CODE_INTERNAL_ERROR,
  CODE_MESSAGE_TOO_LARGE,
  CODE_METHOD_NOT_FOUND,
  CODE_PARSE_ERROR,
  CODE_TIMEOUT,
  isJsonRpc,
  JsonRpc,
  JsonRpcError,
  Structural,
} from './json-rpc';
import TypedEventEmitter from '@nels.onl/typed-event-emitter';
import Logger from 'bunyan';

export const DEFAULT_TIMEOUT_MS = 1000;

export interface RpcMetadata {
  localAddress: string;
  remoteAddress: string;
  localPeerId: string;
  remotePeerId: string;
}

export type MethodHandlers = Record<
  string,
  (params?: Structural, metadata?: RpcMetadata) => Promise<any>
>;

export interface RpcServerConfig<Methods extends MethodHandlers> {
  port: number;
  address?: string;
  peerId: string;
  privateKey: Buffer;
  publicKey: Buffer;
  methodHandlers: Methods;
  peerIdToPublicKey?: (uuid: string) => Buffer | undefined;
  defaultTimeout?: number;
  maxMessageSize?: number;
  sendCompressed?: boolean;
  allowCompression?: boolean;
  logger?: Logger;
}

interface RpcServerEvents<Methods extends MethodHandlers> {
  connection(socket: RpcSocket<Methods>): void;
  listening(): void;
  close(): void;
  error(err: Error): void;
}

export class RpcServer<
  Methods extends MethodHandlers
> extends TypedEventEmitter<RpcServerEvents<Methods>> {
  private readonly log: Logger;
  private readonly server: Server;
  private readonly liveSockets = new Set<RpcSocket<Methods>>();

  constructor(private readonly config: RpcServerConfig<Methods>) {
    super();
    this.log = (
      config.logger || Logger.createLogger({ name: 'json-rpc' })
    ).child({
      peerId: config.peerId,
      port: config.port,
      localAddress: config.address || '0.0.0.0',
    });
    this.server = new Server();
    this.server.on('connection', (rawSocket) => {
      this.log.trace(
        { remoteAddress: rawSocket.remoteAddress },
        'Got incoming RPC connection'
      );
      const socket = new RpcSocket(rawSocket, this.config);
      this.liveSockets.add(socket);
      rawSocket.on('close', () => {
        this.liveSockets.delete(socket);
      });
      this.emit('connection', socket);
    });
    this.server.on('listening', () => {
      this.log.trace('JSON-RPC server created');
      this.emit('listening');
    });
    this.server.on('close', () => this.emit('close'));
    this.server.on('error', (err) => {
      this.log.error({ err }, 'JSON-RPC server socket error');
      this.emit('error', err);
    });
    this.server.listen(config.port, config.address);
  }

  async connect(
    port: number,
    address: string,
    publicKey?: Buffer
  ): Promise<RpcSocket<Methods>> {
    const rawSocket = new Socket();
    const socket = new RpcSocket(rawSocket, this.config, publicKey);
    this.liveSockets.add(socket);
    rawSocket.on('close', () => {
      this.liveSockets.delete(socket);
    });
    await promisify(rawSocket.connect.bind(rawSocket))(port, address);
    return socket;
  }

  close(): void {
    this.liveSockets.forEach((s) => s.close());
    this.server.close();
    this.server.unref();
    this.log.trace('JSON-RPC server closed');
  }
}

export class RpcSocket<Methods extends MethodHandlers> extends EncryptedSocket {
  private nextId = 0;
  private readonly callResolvers = new Map<
    number,
    {
      resolve: (result: any) => void;
      reject: (error: JsonRpcError) => void;
      timer: any;
    }
  >();

  constructor(
    socket: Socket,
    private readonly serverConfig: RpcServerConfig<Methods>,
    publicKey?: Buffer
  ) {
    super(socket, {
      peerIdToPublicKey: () => undefined,
      ...serverConfig,
      publicKey,
    });
    this.on('message', async (message: Buffer) => {
      let json: any;
      try {
        json = JSON.parse(message.toString('utf8'));
        if (!isJsonRpc(json)) {
          throw new Error('not a JSON-RPC message');
        }
      } catch (err) {
        this.log.error({ err }, 'JSON-RPC parse error on message');
        this.emit('badMessage', err);
        this.sendRpc({
          jsonrpc: '2.0',
          error: {
            code: CODE_PARSE_ERROR,
            message: err.message || `${err}`,
          },
          id: null,
        });
        return;
      }
      if ('method' in json) {
        const result = await this.recvMethodCall(
          json.method,
          json.params as any,
          json.id
        );
        if (json.id != null) {
          this.sendRpc({
            jsonrpc: '2.0',
            ...result,
            id: json.id,
          });
        }
      } else if (json.id != null) {
        const resolvers = this.callResolvers.get(+json.id);
        if (resolvers) {
          const { resolve, reject, timer } = resolvers;
          clearTimeout(timer);
          if ('result' in json) {
            this.log.trace(
              { id: json.id, result: json.result },
              'received JSON-RPC method call result'
            );
            resolve(json.result);
          } else {
            this.log.warn(
              { id: json.id, error: json.error },
              'received JSON-RPC method call error result'
            );
            reject(json.error);
          }
        } else {
          this.log.error(
            { id: json.id },
            'received JSON-RPC response to completed or nonexistent call'
          );
        }
      } else if ('error' in json) {
        this.log.error(
          { error: json.error },
          'received JSON-RPC error response with null id'
        );
      }
    });
  }

  protected async recvMethodCall<M extends keyof Methods>(
    method: M,
    params: Parameters<Methods[M]>[0],
    id: string | number | null = null
  ): Promise<{ result: ReturnType<Methods[M]> } | { error: JsonRpcError }> {
    this.log.trace({ id, method, params }, 'received JSON-RPC method call');
    if (
      !Object.prototype.hasOwnProperty.call(
        this.serverConfig.methodHandlers,
        method
      )
    ) {
      this.log.warn({ id, method }, 'JSON-RPC method does not exist');
      return {
        error: {
          code: CODE_METHOD_NOT_FOUND,
          message: `Method not found: ${JSON.stringify(method)}`,
        },
      };
    }
    try {
      const result = await this.serverConfig.methodHandlers[method](params, {
        localAddress: this.socket.localAddress,
        remoteAddress: this.socket.remoteAddress || '0.0.0.0',
        localPeerId: this.peerId,
        remotePeerId: this.remotePeerId as string,
      });
      this.log.trace(
        {
          id,
          method,
          params,
          result,
        },
        'JSON-RPC method handler returned result'
      );
      return { result };
    } catch (err) {
      if (
        isPlainObject(err) &&
        typeof err.code === 'number' &&
        typeof err.message === 'string'
      ) {
        this.log.warn(
          {
            id,
            method,
            params,
            error: err,
          },
          'JSON-RPC method handler returned error'
        );
        return { error: err as JsonRpcError };
      }
      this.log.error(
        { id, method, params, err },
        'JSON-RPC method handler threw unhandled exception'
      );
      return {
        error: {
          code: CODE_INTERNAL_ERROR,
          message: err.message || `${err}`,
        },
      };
    }
  }

  protected async sendRpc(rpc: JsonRpc): Promise<void> {
    const sent = await this.send(Buffer.from(JSON.stringify(rpc), 'utf8'));
    if (!sent) {
      throw new Error('Failed to send RPC message');
    }
  }

  callMethod<M extends keyof Methods>(
    method: M,
    params: Parameters<Methods[M]>[0],
    notification?: boolean,
    timeout?: number
  ): Promise<ReturnType<Methods[M]>>;

  callMethod<M extends keyof Methods>(
    method: M,
    params: Parameters<Methods[M]>[0],
    notification: true
  ): Promise<void>;

  async callMethod(
    method: string,
    params: Structural = {},
    notification = false,
    timeout: number = this.serverConfig.defaultTimeout || DEFAULT_TIMEOUT_MS
  ): Promise<any> {
    const id = this.nextId;
    const result = new Promise<any>((resolve, reject) => {
      if (notification) {
        resolve(undefined);
      } else {
        this.nextId++;
        const timer = setTimeout(() => {
          if (this.callResolvers.has(id)) {
            this.callResolvers.delete(id);
            reject({
              code: CODE_TIMEOUT,
              message: `RPC response timeout exceeded after ${timeout}ms`,
            });
          }
        }, timeout);
        this.callResolvers.set(id, { resolve, reject, timer });
      }
    });
    this.log.trace(
      {
        id: notification ? null : id,
        method,
        params,
      },
      'sending JSON-RPC method call'
    );
    await this.sendRpc({
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
      ...(notification ? {} : { id }),
    });
    return result;
  }

  protected async onBadMessage(
    why: 'encryption' | 'compression' | 'compressed' | 'size',
    err: Error
  ): Promise<void> {
    try {
      await this.sendRpc({
        jsonrpc: '2.0',
        error: {
          code: {
            encryption: CODE_DECRYPTION_ERROR,
            compression: CODE_DECOMPRESSION_ERROR,
            compressed: CODE_COMPRESSION_NOT_ALLOWED,
            size: CODE_MESSAGE_TOO_LARGE,
          }[why],
          message: err.message || `${err}`,
        },
        id: null,
      });
    } catch (err) {
      this.log.error({ err }, 'failed to send response to malformed message');
    }
    super.onBadMessage(why, err);
  }

  close(): void {
    this.callResolvers.forEach(({ reject }, id) => {
      this.log.warn({ id }, 'socket closed before call could complete');
      reject({
        code: CODE_CLOSED,
        message: 'socket closed before call could complete',
      });
    });
    this.callResolvers.clear();
    super.close();
  }
}
