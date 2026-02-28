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

const T03_SUCCESS_LOG =
  '[DEV-0000037][T03] event=runtime_config_loaded_and_normalized result=success';
const T03_ERROR_LOG =
  '[DEV-0000037][T03] event=runtime_config_loaded_and_normalized result=error';
const T04_SUCCESS_LOG =
  '[DEV-0000037][T04] event=runtime_config_merged_and_validated result=success';
const T04_ERROR_LOG =
  '[DEV-0000037][T04] event=runtime_config_merged_and_validated result=error';

export type RuntimeTomlConfig = Record<string, unknown>;
export type RuntimeConfigWarning = { path: string; message: string };
export type RuntimeConfigValidationResult = {
  config: RuntimeTomlConfig;
  warnings: RuntimeConfigWarning[];
};
export type RuntimeConfigSurface = 'agent' | 'chat';

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

export function normalizeRuntimeConfig(
  input: RuntimeTomlConfig,
): RuntimeTomlConfig {
  const normalized = cloneConfig(input);

  const rawFeatures = isRecord(normalized.features) ? normalized.features : {};
  const features: Record<string, unknown> = { ...rawFeatures };
  const hasCanonicalTools =
    isRecord(normalized.tools) && hasOwn(normalized.tools, 'view_image');
  const tools = isRecord(normalized.tools)
    ? { ...normalized.tools }
    : ({} as Record<string, unknown>);

  if (!hasCanonicalTools && hasOwn(features, 'view_image_tool')) {
    const viewImage = toBoolean(features.view_image_tool);
    if (viewImage !== undefined) {
      tools.view_image = viewImage;
    }
  }
  delete features.view_image_tool;

  const hasCanonicalWebSearch = hasOwn(normalized, 'web_search');
  if (!hasCanonicalWebSearch) {
    const aliasWebSearch =
      toWebSearchMode(normalized.web_search_request) ??
      toWebSearchMode(features.web_search_request);
    if (aliasWebSearch !== undefined) {
      normalized.web_search = aliasWebSearch;
    }
  }

  if (hasOwn(normalized, 'web_search_request')) {
    delete normalized.web_search_request;
  }
  delete features.web_search_request;

  if (Object.keys(tools).length > 0) {
    normalized.tools = tools;
  } else if (hasOwn(normalized, 'tools')) {
    delete normalized.tools;
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

function collectRecord(
  input: RuntimeTomlConfig,
  key: string,
  warnings: RuntimeConfigWarning[],
  pathLabel: string,
): Record<string, unknown> {
  const value = input[key];
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error(`invalid type at ${pathLabel}.${key}: expected table`);
  }
  return { ...value };
}

function pushUnknownWarning(
  warnings: RuntimeConfigWarning[],
  pathLabel: string,
  key: string,
) {
  warnings.push({
    path: `${pathLabel}.${key}`,
    message: `Unknown key ${pathLabel}.${key}; ignored`,
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

export function validateRuntimeConfig(
  input: RuntimeTomlConfig,
  params?: { pathLabel?: string },
): RuntimeConfigValidationResult {
  const pathLabel = params?.pathLabel ?? 'runtime';
  const warnings: RuntimeConfigWarning[] = [];
  const source = cloneConfig(input);
  const sanitized: RuntimeTomlConfig = {};

  for (const [key, value] of Object.entries(source)) {
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
      const tools = collectRecord(source, key, warnings, pathLabel);
      const normalizedTools: Record<string, unknown> = {};
      for (const [toolKey, toolValue] of Object.entries(tools)) {
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
      }
      if (Object.keys(normalizedTools).length > 0) {
        sanitized.tools = normalizedTools;
      }
      continue;
    }

    if (key === 'features') {
      const features = collectRecord(source, key, warnings, pathLabel);
      const normalizedFeatures: Record<string, unknown> = {};
      for (const [featureKey, featureValue] of Object.entries(features)) {
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
      }
      if (Object.keys(normalizedFeatures).length > 0) {
        sanitized.features = normalizedFeatures;
      }
      continue;
    }

    if (key === 'projects') {
      const projects = collectRecord(source, key, warnings, pathLabel);
      const normalizedProjects: Record<string, unknown> = {};
      for (const [projectPath, projectValue] of Object.entries(projects)) {
        if (!isRecord(projectValue)) {
          throw new Error(
            `invalid type at ${pathLabel}.projects.${projectPath}: expected table`,
          );
        }
        const normalizedProject: Record<string, unknown> = {};
        for (const [projectKey, projectEntryValue] of Object.entries(
          projectValue,
        )) {
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
            message: `Unknown key ${projectKey} under projects table; ignored`,
          });
        }
        normalizedProjects[projectPath] = normalizedProject;
      }
      sanitized.projects = normalizedProjects;
      continue;
    }

    pushUnknownWarning(warnings, pathLabel, key);
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
    const merged = mergeProjectsFromBaseIntoRuntime(baseConfig, runtimeConfig!);
    const validated = validateRuntimeConfig(merged, {
      pathLabel: params.surface,
    });
    logValidationWarnings(validated.warnings);
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
}> {
  const codexHome = resolveCodexHome(params?.codexHome);
  const baseConfigPath = getCodexConfigPathForHome(codexHome);
  const chatConfigPath = getCodexChatConfigPathForHome(codexHome);

  const chatExists = await fs
    .stat(chatConfigPath)
    .then((stat) => stat.isFile())
    .catch((error) => {
      if ((error as { code?: string }).code === 'ENOENT') return false;
      throw error;
    });

  if (chatExists) {
    return { codexHome, baseConfigPath, chatConfigPath, copied: false };
  }

  const baseExists = await fs
    .stat(baseConfigPath)
    .then((stat) => stat.isFile())
    .catch((error) => {
      if ((error as { code?: string }).code === 'ENOENT') return false;
      throw error;
    });

  if (!baseExists) {
    return { codexHome, baseConfigPath, chatConfigPath, copied: false };
  }

  await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
  try {
    await fs.copyFile(
      baseConfigPath,
      chatConfigPath,
      fsConstants.COPYFILE_EXCL,
    );
    return { codexHome, baseConfigPath, chatConfigPath, copied: true };
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') {
      return { codexHome, baseConfigPath, chatConfigPath, copied: false };
    }
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
