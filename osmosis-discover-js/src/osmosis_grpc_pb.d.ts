// GENERATED CODE -- DO NOT EDIT!

// package: Osmosis
// file: src/osmosis.proto

import * as grpc from '@grpc/grpc-js';
import * as google_protobuf_empty_pb from 'google-protobuf/google/protobuf/empty_pb';
import * as src_osmosis_pb from '../src/osmosis_pb';

interface IGatewayService
  extends grpc.ServiceDefinition<grpc.UntypedServiceImplementation> {
  pair: grpc.MethodDefinition<
    src_osmosis_pb.PeerInfo,
    src_osmosis_pb.PairResponse
  >;
  confirmPair: grpc.MethodDefinition<
    src_osmosis_pb.PairConfirm,
    src_osmosis_pb.PairConfirm
  >;
  connect: grpc.MethodDefinition<
    src_osmosis_pb.ConnectRequest,
    src_osmosis_pb.ConnectResponse
  >;
}

declare const GatewayService: IGatewayService;

declare class GatewayClient extends grpc.Client {
  constructor(
    address: string,
    credentials: grpc.ChannelCredentials,
    options?: object
  );
  pair(
    argument: src_osmosis_pb.PeerInfo,
    callback: grpc.requestCallback<src_osmosis_pb.PairResponse>
  ): grpc.ClientUnaryCall;
  pair(
    argument: src_osmosis_pb.PeerInfo,
    metadataOrOptions: grpc.Metadata | grpc.CallOptions | null,
    callback: grpc.requestCallback<src_osmosis_pb.PairResponse>
  ): grpc.ClientUnaryCall;
  pair(
    argument: src_osmosis_pb.PeerInfo,
    metadata: grpc.Metadata | null,
    options: grpc.CallOptions | null,
    callback: grpc.requestCallback<src_osmosis_pb.PairResponse>
  ): grpc.ClientUnaryCall;
  confirmPair(
    argument: src_osmosis_pb.PairConfirm,
    callback: grpc.requestCallback<src_osmosis_pb.PairConfirm>
  ): grpc.ClientUnaryCall;
  confirmPair(
    argument: src_osmosis_pb.PairConfirm,
    metadataOrOptions: grpc.Metadata | grpc.CallOptions | null,
    callback: grpc.requestCallback<src_osmosis_pb.PairConfirm>
  ): grpc.ClientUnaryCall;
  confirmPair(
    argument: src_osmosis_pb.PairConfirm,
    metadata: grpc.Metadata | null,
    options: grpc.CallOptions | null,
    callback: grpc.requestCallback<src_osmosis_pb.PairConfirm>
  ): grpc.ClientUnaryCall;
  connect(
    argument: src_osmosis_pb.ConnectRequest,
    callback: grpc.requestCallback<src_osmosis_pb.ConnectResponse>
  ): grpc.ClientUnaryCall;
  connect(
    argument: src_osmosis_pb.ConnectRequest,
    metadataOrOptions: grpc.Metadata | grpc.CallOptions | null,
    callback: grpc.requestCallback<src_osmosis_pb.ConnectResponse>
  ): grpc.ClientUnaryCall;
  connect(
    argument: src_osmosis_pb.ConnectRequest,
    metadata: grpc.Metadata | null,
    options: grpc.CallOptions | null,
    callback: grpc.requestCallback<src_osmosis_pb.ConnectResponse>
  ): grpc.ClientUnaryCall;
}

interface IConnectionService
  extends grpc.ServiceDefinition<grpc.UntypedServiceImplementation> {
  sharePeers: grpc.MethodDefinition<
    src_osmosis_pb.PeerList,
    google_protobuf_empty_pb.Empty
  >;
  unpair: grpc.MethodDefinition<
    google_protobuf_empty_pb.Empty,
    google_protobuf_empty_pb.Empty
  >;
}

declare const ConnectionService: IConnectionService;

declare class ConnectionClient extends grpc.Client {
  constructor(
    address: string,
    credentials: grpc.ChannelCredentials,
    options?: object
  );
  sharePeers(
    argument: src_osmosis_pb.PeerList,
    callback: grpc.requestCallback<google_protobuf_empty_pb.Empty>
  ): grpc.ClientUnaryCall;
  sharePeers(
    argument: src_osmosis_pb.PeerList,
    metadataOrOptions: grpc.Metadata | grpc.CallOptions | null,
    callback: grpc.requestCallback<google_protobuf_empty_pb.Empty>
  ): grpc.ClientUnaryCall;
  sharePeers(
    argument: src_osmosis_pb.PeerList,
    metadata: grpc.Metadata | null,
    options: grpc.CallOptions | null,
    callback: grpc.requestCallback<google_protobuf_empty_pb.Empty>
  ): grpc.ClientUnaryCall;
  unpair(
    argument: google_protobuf_empty_pb.Empty,
    callback: grpc.requestCallback<google_protobuf_empty_pb.Empty>
  ): grpc.ClientUnaryCall;
  unpair(
    argument: google_protobuf_empty_pb.Empty,
    metadataOrOptions: grpc.Metadata | grpc.CallOptions | null,
    callback: grpc.requestCallback<google_protobuf_empty_pb.Empty>
  ): grpc.ClientUnaryCall;
  unpair(
    argument: google_protobuf_empty_pb.Empty,
    metadata: grpc.Metadata | null,
    options: grpc.CallOptions | null,
    callback: grpc.requestCallback<google_protobuf_empty_pb.Empty>
  ): grpc.ClientUnaryCall;
}
