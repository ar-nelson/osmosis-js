import assert from 'assert';
import Logger from 'bunyan';
import * as uuid from 'uuid';
import Connection from './connection';
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
  new Connection(config, log);
})();
