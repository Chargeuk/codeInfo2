import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { ThreadOptions as CodexThreadOptions } from '@openai/codex-sdk';

import { resolveAgentRuntimeExecutionConfig } from '../../agents/config.js';
import { ChatInterfaceCodex } from '../../chat/interfaces/ChatInterfaceCodex.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';

describe('Agent config defaults', () => {
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
