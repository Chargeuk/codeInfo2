import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, mock } from 'node:test';

import {
  ensureChatRuntimeConfigBootstrapped,
  loadRuntimeConfigSnapshot,
  normalizeRuntimeConfig,
  readAndNormalizeRuntimeTomlConfig,
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
