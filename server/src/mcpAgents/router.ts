import { IncomingMessage, ServerResponse } from 'http';
import serverPackage from '../../package.json' with { type: 'json' };
import { dispatchJsonRpc } from '../mcpCommon/dispatch.js';
import { isObject } from '../mcpCommon/guards.js';
import { createKeepAliveController } from '../mcpCommon/keepAlive.js';
import { isCodexCliAvailable } from './codexAvailability.js';
import { CodexUnavailableError } from './errors.js';
import {
  ArchivedConversationError,
  InvalidParamsError,
  RunInProgressError,
  ToolNotFoundError,
  callTool,
  listTools,
  RUN_AGENT_INSTRUCTION_TOOL_NAME,
  RUN_COMMAND_TOOL_NAME,
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
  name: 'codeinfo2-agents-mcp',
  version: serverPackage.version ?? '0.0.0',
};

export async function handleAgentsRpc(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const body = await readBody(req);

  const controller = new AbortController();
  const handleDisconnect = () => {
    if (controller.signal.aborted) return;
    controller.abort();
  };
  req.on('aborted', handleDisconnect);
  res.on('close', () => {
    if (res.writableEnded) return;
    handleDisconnect();
  });
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
    surface: 'mcp_agents',
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

        if (typeof name !== 'string') {
          return jsonRpcError(
            requestId,
            INVALID_PARAMS_CODE,
            'Invalid tool name',
          );
        }

        if (
          (name === RUN_AGENT_INSTRUCTION_TOOL_NAME ||
            name === RUN_COMMAND_TOOL_NAME) &&
          !(await isCodexCliAvailable())
        ) {
          return jsonRpcError(
            requestId,
            CODE_INFO_LLM_UNAVAILABLE,
            'CODE_INFO_LLM_UNAVAILABLE',
          );
        }

        try {
          const result = await callTool(name, args, {
            signal: controller.signal,
          });
          return jsonRpcResult(requestId, result);
        } catch (err) {
          if (err instanceof CodexUnavailableError) {
            return jsonRpcError(
              requestId,
              CODE_INFO_LLM_UNAVAILABLE,
              'CODE_INFO_LLM_UNAVAILABLE',
              err.reason ? { reason: err.reason } : undefined,
            );
          }

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
