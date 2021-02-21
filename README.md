# Osmosis

An in-process JSON database with automatic peer-to-peer background
synchronization between devices on a local network. Keep your apps in sync
without a cloud!

> **🚧 WORK-IN-PROGRESS 🚧: Osmosis is not yet usable. The npm modules mentioned
> in this README are not available yet. Watch this space for updates.**

The library itself is `@nels.onl/osmosis-js`. Separate modules exist for the
JSON CRDT datastore (`@nels.onl/osmosis-store-js`) and the network stack
(`@nels.onl/osmosis-net-js`).

> The library is called `osmosis-js` instead of `osmosis` because this Node
> module is a non-portable reference implementation. Osmosis is really meant for
> mobile apps, but, unfortunately, this Node module with native dependencies is
> not easily usable on mobile.
>
> My plan is to develop a portable native implementation in C, and to provide
> bindings for several languages, including a Node wrapper at
> `@nels.onl/osmosis`. See the [Roadmap](#roadmap) for more information.

## Rationale

Consider an app with both mobile and desktop versions, like a notetaking app,
a password manager, or a podcast client. The user would like to keep its state
synced between a laptop and a phone.

Normally, this requires a cloud service to store the synced data. But, with
Osmosis, after pairing the mobile and desktop apps once, they will detect each
other every time they connect to the same Wi-Fi network, and will create
a direct p2p connection to sync data.

Osmosis synchronization is automatic, encrypted, and relatively safe from
conflicts. Updates are modeled with a JSON [CRDT][crdt]. It is possible for
updates to fail, but this can only happen if a path is updated after its parent
is deleted, or if non-typesafe changes are made (e.g., replacing an object with
an array).

## Usage

### Database

An Osmosis database is a single JSON object. Osmosis has the API of a reactive
data store like Redux:

- Updates are [Actions](#actions), which are JSON messages.
- Queries are listener callbacks, called every time the data at a given path is
  updated. Paths are expressed as [JsonPath][jsonpath].

Actions are sent with `dispatch`, and queries are created with `subscribe`.

```javascript
import Osmosis from '@nels.onl/osmosis-js';

const store = new Osmosis({
  appId: '82feacaf-3ae0-41c2-9aff-dd7dcb0a2a80'
});

// Create an array at the top-level key "numbers"
store.dispatch({
  action: 'InitArray',
  path: '$.numbers'
});

// Print the list of numbers every time it changes
store.subscribe('$.numbers', (numbers) => {
  console.log(`Numbers: ${numbers.join(', ')}`);
});

// Add some entries to the numbers array
store.dispatch({ action: 'InsertUnique', path: '$.numbers', payload: 1 });
store.dispatch({ action: 'InsertUnique', path: '$.numbers', payload: 2 });
store.dispatch({ action: 'InsertUnique', path: '$.numbers', payload: 3 });
```

### Pairing

The pairing process looks like this:

1. One device (the _Requester_) dispatches a `RequestPair` action, with
   a payload containing the UUID of another device (the _Responder_) and
   a secret string (usually a randomly-generated PIN).
2. The Requester displays the secret to the user.
3. The Responder receives the request and prompts the user for the secret.
4. The user enters the secret.
5. The Responder dispatches an `AcceptPair` action, with a payload containing
   the Requester's UUID and the secret.
6. The Requester receives the response. The devices are now paired, and will
   begin syncing in the background.

A basic pairing setup for Osmosis, which can send and receive pairing requests,
looks like this:

```javascript
import Osmosis from '@nels.onl/osmosis-js';

const store = new Osmosis({
  appId: 'f8e8eec8-d219-4e6e-b8fc-3363504860ff',
  peerName: 'Peer 1'
});

let peers = [];

store.subscribeMeta('$.peers', (peerList) => {
  peers = peerList;
});

store.on('pairRequest', (evt) => {
  const secret = prompt(
    `Received pair request from ${evt.peerName} (${evt.peerId}). ` +
    'Please enter the PIN displayed on this device.'
  );
  if (secret) {
    store.dispatch({
      action: 'AcceptPair',
      payload: {
        uuid: evt.uuid,
        secret
      }
    });
  } else {
    store.dispatch({
      action: 'RejectPair',
      payload: evt.uuid
    });
  }
});

store.on('pairResponse', (evt) => {
  if (evt.accepted) {
    console.log(`Pair request to ${evt.peerName} accepted`);
  } else {
    console.log(`Pair request to ${evt.peerName} rejected`);
  }
});

function pairWithFirstPeer() {
  if (!peers.length) return;

  // Generate a 4-digit PIN
  const secret = `${Math.floor(Math.random() * 10000)}`.padStart(4, '0');

  store.dispatch({
    action: 'RequestPair',
    payload: {
      id: peers[0].uuid;
      secret
    }
  });

  alert(`Pairing PIN: ${secret}`);
}
```

There's a lot going on in this example, so let's take it one step at a time.

`subscribeMeta` is like `subscribe`, except that it queries the Osmosis store's
[Metadata](#metadata) instead of its data. Metadata includes things like network
state, action history, and failures. All of this data is available as one
queryable JSON object. `peers` is the list of visible peers, which updates every
time a peer enters or leaves the network.

An Osmosis store also emits [Events](#events), which can be listened to with the
`on` method. Events are mostly network-related.

Pairing Osmosis instances requires a few event listeners:

- `pairRequest` - fires when a pair request is received.
- `pairResponse` - fires when a pair request is accepted or rejected.

Finally, the pairing process uses some actions that operate on network state
instead of data. `RequestPair`, `AcceptPair`, and `RejectPair`, among others,
control the pairing process but are not part of the Osmosis store's history.
These actions are documented in [Network Actions](#network-actions).

## How it Works

### Discovery

The first time an Osmosis instance is created, it generates a Peer ID and
a public/private keypair. This data should be saved to disk, and loaded every
time this Osmosis instance is started.

Osmosis uses two kinds of sockets: broadcast UDP sockets that send heartbeat
packets, and unicast TCP sockets that send [Monocypher][monocypher]-encrypted,
[zstandard][zstd]-compressed [JSON-RPC][jsonrpc] messages.

When a TCP socket is opened, each side sends its 16-byte Peer ID to the other.
All subsequent TCP messages are formatted like this:

```txt
[..][......................][.................... . . .
|   |                       |
|   Nonce (24 bytes)        Message (abs(Length) bytes)
|
Length (4 bytes, big-endian 32-bit int)
```

If `Length` is negative, it signifies that the decrypted contents of `Message`
are compressed. The length of `Message` is the absolute value of `Length`.
`Message` is encrypted using Monocypher's AEAD and a shared key computed from
one peer's private key and the other's public key. Inside is a JSON-RPC message,
which may be compressed with zstandard.

Each Osmosis instance starts a TCP service, called the Gateway Service, on
a random ephemeral port. This service receives pair requests and connection
requests.

Osmosis sends out a UDP heartbeat packet every minute, on the broadcast address
of every broadcast-compatible IPv4 network interface, on a port computed from
the first 2 bytes of the App ID:

```javascript
heartbeatPort = appId[0] | appId[1] << 8 | 0x8000; // always >= 32768
```

The heartbeat is a binary message, with this layout:

```txt
[..][..............][..............][..............................][][... . . .
|   |               |               |                               | |
|   App ID (16B)    Peer ID (16B)   Public key (32 bytes)           | |
|                                                                   | |
Magic number (4 bytes: 0x054d0515)                                  | |
                                                                    | |
                               Port (2 bytes, big-endian 16-bit uint) |
                                                                      |
               Peer name (UTF-8 string prefixed with 8-bit uint length)
```

When peer A receives peer B's heartbeat, it is only considered valid if the
following conditions apply:

- A and B have the same App ID
- A and B have different Peer IDs
- B's Gateway port is > 1024
- A has not recently seen a heartbeat with B's Peer ID from a different IP
  address, or with a different port or public key
- If A is already paired with B, B's public key has not changed since pairing

When A receives a valid heartbeat from B, B is added to A's list of visible
peers; it is removed if A does not receive a new heartbeat for 3 minutes.

Pairing is done using the Gateway Service. Once two peers are paired, they will
connect as soon as one receives a valid heartbeat from the other. Connecting
involves one peer creating a new TCP Connection Service on a random ephemeral
port, with a random keypair, then sending this port and public key to the other
peer, which responds with its own newly-generated public key. Once one peer is
connected to the other's Connection Service, they synchronize their lists of
paired peers and begin exchanging state updates.

### Store

The Osmosis store is a [Causal Tree][causal-tree] JSON [CRDT][crdt] made up of
two parts:

- A list of Actions, each of which is tagged with an ID (peer UUID + Lamport number).
- A list of Save Points, which are copies of the full JSON tree at specific
  points in time, with exponentially increasing gaps (first few are ~4 actions
  apart, then 8, then 16, and so on).

The Save Points are a performance optimization to avoid reconstructing the full
JSON tree from scratch every time a merge happens.

When a new Action is dispatched, its `path` is compiled to a JSON
representation. This may split the Action into multiple Actions. Each `path` is
then further compiled to a Causal Tree representation by replacing the longest
prefix referring to an existing location with that location's ID. Actions are
only stored or synced in this fully-compiled form.

```javascript
// Given this Osmosis store state:
{ foo: { bar: { baz: 1 } } }

// Composed of these (uncompiled) actions:
[{
  action: "InitObject",
  path: "$.foo",
  id: { author: "ef6d1530-5ed7-4330-abb9-4d4accd1ead5", index: 1 }
}, {
  action: "InitObject",
  path: "$.foo.bar",
  id: { author: "ef6d1530-5ed7-4330-abb9-4d4accd1ead5", index: 2 }
}, {
  action: "Set",
  path: "$.foo.bar.baz",
  payload: 1,
  id: { author: "ef6d1530-5ed7-4330-abb9-4d4accd1ead5", index: 3 }
}]

// Then, this new action:
{ action: "Set", path: "$.foo.bar.qux", payload: 2 }

// Has a path that compiles to this:
[{ type: "Key", query: "foo" },
 { type: "Key", query: "bar" },
 { type: "Key", query: "qux" }]

// Which can be further compiled to this Causal Tree form:
[{
  type: "Id",
  query: { author: "ef6d1530-5ed7-4330-abb9-4d4accd1ead5", index: 2 }
}, {
  type: "Key",
  query: "qux"
}]
```

### Synchronization

When two Osmosis instances establish a connection, they send each other a State
Summary. The State Summary consists of a State Hash and a mapping from each
known peer's Peer ID to its latest Lamport number.

The State Hash is a cumulative hash of the IDs of an instance's entire Action
history, in order. It is computed recursively:

```txt
StateHash(0) = 00000000000000000000000000000000...

StateHash(i + 1) = Blake2B([........ . . . ........][..............][......])
                                                   |               |       |
                             StateHash(i) (64 bytes)               |       |
                                                                   |       |
                                    Peer ID of Actions[i] (16 bytes)       |
                                                                           |
              Lamport number of Actions[i] (8 bytes, big-endian 64-bit uint)
```

If two peers have different State Hashes, they are out of sync and must be
synchronized.

Action synchronization uses a [Causal Tree][causal-tree] algorithm. Actions are
sorted by ID, first by Lamport timestamp and then by peer UUID. Synchronization
involves rolling back to the latest Save Point that is earlier than all new
Actions, then applying all Actions after that point, while inserting new Actions
in sorted order.

If a merged action fails, the failure is added to the `failures` metadata key
and the action is skipped, but the remaining actions are applied as usual.

Osmosis supports two kinds of sync operations:

1. **Live Sync:** While an Osmosis instance is connected to one or more
   peers, newly dispatched Actions are sent to all connected peers as soon as
   they are dispatched.

   Peers return their new State Hashes after a Live Sync update is applied. If,
   after a Live Sync, a peer's State Hash differs from the local State Hash,
   then a Full Sync is performed.

2. **Full Sync:** When a connection between two peers is opened, or whenever
   a Live Sync results in an inconsistent state, peers will negotiate a sync
   session to ensure that their State Hashes match.

   An Osmosis instance may only perform one Full Sync at a time. While a Full
   Sync is in progress, all other sync requests and dispatched actions will be
   enqueued until the sync has completed.

   A Full Sync consists of two steps, performed by both peers:

   1. Peer A looks at every Lamport number in Peer B's State Summary, and sends
      Peer B a list of every Action whose Lamport number is greater than Peer
      B's latest Lamport number for that Action's Peer ID.

   2. If Peers A and B still do not have the same State Hash, Peer A sends
      a list of its Save Points to Peer B, and Peer B returns the latest Action
      ID in its history that matches a Save Point's ID and State Hash.

      If a shared ID is found, Peer A sends Peer B all of its Actions with an ID
      later than the shared ID. Peer B rewinds its state to the timestamp of the
      shared ID, then applies all Actions from both A and B that are later than
      the shared ID.

      If no shared ID is found, the peers have no history in common. This can
      happen if one peer has garbage-collected too much of its history. This is
      an unrecoverable error, and the peers will unpair automatically.

## API

### Methods

#### `new Osmosis(config)`

Creates a new Osmosis store from the given configuration object.

`config` is an object with the following properties, all of which (except
`appId`) are optional:

- `appId`: A UUID that uniquely identifies this Osmosis app. Osmosis will only
  detect peers with the same `appId`.
- `peerName`: A human-readable string to identify this device when pairing. Will
  appear in the UI of other devices when listing peers. Defaults to something
  based on the device's hostname.
- `saveState`: An instance of the `SaveState` class, which controls how the
  store's data is persisted to disk. `InMemorySaveState` (the default) and
  `JsonFileSaveState` are aways available. Additional modules are planned for
  `SqliteSaveState` and `LevelDbSaveState`.
- `minHistory`: An integer, defaults to `0`. The minimum number of past actions
  that Osmosis will preserve, even if it knows it doesn't need them (i.e., all
  known peers are synced). If you intend to do anything with Osmosis's history
  besides syncing, this should be set to something other than `0`. If it is
  `-1`, history will never be deleted.
- `maxHistory`: An integer, defaults to `32768`. The maximum number of actions
  that Osmosis will remember while preserving history for a pending sync that
  may need that history. If Osmosis accumulates more than this amount of history
  without syncing, it will start deleting history, which could make future
  synchronization impossible. If it is `-1`, there is no limit.
- `visibleToPeers`: Whether this Osmosis instance is initially visible to other,
  non-paired peers on the network. Defaults to `true`.
- `syncEnabled`: Whether this Osmosis instance is initially able to connect to
  paired peers and sync. Defaults to `true`.

#### `Osmosis.dispatch(action, returnFailures = false)`

Submits an [Action](#actions) to the store. Throws an `OsmosisFailureError` if
the action reports any failures. If `returnFailures` is true, it does not throw,
and instead returns an array of failures, which will be empty if the action did
not cause any failures.

#### `Osmosis.subscribe(path, variables = [], callback)`

Subscribes to update events on the data queried by the JsonPath string `path`.
`callback` is called with an array of JSON values, which may be empty if there
is nothing at the subscribed path. Whenever the subscribed data is updated,
`callback` is called again with a new array of query results.

`variables`, if present, is an array or object containing variables to
interpolate into `path`.

Returns an object with one method, `cancel`. Calling `cancel()` on this object
will cancel the subscription, and `callback` will not be called again.

#### `Osmosis.subscribeMeta(path, variables = [], callback)`

Subscribes to update events on the [Metadata](#metadata) queried by the JsonPath
string `path`. `callback` is called with an array of JSON values, which may be
empty if there is nothing at the subscribed path. Whenever the subscribed data
is updated, `callback` is called again with a new array of query results.

`variables`, if present, is an array or object containing variables to
interpolate into `path`.

Returns an object with one method, `cancel`. Calling `cancel()` on this object
will cancel the subscription, and `callback` will not be called again.

#### `Osmosis.queryOnce(path, variables = [])`

Synchronously queries the store using the JsonPath string `path`, and returns
the result as an array of JSON values.

`variables`, if present, is an array or object containing variables to
interpolate into `path`.

#### `Osmosis.queryOnceMeta(path, variables = [])`

Synchronously queries the store's [Metadata](#metadata) using the JsonPath
string `path`, and returns the result as an array of JSON values.

`variables`, if present, is an array or object containing variables to
interpolate into `path`.

#### `Osmosis.on(eventName, callback)`

Registers an event listener for the [Event](#events) `eventName`. `callback` is
called with one argument (the event) whenever an event of this type occurs.
Throws an exception if `eventName` is not a known event type.

Returns an object with one method, `cancel`. Calling `cancel()` on this object
will cancel the event listener, and `callback` will not be called again.

### Actions

#### Data Actions

##### `Set`

    { action: "Set", path: JsonPath string, payload: JSON value }

*To be written.*

##### `Delete`

    { action: "Delete", path: JsonPath string }

*To be written.*

##### `InitObject`

    { action: "InitObject", path: JsonPath string }

*To be written.*

##### `InitArray`

    { action: "InitArray", path: JsonPath string }

*To be written.*

##### `InsertBefore`

    { action: "InsertBefore", path: JsonPath string, payload: JSON value }

*To be written.*

##### `InsertAfter`

    { action: "InsertAfter", path: JsonPath string, payload: JSON value }

*To be written.*

##### `InsertUnique`

    { action: "InsertUnique", path: JsonPath string, payload: JSON value }

*To be written.*

##### `Add`

    { action: "Add", path: JsonPath string, payload: number }

*To be written.*

##### `Multiply`

    { action: "Multiply", path: JsonPath string, payload: number }

*To be written.*

##### `Move`

    { action: "Move", path: JsonPath string, payload: JsonPath string }

*To be written.*

##### `Copy`

    { action: "Copy", path: JsonPath string, payload: JsonPath string }

*To be written.*

##### `Transaction`

    { action: "Transaction", payload: array of data actions }

*To be written.*

#### Network Actions

##### `RequestPair`

    { action: "RequestPair", payload: { id: UUID string, secret: string } }

*To be written.*

##### `AcceptPair`

    { action: "AcceptPair", payload: { id: UUID string, secret: string } }

*To be written.*

##### `RejectPair`

    { action: "RejectPair", payload: UUID string }

*To be written.*

##### `Unpair`

    { action: "Unpair", payload: UUID string }

*To be written.*

##### `SetVisibleToPeers`

    { action: "SetVisibleToPeers", payload: boolean }

*To be written.*

##### `SetSyncEnabled`

    { action: "SetSyncEnabled", payload: boolean }

*To be written.*

### Events

#### `pairRequest`

*To be written.*

#### `pairResponse`

*To be written.*

### Metadata

#### `actions`

An array containing the data actions that make up this Osmosis store's history,
except for actions that have been removed by garbage collection.

Actions are stored in a different format than the format used by `dispatch`.
Each action has a `timestamp` and an `id`, JsonPath strings are compiled into
JSON objects, and actions with complex paths may be split up into multiple
actions.

Note that, by default, Osmosis's garbage collection is extremely aggressive.
History is only preserved if it is absolutely necessary for a pending sync, and
is deleted as soon as all known paired peers are synced. If you want more
history (for example, as an Undo feature), set the `minHistory` and `maxHistory`
config parameters when constructing a `new Osmosis` object.

#### `config`

The configuration options for this Osmosis instance, which are a combination of
some options set in the `new Osmosis` constructor and these additional options
that are saved to the `SaveState`'s file:

- `peerId`
- `publicKey`
- `privateKey`

#### `failures`

An array of all failures caused by all actions in this store's history. If
synced actions from other peers cause failures, this is the only place they will
be reported. Each failure has an `id` linking it to the action that caused it.

When an action is deleted by garbage collection, its failures will also be
removed from this array.

#### `pairings`

An array of all paired peers, whether they are currently visible or not.

#### `peers`

An array of all peers currently visible on the network. Peers are visible only
if they share the same `appId`.

## Roadmap

- [ ] MVP reference implementation in Node
- [ ] RxJS wrapper library
- [ ] Sample app
- [ ] [Chronofold][chronofold]-like string actions
- [ ] LevelDB support
- [ ] SQLite support
- [ ] Blobs and blob actions
- [ ] Standalone database app
- [ ] Port to C
- [ ] More language bindings:
  - [ ] Node
  - [ ] Cordova plugin
  - [ ] Java (+ Android)
  - [ ] Python
  - [ ] Go
- [ ] At-rest encryption support
- [ ] More sample apps:
  - [ ] Notes app
  - [ ] Password manager
  - [ ] Podcast client
  - [ ] Dropbox clone

## License

Copyright &copy; 2020-2021 Adam Nelson

Osmosis is distributed under the [Blue Oak Model License][blue-oak]. It is
a MIT/BSD-style license, but with [some clarifying improvements][why-blue-oak]
around patents, attribution, and multiple contributors.

[jsonpath]: https://goessner.net/articles/JsonPath/
[causal-tree]: http://citeseerx.ist.psu.edu/viewdoc/summary?doi=10.1.1.627.5286
[crdt]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
[chronofold]: https://arxiv.org/abs/2002.09511
[monocypher]: https://monocypher.org
[zstd]: https://facebook.github.io/zstd/
[jsonrpc]: https://www.jsonrpc.org/
[blue-oak]: https://blueoakcouncil.org/license/1.0.0
[why-blue-oak]: https://writing.kemitchell.com/2019/03/09/Deprecation-Notice.html

