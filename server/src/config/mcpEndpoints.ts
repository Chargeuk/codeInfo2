import { append } from '../logStore.js';

import { resolveServerPort } from './serverPort.js';

const CODEINFO_ENV_PLACEHOLDER_PATTERN = /\$\{([A-Z0-9_]+)\}/g;
const DIRECT_PLACEHOLDER_KEYS = new Set(['CODEINFO_PLAYWRIGHT_MCP_URL']);
const REQUIRED_ENDPOINT_PLACEHOLDERS = new Set([
  'CODEINFO_SERVER_PORT',
  'CODEINFO_CHAT_MCP_PORT',
  'CODEINFO_AGENTS_MCP_PORT',
  'CODEINFO_PLAYWRIGHT_MCP_URL',
]);
const DEV_0000050_T06_MCP_ENDPOINTS_NORMALIZED =
  'DEV-0000050:T06:mcp_endpoints_normalized';

export type CodeinfoMcpEndpointContract = {
  serverPort: string;
  chatMcpPort: string;
  agentsMcpPort: string;
  classicMcpUrl: string;
  chatMcpUrl: string;
  agentsMcpUrl: string;
  playwrightMcpUrl: string | null;
  placeholderFree: boolean;
};

const readNonEmpty = (
  ...values: Array<string | undefined>
): string | undefined =>
  values
    .find((value) => typeof value === 'string' && value.trim().length > 0)
    ?.trim();

const buildLocalMcpUrl = (port: string) => `http://localhost:${port}/mcp`;

const findUnresolvedRequiredPlaceholder = (
  value: string,
): string | undefined => {
  const direct = value.trim();
  if (DIRECT_PLACEHOLDER_KEYS.has(direct)) {
    return direct;
  }

  for (const match of value.matchAll(CODEINFO_ENV_PLACEHOLDER_PATTERN)) {
    const key = match[1];
    if (key && REQUIRED_ENDPOINT_PLACEHOLDERS.has(key)) {
      return key;
    }
  }

  return undefined;
};

const assertPlaceholderFreeValue = (params: {
  label: string;
  value: string;
}) => {
  const unresolved = findUnresolvedRequiredPlaceholder(params.value);
  if (!unresolved) {
    return params.value;
  }

  throw new Error(
    `RUNTIME_CONFIG_INVALID: Unresolved required MCP placeholder ${unresolved} in ${params.label}`,
  );
};

const isPlaceholderFree = (value: string | null): boolean =>
  value === null || findUnresolvedRequiredPlaceholder(value) === undefined;

export function resolveCodeinfoChatMcpPort(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return assertPlaceholderFreeValue({
    label: 'CODEINFO_CHAT_MCP_PORT',
    value: readNonEmpty(env.CODEINFO_CHAT_MCP_PORT) ?? '5011',
  });
}

export function resolveCodeinfoAgentsMcpPort(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return assertPlaceholderFreeValue({
    label: 'CODEINFO_AGENTS_MCP_PORT',
    value: readNonEmpty(env.CODEINFO_AGENTS_MCP_PORT) ?? '5012',
  });
}

export function resolveOptionalCodeinfoPlaywrightMcpUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = readNonEmpty(env.CODEINFO_PLAYWRIGHT_MCP_URL);
  if (!value) {
    return undefined;
  }
  return assertPlaceholderFreeValue({
    label: 'CODEINFO_PLAYWRIGHT_MCP_URL',
    value,
  });
}

export function resolveRequiredCodeinfoPlaceholderValue(
  placeholder: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  switch (placeholder) {
    case 'CODEINFO_SERVER_PORT':
      return assertPlaceholderFreeValue({
        label: 'CODEINFO_SERVER_PORT',
        value: resolveServerPort(env),
      });
    case 'CODEINFO_CHAT_MCP_PORT':
      return resolveCodeinfoChatMcpPort(env);
    case 'CODEINFO_AGENTS_MCP_PORT':
      return resolveCodeinfoAgentsMcpPort(env);
    case 'CODEINFO_PLAYWRIGHT_MCP_URL': {
      const value = resolveOptionalCodeinfoPlaywrightMcpUrl(env);
      if (!value) {
        throw new Error(
          'RUNTIME_CONFIG_INVALID: Unresolved required MCP placeholder CODEINFO_PLAYWRIGHT_MCP_URL',
        );
      }
      return value;
    }
    default:
      return placeholder;
  }
}

let lastLoggedSignature: string | null = null;

export function resolveCodeinfoMcpEndpointContract(
  env: NodeJS.ProcessEnv = process.env,
): CodeinfoMcpEndpointContract {
  const serverPort = resolveRequiredCodeinfoPlaceholderValue(
    'CODEINFO_SERVER_PORT',
    env,
  );
  const chatMcpPort = resolveRequiredCodeinfoPlaceholderValue(
    'CODEINFO_CHAT_MCP_PORT',
    env,
  );
  const agentsMcpPort = resolveRequiredCodeinfoPlaceholderValue(
    'CODEINFO_AGENTS_MCP_PORT',
    env,
  );
  const playwrightMcpUrl = resolveOptionalCodeinfoPlaywrightMcpUrl(env) ?? null;

  const contract: CodeinfoMcpEndpointContract = {
    serverPort,
    chatMcpPort,
    agentsMcpPort,
    classicMcpUrl: buildLocalMcpUrl(serverPort),
    chatMcpUrl: buildLocalMcpUrl(chatMcpPort),
    agentsMcpUrl: buildLocalMcpUrl(agentsMcpPort),
    playwrightMcpUrl,
    placeholderFree:
      isPlaceholderFree(buildLocalMcpUrl(serverPort)) &&
      isPlaceholderFree(buildLocalMcpUrl(chatMcpPort)) &&
      isPlaceholderFree(buildLocalMcpUrl(agentsMcpPort)) &&
      isPlaceholderFree(playwrightMcpUrl),
  };

  const signature = JSON.stringify(contract);
  if (signature !== lastLoggedSignature) {
    lastLoggedSignature = signature;
    append({
      level: 'info',
      message: DEV_0000050_T06_MCP_ENDPOINTS_NORMALIZED,
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        classicMcpUrl: contract.classicMcpUrl,
        chatMcpUrl: contract.chatMcpUrl,
        agentsMcpUrl: contract.agentsMcpUrl,
        playwrightMcpUrl: contract.playwrightMcpUrl,
        placeholderFree: contract.placeholderFree,
      },
    });
  }

  return contract;
}

export function __resetMcpEndpointLoggingForTests() {
  lastLoggedSignature = null;
}
