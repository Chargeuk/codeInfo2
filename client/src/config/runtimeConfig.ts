type RuntimeConfig = {
  apiBaseUrl?: string;
  lmStudioBaseUrl?: string;
  logForwardEnabled?: boolean;
  logMaxBytes?: number;
};

type RuntimeConfigSources = {
  apiBaseUrl: 'runtime' | 'env' | 'default';
  lmStudioBaseUrl: 'runtime' | 'env' | 'default';
  logForwardEnabled: 'runtime' | 'env' | 'default';
  logMaxBytes: 'runtime' | 'env' | 'default';
};

type ResolvedRuntimeConfig = RuntimeConfig & {
  sources: RuntimeConfigSources;
};

type Env = { [key: string]: string | undefined };
type RawRuntimeConfig = RuntimeConfig & {
  logForwardEnabled?: boolean | string;
  logMaxBytes?: number | string;
};

const DEFAULT_LM_STUDIO_BASE_URL = 'http://host.docker.internal:1234';
const DEFAULT_LOG_MAX_BYTES = 32768;

let runtimeConfigLogged = false;

function readEnv(): Env {
  const metaEnv =
    typeof import.meta !== 'undefined'
      ? (((import.meta as unknown as { env?: Env }).env ?? {}) as Env)
      : {};
  const processEnv = typeof process !== 'undefined' ? (process.env as Env) : {};
  return { ...processEnv, ...metaEnv };
}

function readRuntimeConfig(): RawRuntimeConfig {
  const config = (
    globalThis as unknown as { __CODEINFO_CONFIG__?: RawRuntimeConfig }
  ).__CODEINFO_CONFIG__;
  if (!config || typeof config !== 'object') {
    return {};
  }
  return config;
}

function normalizeBoolean(
  value: boolean | string | undefined,
): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

function normalizeNumber(
  value: number | string | undefined,
): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getFallbackApiBaseUrl() {
  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }
  return '';
}

function shouldSkipRuntimeConfigLog() {
  const env = readEnv();
  if (env.MODE === 'test' || env.JEST_WORKER_ID) return true;
  const testFlag = globalThis as typeof globalThis & {
    __CODEINFO_TEST__?: boolean;
  };
  return testFlag.__CODEINFO_TEST__ === true;
}

function logRuntimeConfigOnce(config: ResolvedRuntimeConfig) {
  if (runtimeConfigLogged || shouldSkipRuntimeConfigLog()) {
    return;
  }
  runtimeConfigLogged = true;
  console.info('DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG', {
    apiBaseUrl: config.apiBaseUrl,
    apiBaseUrlSource: config.sources.apiBaseUrl,
    lmStudioBaseUrl: config.lmStudioBaseUrl,
    lmStudioBaseUrlSource: config.sources.lmStudioBaseUrl,
    logForwardEnabled: config.logForwardEnabled,
    logForwardEnabledSource: config.sources.logForwardEnabled,
    logMaxBytes: config.logMaxBytes,
    logMaxBytesSource: config.sources.logMaxBytes,
  });
}

export function getClientRuntimeConfig(): ResolvedRuntimeConfig {
  const runtime = readRuntimeConfig();
  const env = readEnv();

  const runtimeApiBaseUrl = runtime.apiBaseUrl?.trim();
  const envApiBaseUrl = env.VITE_CODEINFO_API_URL?.trim();
  const apiBaseUrl =
    runtimeApiBaseUrl || envApiBaseUrl || getFallbackApiBaseUrl();

  const runtimeLmStudioBaseUrl = runtime.lmStudioBaseUrl?.trim();
  const envLmStudioBaseUrl = env.VITE_CODEINFO_LMSTUDIO_URL?.trim();
  const lmStudioBaseUrl =
    runtimeLmStudioBaseUrl || envLmStudioBaseUrl || DEFAULT_LM_STUDIO_BASE_URL;

  const runtimeLogForwardEnabled = normalizeBoolean(runtime.logForwardEnabled);
  const envLogForwardEnabled = normalizeBoolean(
    env.VITE_CODEINFO_LOG_FORWARD_ENABLED,
  );
  const logForwardEnabled =
    runtimeLogForwardEnabled ?? envLogForwardEnabled ?? true;

  const runtimeLogMaxBytes = normalizeNumber(runtime.logMaxBytes);
  const envLogMaxBytes = normalizeNumber(env.VITE_CODEINFO_LOG_MAX_BYTES);
  const logMaxBytes =
    runtimeLogMaxBytes ?? envLogMaxBytes ?? DEFAULT_LOG_MAX_BYTES;

  const config: ResolvedRuntimeConfig = {
    apiBaseUrl,
    lmStudioBaseUrl,
    logForwardEnabled,
    logMaxBytes,
    sources: {
      apiBaseUrl: runtimeApiBaseUrl
        ? 'runtime'
        : envApiBaseUrl
          ? 'env'
          : 'default',
      lmStudioBaseUrl: runtimeLmStudioBaseUrl
        ? 'runtime'
        : envLmStudioBaseUrl
          ? 'env'
          : 'default',
      logForwardEnabled:
        runtimeLogForwardEnabled !== undefined
          ? 'runtime'
          : envLogForwardEnabled !== undefined
            ? 'env'
            : 'default',
      logMaxBytes:
        runtimeLogMaxBytes !== undefined
          ? 'runtime'
          : envLogMaxBytes !== undefined
            ? 'env'
            : 'default',
    },
  };

  logRuntimeConfigOnce(config);
  return config;
}

export function getApiBaseUrl(): string {
  return getClientRuntimeConfig().apiBaseUrl ?? '';
}

export function getLmStudioBaseUrl(): string {
  return getClientRuntimeConfig().lmStudioBaseUrl ?? DEFAULT_LM_STUDIO_BASE_URL;
}

export function getLogForwardEnabled(): boolean {
  return getClientRuntimeConfig().logForwardEnabled ?? true;
}

export function getLogMaxBytes(): number {
  return getClientRuntimeConfig().logMaxBytes ?? DEFAULT_LOG_MAX_BYTES;
}

export type { RuntimeConfig, ResolvedRuntimeConfig };
