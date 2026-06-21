import type { OpenAiCompatEndpointConfig } from '../config/openaiCompatEndpoints.js';
import { supportsOpenAiCompatBuiltInWebSearch } from '../config/openaiCompatEndpoints.js';
import type { RuntimeTomlConfig } from '../config/runtimeConfig.js';

type CodexWebSearchMode = 'disabled' | 'cached' | 'live';

const normalizeWebSearchMode = (value: unknown): CodexWebSearchMode | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'disabled' ||
    normalized === 'cached' ||
    normalized === 'live'
  ) {
    return normalized;
  }

  return undefined;
};

export function resolveCodexWebSearchMode(params: {
  explicitMode?: unknown;
  runtimeConfig?: RuntimeTomlConfig | Record<string, unknown>;
}): CodexWebSearchMode | undefined {
  const explicitMode = normalizeWebSearchMode(params.explicitMode);
  if (explicitMode) {
    return explicitMode;
  }

  const runtimeConfig = params.runtimeConfig;
  if (!runtimeConfig || typeof runtimeConfig !== 'object') {
    return undefined;
  }

  const runtimeRecord = runtimeConfig as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(runtimeRecord, 'web_search')) {
    return normalizeWebSearchMode(runtimeRecord.web_search);
  }

  return normalizeWebSearchMode(runtimeRecord.web_search_mode);
}

export function shouldForceUnslothBuiltInWebSearch(params: {
  endpoint?: Pick<OpenAiCompatEndpointConfig, 'supportsBuiltInWebSearch'> | null;
  explicitMode?: unknown;
  runtimeConfig?: RuntimeTomlConfig | Record<string, unknown>;
}): boolean {
  if (!supportsOpenAiCompatBuiltInWebSearch(params.endpoint)) {
    return false;
  }

  return (
    resolveCodexWebSearchMode({
      explicitMode: params.explicitMode,
      runtimeConfig: params.runtimeConfig,
    }) === 'live'
  );
}
