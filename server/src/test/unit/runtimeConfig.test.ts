import assert from 'node:assert/strict';
import type { PathLike } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, mock } from 'node:test';

import {
  ensureCodexConfigSeeded,
  getCodexChatConfigPathForHome,
  getCodexConfigPathForHome,
  getCodexHome,
} from '../../config/codexConfig.js';
import {
  ensureChatRuntimeConfigBootstrapped,
  loadRuntimeConfigSnapshot,
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

const originalContext7ApiKey = process.env.CODEINFO_CONTEXT7_API_KEY;
const originalServerPort = process.env.CODEINFO_SERVER_PORT;
const originalChatMcpPort = process.env.CODEINFO_CHAT_MCP_PORT;
const originalAgentsMcpPort = process.env.CODEINFO_AGENTS_MCP_PORT;
const originalPlaywrightMcpUrl = process.env.CODEINFO_PLAYWRIGHT_MCP_URL;

afterEach(() => {
  mock.restoreAll();
  if (originalContext7ApiKey === undefined) {
    delete process.env.CODEINFO_CONTEXT7_API_KEY;
  } else {
    process.env.CODEINFO_CONTEXT7_API_KEY = originalContext7ApiKey;
  }
  if (originalServerPort === undefined) {
    delete process.env.CODEINFO_SERVER_PORT;
  } else {
    process.env.CODEINFO_SERVER_PORT = originalServerPort;
  }
  if (originalChatMcpPort === undefined) {
    delete process.env.CODEINFO_CHAT_MCP_PORT;
  } else {
    process.env.CODEINFO_CHAT_MCP_PORT = originalChatMcpPort;
  }
  if (originalAgentsMcpPort === undefined) {
    delete process.env.CODEINFO_AGENTS_MCP_PORT;
  } else {
    process.env.CODEINFO_AGENTS_MCP_PORT = originalAgentsMcpPort;
  }
  if (originalPlaywrightMcpUrl === undefined) {
    delete process.env.CODEINFO_PLAYWRIGHT_MCP_URL;
  } else {
    process.env.CODEINFO_PLAYWRIGHT_MCP_URL = originalPlaywrightMcpUrl;
  }
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

  it('writes the canonical chat template when chat config is missing', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');

    try {
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const content = await fs.readFile(chatConfigPath, 'utf8');

      assert.equal(result.copied, false);
      assert.equal(result.generatedTemplate, true);
      assert.equal(result.branch, 'generated_template');
      assert.match(content, /model = "gpt-5.3-codex"/u);
      assert.match(content, /model_reasoning_effort = "high"/u);
      assert.match(content, /approval_policy = "on-failure"/u);
      assert.match(content, /sandbox_mode = "danger-full-access"/u);
      assert.match(content, /web_search = "live"/u);
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
      assert.match(chatContents, /model = "gpt-5.3-codex"/u);
      assert.doesNotMatch(chatContents, /base-model/u);
      assert.doesNotMatch(chatContents, /\[mcp_servers\.context7\]/u);
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
          if ((error as { code?: string }).code === 'ENOENT') return false;
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
      process.env.CODEINFO_CODEX_HOME = codexHome;
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
      assert.match(baseConfig, /model = "gpt-5\.3-codex"/u);
      assert.doesNotMatch(baseConfig, /from-example/u);
      assert.equal(bootstrapResult.branch, 'generated_template');
      assert.match(chatConfig, /model = "gpt-5\.3-codex"/u);
      assert.doesNotMatch(chatConfig, /from-copy-template/u);
    } finally {
      process.chdir(originalCwd);
      if (originalCodeinfoHome === undefined) {
        delete process.env.CODEINFO_CODEX_HOME;
      } else {
        process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
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
          if (filePath.endsWith(`${path.sep}chat${path.sep}config.toml.tmp`)) {
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
            | { branch?: string; warningCode?: string }
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
            | { outcome?: string; source?: string; success?: boolean }
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
            | { outcome?: string; source?: string; success?: boolean }
            | undefined;
          return (
            String(entry[0]) === TASK3_MARKER &&
            payload?.outcome === 'existing' &&
            payload.source === 'chat_template' &&
            payload.success === true &&
            (payload as { config_path?: string }).config_path === chatConfigPath
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
        'model = "gpt-5.3-codex"\n[features]\nview_image_tool = true\n',
        'utf8',
      );
      const parsed = await readAndNormalizeRuntimeTomlConfig(configPath, {
        required: true,
      });

      assert.equal(parsed?.model, 'gpt-5.3-codex');
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
      model: 'gpt-5.3-codex',
      totally_unknown: true,
    });

    assert.equal(result.config.model, 'gpt-5.3-codex');
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
    assert.equal(result.warnings.length, 2);
  });

  it('warns and preserves unknown nested keys while keeping known key validation', () => {
    const result = validateRuntimeConfig({
      model: 'gpt-5.3-codex',
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
      model: 'gpt-5.3-codex',
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
    config.model = 'gpt-5.3-codex';
    config.safe_unknown = { keep: true };
    config['__proto__'] = { polluted: true };
    config['constructor'] = { polluted: true };
    config['prototype'] = { polluted: true };

    const result = validateRuntimeConfig(config);

    assert.equal(result.config.model, 'gpt-5.3-codex');
    assert.deepEqual(result.config.safe_unknown, { keep: true });
    assert.equal(Object.hasOwn(result.config, '__proto__'), false);
    assert.equal(Object.hasOwn(result.config, 'constructor'), false);
    assert.equal(Object.hasOwn(result.config, 'prototype'), false);
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
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
      model: 'gpt-5.3-codex',
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
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
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
          model: 'gpt-5.3-codex',
          tools: {
            view_image: 'true',
          },
        }),
      /invalid type/u,
    );
  });
});

describe('runtimeConfig Context7 overlay', () => {
  it('replaces MCP placeholder values in memory before validation', () => {
    process.env.CODEINFO_SERVER_PORT = '5510';
    process.env.CODEINFO_CHAT_MCP_PORT = '5511';
    process.env.CODEINFO_AGENTS_MCP_PORT = '5512';
    process.env.CODEINFO_PLAYWRIGHT_MCP_URL = 'http://localhost:8931/mcp';

    const normalized = normalizeCodeinfoRuntimeConfigPlaceholders({
      mcp_servers: {
        code_info: {
          command: 'npx',
          args: ['-y', 'mcp-remote', 'http://localhost:${CODEINFO_CHAT_MCP_PORT}/mcp'],
        },
        ingest: {
          url: 'http://localhost:${CODEINFO_SERVER_PORT}/mcp',
        },
        agents: {
          url: 'http://localhost:${CODEINFO_AGENTS_MCP_PORT}/mcp',
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
      playwright: {
        url: 'http://localhost:8931/mcp',
      },
    });
  });

  it('replaces REPLACE_WITH_CONTEXT7_API_KEY in memory from CODEINFO_CONTEXT7_API_KEY', () => {
    process.env.CODEINFO_CONTEXT7_API_KEY = 'ctx7sk-real';

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
    process.env.CODEINFO_CONTEXT7_API_KEY = 'ctx7sk-real';

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
    process.env.CODEINFO_CONTEXT7_API_KEY = 'ctx7sk-env';

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
    process.env.CODEINFO_CONTEXT7_API_KEY = 'ctx7sk-real';

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
    process.env.CODEINFO_CONTEXT7_API_KEY = '   ';

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
        delete process.env.CODEINFO_CONTEXT7_API_KEY;
      } else {
        process.env.CODEINFO_CONTEXT7_API_KEY = value;
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
    delete process.env.CODEINFO_CONTEXT7_API_KEY;

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
    process.env.CODEINFO_CONTEXT7_API_KEY = 'ctx7sk-real';

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
    process.env.CODEINFO_CONTEXT7_API_KEY = 'ctx7sk-real';
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
    process.env.CODEINFO_CONTEXT7_API_KEY = 'ctx7sk-real';
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
    process.env.CODEINFO_CONTEXT7_API_KEY = 'ctx7sk-real';
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
    process.env.CODEINFO_CONTEXT7_API_KEY = 'ctx7sk-real';

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
      await fs.writeFile(agentConfigPath, 'model = "gpt-5.3-codex"\n', 'utf8');
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
      await fs.writeFile(chatConfigPath, 'model = "gpt-5.3-codex"\n', 'utf8');
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
    delete process.env.CODEINFO_CONTEXT7_API_KEY;
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
    delete process.env.CODEINFO_CONTEXT7_API_KEY;
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
        'model = "gpt-5.3-codex"\n[features]\nview_image_tool = true\nweb_search_request = false\n',
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
          'model = "gpt-5.3-codex"',
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
          'model = "gpt-5.3-codex"',
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
      await fs.writeFile(agentConfigPath, 'model = "gpt-5.3-codex"\n', 'utf8');
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
});
