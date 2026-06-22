import serverPackage from '../../package.json' with { type: 'json' };
import { append } from '../logStore.js';
import { createMcpRouter } from '../mcpCommon/routerFactory.js';
import { CODEBASE_QUESTION_TOOL_NAME } from './tools/codebaseQuestion.js';
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
import { jsonRpcError } from './types.js';

const REINGEST_REPOSITORY_TOOL_NAME = 'reingest_repository';
const SERVER_INFO = {
  name: 'codeinfo2-mcp',
  version: serverPackage.version ?? '0.0.0',
};

export const handleRpc = createMcpRouter({
  surface: 'mcp2',
  serverInfo: SERVER_INFO,
  tools: { listTools, callTool },
  errors: {
    InvalidParamsError,
    ArchivedConversationError,
    ProviderUnavailableError,
    ToolExecutionError,
    ToolNotFoundError,
  },
  onToolSuccess: ({ name, requestIdText, result }) => {
    if (name !== REINGEST_REPOSITORY_TOOL_NAME) {
      return;
    }
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
  },
  onToolError: ({ name, requestIdText, error }) => {
    if (name === CODEBASE_QUESTION_TOOL_NAME) {
      append({
        level: 'error',
        source: 'server',
        timestamp: new Date().toISOString(),
        message: 'DEV-0000053:T3:mcp2_codebase_question_tool_error',
        requestId: requestIdText,
        context: {
          tool: name,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorCode:
            typeof (error as { code?: unknown } | null)?.code === 'number'
              ? (error as { code: number }).code
              : null,
          hasErrorData:
            ((error as { data?: unknown } | null)?.data ?? undefined) !==
            undefined,
        },
      });
    }
    if (name === REINGEST_REPOSITORY_TOOL_NAME) {
      if (error instanceof InvalidParamsError) {
        append({
          level: 'info',
          source: 'server',
          timestamp: new Date().toISOString(),
          message: 'DEV-0000035:T7:mcp2_reingest_tool_call_result',
          requestId: requestIdText,
          context: {
            tool: name,
            outcome: 'error',
            code: -32602,
            message: error.message,
            data: error.data,
          },
        });
      } else if (error instanceof ReingestRepositoryToolError) {
        append({
          level: 'info',
          source: 'server',
          timestamp: new Date().toISOString(),
          message: 'DEV-0000035:T7:mcp2_reingest_tool_call_result',
          requestId: requestIdText,
          context: {
            tool: name,
            outcome: 'error',
            code: error.code,
            message: error.message,
            data: error.data,
          },
        });
      }
    }
    return false;
  },
  mapToolError: ({ error, requestId }) => {
    if (error instanceof ReingestRepositoryToolError) {
      return jsonRpcError(requestId, error.code, error.message, error.data);
    }
    return undefined;
  },
});
