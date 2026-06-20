import {
  resolveCodeinfoAgentsMcpPort,
  resolveCodeinfoChatMcpPort,
  resolveCodeinfoWebMcpPort,
} from './config/mcpEndpoints.js';

export const CODEINFO_CHAT_MCP_PORT = Number(resolveCodeinfoChatMcpPort());
export const CODEINFO_MCP_PORT = CODEINFO_CHAT_MCP_PORT;
export const CODEINFO_AGENTS_MCP_PORT = Number(resolveCodeinfoAgentsMcpPort());
export const CODEINFO_WEB_MCP_PORT = Number(resolveCodeinfoWebMcpPort());
