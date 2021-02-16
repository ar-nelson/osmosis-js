import { expect } from 'chai';
import { afterEach, describe, it } from 'mocha';
import { generateConfig } from '../src/peer-config';
import PeerFinder from '../src/peer-finder';
import SocketTestHelper from './socket-test-helper';

describe('PeerFinder', function () {
  const helper = new SocketTestHelper();
  const appId = '99804c7c-2abb-42ee-94e8-2a5d6cbc5f55';
  const port1 = 10001;
  const port2 = 10002;
  let pf1: PeerFinder;
  let pf2: PeerFinder;

  afterEach(function () {
    pf1?.stop();
    pf2?.stop();
  });

  it('should find peers', function (done) {
    helper.startAsyncTest(done);
    let gotHb1 = false;
    let gotHb2 = false;
    (async () => {
      const config1 = await generateConfig(appId, 'Test Peer 1');
      const config2 = await generateConfig(appId, 'Test Peer 2');
      pf1 = new PeerFinder(
        config1,
        port1,
        () => undefined,
        helper.log.child({ peer: 1 })
      );
      pf1.on('heartbeat', ({ heartbeat }) => {
        expect(heartbeat.appId).to.equal(appId);
        expect(heartbeat.peerId).to.equal(config2.peerId);
        expect(heartbeat.peerName).to.equal('Test Peer 2');
        expect(heartbeat.port).to.equal(port2);
        expect(heartbeat.publicKey.toString('base64')).to.equal(
          config2.publicKey.toString('base64')
        );
        gotHb2 = true;
        if (gotHb1) {
          done();
        }
      });
      setTimeout(() => {
        pf2 = new PeerFinder(
          config2,
          port2,
          () => undefined,
          helper.log.child({ peer: 2 })
        );
        pf2.on('heartbeat', ({ heartbeat }) => {
          expect(heartbeat.appId).to.equal(appId);
          expect(heartbeat.peerId).to.equal(config1.peerId);
          expect(heartbeat.peerName).to.equal('Test Peer 1');
          expect(heartbeat.port).to.equal(port1);
          expect(heartbeat.publicKey.toString('base64')).to.equal(
            config1.publicKey.toString('base64')
          );
          gotHb1 = true;
          if (gotHb2) {
            done();
          }
        });
      }, 500);
    })();
  });
});
