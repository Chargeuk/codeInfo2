import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import toml from 'toml';

import { discoverAgents } from '../agents/discovery.js';

import {
  getCodexChatConfigPathForHome,
  getCodexConfigPathForHome,
  resolveCodexHome,
} from './codexConfig.js';
import { resolveRequiredCodeinfoPlaceholderValue } from './mcpEndpoints.js';

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

export type RuntimeTomlConfig = Record<string, unknown>;
export type RuntimeConfigWarning = { path: string; message: string };
export type RuntimeConfigValidationResult = {
  config: RuntimeTomlConfig;
  warnings: RuntimeConfigWarning[];
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
  | 'generated_template'
  | 'template_write_failed'
  | 'chat_stat_failed'
  | 'chat_dir_create_failed';

export type RuntimeConfigSnapshot = {
  codexHome: string;
  baseConfigPath: string;
  chatConfigPath: string;
  agentConfigPath?: string;
  baseConfig?: RuntimeTomlConfig;
  chatConfig?: RuntimeTomlConfig;
  agentConfig?: RuntimeTomlConfig;
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
const REQUIRED_MCP_PLACEHOLDER_KEYS = new Set([
  'CODEINFO_SERVER_PORT',
  'CODEINFO_CHAT_MCP_PORT',
  'CODEINFO_AGENTS_MCP_PORT',
  'CODEINFO_PLAYWRIGHT_MCP_URL',
]);
const CHAT_CONFIG_TEMPLATE = [
  'model = "gpt-5.3-codex"',
  'model_reasoning_effort = "high"',
  'approval_policy = "on-failure"',
  'sandbox_mode = "danger-full-access"',
  'web_search = "live"',
  '',
].join('\n');

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
  const rootWebSearchAlias = hasOwn(normalized, 'web_search_request')
    ? toWebSearchMode(normalized.web_search_request)
    : undefined;
  const featureWebSearchAlias = hasOwn(features, 'web_search_request')
    ? toWebSearchMode(features.web_search_request)
    : undefined;
  if (!hasCanonicalWebSearch) {
    const aliasWebSearch = rootWebSearchAlias ?? featureWebSearchAlias;
    if (aliasWebSearch !== undefined) {
      normalized.web_search = aliasWebSearch;
    }
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
  'approval_policy',
  'sandbox_mode',
  'personality',
  'cli_auth_credentials_store',
]);

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

function mergeNamedTables(baseValue: unknown, runtimeValue: unknown): unknown {
  if (runtimeValue !== undefined && !isRecord(runtimeValue)) {
    return structuredClone(runtimeValue);
  }
  if (baseValue !== undefined && !isRecord(baseValue)) {
    return structuredClone(baseValue);
  }
  const baseTable = isRecord(baseValue)
    ? { ...(baseValue as Record<string, unknown>) }
    : {};
  const runtimeTable = isRecord(runtimeValue)
    ? { ...(runtimeValue as Record<string, unknown>) }
    : {};
  const mergedTable = { ...baseTable, ...runtimeTable };
  if (Object.keys(mergedTable).length === 0) {
    return undefined;
  }
  return mergedTable;
}

export function mergeRuntimeConfigWithBaseConfig(
  baseConfig: RuntimeTomlConfig | undefined,
  runtimeConfig: RuntimeTomlConfig,
): RuntimeMergeResult {
  const merged = cloneConfig(runtimeConfig);
  const inheritedKeys: string[] = [];
  const runtimeOverrideKeys: string[] = [];

  const recordOverride = (key: string) => {
    if (
      baseConfig &&
      hasOwn(baseConfig, key) &&
      hasOwn(runtimeConfig, key) &&
      !runtimeOverrideKeys.includes(key)
    ) {
      runtimeOverrideKeys.push(key);
    }
  };

  const inheritTopLevel = (key: string) => {
    if (!baseConfig || !hasOwn(baseConfig, key)) {
      return;
    }
    if (hasOwn(runtimeConfig, key)) {
      recordOverride(key);
      return;
    }
    merged[key] = cloneConfig({ [key]: baseConfig[key] })[key];
    inheritedKeys.push(key);
  };

  const mergeTopLevelTable = (key: string) => {
    const mergedTable = mergeNamedTables(baseConfig?.[key], runtimeConfig[key]);
    if (mergedTable === undefined) {
      delete merged[key];
      return;
    }
    merged[key] = mergedTable;
    if (baseConfig && hasOwn(baseConfig, key) && !hasOwn(runtimeConfig, key)) {
      inheritedKeys.push(key);
      return;
    }
    if (
      baseConfig &&
      hasOwn(baseConfig, key) &&
      hasOwn(runtimeConfig, key) &&
      !runtimeOverrideKeys.includes(key)
    ) {
      runtimeOverrideKeys.push(key);
    }
  };

  merged.projects = mergeNamedTables(
    baseConfig?.projects,
    runtimeConfig.projects,
  );
  if (merged.projects === undefined) {
    delete merged.projects;
  } else if (baseConfig && hasOwn(baseConfig, 'projects')) {
    if (hasOwn(runtimeConfig, 'projects')) {
      runtimeOverrideKeys.push('projects');
    } else {
      inheritedKeys.push('projects');
    }
  }

  mergeTopLevelTable('mcp_servers');
  mergeTopLevelTable('tools');
  mergeTopLevelTable('model_providers');
  inheritTopLevel('personality');
  inheritTopLevel('model_provider');

  ['model', 'approval_policy', 'sandbox_mode', 'web_search'].forEach(
    recordOverride,
  );

  return { merged, inheritedKeys, runtimeOverrideKeys };
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

    if (key === 'web_search') {
      if (typeof value !== 'string' || !ALLOWED_WEB_SEARCH.has(value)) {
        throw new Error(
          `invalid type at ${pathLabel}.web_search: expected one of live|cached|disabled`,
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
          featureKey === 'web_search_request'
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
  const exists = await fs
    .stat(chatConfigPath)
    .then((stat) => stat.isFile())
    .catch((error) => {
      if ((error as { code?: string }).code === 'ENOENT') return false;
      return false;
    });
  if (!exists) return;
  await fs.unlink(chatConfigPath).catch(() => undefined);
}

export async function resolveMergedAndValidatedRuntimeConfig(params: {
  surface: RuntimeConfigSurface;
  codexHome?: string;
  runtimeConfigPath: string;
}): Promise<RuntimeConfigValidationResult> {
  const codexHome = resolveCodexHome(params.codexHome);
  const baseConfigPath = getCodexConfigPathForHome(codexHome);
  try {
    const [baseConfig, runtimeConfig] = await Promise.all([
      readAndNormalizeRuntimeTomlConfig(baseConfigPath),
      readAndNormalizeRuntimeTomlConfig(params.runtimeConfigPath, {
        required: true,
      }),
    ]);
    const mergeResult = mergeRuntimeConfigWithBaseConfig(
      baseConfig,
      runtimeConfig!,
    );
    const placeholderResult = normalizeCodeinfoRuntimeConfigPlaceholders(
      mergeResult.merged,
    );
    const context7Result = normalizeContext7RuntimeConfig(placeholderResult);
    const validated = validateRuntimeConfig(context7Result.config, {
      pathLabel: params.surface,
    });
    logValidationWarnings(validated.warnings);
    console.info(T04_RUNTIME_INHERITANCE_MARKER, {
      surface: params.surface,
      inherited_keys: mergeResult.inheritedKeys,
      runtime_override_keys: mergeResult.runtimeOverrideKeys,
      success: true,
    });
    console.info(T05_CONTEXT7_NORMALIZED_MARKER, {
      mode: context7Result.mode,
      surface: params.surface,
      success: true,
    });
    console.info(T04_SUCCESS_LOG, {
      surface: params.surface,
      codexHome,
      runtimeConfigPath: params.runtimeConfigPath,
      warningCount: validated.warnings.length,
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
    throw mapped;
  }
}

export async function resolveAgentRuntimeConfig(params: {
  codexHome?: string;
  agentConfigPath: string;
}): Promise<RuntimeConfigValidationResult> {
  return resolveMergedAndValidatedRuntimeConfig({
    surface: 'agent',
    codexHome: params.codexHome,
    runtimeConfigPath: params.agentConfigPath,
  });
}

export async function resolveChatRuntimeConfig(params?: {
  codexHome?: string;
}): Promise<RuntimeConfigValidationResult> {
  const codexHome = resolveCodexHome(params?.codexHome);
  return resolveMergedAndValidatedRuntimeConfig({
    surface: 'chat',
    codexHome,
    runtimeConfigPath: getCodexChatConfigPathForHome(codexHome),
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
  const codexHome = resolveCodexHome(params?.codexHome);
  const baseConfigPath = getCodexConfigPathForHome(codexHome);
  const chatConfigPath = getCodexChatConfigPathForHome(codexHome);

  const chatExists = await fs.stat(chatConfigPath).then(
    () => true,
    (error: unknown) => {
      if ((error as { code?: string }).code === 'ENOENT') return false;
      const code = (error as { code?: string }).code;
      const warning =
        error instanceof Error ? error.message : 'Failed to stat chat config';
      logTask9Bootstrap({
        branch: 'chat_stat_failed',
        codexHome,
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
    logTask9Bootstrap({
      branch: 'existing_noop',
      codexHome,
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
    return {
      codexHome,
      baseConfigPath,
      chatConfigPath,
      copied: false,
      generatedTemplate: false,
      branch: 'existing_noop',
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
        codexHome,
        baseConfigPath,
        chatConfigPath,
        copied: false,
        generatedTemplate: false,
        warning,
        warningCode: code,
      });
      throw error;
    });

  const tempPath = `${chatConfigPath}.tmp`;
  try {
    await fs.writeFile(tempPath, CHAT_CONFIG_TEMPLATE, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await fs.rename(tempPath, chatConfigPath);
    logTask9Bootstrap({
      branch: 'generated_template',
      codexHome,
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
    return {
      codexHome,
      baseConfigPath,
      chatConfigPath,
      copied: false,
      generatedTemplate: true,
      branch: 'generated_template',
    };
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    await cleanupPartialChatConfig(chatConfigPath);
    if ((error as { code?: string }).code === 'EEXIST') {
      logTask9Bootstrap({
        branch: 'existing_noop',
        codexHome,
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
      return {
        codexHome,
        baseConfigPath,
        chatConfigPath,
        copied: false,
        generatedTemplate: false,
        branch: 'existing_noop',
      };
    }
    const code = (error as { code?: string }).code;
    const warning =
      error instanceof Error ? error.message : 'Failed to write chat template';
    logTask9Bootstrap({
      branch: 'template_write_failed',
      codexHome,
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
    throw error;
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
  codexHome?: string;
  bootstrapChatConfig?: boolean;
  agentName?: string;
  agentConfigPath?: string;
}): Promise<RuntimeConfigSnapshot> {
  const codexHome = resolveCodexHome(params?.codexHome);
  const baseConfigPath = getCodexConfigPathForHome(codexHome);
  const chatConfigPath = getCodexChatConfigPathForHome(codexHome);
  const bootstrapChatConfig = params?.bootstrapChatConfig ?? true;

  let agentConfigPath = params?.agentConfigPath;
  if (!agentConfigPath && params?.agentName) {
    agentConfigPath = await resolveAgentConfigPathByName(params.agentName);
  }

  try {
    if (bootstrapChatConfig) {
      await ensureChatRuntimeConfigBootstrapped({ codexHome });
    }

    const [baseConfig, chatConfig, agentConfig] = await Promise.all([
      readAndNormalizeRuntimeTomlConfig(baseConfigPath),
      readAndNormalizeRuntimeTomlConfig(chatConfigPath),
      agentConfigPath
        ? readAndNormalizeRuntimeTomlConfig(agentConfigPath, { required: true })
        : Promise.resolve(undefined),
    ]);

    console.info(T03_SUCCESS_LOG, {
      codexHome,
      hasBaseConfig: Boolean(baseConfig),
      hasChatConfig: Boolean(chatConfig),
      hasAgentConfig: Boolean(agentConfig),
    });

    return {
      codexHome,
      baseConfigPath,
      chatConfigPath,
      agentConfigPath,
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
