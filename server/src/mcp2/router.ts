import { IncomingMessage, ServerResponse } from 'http';
import { isCodexAvailable } from './codexAvailability.js';
import {
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

export async function handleRpc(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const send = (payload: unknown) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  let message: JsonRpcRequest;
  try {
    message = JSON.parse(body || '{}');
  } catch {
    send(jsonRpcError(null, PARSE_ERROR_CODE, 'Parse error'));
    return;
  }

  const id: JsonRpcId = message.id ?? null;

  if (!isValidRequest(message)) {
    send(jsonRpcError(id, INVALID_REQUEST_CODE, 'Invalid Request'));
    return;
  }

  const method = message.method;

  if (method === 'initialize') {
    send(jsonRpcResult(id, { capabilities: {} }));
    return;
  }

  if (method === 'resources/list') {
    send(jsonRpcResult(id, { resources: [] }));
    return;
  }

  if (method === 'resources/listTemplates') {
    send(jsonRpcResult(id, { resource_templates: [] }));
    return;
  }

  if (method === 'tools/list') {
    if (!(await isCodexAvailable())) {
      send(
        jsonRpcError(
          id,
          CODE_INFO_LLM_UNAVAILABLE,
          'CODE_INFO_LLM_UNAVAILABLE',
        ),
      );
      return;
    }

    const tools = await listTools();
    send(jsonRpcResult(id, tools));
    return;
  }

  if (method === 'tools/call') {
    if (!(await isCodexAvailable())) {
      send(
        jsonRpcError(
          id,
          CODE_INFO_LLM_UNAVAILABLE,
          'CODE_INFO_LLM_UNAVAILABLE',
        ),
      );
      return;
    }

    const params = isObject(message.params) ? message.params : {};
    const name = params.name;
    const args = params.arguments;

    if (typeof name !== 'string') {
      send(jsonRpcError(id, INVALID_PARAMS_CODE, 'Invalid tool name'));
      return;
    }

    try {
      const result = await callTool(name, args);
      send(jsonRpcResult(id, result));
      return;
    } catch (err) {
      if (err instanceof InvalidParamsError) {
        send(jsonRpcError(id, INVALID_PARAMS_CODE, err.message, err.data));
        return;
      }

      if (err instanceof ToolNotFoundError) {
        send(jsonRpcError(id, METHOD_NOT_FOUND_CODE, err.message));
        return;
      }

      send(jsonRpcError(id, METHOD_NOT_FOUND_CODE, 'Method not found'));
      return;
    }
  }

  send(jsonRpcError(id, METHOD_NOT_FOUND_CODE, 'Method not found'));
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

function isValidRequest(message: JsonRpcRequest) {
  return message.jsonrpc === '2.0' && typeof message.method === 'string';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
