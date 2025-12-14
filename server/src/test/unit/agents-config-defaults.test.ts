import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { ThreadOptions as CodexThreadOptions } from '@openai/codex-sdk';

import { readAgentModelId } from '../../agents/config.js';
import { ChatInterfaceCodex } from '../../chat/interfaces/ChatInterfaceCodex.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';

describe('Agent config defaults', () => {
  it('parses model from config.toml', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(
      configPath,
      'model = "gpt-5.2"\\nmodel_reasoning_effort = "high"\\n',
      'utf8',
    );

    assert.equal(await readAgentModelId(configPath), 'gpt-5.2');
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
