import isPlainObject from 'lodash.isplainobject';

export const CODE_PARSE_ERROR = -32700;
export const CODE_INVALID_REQUEST = -32600;
export const CODE_METHOD_NOT_FOUND = -32601;
export const CODE_INVALID_PARAMS = -32602;
export const CODE_INTERNAL_ERROR = -32603;

export const CODE_DECRYPTION_ERROR = -32000;
export const CODE_DECOMPRESSION_ERROR = -32001;
export const CODE_COMPRESSION_NOT_ALLOWED = -32002;
export const CODE_MESSAGE_TOO_LARGE = -32003;
export const CODE_TIMEOUT = -32004;
export const CODE_CLOSED = -32005;

export type Structural = any[] | { [key: string]: any };

export interface JsonRpcCall {
  jsonrpc: '2.0';
  method: string;
  params?: Structural;
  id?: string | number;
}

export interface JsonRpcResult {
  jsonrpc: '2.0';
  result: any;
  id: string | number | null;
}

export interface JsonRpcErrorResult {
  jsonrpc: '2.0';
  error: JsonRpcError;
  id: string | number | null;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

export type JsonRpc = JsonRpcCall | JsonRpcResult | JsonRpcErrorResult;

export function isJsonRpc(value: any): value is JsonRpc {
  return (
    isPlainObject(value) &&
    value.jsonrpc === '2.0' &&
    ('method' in value || 'result' in value || isPlainObject(value.error))
  );
}
