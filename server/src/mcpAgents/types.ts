export type JsonRpcId = string | number | null;

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export interface JsonRpcSuccessResponse<Result = unknown> {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: Result;
}

export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

export function jsonRpcResult<Result = unknown>(
  id: JsonRpcId,
  result: Result,
): JsonRpcSuccessResponse<Result> {
  return { jsonrpc: '2.0', id, result };
}
