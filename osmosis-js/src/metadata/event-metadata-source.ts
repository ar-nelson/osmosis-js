import { Json, MetadataSource } from '@nels.onl/osmosis-store-js';
import { EventEmitter } from 'events';

export default class EventMetadataSource
  extends EventEmitter
  implements MetadataSource {
  constructor(private _initialState: Json) {
    super();
  }

  get initialState(): Json {
    return this._initialState;
  }

  update(value: Json): void {
    this._initialState = value;
    this.emit('update', value);
  }

  subscribe(fn: (json: Json) => void): void {
    this.on('update', fn);
  }

  unsubscribe(fn: (json: Json) => void): void {
    this.off('update', fn);
  }
}
