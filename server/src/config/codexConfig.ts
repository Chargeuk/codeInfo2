import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CodexOptions } from '@openai/codex-sdk';
import { baseLogger } from '../logger.js';

const defaultCodexConfig = `model = "gpt-5.1-codex-max"
model_reasoning_effort = "high"

[features]
web_search_request = true
view_image_tool = true

[mcp_servers]
[mcp_servers.context7]
args = ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866']
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
args    = ["-y", "mcp-remote", "http://localhost:5010/mcp"]
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

export function getCodexAuthPathForHome(codexHome: string): string {
  return path.join(codexHome, 'auth.json');
}

export function getCodexHome(): string {
  return resolveCodexHome();
}

export function getCodexConfigPath(): string {
  return getCodexConfigPathForHome(getCodexHome());
}

export function getCodexAuthPath(): string {
  return getCodexAuthPathForHome(getCodexHome());
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const authStoreKey = 'cli_auth_credentials_store';
const authStoreValue = 'file';
const authStoreLine = `${authStoreKey} = "${authStoreValue}"`;
const authStoreRegex = new RegExp(
  `${authStoreKey}\\s*=\\s*["']?([^"'\\n]+)["']?`,
);

export function ensureCodexConfigSeeded(): string {
  const home = getCodexHome();
  const target = getCodexConfigPath();
  const candidatePaths = [
    path.resolve('config.toml.example'),
    path.resolve('..', 'config.toml.example'),
    path.resolve(moduleDir, '..', '..', 'config.toml.example'),
    path.resolve(moduleDir, '..', '..', '..', 'config.toml.example'),
  ];
  const examplePath = candidatePaths.find((p) => fs.existsSync(p));

  if (!fs.existsSync(home)) {
    fs.mkdirSync(home, { recursive: true });
  }

  if (!fs.existsSync(target)) {
    if (examplePath) {
      fs.copyFileSync(examplePath, target);
      console.log(`Seeded Codex config from example to ${target}`);
    } else {
      fs.writeFileSync(target, defaultCodexConfig);
      console.warn(
        'config.toml.example not found; wrote default Codex config instead.',
      );
    }
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
}): CodexOptions | undefined {
  const home = resolveCodexHome(params?.codexHome);
  return {
    env: {
      // ensure we give the full environment so MCP servers work
      ...process.env,
      CODEX_HOME: home,
    },
  } satisfies CodexOptions;
}
