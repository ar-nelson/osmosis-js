// package: Osmosis
// file: src/osmosis.proto

import * as jspb from 'google-protobuf';

declare class Heartbeat extends jspb.Message {
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

  getPort(): number;
  setPort(value: number): void;

  getPublickey(): Uint8Array | string;
  getPublickey_asU8(): Uint8Array;
  getPublickey_asB64(): string;
  setPublickey(value: Uint8Array | string): void;

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
    appid: Uint8Array | string;
    peerid: Uint8Array | string;
    peername: string;
    port: number;
    publickey: Uint8Array | string;
  };
}
