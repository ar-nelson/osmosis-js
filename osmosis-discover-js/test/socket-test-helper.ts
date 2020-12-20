import { afterEach, beforeEach } from 'mocha';
import { Server, Socket } from 'net';
import {
  crypto_box_keypair,
  crypto_box_PUBLICKEYBYTES,
  crypto_box_SECRETKEYBYTES,
} from 'sodium-native';
import Logger from 'bunyan';

export default class SocketTestHelper {
  private readonly servers = new Set<Server>();
  private readonly sockets = new Set<Socket>();
  private done: (err?: any) => void;
  public log = Logger.createLogger({
    name: 'test',
    streams: [{ path: `${__dirname}/../test.log`, level: 'trace' }],
  });

  constructor() {
    const onUnhandled = (err: any) => {
      const done = this.done;
      this.done = () => null;
      done(err);
    };

    beforeEach(() => {
      this.log.info('=== BEGIN TEST ===');
      process.on('unhandledRejection', onUnhandled);
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
      this.done = () => null;
      this.log.info('=== END TEST ===');
    });
  }

  generateKeys(): {
    serverPublicKey: Buffer;
    serverPrivateKey: Buffer;
    clientPublicKey: Buffer;
    clientPrivateKey: Buffer;
  } {
    const serverPublicKey = Buffer.alloc(crypto_box_PUBLICKEYBYTES);
    const serverPrivateKey = Buffer.alloc(crypto_box_SECRETKEYBYTES);
    const clientPublicKey = Buffer.alloc(crypto_box_PUBLICKEYBYTES);
    const clientPrivateKey = Buffer.alloc(crypto_box_SECRETKEYBYTES);
    crypto_box_keypair(serverPublicKey, serverPrivateKey);
    crypto_box_keypair(clientPublicKey, clientPrivateKey);
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
