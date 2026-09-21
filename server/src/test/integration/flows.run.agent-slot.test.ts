import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { LogEntry } from '@codeinfo2/common';

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { startFlowRun } from '../../flows/service.js';
import { subscribe } from '../../logStore.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import { withIsolatedProviderHomeTestEnv } from '../support/providerHomeHarness.js';
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
  await withIsolatedProviderHomeTestEnv(
    {
      prefix: 'flow-agent-slot-provider-homes-',
      overrides: {
        CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
        FLOWS_DIR: tmpDir,
      },
    },
    async () => await run(),
  );

const writeResetFlow = async (dir: string) => {
  const flow = {
    description: 'Reset one named agent slot without stopping the flow',
    steps: [
      {
        type: 'reset',
        label: 'Unused reset remains non-blocking',
        agentType: 'coding_agent',
        identifier: 'unused',
      },
      {
        type: 'llm',
        label: 'Alpha first call',
        agentType: 'coding_agent',
        identifier: 'alpha',
        messages: [{ role: 'user', content: ['Alpha 1'] }],
      },
      {
        type: 'llm',
        label: 'Beta first call',
        agentType: 'coding_agent',
        identifier: 'beta',
        messages: [{ role: 'user', content: ['Beta 1'] }],
      },
      {
        type: 'reset',
        label: 'Reset alpha',
        agentType: 'coding_agent',
        identifier: 'alpha',
      },
      {
        type: 'reset',
        label: 'Reset alpha again',
        agentType: 'coding_agent',
        identifier: 'alpha',
      },
      {
        type: 'llm',
        label: 'Beta follow-up',
        agentType: 'coding_agent',
        identifier: 'beta',
        messages: [{ role: 'user', content: ['Beta 2'] }],
      },
      {
        type: 'llm',
        label: 'Alpha fresh call',
        agentType: 'coding_agent',
        identifier: 'alpha',
        messages: [{ role: 'user', content: ['Alpha 2'] }],
      },
    ],
  };
  await fs.writeFile(
    path.join(dir, 'reset-agent-slot.json'),
    JSON.stringify(flow, null, 2),
  );
};

const writeTerminalResetFlow = async (dir: string) => {
  await fs.writeFile(
    path.join(dir, 'terminal-reset.json'),
    JSON.stringify(
      {
        description: 'Persist an agent reset as the final flow step',
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'terminal',
            messages: [{ role: 'user', content: ['Before reset'] }],
          },
          {
            type: 'reset',
            label: 'Persist reset checkpoint',
            agentType: 'coding_agent',
            identifier: 'terminal',
          },
        ],
      },
      null,
      2,
    ),
  );
};

const writeLoopResetFlow = async (dir: string) => {
  await fs.writeFile(
    path.join(dir, 'loop-reset.json'),
    JSON.stringify(
      {
        description: 'Reset an agent slot inside a loop',
        steps: [
          {
            type: 'startLoop',
            label: 'Reset loop',
            steps: [
              {
                type: 'llm',
                agentType: 'coding_agent',
                identifier: 'loop-worker',
                messages: [{ role: 'user', content: ['Loop work'] }],
              },
              {
                type: 'reset',
                label: 'Reset loop worker',
                agentType: 'coding_agent',
                identifier: 'loop-worker',
              },
              {
                type: 'break',
                agentType: 'loop_control_agent',
                identifier: 'loop-controller',
                question: 'Stop after one iteration?',
                breakOn: 'yes',
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );
};

type RecordedChatCall = {
  message: string;
  conversationId: string;
  threadId?: string;
};

class RecordingChat extends ChatInterface {
  constructor(private readonly calls: RecordedChatCall[]) {
    super();
  }

  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversation: string,
    _model: string,
  ) {
    void _model;
    this.calls.push({
      message,
      conversationId: conversation,
      ...(typeof flags.threadId === 'string'
        ? { threadId: flags.threadId }
        : {}),
    });
    const content = message.includes('Answer with JSON only')
      ? '{"answer":"yes"}'
      : 'ok';
    this.emit('thread', { type: 'thread', threadId: conversation });
    this.emit('final', { type: 'final', content });
    this.emit('complete', { type: 'complete', threadId: conversation });
  }
}

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

test('reset evicts one named agent slot and unused resets remain non-blocking', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-reset-agent-slot-'),
  );
  await writeResetFlow(tmpDir);

  setScopedTestEnvValue(
    'CODEINFO_CODEX_AGENT_HOME',
    path.join(repoRoot, 'codex_agents'),
  );
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  const calls: RecordedChatCall[] = [];
  const observedResetLogs: LogEntry[] = [];
  const unsubscribeFromLogs = subscribe((entry) => {
    if (entry.message === 'flows.agent.reset') {
      observedResetLogs.push(entry);
    }
  });
  let conversationId: string | undefined;
  try {
    const result = await startFlowRun({
      flowName: 'reset-agent-slot',
      source: 'REST',
      chatFactory: () => new RecordingChat(calls),
    });
    conversationId = result.conversationId;
    assert.ok(conversationId);
    const runConversationId = conversationId;
    await waitFor(() => {
      const conversation = memoryConversations.get(runConversationId);
      const flow = (conversation?.flags ?? {}).flow as
        | { stepPath?: number[] }
        | undefined;
      return calls.length === 4 && flow?.stepPath?.[0] === 6;
    });

    assert.deepEqual(
      calls.map((call) => call.message),
      ['Alpha 1', 'Beta 1', 'Beta 2', 'Alpha 2'],
    );
    const [alphaFirst, betaFirst, betaSecond, alphaSecond] = calls;
    assert.ok(alphaFirst);
    assert.ok(betaFirst);
    assert.ok(betaSecond);
    assert.ok(alphaSecond);
    assert.notEqual(alphaFirst.conversationId, alphaSecond.conversationId);
    assert.equal(alphaFirst.threadId, undefined);
    assert.equal(alphaSecond.threadId, undefined);
    assert.equal(betaFirst.conversationId, betaSecond.conversationId);
    assert.equal(betaFirst.threadId, undefined);
    assert.equal(betaSecond.threadId, betaFirst.conversationId);

    const conversation = memoryConversations.get(runConversationId);
    const flow = (conversation?.flags ?? {}).flow as
      | { agentConversations?: Record<string, string> }
      | undefined;
    assert.deepEqual(flow?.agentConversations, {
      'coding_agent:beta': betaFirst.conversationId,
      'coding_agent:alpha': alphaSecond.conversationId,
    });
    assert.ok(memoryConversations.has(alphaFirst.conversationId));
    assert.ok(memoryConversations.has(alphaSecond.conversationId));
    assert.ok(memoryConversations.has(betaFirst.conversationId));

    const resetLogs = observedResetLogs.filter(
      (entry) => entry.context?.conversationId === runConversationId,
    );
    assert.deepEqual(
      resetLogs.map((entry) => entry.context?.outcome),
      ['already_absent', 'reset', 'already_absent'],
    );
    assert.deepEqual(
      resetLogs.map((entry) => entry.context?.label),
      ['Unused reset remains non-blocking', 'Reset alpha', 'Reset alpha again'],
    );
  } finally {
    unsubscribeFromLogs();
    if (conversationId) {
      memoryConversations.delete(conversationId);
      memoryTurns.delete(conversationId);
    }
    for (const call of calls) {
      memoryConversations.delete(call.conversationId);
      memoryTurns.delete(call.conversationId);
    }
    setScopedTestEnvValue('CODEINFO_CODEX_AGENT_HOME', prevAgentsHome);
    if (prevFlowsDir) {
      setScopedTestEnvValue('FLOWS_DIR', prevFlowsDir);
    } else {
      clearScopedTestEnvValue('FLOWS_DIR');
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('reset persists an empty slot map when it is the final flow step', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-terminal-reset-'),
  );
  await writeTerminalResetFlow(tmpDir);

  setScopedTestEnvValue(
    'CODEINFO_CODEX_AGENT_HOME',
    path.join(repoRoot, 'codex_agents'),
  );
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  const calls: RecordedChatCall[] = [];
  let conversationId: string | undefined;
  try {
    const result = await startFlowRun({
      flowName: 'terminal-reset',
      source: 'REST',
      chatFactory: () => new RecordingChat(calls),
    });
    conversationId = result.conversationId;
    const runConversationId = conversationId;
    await waitFor(() => {
      const conversation = memoryConversations.get(runConversationId);
      const flow = (conversation?.flags ?? {}).flow as
        | { stepPath?: number[] }
        | undefined;
      return calls.length === 1 && flow?.stepPath?.[0] === 1;
    });

    const conversation = memoryConversations.get(runConversationId);
    const flow = (conversation?.flags ?? {}).flow as
      | {
          agentConversations?: Record<string, string>;
          agentThreads?: Record<string, string>;
        }
      | undefined;
    assert.deepEqual(flow?.agentConversations, {});
    assert.deepEqual(flow?.agentThreads, {});
    assert.ok(calls[0]);
    assert.ok(memoryConversations.has(calls[0].conversationId));
  } finally {
    if (conversationId) {
      memoryConversations.delete(conversationId);
      memoryTurns.delete(conversationId);
    }
    for (const call of calls) {
      memoryConversations.delete(call.conversationId);
      memoryTurns.delete(call.conversationId);
    }
    setScopedTestEnvValue('CODEINFO_CODEX_AGENT_HOME', prevAgentsHome);
    if (prevFlowsDir) {
      setScopedTestEnvValue('FLOWS_DIR', prevFlowsDir);
    } else {
      clearScopedTestEnvValue('FLOWS_DIR');
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('reset works inside a loop without preventing later loop control', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-loop-reset-'),
  );
  await writeLoopResetFlow(tmpDir);

  setScopedTestEnvValue(
    'CODEINFO_CODEX_AGENT_HOME',
    path.join(repoRoot, 'codex_agents'),
  );
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  const calls: RecordedChatCall[] = [];
  let conversationId: string | undefined;
  try {
    const result = await startFlowRun({
      flowName: 'loop-reset',
      source: 'REST',
      chatFactory: () => new RecordingChat(calls),
    });
    conversationId = result.conversationId;
    const runConversationId = conversationId;
    await waitFor(() => {
      const conversation = memoryConversations.get(runConversationId);
      const flow = (conversation?.flags ?? {}).flow as
        | { stepPath?: number[]; loopStack?: unknown[] }
        | undefined;
      return (
        calls.length === 2 &&
        flow?.stepPath?.[0] === 0 &&
        flow.loopStack?.length === 0
      );
    });

    assert.equal(calls[0]?.message, 'Loop work');
    assert.match(calls[1]?.message ?? '', /Stop after one iteration\?/);
    const conversation = memoryConversations.get(runConversationId);
    const flow = (conversation?.flags ?? {}).flow as
      | { agentConversations?: Record<string, string> }
      | undefined;
    assert.deepEqual(flow?.agentConversations, {
      'loop_control_agent:loop-controller': calls[1]?.conversationId,
    });
    assert.ok(calls[0]);
    assert.ok(memoryConversations.has(calls[0].conversationId));
  } finally {
    if (conversationId) {
      memoryConversations.delete(conversationId);
      memoryTurns.delete(conversationId);
    }
    for (const call of calls) {
      memoryConversations.delete(call.conversationId);
      memoryTurns.delete(call.conversationId);
    }
    setScopedTestEnvValue('CODEINFO_CODEX_AGENT_HOME', prevAgentsHome);
    if (prevFlowsDir) {
      setScopedTestEnvValue('FLOWS_DIR', prevFlowsDir);
    } else {
      clearScopedTestEnvValue('FLOWS_DIR');
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
