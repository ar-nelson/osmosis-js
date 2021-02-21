import { Json, MetadataSource } from '@nels.onl/osmosis-store-js';
import { RingBuffer } from 'bunyan';
import { EventEmitter } from 'events';

export default class LogMetadataSource
  extends EventEmitter
  implements MetadataSource {
  private readonly buffer: RingBuffer;

  constructor(bufferSize = 1000) {
    super();
    this.buffer = new RingBuffer({ limit: bufferSize });
  }

  write(record: Json): boolean {
    const result = this.buffer.write(record);
    this.emit('update', this.buffer.records);
    return result;
  }

  subscribe(fn: (json: Json) => void): void {
    this.on('update', fn);
  }

  unsubscribe(fn: (json: Json) => void): void {
    this.off('update', fn);
  }

  get writable(): boolean {
    return true;
  }

  get initialState(): Json[] {
    return this.buffer.records;
  }
}
