// GENERATED CODE -- DO NOT EDIT!

'use strict';
var grpc = require('@grpc/grpc-js');
var src_osmosis_pb = require('../src/osmosis_pb.js');
var google_protobuf_empty_pb = require('google-protobuf/google/protobuf/empty_pb.js');

function serialize_Osmosis_ConnectRequest(arg) {
  if (!(arg instanceof src_osmosis_pb.ConnectRequest)) {
    throw new Error('Expected argument of type Osmosis.ConnectRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_Osmosis_ConnectRequest(buffer_arg) {
  return src_osmosis_pb.ConnectRequest.deserializeBinary(
    new Uint8Array(buffer_arg)
  );
}

function serialize_Osmosis_ConnectResponse(arg) {
  if (!(arg instanceof src_osmosis_pb.ConnectResponse)) {
    throw new Error('Expected argument of type Osmosis.ConnectResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_Osmosis_ConnectResponse(buffer_arg) {
  return src_osmosis_pb.ConnectResponse.deserializeBinary(
    new Uint8Array(buffer_arg)
  );
}

function serialize_Osmosis_PairConfirm(arg) {
  if (!(arg instanceof src_osmosis_pb.PairConfirm)) {
    throw new Error('Expected argument of type Osmosis.PairConfirm');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_Osmosis_PairConfirm(buffer_arg) {
  return src_osmosis_pb.PairConfirm.deserializeBinary(
    new Uint8Array(buffer_arg)
  );
}

function serialize_Osmosis_PairResponse(arg) {
  if (!(arg instanceof src_osmosis_pb.PairResponse)) {
    throw new Error('Expected argument of type Osmosis.PairResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_Osmosis_PairResponse(buffer_arg) {
  return src_osmosis_pb.PairResponse.deserializeBinary(
    new Uint8Array(buffer_arg)
  );
}

function serialize_Osmosis_PeerInfo(arg) {
  if (!(arg instanceof src_osmosis_pb.PeerInfo)) {
    throw new Error('Expected argument of type Osmosis.PeerInfo');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_Osmosis_PeerInfo(buffer_arg) {
  return src_osmosis_pb.PeerInfo.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_Osmosis_PeerList(arg) {
  if (!(arg instanceof src_osmosis_pb.PeerList)) {
    throw new Error('Expected argument of type Osmosis.PeerList');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_Osmosis_PeerList(buffer_arg) {
  return src_osmosis_pb.PeerList.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_google_protobuf_Empty(arg) {
  if (!(arg instanceof google_protobuf_empty_pb.Empty)) {
    throw new Error('Expected argument of type google.protobuf.Empty');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_google_protobuf_Empty(buffer_arg) {
  return google_protobuf_empty_pb.Empty.deserializeBinary(
    new Uint8Array(buffer_arg)
  );
}

var GatewayService = (exports.GatewayService = {
  pair: {
    path: '/Osmosis.Gateway/Pair',
    requestStream: false,
    responseStream: false,
    requestType: src_osmosis_pb.PeerInfo,
    responseType: src_osmosis_pb.PairResponse,
    requestSerialize: serialize_Osmosis_PeerInfo,
    requestDeserialize: deserialize_Osmosis_PeerInfo,
    responseSerialize: serialize_Osmosis_PairResponse,
    responseDeserialize: deserialize_Osmosis_PairResponse,
  },
  confirmPair: {
    path: '/Osmosis.Gateway/ConfirmPair',
    requestStream: false,
    responseStream: false,
    requestType: src_osmosis_pb.PairConfirm,
    responseType: src_osmosis_pb.PairConfirm,
    requestSerialize: serialize_Osmosis_PairConfirm,
    requestDeserialize: deserialize_Osmosis_PairConfirm,
    responseSerialize: serialize_Osmosis_PairConfirm,
    responseDeserialize: deserialize_Osmosis_PairConfirm,
  },
  connect: {
    path: '/Osmosis.Gateway/Connect',
    requestStream: false,
    responseStream: false,
    requestType: src_osmosis_pb.ConnectRequest,
    responseType: src_osmosis_pb.ConnectResponse,
    requestSerialize: serialize_Osmosis_ConnectRequest,
    requestDeserialize: deserialize_Osmosis_ConnectRequest,
    responseSerialize: serialize_Osmosis_ConnectResponse,
    responseDeserialize: deserialize_Osmosis_ConnectResponse,
  },
});

exports.GatewayClient = grpc.makeGenericClientConstructor(GatewayService);
var ConnectionService = (exports.ConnectionService = {
  sharePeers: {
    path: '/Osmosis.Connection/SharePeers',
    requestStream: false,
    responseStream: false,
    requestType: src_osmosis_pb.PeerList,
    responseType: google_protobuf_empty_pb.Empty,
    requestSerialize: serialize_Osmosis_PeerList,
    requestDeserialize: deserialize_Osmosis_PeerList,
    responseSerialize: serialize_google_protobuf_Empty,
    responseDeserialize: deserialize_google_protobuf_Empty,
  },
  unpair: {
    path: '/Osmosis.Connection/Unpair',
    requestStream: false,
    responseStream: false,
    requestType: google_protobuf_empty_pb.Empty,
    responseType: google_protobuf_empty_pb.Empty,
    requestSerialize: serialize_google_protobuf_Empty,
    requestDeserialize: deserialize_google_protobuf_Empty,
    responseSerialize: serialize_google_protobuf_Empty,
    responseDeserialize: deserialize_google_protobuf_Empty,
  },
});

exports.ConnectionClient = grpc.makeGenericClientConstructor(ConnectionService);
