import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatProviderId } from '@codeinfo2/common';
import { parse } from 'dotenv';
import { getScopedProcessEnv } from '../test/support/testEnvOverrideScope.js';
import {
  attachOpenAiCompatEndpointKeys,
  resolveOpenAiCompatEndpointConfigsFromList,
  resolveOpenAiCompatEndpointKeysFromList,
  type OpenAiCompatEndpointAuthResolution,
} from './openaiCompatEndpoints.js';

export const STARTUP_ENV_ORDER = ['server/.env', 'server/.env.local'] as const;
export const DEFAULT_AGENT_PROVIDER_FALLBACK_ORDER = [
  'codex',
  'copilot',
] as const satisfies readonly ChatProviderId[];
export const SERVER_CODEINFO_ENV_NAMES = [
  'CODEINFO_SERVER_PORT',
  'CODEINFO_LMSTUDIO_BASE_URL',
  'CODEINFO_CHROMA_URL',
  'CODEINFO_MONGO_URI',
  'CODEINFO_CHAT_MCP_PORT',
  'CODEINFO_AGENTS_MCP_PORT',
  'CODEINFO_WEB_MCP_PORT',
  'CODEINFO_PLAYWRIGHT_MCP_URL',
  'CODEINFO_OPENAI_EMBEDDING_KEY',
  'CODEINFO_CHAT_DEFAULT_PROVIDER',
  'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
  'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
  'CODEINFO_INGEST_INCLUDE',
  'CODEINFO_INGEST_EXCLUDE',
  'CODEINFO_INGEST_TOKEN_MARGIN',
  'CODEINFO_INGEST_FALLBACK_TOKENS',
  'CODEINFO_INGEST_FLUSH_EVERY',
  'CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES',
  'CODEINFO_INGEST_OPENAI_MAX_BATCH_SIZE',
  'CODEINFO_INGEST_OPENAI_MAX_INFLIGHT',
  'CODEINFO_INGEST_LMSTUDIO_MAX_BATCH_SIZE',
  'CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT',
  'CODEINFO_INGEST_MAX_QUEUE_SIZE',
  'CODEINFO_INGEST_COLLECTION',
  'CODEINFO_INGEST_ROOTS_COLLECTION',
  'CODEINFO_INGEST_TEST_GIT_PATHS',
  'CODEINFO_HOST_INGEST_DIR',
  'CODEINFO_LOG_FILE_PATH',
  'CODEINFO_LOG_LEVEL',
  'CODEINFO_LOG_BUFFER_MAX',
  'CODEINFO_LOG_MAX_CLIENT_BYTES',
  'CODEINFO_LOG_INGEST_WS_THROTTLE_MS',
  'CODEINFO_LOG_FILE_ROTATE',
  'CODEINFO_COPILOT_HOME',
  'CODEINFO_COPILOT_CLI_PATH',
  'CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER',
  'CODEINFO_OPENAI_INGEST_MAX_RETRIES',
] as const;

export type StartupEnvValueSource =
  | 'preseeded'
  | 'server/.env'
  | 'server/.env.local'
  | 'absent';

export type StartupEnvLoadResult = {
  orderedFiles: readonly string[];
  loadedFiles: readonly string[];
  overrideApplied: boolean;
  valueSources: Record<string, StartupEnvValueSource>;
};

export type CodeinfoEnvResolution = {
  name: (typeof SERVER_CODEINFO_ENV_NAMES)[number];
  source: StartupEnvValueSource;
  defined: boolean;
  nonEmpty: boolean;
};

export type ExternalOpenAiCompatEndpointResolution =
  OpenAiCompatEndpointAuthResolution;

export type AgentProviderFallbackOrderResolution = {
  normalizedProviders: ChatProviderId[];
  warnings: string[];
  usedDefault: boolean;
};

const resolveServerRoot = () => {
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFile), '../..');
};

let cachedStartupEnvLoad: StartupEnvLoadResult | null = null;

export const resetStartupEnvLoadCacheForTests = () => {
  cachedStartupEnvLoad = null;
};

export const loadStartupEnv = ({
  serverRoot = resolveServerRoot(),
  targetEnv = process.env,
}: {
  serverRoot?: string;
  targetEnv?: NodeJS.ProcessEnv;
} = {}): StartupEnvLoadResult => {
  const envPath = path.resolve(serverRoot, '.env');
  const envLocalPath = path.resolve(serverRoot, '.env.local');
  const envExists = fs.existsSync(envPath);
  const envLocalExists = fs.existsSync(envLocalPath);

  const preseededKeys = new Set(Object.keys(targetEnv));
  const valueSources: Record<string, StartupEnvValueSource> = {};
  for (const key of preseededKeys) {
    valueSources[key] = 'preseeded';
  }

  const assignParsedValues = (
    filePath: string,
    source: Extract<StartupEnvValueSource, 'server/.env' | 'server/.env.local'>,
    allowFileOverride = false,
  ) => {
    const parsed = parse(fs.readFileSync(filePath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (preseededKeys.has(key)) continue;
      if (!allowFileOverride && key in targetEnv) continue;
      targetEnv[key] = value;
      valueSources[key] = source;
    }
  };

  if (envExists) assignParsedValues(envPath, 'server/.env');
  if (envLocalExists)
    assignParsedValues(envLocalPath, 'server/.env.local', true);

  return {
    orderedFiles: STARTUP_ENV_ORDER,
    loadedFiles: [
      ...(envExists ? (['server/.env'] as const) : []),
      ...(envLocalExists ? (['server/.env.local'] as const) : []),
    ],
    overrideApplied: envLocalExists,
    valueSources,
  };
};

export const ensureStartupEnvLoaded = (): StartupEnvLoadResult => {
  if (cachedStartupEnvLoad) return cachedStartupEnvLoad;
  cachedStartupEnvLoad = loadStartupEnv();
  return cachedStartupEnvLoad;
};

export const resolveOpenAiEmbeddingCapabilityState = (
  env: Record<string, string | undefined> = process.env,
): { enabled: boolean } => {
  const key = getScopedProcessEnv(env).CODEINFO_OPENAI_EMBEDDING_KEY;
  return { enabled: typeof key === 'string' && key.trim().length > 0 };
};

export const resolveCodeinfoEnvResolutions = ({
  env = process.env,
  loadResult = ensureStartupEnvLoaded(),
}: {
  env?: Record<string, string | undefined>;
  loadResult?: StartupEnvLoadResult;
} = {}): CodeinfoEnvResolution[] =>
  SERVER_CODEINFO_ENV_NAMES.map((name) => {
    const rawValue = getScopedProcessEnv(env)[name];
    return {
      name,
      source: loadResult.valueSources[name] ?? 'absent',
      defined: typeof rawValue === 'string',
      nonEmpty: typeof rawValue === 'string' && rawValue.trim().length > 0,
    };
  });

export const resolveExternalOpenAiCompatEndpoints = ({
  env = process.env,
}: {
  env?: Record<string, string | undefined>;
} = {}): ExternalOpenAiCompatEndpointResolution => {
  const effectiveEnv = getScopedProcessEnv(env);
  const endpoints = resolveOpenAiCompatEndpointConfigsFromList({
    value: effectiveEnv.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS,
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
  });
  const keys = resolveOpenAiCompatEndpointKeysFromList({
    value: effectiveEnv.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS,
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
  });
  return attachOpenAiCompatEndpointKeys({
    endpoints: endpoints.endpoints,
    keys: keys.keys,
    warnings: [...endpoints.warnings, ...keys.warnings],
  });
};

const isChatProviderId = (value: string): value is ChatProviderId =>
  value === 'codex' || value === 'copilot' || value === 'lmstudio';

export const resolveAgentProviderFallbackOrder = (
  env: Record<string, string | undefined> = process.env,
): AgentProviderFallbackOrderResolution => {
  const rawValue =
    getScopedProcessEnv(env).CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER;
  const warnings: string[] = [];
  const normalizedProviders: ChatProviderId[] = [];
  const seen = new Set<ChatProviderId>();

  for (const entry of (rawValue ?? '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    if (!isChatProviderId(trimmed)) {
      warnings.push(
        `Ignoring unknown CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER provider "${trimmed}"`,
      );
      continue;
    }
    if (seen.has(trimmed)) {
      warnings.push(
        `Ignoring duplicate CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER provider "${trimmed}"`,
      );
      continue;
    }
    seen.add(trimmed);
    normalizedProviders.push(trimmed);
  }

  if (normalizedProviders.length > 0) {
    return {
      normalizedProviders,
      warnings,
      usedDefault: false,
    };
  }

  return {
    normalizedProviders: [...DEFAULT_AGENT_PROVIDER_FALLBACK_ORDER],
    warnings,
    usedDefault: true,
  };
};
