import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import Chance from 'chance';
import { describe, it } from 'mocha';
import { Socket } from 'net';
import EncryptedSocket from '../src/encrypted-socket';
import SocketTestHelper from './socket-test-helper';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('EncryptedSocket', function () {
  const helper = new SocketTestHelper();
  const chance = new Chance();
  const serverId = 'ecdb8ebf-e896-45e9-8bf9-1cf99db583b0';
  const clientId = '1cca2959-e698-4bf2-853b-2957a51a86cc';
  const {
    serverPublicKey,
    serverPrivateKey,
    clientPublicKey,
    clientPrivateKey,
  } = helper.generateKeys();

  function longMessage() {
    const message = {};
    const rows = chance.integer({ min: 100, max: 200 });
    for (let i = 0; i < rows; i++) {
      const generator = chance
        .pickone([
          chance.first,
          chance.integer,
          chance.floating,
          chance.sentence,
          chance.word,
        ])
        .bind(chance);
      const cols = chance.integer({ min: 50, max: 100 });
      const row: any[] = [];
      for (let j = 0; j < cols; j++) {
        row.push(generator());
      }
      message[chance.word()] = row;
    }
    return JSON.stringify(message);
  }

  it('should send a short message from client to server', function (done) {
    helper.startAsyncTest(done);
    const message = 'The rain in Spain stays mainly on the plain';
    const server = helper.makeServer();
    server.on('connection', (rawSocket: Socket) => {
      const socket = new EncryptedSocket(rawSocket, {
        peerId: serverId,
        privateKey: serverPrivateKey,
        publicKey: clientPublicKey,
        logger: helper.log.child({ side: 'server' }),
      });
      socket.on('badMessage', (err) => {
        console.error(err);
        expect.fail('badMessage');
      });
      socket.on('message', (newMessage) => {
        expect(newMessage.toString('utf8')).to.equal(message);
        done();
      });
    });
    server.listen(1234, () => {
      const rawSocket = helper.makeSocket();
      const socket = new EncryptedSocket(rawSocket, {
        peerId: clientId,
        privateKey: clientPrivateKey,
        publicKey: serverPublicKey,
        logger: helper.log.child({ side: 'client' }),
      });
      rawSocket.connect(1234, 'localhost');
      rawSocket.on('ready', () => {
        expect(socket.send(Buffer.from(message, 'utf8'))).to.eventually.be.true;
      });
    });
  });

  it('should send a short message from server to client', function (done) {
    helper.startAsyncTest(done);
    const message = 'The rain in Spain stays mainly on the plain';
    const server = helper.makeServer();
    server.on('connection', (rawSocket: Socket) => {
      const socket = new EncryptedSocket(rawSocket, {
        peerId: serverId,
        privateKey: serverPrivateKey,
        publicKey: clientPublicKey,
        logger: helper.log.child({ side: 'server' }),
      });
      expect(socket.send(Buffer.from(message, 'utf8'))).to.eventually.be.true;
    });
    server.listen(1234, () => {
      const rawSocket = helper.makeSocket();
      const socket = new EncryptedSocket(rawSocket, {
        peerId: clientId,
        privateKey: clientPrivateKey,
        publicKey: serverPublicKey,
        logger: helper.log.child({ side: 'client' }),
      });
      socket.on('badMessage', (err) => {
        console.error(err);
        expect.fail('badMessage');
      });
      socket.on('message', (newMessage) => {
        expect(newMessage.toString('utf8')).to.equal(message);
        done();
      });
      rawSocket.connect(1234, 'localhost');
    });
  });

  it('should send long JSON messages from client to server', function (done) {
    helper.startAsyncTest(done);
    const message = longMessage();
    const server = helper.makeServer();
    server.on('connection', (rawSocket: Socket) => {
      const socket = new EncryptedSocket(rawSocket, {
        peerId: serverId,
        privateKey: serverPrivateKey,
        publicKey: clientPublicKey,
        logger: helper.log.child({ side: 'server' }),
      });
      socket.on('badMessage', (err) => {
        console.error(err);
        expect.fail('badMessage');
      });
      socket.on('message', (newMessage) => {
        expect(newMessage.toString('utf8')).to.equal(message);
        done();
      });
    });
    server.listen(1234, () => {
      const rawSocket = helper.makeSocket();
      const socket = new EncryptedSocket(rawSocket, {
        peerId: clientId,
        privateKey: clientPrivateKey,
        publicKey: serverPublicKey,
        logger: helper.log.child({ side: 'client' }),
      });
      rawSocket.connect(1234, 'localhost');
      rawSocket.on('ready', () => {
        expect(socket.send(Buffer.from(message, 'utf8'))).to.eventually.be.true;
      });
    });
  });

  it('should send multiple short messages in both directions', function (done) {
    helper.startAsyncTest(done);
    const toClient = [
      chance.sentence(),
      chance.string({ length: 1500 }),
      chance.sentence(),
    ];
    const toServer = [
      chance.sentence(),
      chance.string({ length: 1500 }),
      chance.sentence(),
    ];
    let clientRecvd = 0;
    let serverRecvd = 0;
    const server = helper.makeServer();
    server.on('connection', (rawSocket: Socket) => {
      const socket = new EncryptedSocket(rawSocket, {
        peerId: serverId,
        privateKey: serverPrivateKey,
        publicKey: clientPublicKey,
        logger: helper.log.child({ side: 'server' }),
      });
      expect(socket.send(Buffer.from(toClient[0], 'utf8'))).to.eventually.be
        .true;
      expect(socket.send(Buffer.from(toClient[1], 'utf8'))).to.eventually.be
        .true;
      expect(socket.send(Buffer.from(toClient[2], 'utf8'))).to.eventually.be
        .true;
      socket.on('badMessage', (err) => {
        console.error(err);
        expect.fail('badMessage');
      });
      socket.on('message', (newMessage) => {
        expect(serverRecvd).to.be.lessThan(toServer.length);
        expect(newMessage.toString('utf8')).to.equal(toServer[serverRecvd]);
        serverRecvd++;
        if (
          serverRecvd === toServer.length &&
          clientRecvd === toClient.length
        ) {
          done();
        }
      });
    });
    server.listen(1234, () => {
      const rawSocket = helper.makeSocket();
      const socket = new EncryptedSocket(rawSocket, {
        peerId: clientId,
        privateKey: clientPrivateKey,
        publicKey: serverPublicKey,
        logger: helper.log.child({ side: 'client' }),
      });
      socket.on('badMessage', (err) => {
        console.error(err);
        expect.fail('badMessage');
      });
      socket.on('message', (newMessage) => {
        expect(clientRecvd).to.be.lessThan(toClient.length);
        expect(newMessage.toString('utf8')).to.equal(toClient[clientRecvd]);
        clientRecvd++;
        if (
          serverRecvd === toServer.length &&
          clientRecvd === toClient.length
        ) {
          done();
        }
      });
      rawSocket.connect(1234, 'localhost');
      rawSocket.on('ready', () => {
        expect(socket.send(Buffer.from(toServer[0], 'utf8'))).to.eventually.be
          .true;
        expect(socket.send(Buffer.from(toServer[1], 'utf8'))).to.eventually.be
          .true;
        expect(socket.send(Buffer.from(toServer[2], 'utf8'))).to.eventually.be
          .true;
      });
    });
  });
});
