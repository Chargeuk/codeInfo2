import type { ChatProviderId } from '@codeinfo2/common';
import { resolveRequiredCodeinfoPlaceholderValue } from './mcpEndpoints.js';

export type WebSearchMode = 'live' | 'cached' | 'disabled';

type RuntimeRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is RuntimeRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeMode = (value: unknown): WebSearchMode | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'live' ||
    normalized === 'cached' ||
    normalized === 'disabled'
  ) {
    return normalized;
  }
  return undefined;
};

const resolveLegacyAliasMode = (features: unknown): WebSearchMode | undefined => {
  if (!isRecord(features)) {
    return undefined;
  }
  if (features.web_search_request === true) {
    return 'live';
  }
  if (features.web_search_request === false) {
    return 'disabled';
  }
  return undefined;
};

const resolveRootAliasMode = (value: unknown): WebSearchMode | undefined => {
  if (value === true) {
    return 'live';
  }
  if (value === false) {
    return 'disabled';
  }
  return undefined;
};

export function resolveConfiguredWebSearchMode(
  config: RuntimeRecord | undefined,
): WebSearchMode | undefined {
  if (!config) {
    return undefined;
  }
  return (
    normalizeMode(config.web_search) ??
    normalizeMode(config.web_search_mode) ??
    resolveRootAliasMode(config.web_search_request) ??
    resolveLegacyAliasMode(config.features)
  );
}

export function buildManagedWebToolsMcpServerDefinition(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const port = resolveRequiredCodeinfoPlaceholderValue(
    'CODEINFO_WEB_MCP_PORT',
    env,
  );
  return {
    command: 'npx',
    args: ['-y', 'mcp-remote', `http://localhost:${port}/mcp`],
    startup_timeout_sec: 60,
  };
}

export function shouldInjectManagedWebTools(params: {
  provider: ChatProviderId;
  webSearchMode?: WebSearchMode;
  usesOpenAiCompatEndpoint?: boolean;
}): boolean {
  if (params.webSearchMode !== 'live') {
    return false;
  }

  if (params.provider === 'codex') {
    return params.usesOpenAiCompatEndpoint === true;
  }

  return params.provider === 'copilot';
}

export function buildManagedWebToolsWarning(params: {
  provider: ChatProviderId;
  webSearchMode?: WebSearchMode;
  usesOpenAiCompatEndpoint?: boolean;
}): string | undefined {
  if (params.webSearchMode !== 'cached') {
    return undefined;
  }

  if (params.provider === 'codex') {
    if (params.usesOpenAiCompatEndpoint !== true) {
      return undefined;
    }
    return 'codex/chat/config.toml sets web_search = "cached", but cached mode is only supported by native Codex web search; web_tools will not be injected for external endpoint execution.';
  }

  if (params.provider === 'copilot') {
    return `${params.provider}/chat/config.toml sets web_search = "cached", but cached mode is only supported by native Codex web search; web_tools will not be injected.`;
  }

  return undefined;
}

export function applyManagedWebToolsToRuntimeConfigForMode(params: {
  config: RuntimeRecord;
  provider: ChatProviderId;
  webSearchMode?: WebSearchMode;
  env?: NodeJS.ProcessEnv;
  usesOpenAiCompatEndpoint?: boolean;
}): RuntimeRecord {
  const cloned: RuntimeRecord = { ...params.config };
  const currentMcpServers = isRecord(cloned.mcp_servers)
    ? { ...cloned.mcp_servers }
    : {};

  delete currentMcpServers.web_tools;

  if (
    shouldInjectManagedWebTools({
      provider: params.provider,
      webSearchMode: params.webSearchMode,
      usesOpenAiCompatEndpoint: params.usesOpenAiCompatEndpoint,
    })
  ) {
    currentMcpServers.web_tools = buildManagedWebToolsMcpServerDefinition(
      params.env,
    );
  }

  if (Object.keys(currentMcpServers).length > 0) {
    cloned.mcp_servers = currentMcpServers;
  } else {
    delete cloned.mcp_servers;
  }

  return cloned;
}

export function applyManagedWebToolsToRuntimeConfig(params: {
  config: RuntimeRecord;
  provider: ChatProviderId;
  env?: NodeJS.ProcessEnv;
  usesOpenAiCompatEndpoint?: boolean;
}): RuntimeRecord {
  return applyManagedWebToolsToRuntimeConfigForMode({
    ...params,
    webSearchMode: resolveConfiguredWebSearchMode(params.config),
  });
}
