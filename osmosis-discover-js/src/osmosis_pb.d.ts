// package: Osmosis
// file: src/osmosis.proto

import * as jspb from 'google-protobuf';

declare class Heartbeat extends jspb.Message {
  hasPayload(): boolean;
  clearPayload(): void;
  getPayload(): Heartbeat.Payload | undefined;
  setPayload(value?: Heartbeat.Payload): void;

  getSignature(): Uint8Array | string;
  getSignature_asU8(): Uint8Array;
  getSignature_asB64(): string;
  setSignature(value: Uint8Array | string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): Heartbeat.AsObject;
  static toObject(includeInstance: boolean, msg: Heartbeat): Heartbeat.AsObject;
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
  static extensionsBinary: {
    [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
  };
  static serializeBinaryToWriter(
    message: Heartbeat,
    writer: jspb.BinaryWriter
  ): void;
  static deserializeBinary(bytes: Uint8Array): Heartbeat;
  static deserializeBinaryFromReader(
    message: Heartbeat,
    reader: jspb.BinaryReader
  ): Heartbeat;
}

declare namespace Heartbeat {
  export type AsObject = {
    payload?: Heartbeat.Payload.AsObject;
    signature: Uint8Array | string;
  };

  export class Payload extends jspb.Message {
    getAppid(): Uint8Array | string;
    getAppid_asU8(): Uint8Array;
    getAppid_asB64(): string;
    setAppid(value: Uint8Array | string): void;

    getPeerid(): Uint8Array | string;
    getPeerid_asU8(): Uint8Array;
    getPeerid_asB64(): string;
    setPeerid(value: Uint8Array | string): void;

    getPeername(): string;
    setPeername(value: string): void;

    getIpaddress(): number;
    setIpaddress(value: number): void;

    getPort(): number;
    setPort(value: number): void;

    getTimestamp(): number;
    setTimestamp(value: number): void;

    getCertfingerprint(): Uint8Array | string;
    getCertfingerprint_asU8(): Uint8Array;
    getCertfingerprint_asB64(): string;
    setCertfingerprint(value: Uint8Array | string): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Payload.AsObject;
    static toObject(includeInstance: boolean, msg: Payload): Payload.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
      [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
      message: Payload,
      writer: jspb.BinaryWriter
    ): void;
    static deserializeBinary(bytes: Uint8Array): Payload;
    static deserializeBinaryFromReader(
      message: Payload,
      reader: jspb.BinaryReader
    ): Payload;
  }

  export namespace Payload {
    export type AsObject = {
      appid: Uint8Array | string;
      peerid: Uint8Array | string;
      peername: string;
      ipaddress: number;
      port: number;
      timestamp: number;
      certfingerprint: Uint8Array | string;
    };
  }
}

declare class PeerInfo extends jspb.Message {
  getPeerid(): Uint8Array | string;
  getPeerid_asU8(): Uint8Array;
  getPeerid_asB64(): string;
  setPeerid(value: Uint8Array | string): void;

  getPeername(): string;
  setPeername(value: string): void;

  getSecrettoken(): Uint8Array | string;
  getSecrettoken_asU8(): Uint8Array;
  getSecrettoken_asB64(): string;
  setSecrettoken(value: Uint8Array | string): void;

  getCertfingerprint(): Uint8Array | string;
  getCertfingerprint_asU8(): Uint8Array;
  getCertfingerprint_asB64(): string;
  setCertfingerprint(value: Uint8Array | string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): PeerInfo.AsObject;
  static toObject(includeInstance: boolean, msg: PeerInfo): PeerInfo.AsObject;
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
  static extensionsBinary: {
    [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
  };
  static serializeBinaryToWriter(
    message: PeerInfo,
    writer: jspb.BinaryWriter
  ): void;
  static deserializeBinary(bytes: Uint8Array): PeerInfo;
  static deserializeBinaryFromReader(
    message: PeerInfo,
    reader: jspb.BinaryReader
  ): PeerInfo;
}

declare namespace PeerInfo {
  export type AsObject = {
    peerid: Uint8Array | string;
    peername: string;
    secrettoken: Uint8Array | string;
    certfingerprint: Uint8Array | string;
  };
}

declare class PairResponse extends jspb.Message {
  getStatus(): PairResponse.StatusMap[keyof PairResponse.StatusMap];
  setStatus(value: PairResponse.StatusMap[keyof PairResponse.StatusMap]): void;

  getPin(): number;
  setPin(value: number): void;

  hasPeer(): boolean;
  clearPeer(): void;
  getPeer(): PeerInfo | undefined;
  setPeer(value?: PeerInfo): void;

  getPayloadCase(): PairResponse.PayloadCase;
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): PairResponse.AsObject;
  static toObject(
    includeInstance: boolean,
    msg: PairResponse
  ): PairResponse.AsObject;
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
  static extensionsBinary: {
    [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
  };
  static serializeBinaryToWriter(
    message: PairResponse,
    writer: jspb.BinaryWriter
  ): void;
  static deserializeBinary(bytes: Uint8Array): PairResponse;
  static deserializeBinaryFromReader(
    message: PairResponse,
    reader: jspb.BinaryReader
  ): PairResponse;
}

declare namespace PairResponse {
  export type AsObject = {
    status: PairResponse.StatusMap[keyof PairResponse.StatusMap];
    pin: number;
    peer?: PeerInfo.AsObject;
  };

  export interface StatusMap {
    ACCEPTED: 0;
    REJECTED: 1;
    ALREADY_PAIRED: 2;
  }

  export const Status: StatusMap;

  export enum PayloadCase {
    PAYLOAD_NOT_SET = 0,
    PEER = 3,
  }
}

declare class PairConfirm extends jspb.Message {
  getPeerid(): Uint8Array | string;
  getPeerid_asU8(): Uint8Array;
  getPeerid_asB64(): string;
  setPeerid(value: Uint8Array | string): void;

  getAccepted(): boolean;
  setAccepted(value: boolean): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): PairConfirm.AsObject;
  static toObject(
    includeInstance: boolean,
    msg: PairConfirm
  ): PairConfirm.AsObject;
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
  static extensionsBinary: {
    [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
  };
  static serializeBinaryToWriter(
    message: PairConfirm,
    writer: jspb.BinaryWriter
  ): void;
  static deserializeBinary(bytes: Uint8Array): PairConfirm;
  static deserializeBinaryFromReader(
    message: PairConfirm,
    reader: jspb.BinaryReader
  ): PairConfirm;
}

declare namespace PairConfirm {
  export type AsObject = {
    peerid: Uint8Array | string;
    accepted: boolean;
  };
}

declare class PeerList extends jspb.Message {
  clearPeersList(): void;
  getPeersList(): Array<PeerInfo>;
  setPeersList(value: Array<PeerInfo>): void;
  addPeers(value?: PeerInfo, index?: number): PeerInfo;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): PeerList.AsObject;
  static toObject(includeInstance: boolean, msg: PeerList): PeerList.AsObject;
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
  static extensionsBinary: {
    [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
  };
  static serializeBinaryToWriter(
    message: PeerList,
    writer: jspb.BinaryWriter
  ): void;
  static deserializeBinary(bytes: Uint8Array): PeerList;
  static deserializeBinaryFromReader(
    message: PeerList,
    reader: jspb.BinaryReader
  ): PeerList;
}

declare namespace PeerList {
  export type AsObject = {
    peersList: Array<PeerInfo.AsObject>;
  };
}

declare class ConnectRequest extends jspb.Message {
  getPeerid(): Uint8Array | string;
  getPeerid_asU8(): Uint8Array;
  getPeerid_asB64(): string;
  setPeerid(value: Uint8Array | string): void;

  getSecrettoken(): Uint8Array | string;
  getSecrettoken_asU8(): Uint8Array;
  getSecrettoken_asB64(): string;
  setSecrettoken(value: Uint8Array | string): void;

  getIpaddress(): number;
  setIpaddress(value: number): void;

  getPort(): number;
  setPort(value: number): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ConnectRequest.AsObject;
  static toObject(
    includeInstance: boolean,
    msg: ConnectRequest
  ): ConnectRequest.AsObject;
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
  static extensionsBinary: {
    [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
  };
  static serializeBinaryToWriter(
    message: ConnectRequest,
    writer: jspb.BinaryWriter
  ): void;
  static deserializeBinary(bytes: Uint8Array): ConnectRequest;
  static deserializeBinaryFromReader(
    message: ConnectRequest,
    reader: jspb.BinaryReader
  ): ConnectRequest;
}

declare namespace ConnectRequest {
  export type AsObject = {
    peerid: Uint8Array | string;
    secrettoken: Uint8Array | string;
    ipaddress: number;
    port: number;
  };
}

declare class ConnectResponse extends jspb.Message {
  getStatus(): ConnectResponse.StatusMap[keyof ConnectResponse.StatusMap];
  setStatus(
    value: ConnectResponse.StatusMap[keyof ConnectResponse.StatusMap]
  ): void;

  getSecrettoken(): Uint8Array | string;
  getSecrettoken_asU8(): Uint8Array;
  getSecrettoken_asB64(): string;
  setSecrettoken(value: Uint8Array | string): void;

  getPort(): number;
  setPort(value: number): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ConnectResponse.AsObject;
  static toObject(
    includeInstance: boolean,
    msg: ConnectResponse
  ): ConnectResponse.AsObject;
  static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
  static extensionsBinary: {
    [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
  };
  static serializeBinaryToWriter(
    message: ConnectResponse,
    writer: jspb.BinaryWriter
  ): void;
  static deserializeBinary(bytes: Uint8Array): ConnectResponse;
  static deserializeBinaryFromReader(
    message: ConnectResponse,
    reader: jspb.BinaryReader
  ): ConnectResponse;
}

declare namespace ConnectResponse {
  export type AsObject = {
    status: ConnectResponse.StatusMap[keyof ConnectResponse.StatusMap];
    secrettoken: Uint8Array | string;
    port: number;
  };

  export interface StatusMap {
    OK: 0;
    NOT_PAIRED: 1;
    BAD_TOKEN: 2;
    CONNECT_FAILED: 3;
    INTERNAL_ERROR: 4;
  }

  export const Status: StatusMap;
}
