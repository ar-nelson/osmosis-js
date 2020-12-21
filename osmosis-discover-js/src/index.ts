import assert from 'assert';
import Logger from 'bunyan';
import readline from 'readline';
import * as uuid from 'uuid';
import OsmosisConnection from './osmosis-connection';
import { generateConfig } from './peer-config';

const log = Logger.createLogger({
  level: 'trace',
  name: 'osmosis',
  serializers: { err: Logger.stdSerializers.err },
});

const appId = process.argv[2];
if (appId) {
  assert(uuid.validate(appId));
}

(async () => {
  const config = await generateConfig(appId);
  log.trace({ config }, 'config generated');
  const connection = new OsmosisConnection(config, {}, log);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let running = true;
  while (running) {
    try {
      const input: string = await new Promise((resolve) =>
        rl.question('Enter "expect", "pair", or "exit":\n', resolve)
      );
      const words = input.trim().split(/\s+/);
      if (words.length === 0) {
        continue;
      }
      switch (words[0].toLowerCase()) {
        case 'exit':
        case 'quit':
        case 'q':
          connection.stop();
          running = false;
          break;
        case 'expect':
          log.info('waiting on pair request');
          connection.on('pairRequest', (peer) => {
            log.info({ peer }, 'got pair request');
            rl.question(`Pair request from ${peer.id}, enter PIN:\n`, (pin) => {
              connection.acceptPairRequest(peer.id, +pin);
            });
          });
          running = false;
          break;
        case 'pair':
          await connection.pair(connection.peers[0].id);
          break;
      }
    } catch (err) {
      log.error({ err }, 'error in command line');
    }
    rl.close();
  }
})();
