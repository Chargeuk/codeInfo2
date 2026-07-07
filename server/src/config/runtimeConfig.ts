import fsSync, { constants as fsConstants } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { isChatProviderId, type ChatProviderId } from '@codeinfo2/common';
import toml from 'toml';

import { discoverAgents } from '../agents/discovery.js';
import { append } from '../logStore.js';
import {
  enterTestOverrideScope,
  getScopedProcessEnv,
  getScopedProviderBootstrapStatusOverride,
  hasActiveTestOverrideScope,
} from '../test/support/testOverrideScope.js';

import {
  buildDefaultCodexConfig,
  ensureCodexConfigSeeded,
  getCodexAuthPathForHome,
  getCodexChatConfigPathForHome,
  getCodexConfigPathForHome,
  resolveCodexHome,
} from './codexConfig.js';
import {
  ensureCopilotBaseConfigSeeded,
  ensureLmStudioBaseConfigSeeded,
  getCopilotConfigPathForHome,
  getLmStudioConfigPathForHome,
  resolveCopilotHome,
  resolveLmStudioHome,
} from './copilotConfig.js';
import { resolveRequiredCodeinfoPlaceholderValue } from './mcpEndpoints.js';
import {
  type OpenAiCompatEndpointConfig,
  parseOpenAiCompatEndpointConfig,
  validateOpenAiCompatEndpointConfigForProvider,
} from './openaiCompatEndpoints.js';
import {
  applyManagedWebToolsToRuntimeConfig,
  buildManagedWebToolsWarning,
  isManagedWebToolsMcpServerDefinition,
  resolveConfiguredWebSearchMode,
} from './webSearchMcp.js';

const T03_SUCCESS_LOG =
  '[DEV-0000037][T03] event=runtime_config_loaded_and_normalized result=success';
const T03_ERROR_LOG =
  '[DEV-0000037][T03] event=runtime_config_loaded_and_normalized result=error';
const T04_SUCCESS_LOG =
  '[DEV-0000037][T04] event=runtime_config_merged_and_validated result=success';
const T04_ERROR_LOG =
  '[DEV-0000037][T04] event=runtime_config_merged_and_validated result=error';
const T22_SUCCESS_LOG =
  '[DEV-0000037][T22] event=final_config_minimization_completed result=success';
const T22_ERROR_LOG =
  '[DEV-0000037][T22] event=final_config_minimization_completed result=error';
const T09_BOOTSTRAP_LOG_MARKER = 'DEV_0000040_T09_CHAT_BOOTSTRAP_BRANCH';
const T03_CHAT_BOOTSTRAP_MARKER = 'DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP';
const T04_RUNTIME_INHERITANCE_MARKER =
  'DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED';
const T05_CONTEXT7_NORMALIZED_MARKER = 'DEV_0000047_T05_CONTEXT7_NORMALIZED';
const T07_CHECKED_IN_MCP_CONTRACT_LOADED =
  'DEV-0000050:T07:checked_in_mcp_contract_loaded';

export type RuntimeTomlConfig = Record<string, unknown>;
export type RuntimeConfigWarning = { path: string; message: string };
export type RuntimeConfigAppMetadata = {
  codeinfoProvider?: string;
  codeinfoOpenAiEndpoint?: OpenAiCompatEndpointConfig;
};
export type RuntimeConfigValidationResult = {
  config: RuntimeTomlConfig;
  warnings: RuntimeConfigWarning[];
  appMetadata?: RuntimeConfigAppMetadata;
};
export type RuntimeConfigSurface = 'agent' | 'chat';
type RuntimeMergeResult = {
  merged: RuntimeTomlConfig;
  inheritedKeys: string[];
  runtimeOverrideKeys: string[];
};
type Context7NormalizationMode =
  | 'env_overlay'
  | 'no_key_fallback'
  | 'explicit_key_preserved'
  | 'no_context7_definition';
type Context7NormalizationResult = {
  config: RuntimeTomlConfig;
  mode: Context7NormalizationMode;
};
type CodexChatConfigRootOverrides = {
  model?: string;
  approval_policy?: string;
  sandbox_mode?: string;
  network_access_enabled?: boolean;
  web_search?: string;
  web_search_mode?: string;
  model_reasoning_effort?: string;
  model_reasoning_summary?: string;
  model_verbosity?: string;
};

export class RuntimeConfigResolutionError extends Error {
  readonly code:
    | 'RUNTIME_CONFIG_MISSING'
    | 'RUNTIME_CONFIG_UNREADABLE'
    | 'RUNTIME_CONFIG_INVALID'
    | 'RUNTIME_CONFIG_VALIDATION_FAILED';
  readonly configPath: string;
  readonly surface: RuntimeConfigSurface;

  constructor(params: {
    code:
      | 'RUNTIME_CONFIG_MISSING'
      | 'RUNTIME_CONFIG_UNREADABLE'
      | 'RUNTIME_CONFIG_INVALID'
      | 'RUNTIME_CONFIG_VALIDATION_FAILED';
    configPath: string;
    surface: RuntimeConfigSurface;
    message: string;
  }) {
    super(params.message);
    this.name = 'RuntimeConfigResolutionError';
    this.code = params.code;
    this.configPath = params.configPath;
    this.surface = params.surface;
  }
}

type ChatBootstrapBranch =
  | 'existing_noop'
  | 'existing_augmented'
  | 'existing_augment_failed'
  | 'generated_template'
  | 'template_write_failed'
  | 'chat_stat_failed'
  | 'chat_dir_create_failed';

type ChatConfigAugmentResult = {
  outcome: 'augmented' | 'noop' | 'failed';
  warning?: string;
  warningCode?: string;
};

export type RuntimeConfigSnapshot = {
  provider: ChatProviderId;
  providerHome: string;
  codexHome?: string;
  baseConfigPath: string;
  repoLocalConfigPath: string;
  chatConfigPath: string;
  agentConfigPath?: string;
  repoLocalConfig?: RuntimeTomlConfig;
  baseConfig?: RuntimeTomlConfig;
  chatConfig?: RuntimeTomlConfig;
  agentConfig?: RuntimeTomlConfig;
};
export type ProviderChatDefaultsSnapshot = {
  provider: ChatProviderId;
  providerHome: string;
  chatConfigPath: string;
  config?: RuntimeTomlConfig;
};

export type ProviderBootstrapStatus = {
  provider: ChatProviderId;
  healthy: boolean;
  reason?: string;
  warnings: string[];
};

const providerBootstrapStatuses: Record<
  ChatProviderId,
  ProviderBootstrapStatus
> = {
  codex: { provider: 'codex', healthy: true, warnings: [] },
  copilot: { provider: 'copilot', healthy: true, warnings: [] },
  lmstudio: { provider: 'lmstudio', healthy: true, warnings: [] },
};

const WEB_SEARCH_MODES = new Set(['live', 'cached', 'disabled']);
const CONTEXT7_PLACEHOLDER_API_KEYS = new Set([
  'REPLACE_WITH_CONTEXT7_API_KEY',
  'ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866',
]);
const CODEINFO_ENV_PLACEHOLDER_PATTERN = /\$\{([A-Z0-9_]+)\}/g;
const DIRECT_CODEINFO_ENV_PLACEHOLDERS = new Set([
  'CODEINFO_PLAYWRIGHT_MCP_URL',
]);
const CODEINFO_CONFIG_DIRNAME = 'codeinfo_config';
const CODEINFO_CONFIG_BASENAME = 'config.toml';
const CODEINFO_PROVIDER_METADATA_KEY = 'codeinfo_provider';
const CODEINFO_OPENAI_ENDPOINT_METADATA_KEY = 'codeinfo_openai_endpoint';
const CODEINFO_METADATA_PREFIX = 'codeinfo_';
const REQUIRED_MCP_PLACEHOLDER_KEYS = new Set([
  'CODEINFO_SERVER_PORT',
  'CODEINFO_CHAT_MCP_PORT',
  'CODEINFO_AGENTS_MCP_PORT',
  'CODEINFO_WEB_MCP_PORT',
  'CODEINFO_PLAYWRIGHT_MCP_URL',
]);
const CODE_INFO_MCP_SERVER_BLOCK = [
  '[mcp_servers.code_info]',
  'command = "npx"',
  'args = ["-y", "mcp-remote", "http://localhost:${CODEINFO_SERVER_PORT}/mcp"]',
  'startup_timeout_sec = 60',
  '',
].join('\n');
const runtimeTestDiagnosticsEnabled =
  process.env.CODEINFO_TEST_RUNTIME_DIAGNOSTICS === '1';

const appendRuntimeTestDiagnostic = (
  message: string,
  context: Record<string, unknown>,
) => {
  if (!runtimeTestDiagnosticsEnabled) return;
  append({
    level: 'info',
    message,
    timestamp: new Date().toISOString(),
    source: 'server',
    context,
  });
};
const WEB_TOOLS_MCP_SERVER_BLOCK = [
  '[mcp_servers.web_tools]',
  'command = "npx"',
  'args = ["-y", "mcp-remote", "http://localhost:${CODEINFO_WEB_MCP_PORT}/mcp"]',
  'startup_timeout_sec = 60',
  '',
].join('\n');
const RESERVED_PROVIDER_CHAT_MCP_BLOCKS: Record<
  ChatProviderId,
  Record<string, string>
> = {
  codex: {
    code_info: CODE_INFO_MCP_SERVER_BLOCK,
  },
  copilot: {
    code_info: CODE_INFO_MCP_SERVER_BLOCK,
  },
  lmstudio: {
    code_info: CODE_INFO_MCP_SERVER_BLOCK,
  },
};
const CHAT_CONFIG_TEMPLATES: Record<ChatProviderId, string> = {
  codex: [
    'model = "gpt-5.3-codex"',
    'model_reasoning_effort = "high"',
    'approval_policy = "on-request"',
    'sandbox_mode = "danger-full-access"',
    'network_access_enabled = true',
    'web_search = "live"',
    '',
    CODE_INFO_MCP_SERVER_BLOCK.trimEnd(),
    '',
  ].join('\n'),
  copilot: [
    'model = "copilot-gpt-5"',
    'reasoning_effort = "medium"',
    'tool_access = "on"',
    'web_search = "live"',
    '',
    CODE_INFO_MCP_SERVER_BLOCK.trimEnd(),
    '',
  ].join('\n'),
  lmstudio: [
    'model = "model-1"',
    'temperature = 0.2',
    'max_tokens = 4096',
    'context_overflow_policy = "truncateMiddle"',
    'tool_access = "on"',
    'web_search = "live"',
    '',
    CODE_INFO_MCP_SERVER_BLOCK.trimEnd(),
    '',
  ].join('\n'),
};

const providerChatConfigDirRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

const encodeCodexRuntimeHomeSegment = (value: string): string => {
  const encoded = Buffer.from(value, 'utf8').toString('base64url');
  return `conversation-${encoded.length > 0 ? encoded : 'empty'}`;
};

function mapRepositoryBackedCodexHomeError(params: {
  error: unknown;
  configPath: string;
}): RuntimeConfigResolutionError {
  if (params.error instanceof RuntimeConfigResolutionError) {
    return params.error;
  }

  const code = (params.error as NodeJS.ErrnoException)?.code;
  const message =
    params.error instanceof Error ? params.error.message : String(params.error);

  if (
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'EISDIR' ||
    code === 'ENOTDIR' ||
    code === 'EMFILE' ||
    code === 'ENFILE' ||
    code === 'ELOOP'
  ) {
    return new RuntimeConfigResolutionError({
      code: 'RUNTIME_CONFIG_UNREADABLE',
      configPath: params.configPath,
      surface: 'chat',
      message: `RUNTIME_CONFIG_UNREADABLE: Unable to materialize repository-backed chat runtime home at ${params.configPath}: ${message}`,
    });
  }

  return new RuntimeConfigResolutionError({
    code: 'RUNTIME_CONFIG_VALIDATION_FAILED',
    configPath: params.configPath,
    surface: 'chat',
    message: `RUNTIME_CONFIG_VALIDATION_FAILED: Unable to materialize repository-backed chat runtime home at ${params.configPath}: ${message}`,
  });
}

export function resolveLmStudioChatDefaultsHome(): string {
  return path.join(providerChatConfigDirRoot, 'lmstudio');
}

export function getProviderChatConfigPath(params: {
  provider: ChatProviderId;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
}): { providerHome: string; chatConfigPath: string } {
  if (params.provider === 'codex') {
    const providerHome = resolveCodexHome(params.codexHome);
    return {
      providerHome,
      chatConfigPath: getCodexChatConfigPathForHome(providerHome),
    };
  }

  if (params.provider === 'copilot') {
    const providerHome = resolveCopilotHome(params.copilotHome);
    return {
      providerHome,
      chatConfigPath: path.join(providerHome, 'chat', 'config.toml'),
    };
  }

  const providerHome = path.resolve(
    params.lmstudioHome ?? resolveLmStudioChatDefaultsHome(),
  );
  return {
    providerHome,
    chatConfigPath: path.join(providerHome, 'chat', 'config.toml'),
  };
}

export function getProviderBaseConfigPath(params: {
  provider: ChatProviderId;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
}): {
  providerHome: string;
  baseConfigPath: string;
  repoLocalConfigPath: string;
} {
  if (params.provider === 'codex') {
    const providerHome = resolveCodexHome(params.codexHome);
    return {
      providerHome,
      baseConfigPath: getCodexConfigPathForHome(providerHome),
      repoLocalConfigPath: path.join(
        path.dirname(providerHome),
        CODEINFO_CONFIG_DIRNAME,
        CODEINFO_CONFIG_BASENAME,
      ),
    };
  }

  if (params.provider === 'copilot') {
    const providerHome = resolveCopilotHome(params.copilotHome);
    return {
      providerHome,
      baseConfigPath: getCopilotConfigPathForHome(providerHome),
      repoLocalConfigPath: path.join(
        path.dirname(providerHome),
        CODEINFO_CONFIG_DIRNAME,
        CODEINFO_CONFIG_BASENAME,
      ),
    };
  }

  const providerHome = resolveLmStudioHome(params.lmstudioHome);
  return {
    providerHome,
    baseConfigPath: getLmStudioConfigPathForHome(providerHome),
    repoLocalConfigPath: path.join(
      path.dirname(providerHome),
      CODEINFO_CONFIG_DIRNAME,
      CODEINFO_CONFIG_BASENAME,
    ),
  };
}

function buildChatConfigTempPath(chatConfigPath: string): string {
  return `${chatConfigPath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;
}

const CHAT_CONFIG_LOCK_RETRY_DELAY_MS = 50;
const CHAT_CONFIG_LOCK_MAX_RETRIES = 500;

async function acquireChatConfigLock(chatConfigPath: string): Promise<() => Promise<void>> {
  const lockPath = `${chatConfigPath}.codeinfo.lock`;
  const startedAt = Date.now();
  appendRuntimeTestDiagnostic('runtime.chat_config_lock_acquire_begin', {
    chatConfigPath,
    lockPath,
    maxRetries: CHAT_CONFIG_LOCK_MAX_RETRIES,
    retryDelayMs: CHAT_CONFIG_LOCK_RETRY_DELAY_MS,
    pid: process.pid,
  });

  for (let attempt = 0; attempt < CHAT_CONFIG_LOCK_MAX_RETRIES; attempt += 1) {
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(lockPath, 'wx');
      appendRuntimeTestDiagnostic('runtime.chat_config_lock_acquire_success', {
        chatConfigPath,
        lockPath,
        attempts: attempt + 1,
        waitedMs: Date.now() - startedAt,
        pid: process.pid,
      });
      if (attempt > 0) {
        appendRuntimeTestDiagnostic('runtime.chat_config_lock_acquired_after_retry', {
          chatConfigPath,
          lockPath,
          attempts: attempt + 1,
          waitedMs: Date.now() - startedAt,
          pid: process.pid,
        });
      }
      return async () => {
        await handle?.close().catch(() => {});
        await fs.rm(lockPath, { force: true }).catch(() => {});
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      appendRuntimeTestDiagnostic('runtime.chat_config_lock_retry', {
        chatConfigPath,
        lockPath,
        attempt: attempt + 1,
        waitedMs: Date.now() - startedAt,
        retryDelayMs: CHAT_CONFIG_LOCK_RETRY_DELAY_MS,
        pid: process.pid,
      });
      await delay(CHAT_CONFIG_LOCK_RETRY_DELAY_MS);
    }
  }

  appendRuntimeTestDiagnostic('runtime.chat_config_lock_timeout', {
    chatConfigPath,
    lockPath,
    attempts: CHAT_CONFIG_LOCK_MAX_RETRIES,
    waitedMs: Date.now() - startedAt,
    pid: process.pid,
  });

  throw Object.assign(
    new Error(`Timed out acquiring chat config lock for ${chatConfigPath}`),
    { code: 'LOCK_TIMEOUT' },
  );
}

async function commitTempFileIfMissing(
  tempPath: string,
  targetPath: string,
): Promise<'written' | 'existing'> {
  try {
    await fs.link(tempPath, targetPath);
    return 'written';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return 'existing';
    }
    throw error;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
};

const toWebSearchMode = (
  value: unknown,
): 'live' | 'cached' | 'disabled' | undefined => {
  if (typeof value === 'boolean') return value ? 'live' : 'disabled';
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (WEB_SEARCH_MODES.has(normalized)) {
    return normalized as 'live' | 'cached' | 'disabled';
  }
  if (normalized === 'true') return 'live';
  if (normalized === 'false') return 'disabled';
  return undefined;
};

function cloneConfig(input: RuntimeTomlConfig): RuntimeTomlConfig {
  return structuredClone(input) as RuntimeTomlConfig;
}

function getUsableContext7EnvApiKey(): string | undefined {
  const raw = process.env.CODEINFO_CONTEXT7_API_KEY;
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getUsableCodeinfoEnvValue(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env[key];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function logCheckedInMcpContractLoaded(params: {
  configPath: string;
  env?: NodeJS.ProcessEnv;
}) {
  const payload = {
    configPath: params.configPath,
    chatPortVar: 'CODEINFO_CHAT_MCP_PORT',
    agentsPortVar: 'CODEINFO_AGENTS_MCP_PORT',
    webPortVar: 'CODEINFO_WEB_MCP_PORT',
    playwrightUrlVar: 'CODEINFO_PLAYWRIGHT_MCP_URL',
    legacyFallbackUsed: false,
  };
  console.info(T07_CHECKED_IN_MCP_CONTRACT_LOADED, payload);
  append({
    level: 'info',
    message: T07_CHECKED_IN_MCP_CONTRACT_LOADED,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: payload,
  });
}

function replaceCodeinfoEnvPlaceholdersInString(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const directPlaceholder = value.trim();
  if (DIRECT_CODEINFO_ENV_PLACEHOLDERS.has(directPlaceholder)) {
    return resolveRequiredCodeinfoPlaceholderValue(directPlaceholder, env);
  }

  return value.replace(CODEINFO_ENV_PLACEHOLDER_PATTERN, (match, key) => {
    if (REQUIRED_MCP_PLACEHOLDER_KEYS.has(key)) {
      return resolveRequiredCodeinfoPlaceholderValue(key, env);
    }
    return getUsableCodeinfoEnvValue(key, env) ?? match;
  });
}

function assertNoUnresolvedRequiredMcpPlaceholders(value: unknown): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (DIRECT_CODEINFO_ENV_PLACEHOLDERS.has(trimmed)) {
      throw new Error(
        `RUNTIME_CONFIG_INVALID: Unresolved required MCP placeholder ${trimmed}`,
      );
    }
    for (const match of value.matchAll(CODEINFO_ENV_PLACEHOLDER_PATTERN)) {
      const key = match[1];
      if (key && REQUIRED_MCP_PLACEHOLDER_KEYS.has(key)) {
        throw new Error(
          `RUNTIME_CONFIG_INVALID: Unresolved required MCP placeholder ${key}`,
        );
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertNoUnresolvedRequiredMcpPlaceholders);
    return;
  }
  if (isRecord(value)) {
    Object.values(value).forEach(assertNoUnresolvedRequiredMcpPlaceholders);
  }
}

function replaceCodeinfoEnvPlaceholders(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  if (typeof value === 'string') {
    return replaceCodeinfoEnvPlaceholdersInString(value, env);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => replaceCodeinfoEnvPlaceholders(entry, env));
  }
  if (isRecord(value)) {
    const normalized: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      normalized[key] = replaceCodeinfoEnvPlaceholders(entryValue, env);
    }
    return normalized;
  }
  return value;
}

function isPlaceholderEquivalentContext7Key(value: unknown): boolean {
  return (
    typeof value === 'string' && CONTEXT7_PLACEHOLDER_API_KEYS.has(value.trim())
  );
}

function normalizeContext7Args(params: {
  args: unknown[];
  envApiKey: string | undefined;
}): { args: unknown[]; mode: Context7NormalizationMode } {
  const apiKeyIndex = params.args.findIndex((entry) => entry === '--api-key');
  if (apiKeyIndex === -1) {
    if (params.envApiKey) {
      return {
        args: [...params.args, '--api-key', params.envApiKey],
        mode: 'env_overlay',
      };
    }

    return {
      args: [...params.args],
      mode: 'no_key_fallback',
    };
  }

  const nextValue = params.args[apiKeyIndex + 1];
  if (typeof nextValue !== 'string') {
    return {
      args: [...params.args],
      mode: 'no_context7_definition',
    };
  }

  if (!isPlaceholderEquivalentContext7Key(nextValue)) {
    return {
      args: [...params.args],
      mode: 'explicit_key_preserved',
    };
  }

  if (params.envApiKey) {
    const normalizedArgs = [...params.args];
    normalizedArgs[apiKeyIndex + 1] = params.envApiKey;
    return {
      args: normalizedArgs,
      mode: 'env_overlay',
    };
  }

  return {
    args: [
      ...params.args.slice(0, apiKeyIndex),
      ...params.args.slice(apiKeyIndex + 2),
    ],
    mode: 'no_key_fallback',
  };
}

export function normalizeContext7RuntimeConfig(
  input: RuntimeTomlConfig,
): Context7NormalizationResult {
  const normalized = cloneConfig(input);
  if (!isRecord(normalized.mcp_servers)) {
    return { config: normalized, mode: 'no_context7_definition' };
  }

  const context7Definition = normalized.mcp_servers.context7;
  if (!isRecord(context7Definition)) {
    return { config: normalized, mode: 'no_context7_definition' };
  }

  if (
    hasOwn(context7Definition, 'url') ||
    hasOwn(context7Definition, 'http_headers')
  ) {
    return { config: normalized, mode: 'no_context7_definition' };
  }

  if (
    typeof context7Definition.command !== 'string' ||
    !Array.isArray(context7Definition.args)
  ) {
    return { config: normalized, mode: 'no_context7_definition' };
  }

  const result = normalizeContext7Args({
    args: context7Definition.args,
    envApiKey: getUsableContext7EnvApiKey(),
  });
  normalized.mcp_servers = {
    ...(normalized.mcp_servers as Record<string, unknown>),
    context7: {
      ...context7Definition,
      args: result.args,
    },
  };
  return {
    config: normalized,
    mode: result.mode,
  };
}

export function normalizeCodeinfoRuntimeConfigPlaceholders(
  input: RuntimeTomlConfig,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeTomlConfig {
  const normalized = replaceCodeinfoEnvPlaceholders(
    cloneConfig(input),
    env,
  ) as RuntimeTomlConfig;
  assertNoUnresolvedRequiredMcpPlaceholders(normalized);
  return normalized;
}

export function normalizeRuntimeConfig(
  input: RuntimeTomlConfig,
): RuntimeTomlConfig {
  const normalized = cloneConfig(input);

  const rawFeatures = isRecord(normalized.features) ? normalized.features : {};
  const features: Record<string, unknown> = { ...rawFeatures };
  const rawTools = normalized.tools;
  const hasCanonicalTools = hasOwn(normalized, 'tools');
  const hasCanonicalViewImage =
    isRecord(rawTools) && hasOwn(rawTools, 'view_image');
  const tools = isRecord(rawTools)
    ? { ...rawTools }
    : ({} as Record<string, unknown>);

  const viewImageAlias = hasOwn(features, 'view_image_tool')
    ? toBoolean(features.view_image_tool)
    : undefined;
  if (viewImageAlias !== undefined) {
    if (!hasCanonicalViewImage) {
      tools.view_image = viewImageAlias;
    }
    delete features.view_image_tool;
  }

  const hasCanonicalWebSearch = hasOwn(normalized, 'web_search');
  const rootWebSearchMode = hasOwn(normalized, 'web_search_mode')
    ? toWebSearchMode(normalized.web_search_mode)
    : undefined;
  const rootWebSearchAlias = hasOwn(normalized, 'web_search_request')
    ? toWebSearchMode(normalized.web_search_request)
    : undefined;
  const featureWebSearchAlias = hasOwn(features, 'web_search_request')
    ? toWebSearchMode(features.web_search_request)
    : undefined;
  if (!hasCanonicalWebSearch) {
    const aliasWebSearch =
      rootWebSearchMode ?? rootWebSearchAlias ?? featureWebSearchAlias;
    if (aliasWebSearch !== undefined) {
      normalized.web_search = aliasWebSearch;
    }
  }

  if (rootWebSearchMode !== undefined) {
    delete normalized.web_search_mode;
  }
  if (rootWebSearchAlias !== undefined) {
    delete normalized.web_search_request;
  }
  if (featureWebSearchAlias !== undefined) {
    delete features.web_search_request;
  }

  if (hasCanonicalTools) {
    if (isRecord(rawTools)) {
      if (Object.keys(tools).length > 0) {
        normalized.tools = tools;
      } else {
        delete normalized.tools;
      }
    } else {
      normalized.tools = rawTools;
    }
  } else if (Object.keys(tools).length > 0) {
    normalized.tools = tools;
  }

  if (Object.keys(features).length > 0) {
    normalized.features = features;
  } else if (hasOwn(normalized, 'features')) {
    delete normalized.features;
  }

  return normalized;
}

function parseTomlOrThrow(raw: string, configPath: string): RuntimeTomlConfig {
  let parsed: unknown;
  try {
    parsed = toml.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `RUNTIME_CONFIG_INVALID: Invalid TOML at ${configPath}: ${message}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      `RUNTIME_CONFIG_INVALID: Invalid TOML root at ${configPath}: expected table`,
    );
  }

  return normalizeRuntimeConfig(parsed);
}

export async function readAndNormalizeRuntimeTomlConfig(
  configPath: string,
  options?: { required?: boolean },
): Promise<RuntimeTomlConfig | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (!options?.required && code === 'ENOENT') {
      return undefined;
    }
    if (code === 'ENOENT') {
      throw new Error(
        `RUNTIME_CONFIG_MISSING: Missing TOML config at ${configPath}`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `RUNTIME_CONFIG_UNREADABLE: Unable to read TOML config at ${configPath}: ${message}`,
    );
  }

  return parseTomlOrThrow(raw, configPath);
}

const TOP_LEVEL_STRING_KEYS = new Set([
  'model',
  'model_reasoning_effort',
  'model_reasoning_summary',
  'model_provider',
  'approval_policy',
  'sandbox_mode',
  'personality',
  'cli_auth_credentials_store',
]);
const TOP_LEVEL_BOOLEAN_KEYS = new Set(['hide_agent_reasoning']);
const TOP_LEVEL_INTEGER_KEYS = new Set(['model_auto_compact_token_limit']);

const ALLOWED_WEB_SEARCH = new Set(['live', 'cached', 'disabled']);
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function createNullPrototypeRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function isUnsafeObjectKey(key: string): boolean {
  return UNSAFE_OBJECT_KEYS.has(key);
}

function collectRecord(
  input: RuntimeTomlConfig,
  key: string,
  pathLabel: string,
): Record<string, unknown> {
  const value = input[key];
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error(`invalid type at ${pathLabel}.${key}: expected table`);
  }
  const safeRecord = createNullPrototypeRecord();
  for (const [entryKey, entryValue] of Object.entries(value)) {
    safeRecord[entryKey] = entryValue;
  }
  return safeRecord;
}

function pushUnknownWarning(
  warnings: RuntimeConfigWarning[],
  pathLabel: string,
  key: string,
) {
  warnings.push({
    path: `${pathLabel}.${key}`,
    message: `Unknown key ${pathLabel}.${key}; preserved for forward compatibility`,
  });
}

export function mergeProjectsFromBaseIntoRuntime(
  baseConfig: RuntimeTomlConfig | undefined,
  runtimeConfig: RuntimeTomlConfig,
): RuntimeTomlConfig {
  const merged = cloneConfig(runtimeConfig);
  const baseProjects = isRecord(baseConfig?.projects)
    ? { ...(baseConfig?.projects as Record<string, unknown>) }
    : {};
  const runtimeProjects = isRecord(runtimeConfig.projects)
    ? { ...(runtimeConfig.projects as Record<string, unknown>) }
    : {};
  const effectiveProjects = { ...baseProjects, ...runtimeProjects };
  if (Object.keys(effectiveProjects).length > 0) {
    merged.projects = effectiveProjects;
  } else {
    delete merged.projects;
  }
  return merged;
}

function mergeConfigValue(baseValue: unknown, runtimeValue: unknown): unknown {
  if (runtimeValue === undefined) {
    return baseValue === undefined ? undefined : structuredClone(baseValue);
  }
  if (baseValue === undefined) {
    return structuredClone(runtimeValue);
  }
  if (Array.isArray(runtimeValue) || Array.isArray(baseValue)) {
    return structuredClone(runtimeValue);
  }
  if (isRecord(baseValue) && isRecord(runtimeValue)) {
    const mergedRecord: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(baseValue),
      ...Object.keys(runtimeValue),
    ]);
    for (const key of keys) {
      const mergedEntry = mergeConfigValue(baseValue[key], runtimeValue[key]);
      if (mergedEntry !== undefined) {
        mergedRecord[key] = mergedEntry;
      }
    }
    return mergedRecord;
  }
  return structuredClone(runtimeValue);
}

export function mergeRuntimeConfigWithBaseConfig(
  baseConfig: RuntimeTomlConfig | undefined,
  runtimeConfig: RuntimeTomlConfig,
): RuntimeMergeResult {
  const merged: RuntimeTomlConfig = {};
  const inheritedKeys: string[] = [];
  const runtimeOverrideKeys: string[] = [];
  const keys = new Set<string>([
    ...Object.keys(baseConfig ?? {}),
    ...Object.keys(runtimeConfig),
  ]);
  for (const key of keys) {
    const mergedValue = mergeConfigValue(baseConfig?.[key], runtimeConfig[key]);
    if (mergedValue !== undefined) {
      merged[key] = mergedValue;
    }
    if (baseConfig && hasOwn(baseConfig, key) && !hasOwn(runtimeConfig, key)) {
      inheritedKeys.push(key);
      continue;
    }
    if (baseConfig && hasOwn(baseConfig, key) && hasOwn(runtimeConfig, key)) {
      runtimeOverrideKeys.push(key);
    }
  }

  return { merged, inheritedKeys, runtimeOverrideKeys };
}

export function mergeRuntimeConfigLayers(
  layers: readonly (RuntimeTomlConfig | undefined)[],
): RuntimeMergeResult {
  const definedLayers = layers.filter(
    (layer): layer is RuntimeTomlConfig => layer !== undefined,
  );
  if (definedLayers.length === 0) {
    return {
      merged: createNullPrototypeRecord(),
      inheritedKeys: [],
      runtimeOverrideKeys: [],
    };
  }

  let merged = cloneConfig(definedLayers[0]);
  const inheritedKeys = new Set<string>();
  const runtimeOverrideKeys = new Set<string>();
  for (const layer of definedLayers.slice(1)) {
    const result = mergeRuntimeConfigWithBaseConfig(merged, layer);
    merged = result.merged;
    result.inheritedKeys.forEach((key) => inheritedKeys.add(key));
    result.runtimeOverrideKeys.forEach((key) => runtimeOverrideKeys.add(key));
  }

  return {
    merged,
    inheritedKeys: [...inheritedKeys],
    runtimeOverrideKeys: [...runtimeOverrideKeys],
  };
}

export function extractRuntimeConfigAppMetadata(params: {
  config: RuntimeTomlConfig;
  surface: RuntimeConfigSurface;
  warnings?: RuntimeConfigWarning[];
  pathLabel?: string;
}): RuntimeConfigAppMetadata {
  const pathLabel = params.pathLabel ?? params.surface;
  const warnings = params.warnings;
  const metadata: RuntimeConfigAppMetadata = {};
  const rawProvider = params.config[CODEINFO_PROVIDER_METADATA_KEY];

  if (rawProvider !== undefined) {
    if (typeof rawProvider !== 'string') {
      warnings?.push({
        path: `${pathLabel}.${CODEINFO_PROVIDER_METADATA_KEY}`,
        message: `${CODEINFO_PROVIDER_METADATA_KEY} must be a string when present; ignoring non-string metadata value`,
      });
    } else {
      const trimmedProvider = rawProvider.trim();
      if (trimmedProvider) {
        if (params.surface !== 'agent') {
          warnings?.push({
            path: `${pathLabel}.${CODEINFO_PROVIDER_METADATA_KEY}`,
            message: `${CODEINFO_PROVIDER_METADATA_KEY} is only supported on agent runtime config and was ignored on ${params.surface}`,
          });
        } else {
          metadata.codeinfoProvider = trimmedProvider;
        }
      }
    }
  }

  const rawEndpoint = params.config[CODEINFO_OPENAI_ENDPOINT_METADATA_KEY];
  if (rawEndpoint === undefined) {
    return metadata;
  }

  if (typeof rawEndpoint !== 'string') {
    throw new Error(
      `RUNTIME_CONFIG_INVALID: ${pathLabel}.${CODEINFO_OPENAI_ENDPOINT_METADATA_KEY}: expected a string`,
    );
  }

  metadata.codeinfoOpenAiEndpoint = parseOpenAiCompatEndpointConfig(
    rawEndpoint,
    {
      pathLabel: `${pathLabel}.${CODEINFO_OPENAI_ENDPOINT_METADATA_KEY}`,
    },
  );
  return metadata;
}

function stripAppOwnedRuntimeMetadata(params: {
  config: RuntimeTomlConfig;
  surface: RuntimeConfigSurface;
  warnings: RuntimeConfigWarning[];
}): { config: RuntimeTomlConfig; appMetadata: RuntimeConfigAppMetadata } {
  const appMetadata = extractRuntimeConfigAppMetadata({
    config: params.config,
    surface: params.surface,
    warnings: params.warnings,
    pathLabel: params.surface,
  });
  const sanitized = createNullPrototypeRecord();
  for (const [key, value] of Object.entries(params.config)) {
    if (key.startsWith(CODEINFO_METADATA_PREFIX)) {
      continue;
    }
    sanitized[key] = value;
  }
  return {
    config: sanitized,
    appMetadata,
  };
}

function applyManagedWebToolsToValidatedConfig(params: {
  config: RuntimeTomlConfig;
  provider: ChatProviderId;
  appMetadata?: RuntimeConfigAppMetadata;
  env?: NodeJS.ProcessEnv;
  warningPath: string;
}): { config: RuntimeTomlConfig; warnings: RuntimeConfigWarning[] } {
  const warning = buildManagedWebToolsWarning({
    provider: params.provider,
    webSearchMode: resolveConfiguredWebSearchMode(params.config),
    usesOpenAiCompatEndpoint:
      params.provider === 'codex'
        ? Boolean(params.appMetadata?.codeinfoOpenAiEndpoint)
        : false,
  });

  return {
    config: applyManagedWebToolsToRuntimeConfig({
      config: params.config,
      provider: params.provider,
      env: params.env,
      usesOpenAiCompatEndpoint:
        params.provider === 'codex'
          ? Boolean(params.appMetadata?.codeinfoOpenAiEndpoint)
          : false,
    }),
    warnings:
      typeof warning === 'string'
        ? [{ path: params.warningPath, message: warning }]
        : [],
  };
}

export function validateRuntimeConfig(
  input: RuntimeTomlConfig,
  params?: { pathLabel?: string },
): RuntimeConfigValidationResult {
  const pathLabel = params?.pathLabel ?? 'runtime';
  const warnings: RuntimeConfigWarning[] = [];
  const source = cloneConfig(input);
  const sanitized: RuntimeTomlConfig = createNullPrototypeRecord();

  for (const [key, value] of Object.entries(source)) {
    if (isUnsafeObjectKey(key)) {
      warnings.push({
        path: `${pathLabel}.${key}`,
        message: `Unsafe key ${pathLabel}.${key}; ignored to prevent prototype mutation`,
      });
      continue;
    }

    if (TOP_LEVEL_STRING_KEYS.has(key)) {
      if (typeof value !== 'string') {
        throw new Error(`invalid type at ${pathLabel}.${key}: expected string`);
      }
      sanitized[key] = value;
      continue;
    }

    if (TOP_LEVEL_BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') {
        throw new Error(
          `invalid type at ${pathLabel}.${key}: expected boolean`,
        );
      }
      sanitized[key] = value;
      continue;
    }

    if (TOP_LEVEL_INTEGER_KEYS.has(key)) {
      if (!Number.isInteger(value)) {
        throw new Error(
          `invalid type at ${pathLabel}.${key}: expected integer`,
        );
      }
      sanitized[key] = value;
      continue;
    }

    if (key === 'web_search' || key === 'web_search_mode') {
      if (typeof value !== 'string' || !ALLOWED_WEB_SEARCH.has(value)) {
        throw new Error(
          `invalid type at ${pathLabel}.${key}: expected one of live|cached|disabled`,
        );
      }
      sanitized.web_search = value;
      continue;
    }

    if (key === 'mcp_servers') {
      if (!isRecord(value)) {
        throw new Error(
          `invalid type at ${pathLabel}.mcp_servers: expected table`,
        );
      }
      sanitized.mcp_servers = value;
      continue;
    }

    if (key === 'model_providers') {
      if (!isRecord(value)) {
        throw new Error(
          `invalid type at ${pathLabel}.model_providers: expected table`,
        );
      }
      sanitized.model_providers = value;
      continue;
    }

    if (key === 'plugins') {
      if (!isRecord(value)) {
        throw new Error(`invalid type at ${pathLabel}.plugins: expected table`);
      }
      sanitized.plugins = value;
      continue;
    }

    if (key === 'tools') {
      const tools = collectRecord(source, key, pathLabel);
      const normalizedTools: Record<string, unknown> =
        createNullPrototypeRecord();
      for (const [toolKey, toolValue] of Object.entries(tools)) {
        if (isUnsafeObjectKey(toolKey)) {
          warnings.push({
            path: `${pathLabel}.tools.${toolKey}`,
            message: `Unsafe key ${pathLabel}.tools.${toolKey}; ignored to prevent prototype mutation`,
          });
          continue;
        }
        if (toolKey === 'view_image') {
          if (typeof toolValue !== 'boolean') {
            throw new Error(
              `invalid type at ${pathLabel}.tools.view_image: expected boolean`,
            );
          }
          normalizedTools.view_image = toolValue;
          continue;
        }
        pushUnknownWarning(warnings, `${pathLabel}.tools`, toolKey);
        normalizedTools[toolKey] = toolValue;
      }
      if (Object.keys(normalizedTools).length > 0) {
        sanitized.tools = normalizedTools;
      }
      continue;
    }

    if (key === 'features') {
      const features = collectRecord(source, key, pathLabel);
      const normalizedFeatures: Record<string, unknown> =
        createNullPrototypeRecord();
      for (const [featureKey, featureValue] of Object.entries(features)) {
        if (isUnsafeObjectKey(featureKey)) {
          warnings.push({
            path: `${pathLabel}.features.${featureKey}`,
            message: `Unsafe key ${pathLabel}.features.${featureKey}; ignored to prevent prototype mutation`,
          });
          continue;
        }
        if (
          featureKey === 'view_image_tool' ||
          featureKey === 'web_search_request' ||
          featureKey === 'fast_mode'
        ) {
          if (typeof featureValue !== 'boolean') {
            throw new Error(
              `invalid type at ${pathLabel}.features.${featureKey}: expected boolean`,
            );
          }
          normalizedFeatures[featureKey] = featureValue;
          continue;
        }
        pushUnknownWarning(warnings, `${pathLabel}.features`, featureKey);
        normalizedFeatures[featureKey] = featureValue;
      }
      if (Object.keys(normalizedFeatures).length > 0) {
        sanitized.features = normalizedFeatures;
      }
      continue;
    }

    if (key === 'projects') {
      const projects = collectRecord(source, key, pathLabel);
      const normalizedProjects: Record<string, unknown> =
        createNullPrototypeRecord();
      for (const [projectPath, projectValue] of Object.entries(projects)) {
        if (isUnsafeObjectKey(projectPath)) {
          warnings.push({
            path: `${pathLabel}.projects.${projectPath}`,
            message: `Unsafe key ${pathLabel}.projects.${projectPath}; ignored to prevent prototype mutation`,
          });
          continue;
        }
        if (!isRecord(projectValue)) {
          throw new Error(
            `invalid type at ${pathLabel}.projects.${projectPath}: expected table`,
          );
        }
        const normalizedProject: Record<string, unknown> =
          createNullPrototypeRecord();
        for (const [projectKey, projectEntryValue] of Object.entries(
          projectValue,
        )) {
          if (isUnsafeObjectKey(projectKey)) {
            warnings.push({
              path: `${pathLabel}.projects.${projectPath}.${projectKey}`,
              message: `Unsafe key ${pathLabel}.projects.${projectPath}.${projectKey}; ignored to prevent prototype mutation`,
            });
            continue;
          }
          if (projectKey === 'trust_level') {
            if (typeof projectEntryValue !== 'string') {
              throw new Error(
                `invalid type at ${pathLabel}.projects.${projectPath}.trust_level: expected string`,
              );
            }
            normalizedProject.trust_level = projectEntryValue;
            continue;
          }

          if (projectKey === 'cli_auth_credentials_store') {
            warnings.push({
              path: `${pathLabel}.projects.${projectPath}.${projectKey}`,
              message: `Misplaced key ${projectKey} under projects table; ignored`,
            });
            continue;
          }

          warnings.push({
            path: `${pathLabel}.projects.${projectPath}.${projectKey}`,
            message: `Unknown key ${projectKey} under projects table; preserved for forward compatibility`,
          });
          normalizedProject[projectKey] = projectEntryValue;
        }
        normalizedProjects[projectPath] = normalizedProject;
      }
      sanitized.projects = normalizedProjects;
      continue;
    }

    pushUnknownWarning(warnings, pathLabel, key);
    sanitized[key] = value;
  }

  return { config: normalizeRuntimeConfig(sanitized), warnings };
}

function mapResolutionError(
  error: unknown,
  params: {
    configPath: string;
    surface: RuntimeConfigSurface;
  },
): RuntimeConfigResolutionError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('RUNTIME_CONFIG_MISSING:')) {
    return new RuntimeConfigResolutionError({
      code: 'RUNTIME_CONFIG_MISSING',
      configPath: params.configPath,
      surface: params.surface,
      message,
    });
  }
  if (message.startsWith('RUNTIME_CONFIG_UNREADABLE:')) {
    return new RuntimeConfigResolutionError({
      code: 'RUNTIME_CONFIG_UNREADABLE',
      configPath: params.configPath,
      surface: params.surface,
      message,
    });
  }
  if (message.startsWith('RUNTIME_CONFIG_INVALID:')) {
    return new RuntimeConfigResolutionError({
      code: 'RUNTIME_CONFIG_INVALID',
      configPath: params.configPath,
      surface: params.surface,
      message,
    });
  }
  return new RuntimeConfigResolutionError({
    code: 'RUNTIME_CONFIG_VALIDATION_FAILED',
    configPath: params.configPath,
    surface: params.surface,
    message: `RUNTIME_CONFIG_VALIDATION_FAILED: ${message}`,
  });
}

function logValidationWarnings(warnings: RuntimeConfigWarning[]) {
  for (const warning of warnings) {
    console.warn(
      `[runtime-config] warning path=${warning.path} message=${warning.message}`,
    );
  }
}

function logTask9Bootstrap(params: {
  branch: ChatBootstrapBranch;
  codexHome: string;
  baseConfigPath: string;
  chatConfigPath: string;
  warning?: string;
  warningCode?: string;
  copied: boolean;
  generatedTemplate: boolean;
}) {
  const payload = {
    branch: params.branch,
    codexHome: params.codexHome,
    baseConfigPath: params.baseConfigPath,
    chatConfigPath: params.chatConfigPath,
    copied: params.copied,
    generatedTemplate: params.generatedTemplate,
    warning: params.warning,
    warningCode: params.warningCode,
  };
  console.info(T09_BOOTSTRAP_LOG_MARKER, payload);
  if (params.warning) {
    console.warn(T09_BOOTSTRAP_LOG_MARKER, payload);
  }
}

function logTask3Bootstrap(params: {
  chatConfigPath: string;
  outcome: 'seeded' | 'existing';
  success: boolean;
  warning?: string;
  warningCode?: string;
}) {
  const payload = {
    config_path: params.chatConfigPath,
    outcome: params.outcome,
    source: 'chat_template',
    success: params.success,
    warning: params.warning,
    warningCode: params.warningCode,
  };
  console.info(T03_CHAT_BOOTSTRAP_MARKER, payload);
  if (params.warning) {
    console.warn(T03_CHAT_BOOTSTRAP_MARKER, payload);
  }
}

async function cleanupPartialChatConfig(chatConfigPath: string) {
  await fs.rm(chatConfigPath, { force: true }).catch(() => undefined);
}

const toTomlScalar = (value: string | boolean): string =>
  typeof value === 'boolean' ? String(value) : toTomlQuoted(value);

const upsertRootTomlScalar = (
  rawConfig: string,
  key: string,
  value: string | boolean,
): string => {
  const rendered = `${key} = ${toTomlScalar(value)}`;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existingLine = new RegExp(`^${escapedKey}\\s*=.*$`, 'mu');
  if (existingLine.test(rawConfig)) {
    return rawConfig.replace(existingLine, rendered);
  }

  const lines = rawConfig.split('\n');
  const firstTableIndex = lines.findIndex((line) =>
    line.trimStart().startsWith('['),
  );
  const insertIndex = firstTableIndex === -1 ? lines.length : firstTableIndex;
  lines.splice(insertIndex, 0, rendered);
  return lines.join('\n');
};

const applyCodexChatConfigRootOverrides = (
  rawConfig: string,
  overrides: CodexChatConfigRootOverrides,
): string => {
  let next = rawConfig;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    next = upsertRootTomlScalar(next, key, value);
  }
  return next;
};

const stripReservedProviderChatMcpServers = (
  config: RuntimeTomlConfig,
  provider: ChatProviderId,
): RuntimeTomlConfig => {
  const stripped = cloneConfig(config);
  const reservedNames = new Set(
    Object.keys(RESERVED_PROVIDER_CHAT_MCP_BLOCKS[provider]),
  );
  if (!isRecord(stripped.mcp_servers)) {
    return stripped;
  }

  const nextMcpServers: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(stripped.mcp_servers)) {
    if (!reservedNames.has(name)) {
      nextMcpServers[name] = definition;
    }
  }

  if (Object.keys(nextMcpServers).length === 0) {
    delete stripped.mcp_servers;
  } else {
    stripped.mcp_servers = nextMcpServers;
  }
  return stripped;
};

const appendTomlBlocks = (rawConfig: string, blocks: string[]): string => {
  const normalizedBlocks = blocks
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  if (normalizedBlocks.length === 0) {
    return rawConfig;
  }

  const trimmed = rawConfig.trimEnd();
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : '';
  return `${prefix}${normalizedBlocks.join('\n\n')}\n`;
};

const stripManagedWebToolsBlocksFromRawConfig = (
  rawConfig: string,
  env: NodeJS.ProcessEnv = process.env,
): { rawConfig: string; hasManualWebToolsBlock: boolean } => {
  const blockPattern =
    /(?:^|\r?\n)\s*\[mcp_servers\.web_tools\]\r?\n[\s\S]*?(?=\r?\n\s*\[[^\r\n]+\]|$)/gu;
  const normalizedNewlines = rawConfig.includes('\r\n') ? '\r\n' : '\n';
  let hasManualWebToolsBlock = false;

  const stripped = rawConfig.replace(blockPattern, (block) => {
    try {
      const normalizedBlock = replaceCodeinfoEnvPlaceholdersInString(block, env);
      const parsedBlock = parseTomlOrThrow(
        normalizedBlock,
        '<inline web_tools block>',
      );
      const blockMcpServers = isRecord(parsedBlock.mcp_servers)
        ? parsedBlock.mcp_servers
        : undefined;
      const webToolsDefinition = isRecord(blockMcpServers)
        ? blockMcpServers.web_tools
        : undefined;
      if (isManagedWebToolsMcpServerDefinition(webToolsDefinition, env)) {
        return normalizedNewlines;
      }
    } catch {
      // Preserve unparseable source blocks rather than risk deleting a manual entry.
    }

    hasManualWebToolsBlock = true;
    return block;
  });

  const collapsed = stripped
    .replace(/\r?\n(?:\r?\n){2,}/gu, `${normalizedNewlines}${normalizedNewlines}`)
    .replace(/\s+$/u, '');
  return {
    rawConfig: `${collapsed}${normalizedNewlines}`,
    hasManualWebToolsBlock,
  };
};

async function maybeAugmentExistingProviderChatConfig(params: {
  provider: ChatProviderId;
  chatConfigPath: string;
}): Promise<ChatConfigAugmentResult> {
  const reservedBlocks = RESERVED_PROVIDER_CHAT_MCP_BLOCKS[params.provider];
  const reservedNames = Object.keys(reservedBlocks);
  if (reservedNames.length === 0) {
    return { outcome: 'noop' };
  }

  let releaseLock: (() => Promise<void>) | undefined;
  try {
    try {
      releaseLock = await acquireChatConfigLock(params.chatConfigPath);
    } catch (error) {
      if ((error as { code?: string }).code === 'LOCK_TIMEOUT') {
        return {
          outcome: 'failed',
          warning:
            error instanceof Error
              ? error.message
              : 'Timed out acquiring chat config lock',
          warningCode: 'LOCK_TIMEOUT',
        };
      }
      throw error;
    }

    let rawConfig: string;
    try {
      rawConfig = await fs.readFile(params.chatConfigPath, 'utf8');
    } catch {
      return { outcome: 'noop' };
    }

    let currentConfig: RuntimeTomlConfig;
    try {
      currentConfig = parseTomlOrThrow(rawConfig, params.chatConfigPath);
    } catch {
      return { outcome: 'noop' };
    }

    let templateConfig: RuntimeTomlConfig;
    try {
      templateConfig = parseTomlOrThrow(
        CHAT_CONFIG_TEMPLATES[params.provider],
        `CHAT_CONFIG_TEMPLATES.${params.provider}`,
      );
    } catch (error) {
      return {
        outcome: 'failed',
        warning:
          error instanceof Error
            ? error.message
            : 'Failed to parse provider chat config template',
      };
    }

    const currentMcpServers = isRecord(currentConfig.mcp_servers)
      ? currentConfig.mcp_servers
      : undefined;
    const missingReservedNames = reservedNames.filter(
      (name) => !isRecord(currentMcpServers?.[name]),
    );
    if (missingReservedNames.length === 0) {
      return { outcome: 'noop' };
    }

    const currentWithoutReserved = stripReservedProviderChatMcpServers(
      currentConfig,
      params.provider,
    );
    const templateWithoutReserved = stripReservedProviderChatMcpServers(
      templateConfig,
      params.provider,
    );
    if (
      !isDeepStrictEqual(
        normalizeRuntimeConfig(currentWithoutReserved),
        normalizeRuntimeConfig(templateWithoutReserved),
      )
    ) {
      return { outcome: 'noop' };
    }

    const nextRawConfig = appendTomlBlocks(
      rawConfig,
      missingReservedNames.map((name) => reservedBlocks[name]),
    );
    const tempPath = buildChatConfigTempPath(params.chatConfigPath);
    try {
      await fs.writeFile(tempPath, nextRawConfig, {
        encoding: 'utf8',
        flag: 'wx',
      });
      const currentRawConfig = await fs.readFile(params.chatConfigPath, 'utf8');
      if (currentRawConfig !== rawConfig) {
        return {
          outcome: 'failed',
          warning:
            'Chat config changed while augmenting reserved MCP blocks; leaving newer file untouched',
          warningCode: 'CONFIG_CHANGED',
        };
      }
      await fs.rename(tempPath, params.chatConfigPath);
      return { outcome: 'augmented' };
    } catch (error) {
      return {
        outcome: 'failed',
        warning:
          error instanceof Error
            ? error.message
            : 'Failed to augment existing chat config with reserved MCP blocks',
        warningCode: (error as { code?: string }).code,
      };
    } finally {
      await cleanupPartialChatConfig(tempPath);
    }
  } finally {
    await releaseLock?.();
  }
}

function readProviderChatConfigSync(params: {
  provider: ChatProviderId;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
}): ProviderChatDefaultsSnapshot {
  const { providerHome, chatConfigPath } = getProviderChatConfigPath(params);
  try {
    const raw = fsSync.readFileSync(chatConfigPath, 'utf8');
    return {
      provider: params.provider,
      providerHome,
      chatConfigPath,
      config: parseTomlOrThrow(raw, chatConfigPath),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        provider: params.provider,
        providerHome,
        chatConfigPath,
      };
    }
    throw error;
  }
}

export function loadProviderChatDefaultsSnapshotSync(params: {
  provider: ChatProviderId;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
}): ProviderChatDefaultsSnapshot {
  return readProviderChatConfigSync(params);
}

export async function resolveMergedAndValidatedRuntimeConfig(params: {
  surface: RuntimeConfigSurface;
  provider?: ChatProviderId;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
  runtimeConfigPath: string;
  runtimeConfigRequired?: boolean;
}): Promise<RuntimeConfigValidationResult> {
  const provider = params.provider ?? 'codex';
  const { providerHome, baseConfigPath, repoLocalConfigPath } =
    getProviderBaseConfigPath({
      provider,
      codexHome: params.codexHome,
      copilotHome: params.copilotHome,
      lmstudioHome: params.lmstudioHome,
    });
  const startedAt = Date.now();
  appendRuntimeTestDiagnostic('runtime.runtime_config_resolution_begin', {
    surface: params.surface,
    provider,
    providerHome,
    runtimeConfigPath: params.runtimeConfigPath,
    repoLocalConfigPath,
    baseConfigPath,
    runtimeConfigRequired: params.runtimeConfigRequired ?? true,
  });
  try {
    const [repoLocalConfig, baseConfig, runtimeConfig] = await Promise.all([
      readAndNormalizeRuntimeTomlConfig(repoLocalConfigPath),
      readAndNormalizeRuntimeTomlConfig(baseConfigPath),
      readAndNormalizeRuntimeTomlConfig(params.runtimeConfigPath, {
        required: params.runtimeConfigRequired ?? true,
      }),
    ]);
    const mergeResult = mergeRuntimeConfigLayers(
      [repoLocalConfig, baseConfig, runtimeConfig].filter(
        (config): config is RuntimeTomlConfig => config !== undefined,
      ),
    );
    const metadataWarnings: RuntimeConfigWarning[] = [];
    const stripped = stripAppOwnedRuntimeMetadata({
      config: mergeResult.merged,
      surface: params.surface,
      warnings: metadataWarnings,
    });
    const overrideProvider = stripped.appMetadata.codeinfoProvider?.trim() ?? '';
    let effectiveProvider: ChatProviderId = provider;
    if (isChatProviderId(overrideProvider)) {
      effectiveProvider = overrideProvider;
    }
    if (stripped.appMetadata.codeinfoOpenAiEndpoint) {
      validateOpenAiCompatEndpointConfigForProvider({
        endpoint: stripped.appMetadata.codeinfoOpenAiEndpoint,
        provider: effectiveProvider,
        pathLabel: `${params.surface}.${CODEINFO_OPENAI_ENDPOINT_METADATA_KEY}`,
      });
    }
    const scopedEnv = getScopedProcessEnv(process.env);
    const placeholderResult = normalizeCodeinfoRuntimeConfigPlaceholders(
      stripped.config,
      scopedEnv,
    );
    const context7Result = normalizeContext7RuntimeConfig(placeholderResult);
    const validated = validateRuntimeConfig(context7Result.config, {
      pathLabel: params.surface,
    });
    validated.warnings.unshift(...metadataWarnings);
    validated.appMetadata = stripped.appMetadata;
    const managedWebToolsResult = applyManagedWebToolsToValidatedConfig({
      config: validated.config,
      provider: effectiveProvider,
      appMetadata: stripped.appMetadata,
      env: scopedEnv,
      warningPath: `${params.surface}.mcp_servers.web_tools`,
    });
    validated.config = managedWebToolsResult.config;
    validated.warnings.push(...managedWebToolsResult.warnings);
    logValidationWarnings(validated.warnings);
    console.info(T04_RUNTIME_INHERITANCE_MARKER, {
      surface: params.surface,
      provider,
      inherited_keys: mergeResult.inheritedKeys,
      runtime_override_keys: mergeResult.runtimeOverrideKeys,
      success: true,
    });
    console.info(T05_CONTEXT7_NORMALIZED_MARKER, {
      mode: context7Result.mode,
      surface: params.surface,
      success: true,
    });
    logCheckedInMcpContractLoaded({
      configPath: params.runtimeConfigPath,
      env: process.env,
    });
    console.info(T04_SUCCESS_LOG, {
      surface: params.surface,
      provider,
      providerHome,
      runtimeConfigPath: params.runtimeConfigPath,
      warningCount: validated.warnings.length,
    });
    appendRuntimeTestDiagnostic('runtime.runtime_config_resolution_complete', {
      surface: params.surface,
      provider,
      providerHome,
      runtimeConfigPath: params.runtimeConfigPath,
      warningCount: validated.warnings.length,
      durationMs: Date.now() - startedAt,
    });
    return validated;
  } catch (error) {
    const mapped = mapResolutionError(error, {
      configPath: params.runtimeConfigPath,
      surface: params.surface,
    });
    console.error(
      `${T04_ERROR_LOG} surface=${mapped.surface} code=${mapped.code}`,
    );
    appendRuntimeTestDiagnostic('runtime.runtime_config_resolution_failed', {
      surface: mapped.surface,
      provider,
      providerHome,
      runtimeConfigPath: params.runtimeConfigPath,
      code: mapped.code,
      reason: mapped.message,
      durationMs: Date.now() - startedAt,
    });
    throw mapped;
  }
}

export async function resolveAgentRuntimeConfig(params: {
  provider?: ChatProviderId;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
  agentConfigPath: string;
}): Promise<RuntimeConfigValidationResult> {
  return resolveMergedAndValidatedRuntimeConfig({
    surface: 'agent',
    provider: params.provider,
    codexHome: params.codexHome,
    copilotHome: params.copilotHome,
    lmstudioHome: params.lmstudioHome,
    runtimeConfigPath: params.agentConfigPath,
  });
}

export async function resolveChatRuntimeConfig(params?: {
  provider?: ChatProviderId;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
}): Promise<RuntimeConfigValidationResult> {
  const provider = params?.provider ?? 'codex';
  const { providerHome, chatConfigPath } = getProviderChatConfigPath({
    provider,
    codexHome: params?.codexHome,
    copilotHome: params?.copilotHome,
    lmstudioHome: params?.lmstudioHome,
  });
  return resolveMergedAndValidatedRuntimeConfig({
    surface: 'chat',
    provider,
    codexHome: provider === 'codex' ? providerHome : params?.codexHome,
    copilotHome: provider === 'copilot' ? providerHome : params?.copilotHome,
    lmstudioHome: provider === 'lmstudio' ? providerHome : params?.lmstudioHome,
    runtimeConfigPath: chatConfigPath,
    runtimeConfigRequired: provider === 'codex',
  });
}

export async function resolveAgentConfigPathByName(
  agentName: string,
): Promise<string | undefined> {
  const agents = await discoverAgents({ seedAuth: false });
  return agents.find((agent) => agent.name === agentName)?.configPath;
}

export async function ensureChatRuntimeConfigBootstrapped(params?: {
  codexHome?: string;
}): Promise<{
  codexHome: string;
  baseConfigPath: string;
  chatConfigPath: string;
  copied: boolean;
  generatedTemplate: boolean;
  branch: ChatBootstrapBranch;
}> {
  const result = await ensureProviderChatConfigBootstrapped({
    provider: 'codex',
    codexHome: params?.codexHome,
  });

  return {
    codexHome: result.providerHome,
    baseConfigPath: getCodexConfigPathForHome(result.providerHome),
    chatConfigPath: result.chatConfigPath,
    copied: false,
    generatedTemplate: result.generatedTemplate,
    branch: result.branch,
  };
}

export async function ensureProviderChatConfigBootstrapped(params: {
  provider: ChatProviderId;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
}): Promise<{
  provider: ChatProviderId;
  providerHome: string;
  chatConfigPath: string;
  generatedTemplate: boolean;
  branch: ChatBootstrapBranch;
}> {
  const { providerHome, chatConfigPath } = getProviderChatConfigPath(params);
  const baseConfigPath =
    params.provider === 'codex'
      ? getCodexConfigPathForHome(providerHome)
      : chatConfigPath;
  appendRuntimeTestDiagnostic('runtime.chat_config_bootstrap_begin', {
    provider: params.provider,
    providerHome,
    baseConfigPath,
    chatConfigPath,
  });
  const emitBootstrapComplete = (paramsForLog: {
    branch: ChatBootstrapBranch;
    generatedTemplate: boolean;
    warning?: string;
    warningCode?: string;
  }) => {
    appendRuntimeTestDiagnostic('runtime.chat_config_bootstrap_complete', {
      provider: params.provider,
      providerHome,
      baseConfigPath,
      chatConfigPath,
      branch: paramsForLog.branch,
      generatedTemplate: paramsForLog.generatedTemplate,
      warning: paramsForLog.warning ?? null,
      warningCode: paramsForLog.warningCode ?? null,
    });
  };

  const chatExists = await fs.stat(chatConfigPath).then(
    () => true,
    (error: unknown) => {
      if ((error as { code?: string }).code === 'ENOENT') return false;
      const code = (error as { code?: string }).code;
      const warning =
        error instanceof Error ? error.message : 'Failed to stat chat config';
      logTask9Bootstrap({
        branch: 'chat_stat_failed',
        codexHome: providerHome,
        baseConfigPath,
        chatConfigPath,
        copied: false,
        generatedTemplate: false,
        warning,
        warningCode: code,
      });
      throw error;
    },
  );

  if (chatExists) {
    const augmentResult = await maybeAugmentExistingProviderChatConfig({
      provider: params.provider,
      chatConfigPath,
    });
    const branch =
      augmentResult.outcome === 'augmented'
        ? 'existing_augmented'
        : augmentResult.outcome === 'failed'
          ? 'existing_augment_failed'
          : 'existing_noop';
    logTask9Bootstrap({
      branch,
      codexHome: providerHome,
      baseConfigPath,
      chatConfigPath,
      copied: false,
      generatedTemplate: false,
      warning: augmentResult.warning,
      warningCode: augmentResult.warningCode,
    });
    logTask3Bootstrap({
      chatConfigPath,
      outcome: 'existing',
      success: augmentResult.outcome !== 'failed',
      warning: augmentResult.warning,
      warningCode: augmentResult.warningCode,
    });
    emitBootstrapComplete({
      branch,
      generatedTemplate: false,
      warning: augmentResult.warning,
      warningCode: augmentResult.warningCode,
    });
    return {
      provider: params.provider,
      providerHome,
      chatConfigPath,
      generatedTemplate: false,
      branch,
    };
  }

  await fs
    .mkdir(path.dirname(chatConfigPath), { recursive: true })
    .catch((error: unknown) => {
      const code = (error as { code?: string }).code;
      const warning =
        error instanceof Error
          ? error.message
          : 'Failed to create chat config directory';
      logTask9Bootstrap({
        branch: 'chat_dir_create_failed',
        codexHome: providerHome,
        baseConfigPath,
        chatConfigPath,
        copied: false,
        generatedTemplate: false,
        warning,
        warningCode: code,
      });
      throw error;
    });

  const tempPath = buildChatConfigTempPath(chatConfigPath);
  try {
    await fs.writeFile(tempPath, CHAT_CONFIG_TEMPLATES[params.provider], {
      encoding: 'utf8',
      flag: 'wx',
    });
    const commitResult = await commitTempFileIfMissing(
      tempPath,
      chatConfigPath,
    );
    if (commitResult === 'existing') {
      logTask9Bootstrap({
        branch: 'existing_noop',
        codexHome: providerHome,
        baseConfigPath,
        chatConfigPath,
        copied: false,
        generatedTemplate: false,
      });
      logTask3Bootstrap({
        chatConfigPath,
        outcome: 'existing',
        success: true,
      });
      emitBootstrapComplete({
        branch: 'existing_noop',
        generatedTemplate: false,
      });
      return {
        provider: params.provider,
        providerHome,
        chatConfigPath,
        generatedTemplate: false,
        branch: 'existing_noop',
      };
    }
    logTask9Bootstrap({
      branch: 'generated_template',
      codexHome: providerHome,
      baseConfigPath,
      chatConfigPath,
      copied: false,
      generatedTemplate: true,
    });
    logTask3Bootstrap({
      chatConfigPath,
      outcome: 'seeded',
      success: true,
    });
    emitBootstrapComplete({
      branch: 'generated_template',
      generatedTemplate: true,
    });
    return {
      provider: params.provider,
      providerHome,
      chatConfigPath,
      generatedTemplate: true,
      branch: 'generated_template',
    };
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') {
      logTask9Bootstrap({
        branch: 'existing_noop',
        codexHome: providerHome,
        baseConfigPath,
        chatConfigPath,
        copied: false,
        generatedTemplate: false,
      });
      logTask3Bootstrap({
        chatConfigPath,
        outcome: 'existing',
        success: true,
      });
      emitBootstrapComplete({
        branch: 'existing_noop',
        generatedTemplate: false,
      });
      return {
        provider: params.provider,
        providerHome,
        chatConfigPath,
        generatedTemplate: false,
        branch: 'existing_noop',
      };
    }
    const code = (error as { code?: string }).code;
    const warning =
      error instanceof Error ? error.message : 'Failed to write chat template';
    logTask9Bootstrap({
      branch: 'template_write_failed',
      codexHome: providerHome,
      baseConfigPath,
      chatConfigPath,
      copied: false,
      generatedTemplate: false,
      warning,
      warningCode: code,
    });
    console.warn(T03_CHAT_BOOTSTRAP_MARKER, {
      config_path: chatConfigPath,
      outcome: 'seeded',
      source: 'chat_template',
      success: false,
      warning,
      warningCode: code,
    });
    emitBootstrapComplete({
      branch: 'template_write_failed',
      generatedTemplate: false,
      warning,
      warningCode: code,
    });
    throw error;
  } finally {
    await cleanupPartialChatConfig(tempPath);
  }
}

export async function materializeRepositoryBackedCodexChatHome(params: {
  conversationId: string;
  codexHome?: string;
  overrides: CodexChatConfigRootOverrides;
  injectWebTools?: boolean;
}): Promise<{
  sourceCodexHome: string;
  runtimeCodexHome: string;
  baseConfigPath: string;
  chatConfigPath: string;
}> {
  const sourceCodexHome = resolveCodexHome(params.codexHome);
  const sourceBaseConfigPath = getCodexConfigPathForHome(sourceCodexHome);
  const sourceChatConfigPath = getCodexChatConfigPathForHome(sourceCodexHome);
  const sourceAuthPath = getCodexAuthPathForHome(sourceCodexHome);

  await fs.mkdir(sourceCodexHome, { recursive: true });
  await fs
    .writeFile(sourceBaseConfigPath, buildDefaultCodexConfig(), {
      encoding: 'utf8',
      flag: 'wx',
    })
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    });
  await ensureProviderChatConfigBootstrapped({
    provider: 'codex',
    codexHome: sourceCodexHome,
  });

  const runtimeCodexHome = path.join(
    sourceCodexHome,
    '.codeinfo-chat-runtimes',
    encodeCodexRuntimeHomeSegment(params.conversationId),
  );
  const runtimeBaseConfigPath = getCodexConfigPathForHome(runtimeCodexHome);
  const runtimeChatConfigPath = getCodexChatConfigPathForHome(runtimeCodexHome);
  const runtimeAuthPath = getCodexAuthPathForHome(runtimeCodexHome);

  try {
    await fs.mkdir(path.dirname(runtimeChatConfigPath), { recursive: true });

    const [baseConfigRaw, chatConfigRaw] = await Promise.all([
      fs.readFile(sourceBaseConfigPath, 'utf8'),
      fs.readFile(sourceChatConfigPath, 'utf8'),
    ]);
    const strippedWebTools = stripManagedWebToolsBlocksFromRawConfig(
      chatConfigRaw,
      process.env,
    );
    const runtimeChatConfig = applyCodexChatConfigRootOverrides(
      strippedWebTools.rawConfig,
      params.overrides,
    );
    const shouldAppendManagedWebTools =
      params.injectWebTools && !strippedWebTools.hasManualWebToolsBlock;
    const runtimeChatConfigWithManagedWebTools = shouldAppendManagedWebTools
      ? appendTomlBlocks(runtimeChatConfig, [WEB_TOOLS_MCP_SERVER_BLOCK])
      : runtimeChatConfig;
    const normalizedRuntimeChatConfig =
      replaceCodeinfoEnvPlaceholdersInString(
        runtimeChatConfigWithManagedWebTools,
        process.env,
      );
    assertNoUnresolvedRequiredMcpPlaceholders(normalizedRuntimeChatConfig);

    await Promise.all([
      fs.writeFile(runtimeBaseConfigPath, baseConfigRaw, 'utf8'),
      fs.writeFile(runtimeChatConfigPath, normalizedRuntimeChatConfig, 'utf8'),
    ]);

    const authConfigRaw = await fs
      .readFile(sourceAuthPath, 'utf8')
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return undefined;
        }
        throw error;
      });
    if (typeof authConfigRaw === 'string') {
      await fs.writeFile(runtimeAuthPath, authConfigRaw, 'utf8');
    }

    return {
      sourceCodexHome,
      runtimeCodexHome,
      baseConfigPath: runtimeBaseConfigPath,
      chatConfigPath: runtimeChatConfigPath,
    };
  } catch (error) {
    await fs.rm(runtimeCodexHome, { recursive: true, force: true });
    throw mapRepositoryBackedCodexHomeError({
      error,
      configPath: runtimeChatConfigPath,
    });
  }
}

export async function ensureAllProviderChatConfigsBootstrapped(params?: {
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
}): Promise<ProviderChatDefaultsSnapshot[]> {
  const providers: ChatProviderId[] = ['codex', 'copilot', 'lmstudio'];
  const results = await Promise.all(
    providers.map(async (provider) => {
      try {
        if (provider === 'codex') {
          ensureCodexConfigSeeded();
        } else if (provider === 'copilot') {
          await ensureCopilotBaseConfigSeeded(params?.copilotHome);
        } else {
          await ensureLmStudioBaseConfigSeeded(params?.lmstudioHome);
        }

        const seeded = await ensureProviderChatConfigBootstrapped({
          provider,
          codexHome: params?.codexHome,
          copilotHome: params?.copilotHome,
          lmstudioHome: params?.lmstudioHome,
        });
        const snapshot = readProviderChatConfigSync({
          provider,
          codexHome:
            provider === 'codex' ? seeded.providerHome : params?.codexHome,
          copilotHome:
            provider === 'copilot' ? seeded.providerHome : params?.copilotHome,
          lmstudioHome:
            provider === 'lmstudio'
              ? seeded.providerHome
              : params?.lmstudioHome,
        });
        providerBootstrapStatuses[provider] = {
          provider,
          healthy: true,
          warnings: [],
        };
        return snapshot;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        providerBootstrapStatuses[provider] = {
          provider,
          healthy: false,
          reason,
          warnings: [
            `Provider "${provider}" bootstrap degraded during startup: ${reason}`,
          ],
        };
        console.warn(
          `[runtime-config] provider bootstrap degraded provider=${provider} reason=${reason}`,
        );
        return undefined;
      }
    }),
  );
  return results.filter(Boolean) as ProviderChatDefaultsSnapshot[];
}

export function getProviderBootstrapStatus(
  provider: ChatProviderId,
): ProviderBootstrapStatus {
  const scoped = getScopedProviderBootstrapStatusOverride(provider);
  if (scoped) {
    return {
      provider,
      healthy: scoped.healthy ?? true,
      ...(scoped.reason ? { reason: scoped.reason } : {}),
      warnings: [...(scoped.warnings ?? [])],
    };
  }
  const status = providerBootstrapStatuses[provider];
  return {
    provider,
    healthy: status.healthy,
    ...(status.reason ? { reason: status.reason } : {}),
    warnings: [...status.warnings],
  };
}

export function __setProviderBootstrapStatusForTests(
  provider: ChatProviderId,
  status: Partial<ProviderBootstrapStatus>,
) {
  if (hasActiveTestOverrideScope()) {
    enterTestOverrideScope({
      providerBootstrapStatuses: {
        [provider]: {
          healthy: status.healthy ?? true,
          reason: status.reason,
          warnings: [...(status.warnings ?? [])],
        },
      },
    });
    return;
  }
  providerBootstrapStatuses[provider] = {
    provider,
    healthy: status.healthy ?? true,
    reason: status.reason,
    warnings: [...(status.warnings ?? [])],
  };
}

export function __resetProviderBootstrapStatusForTests() {
  if (hasActiveTestOverrideScope()) {
    enterTestOverrideScope({
      providerBootstrapStatuses: {
        codex: null,
        copilot: null,
        lmstudio: null,
      },
    });
    return;
  }
  for (const provider of ['codex', 'copilot', 'lmstudio'] as const) {
    providerBootstrapStatuses[provider] = {
      provider,
      healthy: true,
      warnings: [],
    };
  }
}

type ProjectTrustTable = Record<string, { trust_level?: unknown }>;

function toTomlQuoted(value: string): string {
  return JSON.stringify(value);
}

function buildProjectsOnlyToml(projects: ProjectTrustTable): string {
  const lines: string[] = ['[projects]'];
  for (const projectPath of Object.keys(projects).sort()) {
    lines.push(`[projects.${toTomlQuoted(projectPath)}]`);
    const trustLevel = projects[projectPath]?.trust_level;
    if (typeof trustLevel === 'string') {
      lines.push(`trust_level = ${toTomlQuoted(trustLevel)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export async function minimizeBaseConfigToProjectsOnly(params?: {
  codexHome?: string;
}): Promise<{
  codexHome: string;
  baseConfigPath: string;
  chatConfigPath: string;
  projectCount: number;
}> {
  const codexHome = resolveCodexHome(params?.codexHome);
  const baseConfigPath = getCodexConfigPathForHome(codexHome);
  const chatConfigPath = getCodexChatConfigPathForHome(codexHome);

  try {
    await fs.access(chatConfigPath, fsConstants.R_OK);
  } catch {
    console.error(
      `${T22_ERROR_LOG} reason=missing_chat_config chatConfigPath=${chatConfigPath}`,
    );
    throw new Error(
      `T22_CHAT_CONFIG_MISSING: Missing required chat config at ${chatConfigPath}`,
    );
  }

  try {
    const normalizedBase = await readAndNormalizeRuntimeTomlConfig(
      baseConfigPath,
      {
        required: true,
      },
    );
    const projects = isRecord(normalizedBase?.projects)
      ? (normalizedBase.projects as ProjectTrustTable)
      : {};
    const minimizedToml = buildProjectsOnlyToml(projects);
    await fs.writeFile(baseConfigPath, minimizedToml, 'utf8');
    console.info(T22_SUCCESS_LOG, {
      codexHome,
      baseConfigPath,
      chatConfigPath,
      projectCount: Object.keys(projects).length,
    });
    return {
      codexHome,
      baseConfigPath,
      chatConfigPath,
      projectCount: Object.keys(projects).length,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('T22_CHAT_CONFIG_MISSING:')
    ) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `${T22_ERROR_LOG} reason=unexpected_failure message=${message}`,
    );
    throw error;
  }
}

export async function loadRuntimeConfigSnapshot(params?: {
  provider?: ChatProviderId;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
  bootstrapChatConfig?: boolean;
  agentName?: string;
  agentConfigPath?: string;
}): Promise<RuntimeConfigSnapshot> {
  const provider = params?.provider ?? 'codex';
  const { providerHome, baseConfigPath, repoLocalConfigPath } =
    getProviderBaseConfigPath({
      provider,
      codexHome: params?.codexHome,
      copilotHome: params?.copilotHome,
      lmstudioHome: params?.lmstudioHome,
    });
  const { chatConfigPath } = getProviderChatConfigPath({
    provider,
    codexHome: params?.codexHome,
    copilotHome: params?.copilotHome,
    lmstudioHome: params?.lmstudioHome,
  });
  const bootstrapChatConfig = params?.bootstrapChatConfig ?? true;

  let agentConfigPath = params?.agentConfigPath;
  if (!agentConfigPath && params?.agentName) {
    agentConfigPath = await resolveAgentConfigPathByName(params.agentName);
  }

  try {
    if (bootstrapChatConfig) {
      await ensureProviderChatConfigBootstrapped({
        provider,
        codexHome: params?.codexHome,
        copilotHome: params?.copilotHome,
        lmstudioHome: params?.lmstudioHome,
      });
    }

    const [repoLocalConfig, baseConfig, chatConfig, agentConfig] =
      await Promise.all([
        readAndNormalizeRuntimeTomlConfig(repoLocalConfigPath),
        readAndNormalizeRuntimeTomlConfig(baseConfigPath),
        readAndNormalizeRuntimeTomlConfig(chatConfigPath),
        agentConfigPath
          ? readAndNormalizeRuntimeTomlConfig(agentConfigPath, {
              required: true,
            })
          : Promise.resolve(undefined),
      ]);

    console.info(T03_SUCCESS_LOG, {
      provider,
      providerHome,
      hasRepoLocalConfig: Boolean(repoLocalConfig),
      hasBaseConfig: Boolean(baseConfig),
      hasChatConfig: Boolean(chatConfig),
      hasAgentConfig: Boolean(agentConfig),
    });

    return {
      provider,
      providerHome,
      ...(provider === 'codex' ? { codexHome: providerHome } : {}),
      baseConfigPath,
      repoLocalConfigPath,
      chatConfigPath,
      agentConfigPath,
      repoLocalConfig,
      baseConfig,
      chatConfig,
      agentConfig,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`${T03_ERROR_LOG} reason=${reason}`);
    throw error;
  }
}
