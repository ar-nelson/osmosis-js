import { randomBytes } from 'crypto';
import { Socket } from 'net';
import * as Monocypher from 'monocypher-wasm';
import { promisify } from 'util';
import * as uuid from 'uuid';
import { ZstdCodec } from 'zstd-codec';
import TypedEventEmitter from './typed-event-emitter';
import { UUID_LENGTH } from './utils';
import Logger from 'bunyan';
import assert from 'assert';

export const MAX_MESSAGE_SIZE = 100 * 1024 * 1024; // 100 MiB
const LENGTH_BYTES = 4;
const COMPRESSION_THRESHOLD_BYTES = 1024;

interface Zstd {
  compress(buf: Uint8Array): Uint8Array;
  decompress(buf: Uint8Array): Uint8Array;
}

const zstd = new Promise<Zstd>((resolve) => {
  ZstdCodec.run((zstd) => {
    resolve(new zstd.Simple());
  });
});

enum BufferMode {
  UUID,
  LENGTH,
  NONCE,
  CONTENT,
}

export type EncryptedSocketConfig = {
  peerId: string;
  privateKey: Buffer;
  maxMessageSize?: number;
  sendCompressed?: boolean;
  allowCompression?: boolean;
  logger?: Logger;
} & (
  | {
      publicKey: Buffer;
      peerIdToPublicKey?: (uuid: string) => Buffer | undefined;
    }
  | {
      publicKey?: Buffer;
      peerIdToPublicKey: (uuid: string) => Buffer | undefined;
    }
);

interface EncryptedSocketEvents {
  message: (message: Buffer) => void;
  badMessage: (err: Error) => void;
  noPublicKey: (peerId: string) => void;
  error: (err: Error) => void;
  close: (hadError: boolean) => void;
}

class EncryptedSocket extends TypedEventEmitter<EncryptedSocketEvents> {
  public readonly peerId: string;
  protected remotePeerId: string | undefined;
  private readonly privateKey: Buffer;
  private publicKey?: Buffer;
  private peerIdToPublicKey?: (uuid: string) => Buffer | undefined;
  private sharedKey?: Uint8Array;
  private readonly maxMessageSize: number;
  private readonly sendCompressed: boolean;
  private readonly allowCompression: boolean;
  private bufferMode = BufferMode.UUID;
  private bufferLength = UUID_LENGTH;
  private contentLength = 0;
  private contentCompressed = false;
  private nonce = Buffer.alloc(0);
  private bufferPos = 0;
  private buffer = Buffer.alloc(UUID_LENGTH);
  private readonly firstSendPromise: Promise<void>;
  private firstSendResolve: (arg?: any) => void;
  private lastSend: Promise<boolean> = Promise.resolve(false);
  protected closed = false;
  protected readonly log: Logger;

  constructor(public readonly socket: Socket, config: EncryptedSocketConfig) {
    super();
    this.log = (
      config.logger || Logger.createLogger({ name: 'encrypted-socket' })
    ).child({ peerId: config.peerId });
    this.peerId = config.peerId;
    this.privateKey = config.privateKey;
    this.publicKey = config.publicKey;
    this.peerIdToPublicKey = config.peerIdToPublicKey;
    this.maxMessageSize = Math.min(
      config.maxMessageSize || MAX_MESSAGE_SIZE,
      2147483647
    );
    this.sendCompressed = config.sendCompressed ?? true;
    this.allowCompression = config.allowCompression ?? true;
    this.firstSendPromise = new Promise((resolve) => {
      this.firstSendResolve = resolve;
    });
    if (socket.writable) {
      this.log.trace('EncryptedSocket ready; writing peerId');
      socket.write(uuid.parse(this.peerId) as Uint8Array);
    } else {
      socket.on('ready', () => {
        this.log.trace('EncryptedSocket ready; writing peerId');
        socket.write(uuid.parse(this.peerId) as Uint8Array);
      });
    }
    socket.on('data', (data) => this.read(data));
    socket.on('error', (err) => this.emit('error', err));
    socket.on('close', (hadError) => this.emit('close', hadError));
  }

  private async read(data: Buffer) {
    this.log.trace(
      'EncryptedSocket received packet of %d bytes',
      data.byteLength
    );
    await Monocypher.ready;
    const loadedZstd = await zstd;
    while (data.byteLength > this.bufferLength) {
      this.buffer.set(data.subarray(0, this.bufferLength), this.bufferPos);
      data = data.subarray(this.bufferLength - this.bufferPos);
      this.decodeBuffer(loadedZstd);
    }
    this.buffer.set(data, this.bufferPos);
    this.bufferPos += data.byteLength;
    if (this.bufferPos >= this.bufferLength) {
      this.decodeBuffer(loadedZstd);
    }
  }

  private decodeBuffer(zstd: Zstd) {
    this.bufferPos = 0;
    switch (this.bufferMode) {
      case BufferMode.UUID: {
        this.bufferMode = BufferMode.LENGTH;
        this.bufferLength = LENGTH_BYTES;
        const peerId = uuid.stringify(this.buffer);
        this.remotePeerId = peerId;
        if (!this.publicKey && this.peerIdToPublicKey) {
          const publicKey = this.peerIdToPublicKey(peerId);
          if (publicKey) {
            this.publicKey = publicKey;
          } else {
            this.log.error(
              { remotePeerId: peerId },
              'no public key found for peer ID, cannot open EncryptedSocket'
            );
            this.emit('noPublicKey', peerId);
            this.close();
          }
        }
        if (this.publicKey) {
          this.sharedKey = Monocypher.crypto_key_exchange(
            this.privateKey,
            this.publicKey
          );
          this.log.trace(
            {
              publicKey: this.publicKey.toString('hex'),
              sharedKey: Buffer.from(this.sharedKey).toString('hex'),
            },
            'key exchange complete'
          );
        }
        this.firstSendResolve();
        break;
      }
      case BufferMode.LENGTH:
        this.contentLength = this.buffer.readInt32BE(0);
        if (this.contentLength < 0) {
          if (!this.allowCompression) {
            this.onBadMessage(
              'compressed',
              new Error('this endpoint does not allow message compression')
            );
          }
          this.contentCompressed = true;
          this.contentLength = -this.contentLength;
        } else {
          this.contentCompressed = false;
        }
        this.log.trace(
          { length: this.contentLength, compressed: this.contentCompressed },
          'EncryptedSocket got message length'
        );
        if (Math.abs(this.contentLength) > this.maxMessageSize) {
          this.onBadMessage(
            'size',
            new Error(
              `message is too long (max size ${this.maxMessageSize}B, got ${this.contentLength}B`
            )
          );
          return;
        }
        this.bufferMode = BufferMode.NONCE;
        this.bufferLength = Monocypher.NONCE_BYTES;
        break;
      case BufferMode.NONCE:
        this.nonce = this.buffer;
        this.bufferMode = BufferMode.CONTENT;
        this.bufferLength = this.contentLength;
        break;
      case BufferMode.CONTENT: {
        this.bufferMode = BufferMode.LENGTH;
        this.bufferLength = LENGTH_BYTES;
        this.log.trace(
          {
            length: this.buffer.byteLength,
            compressed: this.contentCompressed,
          },
          'EncryptedSocket got message content'
        );
        const decrypted = Monocypher.crypto_unlock(
          this.sharedKey as Uint8Array,
          this.nonce,
          this.buffer
        );
        if (!decrypted) {
          this.onBadMessage('encryption', new Error('decryption failed'));
          break;
        }
        let decompressed = Buffer.from(decrypted);
        if (this.contentCompressed) {
          try {
            decompressed = Buffer.from(zstd.decompress(decrypted));
          } catch (err) {
            this.onBadMessage('compression', err);
            break;
          }
        }
        this.emit('message', decompressed);
        break;
      }
    }
    this.buffer = Buffer.alloc(this.bufferLength);
  }

  protected onBadMessage(
    why: 'encryption' | 'compression' | 'compressed' | 'size',
    err: Error
  ): void {
    this.log.error(
      {
        err,
        why,
        remoteAddress: this.socket.remoteAddress,
      },
      'bad message format for EncryptedSocket'
    );
    this.emit('badMessage', err);
    this.close();
  }

  async send(message: Uint8Array): Promise<boolean> {
    assert(message instanceof Uint8Array);
    await this.firstSendPromise;
    if (
      this.closed ||
      !this.sharedKey ||
      message.byteLength > this.maxMessageSize
    ) {
      this.log.trace(
        { length: message.byteLength },
        'EncryptedSocket rejected message before sending'
      );
      return false;
    }
    const lastSend = this.lastSend;
    const send = (async () => {
      try {
        const shouldCompress =
          this.sendCompressed &&
          message.byteLength > COMPRESSION_THRESHOLD_BYTES;
        const compressed = Buffer.from(
          shouldCompress ? (await zstd).compress(message) : message
        );
        const nonce = randomBytes(Monocypher.NONCE_BYTES);
        const encrypted = Monocypher.crypto_lock(
          this.sharedKey as Uint8Array,
          nonce,
          compressed
        );
        const prefixed = Buffer.alloc(
          LENGTH_BYTES + Monocypher.NONCE_BYTES + encrypted.byteLength
        );
        prefixed.writeInt32BE(
          shouldCompress ? -encrypted.byteLength : encrypted.byteLength,
          0
        );
        prefixed.set(nonce, LENGTH_BYTES);
        prefixed.set(encrypted, LENGTH_BYTES + Monocypher.NONCE_BYTES);
        await lastSend;
        this.log.trace(
          { length: encrypted.byteLength },
          'EncryptedSocket sending message'
        );
        await promisify(this.socket.write.bind(this.socket))(prefixed);
        return true;
      } catch (err) {
        this.log.error({ err }, 'EncryptedSocket failed to send message');
        return false;
      }
    })();
    this.lastSend = send;
    return send;
  }

  close(): void {
    if (!this.closed) {
      this.log.trace('EncryptedSocket closed');
      this.socket.unref();
      this.socket.destroy();
      this.closed = true;
    }
  }
}

export default EncryptedSocket;
