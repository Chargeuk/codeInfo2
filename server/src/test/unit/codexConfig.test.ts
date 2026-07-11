import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, mock } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildOpenAiCompatProxyBaseUrl } from '../../chat/openaiCompatAdapter.js';
import {
  applyCodexOpenAiCompatEndpointToRuntimeConfig,
  applyResolvedServerPortToCodexConfig,
  buildCodexOpenAiCompatRuntimeConfig,
  buildCodexOptions,
  buildDefaultCodexConfig,
  ensureCodexConfigSeeded,
} from '../../config/codexConfig.js';
import { resolveCodeinfoMcpEndpointContract } from '../../config/mcpEndpoints.js';
import {
  detectCodex,
  refreshCodexDetection,
} from '../../providers/codexDetection.js';
import {
  getCodexDetection,
  setCodexDetection,
} from '../../providers/codexRegistry.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

describe('codexConfig', () => {
  const TASK2_BOOTSTRAP_MARKER = 'DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP';

  it('buildCodexOptions sets CODEX_HOME to the resolved override path', () => {
    const options = buildCodexOptions({ codexHome: '/tmp/x' });
    assert(options);
    assert.equal(options.env?.CODEX_HOME, path.resolve('/tmp/x'));
  });

  it('buildDefaultCodexConfig uses CODEINFO_SERVER_PORT when it is provided', () => {
    const config = buildDefaultCodexConfig({
      CODEINFO_SERVER_PORT: '5510',
      PORT: '5010',
    });
    assert.match(config, /http:\/\/localhost:5510\/mcp/);
  });

  it('buildDefaultCodexConfig falls back to PORT when CODEINFO_SERVER_PORT is missing', () => {
    const config = buildDefaultCodexConfig({
      PORT: '5600',
    });
    assert.match(config, /http:\/\/localhost:5600\/mcp/);
  });

  it('buildDefaultCodexConfig seeds the canonical base template without a Context7 api key pair', () => {
    const config = buildDefaultCodexConfig();

    assert.match(config, /model = "gpt-5\.6-sol"/u);
    assert.match(config, /args = \['-y', '@upstash\/context7-mcp'\]/u);
    assert.doesNotMatch(config, /ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866/u);
    assert.doesNotMatch(config, /--api-key/u);
  });

  it('buildCodexOpenAiCompatRuntimeConfig points Codex at the shared internal proxy', () => {
    const config = buildCodexOpenAiCompatRuntimeConfig({
      endpointId: 'https://openrouter.ai/api/v1',
      baseUrl: 'https://openrouter.ai/api/v1',
      capabilities: ['responses', 'completions'],
      displayLabel: 'OpenRouter',
      authLookupKey: 'openrouter',
    });

    assert.deepEqual(config, {
      model_provider: 'codeinfo_openai_endpoint',
      model_providers: {
        codeinfo_openai_endpoint: {
          name: 'codeinfo_openai_endpoint',
          base_url: buildOpenAiCompatProxyBaseUrl({
            endpoint: {
              endpointId: 'https://openrouter.ai/api/v1',
            },
            consumer: 'codex',
          }),
          wire_api: 'responses',
        },
      },
    });
  });

  it('buildCodexOpenAiCompatRuntimeConfig no longer requires a static model catalog for OpenRouter runs', async () => {
    const config = buildCodexOpenAiCompatRuntimeConfig(
      {
        endpointId: 'https://openrouter.ai/api/v1',
        baseUrl: 'https://openrouter.ai/api/v1',
        capabilities: ['responses', 'completions'],
        displayLabel: 'OpenRouter',
        authLookupKey: 'openrouter',
      },
      {
        modelId: 'meta-llama/llama-3.2-3b-instruct:free',
      },
    ) as Record<string, unknown>;

    assert.equal(config.model_catalog_json, undefined);
    assert.deepEqual(config, {
      model_provider: 'codeinfo_openai_endpoint',
      model_providers: {
        codeinfo_openai_endpoint: {
          name: 'codeinfo_openai_endpoint',
          base_url: buildOpenAiCompatProxyBaseUrl({
            endpoint: {
              endpointId: 'https://openrouter.ai/api/v1',
            },
            consumer: 'codex',
          }),
          wire_api: 'responses',
        },
      },
    });
  });

  it('buildCodexOpenAiCompatRuntimeConfig routes non-OpenRouter endpoints through the same internal proxy', () => {
    const config = buildCodexOpenAiCompatRuntimeConfig(
      {
        endpointId: 'http://192.168.1.3:1234/v1',
        baseUrl: 'http://192.168.1.3:1234/v1',
        capabilities: ['responses', 'completions'],
        displayLabel: 'LAN Gateway 2',
        authLookupKey: 'lan-gateway-2',
      },
      {
        modelId: 'gemma-3-12b',
      },
    ) as Record<string, unknown>;

    assert.equal(config.model_catalog_json, undefined);
    assert.deepEqual(config, {
      model_provider: 'codeinfo_openai_endpoint',
      model_providers: {
        codeinfo_openai_endpoint: {
          name: 'codeinfo_openai_endpoint',
          base_url: buildOpenAiCompatProxyBaseUrl({
            endpoint: {
              endpointId: 'http://192.168.1.3:1234/v1',
            },
            consumer: 'codex',
          }),
          wire_api: 'responses',
        },
      },
    });
  });

  it('applyCodexOpenAiCompatEndpointToRuntimeConfig forwards env to proxy base-url generation', () => {
    const config = applyCodexOpenAiCompatEndpointToRuntimeConfig(
      undefined,
      {
        endpointId: 'https://openrouter.ai/api/v1',
        baseUrl: 'https://openrouter.ai/api/v1',
        capabilities: ['responses', 'completions'],
        displayLabel: 'OpenRouter',
        authLookupKey: 'openrouter',
      },
      {
        env: {
          CODEINFO_SERVER_PORT: '5710',
        },
        modelId: 'openrouter/auto',
      },
    ) as Record<string, unknown>;

    assert.equal(config.model_provider, 'codeinfo_openai_endpoint');
    assert.deepEqual(config.model_providers, {
      codeinfo_openai_endpoint: {
        name: 'codeinfo_openai_endpoint',
        base_url: buildOpenAiCompatProxyBaseUrl({
          endpoint: {
            endpointId: 'https://openrouter.ai/api/v1',
          },
          consumer: 'codex',
          env: {
            CODEINFO_SERVER_PORT: '5710',
          },
        }),
        wire_api: 'responses',
      },
    });
    assert.deepEqual(
      (config.mcp_servers as Record<string, unknown>).web_tools,
      {
        command: 'npx',
        args: ['-y', 'mcp-remote', 'http://localhost:5013/mcp'],
        startup_timeout_sec: 60,
      },
    );
  });

  it('applyCodexOpenAiCompatEndpointToRuntimeConfig strips stale model_catalog_json while preserving other base config fields', () => {
    const config = applyCodexOpenAiCompatEndpointToRuntimeConfig(
      {
        model: 'legacy-model',
        model_catalog_json: '{"models":[{"slug":"stale"}]}',
        approval_policy: 'never',
        model_providers: {
          legacy: {
            name: 'legacy',
            base_url: 'https://legacy.example/v1',
          },
        },
      } as unknown as Parameters<
        typeof applyCodexOpenAiCompatEndpointToRuntimeConfig
      >[0],
      {
        endpointId: 'https://openrouter.ai/api/v1',
        baseUrl: 'https://openrouter.ai/api/v1',
        capabilities: ['responses', 'completions'],
        displayLabel: 'OpenRouter',
        authLookupKey: 'openrouter',
      },
    ) as Record<string, unknown>;

    assert.equal(config.model_catalog_json, undefined);
    assert.equal(config.approval_policy, 'never');
    assert.equal(config.model, 'legacy-model');
    assert.deepEqual(config.model_providers, {
      legacy: {
        name: 'legacy',
        base_url: 'https://legacy.example/v1',
      },
      codeinfo_openai_endpoint: {
        name: 'codeinfo_openai_endpoint',
        base_url: buildOpenAiCompatProxyBaseUrl({
          endpoint: {
            endpointId: 'https://openrouter.ai/api/v1',
          },
          consumer: 'codex',
        }),
        wire_api: 'responses',
      },
    });
  });

  it('applyCodexOpenAiCompatEndpointToRuntimeConfig injects managed web_tools when web_search is live', () => {
    const config = applyCodexOpenAiCompatEndpointToRuntimeConfig(
      {
        web_search: 'live',
        mcp_servers: {
          code_info: {
            command: 'npx',
            args: ['-y', 'mcp-remote', 'http://localhost:5010/mcp'],
          },
        },
      } as unknown as Parameters<
        typeof applyCodexOpenAiCompatEndpointToRuntimeConfig
      >[0],
      {
        endpointId: 'https://openrouter.ai/api/v1',
        baseUrl: 'https://openrouter.ai/api/v1',
        capabilities: ['responses', 'completions'],
        displayLabel: 'OpenRouter',
        authLookupKey: 'openrouter',
      },
      {
        env: {
          CODEINFO_WEB_MCP_PORT: '6513',
        },
      },
    ) as Record<string, unknown>;

    assert.deepEqual(
      (config.mcp_servers as Record<string, unknown>).web_tools,
      {
        command: 'npx',
        args: ['-y', 'mcp-remote', 'http://localhost:6513/mcp'],
        startup_timeout_sec: 60,
      },
    );
  });

  it('applyCodexOpenAiCompatEndpointToRuntimeConfig injects managed web_tools when endpoint execution inherits the default live mode', () => {
    const config = applyCodexOpenAiCompatEndpointToRuntimeConfig(
      {
        mcp_servers: {
          code_info: {
            command: 'npx',
            args: ['-y', 'mcp-remote', 'http://localhost:5010/mcp'],
          },
        },
      } as unknown as Parameters<
        typeof applyCodexOpenAiCompatEndpointToRuntimeConfig
      >[0],
      {
        endpointId: 'https://openrouter.ai/api/v1',
        baseUrl: 'https://openrouter.ai/api/v1',
        capabilities: ['responses', 'completions'],
        displayLabel: 'OpenRouter',
        authLookupKey: 'openrouter',
      },
      {
        env: {
          CODEINFO_WEB_MCP_PORT: '6513',
        },
      },
    ) as Record<string, unknown>;

    assert.deepEqual(
      (config.mcp_servers as Record<string, unknown>).web_tools,
      {
        command: 'npx',
        args: ['-y', 'mcp-remote', 'http://localhost:6513/mcp'],
        startup_timeout_sec: 60,
      },
    );
  });

  it('applyResolvedServerPortToCodexConfig rewrites legacy hard-coded MCP urls', () => {
    const input = [
      'host = "http://localhost:5010/mcp"',
      'docker = "http://server:5010/mcp"',
    ].join('\n');
    const rewritten = applyResolvedServerPortToCodexConfig(input, {
      CODEINFO_SERVER_PORT: '5710',
    });
    assert.match(rewritten, /http:\/\/localhost:5710\/mcp/);
    assert.match(rewritten, /http:\/\/server:5710\/mcp/);
  });

  it('applyResolvedServerPortToCodexConfig rewrites CODEINFO_SERVER_PORT placeholders', () => {
    const rewritten = applyResolvedServerPortToCodexConfig(
      'host = "http://localhost:${CODEINFO_SERVER_PORT}/mcp"',
      {
        CODEINFO_SERVER_PORT: '5710',
      },
    );

    assert.match(rewritten, /http:\/\/localhost:5710\/mcp/);
    assert.doesNotMatch(rewritten, /\$\{CODEINFO_SERVER_PORT\}/u);
  });

  it('keeps chat/base and agents MCP endpoint contracts distinct after normalization', () => {
    process.env.CODEINFO_SERVER_PORT = '6010';
    process.env.CODEINFO_CHAT_MCP_PORT = '6011';
    process.env.CODEINFO_AGENTS_MCP_PORT = '6012';
    process.env.CODEINFO_WEB_MCP_PORT = '6013';
    process.env.CODEINFO_PLAYWRIGHT_MCP_URL =
      'http://localhost:6999/mcp/playwright';

    const endpoints = resolveCodeinfoMcpEndpointContract();

    assert.equal(endpoints.classicMcpUrl, 'http://localhost:6010/mcp');
    assert.equal(endpoints.chatMcpUrl, 'http://localhost:6011/mcp');
    assert.equal(endpoints.agentsMcpUrl, 'http://localhost:6012/mcp');
    assert.equal(endpoints.webMcpUrl, 'http://localhost:6013/mcp');
    assert.notEqual(endpoints.classicMcpUrl, endpoints.agentsMcpUrl);
  });

  it('migrated checked-in configs no longer depend on bridge-era playwright hosts or hard-coded localhost MCP ports', async () => {
    const agentsRoot = path.join(repoRoot, 'codeinfo_agents');
    const agentEntries = await fs.readdir(agentsRoot, { withFileTypes: true });
    const configPaths = [
      path.join(repoRoot, 'config.toml.example'),
      ...agentEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(agentsRoot, entry.name, 'config.toml'))
        .sort(),
    ];

    const contents = await Promise.all(
      configPaths.map(async (configPath) => ({
        configPath,
        content: await fs.readFile(configPath, 'utf8'),
      })),
    );

    for (const { configPath, content } of contents) {
      assert.doesNotMatch(
        content,
        /http:\/\/localhost:501[01]\/mcp/u,
        configPath,
      );
      assert.doesNotMatch(content, /playwright-mcp/u, configPath);
    }
  });

  it('ensureCodexConfigSeeded writes the in-code template when config.toml is missing', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;

    try {
      process.env.CODEINFO_CODEX_HOME = codexHome;
      const configPath = ensureCodexConfigSeeded();
      const seeded = await fs.readFile(configPath, 'utf8');

      assert.equal(configPath, path.join(codexHome, 'config.toml'));
      assert.match(seeded, /model = "gpt-5\.6-sol"/u);
      assert.match(seeded, /command = "npx"/u);
    } finally {
      if (originalCodeinfoHome === undefined) {
        delete process.env.CODEINFO_CODEX_HOME;
      } else {
        process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
      }
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('ensureCodexConfigSeeded preserves server-port substitution in the in-code template', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    const originalServerPort = process.env.CODEINFO_SERVER_PORT;
    const originalPort = process.env.PORT;

    try {
      process.env.CODEINFO_CODEX_HOME = codexHome;
      process.env.CODEINFO_SERVER_PORT = '5876';
      process.env.PORT = '5010';

      const configPath = ensureCodexConfigSeeded();
      const seeded = await fs.readFile(configPath, 'utf8');

      assert.match(seeded, /http:\/\/localhost:5876\/mcp/u);
      assert.doesNotMatch(seeded, /__SERVER_PORT__/u);
    } finally {
      if (originalCodeinfoHome === undefined) {
        delete process.env.CODEINFO_CODEX_HOME;
      } else {
        process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
      }
      if (originalServerPort === undefined) {
        delete process.env.CODEINFO_SERVER_PORT;
      } else {
        process.env.CODEINFO_SERVER_PORT = originalServerPort;
      }
      if (originalPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = originalPort;
      }
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('ensureCodexConfigSeeded leaves the seeded file unchanged on repeated calls', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;

    try {
      process.env.CODEINFO_CODEX_HOME = codexHome;

      const configPath = ensureCodexConfigSeeded();
      const first = await fs.readFile(configPath, 'utf8');
      const secondPath = ensureCodexConfigSeeded();
      const second = await fs.readFile(configPath, 'utf8');

      assert.equal(secondPath, configPath);
      assert.equal(second, first);
    } finally {
      if (originalCodeinfoHome === undefined) {
        delete process.env.CODEINFO_CODEX_HOME;
      } else {
        process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
      }
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('ensureCodexConfigSeeded never overwrites an existing config.toml', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    const configPath = path.join(codexHome, 'config.toml');

    try {
      process.env.CODEINFO_CODEX_HOME = codexHome;
      await fs.writeFile(configPath, 'model = "user-kept"\n', 'utf8');

      const resolvedPath = ensureCodexConfigSeeded();
      const preserved = await fs.readFile(configPath, 'utf8');

      assert.equal(resolvedPath, configPath);
      assert.equal(preserved, 'model = "user-kept"\n');
    } finally {
      if (originalCodeinfoHome === undefined) {
        delete process.env.CODEINFO_CODEX_HOME;
      } else {
        process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
      }
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('ensureCodexConfigSeeded emits Story 47 bootstrap markers for seeded and existing paths', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    const infoLogs: unknown[][] = [];
    mock.method(console, 'info', (...args: unknown[]) => {
      infoLogs.push(args);
    });

    try {
      process.env.CODEINFO_CODEX_HOME = codexHome;

      ensureCodexConfigSeeded();
      ensureCodexConfigSeeded();

      assert(
        infoLogs.some((entry) => {
          const payload = entry[1] as
            | { outcome?: string; template_source?: string; success?: boolean }
            | undefined;
          return (
            String(entry[0]) === TASK2_BOOTSTRAP_MARKER &&
            payload?.outcome === 'seeded' &&
            payload.template_source === 'in_code' &&
            payload.success === true
          );
        }),
      );
      assert(
        infoLogs.some((entry) => {
          const payload = entry[1] as
            | { outcome?: string; template_source?: string; success?: boolean }
            | undefined;
          return (
            String(entry[0]) === TASK2_BOOTSTRAP_MARKER &&
            payload?.outcome === 'existing' &&
            payload.template_source === 'in_code' &&
            payload.success === true
          );
        }),
      );
    } finally {
      mock.restoreAll();
      if (originalCodeinfoHome === undefined) {
        delete process.env.CODEINFO_CODEX_HOME;
      } else {
        process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
      }
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('reports shared-home availability as available when auth/config are present at startup', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const authPath = path.join(codexHome, 'auth.json');
    const configPath = path.join(codexHome, 'config.toml');
    const infoLogs: string[] = [];
    mock.method(console, 'info', (...args: unknown[]) => {
      infoLogs.push(args.map(String).join(' '));
    });

    try {
      await fs.writeFile(authPath, '{"token":"shared"}', 'utf8');
      await fs.writeFile(configPath, 'model = "gpt-5.6-sol"\n', 'utf8');

      const detection = detectCodex({
        codexHome,
        resolveCliPath: () => '/usr/local/bin/codex',
      });

      assert.equal(detection.available, true);
      assert.equal(detection.authPresent, true);
      assert.equal(detection.configPresent, true);
      assert.equal(getCodexDetection().available, true);
      assert(
        infoLogs.some((line) =>
          line.includes(
            '[DEV-0000037][T08] event=shared_home_detection_completed result=success',
          ),
        ),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('reports shared-home availability as unavailable when auth is missing at startup', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const configPath = path.join(codexHome, 'config.toml');
    const errorLogs: string[] = [];
    mock.method(console, 'error', (...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });

    try {
      await fs.writeFile(configPath, 'model = "gpt-5.6-sol"\n', 'utf8');

      const detection = detectCodex({
        codexHome,
        resolveCliPath: () => '/usr/local/bin/codex',
      });

      assert.equal(detection.available, false);
      assert.equal(detection.authPresent, false);
      assert.equal(detection.configPresent, true);
      assert.match(detection.reason ?? '', /Missing auth\.json/u);
      assert.equal(getCodexDetection().available, false);
      assert(
        errorLogs.some((line) =>
          line.includes(
            '[DEV-0000037][T08] event=shared_home_detection_completed result=error',
          ),
        ),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('keeps codex registry fresh across direct-home detection failure and success refreshes', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const authPath = path.join(codexHome, 'auth.json');
    const configPath = path.join(codexHome, 'config.toml');
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
      reason: undefined,
    });

    try {
      await fs.writeFile(configPath, 'model = "gpt-5.6-sol"\n', 'utf8');

      const failed = refreshCodexDetection({
        codexHome,
        resolveCliPath: () => '/usr/local/bin/codex',
      });
      assert.equal(failed.available, false);
      assert.equal(getCodexDetection().available, false);

      await fs.writeFile(authPath, '{"token":"seeded"}', 'utf8');
      const recovered = refreshCodexDetection({
        codexHome,
        resolveCliPath: () => '/usr/local/bin/codex',
      });
      assert.equal(recovered.available, true);
      assert.equal(getCodexDetection().available, true);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
});
