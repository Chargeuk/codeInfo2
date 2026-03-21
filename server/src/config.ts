const readNonEmpty = (...values: Array<string | undefined>): string | undefined =>
  values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();

export const CODEINFO_CHAT_MCP_PORT = Number(
  readNonEmpty(process.env.CODEINFO_CHAT_MCP_PORT, process.env.CODEINFO_MCP_PORT) ??
    5011,
);
export const CODEINFO_MCP_PORT = CODEINFO_CHAT_MCP_PORT;
export const CODEINFO_AGENTS_MCP_PORT = Number(process.env.CODEINFO_AGENTS_MCP_PORT ?? 5012);
