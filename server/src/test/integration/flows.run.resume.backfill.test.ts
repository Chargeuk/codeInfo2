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
  FLOW_WAIT_STARTUP_RECOVERY_DEGRADED_EVENT,
  resumePendingFlowWaitsForStartup,
  startFlowRun,
} from '../../flows/service.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { query } from '../../logStore.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import { withIsolatedProviderHomeTestEnv } from '../support/providerHomeHarness.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 10000,
  intervalMs = 50,
  describe?: () => string,
) => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const startedAt = Date.now();
  while (Date.now() - startedAt < resolvedTimeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    describe ? `Timed out waiting for predicate | ${describe()}` : 'Timed out waiting for predicate',
  );
};

const describeResumeBackfillState = (conversationId: string): string =>
  JSON.stringify({
    conversationFlags: memoryConversations.get(conversationId)?.flags ?? null,
    recentTurns: (memoryTurns.get(conversationId) ?? []).slice(-8).map((turn) => ({
      role: turn.role,
      status: turn.status,
      content: turn.content,
    })),
    runtimeLogs: query({ text: 'flows.test.' }, 80)
      .filter(
        (entry) =>
          entry.context?.conversationId === conversationId ||
          entry.message.startsWith('runtime.chat_config_lock_'),
      )
      .map((entry) => ({
        message: entry.message,
        context: entry.context,
      })),
  });

const getAssistantTurnCount = (conversationId: string) =>
  (memoryTurns.get(conversationId) ?? []).filter(
    (turn) => turn?.role === 'assistant',
  ).length;

const getLatestAssistantTurn = (conversationId: string) =>
  [...(memoryTurns.get(conversationId) ?? [])]
    .reverse()
    .find((turn) => turn?.role === 'assistant');

const getPersistedWaitState = (conversationId: string) => {
  const flags = (memoryConversations.get(conversationId)?.flags ?? {}) as {
    flow?: {
      wait?: {
        executionId?: string;
        stepPath?: number[];
        resumeAt?: number;
      };
    };
  };
  return flags.flow?.wait;
};

beforeEach(() => {
  installDeterministicCodexAvailabilityBootstrap();
});

afterEach(() => {
  resetDeterministicCodexAvailabilityBootstrap();
  __resetFlowResumeTestDepsForTests();
  __resetFlowWaitResumeDepsForTests();
});

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const listSingleRepository = async (repositoryPath: string) => ({
  repos: [
    {
      id: path.basename(repositoryPath),
      description: null,
      containerPath: repositoryPath,
      hostPath: repositoryPath,
      lastIngestAt: null,
      embeddingProvider: 'lmstudio',
      embeddingModel: 'model',
      embeddingDimensions: 768,
      model: 'model',
      modelId: 'model',
      lock: {
        embeddingProvider: 'lmstudio',
        embeddingModel: 'model',
        embeddingDimensions: 768,
        lockedModelId: 'model',
        modelId: 'model',
      },
      counts: { files: 0, chunks: 0, embedded: 0 },
      lastError: null,
    } satisfies RepoEntry,
  ],
  lockedModelId: null,
});

const withFlowFixtureEnv = async (tmpDir: string, run: () => Promise<void>) =>
  await withIsolatedProviderHomeTestEnv(
    {
      prefix: 'flow-resume-backfill-provider-homes-',
      overrides: {
        CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
        FLOWS_DIR: tmpDir,
      },
    },
    async () => await run(),
  );

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

const writeConditionalWaitResumeFlow = async (dir: string) => {
  await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'scripts', 'select-then.py'),
    'import json\nprint(json.dumps({"answer": "yes"}))\n',
  );
  await fs.writeFile(
    path.join(dir, 'conditional-wait-resume.json'),
    JSON.stringify(
      {
        description: 'Conditional wait resume flow',
        steps: [
          {
            type: 'if',
            label: 'Choose the original branch',
            condition: 'scripts/select-then.py',
            then: [
              { type: 'wait', label: 'Wait in then branch', seconds: 60 },
              {
                type: 'llm',
                label: 'Resume original branch',
                agentType: 'coding_agent',
                identifier: 'resume-test',
                messages: [
                  { role: 'user', content: ['Original branch resumed'] },
                ],
              },
            ],
            else: [
              {
                type: 'llm',
                label: 'Wrong branch',
                agentType: 'coding_agent',
                identifier: 'resume-test',
                messages: [{ role: 'user', content: ['Wrong branch ran'] }],
              },
            ],
          },
          {
            type: 'llm',
            label: 'After conditional',
            agentType: 'coding_agent',
            identifier: 'resume-test',
            messages: [{ role: 'user', content: ['After conditional'] }],
          },
        ],
      },
      null,
      2,
    ),
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
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-backfill-'),
  );
  await writeResumeFlow(tmpDir);

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
    await withFlowFixtureEnv(tmpDir, async () => {
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
        50,
        () => describeResumeBackfillState(conversationId),
      );

      const conversation = memoryConversations.get(conversationId);
      const flags = (conversation?.flags ?? {}) as {
        flow?: { executionId?: string };
      };

      assert.equal(typeof flags.flow?.executionId, 'string');
    });
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
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
test('startFlowRun backfills legacy child executionId on resume', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-child-backfill-'),
  );
  await writeResumeFlow(tmpDir);

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
    await withFlowFixtureEnv(tmpDir, async () => {
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
        50,
        () => describeResumeBackfillState(conversationId),
      );
      assert.equal(
        getFlowChildExecutionId(childConversationId),
        'resume-execution-child-legacy',
      );
    });
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(childConversationId);
    memoryTurns.delete(childConversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun keeps legacy parent and child execution backfills side-effect free until resume validation succeeds', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-parent-backfill-order-'),
  );
  await writeResumeDualAgentFlow(tmpDir);

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
    await withFlowFixtureEnv(tmpDir, async () => {
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
        50,
        () => describeResumeBackfillState(conversationId),
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
    });
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(firstChildConversationId);
    memoryTurns.delete(firstChildConversationId);
    memoryConversations.delete(secondChildConversationId);
    memoryTurns.delete(secondChildConversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun validates each resumed child once and only backfills missing child execution ids', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-child-cardinality-'),
  );
  await writeResumeDualAgentFlow(tmpDir);

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
    await withFlowFixtureEnv(tmpDir, async () => {
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
        50,
        () => describeResumeBackfillState(conversationId),
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
    });
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(firstChildConversationId);
    memoryTurns.delete(firstChildConversationId);
    memoryConversations.delete(secondChildConversationId);
    memoryTurns.delete(secondChildConversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun leaves a fresher child execution id intact when it appears after resume validation but before the stale backfill write', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-child-interleaving-'),
  );
  await writeResumeFlow(tmpDir);

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
    await withFlowFixtureEnv(tmpDir, async () => {
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
        50,
        () => describeResumeBackfillState(conversationId),
      );

      assert.equal(persistCalls, 1);
      assert.equal(
        getFlowChildExecutionId(childConversationId),
        fresherExecutionId,
      );
    });
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(childConversationId);
    memoryTurns.delete(childConversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startup recovery re-registers persisted waits through the normal startup path and resumes the same execution after an explicit wake', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-wait-resume-backfill-'),
  );
  await writeWaitResumeFlow(tmpDir);

  const conversationId = 'flow-wait-resume-backfill';
  const captured: string[] = [];
  const wakes: Array<() => void> = [];
  let completedWakeCancellations = 0;

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
      wakes.push(onWake);
      return { cancel: () => {} };
    },
  });

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      await startFlowRun({
        flowName: 'wait-resume',
        conversationId,
        source: 'REST',
        chatFactory: () => new TrackingChat(),
      });

      await waitFor(
        () => captured.length === 1,
        10000,
        50,
        () => describeResumeBackfillState(conversationId),
      );
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
      }, 10000, 50, () => describeResumeBackfillState(conversationId));
      await waitFor(
        () => getActiveRunOwnership(conversationId) === null,
        10000,
        50,
        () => describeResumeBackfillState(conversationId),
      );
      const executionId = getFlowExecutionId(conversationId);
      __resetFlowWaitResumeDepsForTests();
      wakes.length = 0;

      __setFlowWaitResumeDepsForTests({
        scheduleWake: ({ onWake }) => {
          wakes.push(onWake);
          return {
            cancel: () => {
              completedWakeCancellations += 1;
            },
          };
        },
      });

      await resumePendingFlowWaitsForStartup();
      assert.ok(
        wakes.length > 0,
        'expected startup backfill to register a wake callback',
      );

      wakes.forEach((registeredWake) => registeredWake());
      await waitFor(
        () => getAssistantTurnCount(conversationId) >= 2,
        10000,
        50,
        () => describeResumeBackfillState(conversationId),
      );
      const assistantTurns = (memoryTurns.get(conversationId) ?? []).filter(
        (turn) => turn?.role === 'assistant',
      );
      assert.equal(typeof assistantTurns.at(-1)?.status, 'string');
      assert.equal(
        (
          (memoryConversations.get(conversationId)?.flags ?? {}) as {
            flow?: { wait?: unknown };
          }
        ).flow?.wait,
        undefined,
      );
      assert.equal(getFlowExecutionId(conversationId), executionId);
      assert.equal(completedWakeCancellations, 1);
    });
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('persisted waits resume the originally selected conditional branch without re-evaluating it', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-conditional-wait-resume-'),
  );
  await writeConditionalWaitResumeFlow(tmpDir);
  const conversationId = 'flow-conditional-wait-resume';
  const captured: string[] = [];
  const wakes: Array<() => void> = [];

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

  const chatFactory = () => new TrackingChat();
  __setFlowWaitResumeDepsForTests({
    now: () => 1_700_000_000_000,
    scheduleWake: ({ onWake }) => {
      wakes.push(onWake);
      return { cancel: () => {} };
    },
    resumeFlowRun: async (resumeParams) =>
      await startFlowRun({
        ...resumeParams,
        chatFactory,
        listIngestedRepositories: async () =>
          await listSingleRepository(tmpDir),
      }),
  });

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      await startFlowRun({
        flowName: 'conditional-wait-resume',
        conversationId,
        source: 'REST',
        working_folder: tmpDir,
        chatFactory,
        listIngestedRepositories: async () =>
          await listSingleRepository(tmpDir),
      });
      await waitFor(
        () => Boolean(getPersistedWaitState(conversationId)),
        5000,
        25,
        () => describeResumeBackfillState(conversationId),
      );
      assert.deepEqual(getPersistedWaitState(conversationId)?.stepPath, [
        0, 0, 0,
      ]);

      await fs.rm(path.join(tmpDir, 'scripts', 'select-then.py'));
      const wake = wakes.shift();
      assert.ok(wake);
      wake();

      await waitFor(
        () => captured.includes('After conditional'),
        10000,
        25,
        () => describeResumeBackfillState(conversationId),
      );
      assert.deepEqual(captured, [
        'Original branch resumed',
        'After conditional',
      ]);
    });
  } finally {
    const flow = memoryConversations.get(conversationId)?.flags?.flow as
      | { agentConversations?: Record<string, string> }
      | undefined;
    for (const childConversationId of Object.values(
      flow?.agentConversations ?? {},
    )) {
      memoryConversations.delete(childConversationId);
      memoryTurns.delete(childConversationId);
    }
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('exhausted GitHub review recovery records a terminal warning and continues later flow steps', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-github-recovery-exhausted-'),
  );
  const conversationId = 'flow-github-recovery-exhausted';
  const captured: string[] = [];
  await fs.writeFile(
    path.join(tmpDir, 'github-recovery-exhausted.json'),
    JSON.stringify(
      {
        description: 'Exhaust GitHub recovery and continue',
        steps: [
          { type: 'wait', label: 'Completed review wait', seconds: 60 },
          { type: 'github_fetch_reviews', label: 'Fetch review' },
          {
            type: 'llm',
            label: 'Continue after review warning',
            agentType: 'coding_agent',
            identifier: 'resume-test',
            messages: [{ role: 'user', content: ['Continued after review'] }],
          },
        ],
      },
      null,
      2,
    ),
  );
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: github-recovery-exhausted',
    flowName: 'github-recovery-exhausted',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'github-recovery-execution',
        stepPath: [0],
        loopStack: [],
        agentConversations: {},
        agentThreads: {},
        workingFolder: tmpDir,
        githubReviewContext: {
          executionId: 'github-recovery-execution',
          prNumber: 206,
          storyNumber: '0000060',
          phase: 'opened',
          retryAttempt: 3,
          retryStepPath: [1],
        },
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

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

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      await startFlowRun({
        flowName: 'github-recovery-exhausted',
        conversationId,
        resumeStepPath: [0],
        source: 'REST',
        working_folder: tmpDir,
        chatFactory: () => new TrackingChat(),
        listIngestedRepositories: async () =>
          await listSingleRepository(tmpDir),
      });
      await waitFor(
        () => captured.some((message) => message.startsWith('Continued after review')),
        10000,
        25,
        () => describeResumeBackfillState(conversationId),
      );
      await waitFor(
        () => getLatestAssistantTurn(conversationId)?.status === 'warning',
        10000,
        25,
        () => describeResumeBackfillState(conversationId),
      );
      assert.match(
        getLatestAssistantTurn(conversationId)?.content ?? '',
        /Flow completed with warning:/,
      );
      const flow = memoryConversations.get(conversationId)?.flags?.flow as
        | {
            wait?: unknown;
            githubReviewContext?: { phase?: string; retryAttempt?: number };
          }
        | undefined;
      assert.equal(flow?.wait, undefined);
      assert.equal(flow?.githubReviewContext?.phase, 'skipped');
      assert.equal(flow?.githubReviewContext?.retryAttempt, 4);
    });
  } finally {
    const flow = memoryConversations.get(conversationId)?.flags?.flow as
      | { agentConversations?: Record<string, string> }
      | undefined;
    for (const childConversationId of Object.values(
      flow?.agentConversations ?? {},
    )) {
      memoryConversations.delete(childConversationId);
      memoryTurns.delete(childConversationId);
    }
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('ordinary failures after GitHub review do not acquire review retry ownership', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-github-recovery-boundary-'),
  );
  const conversationId = 'flow-github-recovery-boundary';
  await fs.writeFile(
    path.join(tmpDir, 'github-recovery-boundary.json'),
    JSON.stringify(
      {
        description: 'Keep ordinary failures outside GitHub recovery',
        steps: [
          { type: 'wait', label: 'Completed review wait', seconds: 60 },
          {
            type: 'llm',
            label: 'Ordinary post-review step',
            agentType: 'coding_agent',
            identifier: 'resume-test',
            messages: [{ role: 'user', content: ['Ordinary step fails'] }],
          },
        ],
      },
      null,
      2,
    ),
  );
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: github-recovery-boundary',
    flowName: 'github-recovery-boundary',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'github-recovery-boundary-execution',
        stepPath: [0],
        loopStack: [],
        agentConversations: {},
        agentThreads: {},
        workingFolder: tmpDir,
        githubReviewContext: {
          executionId: 'github-recovery-boundary-execution',
          prNumber: 206,
          storyNumber: '0000060',
          phase: 'fetched',
          retryAttempt: 0,
        },
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  class FailingChat extends ChatInterface {
    async execute(
      _message: string,
      _flags: Record<string, unknown>,
      childConversationId: string,
      _model: string,
    ) {
      void _model;
      this.emit('thread', { type: 'thread', threadId: childConversationId });
      this.emit('error', { type: 'error', message: 'ordinary failure' });
    }
  }

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      await startFlowRun({
        flowName: 'github-recovery-boundary',
        conversationId,
        resumeStepPath: [0],
        source: 'REST',
        working_folder: tmpDir,
        chatFactory: () => new FailingChat(),
        listIngestedRepositories: async () =>
          await listSingleRepository(tmpDir),
      });
      await waitFor(
        () => getLatestAssistantTurn(conversationId)?.status === 'failed',
        10000,
        25,
        () => describeResumeBackfillState(conversationId),
      );
      const flow = memoryConversations.get(conversationId)?.flags?.flow as
        | {
            wait?: { kind?: string };
            githubReviewContext?: { phase?: string; retryAttempt?: number };
          }
        | undefined;
      assert.equal(flow?.wait, undefined);
      assert.equal(flow?.githubReviewContext?.phase, 'fetched');
      assert.equal(flow?.githubReviewContext?.retryAttempt, 0);
    });
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('exhausted nested GitHub review recovery skips the marked review branch', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-github-recovery-scope-'),
  );
  const conversationId = 'flow-github-recovery-scope';
  const captured: string[] = [];
  await fs.mkdir(path.join(tmpDir, 'scripts'), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, 'scripts', 'yes.py'),
    'import json\nprint(json.dumps({"answer": "yes"}))\n',
  );
  await fs.writeFile(
    path.join(tmpDir, 'github-recovery-scope.json'),
    JSON.stringify(
      {
        description: 'Skip exhausted nested GitHub review work',
        steps: [
          { type: 'wait', label: 'Completed review wait', seconds: 60 },
          {
            type: 'if',
            label: 'Recoverable review scope',
            githubReviewRecovery: true,
            condition: 'scripts/yes.py',
            then: [
              {
                type: 'startLoop',
                steps: [
                  {
                    type: 'llm',
                    agentType: 'coding_agent',
                    identifier: 'resume-test',
                    messages: [
                      { role: 'user', content: ['Review step fails'] },
                    ],
                  },
                  {
                    type: 'llm',
                    agentType: 'coding_agent',
                    identifier: 'resume-test',
                    messages: [
                      { role: 'user', content: ['Review sibling must not run'] },
                    ],
                  },
                ],
              },
              {
                type: 'llm',
                agentType: 'coding_agent',
                identifier: 'resume-test',
                messages: [
                  { role: 'user', content: ['Review tail must not run'] },
                ],
              },
            ],
          },
          {
            type: 'llm',
            label: 'Continue after review scope',
            agentType: 'coding_agent',
            identifier: 'resume-test',
            messages: [{ role: 'user', content: ['After review scope'] }],
          },
        ],
      },
      null,
      2,
    ),
  );
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: github-recovery-scope',
    flowName: 'github-recovery-scope',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'github-recovery-scope-execution',
        stepPath: [0],
        loopStack: [],
        agentConversations: {},
        agentThreads: {},
        workingFolder: tmpDir,
        githubReviewContext: {
          executionId: 'github-recovery-scope-execution',
          prNumber: 206,
          storyNumber: '0000060',
          phase: 'fetched',
          retryAttempt: 3,
          retryStepPath: [1, 0, 0, 0],
        },
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  class ScopedRecoveryChat extends ChatInterface {
    async execute(
      message: string,
      _flags: Record<string, unknown>,
      childConversationId: string,
      _model: string,
    ) {
      void _model;
      captured.push(message);
      this.emit('thread', { type: 'thread', threadId: childConversationId });
      if (message.includes('Review step fails')) {
        this.emit('error', { type: 'error', message: 'review failure' });
        return;
      }
      this.emit('final', { type: 'final', content: 'ok' });
      this.emit('complete', {
        type: 'complete',
        threadId: childConversationId,
      });
    }
  }

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      await startFlowRun({
        flowName: 'github-recovery-scope',
        conversationId,
        resumeStepPath: [0],
        source: 'REST',
        working_folder: tmpDir,
        chatFactory: () => new ScopedRecoveryChat(),
        listIngestedRepositories: async () =>
          await listSingleRepository(tmpDir),
      });
      await waitFor(
        () => captured.some((message) => message.startsWith('After review scope')),
        10000,
        25,
        () => describeResumeBackfillState(conversationId),
      );
      assert.equal(
        captured.some((message) => message.startsWith('Review sibling must not run')),
        false,
      );
      assert.equal(
        captured.some((message) => message.startsWith('Review tail must not run')),
        false,
      );
      const flow = memoryConversations.get(conversationId)?.flags?.flow as
        | { githubReviewContext?: { phase?: string; retryAttempt?: number } }
        | undefined;
      assert.equal(flow?.githubReviewContext?.phase, 'skipped');
      assert.equal(flow?.githubReviewContext?.retryAttempt, 4);
    });
  } finally {
    const flow = memoryConversations.get(conversationId)?.flags?.flow as
      | { agentConversations?: Record<string, string> }
      | undefined;
    for (const childConversationId of Object.values(
      flow?.agentConversations ?? {},
    )) {
      memoryConversations.delete(childConversationId);
      memoryTurns.delete(childConversationId);
    }
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('a different failed GitHub review step starts with a fresh recovery budget', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-github-recovery-new-step-'),
  );
  const conversationId = 'flow-github-recovery-new-step';
  await fs.writeFile(
    path.join(tmpDir, 'github-recovery-new-step.json'),
    JSON.stringify(
      {
        description: 'Reset recovery for a different step',
        steps: [
          { type: 'wait', label: 'Completed review wait', seconds: 60 },
          { type: 'github_fetch_reviews', label: 'Fetch review' },
        ],
      },
      null,
      2,
    ),
  );
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: github-recovery-new-step',
    flowName: 'github-recovery-new-step',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'github-recovery-new-step-execution',
        stepPath: [0],
        loopStack: [],
        agentConversations: {},
        agentThreads: {},
        workingFolder: tmpDir,
        githubReviewContext: {
          executionId: 'github-recovery-new-step-execution',
          prNumber: 206,
          storyNumber: '0000060',
          phase: 'opened',
          retryAttempt: 3,
          retryStepPath: [99],
          warningMessage: 'A previous step failed temporarily.',
        },
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const wakes: Array<() => void> = [];
  __setFlowWaitResumeDepsForTests({
    scheduleWake: ({ onWake }) => {
      wakes.push(onWake);
      return { cancel: () => {} };
    },
  });

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      await startFlowRun({
        flowName: 'github-recovery-new-step',
        conversationId,
        resumeStepPath: [0],
        source: 'REST',
        working_folder: tmpDir,
        listIngestedRepositories: async () =>
          await listSingleRepository(tmpDir),
      });
      await waitFor(
        () => Boolean(getPersistedWaitState(conversationId)),
        10000,
        25,
        () => describeResumeBackfillState(conversationId),
      );
      const flow = memoryConversations.get(conversationId)?.flags?.flow as
        | {
            githubReviewContext?: {
              retryAttempt?: number;
              retryStepPath?: number[];
              phase?: string;
            };
            wait?: { kind?: string };
          }
        | undefined;
      assert.equal(flow?.wait?.kind, 'review_retry');
      assert.equal(flow?.githubReviewContext?.retryAttempt, 1);
      assert.deepEqual(flow?.githubReviewContext?.retryStepPath, [1]);
      assert.equal(flow?.githubReviewContext?.phase, 'opened');
      assert.equal(wakes.length, 1);
    });
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('a recovered GitHub review step clears its retry count and stale warning', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-github-recovery-cleared-'),
  );
  const conversationId = 'flow-github-recovery-cleared';
  await fs.writeFile(
    path.join(tmpDir, 'github-recovery-cleared.json'),
    JSON.stringify(
      {
        description: 'Clear recovered review bookkeeping',
        steps: [
          { type: 'wait', label: 'Completed review wait', seconds: 60 },
          {
            type: 'llm',
            label: 'Recovered review step',
            agentType: 'coding_agent',
            identifier: 'resume-test',
            messages: [{ role: 'user', content: ['Recovered review work'] }],
          },
          { type: 'wait', label: 'Inspect recovered state', seconds: 60 },
        ],
      },
      null,
      2,
    ),
  );
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: github-recovery-cleared',
    flowName: 'github-recovery-cleared',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'github-recovery-cleared-execution',
        stepPath: [0],
        loopStack: [],
        agentConversations: {},
        agentThreads: {},
        workingFolder: tmpDir,
        githubReviewContext: {
          executionId: 'github-recovery-cleared-execution',
          prNumber: 206,
          storyNumber: '0000060',
          phase: 'opened',
          retryAttempt: 2,
          retryStepPath: [1],
          warningMessage: 'Recovered scratch ownership warning.',
        },
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  class TrackingChat extends ChatInterface {
    async execute(
      _message: string,
      _flags: Record<string, unknown>,
      childConversationId: string,
      _model: string,
    ) {
      void _model;
      this.emit('thread', { type: 'thread', threadId: childConversationId });
      this.emit('final', { type: 'final', content: 'ok' });
      this.emit('complete', {
        type: 'complete',
        threadId: childConversationId,
      });
    }
  }
  __setFlowWaitResumeDepsForTests({
    scheduleWake: () => ({ cancel: () => {} }),
  });

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      await startFlowRun({
        flowName: 'github-recovery-cleared',
        conversationId,
        resumeStepPath: [0],
        source: 'REST',
        working_folder: tmpDir,
        chatFactory: () => new TrackingChat(),
        listIngestedRepositories: async () =>
          await listSingleRepository(tmpDir),
      });
      await waitFor(
        () => getPersistedWaitState(conversationId)?.stepPath?.[0] === 2,
        10000,
        25,
        () => describeResumeBackfillState(conversationId),
      );
      const flow = memoryConversations.get(conversationId)?.flags?.flow as
        | {
            githubReviewContext?: Record<string, unknown>;
            wait?: { githubReviewContext?: Record<string, unknown> };
          }
        | undefined;
      assert.equal(
        Object.hasOwn(flow?.githubReviewContext ?? {}, 'retryAttempt'),
        false,
      );
      assert.equal(
        Object.hasOwn(flow?.githubReviewContext ?? {}, 'retryStepPath'),
        false,
      );
      assert.equal(
        Object.hasOwn(flow?.githubReviewContext ?? {}, 'warningMessage'),
        false,
      );
      assert.deepEqual(
        flow?.wait?.githubReviewContext,
        flow?.githubReviewContext,
      );
    });
  } finally {
    const flow = memoryConversations.get(conversationId)?.flags?.flow as
      | { agentConversations?: Record<string, string> }
      | undefined;
    for (const childConversationId of Object.values(
      flow?.agentConversations ?? {},
    )) {
      memoryConversations.delete(childConversationId);
      memoryTurns.delete(childConversationId);
    }
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('wake-time run ownership collision does not restore wait state after the active run advances it', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-wait-resume-rearm-'),
  );
  await writeWaitResumeFlow(tmpDir);

  const conversationId = 'flow-wait-resume-rearm';
  const captured: string[] = [];
  const wakes: Array<() => void> = [];

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
    nowIso: () => '2026-06-27T20:00:00.000Z',
    scheduleWake: ({ onWake }) => {
      wakes.push(onWake);
      return { cancel: () => {} };
    },
  });

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      await startFlowRun({
        flowName: 'wait-resume',
        conversationId,
        source: 'REST',
        chatFactory: () => new TrackingChat(),
      });

      await waitFor(
        () => captured.length === 1,
        10000,
        50,
        () => describeResumeBackfillState(conversationId),
      );
      const initialWait = getPersistedWaitState(conversationId);
      assert.ok(initialWait);
      assert.equal(typeof initialWait.resumeAt, 'number');
      __setFlowWaitResumeDepsForTests({
        now: () => 1_700_000_001_000,
        nowIso: () => '2026-06-27T20:00:01.000Z',
        scheduleWake: ({ onWake }) => {
          wakes.push(onWake);
          return { cancel: () => {} };
        },
        resumeFlowRun: async () => {
          const conversation = memoryConversations.get(conversationId);
          assert.ok(conversation);
          const flow: Record<string, unknown> = {
            ...((conversation.flags?.flow ?? {}) as Record<string, unknown>),
            stepPath: [2],
          };
          delete flow.wait;
          memoryConversations.set(conversationId, {
            ...conversation,
            flags: { ...(conversation.flags ?? {}), flow },
            updatedAt: new Date(),
          });
          throw Object.assign(new Error('simulated active run ownership'), {
            code: 'RUN_IN_PROGRESS',
          });
        },
      });

      assert.ok(wakes.length > 0, 'expected initial wake to be scheduled');
      const initialWake = wakes.shift();
      assert.ok(initialWake, 'expected captured wake callback');
      initialWake();

      await waitFor(
        () => wakes.length > 0,
        10000,
        50,
        () => describeResumeBackfillState(conversationId),
      );
      assert.equal(getPersistedWaitState(conversationId), undefined);
      const flowState = memoryConversations.get(conversationId)?.flags?.flow as
        | { stepPath?: number[] }
        | undefined;
      assert.deepEqual(flowState?.stepPath, [2]);
    });
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('an older contested wake cannot cancel a newer persisted wait scheduler', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-wait-resume-newer-scheduler-'),
  );
  await writeWaitResumeFlow(tmpDir);
  const conversationId = 'flow-wait-resume-newer-scheduler';
  const scheduled: Array<{ onWake: () => void; cancelled: boolean }> = [];

  __setFlowWaitResumeDepsForTests({
    now: () => 1_700_000_000_000,
    nowIso: () => '2026-06-27T20:00:00.000Z',
    scheduleWake: ({ onWake }) => {
      const entry = { onWake, cancelled: false };
      scheduled.push(entry);
      return {
        cancel: () => {
          entry.cancelled = true;
        },
      };
    },
  });

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      await startFlowRun({
        flowName: 'wait-resume',
        conversationId,
        source: 'REST',
        chatFactory: () =>
          new (class extends ChatInterface {
            async execute(
              _message: string,
              _flags: Record<string, unknown>,
              childConversationId: string,
              _model: string,
            ) {
              void _model;
              this.emit('thread', {
                type: 'thread',
                threadId: childConversationId,
              });
              this.emit('final', { type: 'final', content: 'ok' });
              this.emit('complete', {
                type: 'complete',
                threadId: childConversationId,
              });
            }
          })(),
      });
      await waitFor(
        () => scheduled.length === 1,
        10000,
        25,
        () => describeResumeBackfillState(conversationId),
      );
      const initialWait = getPersistedWaitState(conversationId);
      assert.ok(initialWait);

      __setFlowWaitResumeDepsForTests({
        resumeFlowRun: async () => {
          const conversation = memoryConversations.get(conversationId);
          assert.ok(conversation);
          const flow = {
            ...((conversation.flags?.flow ?? {}) as Record<string, unknown>),
            stepPath: [2],
            wait: {
              executionId: initialWait.executionId,
              stepPath: [2],
              loopStack: [],
              resumeAt: 1_700_000_120_000,
            },
          };
          memoryConversations.set(conversationId, {
            ...conversation,
            flags: { ...(conversation.flags ?? {}), flow },
            updatedAt: new Date(),
          });
          await __resumePendingFlowWaitsForTests([conversationId]);
          throw Object.assign(new Error('simulated active run ownership'), {
            code: 'RUN_IN_PROGRESS',
          });
        },
      });

      scheduled[0]?.onWake();
      await waitFor(
        () => scheduled.length === 2,
        10000,
        25,
        () => describeResumeBackfillState(conversationId),
      );
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(scheduled.length, 2);
      assert.equal(scheduled[0]?.cancelled, true);
      assert.equal(scheduled[1]?.cancelled, false);
      assert.deepEqual(getPersistedWaitState(conversationId)?.stepPath, [2]);
    });
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startup recovery retires a persisted wait after a durable invalid-state contradiction instead of rearming it', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-wait-resume-invalid-state-'),
  );
  await writeWaitResumeFlow(tmpDir);

  const conversationId = 'flow-wait-resume-invalid-state';
  const captured: string[] = [];
  const wakes: Array<() => void> = [];

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
    nowIso: () => '2026-06-29T18:00:00.000Z',
    scheduleWake: ({ onWake }) => {
      wakes.push(onWake);
      return { cancel: () => {} };
    },
  });

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      await startFlowRun({
        flowName: 'wait-resume',
        conversationId,
        source: 'REST',
        chatFactory: () => new TrackingChat(),
      });

      await waitFor(
        () => captured.length === 1,
        10000,
        50,
        () => describeResumeBackfillState(conversationId),
      );
      await waitFor(
        () => Boolean(getPersistedWaitState(conversationId)),
        10000,
        50,
        () => describeResumeBackfillState(conversationId),
      );
      await waitFor(
        () => getActiveRunOwnership(conversationId) === null,
        10000,
        50,
        () => describeResumeBackfillState(conversationId),
      );

      await fs.writeFile(
        path.join(tmpDir, 'wait-resume.json'),
        JSON.stringify(
          {
            description: 'Wait resume backfill flow with removed wait step',
            steps: [
              {
                type: 'llm',
                label: 'Step 1',
                agentType: 'coding_agent',
                identifier: 'resume-test',
                messages: [{ role: 'user', content: ['Step 1'] }],
              },
            ],
          },
          null,
          2,
        ),
      );

      wakes.length = 0;
      await resumePendingFlowWaitsForStartup();
      assert.equal(
        wakes.length,
        1,
        'expected startup backfill wake to register',
      );

      const wake = wakes.shift();
      assert.ok(wake, 'expected captured wake callback');
      wake();

      await waitFor(
        () => getPersistedWaitState(conversationId) === undefined,
        10000,
        50,
        () => describeResumeBackfillState(conversationId),
      );
      await waitFor(
        () => getAssistantTurnCount(conversationId) >= 2,
        10000,
        50,
        () => describeResumeBackfillState(conversationId),
      );
      assert.equal(
        wakes.length,
        0,
        'permanent invalid state should retire the wait instead of rearming it',
      );

      const latestAssistantTurn = getLatestAssistantTurn(conversationId);
      assert.equal(latestAssistantTurn?.status, 'failed');
      assert.match(
        latestAssistantTurn?.content ?? '',
        /resumeStepPath out of range/i,
      );
    });
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startup recovery does not re-register malformed persisted wait state with an empty wait stepPath', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-wait-resume-malformed-'),
  );
  await writeWaitResumeFlow(tmpDir);

  const conversationId = 'flow-wait-resume-malformed';
  const wakes: Array<() => void> = [];

  __setFlowWaitResumeDepsForTests({
    scheduleWake: ({ onWake }) => {
      wakes.push(onWake);
      return { cancel: () => {} };
    },
  });

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: wait-resume',
    flowName: 'wait-resume',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'wait-execution-malformed',
        stepPath: [1],
        loopStack: [],
        wait: {
          executionId: 'wait-execution-malformed',
          stepPath: [],
          loopStack: [],
          resumeAt: 1_700_000_060_000,
        },
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
    await withFlowFixtureEnv(tmpDir, async () => {
      await resumePendingFlowWaitsForStartup();
      assert.equal(
        wakes.length,
        0,
        'malformed wait state should not be re-registered for wake',
      );
      assert.equal(getAssistantTurnCount(conversationId), 0);
    });
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startup recovery re-registers a first-step GitHub review retry with an empty resume cursor', async () => {
  const conversationId = 'flow-review-retry-from-start';
  const wakes: Array<() => void> = [];
  __setFlowWaitResumeDepsForTests({
    scheduleWake: ({ onWake }) => {
      wakes.push(onWake);
      return { cancel: () => {} };
    },
  });
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: review-retry-from-start',
    flowName: 'review-retry-from-start',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'review-retry-from-start-execution',
        stepPath: [],
        loopStack: [],
        wait: {
          kind: 'review_retry',
          executionId: 'review-retry-from-start-execution',
          stepPath: [],
          loopStack: [],
          resumeAt: 1_700_000_060_000,
          githubReviewContext: {
            executionId: 'review-retry-from-start-execution',
            prNumber: 42,
            phase: 'opened',
            retryAttempt: 1,
            retryStepPath: [0],
          },
        },
        githubReviewContext: {
          executionId: 'review-retry-from-start-execution',
          prNumber: 42,
          phase: 'opened',
          retryAttempt: 1,
          retryStepPath: [0],
        },
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
    assert.equal(await __resumePendingFlowWaitsForTests([conversationId]), 1);
    assert.equal(wakes.length, 1);
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  }
});

test('startup recovery returns a degraded result instead of throwing when wait registration fails before listen', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-wait-resume-startup-degraded-'),
  );
  await writeWaitResumeFlow(tmpDir);

  const conversationId = 'flow-wait-resume-startup-degraded';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: wait-resume',
    flowName: 'wait-resume',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'wait-execution-startup-degraded',
        stepPath: [1],
        loopStack: [],
        wait: {
          executionId: 'wait-execution-startup-degraded',
          stepPath: [2],
          loopStack: [],
          resumeAt: 1_700_000_060_000,
        },
        agentConversations: {},
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  __setFlowWaitResumeDepsForTests({
    nowIso: () => '2026-06-27T20:10:00.000Z',
    scheduleWake: () => {
      throw new Error('simulated startup registration failure');
    },
  });

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      const result = await resumePendingFlowWaitsForStartup();
      assert.equal(result.reachable, true);
      assert.equal(result.degraded, true);
      assert.equal(
        result.diagnosticEvent,
        FLOW_WAIT_STARTUP_RECOVERY_DEGRADED_EVENT,
      );
      assert.match(result.causeMessage, /startup registration failure/i);
      assert.equal(getAssistantTurnCount(conversationId), 0);
      assert.ok(getPersistedWaitState(conversationId));
    });
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
