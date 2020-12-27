import { afterEach, beforeEach } from 'mocha';
import { Server, Socket } from 'net';
import * as Monocypher from 'monocypher-wasm';
import { randomBytes } from 'crypto';
import Logger from 'bunyan';

export default class SocketTestHelper {
  private readonly servers = new Set<Server>();
  private readonly sockets = new Set<Socket>();
  private done: (err?: any) => void;
  public log = Logger.createLogger({
    name: 'test',
    serializers: { err: Logger.stdSerializers.err },
    streams: [{ path: `${__dirname}/../test.log`, level: 'trace' }],
  });

  constructor() {
    const onUnhandled = (err: any) => {
      const done = this.done;
      this.done = () => null;
      done(err);
    };

    const onUnexpectedExit = (code: number) => {
      const err = new Error(
        `unexpected exit(${code}) in the middle of test, probably emscripten weirdness`
      );
      console.error(err);
      this.done(err);
    };

    beforeEach(() => {
      this.log.info('=== BEGIN TEST ===');
      process.on('unhandledRejection', onUnhandled);
      process.on('exit', onUnexpectedExit);
    });

    afterEach(() => {
      this.servers.forEach((s) => {
        s.close();
        s.unref();
      });
      this.sockets.forEach((s) => {
        s.destroy();
        s.unref();
      });
      this.servers.clear();
      this.sockets.clear();
      process.off('unhandledRejection', onUnhandled);
      process.off('exit', onUnexpectedExit);
      this.done = () => null;
      this.log.info('=== END TEST ===');
    });
  }

  async generateKeys(): Promise<{
    serverPublicKey: Buffer;
    serverPrivateKey: Buffer;
    clientPublicKey: Buffer;
    clientPrivateKey: Buffer;
  }> {
    await Monocypher.ready;
    const serverPrivateKey = randomBytes(Monocypher.KEY_BYTES);
    const serverPublicKey = Buffer.from(
      Monocypher.crypto_key_exchange_public_key(serverPrivateKey)
    );
    const clientPrivateKey = randomBytes(Monocypher.KEY_BYTES);
    const clientPublicKey = Buffer.from(
      Monocypher.crypto_key_exchange_public_key(clientPrivateKey)
    );
    return {
      serverPublicKey,
      serverPrivateKey,
      clientPublicKey,
      clientPrivateKey,
    };
  }

  startAsyncTest(done: (err?: any) => void): void {
    this.done = done;
  }

  makeServer(): Server {
    const server = new Server();
    server.on('error', (err) => this.done(err));
    this.servers.add(server);
    return server;
  }

  makeSocket(): Socket {
    const socket = new Socket();
    socket.on('error', (err) => this.done(err));
    this.sockets.add(socket);
    return socket;
  }
}
