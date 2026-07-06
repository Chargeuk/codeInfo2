import fs from 'node:fs';
import path from 'node:path';
import type { CodexOptions } from '@openai/codex-sdk';
import { buildOpenAiCompatProxyBaseUrl } from '../chat/openaiCompatAdapter.js';
import { baseLogger } from '../logger.js';
import { getScopedEnvValue } from '../test/support/testEnvOverrideScope.js';
import {
  resolveCodeinfoMcpEndpointContract,
  resolveRequiredCodeinfoPlaceholderValue,
} from './mcpEndpoints.js';
import type { OpenAiCompatEndpointConfig } from './openaiCompatEndpoints.js';
import {
  applyManagedWebToolsToRuntimeConfigForMode,
  resolveConfiguredWebSearchMode,
  type WebSearchMode,
} from './webSearchMcp.js';

const TASK2_BOOTSTRAP_MARKER = 'DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP';

const defaultCodexConfigTemplate = `model = "gpt-5.3-codex"
model_reasoning_effort = "xhigh"
approval_policy = "never"
sandbox_mode    = "danger-full-access"
personality = "pragmatic"

[features]
web_search_request = true
view_image_tool = true

[mcp_servers]
[mcp_servers.context7]
args = ['-y', '@upstash/context7-mcp']
command = 'npx'
startup_timeout_sec = 20.0

[mcp_servers.mui]
args = ['-y', '@mui/mcp@latest']
command = 'npx'

[mcp_servers.deepwiki]
url = "https://mcp.deepwiki.com/mcp"
startup_timeout_sec = 20.0

[mcp_servers.code_info]
command = "npx"
args    = ["-y", "mcp-remote", "http://localhost:\${CODEINFO_SERVER_PORT}/mcp"]
startup_timeout_sec = 60

[projects]
[projects."/data"]
trust_level = "trusted"

[projects."/app/server"]
trust_level = "trusted"
`;

export function resolveCodexHome(overrideHome?: string): string {
  const testProviderHomeRoot = getScopedEnvValue('CODEINFO_TEST_PROVIDER_HOME_ROOT');
  const defaultHome =
    getScopedEnvValue('CODEINFO_CODEX_HOME') ??
    getScopedEnvValue('CODEX_HOME') ??
    (typeof testProviderHomeRoot === 'string' && testProviderHomeRoot.trim().length > 0
      ? path.join(path.resolve(testProviderHomeRoot), `pid-${process.pid}`, 'codex')
      : undefined) ??
    './codex';
  return path.resolve(overrideHome ?? defaultHome);
}

export function getCodexConfigPathForHome(codexHome: string): string {
  return path.join(codexHome, 'config.toml');
}

export function getCodexChatConfigPathForHome(codexHome: string): string {
  return path.join(codexHome, 'chat', 'config.toml');
}

export function getCodexAuthPathForHome(codexHome: string): string {
  return path.join(codexHome, 'auth.json');
}

export function getCodexHome(): string {
  return resolveCodexHome();
}

export function getCodexConfigPath(): string {
  return getCodexConfigPathForHome(getCodexHome());
}

export function getCodexChatConfigPath(): string {
  return getCodexChatConfigPathForHome(getCodexHome());
}

export function getCodexAuthPath(): string {
  return getCodexAuthPathForHome(getCodexHome());
}

const authStoreKey = 'cli_auth_credentials_store';
const authStoreValue = 'file';
const authStoreLine = `${authStoreKey} = "${authStoreValue}"`;
const authStoreRegex = new RegExp(
  `${authStoreKey}\\s*=\\s*["']?([^"'\\n]+)["']?`,
);

const CODEINFO_OPENAI_ENDPOINT_PROVIDER_NAME = 'codeinfo_openai_endpoint';

const resolveOpenAiCompatWireApi = (
  endpoint: OpenAiCompatEndpointConfig,
): 'responses' | 'completions' =>
  endpoint.capabilities.includes('responses') ? 'responses' : 'completions';

const hasExplicitWebSearchSetting = (config: Record<string, unknown>): boolean => {
  if (
    Object.prototype.hasOwnProperty.call(config, 'web_search') ||
    Object.prototype.hasOwnProperty.call(config, 'web_search_mode') ||
    Object.prototype.hasOwnProperty.call(config, 'web_search_request')
  ) {
    return true;
  }

  const features = config.features;
  return (
    typeof features === 'object' &&
    features !== null &&
    !Array.isArray(features) &&
    Object.prototype.hasOwnProperty.call(features, 'web_search_request')
  );
};

export function buildCodexOpenAiCompatRuntimeConfig(
  endpoint: OpenAiCompatEndpointConfig,
  params?: {
    modelId?: string;
    env?: NodeJS.ProcessEnv;
  },
): CodexOptions['config'] {
  const providerName = CODEINFO_OPENAI_ENDPOINT_PROVIDER_NAME;
  return {
    model_provider: providerName,
    model_providers: {
      [providerName]: {
        name: providerName,
        base_url: buildOpenAiCompatProxyBaseUrl({
          endpoint,
          consumer: 'codex',
          env: params?.env,
        }),
        wire_api: resolveOpenAiCompatWireApi(endpoint),
      },
    },
  } satisfies CodexOptions['config'];
}

export function applyCodexOpenAiCompatEndpointToRuntimeConfig(
  runtimeConfig: CodexOptions['config'] | undefined,
  endpoint?: OpenAiCompatEndpointConfig | null,
  params?: {
    modelId?: string;
    env?: NodeJS.ProcessEnv;
  },
): CodexOptions['config'] | undefined {
  if (!endpoint) {
    return runtimeConfig;
  }

  const generatedConfig = buildCodexOpenAiCompatRuntimeConfig(
    endpoint,
    params,
  ) as Record<string, unknown>;
  const baseConfig =
    runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : {};
  const baseConfigWithoutCatalog = {
    ...(baseConfig as Record<string, unknown>),
  };
  delete baseConfigWithoutCatalog.model_catalog_json;
  const mergedConfig = {
    ...baseConfigWithoutCatalog,
    ...generatedConfig,
    model_providers: {
      ...((baseConfigWithoutCatalog as Record<string, unknown>).model_providers as
        | Record<string, unknown>
        | undefined),
      ...(generatedConfig.model_providers as Record<string, unknown>),
    },
  } as CodexOptions['config'];

  const mergedRecord = mergedConfig as Record<string, unknown>;
  const configuredWebSearchMode = resolveConfiguredWebSearchMode(mergedRecord);
  const effectiveWebSearchMode: WebSearchMode | undefined =
    configuredWebSearchMode ??
    (hasExplicitWebSearchSetting(mergedRecord) ? undefined : 'live');

  return applyManagedWebToolsToRuntimeConfigForMode({
    config: mergedRecord,
    provider: 'codex',
    webSearchMode: effectiveWebSearchMode,
    env: params?.env,
    usesOpenAiCompatEndpoint: true,
  }) as CodexOptions['config'];
}

export function applyResolvedServerPortToCodexConfig(
  configText: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const { classicMcpUrl } = resolveCodeinfoMcpEndpointContract(env);
  const port = resolveRequiredCodeinfoPlaceholderValue(
    'CODEINFO_SERVER_PORT',
    env,
  );
  return configText
    .replaceAll('${CODEINFO_SERVER_PORT}', port)
    .replaceAll('http://localhost:5010/mcp', classicMcpUrl)
    .replaceAll('http://server:5010/mcp', `http://server:${port}/mcp`)
    .replaceAll('http://localhost:${CODEINFO_SERVER_PORT}/mcp', classicMcpUrl);
}

export function buildDefaultCodexConfig(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return applyResolvedServerPortToCodexConfig(defaultCodexConfigTemplate, env);
}

export function ensureCodexConfigSeeded(): string {
  const home = getCodexHome();
  const target = getCodexConfigPath();

  if (!fs.existsSync(home)) {
    fs.mkdirSync(home, { recursive: true });
  }

  if (fs.existsSync(target)) {
    console.info(TASK2_BOOTSTRAP_MARKER, {
      config_path: target,
      outcome: 'existing',
      template_source: 'in_code',
      success: true,
    });
    return target;
  }

  try {
    fs.writeFileSync(target, buildDefaultCodexConfig(), {
      encoding: 'utf8',
      flag: 'wx',
    });
    console.info(TASK2_BOOTSTRAP_MARKER, {
      config_path: target,
      outcome: 'seeded',
      template_source: 'in_code',
      success: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      console.info(TASK2_BOOTSTRAP_MARKER, {
        config_path: target,
        outcome: 'existing',
        template_source: 'in_code',
        success: true,
      });
      return target;
    }

    console.warn(TASK2_BOOTSTRAP_MARKER, {
      config_path: target,
      outcome: 'seed_failed',
      template_source: 'in_code',
      success: false,
      error:
        error instanceof Error ? error.message : 'failed to seed codex config',
      error_code: (error as NodeJS.ErrnoException).code,
    });
    throw error;
  }

  // const configText = fs.readFileSync(target, 'utf8');
  // const hasMcpSection = /\[mcp_servers\]/.test(configText);
  // const hasHost = /codeinfo_host\s*=/.test(configText);
  // const hasDocker = /codeinfo_docker\s*=/.test(configText);

  // if (!hasHost || !hasDocker || !hasMcpSection) {
  //   const mcpBlock = [
  //     hasMcpSection ? '' : '[mcp_servers]',
  //     hasHost ? '' : 'codeinfo_host = { url = "http://localhost:5010/mcp" }',
  //     hasDocker ? '' : 'codeinfo_docker = { url = "http://server:5010/mcp" }',
  //   ]
  //     .filter(Boolean)
  //     .join('\n');
  // }

  return target;
}

export async function ensureCodexAuthFileStore(configPath: string): Promise<{
  changed: boolean;
  configPath: string;
}> {
  let contents: string;
  try {
    contents = await fs.promises.readFile(configPath, 'utf8');
  } catch {
    throw new Error('codex config persistence unavailable');
  }

  let changed = false;
  const match = contents.match(authStoreRegex);
  if (match) {
    const value = match[1]?.trim();
    if (value !== authStoreValue) {
      contents = contents.replace(match[0], authStoreLine);
      changed = true;
    }
  } else {
    const suffix = contents.endsWith('\n') ? '' : '\n';
    contents = `${contents}${suffix}${authStoreLine}\n`;
    changed = true;
  }

  if (changed) {
    try {
      await fs.promises.writeFile(configPath, contents, 'utf8');
    } catch {
      throw new Error('codex config persistence unavailable');
    }
  }

  baseLogger.info(
    { changed, configPath },
    'DEV-0000031:T3:codex_device_auth_config_persisted',
  );

  return { changed, configPath };
}

export function buildCodexOptions(params?: {
  codexHome?: string;
  runtimeConfig?: CodexOptions['config'];
  envOverrides?: NodeJS.ProcessEnv;
}): CodexOptions | undefined {
  const home = resolveCodexHome(params?.codexHome);
  return {
    ...(params?.runtimeConfig ? { config: params.runtimeConfig } : {}),
    env: {
      // ensure we give the full environment so MCP servers work
      ...process.env,
      ...(params?.envOverrides ?? {}),
      CODEX_HOME: home,
    },
  } satisfies CodexOptions;
}
