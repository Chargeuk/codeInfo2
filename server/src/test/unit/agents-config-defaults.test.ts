import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ThreadOptions as CodexThreadOptions } from '@openai/codex-sdk';

import { resolveAgentRuntimeExecutionConfig } from '../../agents/config.js';
import { ChatInterfaceCodex } from '../../chat/interfaces/ChatInterfaceCodex.js';
import { normalizeRuntimeConfig } from '../../config/runtimeConfig.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';

describe('Agent config defaults', () => {
  it('normalizes features.view_image_tool alias to canonical output only', () => {
    const normalized = normalizeRuntimeConfig({
      features: { view_image_tool: true, keep_this: true },
    });

    assert.deepEqual(normalized.tools, { view_image: true });
    assert.deepEqual(normalized.features, { keep_this: true });
    assert.equal(
      (normalized.features as Record<string, unknown>).view_image_tool,
      undefined,
    );
  });

  it('normalizes features.web_search_request alias to canonical web_search output', () => {
    const normalized = normalizeRuntimeConfig({
      features: { web_search_request: false, keep_this: true },
    });

    assert.equal(normalized.web_search, 'disabled');
    assert.deepEqual(normalized.features, { keep_this: true });
    assert.equal(
      (normalized.features as Record<string, unknown>).web_search_request,
      undefined,
    );
  });

  it('keeps canonical keys when canonical and alias keys conflict', () => {
    const normalized = normalizeRuntimeConfig({
      web_search: 'cached',
      tools: { view_image: true },
      features: { web_search_request: false, view_image_tool: false },
    });

    assert.equal(normalized.web_search, 'cached');
    assert.deepEqual(normalized.tools, { view_image: true });
    assert.equal(
      (normalized.features as Record<string, unknown>)?.web_search_request,
      undefined,
    );
    assert.equal(
      (normalized.features as Record<string, unknown>)?.view_image_tool,
      undefined,
    );
  });

  it('resolves model from shared runtime config resolver', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(
      configPath,
      'model = "gpt-5.2"\nmodel_reasoning_effort = "high"\n',
      'utf8',
    );

    const resolved = await resolveAgentRuntimeExecutionConfig({
      configPath,
      entrypoint: 'agents.service',
    });

    assert.equal(resolved.modelId, 'gpt-5.2');
  });

  it('emits deterministic T05 success log when runtime execution config resolves', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(configPath, 'model = "gpt-5.2"\n', 'utf8');

    const originalInfo = console.info;
    const logs: string[] = [];
    console.info = (...args: unknown[]) => {
      logs.push(String(args[0] ?? ''));
    };

    try {
      await resolveAgentRuntimeExecutionConfig({
        configPath,
        entrypoint: 'agents.service',
      });
    } finally {
      console.info = originalInfo;
    }

    assert.equal(
      logs.some((line) =>
        line.includes(
          '[DEV-0000037][T05] event=shared_runtime_resolver_used_by_entrypoints result=success',
        ),
      ),
      true,
    );
  });

  it('emits deterministic T05 error log when runtime execution config resolution fails', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(configPath, 'approval_policy = 1\n', 'utf8');

    const originalError = console.error;
    const logs: string[] = [];
    console.error = (...args: unknown[]) => {
      logs.push(String(args[0] ?? ''));
    };

    try {
      await assert.rejects(async () => {
        await resolveAgentRuntimeExecutionConfig({
          configPath,
          entrypoint: 'flows.service',
        });
      });
    } finally {
      console.error = originalError;
    }

    assert.equal(
      logs.some((line) =>
        line.includes(
          '[DEV-0000037][T05] event=shared_runtime_resolver_used_by_entrypoints result=error',
        ),
      ),
      true,
    );
  });

  it('validates every codex_agents/*/config.toml fixture through deterministic normalization pipeline', async () => {
    const repoRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../',
    );
    const agentsRoot = path.join(repoRoot, 'codex_agents');
    const entries = await fs.readdir(agentsRoot, { withFileTypes: true });
    const configPaths = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(agentsRoot, entry.name, 'config.toml'))
      .sort();

    assert.equal(configPaths.length > 0, true);

    for (const configPath of configPaths) {
      const first = await resolveAgentRuntimeExecutionConfig({
        configPath,
        entrypoint: 'agents.service',
      });
      const second = await resolveAgentRuntimeExecutionConfig({
        configPath,
        entrypoint: 'agents.service',
      });

      assert.equal(typeof first.modelId, 'string');
      assert.equal((first.modelId ?? '').length > 0, true);
      assert.deepEqual(first.runtimeConfig, second.runtimeConfig);
      assert.equal(first.modelId, second.modelId);
    }
  });

  it('omits config-owned ThreadOptions when useConfigDefaults is enabled', async () => {
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });

    const originalWorkdir = process.env.CODEX_WORKDIR;
    process.env.CODEX_WORKDIR = '/tmp/codex-workdir';

    const captured: {
      start?: CodexThreadOptions;
      resume?: CodexThreadOptions;
    } = {};

    const events = async function* () {
      yield { type: 'thread.started', thread_id: 'tid-1' };
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'ok' },
      };
      yield { type: 'turn.completed' };
    };

    const thread = {
      id: 'tid-1',
      runStreamed: async () => ({ events: events() }),
    };

    const chat = new ChatInterfaceCodex(() => ({
      startThread: (opts?: CodexThreadOptions) => {
        captured.start = opts;
        return thread;
      },
      resumeThread: (id: string, opts?: CodexThreadOptions) => {
        void id;
        captured.resume = opts;
        return thread;
      },
    }));

    try {
      await chat.run(
        'Hello',
        {
          threadId: null,
          useConfigDefaults: true,
          codexFlags: {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'never',
            modelReasoningEffort: 'high',
            networkAccessEnabled: false,
            webSearchEnabled: false,
          },
        },
        'conv-1',
        'gpt-5.1-codex-max',
      );
    } finally {
      process.env.CODEX_WORKDIR = originalWorkdir;
    }

    assert(captured.start);
    assert.equal(captured.start.workingDirectory, '/tmp/codex-workdir');
    assert.equal(captured.start.skipGitRepoCheck, true);

    assert.equal('model' in captured.start, false);
    assert.equal('sandboxMode' in captured.start, false);
    assert.equal('approvalPolicy' in captured.start, false);
    assert.equal('modelReasoningEffort' in captured.start, false);
    assert.equal('networkAccessEnabled' in captured.start, false);
    assert.equal('webSearchEnabled' in captured.start, false);
  });
});
