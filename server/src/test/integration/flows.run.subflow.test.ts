import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { registerPendingConversationCancel } from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import {
  __resetProviderBootstrapStatusForTests,
  __setProviderBootstrapStatusForTests,
} from '../../config/runtimeConfig.js';
import { startFlowRun } from '../../flows/service.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { query } from '../../logStore.js';
import type { Conversation } from '../../mongo/conversation.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
  withDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import { createIsolatedProviderHomeEnv } from '../support/providerHomeHarness.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const execFile = promisify(execFileCb);

const buildRepoEntry = (containerPath: string): RepoEntry => ({
  id: path.posix.basename(containerPath.replace(/\\/g, '/')) || 'repo',
  description: null,
  containerPath,
  hostPath: containerPath,
  lastIngestAt: '2026-01-01T00:00:00.000Z',
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
});

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

    if (
      message.includes(
        'Answer with JSON only: {"answer":"yes"} or {"answer":"no"}.',
      )
    ) {
      this.emit('final', {
        type: 'final',
        content: '{"answer":"yes"}',
      });
      this.emit('complete', { type: 'complete', threadId: conversationId });
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
  timeoutMs = 20000,
  describe?: () => string,
): Promise<void> => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const started = Date.now();
  while (Date.now() - started < resolvedTimeoutMs) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error(
    describe
      ? `Timed out waiting for condition | ${describe()}`
      : 'Timed out waiting for condition',
  );
};

const waitForAssistantStatus = async (
  conversationId: string,
  status: 'ok' | 'warning' | 'failed' | 'stopped',
  timeoutMs = 20000,
  describe?: () => string,
) => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const started = Date.now();
  while (Date.now() - started < resolvedTimeoutMs) {
    const turns = memoryTurns.get(conversationId) ?? [];
    if (
      turns.some((turn) => turn.role === 'assistant' && turn.status === status)
    ) {
      break;
    }
    await delay(20);
  }
  const turns = memoryTurns.get(conversationId) ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role === 'assistant' && turn.status === status) {
      return turn;
    }
  }
  throw new Error(
    [
      `Timed out waiting for assistant status ${status} for ${conversationId}`,
      `conversationState=${describeConversationStateWithActiveSubflows(
        conversationId,
      )}`,
      `conversationGraph=${describeConversationGraph(conversationId, 3)}`,
      `runtimeLogs=${describeRelevantSubflowRuntimeLogs(conversationId)}`,
      ...(describe ? [`details=${describe()}`] : []),
    ].join(' | '),
  );
};

const waitForTerminalAssistantTurn = async (
  conversationId: string,
  timeoutMs = 20000,
  describe?: () => string,
) => {
  const terminalStatuses = new Set(['ok', 'warning', 'failed', 'stopped']);
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const started = Date.now();
  while (Date.now() - started < resolvedTimeoutMs) {
    const turns = memoryTurns.get(conversationId) ?? [];
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (
        turn?.role === 'assistant' &&
        terminalStatuses.has(String(turn.status))
      ) {
        return turn;
      }
    }
    await delay(20);
  }
  throw new Error(
    [
      `Timed out waiting for terminal assistant turn for ${conversationId}`,
      `conversationState=${describeConversationStateWithActiveSubflows(
        conversationId,
      )}`,
      `conversationGraph=${describeConversationGraph(conversationId, 3)}`,
      `runtimeLogs=${describeRelevantSubflowRuntimeLogs(conversationId)}`,
      ...(describe ? [`details=${describe()}`] : []),
    ].join(' | '),
  );
};

const describeConversationState = (conversationId: string): string =>
  JSON.stringify({
    flags: memoryConversations.get(conversationId)?.flags ?? null,
    recentTurns: (memoryTurns.get(conversationId) ?? [])
      .slice(-8)
      .map((turn) => ({
        role: turn.role,
        status: turn.status,
        content: turn.content,
      })),
  });

const describeConversationStateWithActiveSubflows = (
  conversationId: string,
): string => {
  const base = JSON.parse(describeConversationState(conversationId)) as {
    flags?: { flow?: { activeSubflows?: Array<{ conversationId?: string }> } };
  };
  const activeSubflows = base.flags?.flow?.activeSubflows ?? [];
  return JSON.stringify({
    ...base,
    activeSubflows: activeSubflows.map((subflow) => {
      const childConversationId =
        typeof subflow?.conversationId === 'string'
          ? subflow.conversationId
          : null;
      return {
        ...subflow,
        childState: childConversationId
          ? JSON.parse(describeConversationState(childConversationId))
          : null,
      };
    }),
  });
};

const describeConversationGraph = (
  conversationId: string,
  maxDepth = 2,
): string => {
  const buildNode = (
    currentConversationId: string,
    depth: number,
  ): Record<string, unknown> => {
    const base = JSON.parse(
      describeConversationState(currentConversationId),
    ) as {
      flags?: {
        flow?: { activeSubflows?: Array<{ conversationId?: string }> };
      };
    };
    const activeSubflows = base.flags?.flow?.activeSubflows ?? [];
    return {
      conversationId: currentConversationId,
      ...base,
      activeSubflows:
        depth >= maxDepth
          ? activeSubflows
          : activeSubflows.map((subflow) => {
              const childConversationId =
                typeof subflow?.conversationId === 'string'
                  ? subflow.conversationId
                  : null;
              return {
                ...subflow,
                childState: childConversationId
                  ? buildNode(childConversationId, depth + 1)
                  : null,
              };
            }),
    };
  };

  return JSON.stringify(buildNode(conversationId, 0));
};

const describeRelevantSubflowRuntimeLogs = (
  ...conversationIds: string[]
): string =>
  JSON.stringify(
    (() => {
      const conversationIdSet = new Set(conversationIds);
      const seen = new Set<string>();
      const runtimeLogs = query({ text: 'flows.test.' }, 400)
        .filter((entry) => {
          const entryConversationId = entry.context?.conversationId;
          return (
            conversationIdSet.has(String(entryConversationId)) &&
            (entry.message.startsWith('flows.test.start.') ||
              entry.message === 'flows.test.step_dispatch' ||
              entry.message.startsWith('flows.test.first_') ||
              entry.message.startsWith('flows.test.chat_factory_') ||
              entry.message.startsWith('flows.test.subflow_') ||
              entry.message.startsWith('flows.test.resume_state_') ||
              entry.message === 'flows.test.llm_step_completed' ||
              entry.message === 'flows.test.llm_step_state_advanced' ||
              entry.message === 'flows.test.llm_step_continue' ||
              entry.message === 'flows.test.next_step_dispatch_expected')
          );
        })
        .concat(query({ text: 'runtime.chat_config_lock_' }, 40))
        .filter((entry) => {
          const dedupeKey = `${entry.timestamp}|${entry.message}|${JSON.stringify(entry.context ?? null)}`;
          if (seen.has(dedupeKey)) {
            return false;
          }
          seen.add(dedupeKey);
          return true;
        })
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .slice(-120)
        .map((entry) => ({
          message: entry.message,
          context: entry.context,
        }));
      const runtimeResolutionLogs = query(
        { text: 'flows.test.runtime_resolution_' },
        120,
      )
        .filter((entry) =>
          conversationIdSet.has(String(entry.context?.conversationId)),
        )
        .map((entry) => ({
          message: entry.message,
          context: entry.context,
        }));
      const runtimeConfigLogs = query({ text: 'runtime.' }, 120)
        .filter(
          (entry) =>
            entry.message.startsWith('runtime.chat_config_') ||
            entry.message.startsWith('runtime.runtime_config_resolution_'),
        )
        .map((entry) => ({
          message: entry.message,
          context: entry.context,
        }));
      return {
        runtimeLogs,
        runtimeResolutionLogs,
        runtimeConfigLogs,
      };
    })(),
  );

const waitForActiveSubflows = async (conversationId: string) => {
  await waitFor(
    () => {
      const conversation = memoryConversations.get(conversationId);
      return Array.isArray(
        (
          conversation?.flags as
            | { flow?: { activeSubflows?: unknown } }
            | undefined
        )?.flow?.activeSubflows,
      );
    },
    10000,
    () =>
      `conversationId=${conversationId} | graph=${describeConversationGraph(
        conversationId,
        3,
      )} | runtimeLogs=${describeRelevantSubflowRuntimeLogs(conversationId)}`,
  );
  const conversation = memoryConversations.get(conversationId);
  return ((
    conversation?.flags as {
      flow?: { activeSubflows?: Record<string, unknown>[] };
    }
  )?.flow?.activeSubflows ?? []) as Record<string, unknown>[];
};

const waitForActiveSubflow = async (conversationId: string) => {
  const activeSubflows = await waitForActiveSubflows(conversationId);
  return activeSubflows[0] ?? null;
};

const waitForActiveSubflowCount = async (
  conversationId: string,
  expectedCount: number,
) => {
  await waitFor(
    () => {
      const conversation = memoryConversations.get(conversationId);
      const activeSubflows =
        (
          conversation?.flags as
            | { flow?: { activeSubflows?: unknown[] } }
            | undefined
        )?.flow?.activeSubflows ?? [];
      return (
        Array.isArray(activeSubflows) && activeSubflows.length === expectedCount
      );
    },
    10000,
    () =>
      `conversationId=${conversationId} expectedCount=${expectedCount} | graph=${describeConversationGraph(
        conversationId,
        3,
      )} | runtimeLogs=${describeRelevantSubflowRuntimeLogs(conversationId)}`,
  );
  return waitForActiveSubflows(conversationId);
};

const waitForConversationAssistantStatus = async (
  conversationId: string,
  status: 'ok' | 'warning' | 'failed' | 'stopped',
  timeoutMs = 10000,
) => {
  await waitFor(
    () => {
      const turns = memoryTurns.get(conversationId) ?? [];
      return turns.some(
        (turn) => turn.role === 'assistant' && turn.status === status,
      );
    },
    timeoutMs,
    () =>
      `conversationId=${conversationId} status=${status} | graph=${describeConversationGraph(
        conversationId,
        3,
      )} | runtimeLogs=${describeRelevantSubflowRuntimeLogs(conversationId)}`,
  );
};

const getChildConversationsFromActiveSubflows = (conversationId: string) => {
  const activeSubflows =
    (
      memoryConversations.get(conversationId)?.flags as
        | {
            flow?: {
              activeSubflows?: Array<{
                conversationId?: string;
                flowName?: string;
                title?: string;
              }>;
            };
          }
        | undefined
    )?.flow?.activeSubflows ?? [];
  return activeSubflows
    .filter(
      (
        subflow,
      ): subflow is {
        conversationId: string;
        flowName?: string;
        title?: string;
      } => typeof subflow?.conversationId === 'string',
    )
    .map((subflow) => {
      const childConversation = memoryConversations.get(subflow.conversationId);
      return {
        conversationId: subflow.conversationId,
        flowName: childConversation?.flowName ?? subflow.flowName,
        title: childConversation?.title ?? subflow.title,
      };
    });
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

const continueStep = (question: string) => ({
  type: 'continue' as const,
  agentType: 'planning_agent',
  identifier: 'planner',
  question,
  continueOn: 'yes' as const,
});

const subflowStep = (label: string, ...flowNames: string[]) => ({
  type: 'subflow' as const,
  label,
  flowNames,
});

const writeExecutable = async (filePath: string, content: string) => {
  await fs.writeFile(filePath, content, 'utf8');
  await fs.chmod(filePath, 0o755);
};

const codexReviewPointerPath = (
  repoDir: string,
  outputKey = 'current-codex-review',
) => path.join(repoDir, 'codeInfoTmp', 'reviews', `0000027-${outputKey}.json`);

const initializeCodexReviewRepo = async (repoDir: string) => {
  await fs.mkdir(repoDir, { recursive: true });
  await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
  await execFile('git', ['config', 'user.email', 'codex@example.com'], {
    cwd: repoDir,
  });
  await execFile('git', ['config', 'user.name', 'Codex Test'], {
    cwd: repoDir,
  });
  await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
  await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(repoDir, '.gitignore'),
    'codeInfoTmp/\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(repoDir, 'planning', '0000027-codex-review.md'),
    '# Story 27\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    JSON.stringify({
      plan_path: 'planning/0000027-codex-review.md',
      branched_from: 'main',
    }),
    'utf8',
  );
  await execFile('git', ['add', '.'], { cwd: repoDir });
  await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
  await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
    cwd: repoDir,
  });
};

const seedStaleCodexReviewPointer = async (repoDir: string) => {
  const pointerPath = codexReviewPointerPath(repoDir);
  await fs.mkdir(path.dirname(pointerPath), { recursive: true });
  await fs.writeFile(
    pointerPath,
    `${JSON.stringify(
      {
        story_id: '0000027',
        plan_path: 'planning/0000027-codex-review.md',
        codex_review_pass_id: 'stale-codex-review-pass',
        review_output_file: 'codeInfoTmp/reviews/stale-codex-review.md',
        status: 'completed',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return pointerPath;
};

const activeSubflowState = (params: {
  stepPath: number[];
  flowName: string;
  conversationId: string;
  runToken: string;
  title?: string;
}) => ({
  stepPath: params.stepPath,
  flowName: params.flowName,
  conversationId: params.conversationId,
  runToken: params.runToken,
  ...(params.title ? { title: params.title } : {}),
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

const findChildFlowConversations = (params: {
  parentConversationId: string;
  childFlowNames: string[];
}): Conversation[] =>
  Array.from(memoryConversations.values()).filter(
    (conversation) =>
      conversation._id !== params.parentConversationId &&
      Boolean(
        conversation.flowName &&
          params.childFlowNames.includes(conversation.flowName),
      ),
  );

let providerHomes: Awaited<
  ReturnType<typeof createIsolatedProviderHomeEnv>
> | null = null;
let previousAgentsHome: string | undefined;
let previousFlowsDir: string | undefined;
let previousProviderEnv = new Map<string, string | undefined>();

const withSubflowTestEnv = async <T>(
  tmpDir: string,
  run: () => Promise<T>,
): Promise<T> => {
  assert.ok(providerHomes, 'provider homes should be initialized before tests');
  return await runWithTestEnvOverrides(
    {
      CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
      ...providerHomes.envOverrides,
      FLOWS_DIR: tmpDir,
    },
    run,
  );
};

const startSubflowRun = async (
  tmpDir: string,
  params: Parameters<typeof startFlowRun>[0],
) => await withSubflowTestEnv(tmpDir, async () => await startFlowRun(params));

beforeEach(async () => {
  previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  previousFlowsDir = process.env.FLOWS_DIR;
  providerHomes = await createIsolatedProviderHomeEnv(
    'flow-subflow-provider-homes-',
  );
  previousProviderEnv = new Map(
    Object.keys(providerHomes.envOverrides).map((key) => [
      key,
      process.env[key],
    ]),
  );
  for (const [key, value] of Object.entries(providerHomes.envOverrides)) {
    if (value === undefined) {
      clearScopedTestEnvValue(key);
    } else {
      setScopedTestEnvValue(key, value);
    }
  }
  setScopedTestEnvValue(
    'CODEINFO_CODEX_AGENT_HOME',
    path.join(repoRoot, 'codex_agents'),
  );
  installDeterministicCodexAvailabilityBootstrap();
  memoryConversations.clear();
  memoryTurns.clear();
});

afterEach(async () => {
  resetDeterministicCodexAvailabilityBootstrap();
  __resetProviderBootstrapStatusForTests();
  for (const [key, value] of previousProviderEnv) {
    if (value === undefined) {
      clearScopedTestEnvValue(key);
    } else {
      setScopedTestEnvValue(key, value);
    }
  }
  previousProviderEnv.clear();
  if (previousAgentsHome === undefined) {
    clearScopedTestEnvValue('CODEINFO_CODEX_AGENT_HOME');
  } else {
    setScopedTestEnvValue('CODEINFO_CODEX_AGENT_HOME', previousAgentsHome);
  }
  if (previousFlowsDir === undefined) {
    clearScopedTestEnvValue('FLOWS_DIR');
  } else {
    setScopedTestEnvValue('FLOWS_DIR', previousFlowsDir);
  }
  await providerHomes?.cleanup();
  providerHomes = null;
  memoryConversations.clear();
  memoryTurns.clear();
});

test('subflow step launches a child flow, waits for completion, and uses the generated child title', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-subflow-ok-'));

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-ok',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-ok',
      steps: [subflowStep('Run Child', 'child-ok')],
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
          | { flow?: { activeSubflows?: unknown } }
          | undefined
      )?.flow?.activeSubflows,
      undefined,
    );
  } finally {
    resetDeterministicCodexAvailabilityBootstrap();
    installDeterministicCodexAvailabilityBootstrap();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow step launches multiple child flows in parallel and waits for all of them before continuing', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-parallel-ok-'),
  );
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-fast',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-slow',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-parallel',
      steps: [subflowStep('Run Child Batch', 'child-fast', 'child-slow')],
    });

    const result = await startFlowRun({
      flowName: 'parent-parallel',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(140),
    });

    const activeSubflows = await waitForActiveSubflowCount(
      result.conversationId,
      2,
    );
    assert.equal(activeSubflows.length, 2);

    const childConversations = findChildFlowConversations({
      parentConversationId: result.conversationId,
      childFlowNames: ['child-fast', 'child-slow'],
    });
    assert.equal(childConversations.length, 2);
    assert.equal(
      childConversations.some(
        (conversation) =>
          conversation.title === 'Parent Review-Run Child Batch-child-fast',
      ),
      true,
    );
    assert.equal(
      childConversations.some(
        (conversation) =>
          conversation.title === 'Parent Review-Run Child Batch-child-slow',
      ),
      true,
    );

    const fastChild = childConversations.find(
      (conversation) => conversation.flowName === 'child-fast',
    );
    const slowChild = childConversations.find(
      (conversation) => conversation.flowName === 'child-slow',
    );
    assert.ok(fastChild?._id);
    assert.ok(slowChild?._id);

    await waitForConversationAssistantStatus(String(fastChild?._id), 'ok');
    await delay(40);
    const parentTurnsBeforeSlowChildCompletes =
      memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      parentTurnsBeforeSlowChildCompletes.some(
        (turn) => turn.role === 'assistant',
      ),
      false,
    );

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'ok',
    );
    assert.equal(
      finalAssistant?.content,
      'Completed subflows Parent Review-Run Child Batch-child-fast, Parent Review-Run Child Batch-child-slow',
    );

    const parentTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.ok(
      parentTurns.some(
        (turn) =>
          turn.role === 'user' &&
          turn.content === 'Run subflows child-fast, child-slow',
      ),
    );
    const parentConversation = memoryConversations.get(result.conversationId);
    assert.equal(
      (
        parentConversation?.flags as
          | { flow?: { activeSubflows?: unknown } }
          | undefined
      )?.flow?.activeSubflows,
      undefined,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow forwards codexReviewModelId into child flows so codex_review can run with a parent-supplied model override', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-codex-model-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    setScopedTestEnvValue(
      'PATH',
      `${binDir}${path.delimiter}${previousPath ?? ''}`,
    );

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      '# Story 27\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );

    await writeFlowFile({
      tmpDir,
      flowName: 'codex-child',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          reasoningEffort: 'medium',
        },
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-codex-subflow',
      steps: [subflowStep('Run Codex Review Child', 'codex-child')],
    });

    const result = await startFlowRun({
      flowName: 'parent-codex-subflow',
      source: 'REST',
      working_folder: repoDir,
      codexReviewModelId: 'gpt-5.4',
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitForAssistantStatus(result.conversationId, 'ok');

    const pointerPath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-codex-review.json',
    );
    const pointer = JSON.parse(await fs.readFile(pointerPath, 'utf8')) as {
      model?: string;
      reasoning_effort?: string | null;
      merged_into_canonical_findings?: boolean;
    };

    assert.equal(pointer.model, 'gpt-5.4');
    assert.equal(pointer.reasoning_effort, 'medium');
    assert.equal(pointer.merged_into_canonical_findings, false);
  } finally {
    setScopedTestEnvValue('PATH', previousPath);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume skips validating a completed codexReview step when resuming at the next step', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-resume-validation-'),
  );
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'resume-codex-review',
      steps: [
        {
          type: 'codexReview',
          label: 'Completed Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
        },
        llmStep('after resumed codex review'),
      ],
    });

    const conversationId = 'resume-codex-review-conversation';
    const now = new Date();
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Codex Review',
      flowName: 'resume-codex-review',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-codex-review-execution',
          stepPath: [0],
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

    const executions: string[] = [];
    const resumed = await startFlowRun({
      flowName: 'resume-codex-review',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
    });

    assert.equal(resumed.conversationId, conversationId);
    await waitForAssistantStatus(conversationId, 'ok');
    assert.deepEqual(executions, ['after resumed codex review']);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('codexReview ignores a stale pending cancel that belongs to a different run token', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-stale-pending-cancel-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    setScopedTestEnvValue(
      'PATH',
      `${binDir}${path.delimiter}${previousPath ?? ''}`,
    );

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      '# Story 27\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );

    await writeFlowFile({
      tmpDir,
      flowName: 'codex-stale-pending-cancel',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
        },
      ],
    });

    const result = await startFlowRun({
      flowName: 'codex-stale-pending-cancel',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
      onOwnershipReady: ({ conversationId, runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken: `${runToken}-stale`,
        });
      },
    });

    await waitForAssistantStatus(result.conversationId, 'ok');
    const pointerPath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-codex-review.json',
    );
    assert.equal(existsSync(pointerPath), true);
  } finally {
    setScopedTestEnvValue('PATH', previousPath);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('prepareReviewBase consumes a pending cancel before starting review-base git work', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-prepare-review-base-pending-cancel-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await fs.mkdir(repoDir, { recursive: true });

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      '# Story 27\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeFlowFile({
      tmpDir,
      flowName: 'prepare-review-base-stop',
      steps: [
        {
          type: 'prepareReviewBase',
          label: 'Prepare Shared Review Base',
          outputKey: 'current-review-base',
          basePolicy: 'branched_from_or_default_if_merged',
        },
      ],
    });

    const result = await startFlowRun({
      flowName: 'prepare-review-base-stop',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
      onOwnershipReady: ({ conversationId, runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken,
        });
      },
    });

    await waitForAssistantStatus(result.conversationId, 'stopped');
    assert.equal(
      existsSync(
        path.join(
          repoDir,
          'codeInfoTmp',
          'reviews',
          '0000027-current-review-base.json',
        ),
      ),
      false,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('sourceId-only launches support prepareReviewBase and codexReview without working_folder', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-sourceid-review-steps-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const repoFlowsDir = path.join(repoDir, 'flows');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  const previousFlowsDir = process.env.FLOWS_DIR;
  setScopedTestEnvValue('FLOWS_DIR', path.join(tmpDir, 'local-flows-unused'));

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(repoFlowsDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    setScopedTestEnvValue(
      'PATH',
      `${binDir}${path.delimiter}${previousPath ?? ''}`,
    );

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      '# Story 27\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );

    await fs.writeFile(
      path.join(repoFlowsDir, 'sourceid-review.json'),
      JSON.stringify({
        steps: [
          {
            type: 'prepareReviewBase',
            label: 'Prepare Shared Review Base',
            outputKey: 'current-review-base',
            basePolicy: 'branched_from_or_default_if_merged',
          },
          {
            type: 'codexReview',
            label: 'Run Codex Review',
            outputKey: 'current-codex-review',
            basePolicy: 'branched_from_or_default_if_merged',
            modelSource: 'flow_request_or_step',
            reasoningEffort: 'medium',
          },
        ],
      }),
      'utf8',
    );

    const result = await startFlowRun({
      flowName: 'sourceid-review',
      source: 'REST',
      sourceId: repoDir,
      codexReviewModelId: 'gpt-5.4',
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    assert.equal(result.providerId, 'codex');
    assert.equal(result.modelId, 'gpt-5.4');
    await waitForAssistantStatus(result.conversationId, 'ok');
    const preparedBasePath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-review-base.json',
    );
    const pointerPath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-codex-review.json',
    );
    await waitFor(() => existsSync(preparedBasePath));
    await waitFor(() => existsSync(pointerPath));
    assert.equal(existsSync(preparedBasePath), true);
    assert.equal(existsSync(pointerPath), true);
  } finally {
    setScopedTestEnvValue('PATH', previousPath);
    if (previousFlowsDir === undefined) {
      clearScopedTestEnvValue('FLOWS_DIR');
    } else {
      setScopedTestEnvValue('FLOWS_DIR', previousFlowsDir);
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('local review-git flows fail instead of silently targeting the harness repo', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-local-review-base-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const previousPreferredAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;

  try {
    await fs.mkdir(path.join(repoDir, 'flows'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repoDir, 'codeinfo_agents'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codex_agents'), { recursive: true });
    setScopedTestEnvValue(
      'CODEINFO_AGENT_HOME',
      path.join(repoDir, 'codeinfo_agents'),
    );
    setScopedTestEnvValue(
      'CODEINFO_CODEX_AGENT_HOME',
      path.join(repoDir, 'codex_agents'),
    );
    setScopedTestEnvValue('FLOWS_DIR', path.join(repoDir, 'flows'));

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      '# Story 27\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'flows', 'local-review-base.json'),
      JSON.stringify({
        description: 'Local review base',
        steps: [
          {
            type: 'prepareReviewBase',
            label: 'Prepare Shared Review Base',
            outputKey: 'current-review-base',
            basePolicy: 'branched_from_or_default_if_merged',
          },
        ],
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    const result = await startFlowRun({
      flowName: 'local-review-base',
      source: 'REST',
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    assert.ok(result.conversationId);
    await waitForAssistantStatus(result.conversationId, 'failed', 15_000);
    assert.equal(
      existsSync(
        path.join(
          repoDir,
          'codeInfoTmp',
          'reviews',
          '0000027-current-review-base.json',
        ),
      ),
      false,
    );
  } finally {
    if (previousPreferredAgentHome === undefined) {
      clearScopedTestEnvValue('CODEINFO_AGENT_HOME');
    } else {
      setScopedTestEnvValue('CODEINFO_AGENT_HOME', previousPreferredAgentHome);
    }
    if (previousAgentHome === undefined) {
      clearScopedTestEnvValue('CODEINFO_CODEX_AGENT_HOME');
    } else {
      setScopedTestEnvValue('CODEINFO_CODEX_AGENT_HOME', previousAgentHome);
    }
    if (previousFlowsDir === undefined) {
      clearScopedTestEnvValue('FLOWS_DIR');
    } else {
      setScopedTestEnvValue('FLOWS_DIR', previousFlowsDir);
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test(
  'parent flows continue best-effort when child codexReview work is unavailable',
  { concurrency: false },
  async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'flow-subflow-codex-preflight-'),
    );
    setScopedTestEnvValue('FLOWS_DIR', tmpDir);

    try {
      await writeFlowFile({
        tmpDir,
        flowName: 'child-codex-review',
        steps: [
          {
            type: 'codexReview',
            label: 'Run Codex Review',
            outputKey: 'current-codex-review',
            basePolicy: 'branched_from_or_default_if_merged',
            modelSource: 'flow_request_or_step',
            model: 'gpt-5.4',
            reasoningEffort: 'medium',
          },
        ],
      });
      await writeFlowFile({
        tmpDir,
        flowName: 'parent-preflight',
        steps: [
          subflowStep('Run Codex Review Child', 'child-codex-review'),
          llmStep('parent after unavailable child codex review'),
        ],
      });

      __setProviderBootstrapStatusForTests('codex', {
        healthy: false,
        reason: 'codex unavailable for parent preflight',
        warnings: [],
      });

      const executions: string[] = [];
      const result = await startFlowRun({
        flowName: 'parent-preflight',
        source: 'REST',
        working_folder: repoRoot,
        chatFactory: () =>
          new SubflowChat(25, ({ message }) => {
            executions.push(message);
          }),
        listIngestedRepositories: async () => ({
          repos: [buildRepoEntry(repoRoot)],
          lockedModelId: null,
        }),
      });
      await waitFor(() =>
        executions.includes('parent after unavailable child codex review'),
      );
      await waitForAssistantStatus(result.conversationId, 'ok');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  },
);

test('parent flows continue best-effort when child codexReview model requirements are missing', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-codex-model-validation-'),
  );
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-codex-review-missing-model',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
        },
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-codex-model-validation',
      steps: [
        subflowStep(
          'Run Codex Review Child',
          'child-codex-review-missing-model',
        ),
        llmStep('parent after child codex model skip'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-codex-model-validation',
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });
    await waitFor(() =>
      executions.includes('parent after child codex model skip'),
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parent flows continue best-effort when child command steps are invalid', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-command-validation-'),
  );
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-command-validation',
      steps: [
        {
          type: 'command',
          label: 'Missing Child Command',
          agentType: 'planning_agent',
          identifier: 'planner',
          commandName: 'missing-child-command',
        },
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-command-validation',
      steps: [
        subflowStep('Run Child Command', 'child-command-validation'),
        llmStep('parent after child command failure'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-command-validation',
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });
    await waitFor(() =>
      executions.includes('parent after child command failure'),
    );
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('best effort: 0 succeeded, 1 failed'),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume skips validating child subflow commands that are already behind resumeStepPath', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-command-resume-validation-'),
  );
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-command-resume-validation',
      steps: [
        {
          type: 'command',
          label: 'Removed Child Command',
          agentType: 'planning_agent',
          identifier: 'planner',
          commandName: 'missing-child-command',
        },
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-command-resume-validation',
      steps: [
        subflowStep(
          'Completed Child Command',
          'child-command-resume-validation',
        ),
        llmStep('after resumed child subflow'),
      ],
    });

    const conversationId = 'resume-child-command-validation-conversation';
    const now = new Date();
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Child Command Validation',
      flowName: 'parent-command-resume-validation',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-child-command-validation-execution',
          stepPath: [0],
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

    const executions: string[] = [];
    const resumed = await startFlowRun({
      flowName: 'parent-command-resume-validation',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });

    assert.equal(resumed.conversationId, conversationId);
    await waitForAssistantStatus(conversationId, 'ok');
    assert.deepEqual(executions, ['after resumed child subflow']);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resumed flows reuse persisted codexReviewModelId for pending codexReview steps', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-resume-codex-model-id-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    setScopedTestEnvValue(
      'PATH',
      `${binDir}${path.delimiter}${previousPath ?? ''}`,
    );

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      '# Story 27\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );

    await writeFlowFile({
      tmpDir,
      flowName: 'resume-pending-codex-model',
      steps: [
        llmStep('before review'),
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          reasoningEffort: 'medium',
        },
      ],
    });

    const conversationId = 'resume-pending-codex-model-conversation';
    const now = new Date();
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Pending Codex Model',
      flowName: 'resume-pending-codex-model',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-pending-codex-model-execution',
          stepPath: [0],
          loopStack: [],
          codexReviewModelId: 'gpt-5.4',
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
      flowName: 'resume-pending-codex-model',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    assert.equal(resumed.conversationId, conversationId);
    await waitForAssistantStatus(conversationId, 'ok');
    const pointerPath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-codex-review.json',
    );
    await waitFor(() => existsSync(pointerPath));
    const pointer = JSON.parse(await fs.readFile(pointerPath, 'utf8')) as {
      model: string;
    };
    assert.equal(pointer.model, 'gpt-5.4');
  } finally {
    setScopedTestEnvValue('PATH', previousPath);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('flow step-boundary persistence keeps request-scoped codexReviewModelId', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-runtime-codex-model-persist-'),
  );
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'persist-requested-codex-model',
      steps: [llmStep('before review')],
    });

    const result = await startFlowRun({
      flowName: 'persist-requested-codex-model',
      source: 'REST',
      working_folder: repoRoot,
      codexReviewModelId: 'gpt-5.4',
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });

    await waitForAssistantStatus(result.conversationId, 'ok');
    const flowState = (
      memoryConversations.get(result.conversationId)?.flags as
        | { flow?: { codexReviewModelId?: string } }
        | undefined
    )?.flow;
    assert.equal(flowState?.codexReviewModelId, 'gpt-5.4');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test(
  'resumed flows continue best-effort for later Codex work after resuming inside loops',
  { concurrency: false },
  async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'flow-resume-loop-codex-preflight-'),
    );
    setScopedTestEnvValue('FLOWS_DIR', tmpDir);

    try {
      await writeFlowFile({
        tmpDir,
        flowName: 'child-codex-review',
        steps: [
          {
            type: 'codexReview',
            label: 'Run Codex Review',
            outputKey: 'current-codex-review',
            basePolicy: 'branched_from_or_default_if_merged',
            modelSource: 'flow_request_or_step',
            model: 'gpt-5.4',
            reasoningEffort: 'medium',
          },
        ],
      });
      await writeFlowFile({
        tmpDir,
        flowName: 'resume-loop-parent',
        steps: [
          {
            type: 'startLoop',
            label: 'Outer Loop',
            steps: [llmStep('loop step')],
          },
          subflowStep('Run Codex Review Child', 'child-codex-review'),
        ],
      });

      const conversationId = 'resume-loop-parent-conversation';
      const now = new Date();
      memoryConversations.set(conversationId, {
        _id: conversationId,
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        title: 'Resume Loop Parent',
        flowName: 'resume-loop-parent',
        source: 'REST',
        flags: {
          flow: {
            executionId: 'resume-loop-parent-execution',
            stepPath: [0, 0],
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

      __setProviderBootstrapStatusForTests('codex', {
        healthy: false,
        reason: 'codex unavailable for resume loop preflight',
        warnings: [],
      });

      const result = await startFlowRun({
        flowName: 'resume-loop-parent',
        conversationId,
        resumeStepPath: [0, 0],
        source: 'REST',
        working_folder: repoRoot,
        chatFactory: () => new SubflowChat(25),
        listIngestedRepositories: async () => ({
          repos: [buildRepoEntry(repoRoot)],
          lockedModelId: null,
        }),
      });
      assert.equal(result.conversationId, conversationId);
      await waitForAssistantStatus(conversationId, 'ok');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  },
);

test('prepareReviewBase can precede a parallel review subflow batch on the shared checkout', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-review-base-parallel-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    setScopedTestEnvValue(
      'PATH',
      `${binDir}${path.delimiter}${previousPath ?? ''}`,
    );

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      '# Story 27\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );

    await writeFlowFile({
      tmpDir,
      flowName: 'child-slow-review',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'codex-child-review',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          reasoningEffort: 'medium',
        },
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-shared-review-base',
      steps: [
        {
          type: 'prepareReviewBase',
          label: 'Prepare Shared Review Base',
          outputKey: 'current-review-base',
          basePolicy: 'branched_from_or_default_if_merged',
        },
        subflowStep(
          'Run Review Batch',
          'child-slow-review',
          'codex-child-review',
        ),
      ],
    });

    const result = await startFlowRun({
      flowName: 'parent-shared-review-base',
      customTitle: 'Parent Review',
      source: 'REST',
      working_folder: repoDir,
      codexReviewModelId: 'gpt-5.4',
      chatFactory: () => new SubflowChat(140),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitForActiveSubflowCount(result.conversationId, 2);

    const basePath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-review-base.json',
    );
    const pointerPath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-codex-review.json',
    );
    await waitFor(() => existsSync(pointerPath));
    await waitForAssistantStatus(result.conversationId, 'ok');
    const preparedBase = JSON.parse(await fs.readFile(basePath, 'utf8')) as {
      comparison_base_ref?: string;
    };
    const pointer = JSON.parse(await fs.readFile(pointerPath, 'utf8')) as {
      comparison_base_ref?: string;
      model?: string;
      reasoning_effort?: string | null;
    };

    assert.equal(preparedBase.comparison_base_ref, 'main');
    assert.equal(pointer.comparison_base_ref, 'main');
    assert.equal(pointer.model, 'gpt-5.4');
    assert.equal(pointer.reasoning_effort, 'medium');
  } finally {
    setScopedTestEnvValue('PATH', previousPath);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parent step after a successful codexReview gets a fresh inflight id', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-inflight-rotation-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    setScopedTestEnvValue(
      'PATH',
      `${binDir}${path.delimiter}${previousPath ?? ''}`,
    );

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      '# Story 27\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );

    await writeFlowFile({
      tmpDir,
      flowName: 'codex-then-llm',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
        },
        llmStep('parent after codex review'),
      ],
    });

    const executions: Array<{
      message: string;
      conversationId: string;
      inflightId: string | null;
    }> = [];
    const result = await startFlowRun({
      flowName: 'codex-then-llm',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message, flags, conversationId }) => {
          executions.push({
            message,
            conversationId,
            inflightId:
              typeof flags.inflightId === 'string' ? flags.inflightId : null,
          });
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitFor(() => executions.length === 1);
    await waitForAssistantStatus(result.conversationId, 'ok');

    const followUpExecution = executions[0];
    assert.ok(followUpExecution);
    assert.equal(followUpExecution?.message, 'parent after codex review');
    assert.equal(typeof followUpExecution?.inflightId, 'string');
    assert.notEqual(followUpExecution?.inflightId, result.inflightId);
  } finally {
    setScopedTestEnvValue('PATH', previousPath);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('codexReview steps skip cleanly when Codex is unavailable and later parent steps still run', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-skip-unavailable-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await initializeCodexReviewRepo(repoDir);
    await writeFlowFile({
      tmpDir,
      flowName: 'codex-skip-then-llm',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
        },
        llmStep('parent after skipped codex review'),
      ],
    });
    const pointerPath = await seedStaleCodexReviewPointer(repoDir);

    __setProviderBootstrapStatusForTests('codex', {
      healthy: false,
      reason: 'codex unavailable for direct skip',
      warnings: [],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'codex-skip-then-llm',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitFor(() =>
      executions.includes('parent after skipped codex review'),
    );
    assert.equal(existsSync(pointerPath), false);
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('Codex review skipped.') &&
          String(turn.content).includes('codex unavailable for direct skip'),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('codexReview steps skip cleanly when no review model can be resolved and later parent steps still run', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-skip-missing-model-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await initializeCodexReviewRepo(repoDir);
    await writeFlowFile({
      tmpDir,
      flowName: 'codex-missing-model-then-llm',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
        },
        llmStep('parent after skipped missing-model codex review'),
      ],
    });
    const pointerPath = await seedStaleCodexReviewPointer(repoDir);

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'codex-missing-model-then-llm',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitFor(() =>
      executions.includes('parent after skipped missing-model codex review'),
    );
    assert.equal(existsSync(pointerPath), false);
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('Codex review skipped.') &&
          String(turn.content).includes(
            'codexReview requires codexReviewModelId or a model on the flow step.',
          ),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('codexReview clears a stale pointer when the Codex run fails and later parent steps still run', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-skip-failing-run-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  setScopedTestEnvValue('FLOWS_DIR', tmpDir);

  try {
    await initializeCodexReviewRepo(repoDir);
    await fs.mkdir(binDir, { recursive: true });
    setScopedTestEnvValue(
      'PATH',
      `${binDir}${path.delimiter}${previousPath ?? ''}`,
    );
    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
echo "codex failed" >&2
exit 1
`,
    );
    await writeFlowFile({
      tmpDir,
      flowName: 'codex-failing-run-then-llm',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
        },
        llmStep('parent after failed codex review'),
      ],
    });
    const pointerPath = await seedStaleCodexReviewPointer(repoDir);

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'codex-failing-run-then-llm',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitFor(() =>
      executions.includes('parent after failed codex review'),
    );
    assert.equal(existsSync(pointerPath), false);
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('Codex review skipped.'),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    setScopedTestEnvValue('PATH', previousPath);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parallel subflow waits for every child and continues best-effort when one child fails', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-parallel-fail-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-fast-fail',
      steps: [llmStep('child fail')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-slow-success',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-parallel-fail',
      steps: [
        subflowStep(
          'Run Failure Batch',
          'child-fast-fail',
          'child-slow-success',
        ),
        llmStep('parent after best-effort subflow batch'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-parallel-fail',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(140, ({ message }) => {
          executions.push(message);
        }),
    });

    const activeSubflows = await waitForActiveSubflowCount(
      result.conversationId,
      2,
    );
    assert.equal(activeSubflows.length, 2);
    const childConversations = getChildConversationsFromActiveSubflows(
      result.conversationId,
    );
    const slowChild = childConversations.find(
      (conversation) => conversation.flowName === 'child-slow-success',
    );
    assert.ok(slowChild?.conversationId);
    await waitForConversationAssistantStatus(slowChild!.conversationId, 'ok');

    await waitFor(() =>
      executions.includes('parent after best-effort subflow batch'),
    );
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('best effort: 1 succeeded, 1 failed'),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('nested subflows track only direct children per conversation and still complete recursively', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-nested-parallel-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'grandchild-ok',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-nested',
      steps: [subflowStep('Run Grandchild', 'grandchild-ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-direct',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-nested',
      steps: [subflowStep('Run Child Batch', 'child-nested', 'child-direct')],
    });

    const result = await startSubflowRun(tmpDir, {
      flowName: 'parent-nested',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(140),
    });

    await waitForAssistantStatus(result.conversationId, 'ok', 10000, () =>
      describeConversationGraph(result.conversationId, 3),
    );

    const nestedChild = findChildFlowConversation({
      parentConversationId: result.conversationId,
      childFlowName: 'child-nested',
    });
    assert.ok(nestedChild?._id);

    const directChild = findChildFlowConversation({
      parentConversationId: result.conversationId,
      childFlowName: 'child-direct',
    });
    assert.ok(directChild?._id);

    const grandchild = findChildFlowConversation({
      parentConversationId: String(nestedChild?._id),
      childFlowName: 'grandchild-ok',
    });
    assert.ok(grandchild?._id);

    const nestedFlags = memoryConversations.get(String(nestedChild?._id))
      ?.flags as { flow?: { activeSubflows?: unknown } } | undefined;
    assert.equal(nestedFlags?.flow?.activeSubflows, undefined);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parent step after a successful subflow gets a fresh inflight id', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-inflight-rotation-'),
  );

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
        subflowStep('Run Child', 'child-ok'),
        llmStep('parent after subflow'),
      ],
    });

    const executions: Array<{
      message: string;
      conversationId: string;
      inflightId: string | null;
    }> = [];
    const result = await startSubflowRun(tmpDir, {
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

test('subflow step keeps the parent flow running when a single child fails', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-subflow-fail-'));

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
        subflowStep('Run Broken Child', 'child-fail'),
        llmStep('parent after failed child'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-fail',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(150, ({ message }) => {
          executions.push(message);
        }),
    });

    await waitFor(() => executions.includes('parent after failed child'));
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('best effort: 0 succeeded, 1 failed'),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow waits for the full child flow and still continues best-effort after a later child failure', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-fail-later-'),
  );

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
        subflowStep('Run Later Failure', 'child-fail-later'),
        llmStep('parent after later child failure'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-fail-later',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(160, ({ message }) => {
          executions.push(message);
        }),
    });

    const activeSubflow = await waitForActiveSubflow(result.conversationId);
    assert.equal(activeSubflow?.flowName, 'child-fail-later');
    const childConversationId = String(activeSubflow?.conversationId ?? '');
    assert.notEqual(childConversationId, '');
    await waitForConversationAssistantStatus(childConversationId, 'ok');
    await delay(40);
    const parentTurnsWhileChildContinues =
      memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      parentTurnsWhileChildContinues.some((turn) => turn.role === 'assistant'),
      false,
    );

    await waitFor(() =>
      executions.includes('parent after later child failure'),
    );
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('best effort: 0 succeeded, 1 failed'),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow continues best-effort when the child crashes after a prior successful step', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-stale-ok-crash-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-crash-after-ok',
      steps: [llmStep('child ok'), continueStep('Keep going?')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-crash-after-ok',
      steps: [
        subflowStep('Run Crashing Child', 'child-crash-after-ok'),
        llmStep('parent after crashing child'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-crash-after-ok',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(100, ({ message }) => {
          executions.push(message);
        }),
    });

    await waitFor(() => executions.includes('parent after crashing child'));
    await waitForAssistantStatus(result.conversationId, 'ok');

    const childConversation = findChildFlowConversation({
      parentConversationId: result.conversationId,
      childFlowName: 'child-crash-after-ok',
    });
    assert.ok(childConversation?._id);

    const childTurns = memoryTurns.get(String(childConversation?._id)) ?? [];
    const latestChildAssistant = [...childTurns]
      .reverse()
      .find((turn) => turn.role === 'assistant');
    assert.equal(
      latestChildAssistant?.status,
      'failed',
      'child crash should persist a terminal failed assistant turn',
    );
    assert.equal(
      latestChildAssistant?.content,
      'A continue step was reached outside of a startLoop context.',
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow keeps the parent running when child flows reference each other recursively', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-recursive-cycle-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-cycle-b',
      steps: [subflowStep('Back To Parent', 'parent-cycle-a')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-cycle-a',
      steps: [
        subflowStep('Run Child', 'child-cycle-b'),
        llmStep('parent after recursive child failure'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-cycle-a',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(100, ({ message }) => {
          executions.push(message);
        }),
    });

    await waitFor(() =>
      executions.includes('parent after recursive child failure'),
    );
    await waitForAssistantStatus(result.conversationId, 'ok');

    const childConversation = findChildFlowConversation({
      parentConversationId: result.conversationId,
      childFlowName: 'child-cycle-b',
    });
    assert.ok(childConversation?._id);

    const childTurns = memoryTurns.get(String(childConversation?._id)) ?? [];
    const latestChildAssistant = [...childTurns]
      .reverse()
      .find((turn) => turn.role === 'assistant');
    assert.equal(latestChildAssistant?.status, 'ok');

    const childCycleConversations = Array.from(memoryConversations.values())
      .filter((conversation) => conversation.flowName === 'parent-cycle-a')
      .map((conversation) => conversation._id);
    assert.deepEqual(childCycleConversations, [result.conversationId]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('stopping the parent flow stops the running child subflow', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-subflow-stop-'));
  let releaseBlockedChild = false;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-slow',
      steps: [llmStep('child ok'), llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stop',
      steps: [subflowStep('Run Slow Child', 'child-slow')],
    });

    let parentRunToken: string | undefined;
    const parentConversationId = 'parent-stop-conversation';
    let stopRegisteredAtSlowChildStart = false;
    const waitForBlockedChildRelease = async (signal?: AbortSignal) => {
      while (!releaseBlockedChild) {
        if (signal?.aborted) {
          return 'aborted';
        }
        await delay(10);
      }
      return 'released';
    };
    const result = await startSubflowRun(tmpDir, {
      flowName: 'parent-stop',
      conversationId: parentConversationId,
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new (class extends ChatInterface {
          async execute(
            message: string,
            flags: Record<string, unknown>,
            conversationId: string,
            _model: string,
          ) {
            void _model;
            const signal = (flags as { signal?: AbortSignal }).signal;
            const abortIfNeeded = () => {
              if (!signal?.aborted) return false;
              this.emit('error', { type: 'error', message: 'aborted' });
              return true;
            };

            if (abortIfNeeded()) return;
            this.emit('thread', { type: 'thread', threadId: conversationId });

            if (
              message === 'slow child' &&
              conversationId !== parentConversationId
            ) {
              if (parentRunToken && !stopRegisteredAtSlowChildStart) {
                stopRegisteredAtSlowChildStart = true;
                registerPendingConversationCancel({
                  conversationId: parentConversationId,
                  runToken: parentRunToken,
                });
              }
              const waitResult = await waitForBlockedChildRelease(signal);
              if (waitResult === 'aborted' || abortIfNeeded()) {
                return;
              }
            }

            if (abortIfNeeded()) return;
            this.emit('final', { type: 'final', content: 'child ok' });
            this.emit('complete', {
              type: 'complete',
              threadId: conversationId,
            });
          }
        })(),
      onOwnershipReady: ({ runToken }) => {
        parentRunToken = runToken;
      },
    });

    const activeSubflow = await waitForActiveSubflow(result.conversationId);
    assert.ok(activeSubflow);
    assert.ok(parentRunToken);

    const activeChildConversationId = String(activeSubflow?.conversationId);
    await waitForConversationAssistantStatus(activeChildConversationId, 'ok');
    await waitFor(
      () => stopRegisteredAtSlowChildStart,
      10000,
      () =>
        `parentConversationId=${parentConversationId} | ${describeConversationStateWithActiveSubflows(
          parentConversationId,
        )}`,
    );

    await waitForAssistantStatus(parentConversationId, 'stopped', 10000, () =>
      JSON.stringify({
        stopRegisteredAtSlowChildStart,
        parentConversationId,
        activeChildConversationId,
        graph: JSON.parse(describeConversationGraph(parentConversationId, 2)),
      }),
    );
    await waitForAssistantStatus(
      activeChildConversationId,
      'stopped',
      10000,
      () =>
        JSON.stringify({
          stopRegisteredAtSlowChildStart,
          parentConversationId,
          activeChildConversationId,
          graph: JSON.parse(describeConversationGraph(parentConversationId, 2)),
        }),
    );
  } finally {
    releaseBlockedChild = true;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('stopping the parent flow stops every running child in a parallel subflow step', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-stop-parallel-'),
  );
  let releaseBlockedChildren = false;

  try {
    await withDeterministicCodexAvailabilityBootstrap(async () => {
      await writeFlowFile({
        tmpDir,
        flowName: 'child-slow-a',
        steps: [llmStep('child ok'), llmStep('slow child')],
      });
      await writeFlowFile({
        tmpDir,
        flowName: 'child-slow-b',
        steps: [llmStep('child ok'), llmStep('slow child')],
      });
      await writeFlowFile({
        tmpDir,
        flowName: 'parent-stop-parallel',
        steps: [subflowStep('Run Slow Batch', 'child-slow-a', 'child-slow-b')],
      });

      let parentRunToken: string | undefined;
      const parentConversationId = 'parent-stop-parallel-conversation';
      const slowChildConversationIds = new Set<string>();
      let stopRegisteredAtSlowChildrenStart = false;
      const waitForBlockedChildrenRelease = async (signal?: AbortSignal) => {
        while (!releaseBlockedChildren) {
          if (signal?.aborted) {
            return 'aborted';
          }
          await delay(10);
        }
        return 'released';
      };
      const result = await startSubflowRun(tmpDir, {
        flowName: 'parent-stop-parallel',
        conversationId: parentConversationId,
        customTitle: 'Parent Review',
        source: 'REST',
        chatFactory: () =>
          new (class extends ChatInterface {
            async execute(
              message: string,
              flags: Record<string, unknown>,
              conversationId: string,
              _model: string,
            ) {
              void _model;
              const signal = (flags as { signal?: AbortSignal }).signal;
              const abortIfNeeded = () => {
                if (!signal?.aborted) return false;
                this.emit('error', { type: 'error', message: 'aborted' });
                return true;
              };

              if (abortIfNeeded()) return;
              this.emit('thread', { type: 'thread', threadId: conversationId });

              if (
                message === 'slow child' &&
                conversationId !== parentConversationId
              ) {
                slowChildConversationIds.add(conversationId);
                if (
                  parentRunToken &&
                  !stopRegisteredAtSlowChildrenStart &&
                  slowChildConversationIds.size === 2
                ) {
                  stopRegisteredAtSlowChildrenStart = true;
                  registerPendingConversationCancel({
                    conversationId: parentConversationId,
                    runToken: parentRunToken,
                  });
                }
                const waitResult = await waitForBlockedChildrenRelease(signal);
                if (waitResult === 'aborted' || abortIfNeeded()) {
                  return;
                }
              }

              if (abortIfNeeded()) return;
              this.emit('final', { type: 'final', content: 'child ok' });
              this.emit('complete', {
                type: 'complete',
                threadId: conversationId,
              });
            }
          })(),
        onOwnershipReady: ({ runToken }) => {
          parentRunToken = runToken;
        },
      });

      const activeSubflows = await waitForActiveSubflowCount(
        result.conversationId,
        2,
      );
      assert.equal(activeSubflows.length, 2);
      assert.ok(parentRunToken);

      await waitFor(
        () => stopRegisteredAtSlowChildrenStart,
        10000,
        () =>
          JSON.stringify({
            parentConversationId,
            stopRegisteredAtSlowChildrenStart,
            slowChildConversationIds: [...slowChildConversationIds],
            activeSubflows,
            graph: JSON.parse(
              describeConversationGraph(parentConversationId, 2),
            ),
            runtimeLogs: JSON.parse(
              describeRelevantSubflowRuntimeLogs(
                parentConversationId,
                ...activeSubflows
                  .map((subflow) =>
                    typeof subflow?.conversationId === 'string'
                      ? subflow.conversationId
                      : null,
                  )
                  .filter((value): value is string => Boolean(value)),
              ),
            ),
          }),
      );

      const terminalAssistant = await waitForTerminalAssistantTurn(
        parentConversationId,
        10000,
        () =>
          JSON.stringify({
            parentConversationId,
            stopRegisteredAtSlowChildrenStart,
            slowChildConversationIds: [...slowChildConversationIds],
            activeSubflows,
            graph: JSON.parse(
              describeConversationGraph(parentConversationId, 2),
            ),
          }),
      );
      assert.equal(
        terminalAssistant?.status,
        'stopped',
        JSON.stringify({
          observedStatus: terminalAssistant?.status ?? null,
          observedContent: terminalAssistant?.content ?? null,
          parentConversationId,
          stopRegisteredAtSlowChildrenStart,
          slowChildConversationIds: [...slowChildConversationIds],
          activeSubflows,
          graph: JSON.parse(describeConversationGraph(parentConversationId, 2)),
          runtimeLogs: JSON.parse(
            describeRelevantSubflowRuntimeLogs(
              parentConversationId,
              ...activeSubflows
                .map((subflow) =>
                  typeof subflow?.conversationId === 'string'
                    ? subflow.conversationId
                    : null,
                )
                .filter((value): value is string => Boolean(value)),
            ),
          ),
        }),
      );
      assert.equal(
        terminalAssistant?.content,
        'Stopped subflows Parent Review-Run Slow Batch-child-slow-a, Parent Review-Run Slow Batch-child-slow-b',
      );
      await Promise.all(
        activeSubflows.map((activeSubflow) =>
          waitForAssistantStatus(
            String(activeSubflow.conversationId),
            'stopped',
            10000,
            () =>
              JSON.stringify({
                parentConversationId,
                stopRegisteredAtSlowChildrenStart,
                slowChildConversationIds: [...slowChildConversationIds],
                activeSubflow,
                graph: JSON.parse(
                  describeConversationGraph(parentConversationId, 2),
                ),
              }),
          ),
        ),
      );
    });
  } finally {
    releaseBlockedChildren = true;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parent stop becomes warning when cancel arrives after child completion', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-sticky-parent-stop-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-fast-ok',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-sticky-stop',
      steps: [
        subflowStep('Run Fast Child', 'child-fast-ok'),
        llmStep('should not run'),
      ],
    });

    let parentRunToken: string | undefined;
    const executions: string[] = [];
    const result = await startSubflowRun(tmpDir, {
      flowName: 'parent-sticky-stop',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(10, ({ message }) => {
          executions.push(message);
        }),
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
    const parentTurnsBeforeStop = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      parentTurnsBeforeStop.some((turn) => turn.role === 'assistant'),
      false,
    );

    registerPendingConversationCancel({
      conversationId: result.conversationId,
      runToken: parentRunToken as string,
    });

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'warning',
    );
    assert.equal(
      finalAssistant?.content,
      'Subflow stop request arrived after child completion (completed: Parent Review-Run Fast Child)',
    );
    assert.equal(
      executions.some((message) => message.includes('should not run')),
      false,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('pending parent stop prevents launching a new child subflow', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-stop-before-launch-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-never-started',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stop-before-launch',
      steps: [subflowStep('Run Child', 'child-never-started')],
    });

    const result = await startSubflowRun(tmpDir, {
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

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-resume',
      steps: [subflowStep('Run Slow Child', 'child-resume')],
    });

    let childRunToken: string | undefined;
    const childStart = await startSubflowRun(tmpDir, {
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
          activeSubflows: [
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-resume',
              conversationId: childStart.conversationId,
              runToken: childRunToken as string,
              title: 'Resume Parent-Run Slow Child',
            }),
          ],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startSubflowRun(tmpDir, {
      flowName: 'parent-resume',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(180),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    await waitForAssistantStatus(parentConversationId, 'ok', 10000, () =>
      describeConversationGraph(parentConversationId, 2),
    );

    const childFlowConversations = Array.from(
      memoryConversations.values(),
    ).filter((conversation) => conversation.flowName === 'child-resume');
    assert.equal(childFlowConversations.length, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume reattaches when persisted state still uses legacy activeSubflow', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-legacy-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume-legacy',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-resume-legacy',
      steps: [subflowStep('Run Slow Child', 'child-resume-legacy')],
    });

    let childRunToken: string | undefined;
    const childStart = await startSubflowRun(tmpDir, {
      flowName: 'child-resume-legacy',
      customTitle: 'Resume Parent-Run Slow Child',
      source: 'REST',
      chatFactory: () => new SubflowChat(180),
      onOwnershipReady: ({ runToken }) => {
        childRunToken = runToken;
      },
    });
    assert.ok(childRunToken);

    const parentConversationId = 'resume-parent-legacy-conversation';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Parent',
      flowName: 'parent-resume-legacy',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-parent-legacy-execution',
          stepPath: [],
          loopStack: [],
          activeSubflow: activeSubflowState({
            stepPath: [0],
            flowName: 'child-resume-legacy',
            conversationId: childStart.conversationId,
            runToken: childRunToken as string,
            title: 'Resume Parent-Run Slow Child',
          }),
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startSubflowRun(tmpDir, {
      flowName: 'parent-resume-legacy',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(180),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    await waitForAssistantStatus(parentConversationId, 'ok', 10000, () =>
      describeConversationGraph(parentConversationId, 2),
    );

    const childFlowConversations = Array.from(
      memoryConversations.values(),
    ).filter((conversation) => conversation.flowName === 'child-resume-legacy');
    assert.equal(childFlowConversations.length, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume reattaches to already running parallel child subflows instead of launching duplicate runs', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-parallel-'),
  );

  try {
    await withDeterministicCodexAvailabilityBootstrap(async () => {
      await writeFlowFile({
        tmpDir,
        flowName: 'child-resume-a',
        steps: [llmStep('slow child')],
      });
      await writeFlowFile({
        tmpDir,
        flowName: 'child-resume-b',
        steps: [llmStep('slow child')],
      });
      await writeFlowFile({
        tmpDir,
        flowName: 'parent-resume-parallel',
        steps: [
          subflowStep('Run Slow Batch', 'child-resume-a', 'child-resume-b'),
        ],
      });

      let childRunTokenA: string | undefined;
      let childRunTokenB: string | undefined;
      const childStartA = await startSubflowRun(tmpDir, {
        flowName: 'child-resume-a',
        customTitle: 'Resume Parent-Run Slow Batch-child-resume-a',
        source: 'REST',
        chatFactory: () => new SubflowChat(180),
        onOwnershipReady: ({ runToken }) => {
          childRunTokenA = runToken;
        },
      });
      const childStartB = await startSubflowRun(tmpDir, {
        flowName: 'child-resume-b',
        customTitle: 'Resume Parent-Run Slow Batch-child-resume-b',
        source: 'REST',
        chatFactory: () => new SubflowChat(180),
        onOwnershipReady: ({ runToken }) => {
          childRunTokenB = runToken;
        },
      });
      assert.ok(childRunTokenA);
      assert.ok(childRunTokenB);

      const parentConversationId = 'resume-parent-parallel-conversation';
      const now = new Date();
      memoryConversations.set(parentConversationId, {
        _id: parentConversationId,
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        title: 'Resume Parent',
        flowName: 'parent-resume-parallel',
        source: 'REST',
        flags: {
          flow: {
            executionId: 'resume-parent-parallel-execution',
            stepPath: [],
            loopStack: [],
            activeSubflows: [
              activeSubflowState({
                stepPath: [0],
                flowName: 'child-resume-a',
                conversationId: childStartA.conversationId,
                runToken: childRunTokenA as string,
                title: 'Resume Parent-Run Slow Batch-child-resume-a',
              }),
              activeSubflowState({
                stepPath: [0],
                flowName: 'child-resume-b',
                conversationId: childStartB.conversationId,
                runToken: childRunTokenB as string,
                title: 'Resume Parent-Run Slow Batch-child-resume-b',
              }),
            ],
            agentConversations: {},
            agentThreads: {},
          },
        },
        lastMessageAt: now,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      } as Conversation);

      const resumed = await startSubflowRun(tmpDir, {
        flowName: 'parent-resume-parallel',
        conversationId: parentConversationId,
        resumeStepPath: [],
        source: 'REST',
        chatFactory: () => new SubflowChat(180),
      });

      assert.equal(resumed.conversationId, parentConversationId);
      const resumedActiveSubflows = await waitForActiveSubflowCount(
        parentConversationId,
        2,
      );
      assert.deepEqual(
        resumedActiveSubflows
          .map((subflow) => String(subflow.conversationId))
          .sort(),
        [childStartA.conversationId, childStartB.conversationId].sort(),
      );
      await waitForAssistantStatus(parentConversationId, 'ok', 10000, () =>
        JSON.stringify({
          resumedActiveSubflows,
          graph: JSON.parse(describeConversationGraph(parentConversationId, 2)),
        }),
      );

      const childAConversations = Array.from(
        memoryConversations.values(),
      ).filter((conversation) => conversation.flowName === 'child-resume-a');
      const childBConversations = Array.from(
        memoryConversations.values(),
      ).filter((conversation) => conversation.flowName === 'child-resume-b');
      assert.equal(childAConversations.length, 1);
      assert.equal(childBConversations.length, 1);
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resumed parent stop wins when the restored child already finished', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-terminal-stop-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume-terminal',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-resume-terminal',
      steps: [subflowStep('Run Finished Child', 'child-resume-terminal')],
    });

    let childRunToken: string | undefined;
    const childStart = await startSubflowRun(tmpDir, {
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
          activeSubflows: [
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-resume-terminal',
              conversationId: childStart.conversationId,
              runToken: childRunToken as string,
              title: 'Resume Parent-Run Finished Child',
            }),
          ],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startSubflowRun(tmpDir, {
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
      15000,
    );
    assert.equal(finalAssistant?.content, 'Stopped');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resumed parent stop clears remembered terminal parallel child tracking before returning stopped', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-terminal-parallel-stop-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume-terminal-a',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume-terminal-b',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-resume-terminal-parallel',
      steps: [
        subflowStep(
          'Run Finished Batch',
          'child-resume-terminal-a',
          'child-resume-terminal-b',
        ),
      ],
    });

    let childRunTokenA: string | undefined;
    let childRunTokenB: string | undefined;
    const childStartA = await startSubflowRun(tmpDir, {
      flowName: 'child-resume-terminal-a',
      customTitle: 'Resume Parent-Run Finished Batch-child-resume-terminal-a',
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
      onOwnershipReady: ({ runToken }) => {
        childRunTokenA = runToken;
      },
    });
    const childStartB = await startSubflowRun(tmpDir, {
      flowName: 'child-resume-terminal-b',
      customTitle: 'Resume Parent-Run Finished Batch-child-resume-terminal-b',
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
      onOwnershipReady: ({ runToken }) => {
        childRunTokenB = runToken;
      },
    });
    assert.ok(childRunTokenA);
    assert.ok(childRunTokenB);
    await waitForAssistantStatus(childStartA.conversationId, 'ok');
    await waitForAssistantStatus(childStartB.conversationId, 'ok');

    const parentConversationId = 'resume-parent-terminal-parallel-conversation';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Parent',
      flowName: 'parent-resume-terminal-parallel',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-parent-terminal-parallel-execution',
          stepPath: [],
          loopStack: [],
          activeSubflows: [
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-resume-terminal-a',
              conversationId: childStartA.conversationId,
              runToken: childRunTokenA as string,
              title: 'Resume Parent-Run Finished Batch-child-resume-terminal-a',
            }),
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-resume-terminal-b',
              conversationId: childStartB.conversationId,
              runToken: childRunTokenB as string,
              title: 'Resume Parent-Run Finished Batch-child-resume-terminal-b',
            }),
          ],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startSubflowRun(tmpDir, {
      flowName: 'parent-resume-terminal-parallel',
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

    const parentConversation = memoryConversations.get(parentConversationId);
    assert.ok(parentConversation);
    assert.equal(
      (
        parentConversation.flags as
          | { flow?: { activeSubflows?: unknown } }
          | undefined
      )?.flow?.activeSubflows,
      undefined,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume tolerates stale subflows that have no active child run or terminal result', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-stale-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-stale',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stale',
      steps: [subflowStep('Run Stale Child', 'child-stale')],
    });

    const childConversationId = 'stale-child-conversation';
    const parentConversationId = 'stale-parent-conversation';
    const now = new Date();

    memoryConversations.set(childConversationId, {
      _id: childConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Stale Child',
      flowName: 'child-stale',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'stale-child-execution',
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

    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Stale Parent',
      flowName: 'parent-stale',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'stale-parent-execution',
          stepPath: [],
          loopStack: [],
          activeSubflows: [
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-stale',
              conversationId: childConversationId,
              runToken: 'stale-child-run-token',
              title: 'Stale Parent-Run Stale Child',
            }),
          ],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startSubflowRun(tmpDir, {
      flowName: 'parent-stale',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    const finalAssistant = await waitForAssistantStatus(
      parentConversationId,
      'ok',
    );
    assert.match(
      String(finalAssistant?.content ?? ''),
      /best effort: 0 succeeded, 1 failed/u,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume tolerates stale legacy activeSubflow state that has no active child run or terminal result', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-stale-legacy-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-stale-legacy',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stale-legacy',
      steps: [subflowStep('Run Stale Child', 'child-stale-legacy')],
    });

    const childConversationId = 'stale-legacy-child-conversation';
    const parentConversationId = 'stale-legacy-parent-conversation';
    const now = new Date();

    memoryConversations.set(childConversationId, {
      _id: childConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Stale Child',
      flowName: 'child-stale-legacy',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'stale-legacy-child-execution',
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

    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Stale Parent',
      flowName: 'parent-stale-legacy',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'stale-legacy-parent-execution',
          stepPath: [],
          loopStack: [],
          activeSubflow: activeSubflowState({
            stepPath: [0],
            flowName: 'child-stale-legacy',
            conversationId: childConversationId,
            runToken: 'stale-legacy-child-run-token',
            title: 'Stale Parent-Run Stale Child',
          }),
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startSubflowRun(tmpDir, {
      flowName: 'parent-stale-legacy',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    const finalAssistant = await waitForAssistantStatus(
      parentConversationId,
      'ok',
    );
    assert.match(
      String(finalAssistant?.content ?? ''),
      /best effort: 0 succeeded, 1 failed/u,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume tolerates stale remembered subflows before launching missing parallel children', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-stale-before-launch-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-stale',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-missing',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stale-parallel',
      steps: [subflowStep('Run Child Batch', 'child-stale', 'child-missing')],
    });

    const childConversationId = 'stale-before-launch-child-conversation';
    const parentConversationId = 'stale-before-launch-parent-conversation';
    const now = new Date();

    memoryConversations.set(childConversationId, {
      _id: childConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Stale Child',
      flowName: 'child-stale',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'stale-before-launch-child-execution',
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

    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Stale Parent',
      flowName: 'parent-stale-parallel',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'stale-before-launch-parent-execution',
          stepPath: [],
          loopStack: [],
          activeSubflows: [
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-stale',
              conversationId: childConversationId,
              runToken: 'stale-before-launch-child-run-token',
              title: 'Stale Parent-Run Child Batch-child-stale',
            }),
          ],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startSubflowRun(tmpDir, {
      flowName: 'parent-stale-parallel',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    const finalAssistant = await waitForAssistantStatus(
      parentConversationId,
      'ok',
    );
    assert.match(
      String(finalAssistant?.content ?? ''),
      /best effort: 1 succeeded, 1 failed/u,
    );

    const missingChildConversations = Array.from(
      memoryConversations.values(),
    ).filter((conversation) => conversation.flowName === 'child-missing');
    assert.equal(missingChildConversations.length, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resumed parent flow uses its persisted conversation title for new subflow titles', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-persisted-title-'),
  );

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-title',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-title',
      steps: [subflowStep('Run Child', 'child-title')],
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

    const resumed = await startSubflowRun(tmpDir, {
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
