PROTOC_GEN_TS_PATH="./node_modules/.bin/protoc-gen-ts"
PROTOC_GEN_GRPC_PATH="./node_modules/grpc-tools/bin/grpc_node_plugin"

protoc \
  --plugin=protoc-gen-ts=$PROTOC_GEN_TS_PATH \
  --plugin=protoc-gen-grpc=$PROTOC_GEN_GRPC_PATH \
  --js_out=import_style=commonjs,binary:. \
  --ts_out=. \
  --grpc_out=. \
  ./src/osmosis.proto

sed -i 's/^export/declare/g' ./src/osmosis_pb.d.ts
npx prettier -w ./src/osmosis_pb.js ./src/osmosis_pb.d.ts ./src/osmosis_grpc_pb.js
