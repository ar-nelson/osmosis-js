export default interface OsmosisConfig {
  /**
   * A UUID that uniquely identifies this Osmosis app. Osmosis will only detect
   * peers with the same appId.
   */
  appId: string;

  /**
   * A human-readable string to identify this device when pairing. Will appear
   * in the UI of other devices when listing peers. Defaults to something based
   * on the device's hostname.
   */
  peerName?: string;

  /**
   * A string describing how Osmosis data is persisted to disk. Supported
   * values are 'none' (default), 'json', and 'sqlite'. More values may be added
   * in the future.
   */
  persistence?: 'none' | 'json' | 'sqlite';

  /**
   * The file to save Osmosis data to. Will be read immediately, then written
   * continually whenever the Osmosis state is changed. Required if persistence
   * is not 'none'.
   */
  filename?: string;

  /**
   * An integer, defaults to 0. The minimum number of past actions that Osmosis
   * will preserve, even if it knows it doesn't need them (i.e., all known peers
   * are synced). If you intend to do anything with Osmosis's history besides
   * syncing, this should be set to something other than 0. If it is -1, history
   * will never be deleted.
   */
  minHistory?: number;

  /**
   * An integer, defaults to 32768. The maximum number of actions that Osmosis
   * will remember while preserving history for a pending sync that may need
   * that history. If Osmosis accumulates more than this amount of history
   * without syncing, it will start deleting history, which could make future
   * synchronization impossible. If it is -1, there is no limit.
   */
  maxHistory?: number;

  /**
   * Whether this Osmosis instance is initially visible to other, non-paired
   * peers on the network. Defaults to true.
   */
  visibleToPeers?: boolean;

  /**
   * Whether this Osmosis instance is initially able to connect to paired peers
   * and sync. Defaults to true.
   */
  syncEnabled?: boolean;
}
