import assert from 'node:assert/strict';
import type { PathLike } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import {
  ensureCodexConfigSeeded,
  getCodexChatConfigPathForHome,
  getCodexConfigPathForHome,
  getCodexHome,
} from '../../config/codexConfig.js';
import {
  buildCopilotClientOptions,
  getCopilotConfigDir,
  getCopilotStatePathForHome,
  resolveCopilotCredentialSource,
  resolveCopilotHome,
} from '../../config/copilotConfig.js';
import { resolveCodeinfoMcpEndpointContract } from '../../config/mcpEndpoints.js';
import {
  __resetProviderBootstrapStatusForTests,
  ensureAllProviderChatConfigsBootstrapped,
  ensureChatRuntimeConfigBootstrapped,
  ensureProviderChatConfigBootstrapped,
  getProviderBootstrapStatus,
  getProviderChatConfigPath,
  loadProviderChatDefaultsSnapshotSync,
  loadRuntimeConfigSnapshot,
  materializeRepositoryBackedCodexChatHome,
  mergeRuntimeConfigLayers,
  mergeProjectsFromBaseIntoRuntime,
  mergeRuntimeConfigWithBaseConfig,
  minimizeBaseConfigToProjectsOnly,
  normalizeCodeinfoRuntimeConfigPlaceholders,
  normalizeContext7RuntimeConfig,
  normalizeRuntimeConfig,
  readAndNormalizeRuntimeTomlConfig,
  resolveAgentRuntimeConfig,
  resolveChatRuntimeConfig,
  resolveMergedAndValidatedRuntimeConfig,
  type RuntimeConfigResolutionError,
  validateRuntimeConfig,
} from '../../config/runtimeConfig.js';
import { loadStartupEnv } from '../../config/startupEnv.js';
const originalContext7ApiKey = process.env.CODEINFO_CONTEXT7_API_KEY;
const originalServerPort = process.env.CODEINFO_SERVER_PORT;
const originalChatMcpPort = process.env.CODEINFO_CHAT_MCP_PORT;
const originalLegacyMcpPort = process.env.CODEINFO_MCP_PORT;
const originalAgentsMcpPort = process.env.CODEINFO_AGENTS_MCP_PORT;
const originalWebMcpPort = process.env.CODEINFO_WEB_MCP_PORT;
const originalPlaywrightMcpUrl = process.env.CODEINFO_PLAYWRIGHT_MCP_URL;
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
afterEach(() => {
  mock.restoreAll();
  __resetProviderBootstrapStatusForTests();
  if (originalContext7ApiKey === undefined) {
    clearScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY');
  } else {
    setScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY', originalContext7ApiKey);
  }
  if (originalServerPort === undefined) {
    clearScopedTestEnvValue('CODEINFO_SERVER_PORT');
  } else {
    setScopedTestEnvValue('CODEINFO_SERVER_PORT', originalServerPort);
  }
  if (originalChatMcpPort === undefined) {
    clearScopedTestEnvValue('CODEINFO_CHAT_MCP_PORT');
  } else {
    setScopedTestEnvValue('CODEINFO_CHAT_MCP_PORT', originalChatMcpPort);
  }
  if (originalLegacyMcpPort === undefined) {
    clearScopedTestEnvValue('CODEINFO_MCP_PORT');
  } else {
    setScopedTestEnvValue('CODEINFO_MCP_PORT', originalLegacyMcpPort);
  }
  if (originalAgentsMcpPort === undefined) {
    clearScopedTestEnvValue('CODEINFO_AGENTS_MCP_PORT');
  } else {
    setScopedTestEnvValue('CODEINFO_AGENTS_MCP_PORT', originalAgentsMcpPort);
  }
  if (originalWebMcpPort === undefined) {
    clearScopedTestEnvValue('CODEINFO_WEB_MCP_PORT');
  } else {
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', originalWebMcpPort);
  }
  if (originalPlaywrightMcpUrl === undefined) {
    clearScopedTestEnvValue('CODEINFO_PLAYWRIGHT_MCP_URL');
  } else {
    setScopedTestEnvValue(
      'CODEINFO_PLAYWRIGHT_MCP_URL',
      originalPlaywrightMcpUrl,
    );
  }
});
describe('copilot runtime env wiring', () => {
  it('loads CODEINFO_COPILOT_HOME for development, local docker override, and e2e modes', async () => {
    const serverRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'copilot-startup-env-'),
    );
    const targetEnv: Record<string, string | undefined> = {};
    try {
      await fs.writeFile(
        path.join(serverRoot, '.env'),
        'CODEINFO_COPILOT_HOME=../copilot\n',
        'utf8',
      );
      await fs.writeFile(
        path.join(serverRoot, '.env.local'),
        'CODEINFO_COPILOT_HOME=/app/copilot\n',
        'utf8',
      );
      const localDockerLoaded = loadStartupEnv({
        serverRoot,
        targetEnv,
      });
      const checkedInDevEnv = await fs.readFile(
        path.join(repoRoot, 'server/.env'),
        'utf8',
      );
      const checkedInE2eEnv = await fs.readFile(
        path.join(repoRoot, 'server/.env.e2e'),
        'utf8',
      );
      assert.equal(targetEnv.CODEINFO_COPILOT_HOME, '/app/copilot');
      assert.equal(
        localDockerLoaded.valueSources.CODEINFO_COPILOT_HOME,
        'server/.env.local',
      );
      assert.match(checkedInDevEnv, /^CODEINFO_COPILOT_HOME=\.\.\/copilot$/m);
      assert.match(checkedInE2eEnv, /^CODEINFO_COPILOT_HOME=\/app\/copilot$/m);
    } finally {
      await fs.rm(serverRoot, { recursive: true, force: true });
    }
  });
  it('preserves an optional explicit Copilot CLI path override without making it mandatory', () => {
    const withCliPath = buildCopilotClientOptions({
      env: {
        CODEINFO_COPILOT_HOME: './tmp/copilot-home',
        CODEINFO_COPILOT_CLI_PATH: '/opt/copilot/bin/copilot',
      },
    });
    const withoutCliPath = buildCopilotClientOptions({
      env: {
        CODEINFO_COPILOT_HOME: './tmp/copilot-home',
      },
    });
    assert.equal(withCliPath.clientOptions.cliPath, '/opt/copilot/bin/copilot');
    assert.deepEqual(withCliPath.clientOptions.cliArgs, ['--allow-all-paths']);
    assert.equal(withCliPath.cliPathOverride, 'present');
    assert.equal(withCliPath.cliMode, 'cliPath');
    assert.equal(withoutCliPath.clientOptions.cliPath, undefined);
    assert.deepEqual(withoutCliPath.clientOptions.cliArgs, [
      '--allow-all-paths',
    ]);
    assert.equal(withoutCliPath.cliPathOverride, 'absent');
    assert.equal(withoutCliPath.cliMode, 'path');
  });
  it('preserves documented Copilot credential precedence during runtime loading', () => {
    assert.equal(
      resolveCopilotCredentialSource({
        GITHUB_TOKEN: 'github-token',
      }),
      'GITHUB_TOKEN',
    );
    assert.equal(
      resolveCopilotCredentialSource({
        GH_TOKEN: 'gh-token',
        GITHUB_TOKEN: 'github-token',
      }),
      'GH_TOKEN',
    );
    assert.equal(
      resolveCopilotCredentialSource({
        COPILOT_GITHUB_TOKEN: 'copilot-token',
        GH_TOKEN: 'gh-token',
        GITHUB_TOKEN: 'github-token',
      }),
      'COPILOT_GITHUB_TOKEN',
    );
    assert.equal(resolveCopilotCredentialSource({}), 'none');
  });
  it('resolves derived Copilot home paths through the shared helper contract', async () => {
    const serverRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'copilot-startup-paths-'),
    );
    const targetEnv: Record<string, string | undefined> = {};
    const expectedHome = path.join(serverRoot, 'copilot-home');
    try {
      await fs.writeFile(
        path.join(serverRoot, '.env'),
        `CODEINFO_COPILOT_HOME=${expectedHome}\n`,
        'utf8',
      );
      loadStartupEnv({
        serverRoot,
        targetEnv,
      });
      const copilotHome = resolveCopilotHome(undefined, targetEnv);
      assert.equal(copilotHome, expectedHome);
      assert.equal(getCopilotConfigDir(targetEnv), copilotHome);
      assert.equal(
        getCopilotStatePathForHome(copilotHome, 'auth.json'),
        path.join(copilotHome, 'auth.json'),
      );
    } finally {
      await fs.rm(serverRoot, { recursive: true, force: true });
    }
  });
});
describe('runtimeConfig normalization', () => {
  it('normalizes legacy features.view_image_tool to tools.view_image', () => {
    const normalized = normalizeRuntimeConfig({
      features: { view_image_tool: true, keep_this: true },
    });
    assert.deepEqual(normalized.tools, { view_image: true });
    assert.deepEqual(normalized.features, { keep_this: true });
  });
  it('preserves mixed-shape tools entries while restoring view_image from the legacy alias', () => {
    const normalized = normalizeRuntimeConfig({
      features: { view_image_tool: true, keep_this: true },
      tools: { web_search: false },
    });
    assert.deepEqual(normalized.tools, { web_search: false, view_image: true });
    assert.deepEqual(normalized.features, { keep_this: true });
  });
  it('normalizes legacy web_search aliases to canonical web_search', () => {
    const normalized = normalizeRuntimeConfig({
      features: { web_search_request: false },
    });
    assert.equal(normalized.web_search, 'disabled');
    assert.equal(normalized.features, undefined);
  });
  it('keeps canonical keys when aliases conflict', () => {
    const normalized = normalizeRuntimeConfig({
      web_search: 'cached',
      features: { web_search_request: true, view_image_tool: false },
      tools: { view_image: true },
    });
    assert.equal(normalized.web_search, 'cached');
    assert.deepEqual(normalized.tools, { view_image: true });
    assert.equal(
      (normalized.features as Record<string, unknown>)?.view_image_tool,
      undefined,
    );
    assert.equal(
      (normalized.features as Record<string, unknown>)?.web_search_request,
      undefined,
    );
  });
  it('preserves malformed legacy alias values so validation can reject them later', () => {
    const normalized = normalizeRuntimeConfig({
      web_search: 'cached',
      features: {
        view_image_tool: 'maybe',
        web_search_request: 'sometimes',
      },
      tools: { web_search: false },
    });
    assert.equal(normalized.web_search, 'cached');
    assert.deepEqual(normalized.tools, { web_search: false });
    assert.deepEqual(normalized.features, {
      view_image_tool: 'maybe',
      web_search_request: 'sometimes',
    });
  });
});
describe('runtimeConfig bootstrap', () => {
  const TASK9_MARKER = 'DEV_0000040_T09_CHAT_BOOTSTRAP_BRANCH';
  const TASK3_MARKER = 'DEV_0000047_T03_CHAT_CONFIG_BOOTSTRAP';
  it('default startup path awaits provider chat-config bootstrap before the checked-in server entrypoint begins listening', async () => {
    const indexSource = await fs.readFile(
      path.join(repoRoot, 'server/src/index.ts'),
      'utf8',
    );
    assert.doesNotMatch(
      indexSource,
      /void ensureAllProviderChatConfigsBootstrapped\(/u,
    );
    assert.match(
      indexSource,
      /const start = async \(\) => \{[\s\S]*await ensureAllProviderChatConfigsBootstrapped\([\s\S]*const httpServer = http\.createServer\(app\);/u,
    );
  });
  it('writes the canonical chat template when chat config is missing', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const content = await fs.readFile(chatConfigPath, 'utf8');
      assert.equal(result.copied, false);
      assert.equal(result.generatedTemplate, true);
      assert.equal(result.branch, 'generated_template');
      assert.match(content, /model = "gpt-5.6-sol"/u);
      assert.match(content, /model_reasoning_effort = "high"/u);
      assert.match(content, /approval_policy = "on-request"/u);
      assert.match(content, /sandbox_mode = "danger-full-access"/u);
      assert.match(content, /web_search = "live"/u);
      assert.match(content, /\[mcp_servers\.code_info\]/u);
      assert.match(
        content,
        /http:\/\/localhost:\$\{CODEINFO_SERVER_PORT\}\/mcp/u,
      );
      assert.doesNotMatch(content, /\[mcp_servers\.web_tools\]/u);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('never copies base config into chat config when base already exists with different contents', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.writeFile(
        baseConfigPath,
        [
          'model = "base-model"',
          'approval_policy = "never"',
          '[mcp_servers.context7]',
          'command = "npx"',
          'args = ["-y", "@upstash/context7-mcp"]',
          '',
        ].join('\n'),
        'utf8',
      );
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const chatContents = await fs.readFile(chatConfigPath, 'utf8');
      assert.equal(result.copied, false);
      assert.equal(result.branch, 'generated_template');
      assert.match(chatContents, /model = "gpt-5.6-sol"/u);
      assert.doesNotMatch(chatContents, /base-model/u);
      assert.doesNotMatch(chatContents, /\[mcp_servers\.context7\]/u);
      assert.match(chatContents, /\[mcp_servers\.code_info\]/u);
      assert.doesNotMatch(chatContents, /\[mcp_servers\.web_tools\]/u);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('creates missing codex/chat directory before bootstrap write', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatDirPath = path.join(codexHome, 'chat');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const dirExists = await fs
        .stat(chatDirPath)
        .then((stat) => stat.isDirectory())
        .catch((error) => {
          if (
            (
              error as {
                code?: string;
              }
            ).code === 'ENOENT'
          )
            return false;
          throw error;
        });
      assert.equal(result.generatedTemplate, true);
      assert.equal(dirExists, true);
      await fs.access(chatConfigPath);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('ignores config.toml.example and codex/chat/config copy.toml during runtime bootstrap', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const codexHome = path.join(tempRoot, 'codex-home');
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    const originalCwd = process.cwd();
    try {
      setScopedTestEnvValue('CODEINFO_CODEX_HOME', codexHome);
      process.chdir(tempRoot);
      await fs.writeFile(
        path.join(tempRoot, 'config.toml.example'),
        'model = "from-example"\n',
        'utf8',
      );
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.writeFile(
        path.join(codexHome, 'chat', 'config copy.toml'),
        'model = "from-copy-template"\n',
        'utf8',
      );
      const seededBasePath = ensureCodexConfigSeeded();
      const bootstrapResult = await ensureChatRuntimeConfigBootstrapped({
        codexHome: getCodexHome(),
      });
      const baseConfig = await fs.readFile(
        getCodexConfigPathForHome(codexHome),
        'utf8',
      );
      const chatConfig = await fs.readFile(
        getCodexChatConfigPathForHome(codexHome),
        'utf8',
      );
      assert.equal(seededBasePath, getCodexConfigPathForHome(codexHome));
      assert.match(baseConfig, /model = "gpt-5\.6-sol"/u);
      assert.doesNotMatch(baseConfig, /from-example/u);
      assert.equal(bootstrapResult.branch, 'generated_template');
      assert.match(chatConfig, /model = "gpt-5\.6-sol"/u);
      assert.doesNotMatch(chatConfig, /from-copy-template/u);
    } finally {
      process.chdir(originalCwd);
      if (originalCodeinfoHome === undefined) {
        clearScopedTestEnvValue('CODEINFO_CODEX_HOME');
      } else {
        setScopedTestEnvValue('CODEINFO_CODEX_HOME', originalCodeinfoHome);
      }
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('replaces the old copied branch with direct-template seeding', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    try {
      await fs.writeFile(baseConfigPath, 'model = "from-base"\n', 'utf8');
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      assert.notEqual(result.branch, 'copied');
      assert.equal(result.branch, 'generated_template');
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('leaves an existing zero-byte chat config untouched', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(chatConfigPath, '', 'utf8');
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const chatContents = await fs.readFile(chatConfigPath, 'utf8');
      assert.equal(result.branch, 'existing_noop');
      assert.equal(chatContents, '');
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('augments a legacy generated chat config with reserved MCP servers', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        chatConfigPath,
        [
          'model = "gpt-5.6-sol"',
          'model_reasoning_effort = "high"',
          'approval_policy = "on-request"',
          'sandbox_mode = "danger-full-access"',
          'network_access_enabled = true',
          'web_search_mode = "live"',
          'web_search = "live"',
          '',
        ].join('\n'),
        'utf8',
      );
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const chatContents = await fs.readFile(chatConfigPath, 'utf8');
      assert.equal(result.branch, 'existing_augmented');
      assert.match(chatContents, /\[mcp_servers\.code_info\]/u);
      assert.match(
        chatContents,
        /http:\/\/localhost:\$\{CODEINFO_SERVER_PORT\}\/mcp/u,
      );
      assert.doesNotMatch(chatContents, /\[mcp_servers\.web_tools\]/u);
      assert.match(chatContents, /model = "gpt-5.6-sol"/u);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('treats reserved MCP augmentation write failures as a best-effort no-op', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const originalWriteFile = fs.writeFile.bind(fs);
    const legacyConfig = [
      'model = "gpt-5.6-sol"',
      'model_reasoning_effort = "high"',
      'approval_policy = "on-request"',
      'sandbox_mode = "danger-full-access"',
      'network_access_enabled = true',
      'web_search_mode = "live"',
      'web_search = "live"',
      '',
    ].join('\n');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(chatConfigPath, legacyConfig, 'utf8');
      mock.method(
        fs,
        'writeFile',
        async (...args: Parameters<typeof fs.writeFile>) => {
          const [file, data, options] = args;
          const filePath = String(file);
          if (
            filePath.startsWith(`${chatConfigPath}.`) &&
            filePath.endsWith('.tmp')
          ) {
            throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
          }
          return originalWriteFile(file, data, options as never);
        },
      );
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const chatContents = await fs.readFile(chatConfigPath, 'utf8');
      assert.equal(result.branch, 'existing_augment_failed');
      assert.equal(chatContents, legacyConfig);
      assert.doesNotMatch(chatContents, /\[mcp_servers\.web_tools\]/u);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('fails reserved MCP augmentation when the chat config changes before rename and preserves the newer file', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const originalWriteFile = fs.writeFile.bind(fs);
    const legacyConfig = [
      'model = "gpt-5.6-sol"',
      'model_reasoning_effort = "high"',
      'approval_policy = "on-request"',
      'sandbox_mode = "danger-full-access"',
      'network_access_enabled = true',
      'web_search_mode = "live"',
      'web_search = "live"',
      '',
    ].join('\n');
    const concurrentConfig = [
      'model = "gpt-5.6-sol"',
      'model_reasoning_effort = "medium"',
      'approval_policy = "on-request"',
      'sandbox_mode = "danger-full-access"',
      'network_access_enabled = true',
      'web_search_mode = "live"',
      'web_search = "live"',
      '',
    ].join('\n');
    let injectedConcurrentWrite = false;
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(chatConfigPath, legacyConfig, 'utf8');
      mock.method(
        fs,
        'writeFile',
        async (...args: Parameters<typeof fs.writeFile>) => {
          const [file, data, options] = args;
          const filePath = String(file);
          const result = await originalWriteFile(file, data, options as never);
          if (
            !injectedConcurrentWrite &&
            filePath.startsWith(`${chatConfigPath}.`) &&
            filePath.endsWith('.tmp')
          ) {
            injectedConcurrentWrite = true;
            await originalWriteFile(chatConfigPath, concurrentConfig, 'utf8');
          }
          return result;
        },
      );
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const chatContents = await fs.readFile(chatConfigPath, 'utf8');
      assert.equal(result.branch, 'existing_augment_failed');
      assert.equal(chatContents, concurrentConfig);
      assert.doesNotMatch(chatContents, /\[mcp_servers\.web_tools\]/u);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('treats reserved MCP augmentation lock timeouts as a best-effort failure branch', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const originalOpen = fs.open.bind(fs);
    const legacyConfig = [
      'model = "gpt-5.6-sol"',
      'model_reasoning_effort = "high"',
      'approval_policy = "on-request"',
      'sandbox_mode = "danger-full-access"',
      'network_access_enabled = true',
      'web_search_mode = "live"',
      'web_search = "live"',
      '',
    ].join('\n');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(chatConfigPath, legacyConfig, 'utf8');
      mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        const [filePath] = args;
        if (String(filePath) === `${chatConfigPath}.codeinfo.lock`) {
          throw Object.assign(new Error('lock busy'), { code: 'EEXIST' });
        }
        return originalOpen(...args);
      });
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const chatContents = await fs.readFile(chatConfigPath, 'utf8');
      assert.equal(result.branch, 'existing_augment_failed');
      assert.equal(chatContents, legacyConfig);
      assert.doesNotMatch(chatContents, /\[mcp_servers\.web_tools\]/u);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('leaves an existing invalid-TOML chat config untouched', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(chatConfigPath, '[broken', 'utf8');
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const chatContents = await fs.readFile(chatConfigPath, 'utf8');
      assert.equal(result.branch, 'existing_noop');
      assert.equal(chatContents, '[broken');
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('leaves an existing directory at the chat config path untouched', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(chatConfigPath, { recursive: true });
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const isDirectory = await fs
        .stat(chatConfigPath)
        .then((stat) => stat.isDirectory());
      assert.equal(result.branch, 'existing_noop');
      assert.equal(isDirectory, true);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('emits deterministic warning marker on template write failure', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const warningLogs: unknown[][] = [];
    const originalWriteFile = fs.writeFile.bind(fs);
    mock.method(console, 'warn', (...args: unknown[]) => {
      warningLogs.push(args);
    });
    try {
      mock.method(
        fs,
        'writeFile',
        async (...args: Parameters<typeof fs.writeFile>) => {
          const filePath = String(args[0]);
          if (
            filePath.includes(`${path.sep}chat${path.sep}config.toml.`) &&
            filePath.endsWith('.tmp')
          ) {
            const error = new Error('read-only filesystem') as
              | Error
              | NodeJS.ErrnoException;
            (error as NodeJS.ErrnoException).code = 'EROFS';
            throw error;
          }
          return originalWriteFile(...args);
        },
      );
      await assert.rejects(
        async () => ensureChatRuntimeConfigBootstrapped({ codexHome }),
        /read-only filesystem/u,
      );
      assert(
        warningLogs.some((entry) => {
          const payload = entry[1] as
            | {
                branch?: string;
                warningCode?: string;
              }
            | undefined;
          return (
            String(entry[0]) === TASK9_MARKER &&
            payload?.branch === 'template_write_failed' &&
            payload.warningCode === 'EROFS'
          );
        }),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('emits Story 47 markers for seeded and existing chat-template branches', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const infoLogs: unknown[][] = [];
    mock.method(console, 'info', (...args: unknown[]) => {
      infoLogs.push(args);
    });
    try {
      await ensureChatRuntimeConfigBootstrapped({ codexHome });
      await ensureChatRuntimeConfigBootstrapped({ codexHome });
      assert(
        infoLogs.some((entry) => {
          const payload = entry[1] as
            | {
                outcome?: string;
                source?: string;
                success?: boolean;
              }
            | undefined;
          return (
            String(entry[0]) === TASK3_MARKER &&
            payload?.outcome === 'seeded' &&
            payload.source === 'chat_template' &&
            payload.success === true
          );
        }),
      );
      assert(
        infoLogs.some((entry) => {
          const payload = entry[1] as
            | {
                outcome?: string;
                source?: string;
                success?: boolean;
              }
            | undefined;
          return (
            String(entry[0]) === TASK3_MARKER &&
            payload?.outcome === 'existing' &&
            payload.source === 'chat_template' &&
            payload.success === true &&
            (
              payload as {
                config_path?: string;
              }
            ).config_path === chatConfigPath
          );
        }),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
});
describe('runtimeConfig final minimization', () => {
  it('minimizes base config to projects-only and emits deterministic T22 success log', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const infoLogs: string[] = [];
    const errorLogs: string[] = [];
    mock.method(console, 'info', (...args: unknown[]) => {
      infoLogs.push(args.map(String).join(' '));
    });
    mock.method(console, 'error', (...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        baseConfigPath,
        [
          'model = "gpt-5.3-codex-spark"',
          'model_reasoning_effort = "xhigh"',
          'approval_policy = "never"',
          'sandbox_mode = "danger-full-access"',
          '[features]',
          'web_search_request = true',
          '[mcp_servers.context7]',
          'command = "npx"',
          '[projects]',
          '[projects."/data"]',
          'trust_level = "trusted"',
          '[projects."/app/server"]',
          'trust_level = "trusted"',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(chatConfigPath, 'model = "chat-kept"\n', 'utf8');
      await minimizeBaseConfigToProjectsOnly({ codexHome });
      const minimized = await fs.readFile(baseConfigPath, 'utf8');
      assert.match(minimized, /\[projects\]/u);
      assert.match(minimized, /\[projects\."\/data"\]/u);
      assert.match(minimized, /\[projects\."\/app\/server"\]/u);
      assert.doesNotMatch(minimized, /model\s*=/u);
      assert.doesNotMatch(minimized, /approval_policy/u);
      assert.doesNotMatch(minimized, /\[features\]/u);
      assert.doesNotMatch(minimized, /\[mcp_servers/u);
      assert(
        infoLogs.some((line) =>
          line.includes(
            '[DEV-0000037][T22] event=final_config_minimization_completed result=success',
          ),
        ),
      );
      assert.equal(
        errorLogs.some((line) =>
          line.includes(
            '[DEV-0000037][T22] event=final_config_minimization_completed result=error',
          ),
        ),
        false,
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('aborts minimization without mutation when chat config is missing and emits deterministic T22 error log', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const errorLogs: string[] = [];
    const originalBase =
      'model = "gpt-5.3-codex-spark"\n[projects]\n[projects."/data"]\ntrust_level = "trusted"\n';
    mock.method(console, 'error', (...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });
    try {
      await fs.writeFile(baseConfigPath, originalBase, 'utf8');
      await assert.rejects(
        async () => minimizeBaseConfigToProjectsOnly({ codexHome }),
        /T22_CHAT_CONFIG_MISSING/u,
      );
      const afterAttempt = await fs.readFile(baseConfigPath, 'utf8');
      assert.equal(afterAttempt, originalBase);
      assert(
        errorLogs.some((line) =>
          line.includes(
            '[DEV-0000037][T22] event=final_config_minimization_completed result=error',
          ),
        ),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
});
describe('runtimeConfig resolver logging', () => {
  it('logs deterministic T03 success event when configs load', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const agentConfigPath = path.join(codexHome, 'agent.toml');
    const infoLogs: string[] = [];
    mock.method(console, 'info', (...args: unknown[]) => {
      infoLogs.push(args.map(String).join(' '));
    });
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(baseConfigPath, 'model = "base"\n', 'utf8');
      await fs.writeFile(chatConfigPath, 'model = "chat"\n', 'utf8');
      await fs.writeFile(agentConfigPath, 'model = "agent"\n', 'utf8');
      const snapshot = await loadRuntimeConfigSnapshot({
        codexHome,
        agentConfigPath,
      });
      assert.equal(snapshot.baseConfig?.model, 'base');
      assert.equal(snapshot.chatConfig?.model, 'chat');
      assert.equal(snapshot.agentConfig?.model, 'agent');
      assert(
        infoLogs.some((line) =>
          line.includes(
            '[DEV-0000037][T03] event=runtime_config_loaded_and_normalized result=success',
          ),
        ),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('logs deterministic T03 error event when parsing fails', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const errorLogs: string[] = [];
    mock.method(console, 'error', (...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });
    try {
      await fs.writeFile(baseConfigPath, 'model = "broken', 'utf8');
      await assert.rejects(
        async () =>
          loadRuntimeConfigSnapshot({
            codexHome,
            bootstrapChatConfig: false,
          }),
        /Invalid TOML/u,
      );
      assert(
        errorLogs.some((line) =>
          line.includes(
            '[DEV-0000037][T03] event=runtime_config_loaded_and_normalized result=error',
          ),
        ),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('keeps parse-failure logs secret-safe by excluding raw token-like config content', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const secretLikeValue = 'sk-test-secret-token-should-not-leak';
    const errorLogs: string[] = [];
    mock.method(console, 'error', (...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });
    try {
      await fs.writeFile(
        baseConfigPath,
        `model = "broken\napi_key = "${secretLikeValue}"\n`,
        'utf8',
      );
      await assert.rejects(
        async () =>
          loadRuntimeConfigSnapshot({
            codexHome,
            bootstrapChatConfig: false,
          }),
        /Invalid TOML/u,
      );
      assert.equal(
        errorLogs.some((line) => line.includes(secretLikeValue)),
        false,
      );
      assert(
        errorLogs.some((line) =>
          line.includes(
            '[DEV-0000037][T03] event=runtime_config_loaded_and_normalized result=error',
          ),
        ),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
});
describe('runtimeConfig parser', () => {
  it('reads and normalizes a TOML file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-config-'));
    const configPath = path.join(dir, 'config.toml');
    try {
      await fs.writeFile(
        configPath,
        'model = "gpt-5.6-sol"\n[features]\nview_image_tool = true\n',
        'utf8',
      );
      const parsed = await readAndNormalizeRuntimeTomlConfig(configPath, {
        required: true,
      });
      assert.equal(parsed?.model, 'gpt-5.6-sol');
      assert.deepEqual(parsed?.tools, { view_image: true });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
describe('runtimeConfig merge and validation', () => {
  it('merges effectiveProjects with agent projects taking precedence', () => {
    const merged = mergeProjectsFromBaseIntoRuntime(
      {
        projects: {
          '/data': { trust_level: 'trusted' },
          '/base-only': { trust_level: 'trusted' },
        },
        model: 'base-should-not-leak',
      },
      {
        model: 'agent-model',
        projects: {
          '/data': { trust_level: 'untrusted' },
          '/agent-only': { trust_level: 'trusted' },
        },
      },
    );
    assert.equal(merged.model, 'agent-model');
    assert.deepEqual(merged.projects, {
      '/data': { trust_level: 'untrusted' },
      '/base-only': { trust_level: 'trusted' },
      '/agent-only': { trust_level: 'trusted' },
    });
  });
  it('inherits explicit base-only runtime settings while preserving runtime overrides', () => {
    const merged = mergeRuntimeConfigWithBaseConfig(
      {
        personality: 'base-personality',
        model_provider: 'base-provider',
        model_providers: {
          base: { name: 'Base Provider' },
        },
        tools: {
          view_image: true,
        },
        mcp_servers: {
          context7: { command: 'npx' },
        },
        projects: {
          '/base': { trust_level: 'trusted' },
        },
        model: 'base-model',
      },
      {
        model: 'chat-model',
        sandbox_mode: 'read-only',
        projects: {
          '/chat': { trust_level: 'trusted' },
        },
      },
    );
    assert.equal(merged.merged.personality, 'base-personality');
    assert.equal(merged.merged.model_provider, 'base-provider');
    assert.deepEqual(merged.merged.model_providers, {
      base: { name: 'Base Provider' },
    });
    assert.deepEqual(merged.merged.tools, {
      view_image: true,
    });
    assert.deepEqual(merged.merged.mcp_servers, {
      context7: { command: 'npx' },
    });
    assert.deepEqual(merged.merged.projects, {
      '/base': { trust_level: 'trusted' },
      '/chat': { trust_level: 'trusted' },
    });
    assert.equal(merged.merged.model, 'chat-model');
    assert.deepEqual(merged.inheritedKeys.sort(), [
      'mcp_servers',
      'model_provider',
      'model_providers',
      'personality',
      'tools',
    ]);
    assert.ok(merged.runtimeOverrideKeys.includes('model'));
  });
  it('warns and preserves unknown top-level keys for forward compatibility', () => {
    const result = validateRuntimeConfig({
      model: 'gpt-5.6-sol',
      totally_unknown: true,
    });
    assert.equal(result.config.model, 'gpt-5.6-sol');
    assert.equal(result.config.totally_unknown, true);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0].message, /Unknown key/u);
  });
  it('preserves model_provider and model_providers tables for custom provider routing', () => {
    const result = validateRuntimeConfig({
      model: 'openai/gpt-oss-20b',
      model_provider: 'vllm',
      model_providers: {
        vllm: {
          name: 'vLLM Local',
          base_url: 'http://localhost:8000/v1',
          wire_api: 'responses',
        },
      },
    });
    assert.equal(result.config.model_provider, 'vllm');
    assert.deepEqual(result.config.model_providers, {
      vllm: {
        name: 'vLLM Local',
        base_url: 'http://localhost:8000/v1',
        wire_api: 'responses',
      },
    });
    assert.equal(result.warnings.length, 0);
  });
  it('accepts supported codex runtime keys without forward-compatibility warnings', () => {
    const result = validateRuntimeConfig({
      model: 'gpt-5.4-mini',
      web_search_mode: 'disabled',
      model_reasoning_summary: 'concise',
      hide_agent_reasoning: false,
      model_auto_compact_token_limit: 300000,
      model_provider: 'lmstudiospark',
      model_providers: {
        lmstudiospark: {
          name: 'LM Studio Spark',
          base_url: 'http://localhost:1234/v1',
        },
      },
      plugins: {
        'github@openai-curated': {
          enabled: true,
        },
      },
      features: {
        fast_mode: false,
      },
    });
    assert.equal(result.config.model_reasoning_summary, 'concise');
    assert.equal(result.config.web_search, 'disabled');
    assert.equal(result.config.hide_agent_reasoning, false);
    assert.equal(result.config.model_auto_compact_token_limit, 300000);
    assert.equal(result.config.model_provider, 'lmstudiospark');
    assert.deepEqual(result.config.model_providers, {
      lmstudiospark: {
        name: 'LM Studio Spark',
        base_url: 'http://localhost:1234/v1',
      },
    });
    assert.deepEqual(result.config.plugins, {
      'github@openai-curated': {
        enabled: true,
      },
    });
    assert.deepEqual(result.config.features, {
      fast_mode: false,
    });
    assert.equal(result.warnings.length, 0);
  });
  it('warns and preserves unknown nested keys while keeping known key validation', () => {
    const result = validateRuntimeConfig({
      model: 'gpt-5.6-sol',
      tools: {
        view_image: true,
        unknown_tool_field: { nested: true },
      },
      features: {
        unknown_feature_flag: true,
      },
      projects: {
        '/data': {
          trust_level: 'trusted',
          project_unknown: 'preserved',
        },
      },
    });
    assert.deepEqual(result.config.tools, {
      view_image: true,
      unknown_tool_field: { nested: true },
    });
    assert.deepEqual(result.config.features, {
      unknown_feature_flag: true,
    });
    assert.deepEqual(result.config.projects, {
      '/data': {
        trust_level: 'trusted',
        project_unknown: 'preserved',
      },
    });
    assert.equal(result.warnings.length, 3);
  });
  it('warns and ignores misplaced cli_auth_credentials_store under project path', () => {
    const result = validateRuntimeConfig({
      model: 'gpt-5.6-sol',
      projects: {
        '/data': {
          trust_level: 'trusted',
          cli_auth_credentials_store: 'file',
        },
      },
    });
    assert.equal(result.warnings.length, 1);
    assert.match(
      result.warnings[0].path,
      /projects\..*cli_auth_credentials_store/u,
    );
    const projects = result.config.projects as Record<string, unknown>;
    const dataProject = projects['/data'] as Record<string, unknown>;
    assert.equal('cli_auth_credentials_store' in dataProject, false);
  });
  it('ignores unsafe top-level keys and preserves safe unknown keys', () => {
    const config = Object.create(null) as Record<string, unknown>;
    config.model = 'gpt-5.6-sol';
    config.safe_unknown = { keep: true };
    config['__proto__'] = { polluted: true };
    config['constructor'] = { polluted: true };
    config['prototype'] = { polluted: true };
    const result = validateRuntimeConfig(config);
    assert.equal(result.config.model, 'gpt-5.6-sol');
    assert.deepEqual(result.config.safe_unknown, { keep: true });
    assert.equal(Object.hasOwn(result.config, '__proto__'), false);
    assert.equal(Object.hasOwn(result.config, 'constructor'), false);
    assert.equal(Object.hasOwn(result.config, 'prototype'), false);
    assert.equal(
      (
        {} as {
          polluted?: boolean;
        }
      ).polluted,
      undefined,
    );
    assert.equal(result.warnings.length, 4);
    assert.ok(
      result.warnings.some((warning) =>
        warning.message.includes('Unsafe key runtime.__proto__'),
      ),
    );
  });
  it('ignores unsafe nested unknown keys in tools/features/projects while preserving safe unknown keys', () => {
    const tools = Object.create(null) as Record<string, unknown>;
    tools.unknown_tool_field = { nested: true };
    tools['__proto__'] = { polluted: true };
    const features = Object.create(null) as Record<string, unknown>;
    features.unknown_feature_flag = true;
    features['constructor'] = { polluted: true };
    const project = Object.create(null) as Record<string, unknown>;
    project.trust_level = 'trusted';
    project.project_unknown = 'preserved';
    project['prototype'] = { polluted: true };
    const projects = Object.create(null) as Record<string, unknown>;
    projects['/safe'] = project;
    projects['__proto__'] = { polluted: true };
    const result = validateRuntimeConfig({
      model: 'gpt-5.6-sol',
      tools,
      features,
      projects,
    });
    assert.deepEqual(result.config.tools, {
      unknown_tool_field: { nested: true },
    });
    assert.deepEqual(result.config.features, {
      unknown_feature_flag: true,
    });
    assert.deepEqual(result.config.projects, {
      '/safe': {
        trust_level: 'trusted',
        project_unknown: 'preserved',
      },
    });
    assert.equal(
      Object.hasOwn(result.config.tools as object, '__proto__'),
      false,
    );
    assert.equal(
      Object.hasOwn(result.config.features as object, 'constructor'),
      false,
    );
    assert.equal(
      Object.hasOwn(result.config.projects as object, '__proto__'),
      false,
    );
    assert.equal(
      (
        {} as {
          polluted?: boolean;
        }
      ).polluted,
      undefined,
    );
    assert.ok(
      result.warnings.some((warning) =>
        warning.message.includes('Unsafe key runtime.tools.__proto__'),
      ),
    );
    assert.ok(
      result.warnings.some((warning) =>
        warning.message.includes('Unsafe key runtime.features.constructor'),
      ),
    );
    assert.ok(
      result.warnings.some((warning) =>
        warning.message.includes('Unsafe key runtime.projects.__proto__'),
      ),
    );
    assert.ok(
      result.warnings.some((warning) =>
        warning.message.includes('Unsafe key runtime.projects./safe.prototype'),
      ),
    );
  });
  it('hard-fails supported keys with invalid types', () => {
    assert.throws(
      () =>
        validateRuntimeConfig({
          model: 'gpt-5.6-sol',
          tools: {
            view_image: 'true',
          },
        }),
      /invalid type/u,
    );
  });
});
describe('runtimeConfig Context7 overlay', () => {
  it('resolves CODEINFO_SERVER_PORT placeholders through the shared runtime path', () => {
    setScopedTestEnvValue('CODEINFO_SERVER_PORT', '6510');
    const normalized = normalizeCodeinfoRuntimeConfigPlaceholders({
      mcp_servers: {
        ingest: {
          url: 'http://localhost:${CODEINFO_SERVER_PORT}/mcp',
        },
      },
    });
    assert.deepEqual(normalized.mcp_servers, {
      ingest: { url: 'http://localhost:6510/mcp' },
    });
  });
  it('resolves CODEINFO_CHAT_MCP_PORT placeholders through the shared runtime path', () => {
    setScopedTestEnvValue('CODEINFO_CHAT_MCP_PORT', '6511');
    const normalized = normalizeCodeinfoRuntimeConfigPlaceholders({
      mcp_servers: {
        code_info: {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            'http://localhost:${CODEINFO_CHAT_MCP_PORT}/mcp',
          ],
        },
      },
    });
    assert.deepEqual(normalized.mcp_servers, {
      code_info: {
        command: 'npx',
        args: ['-y', 'mcp-remote', 'http://localhost:6511/mcp'],
      },
    });
  });
  it('resolves CODEINFO_AGENTS_MCP_PORT placeholders through the shared runtime path', () => {
    setScopedTestEnvValue('CODEINFO_AGENTS_MCP_PORT', '6512');
    const normalized = normalizeCodeinfoRuntimeConfigPlaceholders({
      mcp_servers: {
        agents: {
          url: 'http://localhost:${CODEINFO_AGENTS_MCP_PORT}/mcp',
        },
      },
    });
    assert.deepEqual(normalized.mcp_servers, {
      agents: { url: 'http://localhost:6512/mcp' },
    });
  });
  it('resolves CODEINFO_WEB_MCP_PORT placeholders through the shared runtime path', () => {
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '6513');
    const normalized = normalizeCodeinfoRuntimeConfigPlaceholders({
      mcp_servers: {
        web_tools: {
          url: 'http://localhost:${CODEINFO_WEB_MCP_PORT}/mcp',
        },
      },
    });
    assert.deepEqual(normalized.mcp_servers, {
      web_tools: { url: 'http://localhost:6513/mcp' },
    });
  });
  it('resolves CODEINFO_PLAYWRIGHT_MCP_URL through the shared runtime path', () => {
    setScopedTestEnvValue(
      'CODEINFO_PLAYWRIGHT_MCP_URL',
      'http://localhost:8931/mcp/playwright',
    );
    const normalized = normalizeCodeinfoRuntimeConfigPlaceholders({
      mcp_servers: {
        playwright: {
          url: 'CODEINFO_PLAYWRIGHT_MCP_URL',
        },
      },
    });
    assert.deepEqual(normalized.mcp_servers, {
      playwright: { url: 'http://localhost:8931/mcp/playwright' },
    });
  });
  it('prefers the full Playwright MCP URL override over derived localhost contract values', () => {
    setScopedTestEnvValue('CODEINFO_CHAT_MCP_PORT', '6511');
    setScopedTestEnvValue(
      'CODEINFO_PLAYWRIGHT_MCP_URL',
      'http://localhost:8931/mcp/playwright',
    );
    const endpoints = resolveCodeinfoMcpEndpointContract();
    assert.equal(endpoints.chatMcpUrl, 'http://localhost:6511/mcp');
    assert.equal(
      endpoints.playwrightMcpUrl,
      'http://localhost:8931/mcp/playwright',
    );
    assert.notEqual(endpoints.playwrightMcpUrl, endpoints.chatMcpUrl);
  });
  it('fails clearly when a required MCP placeholder remains unresolved', () => {
    clearScopedTestEnvValue('CODEINFO_PLAYWRIGHT_MCP_URL');
    assert.throws(
      () =>
        normalizeCodeinfoRuntimeConfigPlaceholders({
          mcp_servers: {
            playwright: {
              url: 'CODEINFO_PLAYWRIGHT_MCP_URL',
            },
          },
        }),
      /Unresolved required MCP placeholder CODEINFO_PLAYWRIGHT_MCP_URL/u,
    );
  });
  it('normalizes the checked-in example config through the migrated placeholder contract', async () => {
    const configPath = path.join(repoRoot, 'config.toml.example');
    const parsed = await readAndNormalizeRuntimeTomlConfig(configPath, {
      required: true,
    });
    const normalized = normalizeCodeinfoRuntimeConfigPlaceholders(parsed!, {
      CODEINFO_SERVER_PORT: '6010',
      CODEINFO_CHAT_MCP_PORT: '6011',
      CODEINFO_AGENTS_MCP_PORT: '6012',
      CODEINFO_WEB_MCP_PORT: '6013',
      CODEINFO_PLAYWRIGHT_MCP_URL: 'http://localhost:8932/mcp',
    });
    assert.deepEqual(normalized.mcp_servers, {
      context7: {
        command: 'npx',
        args: [
          '-y',
          '@upstash/context7-mcp',
          '--api-key',
          'ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866',
        ],
        startup_timeout_sec: 20,
      },
      mui: {
        command: 'npx',
        args: ['-y', '@mui/mcp@latest'],
      },
      deepwiki: {
        url: 'https://mcp.deepwiki.com/mcp',
        startup_timeout_sec: 20,
      },
      chrome_devtools: {
        command: 'npx',
        args: [
          '-y',
          'chrome-devtools-mcp@latest',
          '--browser-url=http://127.0.0.1:9222',
        ],
        startup_timeout_sec: 20,
      },
      code_info: {
        command: 'npx',
        args: ['-y', 'mcp-remote', 'http://localhost:6010/mcp'],
        startup_timeout_sec: 60,
      },
    });
  });
  it('resolves checked-in chat MCP placeholders from CODEINFO_CHAT_MCP_PORT', async () => {
    const configPath = path.join(
      repoRoot,
      'codeinfo_agents/tasking_agent/config.toml',
    );
    const parsed = await readAndNormalizeRuntimeTomlConfig(configPath, {
      required: true,
    });
    const normalized = normalizeCodeinfoRuntimeConfigPlaceholders(parsed!, {
      CODEINFO_CHAT_MCP_PORT: '6511',
      CODEINFO_AGENTS_MCP_PORT: '6512',
      CODEINFO_WEB_MCP_PORT: '6513',
      CODEINFO_PLAYWRIGHT_MCP_URL: 'http://localhost:8931/mcp',
    });
    assert.deepEqual(
      (normalized.mcp_servers as Record<string, unknown>).code_info,
      {
        command: 'npx',
        args: [
          '-y',
          'mcp-remote',
          'http://localhost:6511/mcp',
          '--allow-http',
        ],
        startup_timeout_sec: 60,
        tool_timeout_sec: 1800,
      },
    );
  });
  it('resolves checked-in root .env.e2e MCP placeholders from the wrapper env file shape', async () => {
    const envText = await fs.readFile(path.join(repoRoot, '.env.e2e'), 'utf8');
    const env = parse(envText);
    const parsed = await readAndNormalizeRuntimeTomlConfig(
      path.join(repoRoot, 'codex/chat/config.toml'),
      { required: true },
    );
    const normalized = normalizeCodeinfoRuntimeConfigPlaceholders(
      parsed!,
      env as NodeJS.ProcessEnv,
    );
    assert.deepEqual(
      (normalized.mcp_servers as Record<string, unknown>).code_info,
      {
        command: 'npx',
        args: ['-y', 'mcp-remote', 'http://localhost:6010/mcp'],
        startup_timeout_sec: 60,
      },
    );
    assert.equal(
      (normalized.mcp_servers as Record<string, unknown>).web_tools,
      undefined,
    );
  });
  it('does not let legacy CODEINFO_MCP_PORT satisfy checked-in chat MCP placeholders', async () => {
    const parsed = await readAndNormalizeRuntimeTomlConfig(
      path.join(repoRoot, 'codeinfo_agents/tasking_agent/config.toml'),
      { required: true },
    );
    const normalized = normalizeCodeinfoRuntimeConfigPlaceholders(parsed!, {
      CODEINFO_MCP_PORT: '6511',
      CODEINFO_AGENTS_MCP_PORT: '6512',
      CODEINFO_PLAYWRIGHT_MCP_URL: 'http://localhost:8931/mcp',
    });
    assert.deepEqual(
      (normalized.mcp_servers as Record<string, unknown>).code_info,
      {
        command: 'npx',
        args: [
          '-y',
          'mcp-remote',
          'http://localhost:5011/mcp',
          '--allow-http',
        ],
        startup_timeout_sec: 60,
        tool_timeout_sec: 1800,
      },
    );
  });
  it('logs the checked-in MCP contract marker when chat runtime config loads', async () => {
    setScopedTestEnvValue('CODEINFO_SERVER_PORT', '6010');
    setScopedTestEnvValue('CODEINFO_CHAT_MCP_PORT', '6011');
    setScopedTestEnvValue('CODEINFO_AGENTS_MCP_PORT', '6012');
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '6013');
    setScopedTestEnvValue(
      'CODEINFO_PLAYWRIGHT_MCP_URL',
      'http://localhost:8932/mcp/playwright',
    );
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const infoLogs: unknown[][] = [];
    mock.method(console, 'info', (...args: unknown[]) => {
      infoLogs.push(args);
    });
    try {
      await fs.copyFile(
        path.join(repoRoot, 'config.toml.example'),
        path.join(codexHome, 'config.toml'),
      );
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.copyFile(
        path.join(repoRoot, 'codex/chat/config.toml'),
        path.join(codexHome, 'chat/config.toml'),
      );
      await resolveChatRuntimeConfig({ codexHome });
      assert(
        infoLogs.some((entry) => {
          const payload = entry[1] as
            | {
                configPath?: string;
                chatPortVar?: string;
                agentsPortVar?: string;
                webPortVar?: string;
                playwrightUrlVar?: string;
                legacyFallbackUsed?: boolean;
              }
            | undefined;
          return (
            entry[0] === 'DEV-0000050:T07:checked_in_mcp_contract_loaded' &&
            payload?.configPath === path.join(codexHome, 'chat/config.toml') &&
            payload.chatPortVar === 'CODEINFO_CHAT_MCP_PORT' &&
            payload.agentsPortVar === 'CODEINFO_AGENTS_MCP_PORT' &&
            payload.webPortVar === 'CODEINFO_WEB_MCP_PORT' &&
            payload.playwrightUrlVar === 'CODEINFO_PLAYWRIGHT_MCP_URL' &&
            payload.legacyFallbackUsed === false
          );
        }),
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('does not report a legacy MCP fallback when only CODEINFO_MCP_PORT is set', async () => {
    setScopedTestEnvValue('CODEINFO_SERVER_PORT', '6010');
    clearScopedTestEnvValue('CODEINFO_CHAT_MCP_PORT');
    setScopedTestEnvValue('CODEINFO_MCP_PORT', '6011');
    setScopedTestEnvValue('CODEINFO_AGENTS_MCP_PORT', '6012');
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '6013');
    setScopedTestEnvValue(
      'CODEINFO_PLAYWRIGHT_MCP_URL',
      'http://localhost:8932/mcp/playwright',
    );
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const infoLogs: unknown[][] = [];
    mock.method(console, 'info', (...args: unknown[]) => {
      infoLogs.push(args);
    });
    try {
      await fs.copyFile(
        path.join(repoRoot, 'config.toml.example'),
        path.join(codexHome, 'config.toml'),
      );
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.copyFile(
        path.join(repoRoot, 'codex/chat/config.toml'),
        path.join(codexHome, 'chat/config.toml'),
      );
      await resolveChatRuntimeConfig({ codexHome });
      assert(
        infoLogs.some((entry) => {
          const payload = entry[1] as
            | {
                legacyFallbackUsed?: boolean;
              }
            | undefined;
          return (
            entry[0] === 'DEV-0000050:T07:checked_in_mcp_contract_loaded' &&
            payload?.legacyFallbackUsed === false
          );
        }),
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('replaces MCP placeholder values in memory before validation', () => {
    setScopedTestEnvValue('CODEINFO_SERVER_PORT', '5510');
    setScopedTestEnvValue('CODEINFO_CHAT_MCP_PORT', '5511');
    setScopedTestEnvValue('CODEINFO_AGENTS_MCP_PORT', '5512');
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '5513');
    setScopedTestEnvValue(
      'CODEINFO_PLAYWRIGHT_MCP_URL',
      'http://localhost:8931/mcp',
    );
    const normalized = normalizeCodeinfoRuntimeConfigPlaceholders({
      mcp_servers: {
        code_info: {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            'http://localhost:${CODEINFO_CHAT_MCP_PORT}/mcp',
          ],
        },
        ingest: {
          url: 'http://localhost:${CODEINFO_SERVER_PORT}/mcp',
        },
        agents: {
          url: 'http://localhost:${CODEINFO_AGENTS_MCP_PORT}/mcp',
        },
        web_tools: {
          url: 'http://localhost:${CODEINFO_WEB_MCP_PORT}/mcp',
        },
        playwright: {
          url: 'CODEINFO_PLAYWRIGHT_MCP_URL',
        },
      },
    });
    assert.deepEqual(normalized.mcp_servers, {
      code_info: {
        command: 'npx',
        args: ['-y', 'mcp-remote', 'http://localhost:5511/mcp'],
      },
      ingest: {
        url: 'http://localhost:5510/mcp',
      },
      agents: {
        url: 'http://localhost:5512/mcp',
      },
      web_tools: {
        url: 'http://localhost:5513/mcp',
      },
      playwright: {
        url: 'http://localhost:8931/mcp',
      },
    });
  });
  it('replaces REPLACE_WITH_CONTEXT7_API_KEY in memory from CODEINFO_CONTEXT7_API_KEY', () => {
    setScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY', 'ctx7sk-real');
    const normalized = normalizeContext7RuntimeConfig({
      mcp_servers: {
        context7: {
          command: 'npx',
          args: [
            '-y',
            '@upstash/context7-mcp',
            '--api-key',
            'REPLACE_WITH_CONTEXT7_API_KEY',
          ],
        },
      },
    });
    assert.equal(normalized.mode, 'env_overlay');
    assert.deepEqual(normalized.config.mcp_servers, {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real'],
      },
    });
  });
  it('treats the legacy seeded Context7 key as a placeholder and overlays the env key', () => {
    setScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY', 'ctx7sk-real');
    const normalized = normalizeContext7RuntimeConfig({
      mcp_servers: {
        context7: {
          command: 'npx',
          args: [
            '-y',
            '@upstash/context7-mcp',
            '--api-key',
            'ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866',
          ],
        },
      },
    });
    assert.equal(normalized.mode, 'env_overlay');
    assert.deepEqual(normalized.config.mcp_servers, {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real'],
      },
    });
  });
  it('preserves an explicit non-placeholder Context7 API key', () => {
    setScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY', 'ctx7sk-env');
    const normalized = normalizeContext7RuntimeConfig({
      mcp_servers: {
        context7: {
          command: 'npx',
          args: [
            '-y',
            '@upstash/context7-mcp',
            '--api-key',
            'ctx7sk-user-supplied',
          ],
        },
      },
    });
    assert.equal(normalized.mode, 'explicit_key_preserved');
    assert.deepEqual(normalized.config.mcp_servers, {
      context7: {
        command: 'npx',
        args: [
          '-y',
          '@upstash/context7-mcp',
          '--api-key',
          'ctx7sk-user-supplied',
        ],
      },
    });
  });
  it('appends CODEINFO_CONTEXT7_API_KEY to an already-no-key Context7 args list in memory', () => {
    setScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY', 'ctx7sk-real');
    const normalized = normalizeContext7RuntimeConfig({
      mcp_servers: {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
        },
      },
    });
    assert.equal(normalized.mode, 'env_overlay');
    assert.deepEqual(normalized.config.mcp_servers, {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real'],
      },
    });
  });
  it('leaves an already-no-key Context7 args list unchanged when the env key is blank', () => {
    setScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY', '   ');
    const normalized = normalizeContext7RuntimeConfig({
      mcp_servers: {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
        },
      },
    });
    assert.equal(normalized.mode, 'no_key_fallback');
    assert.deepEqual(normalized.config.mcp_servers, {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp'],
      },
    });
  });
  it('falls back to the no-key args form when the env key is missing empty or whitespace-only', () => {
    const variants = [undefined, '', '   '];
    for (const value of variants) {
      if (value === undefined) {
        clearScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY');
      } else {
        setScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY', value);
      }
      const normalized = normalizeContext7RuntimeConfig({
        mcp_servers: {
          context7: {
            command: 'npx',
            args: [
              '-y',
              '@upstash/context7-mcp',
              '--api-key',
              'REPLACE_WITH_CONTEXT7_API_KEY',
            ],
          },
        },
      });
      assert.equal(normalized.mode, 'no_key_fallback');
      assert.deepEqual(normalized.config.mcp_servers, {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
        },
      });
    }
  });
  it('leaves configs without a Context7 definition unchanged', () => {
    const input = {
      mcp_servers: {
        deepwiki: {
          url: 'https://mcp.deepwiki.com/mcp',
        },
      },
    };
    const normalized = normalizeContext7RuntimeConfig(input);
    assert.equal(normalized.mode, 'no_context7_definition');
    assert.deepEqual(normalized.config, input);
  });
  it('removes only the api-key pair and preserves the order of unrelated args', () => {
    clearScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY');
    const normalized = normalizeContext7RuntimeConfig({
      mcp_servers: {
        context7: {
          command: 'npx',
          args: [
            '--debug',
            '-y',
            '@upstash/context7-mcp',
            '--api-key',
            'REPLACE_WITH_CONTEXT7_API_KEY',
            '--transport',
            'stdio',
          ],
        },
      },
    });
    assert.equal(normalized.mode, 'no_key_fallback');
    assert.deepEqual(normalized.config.mcp_servers, {
      context7: {
        command: 'npx',
        args: [
          '--debug',
          '-y',
          '@upstash/context7-mcp',
          '--transport',
          'stdio',
        ],
      },
    });
  });
  it('leaves remote url and http_headers Context7 definitions unchanged', () => {
    setScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY', 'ctx7sk-real');
    const input = {
      mcp_servers: {
        context7: {
          url: 'https://mcp.context7.test',
          http_headers: {
            Authorization: 'Bearer abc',
          },
        },
      },
    };
    const normalized = normalizeContext7RuntimeConfig(input);
    assert.equal(normalized.mode, 'no_context7_definition');
    assert.deepEqual(normalized.config, input);
  });
  it('does not rewrite runtime config files on disk when overlaying Context7 keys', async () => {
    setScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY', 'ctx7sk-real');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        baseConfigPath,
        [
          '[mcp_servers.context7]',
          'command = "npx"',
          'args = ["-y", "@upstash/context7-mcp", "--api-key", "REPLACE_WITH_CONTEXT7_API_KEY"]',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(chatConfigPath, 'model = "chat-model"\n', 'utf8');
      await resolveChatRuntimeConfig({ codexHome });
      const baseContents = await fs.readFile(baseConfigPath, 'utf8');
      assert.match(baseContents, /REPLACE_WITH_CONTEXT7_API_KEY/u);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('resolves chat runtime with the inherited overlaid Context7 definition from base config', async () => {
    setScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY', 'ctx7sk-real');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        baseConfigPath,
        [
          '[mcp_servers.context7]',
          'command = "npx"',
          'args = ["-y", "@upstash/context7-mcp", "--api-key", "REPLACE_WITH_CONTEXT7_API_KEY"]',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(chatConfigPath, 'model = "chat-model"\n', 'utf8');
      const resolved = await resolveChatRuntimeConfig({ codexHome });
      assert.deepEqual(resolved.config.mcp_servers, {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real'],
        },
      });
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('resolves chat runtime with an inherited no-key Context7 definition overlaid from CODEINFO_CONTEXT7_API_KEY', async () => {
    setScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY', 'ctx7sk-real');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        baseConfigPath,
        [
          '[mcp_servers.context7]',
          'command = "npx"',
          'args = ["-y", "@upstash/context7-mcp"]',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(chatConfigPath, 'model = "chat-model"\n', 'utf8');
      const resolved = await resolveChatRuntimeConfig({ codexHome });
      assert.deepEqual(resolved.config.mcp_servers, {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real'],
        },
      });
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('leaves malformed local stdio Context7 shapes unchanged', () => {
    setScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY', 'ctx7sk-real');
    const nonArrayArgs = normalizeContext7RuntimeConfig({
      mcp_servers: {
        context7: {
          command: 'npx',
          args: 'broken',
        },
      },
    });
    assert.equal(nonArrayArgs.mode, 'no_context7_definition');
    assert.deepEqual(nonArrayArgs.config.mcp_servers, {
      context7: {
        command: 'npx',
        args: 'broken',
      },
    });
    const missingPair = normalizeContext7RuntimeConfig({
      mcp_servers: {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp', '--api-key'],
        },
      },
    });
    assert.equal(missingPair.mode, 'no_context7_definition');
    assert.deepEqual(missingPair.config.mcp_servers, {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp', '--api-key'],
      },
    });
  });
});
describe('runtimeConfig deterministic resolver failures', () => {
  it('hard-fails missing agent config with deterministic code', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const agentConfigPath = path.join(codexHome, 'missing-agent-config.toml');
    try {
      await assert.rejects(
        async () =>
          resolveAgentRuntimeConfig({
            codexHome,
            agentConfigPath,
          }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed?.code === 'RUNTIME_CONFIG_MISSING' &&
            typed?.surface === 'agent'
          );
        },
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('hard-fails invalid agent TOML with deterministic code', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const agentConfigPath = path.join(codexHome, 'agent-config.toml');
    try {
      await fs.writeFile(agentConfigPath, 'model = "broken', 'utf8');
      await assert.rejects(
        async () =>
          resolveAgentRuntimeConfig({
            codexHome,
            agentConfigPath,
          }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed?.code === 'RUNTIME_CONFIG_INVALID' &&
            typed?.surface === 'agent'
          );
        },
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('hard-fails unreadable agent config with deterministic code', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const agentConfigPath = path.join(codexHome, 'agent-config.toml');
    const originalReadFile = fs.readFile.bind(fs);
    try {
      await fs.writeFile(agentConfigPath, 'model = "gpt-5.6-sol"\n', 'utf8');
      mock.method(
        fs,
        'readFile',
        async (filePath: PathLike, encoding?: BufferEncoding) => {
          if (filePath === agentConfigPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
          }
          return originalReadFile(filePath, encoding as BufferEncoding);
        },
      );
      await assert.rejects(
        async () =>
          resolveAgentRuntimeConfig({
            codexHome,
            agentConfigPath,
          }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed?.code === 'RUNTIME_CONFIG_UNREADABLE' &&
            typed?.surface === 'agent'
          );
        },
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('hard-fails missing chat config with deterministic code', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    try {
      await assert.rejects(
        async () =>
          resolveChatRuntimeConfig({
            codexHome,
          }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed?.code === 'RUNTIME_CONFIG_MISSING' &&
            typed?.surface === 'chat'
          );
        },
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('treats a missing Copilot chat config as an empty overlay and still resolves base config', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'copilot-runtime-home-'),
    );
    const copilotHome = path.join(tempRoot, 'copilot');
    try {
      await fs.mkdir(copilotHome, { recursive: true });
      await fs.writeFile(
        path.join(copilotHome, 'config.toml'),
        'model = "copilot-gpt-5"\n',
        'utf8',
      );
      const resolved = await resolveChatRuntimeConfig({
        provider: 'copilot',
        copilotHome,
      });
      assert.equal(resolved.config.model, 'copilot-gpt-5');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('hard-fails invalid chat TOML with deterministic code', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(chatConfigPath, 'model = "broken', 'utf8');
      await assert.rejects(
        async () =>
          resolveChatRuntimeConfig({
            codexHome,
          }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed?.code === 'RUNTIME_CONFIG_INVALID' &&
            typed?.surface === 'chat'
          );
        },
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('hard-fails unreadable chat config with deterministic code', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const originalReadFile = fs.readFile.bind(fs);
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(chatConfigPath, 'model = "gpt-5.6-sol"\n', 'utf8');
      mock.method(
        fs,
        'readFile',
        async (filePath: PathLike, encoding?: BufferEncoding) => {
          if (filePath === chatConfigPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
          }
          return originalReadFile(filePath, encoding as BufferEncoding);
        },
      );
      await assert.rejects(
        async () =>
          resolveChatRuntimeConfig({
            codexHome,
          }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed?.code === 'RUNTIME_CONFIG_UNREADABLE' &&
            typed?.surface === 'chat'
          );
        },
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('classifies repository-backed chat runtime-home filesystem failures as unreadable and removes partial runtime-home state', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const authPath = path.join(codexHome, 'auth.json');
    const originalWriteFile = fs.writeFile.bind(fs);
    const runtimesRoot = path.join(codexHome, '.codeinfo-chat-runtimes');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(baseConfigPath, '', 'utf8');
      await fs.writeFile(chatConfigPath, 'model = "gpt-5.6-sol"\n', 'utf8');
      await fs.writeFile(authPath, '{}', 'utf8');
      mock.method(
        fs,
        'writeFile',
        async (
          filePath: PathLike,
          data: string | NodeJS.ArrayBufferView,
          options?: BufferEncoding | Record<string, unknown>,
        ) => {
          const target = String(filePath);
          if (
            target.includes(`${path.sep}.codeinfo-chat-runtimes${path.sep}`) &&
            target.endsWith(`${path.sep}chat${path.sep}config.toml`)
          ) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
          }
          return originalWriteFile(
            filePath,
            data,
            options as Parameters<typeof fs.writeFile>[2],
          );
        },
      );
      await assert.rejects(
        async () =>
          materializeRepositoryBackedCodexChatHome({
            conversationId: 'conv:repo-backed',
            codexHome,
            overrides: { model: 'gpt-5.6-sol' },
          }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed?.code === 'RUNTIME_CONFIG_UNREADABLE' &&
            typed?.surface === 'chat' &&
            /repository-backed chat runtime home/u.test(typed?.message ?? '')
          );
        },
      );
      const runtimeEntries = await fs.readdir(runtimesRoot).catch(() => []);
      assert.deepEqual(runtimeEntries, []);
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('resolves required MCP placeholders in materialized repository-backed chat configs', async () => {
    setScopedTestEnvValue('CODEINFO_SERVER_PORT', '7410');
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '7413');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const baseConfigPath = path.join(codexHome, 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.copyFile(
        path.join(repoRoot, 'config.toml.example'),
        baseConfigPath,
      );
      await fs.copyFile(
        path.join(repoRoot, 'codex/chat/config.toml'),
        chatConfigPath,
      );
      const materialized = await materializeRepositoryBackedCodexChatHome({
        conversationId: 'conv:placeholder-resolution',
        codexHome,
        overrides: { model: 'gpt-5.6-sol' },
      });
      const runtimeChatConfig = await fs.readFile(
        materialized.chatConfigPath,
        'utf8',
      );
      assert.match(runtimeChatConfig, /http:\/\/localhost:7410\/mcp/u);
      assert.doesNotMatch(runtimeChatConfig, /http:\/\/localhost:7413\/mcp/u);
      assert.doesNotMatch(
        runtimeChatConfig,
        /\$\{CODEINFO_(SERVER|WEB_MCP)_PORT\}/u,
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('injects managed web_tools into materialized repository-backed chat configs when requested', async () => {
    setScopedTestEnvValue('CODEINFO_SERVER_PORT', '7410');
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '7413');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const baseConfigPath = path.join(codexHome, 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.copyFile(
        path.join(repoRoot, 'config.toml.example'),
        baseConfigPath,
      );
      await fs.copyFile(
        path.join(repoRoot, 'codex/chat/config.toml'),
        chatConfigPath,
      );
      const materialized = await materializeRepositoryBackedCodexChatHome({
        conversationId: 'conv:managed-web-tools',
        codexHome,
        overrides: { model: 'unsloth/gemma-4-26b-A4b-it-qat-GGUF' },
        injectWebTools: true,
      });
      const runtimeChatConfig = await fs.readFile(
        materialized.chatConfigPath,
        'utf8',
      );
      assert.match(runtimeChatConfig, /\[mcp_servers\.web_tools\]/u);
      assert.match(runtimeChatConfig, /http:\/\/localhost:7413\/mcp/u);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('replaces indented CRLF web_tools blocks cleanly when materialized repository-backed injection is enabled', async () => {
    setScopedTestEnvValue('CODEINFO_SERVER_PORT', '7420');
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '7423');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const baseConfigPath = path.join(codexHome, 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.copyFile(
        path.join(repoRoot, 'config.toml.example'),
        baseConfigPath,
      );
      await fs.writeFile(
        chatConfigPath,
        [
          'model = "gpt-5.6-sol"',
          '',
          '[mcp_servers.code_info]',
          'command = "npx"',
          'args = ["-y", "mcp-remote", "http://localhost:${CODEINFO_SERVER_PORT}/mcp"]',
          'startup_timeout_sec = 60',
          '',
          '  [mcp_servers.web_tools]',
          'command = "npx"',
          'args = ["-y", "mcp-remote", "http://localhost:${CODEINFO_WEB_MCP_PORT}/mcp"]',
          'startup_timeout_sec = 60',
          '',
          '  [mcp_servers.web_tools]',
          'command = "npx"',
          'args = ["-y", "mcp-remote", "http://localhost:${CODEINFO_WEB_MCP_PORT}/mcp"]',
          'startup_timeout_sec = 60',
          '',
          '  [tools]',
          'view_image = true',
          '',
        ].join('\r\n'),
        'utf8',
      );
      const materialized = await materializeRepositoryBackedCodexChatHome({
        conversationId: 'conv:managed-web-tools-crlf',
        codexHome,
        overrides: { model: 'unsloth/gemma-4-26b-A4b-it-qat-GGUF' },
        injectWebTools: true,
      });
      const runtimeChatConfig = await fs.readFile(
        materialized.chatConfigPath,
        'utf8',
      );
      assert.equal(
        runtimeChatConfig.match(/\[mcp_servers\.web_tools\]/gu)?.length ?? 0,
        1,
      );
      assert.match(runtimeChatConfig, /http:\/\/localhost:7423\/mcp/u);
      assert.match(runtimeChatConfig, /[ \t]*\[tools\]\r?\nview_image = true/u);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('removes indented CRLF web_tools blocks when repository-backed materialization does not inject them', async () => {
    setScopedTestEnvValue('CODEINFO_SERVER_PORT', '7430');
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '7433');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const baseConfigPath = path.join(codexHome, 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.copyFile(
        path.join(repoRoot, 'config.toml.example'),
        baseConfigPath,
      );
      await fs.writeFile(
        chatConfigPath,
        [
          'model = "gpt-5.6-sol"',
          '',
          '[mcp_servers.code_info]',
          'command = "npx"',
          'args = ["-y", "mcp-remote", "http://localhost:${CODEINFO_SERVER_PORT}/mcp"]',
          'startup_timeout_sec = 60',
          '',
          '  [mcp_servers.web_tools]',
          'command = "npx"',
          'args = ["-y", "mcp-remote", "http://localhost:${CODEINFO_WEB_MCP_PORT}/mcp"]',
          'startup_timeout_sec = 60',
          '',
          '  [mcp_servers.web_tools]',
          'command = "npx"',
          'args = ["-y", "mcp-remote", "http://localhost:${CODEINFO_WEB_MCP_PORT}/mcp"]',
          'startup_timeout_sec = 60',
          '',
          '  [tools]',
          'view_image = true',
          '',
        ].join('\r\n'),
        'utf8',
      );
      const materialized = await materializeRepositoryBackedCodexChatHome({
        conversationId: 'conv:managed-web-tools-crlf-removed',
        codexHome,
        overrides: { model: 'unsloth/gemma-4-26b-A4b-it-qat-GGUF' },
        injectWebTools: false,
      });
      const runtimeChatConfig = await fs.readFile(
        materialized.chatConfigPath,
        'utf8',
      );
      assert.doesNotMatch(runtimeChatConfig, /\[mcp_servers\.web_tools\]/u);
      assert.match(runtimeChatConfig, /\[mcp_servers\.code_info\]/u);
      assert.match(runtimeChatConfig, /[ \t]*\[tools\]\r?\nview_image = true/u);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('preserves manual web_tools blocks during repository-backed materialization when managed injection is disabled', async () => {
    setScopedTestEnvValue('CODEINFO_SERVER_PORT', '7530');
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '7533');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const baseConfigPath = path.join(codexHome, 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.copyFile(
        path.join(repoRoot, 'config.toml.example'),
        baseConfigPath,
      );
      await fs.writeFile(
        chatConfigPath,
        [
          'model = "gpt-5.6-sol"',
          '',
          '[mcp_servers.web_tools]',
          'command = "node"',
          'args = ["./manual-web-tools.js", "--port", "9911"]',
          'startup_timeout_sec = 15',
          '',
        ].join('\n'),
        'utf8',
      );
      const materialized = await materializeRepositoryBackedCodexChatHome({
        conversationId: 'conv:manual-web-tools-kept-disabled',
        codexHome,
        overrides: { model: 'unsloth/gemma-4-26b-A4b-it-qat-GGUF' },
        injectWebTools: false,
      });
      const runtimeChatConfig = await fs.readFile(
        materialized.chatConfigPath,
        'utf8',
      );
      assert.match(runtimeChatConfig, /\[mcp_servers\.web_tools\]/u);
      assert.match(runtimeChatConfig, /command = "node"/u);
      assert.match(
        runtimeChatConfig,
        /args = \["\.\/manual-web-tools\.js", "--port", "9911"\]/u,
      );
      assert.doesNotMatch(runtimeChatConfig, /http:\/\/localhost:7533\/mcp/u);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('preserves manual web_tools blocks during repository-backed materialization when managed injection is enabled', async () => {
    setScopedTestEnvValue('CODEINFO_SERVER_PORT', '7540');
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '7543');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const baseConfigPath = path.join(codexHome, 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.copyFile(
        path.join(repoRoot, 'config.toml.example'),
        baseConfigPath,
      );
      await fs.writeFile(
        chatConfigPath,
        [
          'model = "gpt-5.6-sol"',
          '',
          '[mcp_servers.web_tools]',
          'command = "node"',
          'args = ["./manual-web-tools.js", "--port", "9911"]',
          'startup_timeout_sec = 15',
          '',
        ].join('\n'),
        'utf8',
      );
      const materialized = await materializeRepositoryBackedCodexChatHome({
        conversationId: 'conv:manual-web-tools-kept-enabled',
        codexHome,
        overrides: { model: 'unsloth/gemma-4-26b-A4b-it-qat-GGUF' },
        injectWebTools: true,
      });
      const runtimeChatConfig = await fs.readFile(
        materialized.chatConfigPath,
        'utf8',
      );
      assert.match(runtimeChatConfig, /\[mcp_servers\.web_tools\]/u);
      assert.match(runtimeChatConfig, /command = "node"/u);
      assert.match(
        runtimeChatConfig,
        /args = \["\.\/manual-web-tools\.js", "--port", "9911"\]/u,
      );
      assert.doesNotMatch(runtimeChatConfig, /http:\/\/localhost:7543\/mcp/u);
      assert.equal(
        runtimeChatConfig.match(/\[mcp_servers\.web_tools\]/gu)?.length ?? 0,
        1,
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('injects managed web_tools into copilot runtime config when web_search is live', async () => {
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '7513');
    const copilotHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'copilot-home-'),
    );
    const { chatConfigPath } = getProviderChatConfigPath({
      provider: 'copilot',
      copilotHome,
    });
    try {
      await ensureProviderChatConfigBootstrapped({
        provider: 'copilot',
        copilotHome,
      });
      await fs.writeFile(
        chatConfigPath,
        ['model = "copilot-gpt-5"', 'web_search = "live"', ''].join('\n'),
        'utf8',
      );
      const resolved = await resolveChatRuntimeConfig({
        provider: 'copilot',
        copilotHome,
      });
      assert.deepEqual(
        (resolved.config.mcp_servers as Record<string, unknown>).web_tools,
        {
          command: 'npx',
          args: ['-y', 'mcp-remote', 'http://localhost:7513/mcp'],
          startup_timeout_sec: 60,
        },
      );
    } finally {
      await fs.rm(copilotHome, { recursive: true, force: true });
    }
  });
  it('omits managed web_tools from copilot runtime config and warns when web_search is cached', async () => {
    const copilotHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'copilot-home-'),
    );
    const { chatConfigPath } = getProviderChatConfigPath({
      provider: 'copilot',
      copilotHome,
    });
    try {
      await ensureProviderChatConfigBootstrapped({
        provider: 'copilot',
        copilotHome,
      });
      await fs.writeFile(
        chatConfigPath,
        ['model = "copilot-gpt-5"', 'web_search = "cached"', ''].join('\n'),
        'utf8',
      );
      const resolved = await resolveChatRuntimeConfig({
        provider: 'copilot',
        copilotHome,
      });
      const resolvedMcpServers = (resolved.config.mcp_servers ?? {}) as Record<
        string,
        unknown
      >;
      assert.equal(resolvedMcpServers.web_tools, undefined);
      assert.ok(
        resolved.warnings.some((warning) =>
          warning.message.includes(
            'cached mode is only supported by native Codex web search',
          ),
        ),
      );
    } finally {
      await fs.rm(copilotHome, { recursive: true, force: true });
    }
  });
  it('does not inject managed web_tools into lmstudio runtime config when web_search is live', async () => {
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '7523');
    const lmstudioHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'lmstudio-home-'),
    );
    const { chatConfigPath } = getProviderChatConfigPath({
      provider: 'lmstudio',
      lmstudioHome,
    });
    try {
      await ensureProviderChatConfigBootstrapped({
        provider: 'lmstudio',
        lmstudioHome,
      });
      await fs.writeFile(
        chatConfigPath,
        ['model = "model-1"', 'web_search = "live"', ''].join('\n'),
        'utf8',
      );
      const resolved = await resolveChatRuntimeConfig({
        provider: 'lmstudio',
        lmstudioHome,
      });
      const resolvedMcpServers = (resolved.config.mcp_servers ?? {}) as Record<
        string,
        unknown
      >;
      assert.equal(resolvedMcpServers.web_tools, undefined);
    } finally {
      await fs.rm(lmstudioHome, { recursive: true, force: true });
    }
  });
  it('injects managed web_tools into pinned codex external-endpoint runtime config when web_search is live', async () => {
    setScopedTestEnvValue('CODEINFO_WEB_MCP_PORT', '7613');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await ensureProviderChatConfigBootstrapped({
        provider: 'codex',
        codexHome,
      });
      await fs.writeFile(
        chatConfigPath,
        [
          'model = "unsloth/gemma-4-26b-A4b-it-qat-GGUF"',
          'codeinfo_openai_endpoint = "http://localhost:8888/v1|responses,completions"',
          'web_search = "live"',
          '',
          '[mcp_servers.code_info]',
          'command = "npx"',
          'args = ["-y", "mcp-remote", "http://localhost:${CODEINFO_SERVER_PORT}/mcp"]',
          'startup_timeout_sec = 60',
          '',
        ].join('\n'),
        'utf8',
      );
      const resolved = await resolveChatRuntimeConfig({
        provider: 'codex',
        codexHome,
      });
      assert.deepEqual(
        (resolved.config.mcp_servers as Record<string, unknown>).web_tools,
        {
          command: 'npx',
          args: ['-y', 'mcp-remote', 'http://localhost:7613/mcp'],
          startup_timeout_sec: 60,
        },
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('hard-fails strict runtime readers when base config TOML is invalid', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const agentConfigPath = path.join(codexHome, 'agent-config.toml');
    try {
      await fs.writeFile(baseConfigPath, 'model = "broken', 'utf8');
      await fs.writeFile(agentConfigPath, 'model = "agent-model"\n', 'utf8');
      await assert.rejects(
        async () =>
          resolveAgentRuntimeConfig({
            codexHome,
            agentConfigPath,
          }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed?.code === 'RUNTIME_CONFIG_INVALID' &&
            typed?.surface === 'agent'
          );
        },
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
});
describe('runtimeConfig merged happy paths and T04 logs', () => {
  it('rejects malformed runtime mcp_servers tables instead of inheriting base data', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        baseConfigPath,
        [
          '[mcp_servers.context7]',
          'command = "npx"',
          'args = ["-y", "@upstash/context7-mcp"]',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        chatConfigPath,
        ['model = "chat-model"', 'mcp_servers = "bad"', ''].join('\n'),
        'utf8',
      );
      await assert.rejects(
        async () => resolveChatRuntimeConfig({ codexHome }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed?.code === 'RUNTIME_CONFIG_VALIDATION_FAILED' &&
            typed?.surface === 'chat' &&
            /invalid type at chat\.mcp_servers: expected table/u.test(
              typed?.message ?? '',
            )
          );
        },
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('rejects malformed runtime tools tables instead of inheriting base data', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        baseConfigPath,
        ['[tools]', 'view_image = true', ''].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        chatConfigPath,
        ['model = "chat-model"', 'tools = "bad"', ''].join('\n'),
        'utf8',
      );
      await assert.rejects(
        async () => resolveChatRuntimeConfig({ codexHome }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed?.code === 'RUNTIME_CONFIG_VALIDATION_FAILED' &&
            typed?.surface === 'chat' &&
            /invalid type at chat\.tools: expected table/u.test(
              typed?.message ?? '',
            )
          );
        },
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('still inherits valid runtime tables for Story 47 merged keys', async () => {
    clearScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        baseConfigPath,
        [
          '[tools]',
          'view_image = true',
          '[mcp_servers.context7]',
          'command = "npx"',
          'args = ["-y", "@upstash/context7-mcp"]',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(chatConfigPath, 'model = "chat-model"\n', 'utf8');
      const resolved = await resolveChatRuntimeConfig({ codexHome });
      assert.equal(resolved.config.model, 'chat-model');
      assert.deepEqual(resolved.config.tools, {
        view_image: true,
      });
      assert.deepEqual(resolved.config.mcp_servers, {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
        },
      });
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('resolves chat runtime with inherited base mcp servers and provider routing', async () => {
    clearScopedTestEnvValue('CODEINFO_CONTEXT7_API_KEY');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        baseConfigPath,
        [
          'model_provider = "base-provider"',
          '[model_providers.base-provider]',
          'name = "Base Provider"',
          'base_url = "http://localhost:4000/v1"',
          '[mcp_servers.context7]',
          'command = "npx"',
          'args = ["-y", "@upstash/context7-mcp"]',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(chatConfigPath, 'model = "chat-model"\n', 'utf8');
      const resolved = await resolveChatRuntimeConfig({ codexHome });
      assert.equal(resolved.config.model, 'chat-model');
      assert.equal(resolved.config.model_provider, 'base-provider');
      assert.deepEqual(resolved.config.model_providers, {
        'base-provider': {
          name: 'Base Provider',
          base_url: 'http://localhost:4000/v1',
        },
      });
      assert.deepEqual(resolved.config.mcp_servers, {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
        },
      });
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('resolves canonical agent config and inherits base execution settings', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const agentConfigPath = path.join(codexHome, 'agent-config.toml');
    try {
      await fs.writeFile(
        baseConfigPath,
        [
          'model = "base-model"',
          'personality = "base-personality"',
          '[tools]',
          'view_image = true',
          '[mcp_servers.context7]',
          'command = "npx"',
          '[projects]',
          '[projects."/base"]',
          'trust_level = "trusted"',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        agentConfigPath,
        'model = "agent-model"\n[projects]\n[projects."/base"]\ntrust_level = "untrusted"\n',
        'utf8',
      );
      const resolved = await resolveAgentRuntimeConfig({
        codexHome,
        agentConfigPath,
      });
      assert.equal(resolved.config.model, 'agent-model');
      assert.equal(resolved.config.personality, 'base-personality');
      assert.deepEqual(resolved.config.tools, {
        view_image: true,
      });
      assert.deepEqual(resolved.config.mcp_servers, {
        context7: {
          command: 'npx',
        },
      });
      assert.deepEqual(resolved.config.projects, {
        '/base': {
          trust_level: 'untrusted',
        },
      });
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('resolves agent runtime with inherited base provider routing', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const agentConfigPath = path.join(codexHome, 'agent-config.toml');
    try {
      await fs.writeFile(
        baseConfigPath,
        [
          'model_provider = "base-provider"',
          '[model_providers.base-provider]',
          'name = "Base Provider"',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(agentConfigPath, 'model = "agent-model"\n', 'utf8');
      const resolved = await resolveAgentRuntimeConfig({
        codexHome,
        agentConfigPath,
      });
      assert.equal(resolved.config.model_provider, 'base-provider');
      assert.deepEqual(resolved.config.model_providers, {
        'base-provider': {
          name: 'Base Provider',
        },
      });
      assert.equal(resolved.warnings.length, 0);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('resolves agent runtime without warnings for supported inherited codex compatibility keys', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const agentConfigPath = path.join(codexHome, 'agent-config.toml');
    try {
      await fs.writeFile(
        baseConfigPath,
        [
          'web_search_mode = "disabled"',
          '',
          'hide_agent_reasoning = false',
          'model_reasoning_summary = "detailed"',
          '',
          '[features]',
          'fast_mode = false',
          '',
          '[model_providers.base-provider]',
          'name = "Base Provider"',
          '',
          '[plugins."github@openai-curated"]',
          'enabled = true',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        agentConfigPath,
        [
          'model = "agent-model"',
          'model_auto_compact_token_limit = 300000',
          '',
        ].join('\n'),
        'utf8',
      );
      const resolved = await resolveAgentRuntimeConfig({
        codexHome,
        agentConfigPath,
      });
      assert.equal(resolved.config.hide_agent_reasoning, false);
      assert.equal(resolved.config.web_search, 'disabled');
      assert.equal(resolved.config.model_reasoning_summary, 'detailed');
      assert.equal(resolved.config.model_auto_compact_token_limit, 300000);
      assert.deepEqual(resolved.config.features, {
        fast_mode: false,
      });
      assert.deepEqual(resolved.config.model_providers, {
        'base-provider': {
          name: 'Base Provider',
        },
      });
      assert.deepEqual(resolved.config.plugins, {
        'github@openai-curated': {
          enabled: true,
        },
      });
      assert.equal(resolved.warnings.length, 0);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('keeps runtime-specific model, approval, sandbox, and web_search overrides over base config', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        baseConfigPath,
        [
          'model = "base-model"',
          'approval_policy = "never"',
          'sandbox_mode = "danger-full-access"',
          'web_search = "disabled"',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        chatConfigPath,
        [
          'model = "chat-model"',
          'approval_policy = "on-request"',
          'sandbox_mode = "read-only"',
          'web_search = "live"',
          '',
        ].join('\n'),
        'utf8',
      );
      const resolved = await resolveChatRuntimeConfig({ codexHome });
      assert.equal(resolved.config.model, 'chat-model');
      assert.equal(resolved.config.approval_policy, 'on-request');
      assert.equal(resolved.config.sandbox_mode, 'read-only');
      assert.equal(resolved.config.web_search, 'live');
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('merges runtime-specific projects and mcp servers without dropping unrelated base siblings', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const agentConfigPath = path.join(codexHome, 'agent-config.toml');
    try {
      await fs.writeFile(
        baseConfigPath,
        [
          '[mcp_servers.context7]',
          'command = "npx"',
          '[mcp_servers.deepwiki]',
          'url = "https://mcp.deepwiki.com/mcp"',
          '[projects]',
          '[projects."/base"]',
          'trust_level = "trusted"',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        agentConfigPath,
        [
          'model = "agent-model"',
          '[mcp_servers.context7]',
          'command = "node"',
          '[projects]',
          '[projects."/agent"]',
          'trust_level = "trusted"',
          '',
        ].join('\n'),
        'utf8',
      );
      const resolved = await resolveAgentRuntimeConfig({
        codexHome,
        agentConfigPath,
      });
      assert.deepEqual(resolved.config.mcp_servers, {
        context7: {
          command: 'node',
        },
        deepwiki: {
          url: 'https://mcp.deepwiki.com/mcp',
        },
      });
      assert.deepEqual(resolved.config.projects, {
        '/base': {
          trust_level: 'trusted',
        },
        '/agent': {
          trust_level: 'trusted',
        },
      });
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('resolves legacy alias input and normalizes to canonical keys', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        chatConfigPath,
        'model = "gpt-5.6-sol"\n[features]\nview_image_tool = true\nweb_search_request = false\n',
        'utf8',
      );
      const resolved = await resolveChatRuntimeConfig({
        codexHome,
      });
      assert.deepEqual(resolved.config.tools, { view_image: true });
      assert.equal(resolved.config.web_search, 'disabled');
      assert.equal(
        (resolved.config.features as Record<string, unknown> | undefined)
          ?.view_image_tool,
        undefined,
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('rejects malformed features.view_image_tool values instead of dropping them during normalization', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        chatConfigPath,
        [
          'model = "gpt-5.6-sol"',
          '[features]',
          'view_image_tool = "maybe"',
          '[tools]',
          'web_search = false',
          '',
        ].join('\n'),
        'utf8',
      );
      await assert.rejects(
        async () => resolveChatRuntimeConfig({ codexHome }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed?.code === 'RUNTIME_CONFIG_VALIDATION_FAILED' &&
            typed?.surface === 'chat' &&
            /invalid type at chat\.features\.view_image_tool: expected boolean/u.test(
              typed?.message ?? '',
            )
          );
        },
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('rejects malformed features.web_search_request values even when canonical web_search already exists', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(
        chatConfigPath,
        [
          'model = "gpt-5.6-sol"',
          'web_search = "cached"',
          '[features]',
          'web_search_request = "sometimes"',
          '[tools]',
          'view_image = true',
          '',
        ].join('\n'),
        'utf8',
      );
      await assert.rejects(
        async () => resolveChatRuntimeConfig({ codexHome }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed?.code === 'RUNTIME_CONFIG_VALIDATION_FAILED' &&
            typed?.surface === 'chat' &&
            /invalid type at chat\.features\.web_search_request: expected boolean/u.test(
              typed?.message ?? '',
            )
          );
        },
      );
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('logs deterministic T04 success on merged+validated happy path', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const agentConfigPath = path.join(codexHome, 'agent-config.toml');
    const infoLogs: string[] = [];
    mock.method(console, 'info', (...args: unknown[]) => {
      infoLogs.push(args.map(String).join(' '));
    });
    try {
      await fs.writeFile(agentConfigPath, 'model = "gpt-5.6-sol"\n', 'utf8');
      await resolveAgentRuntimeConfig({
        codexHome,
        agentConfigPath,
      });
      assert(
        infoLogs.some((line) =>
          line.includes(
            '[DEV-0000037][T04] event=runtime_config_merged_and_validated result=success',
          ),
        ),
      );
      assert(
        infoLogs.some((line) =>
          line.includes('DEV_0000047_T04_RUNTIME_INHERITANCE_APPLIED'),
        ),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('logs deterministic T04 error on merged+validated failure path', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const agentConfigPath = path.join(codexHome, 'agent-config.toml');
    const errorLogs: string[] = [];
    mock.method(console, 'error', (...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });
    try {
      await fs.writeFile(agentConfigPath, 'web_search = true\n', 'utf8');
      await assert.rejects(
        async () =>
          resolveMergedAndValidatedRuntimeConfig({
            surface: 'agent',
            codexHome,
            runtimeConfigPath: agentConfigPath,
          }),
        /RUNTIME_CONFIG_VALIDATION_FAILED/u,
      );
      assert(
        errorLogs.some((line) =>
          line.includes(
            '[DEV-0000037][T04] event=runtime_config_merged_and_validated result=error',
          ),
        ),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
  it('seeds provider-local chat defaults for codex, copilot, and lmstudio', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-chat-'));
    const codexHome = path.join(tempRoot, 'codex');
    const copilotHome = path.join(tempRoot, 'copilot');
    const lmstudioHome = path.join(tempRoot, 'lmstudio');
    try {
      const snapshots = await ensureAllProviderChatConfigsBootstrapped({
        codexHome,
        copilotHome,
        lmstudioHome,
      });
      assert.equal(snapshots.length, 3);
      const codexConfig = await fs.readFile(
        getProviderChatConfigPath({ provider: 'codex', codexHome })
          .chatConfigPath,
        'utf8',
      );
      const copilotConfig = await fs.readFile(
        getProviderChatConfigPath({
          provider: 'copilot',
          copilotHome,
        }).chatConfigPath,
        'utf8',
      );
      const lmstudioConfig = await fs.readFile(
        getProviderChatConfigPath({
          provider: 'lmstudio',
          lmstudioHome,
        }).chatConfigPath,
        'utf8',
      );
      assert.match(codexConfig, /model = "gpt-5\.6-sol"/u);
      assert.match(copilotConfig, /model = "copilot-gpt-5"/u);
      assert.match(lmstudioConfig, /model = "model-1"/u);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('records degraded provider bootstrap and still allows a live listener to bind afterward', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'provider-chat-degraded-'),
    );
    const codexHome = path.join(tempRoot, 'codex');
    const copilotHome = path.join(tempRoot, 'copilot');
    const lmstudioHome = path.join(tempRoot, 'lmstudio');
    const originalWriteFile = fs.writeFile.bind(fs);
    const warningLogs: unknown[][] = [];
    let server: http.Server | null = null;
    mock.method(console, 'warn', (...args: unknown[]) => {
      warningLogs.push(args);
    });
    mock.method(
      fs,
      'writeFile',
      async (...args: Parameters<typeof fs.writeFile>) => {
        const filePath = String(args[0]);
        if (filePath.startsWith(`${copilotHome}${path.sep}`)) {
          const error = new Error('copilot home read-only') as
            | Error
            | NodeJS.ErrnoException;
          (error as NodeJS.ErrnoException).code = 'EROFS';
          throw error;
        }
        return originalWriteFile(...args);
      },
    );
    try {
      const snapshots = await ensureAllProviderChatConfigsBootstrapped({
        codexHome,
        copilotHome,
        lmstudioHome,
      });
      assert.equal(snapshots.length, 2);
      assert.deepEqual(snapshots.map((snapshot) => snapshot.provider).sort(), [
        'codex',
        'lmstudio',
      ]);
      const copilotStatus = getProviderBootstrapStatus('copilot');
      assert.equal(copilotStatus.healthy, false);
      assert.match(copilotStatus.reason ?? '', /copilot home read-only/u);
      assert.match(
        copilotStatus.warnings.join('\n'),
        /Provider "copilot" bootstrap degraded during startup/u,
      );
      assert(
        warningLogs.some((entry) =>
          String(entry[0]).includes(
            '[runtime-config] provider bootstrap degraded provider=copilot',
          ),
        ),
      );
      server = http.createServer((_req, res) => {
        res.statusCode = 200;
        res.end('ok');
      });
      await new Promise<void>((resolve) => server!.listen(0, resolve));
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      assert.ok(address.port > 0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        if (!server) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('provider chat-default readers reread the on-disk file on each call', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'provider-reread-'),
    );
    const lmstudioHome = path.join(tempRoot, 'lmstudio');
    const { chatConfigPath } = getProviderChatConfigPath({
      provider: 'lmstudio',
      lmstudioHome,
    });
    try {
      await ensureProviderChatConfigBootstrapped({
        provider: 'lmstudio',
        lmstudioHome,
      });
      await fs.writeFile(chatConfigPath, 'model = "first-model"\n', 'utf8');
      const first = loadProviderChatDefaultsSnapshotSync({
        provider: 'lmstudio',
        lmstudioHome,
      });
      await fs.writeFile(chatConfigPath, 'model = "second-model"\n', 'utf8');
      const second = loadProviderChatDefaultsSnapshotSync({
        provider: 'lmstudio',
        lmstudioHome,
      });
      assert.equal(first.config?.model, 'first-model');
      assert.equal(second.config?.model, 'second-model');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('bootstraps the lmstudio/chat directory through the shared provider-home path', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lmstudio-home-'));
    const lmstudioHome = path.join(tempRoot, 'lmstudio');
    try {
      await ensureProviderChatConfigBootstrapped({
        provider: 'lmstudio',
        lmstudioHome,
      });
      const stat = await fs.stat(path.join(lmstudioHome, 'chat'));
      assert.ok(stat.isDirectory());
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('ignores abandoned provider chat-config temp artifacts when reading the canonical file', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-temp-'));
    const lmstudioHome = path.join(tempRoot, 'lmstudio');
    const { chatConfigPath } = getProviderChatConfigPath({
      provider: 'lmstudio',
      lmstudioHome,
    });
    try {
      await ensureProviderChatConfigBootstrapped({
        provider: 'lmstudio',
        lmstudioHome,
      });
      await fs.writeFile(chatConfigPath, 'model = "stable-model"\n', 'utf8');
      await fs.writeFile(`${chatConfigPath}.orphan.tmp`, '[broken', 'utf8');
      const snapshot = loadProviderChatDefaultsSnapshotSync({
        provider: 'lmstudio',
        lmstudioHome,
      });
      assert.equal(snapshot.config?.model, 'stable-model');
      await fs.access(`${chatConfigPath}.orphan.tmp`);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('leaves the previous good provider chat config in place when a temp-write cleanup runs', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'provider-atomic-'),
    );
    const copilotHome = path.join(tempRoot, 'copilot');
    const { chatConfigPath } = getProviderChatConfigPath({
      provider: 'copilot',
      copilotHome,
    });
    try {
      await ensureProviderChatConfigBootstrapped({
        provider: 'copilot',
        copilotHome,
      });
      await fs.writeFile(chatConfigPath, 'model = "kept-model"\n', 'utf8');
      await fs.writeFile(
        `${chatConfigPath}.partial.tmp`,
        'model = "next',
        'utf8',
      );
      const snapshot = loadProviderChatDefaultsSnapshotSync({
        provider: 'copilot',
        copilotHome,
      });
      assert.equal(snapshot.config?.model, 'kept-model');
      await fs.access(`${chatConfigPath}.partial.tmp`);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('provider chat-config bootstrap keeps a newer config that appears after the missing-state check and leaves no partial temp artifact behind', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'provider-chat-race-'),
    );
    const lmstudioHome = path.join(tempRoot, 'lmstudio');
    const { chatConfigPath } = getProviderChatConfigPath({
      provider: 'lmstudio',
      lmstudioHome,
    });
    const originalLink = fs.link;
    try {
      const linkMock = mock.method(
        fs,
        'link',
        async (existingPath: PathLike, newPath: PathLike) => {
          await fs.writeFile(chatConfigPath, 'model = "newer-model"\n', 'utf8');
          return originalLink.call(fs, existingPath, newPath);
        },
      );
      const result = await ensureProviderChatConfigBootstrapped({
        provider: 'lmstudio',
        lmstudioHome,
      });
      linkMock.mock.restore();
      const seeded = await fs.readFile(chatConfigPath, 'utf8');
      const entries = await fs.readdir(path.join(lmstudioHome, 'chat'));
      assert.equal(result.branch, 'existing_noop');
      assert.equal(seeded, 'model = "newer-model"\n');
      assert.deepEqual(entries, ['config.toml']);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('treats codeinfo_config/config.toml as an optional lowest-precedence layer without creating it', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-config-layering-'),
    );
    const codexHome = path.join(tempRoot, 'codex');
    const repoLocalConfigPath = path.join(
      tempRoot,
      'codeinfo_config',
      'config.toml',
    );
    try {
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.writeFile(
        path.join(codexHome, 'config.toml'),
        'personality = "base"\n',
        'utf8',
      );
      await fs.writeFile(
        path.join(codexHome, 'chat', 'config.toml'),
        'model = "gpt-5.6-sol"\n',
        'utf8',
      );
      const resolved = await resolveChatRuntimeConfig({ codexHome });
      assert.equal(resolved.config.personality, 'base');
      await assert.rejects(fs.access(repoLocalConfigPath), { code: 'ENOENT' });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('applies repo-local, provider-base, and agent precedence in order', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-config-order-'),
    );
    const codexHome = path.join(tempRoot, 'codex');
    const repoLocalDir = path.join(tempRoot, 'codeinfo_config');
    const agentConfigPath = path.join(tempRoot, 'agent', 'config.toml');
    try {
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.mkdir(repoLocalDir, { recursive: true });
      await fs.mkdir(path.dirname(agentConfigPath), { recursive: true });
      await fs.writeFile(
        path.join(repoLocalDir, 'config.toml'),
        [
          'model = "repo-model"',
          'personality = "repo-personality"',
          'cli_auth_credentials_store = "repo-store"',
          '[mcp_servers.repo]',
          'url = "http://repo.example"',
          '[projects."/repo"]',
          'trust_level = "trusted"',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        path.join(codexHome, 'config.toml'),
        [
          'model = "provider-model"',
          'personality = "provider-personality"',
          '[mcp_servers.provider]',
          'url = "http://provider.example"',
          '[projects."/provider"]',
          'trust_level = "trusted"',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        agentConfigPath,
        [
          'model = "agent-model"',
          'personality = "agent-personality"',
          '[mcp_servers.agent]',
          'url = "http://agent.example"',
          '[projects."/agent"]',
          'trust_level = "trusted"',
          '',
        ].join('\n'),
        'utf8',
      );
      const resolved = await resolveAgentRuntimeConfig({
        codexHome,
        agentConfigPath,
      });
      assert.equal(resolved.config.model, 'agent-model');
      assert.equal(resolved.config.personality, 'agent-personality');
      assert.equal(resolved.config.cli_auth_credentials_store, 'repo-store');
      assert.deepEqual(resolved.config.mcp_servers, {
        repo: { url: 'http://repo.example' },
        provider: { url: 'http://provider.example' },
        agent: { url: 'http://agent.example' },
      });
      assert.deepEqual(resolved.config.projects, {
        '/repo': { trust_level: 'trusted' },
        '/provider': { trust_level: 'trusted' },
        '/agent': { trust_level: 'trusted' },
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('replaces scalar and array values from lower-precedence layers', () => {
    const merged = mergeRuntimeConfigLayers([
      {
        model: 'repo-model',
        command_allowlist: ['repo-a', 'repo-b'],
      },
      {
        model: 'provider-model',
        command_allowlist: ['provider-a'],
      },
      {
        model: 'agent-model',
        command_allowlist: ['agent-a', 'agent-b'],
      },
    ]);
    assert.equal(merged.merged.model, 'agent-model');
    assert.deepEqual(merged.merged.command_allowlist, ['agent-a', 'agent-b']);
  });
  it('merges named tables by key while higher-precedence values replace conflicts', () => {
    const merged = mergeRuntimeConfigLayers([
      {
        mcp_servers: {
          shared: { url: 'http://repo.example' },
          repoOnly: { url: 'http://repo-only.example' },
        },
      },
      {
        mcp_servers: {
          shared: { url: 'http://provider.example' },
          providerOnly: { url: 'http://provider-only.example' },
        },
      },
      {
        mcp_servers: {
          shared: { url: 'http://agent.example' },
        },
      },
    ]);
    assert.deepEqual(merged.merged.mcp_servers, {
      shared: { url: 'http://agent.example' },
      repoOnly: { url: 'http://repo-only.example' },
      providerOnly: { url: 'http://provider-only.example' },
    });
  });
  it('strips app-owned codeinfo metadata before provider runtime config leaves the resolver', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-config-metadata-'),
    );
    const codexHome = path.join(tempRoot, 'codex');
    const agentConfigPath = path.join(tempRoot, 'agent', 'config.toml');
    try {
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.mkdir(path.dirname(agentConfigPath), { recursive: true });
      await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        agentConfigPath,
        [
          'model = "gpt-5.6-sol"',
          'codeinfo_provider = "copilot"',
          'codeinfo_hidden_note = "strip-me"',
          '',
        ].join('\n'),
        'utf8',
      );
      const resolved = await resolveAgentRuntimeConfig({
        provider: 'copilot',
        codexHome,
        agentConfigPath,
      });
      assert.equal(resolved.appMetadata?.codeinfoProvider, 'copilot');
      assert.equal('codeinfo_provider' in resolved.config, false);
      assert.equal('codeinfo_hidden_note' in resolved.config, false);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('warns and ignores codeinfo_provider on non-agent config surfaces', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-config-chat-metadata-'),
    );
    const codexHome = path.join(tempRoot, 'codex');
    try {
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        path.join(codexHome, 'chat', 'config.toml'),
        ['model = "gpt-5.6-sol"', 'codeinfo_provider = "copilot"', ''].join(
          '\n',
        ),
        'utf8',
      );
      const resolved = await resolveChatRuntimeConfig({ codexHome });
      assert.equal(resolved.appMetadata?.codeinfoProvider, undefined);
      assert.equal('codeinfo_provider' in resolved.config, false);
      assert.equal(
        resolved.warnings.some((warning) =>
          warning.message.includes(
            'codeinfo_provider is only supported on agent runtime config',
          ),
        ),
        true,
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('reads and strips codeinfo_openai_endpoint from codex chat config metadata on the accepted path', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-config-chat-endpoint-'),
    );
    const codexHome = path.join(tempRoot, 'codex');
    try {
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        path.join(codexHome, 'chat', 'config.toml'),
        [
          'model = "gpt-5.6-sol"',
          'codeinfo_openai_endpoint = " https://LOCALHOST:1234/v1/ | RESPONSES, completions, responses "',
          '',
        ].join('\n'),
        'utf8',
      );
      const resolved = await resolveChatRuntimeConfig({ codexHome });
      assert.equal(
        resolved.appMetadata?.codeinfoOpenAiEndpoint?.endpointId,
        'https://localhost:1234/v1',
      );
      assert.deepEqual(
        resolved.appMetadata?.codeinfoOpenAiEndpoint?.capabilities,
        ['responses', 'completions'],
      );
      assert.equal('codeinfo_openai_endpoint' in resolved.config, false);
      assert.equal(resolved.config.model, 'gpt-5.6-sol');
      assert.deepEqual(resolved.warnings, []);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('rejects blank codeinfo_openai_endpoint values in codex chat config', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-config-chat-endpoint-blank-'),
    );
    const codexHome = path.join(tempRoot, 'codex');
    try {
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        path.join(codexHome, 'chat', 'config.toml'),
        ['model = "gpt-5.6-sol"', 'codeinfo_openai_endpoint = ""', ''].join(
          '\n',
        ),
        'utf8',
      );
      await assert.rejects(
        async () => resolveChatRuntimeConfig({ codexHome }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed.code === 'RUNTIME_CONFIG_INVALID' &&
            typed.surface === 'chat' &&
            typed.message.includes(
              'RUNTIME_CONFIG_INVALID: chat.codeinfo_openai_endpoint: expected an explicit http or https /v1 base URL',
            )
          );
        },
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('rejects whitespace-only codeinfo_openai_endpoint values in copilot chat config', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-config-chat-endpoint-space-'),
    );
    const copilotHome = path.join(tempRoot, 'copilot');
    try {
      await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
      await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        path.join(copilotHome, 'chat', 'config.toml'),
        [
          'model = "copilot-gpt-5"',
          'codeinfo_openai_endpoint = "   "',
          '',
        ].join('\n'),
        'utf8',
      );
      await assert.rejects(
        async () =>
          resolveChatRuntimeConfig({
            provider: 'copilot',
            copilotHome,
          }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed.code === 'RUNTIME_CONFIG_INVALID' &&
            typed.surface === 'chat' &&
            typed.message.includes(
              'RUNTIME_CONFIG_INVALID: chat.codeinfo_openai_endpoint: expected an explicit http or https /v1 base URL',
            )
          );
        },
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('rejects codex chat endpoints that do not advertise responses support', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-config-chat-endpoint-codex-compat-'),
    );
    const codexHome = path.join(tempRoot, 'codex');
    try {
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        path.join(codexHome, 'chat', 'config.toml'),
        [
          'model = "gpt-5.6-sol"',
          'codeinfo_openai_endpoint = "https://example.com/v1|completions"',
          '',
        ].join('\n'),
        'utf8',
      );
      await assert.rejects(
        async () => resolveChatRuntimeConfig({ codexHome }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed.code === 'RUNTIME_CONFIG_VALIDATION_FAILED' &&
            typed.surface === 'chat' &&
            typed.message.includes(
              'Codex requires responses support on codeinfo_openai_endpoint',
            )
          );
        },
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('rejects copilot chat endpoints that do not advertise completions support', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-config-chat-endpoint-copilot-compat-'),
    );
    const copilotHome = path.join(tempRoot, 'copilot');
    try {
      await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
      await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        path.join(copilotHome, 'chat', 'config.toml'),
        [
          'model = "copilot-gpt-5"',
          'codeinfo_openai_endpoint = "https://example.com/v1|responses"',
          '',
        ].join('\n'),
        'utf8',
      );
      await assert.rejects(
        async () =>
          resolveChatRuntimeConfig({
            provider: 'copilot',
            copilotHome,
          }),
        (error) => {
          const typed = error as RuntimeConfigResolutionError;
          return (
            typed.code === 'RUNTIME_CONFIG_VALIDATION_FAILED' &&
            typed.surface === 'chat' &&
            typed.message.includes(
              'Copilot requires completions support on codeinfo_openai_endpoint',
            )
          );
        },
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('validates codeinfo_openai_endpoint against the effective agent provider override', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-config-agent-endpoint-provider-'),
    );
    const codexHome = path.join(tempRoot, 'codex');
    const copilotHome = path.join(tempRoot, 'copilot');
    const agentConfigPath = path.join(tempRoot, 'agent', 'config.toml');
    try {
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
      await fs.mkdir(path.dirname(agentConfigPath), { recursive: true });
      await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        path.join(codexHome, 'chat', 'config.toml'),
        'model = "gpt-5.6-sol"\n',
        'utf8',
      );
      await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        path.join(copilotHome, 'chat', 'config.toml'),
        'model = "copilot-gpt-5"\n',
        'utf8',
      );
      await fs.writeFile(
        agentConfigPath,
        [
          'codeinfo_provider = "copilot"',
          'model = "copilot-gpt-5"',
          'codeinfo_openai_endpoint = "https://example.com/v1|completions"',
          '',
        ].join('\n'),
        'utf8',
      );
      const resolved = await resolveAgentRuntimeConfig({
        provider: 'codex',
        codexHome,
        copilotHome,
        agentConfigPath,
      });
      assert.equal(resolved.appMetadata?.codeinfoProvider, 'copilot');
      assert.equal(
        resolved.appMetadata?.codeinfoOpenAiEndpoint?.endpointId,
        'https://example.com/v1',
      );
      assert.equal(resolved.config.model, 'copilot-gpt-5');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
  it('keeps structured warnings when agent runtime resolution succeeds through a fallback-provider config path', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-config-fallback-warnings-'),
    );
    const codexHome = path.join(tempRoot, 'codex');
    const copilotHome = path.join(tempRoot, 'copilot');
    const agentConfigPath = path.join(tempRoot, 'agent', 'config.toml');
    try {
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
      await fs.mkdir(path.dirname(agentConfigPath), { recursive: true });
      await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        path.join(codexHome, 'chat', 'config.toml'),
        'model = "gpt-5.6-sol"\n',
        'utf8',
      );
      await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        path.join(copilotHome, 'chat', 'config.toml'),
        'model = "copilot-gpt-5"\n',
        'utf8',
      );
      await fs.writeFile(
        agentConfigPath,
        [
          'codeinfo_provider = "copilot"',
          'model = "copilot-gpt-5"',
          'top_level_unknown = "ignored"',
          '',
        ].join('\n'),
        'utf8',
      );
      const resolved = await resolveAgentRuntimeConfig({
        provider: 'codex',
        codexHome,
        copilotHome,
        agentConfigPath,
      });
      assert.equal(resolved.config.model, 'copilot-gpt-5');
      assert.equal(
        resolved.warnings.some(
          (warning) =>
            warning.path.endsWith('top_level_unknown') &&
            warning.message.includes('Unknown key'),
        ),
        true,
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
