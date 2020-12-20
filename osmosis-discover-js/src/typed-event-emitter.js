// Typescript definition trickery to declare strongly-typed EventEmitters
// Most of the magic is in typed-event-emitter.d.ts
const { EventEmitter: TypedEventEmitter } = require('events');

module.exports = {
  default: TypedEventEmitter,
  __esModule: true,
};
