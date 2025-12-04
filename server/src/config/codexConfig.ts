import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CodexOptions } from '@openai/codex-sdk';

const defaultHome = process.env.CODEINFO_CODEX_HOME ?? './codex';
const defaultCodexConfig = `# Codex configuration for CodeInfo2
# Copy of this file is placed in CODEINFO_CODEX_HOME (default ./codex) on server startup when missing.

model = "gpt-5.1-codex-max"
model_reasoning_effort = "high"

[features]
web_search_request = true
view_image_tool = true

[mcp_servers]
# Host (local dev)
codeinfo_host = { url = "http://localhost:5010/mcp" }
# Docker (compose)
codeinfo_docker = { url = "http://server:5010/mcp" }
`;

export function getCodexHome(): string {
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

  const configText = fs.readFileSync(target, 'utf8');
  const hasMcpSection = /\[mcp_servers\]/.test(configText);
  const hasHost = /codeinfo_host\s*=/.test(configText);
  const hasDocker = /codeinfo_docker\s*=/.test(configText);

  if (!hasHost || !hasDocker || !hasMcpSection) {
    const mcpBlock = [
      hasMcpSection ? '' : '[mcp_servers]',
      hasHost ? '' : 'codeinfo_host = { url = "http://localhost:5010/mcp" }',
      hasDocker ? '' : 'codeinfo_docker = { url = "http://server:5010/mcp" }',
    ]
      .filter(Boolean)
      .join('\n');

    const updated = `${configText.trim()}\n\n${mcpBlock}\n`;
    fs.writeFileSync(target, updated);
  }

  return target;
}

export function buildCodexOptions(): CodexOptions {
  const home = getCodexHome();
  return {
    env: {
      CODEX_HOME: home,
    },
  } satisfies CodexOptions;
}
