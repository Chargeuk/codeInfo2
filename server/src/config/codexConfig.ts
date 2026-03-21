import fs from 'fs';
import path from 'path';
import type { CodexOptions } from '@openai/codex-sdk';
import { baseLogger } from '../logger.js';
import {
  resolveCodeinfoMcpEndpointContract,
  resolveRequiredCodeinfoPlaceholderValue,
} from './mcpEndpoints.js';

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
  const defaultHome = process.env.CODEINFO_CODEX_HOME ?? './codex';
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
}): CodexOptions | undefined {
  const home = resolveCodexHome(params?.codexHome);
  return {
    ...(params?.runtimeConfig ? { config: params.runtimeConfig } : {}),
    env: {
      // ensure we give the full environment so MCP servers work
      ...process.env,
      CODEX_HOME: home,
    },
  } satisfies CodexOptions;
}
