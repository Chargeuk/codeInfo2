import { IncomingMessage, ServerResponse } from 'http';
import serverPackage from '../../package.json' with { type: 'json' };
import { append } from '../logStore.js';
import { dispatchJsonRpc } from '../mcpCommon/dispatch.js';
import { isObject } from '../mcpCommon/guards.js';
import { createKeepAliveController } from '../mcpCommon/keepAlive.js';
import {
  ArchivedConversationError,
  InvalidParamsError,
  ProviderUnavailableError,
  ReingestRepositoryToolError,
  ToolExecutionError,
  ToolNotFoundError,
  callTool,
  listTools,
} from './tools.js';
import {
  JsonRpcRequest,
  JsonRpcId,
  jsonRpcError,
  jsonRpcResult,
} from './types.js';

const INVALID_REQUEST_CODE = -32600;
const METHOD_NOT_FOUND_CODE = -32601;
const INVALID_PARAMS_CODE = -32602;
const PARSE_ERROR_CODE = -32700;
const PROTOCOL_VERSION = '2024-11-05';
const REINGEST_REPOSITORY_TOOL_NAME = 'reingest_repository';
const SERVER_INFO = {
  name: 'codeinfo2-mcp',
  version: serverPackage.version ?? '0.0.0',
};

export async function handleRpc(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
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
    surface: 'mcp2',
  });

  let message: JsonRpcRequest;
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
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        }),
      resourcesList: (requestId) => jsonRpcResult(requestId, { resources: [] }),
      resourcesListTemplates: (requestId) =>
        jsonRpcResult(requestId, { resource_templates: [] }),
      toolsList: async (requestId) => {
        const tools = await listTools();
        return jsonRpcResult(requestId, tools);
      },
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
          const result = await callTool(name, args);
          if (name === REINGEST_REPOSITORY_TOOL_NAME) {
            append({
              level: 'info',
              source: 'server',
              timestamp: new Date().toISOString(),
              message: 'DEV-0000035:T7:mcp2_reingest_tool_call_result',
              requestId: requestIdText,
              context: {
                tool: name,
                outcome: 'success',
                payload: result,
              },
            });
          }
          return jsonRpcResult(requestId, result);
        } catch (err) {
          if (err instanceof InvalidParamsError) {
            if (name === REINGEST_REPOSITORY_TOOL_NAME) {
              append({
                level: 'info',
                source: 'server',
                timestamp: new Date().toISOString(),
                message: 'DEV-0000035:T7:mcp2_reingest_tool_call_result',
                requestId: requestIdText,
                context: {
                  tool: name,
                  outcome: 'error',
                  code: INVALID_PARAMS_CODE,
                  message: err.message,
                  data: err.data,
                },
              });
            }
            return jsonRpcError(
              requestId,
              INVALID_PARAMS_CODE,
              err.message,
              err.data,
            );
          }

          if (err instanceof ReingestRepositoryToolError) {
            append({
              level: 'info',
              source: 'server',
              timestamp: new Date().toISOString(),
              message: 'DEV-0000035:T7:mcp2_reingest_tool_call_result',
              requestId: requestIdText,
              context: {
                tool: name,
                outcome: 'error',
                code: err.code,
                message: err.message,
                data: err.data,
              },
            });
            return jsonRpcError(requestId, err.code, err.message, err.data);
          }

          if (err instanceof ArchivedConversationError) {
            return jsonRpcError(requestId, err.code, err.message);
          }

          if (err instanceof ProviderUnavailableError) {
            return jsonRpcError(requestId, err.code, err.message);
          }

          if (err instanceof ToolExecutionError) {
            return jsonRpcError(requestId, err.code, err.message, err.data);
          }

          if (err instanceof ToolNotFoundError) {
            return jsonRpcError(requestId, METHOD_NOT_FOUND_CODE, err.message);
          }

          return jsonRpcError(
            requestId,
            METHOD_NOT_FOUND_CODE,
            'Method not found',
          );
        }
      },
    },
  });

  keepAlive.sendJson(response);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(chunk);
    }
  }

  return Buffer.concat(chunks).toString();
}

function isValidRequest(
  message: unknown,
): message is { jsonrpc: '2.0'; method: string; params?: unknown } {
  if (!isObject(message)) return false;
  return message.jsonrpc === '2.0' && typeof message.method === 'string';
}
