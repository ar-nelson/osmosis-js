import { expect } from 'chai';
import { afterEach, describe, it } from 'mocha';
import { generateConfig } from '../src/peer-config';
import OsmosisConnection from '../src/osmosis-connection';
import SocketTestHelper from './socket-test-helper';

describe('OsmosisConnection', function () {
  const helper = new SocketTestHelper();
  const appId = '99804c7c-2abb-42ee-94e8-2a5d6cbc5f55';
  let conn1: OsmosisConnection<any>;
  let conn2: OsmosisConnection<any>;

  afterEach(function () {
    conn1?.stop();
    conn2?.stop();
  });

  it('should find peers', function (done) {
    helper.startAsyncTest(done);
    let gotPeer1 = false;
    let gotPeer2 = false;
    (async () => {
      const config1 = await generateConfig(appId, 'Test Peer 1');
      const config2 = await generateConfig(appId, 'Test Peer 2');
      conn1 = new OsmosisConnection(config1, {}, helper.log.child({ peer: 1 }));
      conn1.on('peerAppeared', (peer) => {
        expect(peer.id).to.equal(config2.peerId);
        expect(peer.name).to.equal('Test Peer 2');
        gotPeer2 = true;
        if (gotPeer1) {
          done();
        }
      });
      conn2 = new OsmosisConnection(config2, {}, helper.log.child({ peer: 2 }));
      conn2.on('peerAppeared', (peer) => {
        expect(peer.id).to.equal(config1.peerId);
        expect(peer.name).to.equal('Test Peer 1');
        gotPeer1 = true;
        if (gotPeer2) {
          done();
        }
      });
    })();
  });

  it('should pair and connect peers', function (done) {
    helper.startAsyncTest(done);
    let gotPeer1 = false;
    let gotPeer2 = false;
    (async () => {
      const config1 = await generateConfig(appId, 'Test Peer 1');
      const config2 = await generateConfig(appId, 'Test Peer 2');
      conn1 = new OsmosisConnection(config1, {}, helper.log.child({ peer: 1 }));
      conn1.on('peerAppeared', async (peer) => {
        expect(await conn1.pair(peer.id)).to.be.true;
      });
      const pinPromise = new Promise<number>((resolve) =>
        conn1.on('pairPin', resolve)
      );
      conn1.on('peerConnected', (peer) => {
        expect(peer.id).to.equal(config2.peerId);
        expect(peer.name).to.equal('Test Peer 2');
        gotPeer2 = true;
        if (gotPeer1) {
          done();
        }
      });
      conn2 = new OsmosisConnection(config2, {}, helper.log.child({ peer: 2 }));
      conn2.on('pairRequest', async (peer) => {
        expect(conn2.acceptPairRequest(peer.id, await pinPromise)).to.be.true;
      });
      conn2.on('peerConnected', (peer) => {
        expect(peer.id).to.equal(config1.peerId);
        expect(peer.name).to.equal('Test Peer 1');
        gotPeer1 = true;
        if (gotPeer2) {
          done();
        }
      });
    })();
  });
});
