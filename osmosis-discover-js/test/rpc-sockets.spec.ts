import { expect } from 'chai';
import { afterEach, describe, it } from 'mocha';
import { RpcServer, RpcServerConfig, MethodHandlers } from '../src/rpc-sockets';
import SocketTestHelper from './socket-test-helper';

describe('JSON-RPC Socket', function () {
  const helper = new SocketTestHelper();
  const serverId = 'ecdb8ebf-e896-45e9-8bf9-1cf99db583b0';
  const clientId = '1cca2959-e698-4bf2-853b-2957a51a86cc';
  const serverPort = 10001;
  const clientPort = 10002;
  const {
    serverPublicKey,
    serverPrivateKey,
    clientPublicKey,
    clientPrivateKey,
  } = helper.generateKeys();

  const servers = new Set<RpcServer<any>>();
  const serverLog = helper.log.child({ side: 'server' });
  const clientLog = helper.log.child({ side: 'client' });

  function peerIdToPublicKey(peerId) {
    if (peerId === serverId) {
      return serverPublicKey;
    } else if (peerId === clientId) {
      return clientPublicKey;
    }
  }

  function makeServers<M extends MethodHandlers>(
    config: Omit<
      RpcServerConfig<M>,
      'port' | 'peerId' | 'privateKey' | 'publicKey'
    >
  ): { client: RpcServer<M>; server: RpcServer<M> } {
    const server = new RpcServer({
      port: serverPort,
      peerId: serverId,
      privateKey: serverPrivateKey,
      publicKey: serverPublicKey,
      logger: serverLog,
      peerIdToPublicKey,
      ...config,
    });
    servers.add(server);
    server.on('error', (err) => {
      throw err;
    });
    const client = new RpcServer({
      port: clientPort,
      peerId: clientId,
      privateKey: clientPrivateKey,
      publicKey: clientPublicKey,
      logger: clientLog,
      peerIdToPublicKey,
      ...config,
    });
    servers.add(client);
    client.on('error', (err) => {
      throw err;
    });
    return { client, server };
  }

  afterEach(function () {
    servers.forEach((s) => s.close());
    servers.clear();
  });

  it('should connect to another JSON-RPC server', function (done) {
    helper.startAsyncTest(done);
    const { client, server } = makeServers({
      methodHandlers: {},
    });

    (async () => {
      const socket1 = await client.connect(serverPort, 'localhost');
      expect(socket1).to.exist;
      const socket2 = await server.connect(clientPort, 'localhost');
      expect(socket2).to.exist;
      socket1.close();
      socket2.close();
      done();
    })();
  });

  it('should send simple messages and receive responses', async function () {
    const { client, server } = makeServers({
      methodHandlers: {
        async greet(params: { name: string }): Promise<string> {
          return `Hello, ${params.name}!`;
        },
      },
    });

    const socket1 = await client.connect(serverPort, 'localhost');
    const socket2 = await server.connect(clientPort, 'localhost');
    try {
      expect(await socket1.callMethod('greet', { name: 'Alice' })).to.equal(
        'Hello, Alice!'
      );
      expect(await socket2.callMethod('greet', { name: 'Bob' })).to.equal(
        'Hello, Bob!'
      );
    } finally {
      socket1.close();
      socket2.close();
    }
  });
});
