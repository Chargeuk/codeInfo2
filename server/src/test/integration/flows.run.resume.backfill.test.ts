import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import { getActiveRunOwnership } from '../../agents/runLock.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import {
  __getFlowResumeTestDepsForTests,
  __resetFlowResumeTestDepsForTests,
  __resetFlowWaitResumeDepsForTests,
  __resumePendingFlowWaitsForTests,
  __setFlowResumeTestDepsForTests,
  __setFlowWaitResumeDepsForTests,
  startFlowRun,
} from '../../flows/service.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 50,
) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for predicate');
};

const getAssistantTurnCount = (conversationId: string) =>
  (memoryTurns.get(conversationId) ?? []).filter(
    (turn) => turn?.role === 'assistant',
  ).length;

beforeEach(() => {
  installDeterministicCodexAvailabilityBootstrap();
});

afterEach(() => {
  resetDeterministicCodexAvailabilityBootstrap();
  __resetFlowResumeTestDepsForTests();
  __resetFlowWaitResumeDepsForTests();
});

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

const writeResumeDualAgentFlow = async (dir: string) => {
  const flow = {
    description: 'Resume dual-agent test flow',
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
        identifier: 'resume-test-2',
        messages: [{ role: 'user', content: ['Step 2'] }],
      },
    ],
  };
  await fs.writeFile(
    path.join(dir, 'resume-dual-agent.json'),
    JSON.stringify(flow, null, 2),
  );
};

const writeWaitResumeFlow = async (dir: string) => {
  const flow = {
    description: 'Wait resume backfill flow',
    steps: [
      {
        type: 'llm',
        label: 'Step 1',
        agentType: 'coding_agent',
        identifier: 'resume-test',
        messages: [{ role: 'user', content: ['Step 1'] }],
      },
      {
        type: 'wait',
        label: 'Wait step',
        seconds: 60,
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
    path.join(dir, 'wait-resume.json'),
    JSON.stringify(flow, null, 2),
  );
};

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

const getFlowExecutionId = (conversationId: string) => {
  const conversation = memoryConversations.get(conversationId);
  const flags = (conversation?.flags ?? {}) as {
    flow?: { executionId?: string };
  };
  assert.equal(typeof flags.flow?.executionId, 'string');
  return flags.flow?.executionId as string;
};

const getFlowChildExecutionId = (conversationId: string) => {
  const conversation = memoryConversations.get(conversationId);
  const flags = (conversation?.flags ?? {}) as {
    flowChild?: { executionId?: string };
  };
  assert.equal(typeof flags.flowChild?.executionId, 'string');
  return flags.flowChild?.executionId as string;
};

const updateChildExecution = (conversationId: string, executionId: string) => {
  const conversation = memoryConversations.get(conversationId);
  assert.ok(conversation);
  memoryConversations.set(conversationId, {
    ...conversation,
    flags: {
      ...(conversation.flags ?? {}),
      flowChild: {
        ...(((conversation.flags ?? {}) as { flowChild?: object }).flowChild ??
          {}),
        executionId,
      },
    },
    updatedAt: new Date(),
  });
};

test('startFlowRun backfills legacy executionId on resume', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-backfill-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-conv-legacy';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        stepPath: [],
        loopStack: [],
        agentConversations: {},
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const result = await startFlowRun({
      flowName: 'resume-basic',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    assert.equal(result.conversationId, conversationId);
    await waitFor(
      () => (memoryTurns.get(conversationId) ?? []).length >= 2,
      5000,
    );

    const conversation = memoryConversations.get(conversationId);
    const flags = (conversation?.flags ?? {}) as {
      flow?: { executionId?: string };
    };

    assert.equal(typeof flags.flow?.executionId, 'string');
  } finally {
    const conversation = memoryConversations.get(conversationId);
    const flags = (conversation?.flags ?? {}) as {
      flow?: { agentConversations?: Record<string, string> };
    };
    const childConversationIds = Object.values(
      flags.flow?.agentConversations ?? {},
    );
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    childConversationIds.forEach((childConversationId) => {
      memoryConversations.delete(childConversationId);
      memoryTurns.delete(childConversationId);
    });
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun backfills legacy child executionId on resume', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-child-backfill-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-conv-child-legacy';
  const childConversationId = 'agent-resume-conv-child-legacy';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'resume-execution-child-legacy',
        stepPath: [],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': childConversationId,
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(childConversationId, {
    _id: childConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {},
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    await startFlowRun({
      flowName: 'resume-basic',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    await waitFor(
      () => (memoryTurns.get(conversationId) ?? []).length >= 2,
      5000,
    );
    assert.equal(
      getFlowChildExecutionId(childConversationId),
      'resume-execution-child-legacy',
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(childConversationId);
    memoryTurns.delete(childConversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun keeps legacy parent and child execution backfills side-effect free until resume validation succeeds', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-parent-backfill-order-'),
  );
  await writeResumeDualAgentFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-conv-parent-backfill-order';
  const firstChildConversationId = 'agent-resume-conv-parent-backfill-first';
  const secondChildConversationId = 'agent-resume-conv-parent-backfill-second';

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-dual-agent',
    flowName: 'resume-dual-agent',
    source: 'REST',
    flags: {
      flow: {
        stepPath: [],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': firstChildConversationId,
          'coding_agent:resume-test-2': secondChildConversationId,
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(firstChildConversationId, {
    _id: firstChildConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-dual-agent (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {},
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(secondChildConversationId, {
    _id: secondChildConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-dual-agent (resume-test-2)',
    agentName: 'planning_agent',
    source: 'REST',
    flags: {},
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    await assert.rejects(
      () =>
        startFlowRun({
          flowName: 'resume-dual-agent',
          conversationId,
          resumeStepPath: [0],
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) => {
        assert.equal((error as { code?: string })?.code, 'AGENT_MISMATCH');
        return true;
      },
    );

    const rejectedConversation = memoryConversations.get(conversationId);
    const rejectedFlags = (rejectedConversation?.flags ?? {}) as {
      flow?: { executionId?: string };
    };
    assert.equal(rejectedFlags.flow?.executionId, undefined);

    const rejectedChild = memoryConversations.get(firstChildConversationId);
    const rejectedChildFlags = (rejectedChild?.flags ?? {}) as {
      flowChild?: { executionId?: string };
    };
    assert.equal(rejectedChildFlags.flowChild?.executionId, undefined);

    memoryConversations.set(secondChildConversationId, {
      ...(memoryConversations.get(secondChildConversationId) ?? {
        _id: secondChildConversationId,
      }),
      provider: 'codex',
      model: 'gpt-5.2-codex',
      title: 'Flow: resume-dual-agent (resume-test-2)',
      agentName: 'coding_agent',
      source: 'REST',
      flags: {},
      lastMessageAt: new Date(),
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await startFlowRun({
      flowName: 'resume-dual-agent',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    await waitFor(
      () => (memoryTurns.get(conversationId) ?? []).length >= 2,
      5000,
    );
    const backfilledExecutionId = getFlowExecutionId(conversationId);
    assert.equal(
      getFlowChildExecutionId(firstChildConversationId),
      backfilledExecutionId,
    );
    assert.equal(
      getFlowChildExecutionId(secondChildConversationId),
      backfilledExecutionId,
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(firstChildConversationId);
    memoryTurns.delete(firstChildConversationId);
    memoryConversations.delete(secondChildConversationId);
    memoryTurns.delete(secondChildConversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun validates each resumed child once and only backfills missing child execution ids', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-child-cardinality-'),
  );
  await writeResumeDualAgentFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-conv-child-cardinality';
  const firstChildConversationId = 'agent-resume-conv-child-cardinality-first';
  const secondChildConversationId =
    'agent-resume-conv-child-cardinality-second';
  const executionId = 'resume-execution-child-cardinality';

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-dual-agent',
    flowName: 'resume-dual-agent',
    source: 'REST',
    flags: {
      flow: {
        executionId,
        stepPath: [],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': firstChildConversationId,
          'coding_agent:resume-test-2': secondChildConversationId,
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(firstChildConversationId, {
    _id: firstChildConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-dual-agent (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {
      flowChild: {
        executionId,
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(secondChildConversationId, {
    _id: secondChildConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-dual-agent (resume-test-2)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {},
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const resumeDeps = __getFlowResumeTestDepsForTests();
  const ensureCalls: string[] = [];
  const persistCalls: string[] = [];
  __setFlowResumeTestDepsForTests({
    ensureFlowChildConversationOwnership: async (params) => {
      ensureCalls.push(params.conversationId);
      return resumeDeps.ensureFlowChildConversationOwnership(params);
    },
    persistFlowChildExecutionId: async (params) => {
      persistCalls.push(params.conversationId);
      return resumeDeps.persistFlowChildExecutionId(params);
    },
  });

  try {
    await startFlowRun({
      flowName: 'resume-dual-agent',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    await waitFor(
      () => (memoryTurns.get(conversationId) ?? []).length >= 2,
      5000,
    );

    assert.deepEqual(ensureCalls, [
      firstChildConversationId,
      secondChildConversationId,
    ]);
    assert.deepEqual(persistCalls, [secondChildConversationId]);
    assert.equal(
      getFlowChildExecutionId(firstChildConversationId),
      executionId,
    );
    assert.equal(
      getFlowChildExecutionId(secondChildConversationId),
      executionId,
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(firstChildConversationId);
    memoryTurns.delete(firstChildConversationId);
    memoryConversations.delete(secondChildConversationId);
    memoryTurns.delete(secondChildConversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun leaves a fresher child execution id intact when it appears after resume validation but before the stale backfill write', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-child-interleaving-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-conv-child-interleaving';
  const childConversationId = 'agent-resume-conv-child-interleaving';
  const staleExecutionId = 'resume-execution-child-stale';
  const fresherExecutionId = 'resume-execution-child-fresher';

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        executionId: staleExecutionId,
        stepPath: [],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': childConversationId,
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(childConversationId, {
    _id: childConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {},
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const resumeDeps = __getFlowResumeTestDepsForTests();
  let persistCalls = 0;
  __setFlowResumeTestDepsForTests({
    persistFlowChildExecutionId: async (params) => {
      persistCalls += 1;
      updateChildExecution(params.conversationId, fresherExecutionId);
      return resumeDeps.persistFlowChildExecutionId(params);
    },
  });

  try {
    await startFlowRun({
      flowName: 'resume-basic',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    await waitFor(
      () => (memoryTurns.get(conversationId) ?? []).length >= 2,
      5000,
    );

    assert.equal(persistCalls, 1);
    assert.equal(
      getFlowChildExecutionId(childConversationId),
      fresherExecutionId,
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(childConversationId);
    memoryTurns.delete(childConversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startup recovery reloads persisted wait state and resumes the same execution after an explicit backfill wake', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-wait-resume-backfill-'),
  );
  await writeWaitResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-wait-resume-backfill';
  const captured: string[] = [];
  let wake: (() => void) | null = null;

  class TrackingChat extends ChatInterface {
    async execute(
      message: string,
      _flags: Record<string, unknown>,
      childConversationId: string,
      _model: string,
    ) {
      void _flags;
      void _model;
      captured.push(message);
      this.emit('thread', { type: 'thread', threadId: childConversationId });
      this.emit('final', { type: 'final', content: 'ok' });
      this.emit('complete', {
        type: 'complete',
        threadId: childConversationId,
      });
    }
  }

  __setFlowWaitResumeDepsForTests({
    now: () => 1_700_000_000_000,
    scheduleWake: ({ onWake }) => {
      wake = onWake;
      return { cancel: () => {} };
    },
  });

  try {
    await startFlowRun({
      flowName: 'wait-resume',
      conversationId,
      source: 'REST',
      chatFactory: () => new TrackingChat(),
    });

    await waitFor(() => captured.length === 1);
    await waitFor(() => {
      const flags = (memoryConversations.get(conversationId)?.flags ?? {}) as {
        flow?: { wait?: { stepPath?: number[]; resumeAt?: number } };
      };
      return (
        Array.isArray(flags.flow?.wait?.stepPath) &&
        flags.flow?.wait?.stepPath?.length === 1 &&
        flags.flow?.wait?.stepPath?.[0] === 1 &&
        typeof flags.flow?.wait?.resumeAt === 'number'
      );
    });
    await waitFor(() => getActiveRunOwnership(conversationId) === null);
    const executionId = getFlowExecutionId(conversationId);
    __resetFlowWaitResumeDepsForTests();

    __setFlowWaitResumeDepsForTests({
      scheduleWake: ({ onWake }) => {
        wake = onWake;
        return { cancel: () => {} };
      },
    });

    await __resumePendingFlowWaitsForTests([conversationId]);
    assert.ok(wake, 'expected startup backfill to register a wake callback');

    wake?.();
    await waitFor(() => getAssistantTurnCount(conversationId) >= 2);
    assert.equal(
      (
        (memoryConversations.get(conversationId)?.flags ?? {}) as {
          flow?: { wait?: unknown };
        }
      ).flow?.wait,
      undefined,
    );
    assert.equal(getFlowExecutionId(conversationId), executionId);
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
