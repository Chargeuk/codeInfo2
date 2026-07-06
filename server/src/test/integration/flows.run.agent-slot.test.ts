import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { startFlowRun } from '../../flows/service.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 50,
) => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const startedAt = Date.now();
  while (Date.now() - startedAt < resolvedTimeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for predicate');
};

const writeResumeFlow = async (dir: string) => {
  const flow = {
    description: 'Resume test flow',
    steps: [
      {
        type: 'llm',
        label: 'Step 1',
        agentType: 'coding_agent',
        identifier: 'resume-test',
        messages: [{ role: 'user', content: ['Step 1'] }],
      },
      {
        type: 'llm',
        label: 'Step 2',
        agentType: 'coding_agent',
        identifier: 'resume-test',
        messages: [{ role: 'user', content: ['Step 2'] }],
      },
    ],
  };
  await fs.writeFile(
    path.join(dir, 'resume-basic.json'),
    JSON.stringify(flow, null, 2),
  );
};

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const withFlowFixtureEnv = async (tmpDir: string, run: () => Promise<void>) =>
  await runWithTestEnvOverrides(
    {
      CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
      FLOWS_DIR: tmpDir,
    },
    run,
  );

class MinimalChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversation: string,
    _model: string,
  ) {
    void _flags;
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversation });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversation });
  }
}

beforeEach(() => {
  installDeterministicCodexAvailabilityBootstrap();
});

afterEach(() => {
  resetDeterministicCodexAvailabilityBootstrap();
});

test('startFlowRun reuses the same agent slot inside one fresh execution', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-same-slot-'),
  );
  await writeResumeFlow(tmpDir);

  let conversationId: string | undefined;
  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      const result = await startFlowRun({
        flowName: 'resume-basic',
        source: 'REST',
        chatFactory: () => new MinimalChat(),
      });
      conversationId = result.conversationId;
      assert.ok(conversationId);
      const runConversationId = conversationId;
      await waitFor(
        () => (memoryTurns.get(runConversationId) ?? []).length >= 4,
        5000,
      );

      const conversation = memoryConversations.get(runConversationId);
      const flags = (conversation?.flags ?? {}) as {
        flow?: {
          executionId?: string;
          agentConversations?: Record<string, string>;
        };
      };

      assert.equal(typeof flags.flow?.executionId, 'string');
      assert.deepEqual(Object.keys(flags.flow?.agentConversations ?? {}), [
        'coding_agent:resume-test',
      ]);
      assert.equal(
        typeof flags.flow?.agentConversations?.['coding_agent:resume-test'],
        'string',
      );
    });
  } finally {
    const conversation = conversationId
      ? memoryConversations.get(conversationId)
      : undefined;
    const flags = (conversation?.flags ?? {}) as {
      flow?: { agentConversations?: Record<string, string> };
    };
    const childConversationIds = Object.values(
      flags.flow?.agentConversations ?? {},
    );
    if (conversationId) {
      memoryConversations.delete(conversationId);
      memoryTurns.delete(conversationId);
    }
    childConversationIds.forEach((childConversationId) => {
      memoryConversations.delete(childConversationId);
      memoryTurns.delete(childConversationId);
    });
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
