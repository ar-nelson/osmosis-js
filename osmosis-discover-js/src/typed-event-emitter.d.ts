// Typescript definition trickery to declare strongly-typed EventEmitters
// Can only be done by unsafely overwriting EventEmitter's type
declare module 'typed-event-emitter';

// eslint-disable-next-line @typescript-eslint/ban-types
declare class TypedEventEmitter<Events extends object> {
  on<U extends keyof Events>(event: U, listener: Events[U]): this;

  protected emit<U extends keyof Events>(
    event: U,
    ...args: Events[U] extends (event?: any) => void
      ? Parameters<Events[U]>
      : never
  ): boolean;
}

export default TypedEventEmitter;
