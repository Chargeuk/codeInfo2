import serverPackage from '../../package.json' with { type: 'json' };
import { ArchivedConversationError } from '../mcp2/errors.js';
import { createMcpRouter } from '../mcpCommon/routerFactory.js';
import {
  callWebTool,
  InvalidParamsError,
  listWebTools,
  ProviderUnavailableError,
  ToolExecutionError,
  ToolNotFoundError,
} from './tools.js';

export const handleWebRpc = createMcpRouter({
  surface: 'mcpWeb',
  serverInfo: {
    name: 'codeinfo2-web-mcp',
    version: serverPackage.version ?? '0.0.0',
  },
  tools: {
    listTools: listWebTools,
    callTool: callWebTool,
  },
  errors: {
    InvalidParamsError,
    ArchivedConversationError,
    ProviderUnavailableError,
    ToolExecutionError,
    ToolNotFoundError,
  },
});
