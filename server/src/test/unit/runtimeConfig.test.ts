import assert from 'node:assert/strict';
import type { PathLike } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, mock } from 'node:test';

import {
  ensureChatRuntimeConfigBootstrapped,
  loadRuntimeConfigSnapshot,
  mergeProjectsFromBaseIntoRuntime,
  normalizeRuntimeConfig,
  readAndNormalizeRuntimeTomlConfig,
  resolveAgentRuntimeConfig,
  resolveChatRuntimeConfig,
  resolveMergedAndValidatedRuntimeConfig,
  type RuntimeConfigResolutionError,
  validateRuntimeConfig,
} from '../../config/runtimeConfig.js';

describe('runtimeConfig normalization', () => {
  it('normalizes legacy features.view_image_tool to tools.view_image', () => {
    const normalized = normalizeRuntimeConfig({
      features: { view_image_tool: true, keep_this: true },
    });

    assert.deepEqual(normalized.tools, { view_image: true });
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
});

describe('runtimeConfig bootstrap', () => {
  it('copies base config to chat config once when missing', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');

    try {
      await fs.writeFile(
        baseConfigPath,
        'model = "gpt-5.3-codex-spark"\n',
        'utf8',
      );
      const first = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const second = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const copied = await fs.readFile(chatConfigPath, 'utf8');

      assert.equal(first.copied, true);
      assert.equal(second.copied, false);
      assert.match(copied, /model = "gpt-5.3-codex-spark"/);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('never overwrites an existing chat config during bootstrap', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');

    try {
      await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
      await fs.writeFile(baseConfigPath, 'model = "base"\n', 'utf8');
      await fs.writeFile(chatConfigPath, 'model = "chat"\n', 'utf8');

      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const chatContents = await fs.readFile(chatConfigPath, 'utf8');

      assert.equal(result.copied, false);
      assert.equal(chatContents, 'model = "chat"\n');
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('does nothing when base config is missing', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');

    try {
      const result = await ensureChatRuntimeConfigBootstrapped({ codexHome });
      const exists = await fs
        .stat(chatConfigPath)
        .then((stat) => stat.isFile())
        .catch((error) => {
          if ((error as { code?: string }).code === 'ENOENT') return false;
          throw error;
        });

      assert.equal(result.copied, false);
      assert.equal(exists, false);
    } finally {
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

  it('warns and ignores unknown keys', () => {
    const result = validateRuntimeConfig({
      model: 'gpt-5.3-codex',
      totally_unknown: true,
    });

    assert.equal(result.config.model, 'gpt-5.3-codex');
    assert.equal('totally_unknown' in result.config, false);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0].message, /Unknown key/u);
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
});

describe('runtimeConfig merged happy paths and T04 logs', () => {
  it('resolves canonical agent config and merges only shared projects', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const agentConfigPath = path.join(codexHome, 'agent-config.toml');
    try {
      await fs.writeFile(
        baseConfigPath,
        '[projects]\n[projects."/base"]\ntrust_level = "trusted"\nmodel = "base-model"\n',
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
      assert.deepEqual(resolved.config.projects, {
        '/base': {
          trust_level: 'untrusted',
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
