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
type RawRuntimeConfig = {
  apiBaseUrl?: unknown;
  lmStudioBaseUrl?: unknown;
  logForwardEnabled?: unknown;
  logMaxBytes?: unknown;
};

type RuntimeConfigField = keyof RuntimeConfig;
type RuntimeConfigSource = 'runtime' | 'env';
type RuntimeConfigReason =
  | 'empty_string'
  | 'invalid_url'
  | 'invalid_boolean'
  | 'invalid_number'
  | 'invalid_container';

type RuntimeConfigFieldDiagnostic = {
  field: RuntimeConfigField;
  source: RuntimeConfigSource;
  rawValue: string;
  reason: RuntimeConfigReason;
};

type RuntimeConfigContainerDiagnostic = {
  container: '__CODEINFO_CONFIG__';
  source: 'runtime';
  rawValue: string;
  reason: Extract<RuntimeConfigReason, 'invalid_container'>;
};

type RuntimeConfigDiagnostic =
  | RuntimeConfigFieldDiagnostic
  | RuntimeConfigContainerDiagnostic;

const DEFAULT_LM_STUDIO_BASE_URL = 'http://host.docker.internal:1234';
const DEFAULT_LOG_MAX_BYTES = 32768;

let runtimeConfigLogged = false;

function stringifyRawValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createDiagnostic(
  field: RuntimeConfigField,
  source: RuntimeConfigSource,
  value: unknown,
  reason: RuntimeConfigReason,
): RuntimeConfigFieldDiagnostic {
  return {
    field,
    source,
    rawValue: stringifyRawValue(value),
    reason,
  };
}

function createContainerDiagnostic(
  value: unknown,
): RuntimeConfigContainerDiagnostic {
  return {
    container: '__CODEINFO_CONFIG__',
    source: 'runtime',
    rawValue: stringifyRawValue(value),
    reason: 'invalid_container',
  };
}

function readEnv(): Env {
  const metaEnv =
    typeof import.meta !== 'undefined'
      ? (((import.meta as unknown as { env?: Env }).env ?? {}) as Env)
      : {};
  const processEnv = typeof process !== 'undefined' ? (process.env as Env) : {};
  return { ...processEnv, ...metaEnv };
}

function readRuntimeConfig(): {
  config: RawRuntimeConfig;
  diagnostics: RuntimeConfigDiagnostic[];
} {
  const config = (
    globalThis as unknown as { __CODEINFO_CONFIG__?: RawRuntimeConfig }
  ).__CODEINFO_CONFIG__;
  if (config === undefined) {
    return { config: {}, diagnostics: [] };
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      config: {},
      diagnostics: [createContainerDiagnostic(config)],
    };
  }
  return { config, diagnostics: [] };
}

function normalizeBoolean(
  field: Extract<RuntimeConfigField, 'logForwardEnabled'>,
  source: RuntimeConfigSource,
  value: unknown,
): {
  value: boolean | undefined;
  diagnostic?: RuntimeConfigDiagnostic;
} {
  if (value === undefined) return { value: undefined };
  if (typeof value === 'boolean') return { value };
  if (typeof value !== 'string') {
    return {
      value: undefined,
      diagnostic: createDiagnostic(field, source, value, 'invalid_boolean'),
    };
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return { value: true };
  if (normalized === 'false') return { value: false };
  return {
    value: undefined,
    diagnostic: createDiagnostic(field, source, value, 'invalid_boolean'),
  };
}

function normalizeNumber(
  field: Extract<RuntimeConfigField, 'logMaxBytes'>,
  source: RuntimeConfigSource,
  value: unknown,
): {
  value: number | undefined;
  diagnostic?: RuntimeConfigDiagnostic;
} {
  if (value === undefined) return { value: undefined };
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return { value };
  }
  if (typeof value !== 'string') {
    return {
      value: undefined,
      diagnostic: createDiagnostic(field, source, value, 'invalid_number'),
    };
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return { value: parsed };
  }
  return {
    value: undefined,
    diagnostic: createDiagnostic(field, source, value, 'invalid_number'),
  };
}

function normalizeUrl(
  field: Extract<RuntimeConfigField, 'apiBaseUrl' | 'lmStudioBaseUrl'>,
  source: RuntimeConfigSource,
  value: unknown,
): {
  value: string | undefined;
  diagnostic?: RuntimeConfigDiagnostic;
} {
  if (value === undefined) return { value: undefined };
  if (typeof value !== 'string') {
    return {
      value: undefined,
      diagnostic: createDiagnostic(field, source, value, 'invalid_url'),
    };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      value: undefined,
      diagnostic: createDiagnostic(field, source, value, 'empty_string'),
    };
  }
  try {
    new URL(trimmed);
    return { value: trimmed };
  } catch {
    return {
      value: undefined,
      diagnostic: createDiagnostic(field, source, value, 'invalid_url'),
    };
  }
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

function logRuntimeConfigOnce(
  config: ResolvedRuntimeConfig,
  diagnostics: RuntimeConfigDiagnostic[],
) {
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
    hasInvalidCanonicalConfig: diagnostics.length > 0,
    diagnostics,
  });
}

function resolveClientRuntimeConfig(): {
  config: ResolvedRuntimeConfig;
  diagnostics: RuntimeConfigDiagnostic[];
} {
  const runtimeConfigState = readRuntimeConfig();
  const runtime = runtimeConfigState.config;
  const env = readEnv();
  const diagnostics: RuntimeConfigDiagnostic[] = [
    ...runtimeConfigState.diagnostics,
  ];

  const runtimeApiBaseUrl = normalizeUrl(
    'apiBaseUrl',
    'runtime',
    runtime.apiBaseUrl,
  );
  const envApiBaseUrl = normalizeUrl(
    'apiBaseUrl',
    'env',
    env.VITE_CODEINFO_API_URL,
  );
  const apiBaseUrl =
    runtimeApiBaseUrl.value || envApiBaseUrl.value || getFallbackApiBaseUrl();
  if (runtimeApiBaseUrl.diagnostic) diagnostics.push(runtimeApiBaseUrl.diagnostic);
  if (envApiBaseUrl.diagnostic) diagnostics.push(envApiBaseUrl.diagnostic);

  const runtimeLmStudioBaseUrl = normalizeUrl(
    'lmStudioBaseUrl',
    'runtime',
    runtime.lmStudioBaseUrl,
  );
  const envLmStudioBaseUrl = normalizeUrl(
    'lmStudioBaseUrl',
    'env',
    env.VITE_CODEINFO_LMSTUDIO_URL,
  );
  const lmStudioBaseUrl =
    runtimeLmStudioBaseUrl.value ||
    envLmStudioBaseUrl.value ||
    DEFAULT_LM_STUDIO_BASE_URL;
  if (runtimeLmStudioBaseUrl.diagnostic) {
    diagnostics.push(runtimeLmStudioBaseUrl.diagnostic);
  }
  if (envLmStudioBaseUrl.diagnostic) diagnostics.push(envLmStudioBaseUrl.diagnostic);

  const runtimeLogForwardEnabled = normalizeBoolean(
    'logForwardEnabled',
    'runtime',
    runtime.logForwardEnabled,
  );
  const envLogForwardEnabled = normalizeBoolean(
    'logForwardEnabled',
    'env',
    env.VITE_CODEINFO_LOG_FORWARD_ENABLED,
  );
  const logForwardEnabled =
    runtimeLogForwardEnabled.value ?? envLogForwardEnabled.value ?? true;
  if (runtimeLogForwardEnabled.diagnostic) {
    diagnostics.push(runtimeLogForwardEnabled.diagnostic);
  }
  if (envLogForwardEnabled.diagnostic) {
    diagnostics.push(envLogForwardEnabled.diagnostic);
  }

  const runtimeLogMaxBytes = normalizeNumber(
    'logMaxBytes',
    'runtime',
    runtime.logMaxBytes,
  );
  const envLogMaxBytes = normalizeNumber(
    'logMaxBytes',
    'env',
    env.VITE_CODEINFO_LOG_MAX_BYTES,
  );
  const logMaxBytes =
    runtimeLogMaxBytes.value ?? envLogMaxBytes.value ?? DEFAULT_LOG_MAX_BYTES;
  if (runtimeLogMaxBytes.diagnostic) diagnostics.push(runtimeLogMaxBytes.diagnostic);
  if (envLogMaxBytes.diagnostic) diagnostics.push(envLogMaxBytes.diagnostic);

  const config: ResolvedRuntimeConfig = {
    apiBaseUrl,
    lmStudioBaseUrl,
    logForwardEnabled,
    logMaxBytes,
    sources: {
      apiBaseUrl: runtimeApiBaseUrl.value
        ? 'runtime'
        : envApiBaseUrl.value
          ? 'env'
          : 'default',
      lmStudioBaseUrl: runtimeLmStudioBaseUrl.value
        ? 'runtime'
        : envLmStudioBaseUrl.value
          ? 'env'
          : 'default',
      logForwardEnabled:
        runtimeLogForwardEnabled.value !== undefined
          ? 'runtime'
          : envLogForwardEnabled.value !== undefined
            ? 'env'
            : 'default',
      logMaxBytes:
        runtimeLogMaxBytes.value !== undefined
          ? 'runtime'
          : envLogMaxBytes.value !== undefined
            ? 'env'
            : 'default',
    },
  };

  return { config, diagnostics };
}

export function getClientRuntimeConfig(): ResolvedRuntimeConfig {
  const { config, diagnostics } = resolveClientRuntimeConfig();
  logRuntimeConfigOnce(config, diagnostics);
  return config;
}

export function getClientRuntimeConfigDiagnostics(): RuntimeConfigDiagnostic[] {
  return resolveClientRuntimeConfig().diagnostics;
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

export function resetClientRuntimeConfigLogForTests() {
  runtimeConfigLogged = false;
}

export type { RuntimeConfig, ResolvedRuntimeConfig, RuntimeConfigDiagnostic };
