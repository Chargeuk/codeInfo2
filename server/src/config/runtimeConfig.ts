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

export type RuntimeTomlConfig = Record<string, unknown>;

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
    throw new Error(`Invalid TOML at ${configPath}: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Invalid TOML root at ${configPath}: expected table`);
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
      throw new Error(`Missing TOML config at ${configPath}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read TOML config at ${configPath}: ${message}`);
  }

  return parseTomlOrThrow(raw, configPath);
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
