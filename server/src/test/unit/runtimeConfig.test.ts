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
  minimizeBaseConfigToProjectsOnly,
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
  const TASK9_MARKER = 'DEV_0000040_T09_CHAT_BOOTSTRAP_BRANCH';

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
      assert.equal(first.branch, 'copied');
      assert.equal(first.generatedTemplate, false);
      assert.equal(second.copied, false);
      assert.equal(second.branch, 'existing_noop');
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
      assert.equal(result.branch, 'existing_noop');
      assert.equal(chatContents, 'model = "chat"\n');
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('generates template when both base and chat configs are missing', async () => {
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

  it('creates missing codex/chat directory before bootstrap write', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const chatDirPath = path.join(codexHome, 'chat');
    const chatConfigPath = path.join(chatDirPath, 'config.toml');

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

  it('emits deterministic marker for copied and existing branches', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const infoLogs: unknown[][] = [];
    mock.method(console, 'info', (...args: unknown[]) => {
      infoLogs.push(args);
    });

    try {
      await fs.writeFile(baseConfigPath, 'model = "from-base"\n', 'utf8');
      await ensureChatRuntimeConfigBootstrapped({ codexHome });
      await ensureChatRuntimeConfigBootstrapped({ codexHome });

      assert(
        infoLogs.some(
          (entry) =>
            String(entry[0]) === TASK9_MARKER &&
            (entry[1] as { branch?: string } | undefined)?.branch === 'copied',
        ),
      );
      assert(
        infoLogs.some(
          (entry) =>
            String(entry[0]) === TASK9_MARKER &&
            (entry[1] as { branch?: string } | undefined)?.branch ===
              'existing_noop',
        ),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('emits deterministic warning marker on copy failure', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const warningLogs: unknown[][] = [];
    const originalCopyFile = fs.copyFile.bind(fs);
    mock.method(console, 'warn', (...args: unknown[]) => {
      warningLogs.push(args);
    });

    try {
      await fs.writeFile(baseConfigPath, 'model = "from-base"\n', 'utf8');
      mock.method(
        fs,
        'copyFile',
        async (
          source: PathLike,
          destination: PathLike,
          mode?: number | undefined,
        ) => {
          if (String(destination).endsWith(path.join('chat', 'config.toml'))) {
            const error = new Error('read-only destination') as
              | Error
              | NodeJS.ErrnoException;
            (error as NodeJS.ErrnoException).code = 'EACCES';
            throw error;
          }
          return originalCopyFile(source, destination, mode);
        },
      );

      await assert.rejects(
        async () => ensureChatRuntimeConfigBootstrapped({ codexHome }),
        /read-only destination/u,
      );

      assert(
        warningLogs.some((entry) => {
          const payload = entry[1] as
            | { branch?: string; warningCode?: string }
            | undefined;
          return (
            String(entry[0]) === TASK9_MARKER &&
            payload?.branch === 'copy_failed' &&
            payload.warningCode === 'EACCES'
          );
        }),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('does not leave partial chat config when copy fails mid-stream', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const baseConfigPath = path.join(codexHome, 'config.toml');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const originalCopyFile = fs.copyFile.bind(fs);

    try {
      await fs.writeFile(baseConfigPath, 'model = "from-base"\n', 'utf8');
      mock.method(
        fs,
        'copyFile',
        async (
          source: PathLike,
          destination: PathLike,
          mode?: number | undefined,
        ) => {
          if (String(destination) === chatConfigPath) {
            await fs.mkdir(path.dirname(chatConfigPath), { recursive: true });
            await fs.writeFile(chatConfigPath, 'partial', 'utf8');
            const error = new Error('mid-copy failure') as
              | Error
              | NodeJS.ErrnoException;
            (error as NodeJS.ErrnoException).code = 'EIO';
            throw error;
          }
          return originalCopyFile(source, destination, mode);
        },
      );

      await assert.rejects(
        async () => ensureChatRuntimeConfigBootstrapped({ codexHome }),
        /mid-copy failure/u,
      );
      const exists = await fs
        .stat(chatConfigPath)
        .then((stat) => stat.isFile())
        .catch((error) => {
          if ((error as { code?: string }).code === 'ENOENT') return false;
          throw error;
        });
      assert.equal(exists, false);
    } finally {
      mock.restoreAll();
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
