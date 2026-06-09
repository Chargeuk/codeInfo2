import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import { registerPendingConversationCancel } from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { startFlowRun } from '../../flows/service.js';
import type { Conversation } from '../../mongo/conversation.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class SubflowChat extends ChatInterface {
  constructor(
    private readonly slowDelayMs: number,
    private readonly onExecute?: (params: {
      message: string;
      flags: Record<string, unknown>;
      conversationId: string;
    }) => void,
  ) {
    super();
  }

  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    this.onExecute?.({ message, flags, conversationId });
    const signal = (flags as { signal?: AbortSignal }).signal;
    const abortIfNeeded = () => {
      if (!signal?.aborted) return false;
      this.emit('error', { type: 'error', message: 'aborted' });
      return true;
    };

    if (abortIfNeeded()) return;
    this.emit('thread', { type: 'thread', threadId: conversationId });

    if (message.includes('slow child')) {
      await delay(this.slowDelayMs);
      if (abortIfNeeded()) return;
    }

    if (message.includes('slow child fail')) {
      await delay(this.slowDelayMs);
      if (abortIfNeeded()) return;
      this.emit('error', { type: 'error', message: 'child failed' });
      return;
    }

    if (message.includes('child fail')) {
      this.emit('error', { type: 'error', message: 'child failed' });
      return;
    }

    if (abortIfNeeded()) return;
    this.emit('final', { type: 'final', content: 'child ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error('Timed out waiting for condition');
};

const waitForAssistantStatus = async (
  conversationId: string,
  status: 'ok' | 'failed' | 'stopped',
  timeoutMs = 5000,
) => {
  await waitFor(() => {
    const turns = memoryTurns.get(conversationId) ?? [];
    return turns.some(
      (turn) => turn.role === 'assistant' && turn.status === status,
    );
  }, timeoutMs);
  const turns = memoryTurns.get(conversationId) ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role === 'assistant' && turn.status === status) {
      return turn;
    }
  }
  return undefined;
};

const waitForActiveSubflow = async (conversationId: string) => {
  await waitFor(() => {
    const conversation = memoryConversations.get(conversationId);
    return Boolean(
      (
        conversation?.flags as
          | { flow?: { activeSubflow?: unknown } }
          | undefined
      )?.flow?.activeSubflow,
    );
  });
  const conversation = memoryConversations.get(conversationId);
  return ((
    conversation?.flags as {
      flow?: { activeSubflow?: Record<string, unknown> };
    }
  )?.flow?.activeSubflow ?? null) as Record<string, unknown> | null;
};

const waitForConversationAssistantStatus = async (
  conversationId: string,
  status: 'ok' | 'failed' | 'stopped',
  timeoutMs = 5000,
) => {
  await waitFor(() => {
    const turns = memoryTurns.get(conversationId) ?? [];
    return turns.some(
      (turn) => turn.role === 'assistant' && turn.status === status,
    );
  }, timeoutMs);
};

const writeFlowFile = async (params: {
  tmpDir: string;
  flowName: string;
  steps: unknown[];
}) => {
  await fs.writeFile(
    path.join(params.tmpDir, `${params.flowName}.json`),
    JSON.stringify(
      {
        description: params.flowName,
        steps: params.steps,
      },
      null,
      2,
    ),
    'utf8',
  );
};

const llmStep = (content: string) => ({
  type: 'llm' as const,
  label: 'Child Step',
  agentType: 'planning_agent',
  identifier: 'planner',
  messages: [{ role: 'user' as const, content: [content] }],
});

const findChildFlowConversation = (params: {
  parentConversationId: string;
  childFlowName: string;
}) =>
  Array.from(memoryConversations.values()).find(
    (conversation) =>
      conversation._id !== params.parentConversationId &&
      conversation.flowName === params.childFlowName,
  );

let previousAgentsHome: string | undefined;
let previousFlowsDir: string | undefined;

beforeEach(() => {
  previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  previousFlowsDir = process.env.FLOWS_DIR;
  installDeterministicCodexAvailabilityBootstrap();
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  memoryConversations.clear();
  memoryTurns.clear();
});

afterEach(async () => {
  resetDeterministicCodexAvailabilityBootstrap();
  if (previousAgentsHome === undefined) {
    delete process.env.CODEINFO_CODEX_AGENT_HOME;
  } else {
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
  }
  if (previousFlowsDir === undefined) {
    delete process.env.FLOWS_DIR;
  } else {
    process.env.FLOWS_DIR = previousFlowsDir;
  }
  memoryConversations.clear();
  memoryTurns.clear();
});

test('subflow step launches a child flow, waits for completion, and uses the generated child title', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-subflow-ok-'));
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-ok',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-ok',
      steps: [
        {
          type: 'subflow',
          label: 'Run Child',
          flowName: 'child-ok',
        },
      ],
    });

    const result = await startFlowRun({
      flowName: 'parent-ok',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(150),
    });

    await waitForAssistantStatus(result.conversationId, 'ok');

    const childConversation = findChildFlowConversation({
      parentConversationId: result.conversationId,
      childFlowName: 'child-ok',
    });
    assert.ok(childConversation);
    assert.notEqual(childConversation?._id, result.conversationId);
    assert.equal(childConversation?.title, 'Parent Review-Run Child');

    const parentTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.ok(
      parentTurns.some(
        (turn) =>
          turn.role === 'user' && turn.content === 'Run subflow child-ok',
      ),
    );
    assert.ok(
      parentTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          turn.content === 'Completed subflow Parent Review-Run Child',
      ),
    );

    const parentConversation = memoryConversations.get(result.conversationId);
    assert.equal(
      (
        parentConversation?.flags as
          | { flow?: { activeSubflow?: unknown } }
          | undefined
      )?.flow?.activeSubflow,
      undefined,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parent step after a successful subflow gets a fresh inflight id', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-inflight-rotation-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-ok',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-two-step',
      steps: [
        {
          type: 'subflow',
          label: 'Run Child',
          flowName: 'child-ok',
        },
        llmStep('parent after subflow'),
      ],
    });

    const executions: Array<{
      message: string;
      conversationId: string;
      inflightId: string | null;
    }> = [];
    const result = await startFlowRun({
      flowName: 'parent-two-step',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(150, ({ message, flags, conversationId }) => {
          executions.push({
            message,
            conversationId,
            inflightId:
              typeof flags.inflightId === 'string' ? flags.inflightId : null,
          });
        }),
    });

    await waitFor(() => executions.length === 2);
    await waitForAssistantStatus(result.conversationId, 'ok');
    assert.equal(executions.length, 2);
    const parentFollowUpExecution = executions[1];
    assert.ok(parentFollowUpExecution);
    assert.equal(typeof parentFollowUpExecution?.inflightId, 'string');
    assert.notEqual(parentFollowUpExecution?.inflightId, result.inflightId);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow step mirrors child failure onto the parent flow', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-subflow-fail-'));
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-fail',
      steps: [llmStep('child fail')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-fail',
      steps: [
        {
          type: 'subflow',
          label: 'Run Broken Child',
          flowName: 'child-fail',
        },
      ],
    });

    const result = await startFlowRun({
      flowName: 'parent-fail',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(150),
    });

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'failed',
    );
    assert.equal(
      finalAssistant?.content,
      'Subflow Parent Review-Run Broken Child failed',
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow waits for the full child flow and can fail on a later child step', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-fail-later-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-fail-later',
      steps: [llmStep('child ok'), llmStep('slow child fail')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-fail-later',
      steps: [
        {
          type: 'subflow',
          label: 'Run Later Failure',
          flowName: 'child-fail-later',
        },
      ],
    });

    const result = await startFlowRun({
      flowName: 'parent-fail-later',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(160),
    });

    const childConversation = await waitFor(() => {
      const found = findChildFlowConversation({
        parentConversationId: result.conversationId,
        childFlowName: 'child-fail-later',
      });
      return Boolean(found);
    }).then(() =>
      findChildFlowConversation({
        parentConversationId: result.conversationId,
        childFlowName: 'child-fail-later',
      }),
    );

    assert.ok(childConversation?._id);
    await waitForConversationAssistantStatus(
      String(childConversation?._id),
      'ok',
    );
    await delay(40);
    const parentTurnsWhileChildContinues =
      memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      parentTurnsWhileChildContinues.some((turn) => turn.role === 'assistant'),
      false,
    );

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'failed',
    );
    assert.equal(
      finalAssistant?.content,
      'Subflow Parent Review-Run Later Failure failed',
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('stopping the parent flow stops the running child subflow', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-subflow-stop-'));
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-slow',
      steps: [llmStep('child ok'), llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stop',
      steps: [
        {
          type: 'subflow',
          label: 'Run Slow Child',
          flowName: 'child-slow',
        },
      ],
    });

    let parentRunToken: string | undefined;
    const result = await startFlowRun({
      flowName: 'parent-stop',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(250),
      onOwnershipReady: ({ runToken }) => {
        parentRunToken = runToken;
      },
    });

    const activeSubflow = await waitForActiveSubflow(result.conversationId);
    assert.ok(activeSubflow);
    assert.ok(parentRunToken);

    await waitForConversationAssistantStatus(
      String(activeSubflow?.conversationId),
      'ok',
    );

    registerPendingConversationCancel({
      conversationId: result.conversationId,
      runToken: parentRunToken as string,
    });

    await waitForAssistantStatus(result.conversationId, 'stopped');
    await waitForAssistantStatus(
      String(activeSubflow?.conversationId),
      'stopped',
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('pending parent stop prevents launching a new child subflow', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-stop-before-launch-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-never-started',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stop-before-launch',
      steps: [
        {
          type: 'subflow',
          label: 'Run Child',
          flowName: 'child-never-started',
        },
      ],
    });

    const result = await startFlowRun({
      flowName: 'parent-stop-before-launch',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(250),
      onOwnershipReady: ({ conversationId, runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken,
        });
      },
    });

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'stopped',
    );
    assert.equal(finalAssistant?.content, 'Stopped');

    const childFlowConversations = Array.from(
      memoryConversations.values(),
    ).filter((conversation) => conversation.flowName === 'child-never-started');
    assert.equal(childFlowConversations.length, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume reattaches to an already running child subflow instead of launching a second child run', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-resume',
      steps: [
        {
          type: 'subflow',
          label: 'Run Slow Child',
          flowName: 'child-resume',
        },
      ],
    });

    let childRunToken: string | undefined;
    const childStart = await startFlowRun({
      flowName: 'child-resume',
      customTitle: 'Resume Parent-Run Slow Child',
      source: 'REST',
      chatFactory: () => new SubflowChat(180),
      onOwnershipReady: ({ runToken }) => {
        childRunToken = runToken;
      },
    });
    assert.ok(childRunToken);

    const parentConversationId = 'resume-parent-conversation';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Parent',
      flowName: 'parent-resume',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-parent-execution',
          stepPath: [],
          loopStack: [],
          activeSubflow: {
            stepPath: [0],
            flowName: 'child-resume',
            conversationId: childStart.conversationId,
            runToken: childRunToken as string,
            title: 'Resume Parent-Run Slow Child',
          },
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'parent-resume',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(180),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    await waitForAssistantStatus(parentConversationId, 'ok');

    const childFlowConversations = Array.from(
      memoryConversations.values(),
    ).filter((conversation) => conversation.flowName === 'child-resume');
    assert.equal(childFlowConversations.length, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resumed parent stop wins when the restored child already finished', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-terminal-stop-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume-terminal',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-resume-terminal',
      steps: [
        {
          type: 'subflow',
          label: 'Run Finished Child',
          flowName: 'child-resume-terminal',
        },
      ],
    });

    let childRunToken: string | undefined;
    const childStart = await startFlowRun({
      flowName: 'child-resume-terminal',
      customTitle: 'Resume Parent-Run Finished Child',
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
      onOwnershipReady: ({ runToken }) => {
        childRunToken = runToken;
      },
    });
    assert.ok(childRunToken);
    await waitForAssistantStatus(childStart.conversationId, 'ok');

    const parentConversationId = 'resume-parent-terminal-conversation';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Parent',
      flowName: 'parent-resume-terminal',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-parent-terminal-execution',
          stepPath: [],
          loopStack: [],
          activeSubflow: {
            stepPath: [0],
            flowName: 'child-resume-terminal',
            conversationId: childStart.conversationId,
            runToken: childRunToken as string,
            title: 'Resume Parent-Run Finished Child',
          },
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'parent-resume-terminal',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
      onOwnershipReady: ({ conversationId, runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken,
        });
      },
    });

    assert.equal(resumed.conversationId, parentConversationId);
    const finalAssistant = await waitForAssistantStatus(
      parentConversationId,
      'stopped',
    );
    assert.equal(finalAssistant?.content, 'Stopped');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resumed parent flow uses its persisted conversation title for new subflow titles', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-persisted-title-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-title',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-title',
      steps: [
        {
          type: 'subflow',
          label: 'Run Child',
          flowName: 'child-title',
        },
      ],
    });

    const parentConversationId = 'persisted-title-parent';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Persisted Parent Title',
      flowName: 'parent-title',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'persisted-title-execution',
          stepPath: [],
          loopStack: [],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'parent-title',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
    });

    await waitForAssistantStatus(resumed.conversationId, 'ok');
    const childConversation = findChildFlowConversation({
      parentConversationId,
      childFlowName: 'child-title',
    });
    assert.equal(childConversation?.title, 'Persisted Parent Title-Run Child');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
