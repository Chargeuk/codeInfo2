import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CodexOptions } from '@openai/codex-sdk';

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

export function getCodexHome(): string {
  const defaultHome = process.env.CODEINFO_CODEX_HOME ?? './codex';
  return path.resolve(defaultHome);
}

export function getCodexConfigPath(): string {
  return path.join(getCodexHome(), 'config.toml');
}

export function getCodexAuthPath(): string {
  return path.join(getCodexHome(), 'auth.json');
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

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

export function buildCodexOptions(): CodexOptions | undefined {
  const home = getCodexHome();
  return {
    env: {
      // ensure we give the full environment so MCP servers work
      ...process.env,
      CODEX_HOME: home,
    },
  } satisfies CodexOptions;
}
