import { IncomingMessage, ServerResponse } from 'http';
import { append } from '../logStore.js';
import type {
  ArchivedConversationError,
  InvalidParamsError,
  ProviderUnavailableError,
  ToolExecutionError,
  ToolNotFoundError,
} from '../mcp2/errors.js';
import { jsonRpcError, jsonRpcResult, type JsonRpcId } from '../mcp2/types.js';
import { dispatchJsonRpc } from './dispatch.js';
import { isObject } from './guards.js';
import { createKeepAliveController } from './keepAlive.js';

const INVALID_REQUEST_CODE = -32600;
const METHOD_NOT_FOUND_CODE = -32601;
const INVALID_PARAMS_CODE = -32602;
const INTERNAL_ERROR_CODE = -32603;
const PARSE_ERROR_CODE = -32700;
const MAX_RPC_BODY_BYTES = 256 * 1024;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super(`Request body exceeded ${MAX_RPC_BODY_BYTES} bytes`);
    this.name = 'RequestBodyTooLargeError';
  }
}

export type JsonRpcRequestLike = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type ToolRouterDeps = {
  InvalidParamsError: typeof InvalidParamsError;
  ArchivedConversationError: typeof ArchivedConversationError;
  ProviderUnavailableError: typeof ProviderUnavailableError;
  ToolExecutionError: typeof ToolExecutionError;
  ToolNotFoundError: typeof ToolNotFoundError;
};

export type ToolRouterRegistry = {
  listTools: () => Promise<unknown>;
  callTool: (name: string, args?: unknown) => Promise<unknown>;
};

export type CreateMcpRouterOptions = {
  surface: string;
  serverInfo: {
    name: string;
    version: string;
  };
  tools: ToolRouterRegistry;
  errors: ToolRouterDeps;
  protocolVersion?: string;
  onToolSuccess?: (params: {
    name: string;
    requestIdText?: string;
    result: unknown;
  }) => void;
  /**
   * Return true when the callback has handled its own logging/side effects and
   * the router should suppress normal error mapping and emit a generic internal
   * error response instead of tool-specific details.
   */
  onToolError?: (params: {
    name: string;
    requestIdText?: string;
    error: unknown;
  }) => boolean;
  mapToolError?: (params: {
    error: unknown;
    requestId: JsonRpcId;
    name: string;
    requestIdText?: string;
  }) => unknown | undefined;
};

function logHookFailure(params: {
  surface: string;
  hook: 'onToolSuccess' | 'onToolError' | 'mapToolError';
  tool: string;
  requestIdText?: string;
  error: unknown;
}) {
  append({
    level: 'error',
    source: 'server',
    timestamp: new Date().toISOString(),
    message: `${params.surface}_router_hook_error`,
    requestId: params.requestIdText,
    context: {
      hook: params.hook,
      tool: params.tool,
      error:
        params.error instanceof Error
          ? (params.error.stack ?? params.error.message)
          : String(params.error),
    },
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.length;
    if (totalBytes > MAX_RPC_BODY_BYTES) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString();
}

function isValidRequest(message: unknown): message is JsonRpcRequestLike {
  if (!isObject(message)) return false;
  return message.jsonrpc === '2.0' && typeof message.method === 'string';
}

export function createMcpRouter(options: CreateMcpRouterOptions) {
  const {
    surface,
    serverInfo,
    tools,
    errors,
    protocolVersion = '2024-11-05',
    onToolSuccess,
    onToolError,
    mapToolError,
  } = options;

  return async function handleRpc(req: IncomingMessage, res: ServerResponse) {
    let body = '';
    try {
      body = await readBody(req);
    } catch (error) {
      const payload =
        error instanceof RequestBodyTooLargeError
          ? jsonRpcError(null, INVALID_REQUEST_CODE, 'Request body too large')
          : jsonRpcError(null, PARSE_ERROR_CODE, 'Parse error');
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(payload));
      return;
    }
    const writeHeadersIfNeeded = () => {
      if (res.headersSent) return;
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
      });
      res.flushHeaders?.();
    };
    const keepAlive = createKeepAliveController({
      res,
      writeHeadersIfNeeded,
      surface,
    });

    let message: JsonRpcRequestLike;
    try {
      message = JSON.parse(body || '{}');
    } catch {
      keepAlive.sendJson(jsonRpcError(null, PARSE_ERROR_CODE, 'Parse error'));
      return;
    }

    const id: JsonRpcId = (message as { id?: JsonRpcId } | null)?.id ?? null;

    if (isValidRequest(message) && message.method === 'tools/call') {
      keepAlive.start();
    }

    const response = await dispatchJsonRpc<JsonRpcId, unknown>({
      message,
      getId: () => id,
      validateRequest: isValidRequest,
      handlers: {
        invalidRequest: (requestId) =>
          jsonRpcError(requestId, INVALID_REQUEST_CODE, 'Invalid Request'),
        methodNotFound: (requestId) =>
          jsonRpcError(requestId, METHOD_NOT_FOUND_CODE, 'Method not found'),
        initialize: (requestId) =>
          jsonRpcResult(requestId, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo,
          }),
        resourcesList: (requestId) => jsonRpcResult(requestId, { resources: [] }),
        resourcesListTemplates: (requestId) =>
          jsonRpcResult(requestId, { resourceTemplates: [] }),
        toolsList: async (requestId) =>
          jsonRpcResult(requestId, await tools.listTools()),
        toolsCall: async (requestId, paramsUnknown) => {
          const params = isObject(paramsUnknown) ? paramsUnknown : {};
          const name = params.name;
          const args = params.arguments;
          const requestIdText =
            requestId === null || requestId === undefined
              ? undefined
              : String(requestId);

          if (typeof name !== 'string') {
            return jsonRpcError(
              requestId,
              INVALID_PARAMS_CODE,
              'Invalid tool name',
            );
          }

          try {
            const result = await tools.callTool(name, args);
            if (onToolSuccess) {
              try {
                onToolSuccess({ name, requestIdText, result });
              } catch (hookError) {
                logHookFailure({
                  surface,
                  hook: 'onToolSuccess',
                  tool: name,
                  requestIdText,
                  error: hookError,
                });
              }
            }
            return jsonRpcResult(requestId, result);
          } catch (err) {
            append({
              level: 'error',
              source: 'server',
              timestamp: new Date().toISOString(),
              message: `${surface}_tools_call_error`,
              requestId: requestIdText,
              context: {
                tool: name,
                error:
                  err instanceof Error ? (err.stack ?? err.message) : String(err),
              },
            });

            let handled = false;
            if (onToolError) {
              try {
                handled = onToolError({ name, requestIdText, error: err });
              } catch (hookError) {
                logHookFailure({
                  surface,
                  hook: 'onToolError',
                  tool: name,
                  requestIdText,
                  error: hookError,
                });
              }
            }
            if (handled) {
              return jsonRpcError(requestId, INTERNAL_ERROR_CODE, 'Internal error');
            }

            let mappedError: unknown | undefined;
            if (mapToolError) {
              try {
                mappedError = mapToolError({
                  error: err,
                  requestId,
                  name,
                  requestIdText,
                });
              } catch (hookError) {
                logHookFailure({
                  surface,
                  hook: 'mapToolError',
                  tool: name,
                  requestIdText,
                  error: hookError,
                });
              }
            }
            if (mappedError !== undefined) {
              return mappedError;
            }

            if (err instanceof errors.InvalidParamsError) {
              return jsonRpcError(
                requestId,
                INVALID_PARAMS_CODE,
                err.message,
                err.data,
              );
            }

            if (err instanceof errors.ArchivedConversationError) {
              return jsonRpcError(requestId, err.code, err.message);
            }

            if (err instanceof errors.ProviderUnavailableError) {
              return jsonRpcError(requestId, err.code, err.message);
            }

            if (err instanceof errors.ToolExecutionError) {
              return jsonRpcError(requestId, err.code, err.message, err.data);
            }

            if (err instanceof errors.ToolNotFoundError) {
              return jsonRpcError(requestId, METHOD_NOT_FOUND_CODE, err.message);
            }

            return jsonRpcError(
              requestId,
              INTERNAL_ERROR_CODE,
              'Internal error',
            );
          }
        },
      },
    });

    keepAlive.sendJson(response);
  };
}
