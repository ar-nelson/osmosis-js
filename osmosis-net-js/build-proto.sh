PROTOC_GEN_TS_PATH="./node_modules/.bin/protoc-gen-ts"

protoc \
  --plugin=protoc-gen-ts=$PROTOC_GEN_TS_PATH \
  --js_out=import_style=commonjs,binary:. \
  --ts_out=. \
  ./src/osmosis.proto

sed -i 's/^export/declare/g' ./src/osmosis_pb.d.ts
npx prettier -w ./src/osmosis_pb.js ./src/osmosis_pb.d.ts
