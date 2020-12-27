import OsmosisConfig from './osmosis-config';
import TypedEventEmitter from './typed-event-emitter';

type OsmosisEvents = {
  PairRequest: () => void;
  PairResponse: () => void;
  PairPin: () => void;
};

export default class Osmosis extends TypedEventEmitter<OsmosisEvents> {
  constructor(config: OsmosisConfig) {
    super();
  }
}
