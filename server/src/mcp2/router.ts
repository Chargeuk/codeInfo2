import { IncomingMessage, ServerResponse } from 'http';
import serverPackage from '../../package.json' with { type: 'json' };
import { dispatchJsonRpc } from '../mcpCommon/dispatch.js';
import { isObject } from '../mcpCommon/guards.js';
import { isCodexAvailable } from './codexAvailability.js';
import { RunInProgressError } from './errors.js';
import {
  ArchivedConversationError,
  InvalidParamsError,
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
const CODE_INFO_LLM_UNAVAILABLE = -32001;
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'codeinfo2-mcp',
  version: serverPackage.version ?? '0.0.0',
};

export async function handleRpc(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const send = (payload: unknown) => {
    const maybeError =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      (payload as { error?: unknown }).error &&
      typeof (payload as { error?: { code?: unknown } }).error?.code ===
        'number'
        ? ((payload as { error: { code: number } }).error.code as number)
        : null;
    const status =
      typeof maybeError === 'number' && maybeError >= 400 && maybeError <= 599
        ? maybeError
        : 200;

    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  let message: JsonRpcRequest;
  try {
    message = JSON.parse(body || '{}');
  } catch {
    send(jsonRpcError(null, PARSE_ERROR_CODE, 'Parse error'));
    return;
  }

  const id: JsonRpcId = (message as { id?: JsonRpcId } | null)?.id ?? null;

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
        if (!(await isCodexAvailable())) {
          return jsonRpcError(
            requestId,
            CODE_INFO_LLM_UNAVAILABLE,
            'CODE_INFO_LLM_UNAVAILABLE',
          );
        }

        const tools = await listTools();
        return jsonRpcResult(requestId, tools);
      },
      toolsCall: async (requestId, paramsUnknown) => {
        if (!(await isCodexAvailable())) {
          return jsonRpcError(
            requestId,
            CODE_INFO_LLM_UNAVAILABLE,
            'CODE_INFO_LLM_UNAVAILABLE',
          );
        }

        const params = isObject(paramsUnknown) ? paramsUnknown : {};
        const name = params.name;
        const args = params.arguments;

        if (typeof name !== 'string') {
          return jsonRpcError(
            requestId,
            INVALID_PARAMS_CODE,
            'Invalid tool name',
          );
        }

        try {
          const result = await callTool(name, args);
          return jsonRpcResult(requestId, result);
        } catch (err) {
          if (err instanceof InvalidParamsError) {
            return jsonRpcError(
              requestId,
              INVALID_PARAMS_CODE,
              err.message,
              err.data,
            );
          }

          if (err instanceof ArchivedConversationError) {
            return jsonRpcError(requestId, err.code, err.message);
          }

          if (err instanceof RunInProgressError) {
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

  send(response);
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
