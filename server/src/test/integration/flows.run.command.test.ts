import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';
import type WebSocket from 'ws';

import { loadAgentCommandFile } from '../../agents/commandsLoader.js';
import { getActiveRunOwnership } from '../../agents/runLock.js';
import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
} from '../../agents/service.js';
import { runAgentCommand } from '../../agents/service.js';
import { registerPendingConversationCancel } from '../../chat/inflightRegistry.js';
import { getInflight } from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import {
  __resetGitHubReviewDepsForTests,
  __setGitHubReviewDepsForTests,
} from '../../flows/githubReview.js';
import {
  __resetMarkdownFileResolverDepsForTests,
  __setMarkdownFileResolverDepsForTests,
} from '../../flows/markdownFileResolver.js';
import {
  __resetFlowServiceDepsForTests,
  __setFlowServiceDepsForTests,
} from '../../flows/service.js';
import { startFlowRun } from '../../flows/service.js';
import { closeAll as closeLmStudioClients } from '../../lmstudio/clientPool.js';
import type { ListReposResult, RepoEntry } from '../../lmstudio/toolService.js';
import { query, resetStore } from '../../logStore.js';
import type { Turn } from '../../mongo/turn.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { attachWs } from '../../ws/server.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import { createPlanScopeFixture } from '../support/planScopeFixture.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  installDeterministicCodexAvailabilityBootstrap();
});

afterEach(async () => {
  resetDeterministicCodexAvailabilityBootstrap();
  __resetGitHubReviewDepsForTests();
  await closeLmStudioClients();
});

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(message)),
          resolvedTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

class ScriptedChat extends ChatInterface {
  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    const signal = (flags as { signal?: AbortSignal }).signal;
    if (signal?.aborted) {
      this.emit('error', { type: 'error', message: 'aborted' });
      return;
    }
    const delayedMatch = message.match(/^__delay:(\d+)::([\s\S]*)$/);
    if (delayedMatch) {
      await delay(Number(delayedMatch[1]));
      if (signal?.aborted) {
        this.emit('error', { type: 'error', message: 'aborted' });
        return;
      }
    }
    const response = delayedMatch ? delayedMatch[2] : 'ok';
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: response });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class FlakyOnceChat extends ChatInterface {
  constructor(private readonly counter: { count: number }) {
    super();
  }

  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _message;
    void _flags;
    void _model;
    this.counter.count += 1;
    if (this.counter.count === 1) {
      throw new Error('fail once');
    }
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class CompleteThenPauseChat extends ChatInterface {
  constructor(
    private readonly options: {
      pauseMs?: number;
      onComplete?: () => Promise<void> | void;
    } = {},
  ) {
    super();
  }

  async execute(
    _message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _message;
    void _model;
    const signal = (flags as { signal?: AbortSignal }).signal;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'almost done' });
    this.emit('complete', {
      type: 'complete',
      threadId: conversationId,
      usage: {
        inputTokens: 12,
        outputTokens: 5,
        totalTokens: 17,
        cachedInputTokens: 6,
      },
      timing: { totalTimeSec: 0.25, tokensPerSecond: 20 },
    });
    await this.options.onComplete?.();
    await delay(this.options.pauseMs ?? 75);
    if (signal?.aborted) {
      return;
    }
  }
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);
const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows',
);

const buildRepoEntry = (params: {
  containerPath: string;
  id?: string;
  lastIngestAt?: string | null;
}): RepoEntry => ({
  id:
    params.id ??
    path.posix.basename(params.containerPath.replace(/\\/g, '/')) ??
    'repo',
  description: null,
  containerPath: params.containerPath,
  hostPath: params.containerPath,
  lastIngestAt: params.lastIngestAt ?? '2026-01-01T00:00:00.000Z',
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

const buildReingestSuccess = (
  overrides: Partial<{
    status: 'completed' | 'cancelled' | 'error';
    errorCode: string | null;
    sourceId: string;
    runId: string;
    resolvedRepositoryId: string | null;
    completionMode: 'reingested' | 'skipped' | null;
  }> = {},
) => ({
  status: 'completed' as const,
  operation: 'reembed' as const,
  runId: 'run-123',
  sourceId: '/repo/source-a',
  resolvedRepositoryId: 'repo-a',
  completionMode: 'reingested' as const,
  durationMs: 100,
  files: 3,
  chunks: 7,
  embedded: 7,
  errorCode: null,
  ...overrides,
});

const buildWaitTimeQueueUnavailableError = (params: {
  repositoryId: string;
  sourceId: string;
}) => ({
  code: 503 as const,
  message: 'QUEUE_UNAVAILABLE' as const,
  data: {
    tool: 'reingest_repository' as const,
    code: 'QUEUE_UNAVAILABLE' as const,
    retryable: true as const,
    retryMessage: 'retry',
    reingestableRepositoryIds: [params.repositoryId],
    reingestableSourceIds: [params.sourceId],
    queueFailureStage: 'wait' as const,
    waitReason: 'queue-read-failed' as const,
    fieldErrors: [
      {
        field: 'sourceId' as const,
        reason: 'invalid_state' as const,
        message:
          'Mongo-backed ingest queue is unavailable while waiting for re-ingest completion',
      },
    ],
  },
});

const createGitHubReviewRepoFixture = async (taskNumber = 4) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'github-command-'));
  const planPath =
    'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md';
  await fs.mkdir(path.join(repoRoot, 'codeInfoStatus/flow-state'), {
    recursive: true,
  });
  await fs.mkdir(path.join(repoRoot, 'planning'), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, 'codeInfoStatus/flow-state/current-plan.json'),
    JSON.stringify(
      {
        plan_path: planPath,
        branched_from: 'main',
        additional_repositories: [],
      },
      null,
      2,
    ),
    'utf8',
  );
  await fs.writeFile(
    path.join(repoRoot, 'codeInfoStatus/flow-state/current-task.json'),
    JSON.stringify(
      {
        plan_path: planPath,
        selected_task: {
          number: taskNumber,
          title: 'Task 4',
          status: '__in_progress__',
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  await fs.writeFile(
    path.join(
      repoRoot,
      'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
    ),
    [
      '# Story 0000060 - Users can automate GitHub PR review cycles with conditional, script, and wait steps',
      '',
      '### Task 4. Compose The Opt-In GitHub Review-Cycle Flow Variant And Preserve Default Entrypoints',
      '',
      '- Task Status: `__in_progress__`',
      '',
      '#### Implementation notes',
      '',
      '- Starts empty.',
      '',
    ].join('\n'),
    'utf8',
  );
  return repoRoot;
};

const withFlowServer = async (
  task: (params: {
    baseUrl: string;
    wsUrl: WebSocket;
    tmpDir: string;
  }) => Promise<void>,
  options?: {
    listIngestedRepositories?: (tmpDir: string) => Promise<ListReposResult>;
    markdownReadFile?: (filePath: string) => Promise<Buffer>;
    chatFactory?: () => ChatInterface;
    flowServiceDeps?: Parameters<typeof __setFlowServiceDepsForTests>[0];
  },
) => {
  const prevPreferredAgentsHome = process.env.CODEINFO_AGENT_HOME;
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-cmd-'));
  await fs.cp(fixturesDir, tmpDir, { recursive: true });

  process.env.CODEINFO_AGENT_HOME = path.join(repoRoot, 'codeinfo_agents');
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  resetStore();

  if (options?.listIngestedRepositories) {
    __setAgentServiceDepsForTests({
      listIngestedRepositories: () => options.listIngestedRepositories!(tmpDir),
    });
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: () => options.listIngestedRepositories!(tmpDir),
      ...(options.markdownReadFile
        ? { readFile: options.markdownReadFile }
        : {}),
    });
  }
  if (options?.flowServiceDeps) {
    __setFlowServiceDepsForTests(options.flowServiceDeps);
  }

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: options?.chatFactory ?? (() => new ScriptedChat()),
          ...(options?.listIngestedRepositories
            ? {
                listIngestedRepositories: () =>
                  options.listIngestedRepositories!(tmpDir),
              }
            : {}),
        }),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const ws = await connectWs({ baseUrl });

  try {
    await task({ baseUrl, wsUrl: ws, tmpDir });
  } finally {
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    __resetFlowServiceDepsForTests();
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    if (prevPreferredAgentsHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = prevPreferredAgentsHome;
    }
    if (prevAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

const waitForTurns = async (
  conversationId: string,
  predicate: (turns: Turn[]) => boolean,
  timeoutMs = 2000,
  describe?: () => string,
) => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const started = Date.now();
  while (Date.now() - started < resolvedTimeoutMs) {
    const turns = memoryTurns.get(conversationId) ?? [];
    if (predicate(turns)) return turns;
    await delay(20);
  }
  const turns = memoryTurns.get(conversationId) ?? [];
  const conversation = memoryConversations.get(conversationId);
  throw new Error(
    [
      `Timed out waiting for flow turns for ${conversationId}`,
      `turnCount=${turns.length}`,
      `conversationFlags=${JSON.stringify(conversation?.flags ?? null)}`,
      `recentTurns=${JSON.stringify(
        turns.slice(-8).map((turn) => ({
          role: turn.role,
          status: turn.status,
          content: turn.content,
        })),
      )}`,
      `runtimeLogs=${JSON.stringify(
        query({ text: 'flows.test.' }, 300)
          .filter((entry) => entry.context?.conversationId === conversationId)
          .slice(-25)
          .map((entry) => ({
            message: entry.message,
            context: entry.context,
          })),
      )}`,
      describe ? `details=${describe()}` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' | '),
  );
};

const waitForFlowFinal = async (params: {
  ws: WebSocket;
  conversationId: string;
  status: 'ok' | 'failed' | 'stopped';
  timeoutMs?: number;
  describe?: () => string;
}) => {
  const getLatestAssistantTurn = () =>
    [...(memoryTurns.get(params.conversationId) ?? [])]
      .reverse()
      .find((turn) => turn.role === 'assistant');
  const getLatestTurnFinalLog = () =>
    query({ text: 'chat.ws.server_publish_turn_final' }, 120)
      .filter((entry) => entry.context?.conversationId === params.conversationId)
      .at(-1);

  try {
    return await waitForEvent({
      ws: params.ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'turn_final';
        status: string;
        error?: { code?: string; message?: string } | null;
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          status?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === params.conversationId &&
          e.status === params.status
        );
      },
      timeoutMs: params.timeoutMs ?? 10000,
      describe: params.describe,
      inspectCurrent: () =>
        JSON.stringify({
          conversationFlags:
            memoryConversations.get(params.conversationId)?.flags ?? null,
          recentTurns: (memoryTurns.get(params.conversationId) ?? [])
            .slice(-8)
            .map((turn) => ({
              role: turn.role,
              status: turn.status,
              content: turn.content,
            })),
          runtimeLogs: query({ text: 'flows.test.' }, 300)
            .filter(
              (entry) => entry.context?.conversationId === params.conversationId,
            )
            .slice(-25)
            .map((entry) => ({
              message: entry.message,
              context: entry.context,
            })),
        }),
      describeEvent: (event) => JSON.stringify(event),
    });
  } catch (error) {
    const deadline = Date.now() + resolveConfiguredTestTimeoutMs(1000);
    while (Date.now() < deadline) {
      const latestAssistantTurn = getLatestAssistantTurn();
      if (latestAssistantTurn?.status === params.status) {
        const latestTurnFinalLog = getLatestTurnFinalLog();
        return {
          type: 'turn_final' as const,
          status: latestAssistantTurn.status,
          error:
            latestAssistantTurn.status === 'failed'
              ? {
                  code:
                    typeof latestTurnFinalLog?.context?.errorCode === 'string'
                      ? latestTurnFinalLog.context.errorCode
                      : undefined,
                  message: latestAssistantTurn.content,
                }
              : undefined,
        };
      }
      await delay(20);
    }

    throw new Error(
      [
        error instanceof Error
          ? error.message
          : 'Timed out waiting for WebSocket event',
        `latestAssistantTurn=${JSON.stringify(
          (() => {
            const turn = getLatestAssistantTurn();
            return turn
              ? { status: turn.status, content: turn.content }
              : null;
          })(),
        )}`,
        `latestTurnFinalLog=${JSON.stringify(
          getLatestTurnFinalLog()?.context ?? null,
        )}`,
      ].join(' | '),
    );
  }
};

const describeFlowRuntimeState = (conversationId: string) =>
  JSON.stringify({
    inflightId: getInflight(conversationId)?.inflightId ?? null,
    ownershipRunToken: getActiveRunOwnership(conversationId)?.runToken ?? null,
    conversationFlags: memoryConversations.get(conversationId)?.flags ?? null,
    recentTurns: (memoryTurns.get(conversationId) ?? []).slice(-8).map((turn) => ({
      role: turn.role,
      status: turn.status,
      content: turn.content,
      command: turn.command,
      runtime: turn.runtime,
    })),
  });

const describeCommandRetryDiagnosticState = (conversationId: string) => {
  const flowState = JSON.parse(describeFlowRuntimeState(conversationId)) as {
    conversationFlags?: {
      flow?: { agentConversations?: Record<string, string> };
    };
  };
  const prepConversationId =
    flowState.conversationFlags?.flow?.agentConversations?.[
      'planning_agent:prep'
    ] ?? null;
  const runtimeLogs = query({ text: 'flows.test.command_' }, 50)
    .concat(query({ text: 'flows.test.start.' }, 50))
    .concat(query({ text: 'flows.test.step_dispatch' }, 50))
    .concat(query({ text: 'flows.test.first_' }, 50))
    .concat(query({ text: 'flows.test.chat_factory_' }, 50))
    .concat(query({ text: 'runtime.chat_config_lock_' }, 20))
    .filter(
      (entry) =>
        entry.context?.conversationId === conversationId ||
        entry.message.startsWith('runtime.chat_config_lock_'),
    )
    .map((entry) => ({
      message: entry.message,
      context: entry.context,
    }));

  return JSON.stringify({
    state: flowState,
    prepConversationId,
    prepState: prepConversationId
      ? JSON.parse(describeFlowRuntimeState(prepConversationId))
      : null,
    runtimeLogs,
  });
};

const cleanupMemory = (...conversationIds: Array<string | undefined>) => {
  conversationIds.forEach((conversationId) => {
    if (!conversationId) return;
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
};

const waitForRuntimeCleanup = async (
  conversationId: string,
  timeoutMs = 4000,
) => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const started = Date.now();
  while (Date.now() - started < resolvedTimeoutMs) {
    if (
      !getInflight(conversationId) &&
      !getActiveRunOwnership(conversationId)
    ) {
      return;
    }
    await delay(25);
  }
  throw new Error(
    [
      `Timed out waiting for flow runtime cleanup for ${conversationId}`,
      `inflight=${JSON.stringify(getInflight(conversationId) ?? null)}`,
      `ownership=${JSON.stringify(getActiveRunOwnership(conversationId))}`,
      `conversationFlags=${JSON.stringify(
        memoryConversations.get(conversationId)?.flags ?? null,
      )}`,
    ].join(' | '),
  );
};

const cleanupConversationRuntime = async (
  conversationId: string | undefined,
  ...conversationIds: Array<string | undefined>
) => {
  try {
    if (conversationId) {
      await waitForRuntimeCleanup(conversationId);
    }
  } finally {
    cleanupMemory(conversationId, ...conversationIds);
  }
};

const makeFlowCommand = (params: { commandName: string }) => ({
  description: 'repo flow command',
  steps: [
    {
      type: 'command',
      agentType: 'planning_agent',
      identifier: 'repo-agent',
      commandName: params.commandName,
    },
  ],
});

const writeRepoCommand = async (params: {
  repoRoot: string;
  commandName: string;
  rootDirName?: 'codeinfo_agents' | 'codex_agents';
  content?: string;
  items?: unknown[];
  invalidSchema?: boolean;
  invalidJson?: boolean;
}) => {
  const commandDir = path.join(
    params.repoRoot,
    params.rootDirName ?? 'codex_agents',
    'planning_agent',
    'commands',
  );
  await fs.mkdir(commandDir, { recursive: true });
  const filePath = path.join(commandDir, `${params.commandName}.json`);
  if (params.invalidJson) {
    await fs.writeFile(filePath, '{"Description": ');
    return filePath;
  }
  if (params.invalidSchema) {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        Description: 'invalid schema',
        items: [{ type: 'message', role: 'assistant', content: ['bad role'] }],
      }),
    );
    return filePath;
  }
  await fs.writeFile(
    filePath,
    JSON.stringify({
      Description: 'repo command',
      items: params.items ?? [
        {
          type: 'message',
          role: 'user',
          content: [params.content ?? 'repo step'],
        },
      ],
    }),
  );
  return filePath;
};

const writeMarkdownFile = async (params: {
  repoRoot: string;
  relativePath: string;
  content?: string;
  bytes?: Uint8Array;
}) => {
  const filePath = path.join(
    params.repoRoot,
    'codeinfo_markdown',
    params.relativePath,
  );
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (params.bytes) {
    await fs.writeFile(filePath, params.bytes);
  } else {
    await fs.writeFile(filePath, params.content ?? '', 'utf8');
  }
  return filePath;
};

const writeRepoFlow = async (params: {
  repoRoot: string;
  flowName: string;
  commandName: string;
}) => {
  const flowDir = path.join(params.repoRoot, 'flows');
  await fs.mkdir(flowDir, { recursive: true });
  await fs.writeFile(
    path.join(flowDir, `${params.flowName}.json`),
    JSON.stringify(makeFlowCommand({ commandName: params.commandName })),
  );
};

const writeFlowFile = async (params: {
  repoRoot: string;
  flowName: string;
  steps: unknown[];
}) => {
  const flowDir = path.join(params.repoRoot, 'flows');
  await fs.mkdir(flowDir, { recursive: true });
  await fs.writeFile(
    path.join(flowDir, `${params.flowName}.json`),
    JSON.stringify(
      {
        description: params.flowName,
        steps: params.steps,
      },
      null,
      2,
    ),
  );
};

test('command steps execute agent command items', async () => {
  const commandPath = path.join(
    repoRoot,
    'codeinfo_agents',
    'planning_agent',
    'commands',
    'improve_plan.json',
  );
  const command = await loadAgentCommandFile({ filePath: commandPath });
  assert.equal(command.ok, true);
  const totalItems = command.ok ? command.command.items.length : 0;

  await withFlowServer(async ({ baseUrl, wsUrl }) => {
    const conversationId = 'flow-command-conv-1';
    sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

    await supertest(baseUrl)
      .post('/flows/command-step/run')
      .send({ conversationId })
      .expect(202);

    const final = await waitForEvent({
      ws: wsUrl,
      predicate: (
        event: unknown,
      ): event is { type: 'turn_final'; status: string } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          status?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.status === 'ok'
        );
      },
      timeoutMs: 4000,
    });

    assert.equal(final.status, 'ok');

    const turns = await waitForTurns(
      conversationId,
      (items) =>
        items.filter((turn) => turn.role === 'assistant').length === totalItems,
      4000,
    );

    const userTurns = turns.filter((turn) => turn.role === 'user');
    const assistantTurns = turns.filter((turn) => turn.role === 'assistant');
    assert.equal(userTurns.length, totalItems);
    assert.equal(assistantTurns.length, totalItems);

    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
});

test('github PR open generates reviewer-facing title and body from active story context', async () => {
  const previousFlowsDir = process.env.FLOWS_DIR;
  const tempFlowsDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'github-pr-flow-'),
  );
  const repoRoot = await createGitHubReviewRepoFixture();
  const conversationId = 'github-open-conversation';
  const seenCommands: string[][] = [];

  process.env.FLOWS_DIR = tempFlowsDir;
  await fs.writeFile(
    path.join(repoRoot, '.env.local'),
    'CODEINFO_PR_TOKEN=secret\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(tempFlowsDir, 'github-open.json'),
    JSON.stringify(
      {
        description: 'github open',
        steps: [{ type: 'github_open_pr', label: 'Open PR' }],
      },
      null,
      2,
    ),
    'utf8',
  );

  __setGitHubReviewDepsForTests({
    runCommand: async ({ args }) => {
      seenCommands.push(args);
      const joined = args.join(' ');
      if (joined === 'branch --show-current') {
        return { exitCode: 0, stdout: 'feature/0000060-demo\n', stderr: '' };
      }
      if (joined === 'rev-parse HEAD') {
        return { exitCode: 0, stdout: 'deadbeef\n', stderr: '' };
      }
      if (joined === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') {
        return {
          exitCode: 0,
          stdout: 'origin/feature/0000060-demo\n',
          stderr: '',
        };
      }
      if (joined === 'remote get-url origin') {
        return {
          exitCode: 0,
          stdout: 'https://github.com/example/repo.git\n',
          stderr: '',
        };
      }
      if (joined === 'symbolic-ref refs/remotes/origin/HEAD') {
        return {
          exitCode: 0,
          stdout: 'refs/remotes/origin/main\n',
          stderr: '',
        };
      }
      if (joined === 'push origin HEAD:feature/0000060-demo') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'pr' && args[1] === 'create') {
        return {
          exitCode: 0,
          stdout: 'https://github.com/example/repo/pull/45\n',
          stderr: '',
        };
      }
      if (
        args[0] === 'api' &&
        args.includes(
          'repos/example/repo/pulls?state=open&head=example:feature%2F0000060-demo&sort=created&direction=desc&per_page=100',
        )
      ) {
        return {
          exitCode: 0,
          stdout:
            '[[{"number":45,"html_url":"https://github.com/example/repo/pull/45","head":{"ref":"feature/0000060-demo"},"base":{"ref":"main"},"user":{"login":"review-author"},"created_at":"2026-06-24T12:00:00Z","title":"Story review"}]]',
          stderr: '',
        };
      }
      throw new Error(`Unexpected command: ${joined}`);
    },
    sleep: async () => {},
  });

  try {
    await startFlowRun({
      flowName: 'github-open',
      conversationId,
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () => new ScriptedChat(),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry({ containerPath: repoRoot })],
        lockedModelId: null,
      }),
    });

    await withTimeout(
      (async () => {
        while (
          !seenCommands.some((args) => args[0] === 'pr' && args[1] === 'create')
        ) {
          await delay(20);
        }
      })(),
      4000,
      'Timed out waiting for GitHub PR create call',
    );

    const createArgs = seenCommands.find(
      (args) => args[0] === 'pr' && args[1] === 'create',
    );
    assert.ok(createArgs);
    const title = createArgs[createArgs.indexOf('--title') + 1];
    const body = createArgs[createArgs.indexOf('--body') + 1];

    assert.equal(
      title,
      'Story 0000060 review: Users can automate GitHub PR review cycles with conditional, script, and wait steps',
    );
    assert.match(body, /Implemented work summary:/);
    assert.match(
      body,
      /Do not request behavior changes outside the active story scope/,
    );
    assert.match(body, /Flow: github-open/);
  } finally {
    await cleanupConversationRuntime(conversationId);
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('flow-owned commands execute one markdown-backed message item', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-markdown-single');
      const commandName = 'task6_single_markdown';
      const conversationId = 'flow-command-single-markdown';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-single-markdown',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [{ type: 'message', role: 'user', markdownFile: 'single.md' }],
      });
      await writeMarkdownFile({
        repoRoot: sourceRoot,
        relativePath: 'single.md',
        content: '# single markdown',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-single-markdown/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('# single markdown'),
          ),
        3000,
      );
      assert.ok(
        turns.some(
          (turn) =>
            turn.role === 'user' && turn.content.includes('# single markdown'),
        ),
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('flow-owned commands preserve order across multiple markdown-backed message items', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-markdown-multi');
      const commandName = 'task6_multi_markdown';
      const conversationId = 'flow-command-multi-markdown';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-multi-markdown',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [
          { type: 'message', role: 'user', markdownFile: 'first.md' },
          { type: 'message', role: 'user', markdownFile: 'second.md' },
        ],
      });
      await writeMarkdownFile({
        repoRoot: sourceRoot,
        relativePath: 'first.md',
        content: 'first markdown item',
      });
      await writeMarkdownFile({
        repoRoot: sourceRoot,
        relativePath: 'second.md',
        content: 'second markdown item',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-multi-markdown/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) => items.filter((turn) => turn.role === 'user').length >= 2,
        3000,
      );
      const userTurns = turns
        .filter((turn) => turn.role === 'user')
        .map((turn) => turn.content);
      assert.deepEqual(userTurns.slice(0, 2), [
        'first markdown item',
        'second markdown item',
      ]);
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('flow-owned commands keep inline content behavior when mixed with markdown-backed items', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-markdown-mixed');
      const commandName = 'task6_mixed_message_items';
      const conversationId = 'flow-command-mixed-items';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-mixed-items',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [
          { type: 'message', role: 'user', markdownFile: 'mixed.md' },
          { type: 'message', role: 'user', content: ['inline item'] },
        ],
      });
      await writeMarkdownFile({
        repoRoot: sourceRoot,
        relativePath: 'mixed.md',
        content: 'markdown item',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-mixed-items/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) => items.filter((turn) => turn.role === 'user').length >= 2,
        3000,
      );
      const userTurns = turns
        .filter((turn) => turn.role === 'user')
        .map((turn) => turn.content);
      assert.deepEqual(userTurns.slice(0, 2), ['markdown item', 'inline item']);
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('flow-owned commands use the parent flow repository before markdown fallbacks', async () => {
  const repos: RepoEntry[] = [];
  const commandName = 'task6_same_source_markdown';
  const localMarkdownPath = path.join(
    repoRoot,
    'codeinfo_markdown',
    'shared-flow-cmd.md',
  );
  try {
    await fs.mkdir(path.dirname(localMarkdownPath), { recursive: true });
    await fs.writeFile(localMarkdownPath, 'codeinfo2 markdown', 'utf8');
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'repo-markdown-same-source');
        const conversationId = 'flow-command-same-source-markdown';
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-same-source-markdown',
          commandName,
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [
            {
              type: 'message',
              role: 'user',
              markdownFile: 'shared-flow-cmd.md',
            },
          ],
        });
        await writeMarkdownFile({
          repoRoot: sourceRoot,
          relativePath: 'shared-flow-cmd.md',
          content: 'same-source markdown',
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/repo-command-same-source-markdown/run')
          .send({ conversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForFlowFinal({
          ws: wsUrl,
          conversationId,
          status: 'ok',
        });
        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes('same-source markdown'),
            ),
          3000,
        );
        assert.equal(
          turns.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('codeinfo2 markdown'),
          ),
          false,
        );
        await cleanupConversationRuntime(conversationId);
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
      },
    );
  } finally {
    await fs.rm(localMarkdownPath, { force: true });
  }
});

test('flow-owned commands fall back through markdown repositories after a same-source miss', async () => {
  const repos: RepoEntry[] = [];
  const commandName = 'task6_markdown_fallback';
  const localMarkdownPath = path.join(
    repoRoot,
    'codeinfo_markdown',
    'fallback-flow-cmd.md',
  );
  try {
    await fs.mkdir(path.dirname(localMarkdownPath), { recursive: true });
    await fs.writeFile(
      localMarkdownPath,
      'codeinfo2 fallback markdown',
      'utf8',
    );
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'repo-markdown-fallback');
        const conversationId = 'flow-command-markdown-fallback';
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-markdown-fallback',
          commandName,
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [
            {
              type: 'message',
              role: 'user',
              markdownFile: 'fallback-flow-cmd.md',
            },
          ],
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/repo-command-markdown-fallback/run')
          .send({ conversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForFlowFinal({
          ws: wsUrl,
          conversationId,
          status: 'ok',
        });
        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes('codeinfo2 fallback markdown'),
            ),
          3000,
        );
        assert.ok(
          turns.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('codeinfo2 fallback markdown'),
          ),
        );
        cleanupMemory(conversationId);
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
      },
    );
  } finally {
    await fs.rm(localMarkdownPath, { force: true });
  }
});

test('local codeinfo2 flows resolve commands from the selected working repository before codeinfo2', async () => {
  const repos: RepoEntry[] = [];
  const commandName = 'task2_local_flow_working_repo_first';
  const localCommandPath = path.join(
    repoRoot,
    'codeinfo_agents',
    'planning_agent',
    'commands',
    `${commandName}.json`,
  );

  try {
    await writeRepoCommand({
      repoRoot,
      commandName,
      content: 'codeinfo2 owner command',
    });

    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const workingRoot = path.join(tmpDir, 'working-local-flow-repo');
        const conversationId = 'task2-local-flow-working-repo-first';
        await fs.writeFile(
          path.join(tmpDir, 'task2-local-flow-working-repo-first.json'),
          JSON.stringify(makeFlowCommand({ commandName })),
        );
        await writeRepoCommand({
          repoRoot: workingRoot,
          commandName,
          content: 'working repository command',
        });
        repos.push(
          buildRepoEntry({ containerPath: workingRoot, id: 'Working Repo' }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/task2-local-flow-working-repo-first/run')
          .send({
            conversationId,
            working_folder: workingRoot,
          })
          .expect(202);

        await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes('working repository command'),
            ),
          3000,
        );
        assert.ok(
          turns.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('working repository command'),
          ),
        );

        const logs = query({ text: 'DEV_0000040_T11_FLOW_RESOLUTION_ORDER' });
        const selectedLog = logs.find(
          (entry) => entry.context?.decision === 'selected',
        );
        const orderLogs = query({
          text: 'DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER',
        });
        assert.equal(
          selectedLog?.context?.selectedRepositoryPath,
          path.resolve(workingRoot),
        );
        assert.equal(selectedLog?.context?.fallbackUsed, false);
        assert.equal(selectedLog?.context?.workingRepositoryAvailable, true);
        assert.equal(orderLogs.length, 2);
        for (const orderLog of orderLogs) {
          assert.deepEqual(orderLog?.context, {
            referenceType: 'commandFile',
            caller: 'flow-command',
            workingRepositoryAvailable: true,
            candidateRepositories: [
              {
                sourceId: path.resolve(workingRoot),
                sourceLabel: 'working-local-flow-repo',
                slot: 'working_repository',
              },
              {
                sourceId: path.resolve(repoRoot),
                sourceLabel: 'codeInfo2',
                slot: 'owner_repository',
              },
            ],
          });
        }
        cleanupMemory(conversationId);
      },
      {
        listIngestedRepositories: async () => ({ repos, lockedModelId: null }),
      },
    );
  } finally {
    await fs.rm(localCommandPath, { force: true });
  }
});

test('cross-repo flow-owned commands execute from codeinfo_agents before codex_agents when both exist', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'task2-duplicate-source-repo');
      const commandName = 'task2_codeinfo_agents_precedence';
      const conversationId = 'task2-codeinfo-agents-precedence';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'task2-codeinfo-agents-precedence',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        rootDirName: 'codeinfo_agents',
        commandName,
        content: 'preferred repository command',
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        rootDirName: 'codex_agents',
        commandName,
        content: 'legacy repository command',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Owner Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/task2-codeinfo-agents-precedence/run')
        .send({
          conversationId,
          sourceId: sourceRoot,
        })
        .expect(202);

      await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('preferred repository command'),
          ),
        3000,
      );
      assert.ok(
        turns.some(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('preferred repository command'),
        ),
      );
      assert.equal(
        turns.some(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('legacy repository command'),
        ),
        false,
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({ repos, lockedModelId: null }),
    },
  );
});

test('cross-repo flows resolve commands from the selected working repository before the flow owner', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'task2-source-repo');
      const workingRoot = path.join(tmpDir, 'task2-working-repo');
      const commandName = 'task2_cross_repo_working_repo_first';
      const conversationId = 'task2-cross-repo-working-repo-first';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'task2-cross-repo-working-repo-first',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        content: 'owner repository command',
      });
      await writeRepoCommand({
        repoRoot: workingRoot,
        commandName,
        content: 'working repository command',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Owner Repo' }),
        buildRepoEntry({ containerPath: workingRoot, id: 'Working Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/task2-cross-repo-working-repo-first/run')
        .send({
          conversationId,
          sourceId: sourceRoot,
          working_folder: workingRoot,
        })
        .expect(202);

      await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('working repository command'),
          ),
        3000,
      );
      assert.ok(
        turns.some(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('working repository command'),
        ),
      );

      const logs = query({ text: 'DEV_0000040_T11_FLOW_RESOLUTION_ORDER' });
      const selectedLog = logs.find(
        (entry) => entry.context?.decision === 'selected',
      );
      assert.equal(
        selectedLog?.context?.selectedRepositoryPath,
        path.resolve(workingRoot),
      );
      assert.equal(selectedLog?.context?.fallbackUsed, false);
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({ repos, lockedModelId: null }),
    },
  );
});

test('command resolution skips the working slot cleanly when no working repository is available', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'task2-owner-without-working');
      const otherRoot = path.join(tmpDir, 'task2-other-repo');
      const commandName = 'task2_missing_working_repo';
      const conversationId = 'task2-missing-working-repo';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'task2-missing-working-repo',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        content: 'owner repository command',
      });
      await writeRepoCommand({
        repoRoot: otherRoot,
        commandName,
        content: 'other repository command',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Owner Repo' }),
        buildRepoEntry({ containerPath: otherRoot, id: 'Other Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/task2-missing-working-repo/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
      const logs = query({ text: 'DEV_0000040_T11_FLOW_RESOLUTION_ORDER' });
      const selectedLog = logs.find(
        (entry) => entry.context?.decision === 'selected',
      );
      const candidateRepositories = Array.isArray(
        selectedLog?.context?.candidateRepositories,
      )
        ? (selectedLog.context.candidateRepositories as Array<{ slot: string }>)
        : [];
      assert.equal(selectedLog?.context?.workingRepositoryAvailable, false);
      assert.equal(
        selectedLog?.context?.selectedRepositoryPath,
        path.resolve(sourceRoot),
      );
      assert.deepEqual(
        candidateRepositories.map((item) => item.slot),
        ['owner_repository', 'codeinfo2', 'other_repository'],
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({ repos, lockedModelId: null }),
    },
  );
});

test('command resolution dedupes duplicate working and owner repositories', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'task2-dedupe-working-owner');
      const commandName = 'task2_dedupe_working_owner';
      const conversationId = 'task2-dedupe-working-owner';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'task2-dedupe-working-owner',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        content: 'single repository command',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/task2-dedupe-working-owner/run')
        .send({
          conversationId,
          sourceId: sourceRoot,
          working_folder: sourceRoot,
        })
        .expect(202);

      await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
      const logs = query({ text: 'DEV_0000040_T11_FLOW_RESOLUTION_ORDER' });
      const selectedLog = logs.find(
        (entry) => entry.context?.decision === 'selected',
      );
      const candidateRepositories = Array.isArray(
        selectedLog?.context?.candidateRepositories,
      )
        ? (selectedLog.context.candidateRepositories as Array<{
            sourceId: string;
            slot: string;
          }>)
        : [];
      const matchingCandidates =
        candidateRepositories.filter(
          (item) => item.sourceId === path.resolve(sourceRoot),
        ) ?? [];
      assert.equal(matchingCandidates.length, 1);
      assert.equal(matchingCandidates[0]?.slot, 'working_repository');
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({ repos, lockedModelId: null }),
    },
  );
});

test('command resolution dedupes duplicate working and local codeinfo2 repositories', async () => {
  const commandName = 'task2_dedupe_working_codeinfo2';
  const localCommandPath = path.join(
    repoRoot,
    'codeinfo_agents',
    'planning_agent',
    'commands',
    `${commandName}.json`,
  );

  try {
    await writeRepoCommand({
      repoRoot,
      commandName,
      rootDirName: 'codeinfo_agents',
      content: 'codeinfo2 repository command',
    });

    await withFlowServer(async ({ baseUrl, wsUrl, tmpDir }) => {
      const conversationId = 'task2-dedupe-working-codeinfo2';
      await fs.writeFile(
        path.join(tmpDir, 'task2-dedupe-working-codeinfo2.json'),
        JSON.stringify(makeFlowCommand({ commandName })),
      );
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/task2-dedupe-working-codeinfo2/run')
        .send({
          conversationId,
          working_folder: repoRoot,
        })
        .expect(202);

      await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
      const logs = query({ text: 'DEV_0000040_T11_FLOW_RESOLUTION_ORDER' });
      const selectedLog = logs.find(
        (entry) => entry.context?.decision === 'selected',
      );
      const candidateRepositories = Array.isArray(
        selectedLog?.context?.candidateRepositories,
      )
        ? (selectedLog.context.candidateRepositories as Array<{
            sourceId: string;
            slot: string;
          }>)
        : [];
      const matchingCandidates =
        candidateRepositories.filter(
          (item) => item.sourceId === path.resolve(repoRoot),
        ) ?? [];
      assert.equal(matchingCandidates.length, 1);
      assert.equal(matchingCandidates[0]?.slot, 'working_repository');
      cleanupMemory(conversationId);
    });
  } finally {
    await fs.rm(localCommandPath, { force: true });
  }
});

test('flow-owned command turns persist lookupSummary runtime metadata', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'task2-runtime-owner');
      const workingRoot = path.join(tmpDir, 'task2-runtime-working');
      const commandName = 'task2_runtime_lookup_summary';
      const conversationId = 'task2-runtime-lookup-summary';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'task2-runtime-lookup-summary',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        content: 'owner repository command',
      });
      await writeRepoCommand({
        repoRoot: workingRoot,
        commandName,
        content: 'working repository command',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Owner Repo' }),
        buildRepoEntry({ containerPath: workingRoot, id: 'Working Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/task2-runtime-lookup-summary/run')
        .send({
          conversationId,
          sourceId: sourceRoot,
          working_folder: workingRoot,
        })
        .expect(202);

      await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.runtime?.lookupSummary?.selectedRepositoryPath ===
              path.resolve(workingRoot),
          ),
        3000,
      );
      const commandTurns = turns.filter(
        (turn) =>
          turn.command?.name === 'flow' &&
          turn.runtime?.lookupSummary?.selectedRepositoryPath ===
            path.resolve(workingRoot),
      );
      assert.equal(commandTurns.length > 0, true);
      assert.equal(
        commandTurns[0]?.runtime?.lookupSummary?.fallbackUsed,
        false,
      );
      assert.equal(
        commandTurns[0]?.runtime?.lookupSummary?.workingRepositoryAvailable,
        true,
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({ repos, lockedModelId: null }),
    },
  );
});

test('flow-owned commands fail fast when a higher-priority markdown file is unreadable', async () => {
  const repos: RepoEntry[] = [];
  const commandName = 'task6_markdown_unreadable';
  const localMarkdownPath = path.join(
    repoRoot,
    'codeinfo_markdown',
    'unreadable-flow-cmd.md',
  );
  let sourceMarkdownPath = '';
  try {
    await fs.mkdir(path.dirname(localMarkdownPath), { recursive: true });
    await fs.writeFile(
      localMarkdownPath,
      'codeinfo2 fallback should not run',
      'utf8',
    );
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'repo-markdown-unreadable');
        const conversationId = 'flow-command-markdown-unreadable';
        sourceMarkdownPath = await writeMarkdownFile({
          repoRoot: sourceRoot,
          relativePath: 'unreadable-flow-cmd.md',
          content: 'source markdown',
        });
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-markdown-unreadable',
          commandName,
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [
            {
              type: 'message',
              role: 'user',
              markdownFile: 'unreadable-flow-cmd.md',
            },
          ],
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/repo-command-markdown-unreadable/run')
          .send({ conversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForFlowFinal({
          ws: wsUrl,
          conversationId,
          status: 'failed',
        });
        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) => turn.role === 'assistant' && turn.status === 'failed',
            ),
          3000,
        );
        const failedTurn = turns.find(
          (turn) => turn.role === 'assistant' && turn.status === 'failed',
        );
        assert.ok(failedTurn);
        assert.match(failedTurn.content, /permission denied/);
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
        markdownReadFile: async (filePath) => {
          if (filePath === sourceMarkdownPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
          }
          return fs.readFile(filePath);
        },
      },
    );
  } finally {
    await fs.rm(localMarkdownPath, { force: true });
  }
});

test('flow-owned command message execution matches the direct-command path for the same markdown-backed command', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-parity');
      const commandName = 'task6_parity_markdown';
      const flowConversationId = 'flow-command-parity';
      const directConversationId = 'direct-command-parity';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-parity-markdown',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [
          { type: 'message', role: 'user', markdownFile: 'parity.md' },
          { type: 'message', role: 'user', content: ['inline parity'] },
        ],
      });
      await writeMarkdownFile({
        repoRoot: sourceRoot,
        relativePath: 'parity.md',
        content: 'shared markdown parity',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, {
        type: 'subscribe_conversation',
        conversationId: flowConversationId,
      });
      await supertest(baseUrl)
        .post('/flows/repo-command-parity-markdown/run')
        .send({ conversationId: flowConversationId, sourceId: sourceRoot })
        .expect(202);
      await waitForFlowFinal({
        ws: wsUrl,
        conversationId: flowConversationId,
        status: 'ok',
      });

      await runAgentCommand({
        agentName: 'planning_agent',
        commandName,
        conversationId: directConversationId,
        sourceId: sourceRoot,
        source: 'REST',
        chatFactory: () => new ScriptedChat(),
      });

      const flowTurns = await waitForTurns(
        flowConversationId,
        (items) => items.filter((turn) => turn.role === 'user').length >= 2,
        3000,
      );
      const directTurns = await waitForTurns(
        directConversationId,
        (items) => items.filter((turn) => turn.role === 'user').length >= 2,
        3000,
      );
      assert.deepEqual(
        flowTurns
          .filter((turn) => turn.role === 'user')
          .map((turn) => turn.content),
        directTurns
          .filter((turn) => turn.role === 'user')
          .map((turn) => turn.content),
      );
      cleanupMemory(flowConversationId, directConversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('flow command-step retries and direct-command retries remain unchanged after shared message-item extraction', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '2';
  const repos: RepoEntry[] = [];
  const flowAttempts = { count: 0 };
  const directAttempts = { count: 0 };
  try {
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'repo-command-retry-shared');
        const commandName = 'task6_retry_markdown';
        const flowConversationId = 'flow-command-retry-shared';
        const directConversationId = 'direct-command-retry-shared';
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-retry-shared',
          commandName,
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [{ type: 'message', role: 'user', markdownFile: 'retry.md' }],
        });
        await writeMarkdownFile({
          repoRoot: sourceRoot,
          relativePath: 'retry.md',
          content: 'retry markdown item',
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        sendJson(wsUrl, {
          type: 'subscribe_conversation',
          conversationId: flowConversationId,
        });
        await supertest(baseUrl)
          .post('/flows/repo-command-retry-shared/run')
          .send({ conversationId: flowConversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForFlowFinal({
          ws: wsUrl,
          conversationId: flowConversationId,
          status: 'ok',
          timeoutMs: 6000,
        });
        assert.equal(flowAttempts.count, 2);

        await runAgentCommand({
          agentName: 'planning_agent',
          commandName,
          conversationId: directConversationId,
          sourceId: sourceRoot,
          source: 'REST',
          chatFactory: () => new FlakyOnceChat(directAttempts),
        });
        assert.equal(directAttempts.count, 2);
        cleanupMemory(flowConversationId, directConversationId);
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
        chatFactory: () => new FlakyOnceChat(flowAttempts),
      },
    );
  } finally {
    if (previousRetries === undefined) {
      delete process.env.FLOW_AND_COMMAND_RETRIES;
    } else {
      process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
    }
  }
});

test('flow-owned commands can execute reingest items', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-reingest-basic');
      const commandName = 'task11_reingest_basic';
      const conversationId = 'flow-command-reingest-basic';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-reingest-basic',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-reingest-basic/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) => items.length >= 2,
        4000,
      );
      assert.equal(turns[0]?.role, 'user');
      assert.equal(turns[1]?.role, 'assistant');
      assert.equal(
        (
          turns[1]?.toolCalls as {
            calls?: Array<{ result?: { kind?: string; status?: string } }>;
          } | null
        )?.calls?.[0]?.result?.kind,
        'reingest_step_result',
      );
      assert.equal(
        (
          turns[1]?.toolCalls as {
            calls?: Array<{ result?: { status?: string } }>;
          } | null
        )?.calls?.[0]?.result?.status,
        'completed',
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async () => ({
          ok: true,
          value: buildReingestSuccess(),
        }),
        createCallId: () => 'call-flow-basic',
      },
    },
  );
});

test('top-level flow target working reuses the selected repository path and preserves shared reingest default wait dispatch', async () => {
  const repos: RepoEntry[] = [];
  const calls: unknown[] = [];

  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-flow-working');
      const workingRoot = path.join(tmpDir, 'repo-flow-working-target');
      const conversationId = 'flow-target-working';
      await fs.mkdir(workingRoot, { recursive: true });
      await writeFlowFile({
        repoRoot: sourceRoot,
        flowName: 'repo-flow-working',
        steps: [{ type: 'reingest', target: 'working' }],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: workingRoot, id: 'Working Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-flow-working/run')
        .send({
          conversationId,
          sourceId: sourceRoot,
          working_folder: workingRoot,
        })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) => items.length >= 2,
        4000,
      );
      const toolCall = (
        turns[1]?.toolCalls as {
          calls?: Array<{
            stage?: string;
            result?: {
              targetMode?: string;
              sourceId?: string;
              resolvedRepositoryId?: string | null;
            };
          }>;
        } | null
      )?.calls?.[0];
      assert.deepEqual(calls, [{ sourceId: workingRoot }]);
      assert.equal(
        calls.every(
          (call) =>
            typeof call !== 'object' ||
            call === null ||
            !('waitOptions' in call),
        ),
        true,
      );
      assert.equal(toolCall?.stage, 'success');
      assert.equal(toolCall?.result?.targetMode, 'working');
      assert.equal(toolCall?.result?.sourceId, workingRoot);
      assert.equal(toolCall?.result?.resolvedRepositoryId, 'Working Repo');
      const task7Log = query({ text: 'DEV-0000052:T7:flow-reingest' }, 20).find(
        (entry) =>
          entry.context?.flowSurface === 'flow_step' &&
          entry.context?.flowName === 'repo-flow-working',
      );
      assert.equal(task7Log?.context?.targetMode, 'working');
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async (args) => {
          calls.push(args);
          const sourceId = args.sourceId;
          return {
            ok: true,
            value: buildReingestSuccess({
              sourceId: sourceId ?? '/missing',
              resolvedRepositoryId: 'Working Repo',
            }),
          };
        },
      },
    },
  );
});

test('top-level flow target working propagates wait-time queue-read outage as retryable QUEUE_UNAVAILABLE failure', async () => {
  const repos: RepoEntry[] = [];
  const calls: unknown[] = [];

  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-flow-working-wait-outage');
      const workingRoot = path.join(
        tmpDir,
        'repo-flow-working-wait-outage-target',
      );
      const conversationId = 'flow-target-working-wait-outage';
      await fs.mkdir(workingRoot, { recursive: true });
      await writeFlowFile({
        repoRoot: sourceRoot,
        flowName: 'repo-flow-working-wait-outage',
        steps: [{ type: 'reingest', target: 'working' }],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: workingRoot, id: 'Working Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-flow-working-wait-outage/run')
        .send({
          conversationId,
          sourceId: sourceRoot,
          working_folder: workingRoot,
        })
        .expect(202);

      const final = (await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'failed',
      })) as { error?: { message?: string } };
      assert.match(
        final.error?.message ?? '',
        /unavailable while waiting for re-ingest completion/i,
      );
      assert.deepEqual(calls, [{ sourceId: workingRoot }]);
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async (args) => {
          calls.push(args);
          const sourceId = args.sourceId ?? '/missing';
          return {
            ok: false,
            error: buildWaitTimeQueueUnavailableError({
              repositoryId: 'Working Repo',
              sourceId,
            }),
          };
        },
      },
    },
  );
});

test('top-level flow target working receives the structured OPENAI_MODEL_UNAVAILABLE reingest failure instead of a thrown flow exception', async () => {
  const repos: RepoEntry[] = [];
  const calls: unknown[] = [];

  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-flow-working-openai-outage');
      const workingRoot = path.join(
        tmpDir,
        'repo-flow-working-openai-outage-target',
      );
      const conversationId = 'flow-target-working-openai-outage';
      await fs.mkdir(workingRoot, { recursive: true });
      await writeFlowFile({
        repoRoot: sourceRoot,
        flowName: 'repo-flow-working-openai-outage',
        steps: [{ type: 'reingest', target: 'working' }],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: workingRoot, id: 'Working Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-flow-working-openai-outage/run')
        .send({
          conversationId,
          sourceId: sourceRoot,
          working_folder: workingRoot,
        })
        .expect(202);

      const final = (await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'failed',
      })) as { error?: { message?: string } };
      assert.equal(
        final.error?.message,
        'Requested OpenAI embedding model is unavailable for this deployment',
      );
      assert.deepEqual(calls, [{ sourceId: workingRoot }]);
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async (args) => {
          calls.push(args);
          const sourceId = args.sourceId ?? '/missing';
          return {
            ok: false,
            error: {
              code: 409,
              message: 'OPENAI_MODEL_UNAVAILABLE',
              data: {
                tool: 'reingest_repository',
                code: 'OPENAI_MODEL_UNAVAILABLE',
                retryable: true,
                retryMessage: 'retry later',
                reingestableRepositoryIds: ['Working Repo'],
                reingestableSourceIds: [sourceId],
                fieldErrors: [
                  {
                    field: 'sourceId',
                    reason: 'invalid_state',
                    message:
                      'Requested OpenAI embedding model is unavailable for this deployment',
                  },
                ],
              },
            },
          };
        },
      },
    },
  );
});

test('top-level flow target plan_scope keeps working-first and handoff order', async () => {
  const repos: RepoEntry[] = [];
  const calls: string[] = [];

  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-flow-plan-scope');
      const fixture = await createPlanScopeFixture({
        tempPrefix: 'flows-plan-scope-working-',
        workingRepositoryName: 'flow-working-repo',
        additionalRepositories: [{ name: 'repo-a' }, { name: 'repo-b' }],
      });

      try {
        const conversationId = 'flow-target-plan-scope';
        await writeFlowFile({
          repoRoot: sourceRoot,
          flowName: 'repo-flow-plan-scope',
          steps: [{ type: 'reingest', target: 'plan_scope' }],
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
          buildRepoEntry({
            containerPath: fixture.workingRepositoryPath,
            id: 'Working Repo',
          }),
          buildRepoEntry({
            containerPath: fixture.additionalRepositoryPaths[0]!,
            id: 'Repo A',
          }),
          buildRepoEntry({
            containerPath: fixture.additionalRepositoryPaths[1]!,
            id: 'Repo B',
          }),
        );

        await fs.writeFile(
          fixture.currentPlanPath,
          JSON.stringify(
            {
              plan_path:
                'planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md',
              branched_from: 'main',
              additional_repositories: [
                { path: fixture.additionalRepositoryPaths[1] },
                { path: fixture.additionalRepositoryPaths[0] },
              ],
            },
            null,
            2,
          ),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/repo-flow-plan-scope/run')
          .send({
            conversationId,
            sourceId: sourceRoot,
            working_folder: fixture.workingRepositoryPath,
          })
          .expect(202);

        await waitForFlowFinal({
          ws: wsUrl,
          conversationId,
          status: 'ok',
        });
        const turns = await waitForTurns(
          conversationId,
          (items) => items.length >= 2,
          4000,
        );
        const toolCall = (
          turns[1]?.toolCalls as {
            calls?: Array<{
              stage?: string;
              result?: {
                targetMode?: string;
                repositories?: Array<{ sourceId?: string }>;
                warnings?: unknown[];
              };
            }>;
          } | null
        )?.calls?.[0];

        assert.deepEqual(calls, [
          fixture.workingRepositoryPath,
          fixture.additionalRepositoryPaths[1],
          fixture.additionalRepositoryPaths[0],
        ]);
        assert.equal(toolCall?.stage, 'success');
        assert.equal(toolCall?.result?.targetMode, 'plan_scope');
        assert.deepEqual(
          toolCall?.result?.repositories?.map(
            (repository) => repository.sourceId,
          ),
          [
            fixture.workingRepositoryPath,
            fixture.additionalRepositoryPaths[1],
            fixture.additionalRepositoryPaths[0],
          ],
        );
        assert.deepEqual(toolCall?.result?.warnings ?? [], []);
        const task7Log = query(
          { text: 'DEV-0000052:T7:flow-reingest' },
          20,
        ).find(
          (entry) =>
            entry.context?.flowSurface === 'flow_step' &&
            entry.context?.flowName === 'repo-flow-plan-scope',
        );
        assert.equal(task7Log?.context?.targetMode, 'plan_scope');
        cleanupMemory(conversationId);
      } finally {
        await fixture.cleanup();
      }
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async ({ sourceId }) => {
          calls.push(sourceId ?? '(missing)');
          return {
            ok: true,
            value: buildReingestSuccess({
              sourceId: sourceId ?? '/missing',
              resolvedRepositoryId:
                sourceId === repos[1]?.containerPath
                  ? 'Working Repo'
                  : sourceId === repos[2]?.containerPath
                    ? 'Repo A'
                    : 'Repo B',
            }),
          };
        },
      },
    },
  );
});

test('flow-owned command target working reuses the selected working repository path', async () => {
  const repos: RepoEntry[] = [];
  const calls: string[] = [];

  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-working');
      const workingRoot = path.join(tmpDir, 'repo-command-working-target');
      const commandName = 'task11_reingest_working';
      const conversationId = 'flow-command-target-working';
      await fs.mkdir(workingRoot, { recursive: true });
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-working',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [{ type: 'reingest', target: 'working' }],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: workingRoot, id: 'Working Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-working/run')
        .send({
          conversationId,
          sourceId: sourceRoot,
          working_folder: workingRoot,
        })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) => items.length >= 2,
        4000,
      );
      const toolCall = (
        turns[1]?.toolCalls as {
          calls?: Array<{
            stage?: string;
            result?: {
              targetMode?: string;
              sourceId?: string;
              resolvedRepositoryId?: string | null;
            };
          }>;
        } | null
      )?.calls?.[0];
      assert.deepEqual(calls, [workingRoot]);
      assert.equal(toolCall?.stage, 'success');
      assert.equal(toolCall?.result?.targetMode, 'working');
      assert.equal(toolCall?.result?.sourceId, workingRoot);
      assert.equal(toolCall?.result?.resolvedRepositoryId, 'Working Repo');
      const task7Log = query({ text: 'DEV-0000052:T7:flow-reingest' }, 20).find(
        (entry) =>
          entry.context?.flowSurface === 'flow_command' &&
          entry.context?.commandName === commandName,
      );
      assert.equal(task7Log?.context?.targetMode, 'working');
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async ({ sourceId }) => {
          calls.push(sourceId ?? '(missing)');
          return {
            ok: true,
            value: buildReingestSuccess({
              sourceId: sourceId ?? '/missing',
              resolvedRepositoryId: 'Working Repo',
            }),
          };
        },
      },
    },
  );
});

test('top-level flow target working fails fast when there is no owning repository path', async () => {
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const conversationId = 'flow-target-working-missing-owner';
      await fs.writeFile(
        path.join(tmpDir, 'flow-working-missing-owner.json'),
        JSON.stringify({
          description: 'missing owner',
          steps: [{ type: 'reingest', target: 'working' }],
        }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/flow-working-missing-owner/run')
        .send({ conversationId })
        .expect(202);

      const final = (await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'failed',
      })) as { error?: { message?: string } };
      assert.match(
        final.error?.message ?? '',
        /target "working" requires a selected working repository path/i,
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos: [],
        lockedModelId: null,
      }),
    },
  );
});

test('flow-owned command target plan_scope preserves degraded-startup diagnostics in warnings while continuing after failures', async () => {
  const repos: RepoEntry[] = [];
  const calls: string[] = [];

  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-plan-scope');
      const commandName = 'task11_reingest_plan_scope';
      const fixture = await createPlanScopeFixture({
        tempPrefix: 'flows-command-plan-scope-',
        workingRepositoryName: 'flow-command-working',
        additionalRepositories: [{ name: 'repo-a' }, { name: 'repo-b' }],
      });
      const missingAdditionalPath = path.join(fixture.rootDir, 'repo-missing');
      const conversationId = 'flow-command-plan-scope-success';

      try {
        await writeFlowFile({
          repoRoot: sourceRoot,
          flowName: 'repo-command-plan-scope',
          steps: [
            {
              type: 'command',
              agentType: 'planning_agent',
              identifier: 'repo-agent',
              commandName,
            },
            {
              type: 'llm',
              agentType: 'planning_agent',
              identifier: 'planner',
              messages: [{ role: 'user', content: ['after flow step'] }],
            },
          ],
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [
            { type: 'reingest', target: 'plan_scope' },
            { type: 'message', role: 'user', content: ['after command item'] },
          ],
        });
        await fs.writeFile(
          fixture.currentPlanPath,
          JSON.stringify(
            {
              plan_path:
                'planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md',
              branched_from: 'main',
              additional_repositories: [
                { path: fixture.workingRepositoryPath },
                { path: fixture.additionalRepositoryPaths[0] },
                { path: missingAdditionalPath },
                { path: fixture.additionalRepositoryPaths[1] },
              ],
            },
            null,
            2,
          ),
        );
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
          buildRepoEntry({
            containerPath: fixture.workingRepositoryPath,
            id: 'Working Repo',
          }),
          buildRepoEntry({
            containerPath: fixture.additionalRepositoryPaths[0]!,
            id: 'Repo A',
          }),
          buildRepoEntry({
            containerPath: fixture.additionalRepositoryPaths[1]!,
            id: 'Repo B',
          }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        const toolEventPromise = waitForEvent({
          ws: wsUrl,
          predicate: (
            raw: unknown,
          ): raw is {
            type: 'tool_event';
            conversationId: string;
            event: {
              type: 'tool-result';
              stage?: string;
              result?: {
                targetMode?: string;
                warnings?: Array<{ code?: string; message?: string }>;
              };
            };
          } => {
            const candidate = raw as {
              type?: string;
              conversationId?: string;
              event?: {
                type?: string;
                stage?: string;
                result?: {
                  targetMode?: string;
                  warnings?: Array<{ code?: string; message?: string }>;
                };
              };
            };
            return (
              candidate.type === 'tool_event' &&
              candidate.conversationId === conversationId &&
              candidate.event?.type === 'tool-result' &&
              candidate.event?.result?.targetMode === 'plan_scope'
            );
          },
          timeoutMs: 5000,
        });

        await supertest(baseUrl)
          .post('/flows/repo-command-plan-scope/run')
          .send({
            conversationId,
            sourceId: sourceRoot,
            working_folder: fixture.workingRepositoryPath,
          })
          .expect(202);

        const toolEvent = await toolEventPromise;
        await waitForFlowFinal({
          ws: wsUrl,
          conversationId,
          status: 'ok',
        });
        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some((turn) => turn.content.includes('after command item')) &&
            items.some((turn) => turn.content.includes('after flow step')),
          4000,
        );

        const assistantWithToolCall = turns.find(
          (turn) => turn.role === 'assistant' && turn.toolCalls,
        );
        const toolCall = (
          assistantWithToolCall?.toolCalls as {
            calls?: Array<{
              stage?: string;
              result?: {
                targetMode?: string;
                repositories?: Array<{ sourceId?: string }>;
                warnings?: Array<{ code?: string; message?: string }>;
              };
            }>;
          } | null
        )?.calls?.[0];

        assert.equal(toolEvent.event.stage, 'success');
        assert.deepEqual(
          toolEvent.event.result?.warnings?.map((warning) => warning.code),
          ['repository_skipped', 'repository_skipped', 'repository_failed'],
        );
        assert.equal(
          toolEvent.event.result?.warnings?.[2]?.message?.includes(
            'Mongo-backed ingest queue is unavailable because Mongo connection failed during startup',
          ),
          true,
        );
        assert.deepEqual(calls, [
          fixture.workingRepositoryPath,
          fixture.additionalRepositoryPaths[0],
          fixture.additionalRepositoryPaths[1],
        ]);
        assert.equal(toolCall?.stage, 'success');
        assert.equal(toolCall?.result?.targetMode, 'plan_scope');
        assert.deepEqual(
          toolCall?.result?.repositories?.map(
            (repository) => repository.sourceId,
          ),
          [
            fixture.workingRepositoryPath,
            fixture.additionalRepositoryPaths[0],
            fixture.additionalRepositoryPaths[1],
          ],
        );
        assert.deepEqual(
          toolCall?.result?.warnings?.map((warning) => warning.code),
          ['repository_skipped', 'repository_skipped', 'repository_failed'],
        );
        assert.equal(
          toolCall?.result?.warnings?.[2]?.message?.includes(
            'Mongo-backed ingest queue is unavailable because Mongo connection failed during startup',
          ),
          true,
        );
        assert.match(
          turns[0]?.content ?? '',
          /Record re-ingest result for plan scope with warnings/i,
        );
        assert.ok(
          turns.some((turn) =>
            turn.content.includes(
              'Plan-scope re-ingest recorded for 3 repositories (2 reingested, 0 skipped, 1 failed). Warning count: 3.',
            ),
          ),
        );
        assert.equal(
          turns.some((turn) => turn.content.includes('after command item')),
          true,
        );
        assert.equal(
          turns.some((turn) => turn.content.includes('after flow step')),
          true,
        );
        assert.doesNotMatch(
          turns.map((turn) => turn.content).join(' '),
          /all ingested repositories|all repositories/i,
        );
        const task7Log = query(
          { text: 'DEV-0000052:T7:flow-reingest' },
          20,
        ).find(
          (entry) =>
            entry.context?.flowSurface === 'flow_command' &&
            entry.context?.commandName === commandName,
        );
        assert.equal(task7Log?.context?.targetMode, 'plan_scope');
        await cleanupConversationRuntime(conversationId);
      } finally {
        await fixture.cleanup();
      }
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async ({ sourceId }) => {
          calls.push(sourceId ?? '(missing)');
          if (sourceId === repos[2]?.containerPath) {
            return {
              ok: false,
              error: {
                code: 503,
                message: 'QUEUE_UNAVAILABLE',
                data: {
                  tool: 'reingest_repository',
                  code: 'QUEUE_UNAVAILABLE',
                  retryable: true,
                  retryMessage: 'retry later',
                  reingestableRepositoryIds: ['Repo A'],
                  reingestableSourceIds: [repos[2]?.containerPath ?? ''],
                  fieldErrors: [
                    {
                      field: 'sourceId',
                      reason: 'invalid_state',
                      message:
                        'Mongo-backed ingest queue is unavailable because Mongo connection failed during startup',
                    },
                  ],
                },
              },
            };
          }
          return {
            ok: true,
            value: buildReingestSuccess({
              sourceId: sourceId ?? '/missing',
              resolvedRepositoryId:
                sourceId === repos[1]?.containerPath
                  ? 'Working Repo'
                  : 'Repo B',
            }),
          };
        },
        createCallId: () => 'call-flow-plan-scope',
      },
    },
  );
});

test('flow-owned command reingest results publish live tool_event updates', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-reingest-live');
      const commandName = 'task11_reingest_live';
      const conversationId = 'flow-command-reingest-live';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-reingest-live',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-reingest-live/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      const event = await waitForEvent({
        ws: wsUrl,
        predicate: (
          raw: unknown,
        ): raw is {
          type: 'tool_event';
          conversationId: string;
          event: {
            type: 'tool-result';
            callId: string;
            name: string;
            result?: { kind?: string; status?: string };
          };
        } => {
          const candidate = raw as {
            type?: string;
            conversationId?: string;
            event?: {
              type?: string;
              callId?: string;
              name?: string;
              result?: { kind?: string; status?: string };
            };
          };
          return (
            candidate.type === 'tool_event' &&
            candidate.conversationId === conversationId &&
            candidate.event?.type === 'tool-result' &&
            candidate.event?.name === 'reingest_repository'
          );
        },
        timeoutMs: 5000,
      });

      assert.equal(event.event.callId, 'call-flow-live');
      assert.equal(event.event.result?.kind, 'reingest_step_result');
      assert.equal(event.event.result?.status, 'completed');
      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async () => ({
          ok: true,
          value: buildReingestSuccess(),
        }),
        createCallId: () => 'call-flow-live',
      },
    },
  );
});

test('flow-owned command reingest results persist through assistant toolCalls storage', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-reingest-persisted');
      const commandName = 'task11_reingest_persisted';
      const conversationId = 'flow-command-reingest-persisted';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-reingest-persisted',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-reingest-persisted/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) => items.length >= 2,
        4000,
      );
      assert.deepEqual(turns[1]?.toolCalls, {
        calls: [
          {
            type: 'tool-result',
            callId: 'call-flow-persisted',
            name: 'reingest_repository',
            stage: 'success',
            result: {
              kind: 'reingest_step_result',
              stepType: 'reingest',
              targetMode: 'sourceId',
              requestedSelector: '/repo/source-a',
              sourceId: '/repo/source-a',
              resolvedRepositoryId: 'repo-a',
              outcome: 'reingested',
              status: 'completed',
              completionMode: 'reingested',
              operation: 'reembed',
              runId: 'run-123',
              files: 3,
              chunks: 7,
              embedded: 7,
              errorCode: null,
            },
            error: null,
          },
        ],
      });
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async () => ({
          ok: true,
          value: buildReingestSuccess(),
        }),
        createCallId: () => 'call-flow-persisted',
      },
    },
  );
});

test('repeated flow-owned command reingest items keep distinct callIds', async () => {
  const callIds = ['call-flow-a', 'call-flow-b'];
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-reingest-double');
      const commandName = 'task11_reingest_double';
      const conversationId = 'flow-command-reingest-double';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-reingest-double',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'reingest', sourceId: '/repo/source-a' },
        ],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-reingest-double/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.filter((turn) => turn.role === 'assistant').length >= 2,
        4000,
      );
      assert.deepEqual(
        turns
          .filter((turn) => turn.role === 'assistant')
          .map(
            (turn) =>
              (
                turn.toolCalls as {
                  calls?: Array<{ callId: string }>;
                } | null
              )?.calls?.[0]?.callId,
          ),
        ['call-flow-a', 'call-flow-b'],
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async () => ({
          ok: true,
          value: buildReingestSuccess(),
        }),
        createCallId: () => {
          const next = callIds.shift();
          if (!next) {
            throw new Error('missing callId');
          }
          return next;
        },
      },
    },
  );
});

test('flow-owned commands preserve ordering across reingest, markdown, and inline items', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-reingest-mixed');
      const commandName = 'task11_reingest_markdown_inline';
      const conversationId = 'flow-command-reingest-mixed';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-reingest-mixed',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'message', role: 'user', markdownFile: 'step.md' },
          { type: 'message', role: 'user', content: ['inline'] },
        ],
      });
      await writeMarkdownFile({
        repoRoot: sourceRoot,
        relativePath: 'step.md',
        content: '# Step markdown\n\nBody',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-reingest-mixed/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) => items.length >= 6,
        4000,
      );
      assert.equal(
        (
          turns[1]?.toolCalls as {
            calls?: Array<{ callId: string }>;
          } | null
        )?.calls?.[0]?.callId,
        'call-flow-mixed',
      );
      assert.equal(turns[2]?.content, '# Step markdown\n\nBody');
      assert.equal(turns[4]?.content, 'inline');
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async () => ({
          ok: true,
          value: buildReingestSuccess(),
        }),
        createCallId: () => 'call-flow-mixed',
      },
    },
  );
});

test('cancellation during flow-owned command reingest stops later items and later flow steps', async () => {
  const commandName = 'task11_reingest_stop';
  const conversationId = 'flow-command-reingest-stop';
  let resolveRun!: (value: {
    ok: true;
    value: ReturnType<typeof buildReingestSuccess>;
  }) => void;
  let markStarted!: () => void;
  let runToken = '';
  const runPromise = new Promise<{
    ok: true;
    value: ReturnType<typeof buildReingestSuccess>;
  }>((resolve) => {
    resolveRun = resolve;
  });
  const startedPromise = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const flowName = 'repo-command-reingest-stop';
      const sourceRoot = path.join(tmpDir, flowName);
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName,
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'message', role: 'user', content: ['after command item'] },
        ],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post(`/flows/${flowName}/run`)
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await withTimeout(
        startedPromise,
        4000,
        'Timed out waiting for flow-command reingest cancellation start',
      );
      resolveRun({
        ok: true,
        value: buildReingestSuccess(),
      });

      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) => turn.role === 'assistant' && turn.status === 'stopped',
          ) &&
          items.some((turn) => turn.role === 'assistant' && turn.toolCalls),
        4000,
      );
      await delay(150);
      assert.equal(
        turns.some((turn) => turn.role === 'assistant' && turn.toolCalls),
        true,
      );
      assert.equal(
        turns.some(
          (turn) => turn.role === 'assistant' && turn.status === 'stopped',
        ),
        true,
      );
      assert.equal(
        turns.some((turn) => turn.content.includes('after command item')),
        false,
      );
      assert.equal(
        turns.some((turn) => turn.content.includes('after flow step')),
        false,
      );
      assert.equal(
        (memoryTurns.get(conversationId) ?? []).some(
          (turn) => turn.role === 'assistant' && turn.status === 'stopped',
        ),
        true,
      );
      await cleanupConversationRuntime(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async () => {
          markStarted();
          const runTokenDeadline = Date.now() + 1000;
          while (!runToken && Date.now() < runTokenDeadline) {
            runToken =
              getActiveRunOwnership(conversationId)?.runToken ?? runToken;
            await delay(10);
          }
          assert.notEqual(runToken, '');
          registerPendingConversationCancel({
            conversationId,
            runToken,
          });
          return runPromise;
        },
        createCallId: () => 'call-flow-stop',
      },
    },
  );
});

test('flow-owned command message retries remain intact after adding reingest support', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '2';
  const flowAttempts = { count: 0 };
  const repos: RepoEntry[] = [];
  try {
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'repo-command-retry-task11');
        const commandName = 'task11_message_retry';
        const conversationId = 'flow-command-retry-task11';
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-retry-task11',
          commandName,
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [{ type: 'message', role: 'user', content: ['retry me'] }],
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/repo-command-retry-task11/run')
          .send({ conversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForFlowFinal({
          ws: wsUrl,
          conversationId,
          status: 'ok',
          timeoutMs: 6000,
        });
        assert.equal(flowAttempts.count, 2);
        cleanupMemory(conversationId);
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
        chatFactory: () => new FlakyOnceChat(flowAttempts),
      },
    );
  } finally {
    if (previousRetries === undefined) {
      delete process.env.FLOW_AND_COMMAND_RETRIES;
    } else {
      process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
    }
  }
});

test('flow-owned command reingest items stay single-attempt while later message items can retry', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '2';
  const flowAttempts = { count: 0 };
  let reingestCalls = 0;
  const repos: RepoEntry[] = [];
  try {
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'repo-command-reingest-retry');
        const commandName = 'task11_reingest_then_retry';
        const conversationId = 'flow-command-reingest-retry';
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-reingest-retry',
          commandName,
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [
            { type: 'reingest', sourceId: '/repo/source-a' },
            {
              type: 'message',
              role: 'user',
              content: ['retry after reingest'],
            },
          ],
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/repo-command-reingest-retry/run')
          .send({ conversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForTurns(
          conversationId,
          (items) => items.length >= 4,
          12000,
        );
        assert.equal(reingestCalls, 1);
        assert.equal(flowAttempts.count, 2);
        cleanupMemory(conversationId);
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
        chatFactory: () => new FlakyOnceChat(flowAttempts),
        flowServiceDeps: {
          runReingestRepository: async () => {
            reingestCalls += 1;
            return {
              ok: true,
              value: buildReingestSuccess(),
            };
          },
          createCallId: () => 'call-flow-retry',
        },
      },
    );
  } finally {
    if (previousRetries === undefined) {
      delete process.env.FLOW_AND_COMMAND_RETRIES;
    } else {
      process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
    }
  }

  const logs = query(
    { text: 'DEV-0000045:T11:flow_command_reingest_recorded' },
    10,
  );
  assert.equal(
    logs.some(
      (item) =>
        item.message === 'DEV-0000045:T11:flow_command_reingest_recorded',
    ),
    true,
  );
});

test('RED: repository flow should resolve same-source command before fallback ordering', async () => {
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-source');
      const sourceCommandDir = path.join(
        sourceRoot,
        'codex_agents',
        'planning_agent',
        'commands',
      );
      const sourceFlowDir = path.join(sourceRoot, 'flows');
      await fs.mkdir(sourceCommandDir, { recursive: true });
      await fs.mkdir(sourceFlowDir, { recursive: true });

      await fs.writeFile(
        path.join(sourceCommandDir, 'source_only_command.json'),
        JSON.stringify({
          Description: 'repo command',
          items: [{ type: 'message', role: 'user', content: ['repo step'] }],
        }),
      );
      await fs.writeFile(
        path.join(sourceFlowDir, 'repo-command.json'),
        JSON.stringify({
          description: 'repo flow command',
          steps: [
            {
              type: 'command',
              agentType: 'planning_agent',
              identifier: 'repo-agent',
              commandName: 'source_only_command',
            },
          ],
        }),
      );

      const conversationId = 'flow-command-source-order-red';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/repo-command/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      const final = await waitForEvent({
        ws: wsUrl,
        predicate: (
          event: unknown,
        ): event is { type: 'turn_final'; status: string } => {
          const e = event as {
            type?: string;
            conversationId?: string;
            status?: string;
          };
          return (
            e.type === 'turn_final' &&
            e.conversationId === conversationId &&
            e.status === 'ok'
          );
        },
        timeoutMs: 5000,
      });
      assert.equal(final.status, 'ok');
    },
    {
      listIngestedRepositories: async (tmpDir) => ({
        repos: [
          buildRepoEntry({ containerPath: path.join(tmpDir, 'repo-source') }),
        ],
        lockedModelId: null,
      }),
    },
  );
});

test('same-source missing command falls back to codeInfo2 repository', async () => {
  const commandName = 'task11_codeinfo2_fallback_command';
  const localCommandPath = path.join(
    repoRoot,
    'codeinfo_agents',
    'planning_agent',
    'commands',
    `${commandName}.json`,
  );

  await writeRepoCommand({
    repoRoot: repoRoot,
    commandName,
    rootDirName: 'codeinfo_agents',
    content: 'codeinfo2 fallback step',
  });

  try {
    const repos: RepoEntry[] = [];
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'source-repo');
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-codeinfo2',
          commandName,
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        const conversationId = 'flow-command-codeinfo2-fallback';
        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

        await supertest(baseUrl)
          .post('/flows/repo-command-codeinfo2/run')
          .send({ conversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForEvent({
          ws: wsUrl,
          predicate: (
            event: unknown,
          ): event is { type: 'turn_final'; status: string } => {
            const e = event as {
              type?: string;
              conversationId?: string;
              status?: string;
            };
            return (
              e.type === 'turn_final' &&
              e.conversationId === conversationId &&
              e.status === 'ok'
            );
          },
          timeoutMs: 5000,
        });

        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes('codeinfo2 fallback step'),
            ),
          3000,
        );
        assert.ok(
          turns.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('codeinfo2 fallback step'),
          ),
        );
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
      },
    );
  } finally {
    await fs.rm(localCommandPath, { force: true });
  }
});

test('other repositories preserve caller-supplied order instead of sorting by label', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo');
      const otherA = path.join(tmpDir, 'alpha-repo');
      const otherB = path.join(tmpDir, 'beta-repo');
      const commandName = 'task11_ordered_other_repo_command';

      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-other-order',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: otherA,
        commandName,
        content: 'other-alpha',
      });
      await writeRepoCommand({
        repoRoot: otherB,
        commandName,
        content: 'other-beta',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherB, id: 'Zulu' }),
        buildRepoEntry({ containerPath: otherA, id: 'Alpha' }),
      );

      const conversationId = 'flow-command-other-order';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/repo-command-other-order/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForEvent({
        ws: wsUrl,
        predicate: (
          event: unknown,
        ): event is { type: 'turn_final'; status: string } => {
          const e = event as {
            type?: string;
            conversationId?: string;
            status?: string;
          };
          return (
            e.type === 'turn_final' &&
            e.conversationId === conversationId &&
            e.status === 'ok'
          );
        },
        timeoutMs: 5000,
      });

      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.role === 'user' && turn.content.includes('other-beta'),
          ),
        3000,
      );
      assert.ok(
        turns.some(
          (turn) => turn.role === 'user' && turn.content.includes('other-beta'),
        ),
      );
      assert.equal(
        turns.some(
          (turn) =>
            turn.role === 'user' && turn.content.includes('other-alpha'),
        ),
        false,
      );
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('same-source schema-invalid command fails fast without fallback', async () => {
  const commandName = 'task11_schema_invalid';
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo-invalid');
      const otherRoot = path.join(tmpDir, 'other-repo-valid');
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-invalid-same-source',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        invalidSchema: true,
      });
      await writeRepoCommand({
        repoRoot: otherRoot,
        commandName,
        content: 'fallback should not run',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherRoot, id: 'Other Repo' }),
      );

      const res = await supertest(baseUrl)
        .post('/flows/repo-command-invalid-same-source/run')
        .send({ sourceId: sourceRoot })
        .expect(400);
      assert.equal(res.body.error, 'invalid_request');
      assert.match(String(res.body.message ?? ''), /schema validation/i);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('same-source parse failure fails fast without fallback', async () => {
  const commandName = 'task11_parse_invalid';
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo-parse');
      const otherRoot = path.join(tmpDir, 'other-repo-parse');
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-parse-invalid',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        invalidJson: true,
      });
      await writeRepoCommand({
        repoRoot: otherRoot,
        commandName,
        content: 'parse fallback should not run',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherRoot, id: 'Other Repo' }),
      );

      const res = await supertest(baseUrl)
        .post('/flows/repo-command-parse-invalid/run')
        .send({ sourceId: sourceRoot })
        .expect(400);
      assert.equal(res.body.error, 'invalid_request');
      assert.match(String(res.body.message ?? ''), /schema validation/i);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('command not found across all candidates fails deterministically', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo-none');
      const otherRoot = path.join(tmpDir, 'other-repo-none');
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-all-missing',
        commandName: 'missing_everywhere',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherRoot, id: 'Other Repo' }),
      );

      const res = await supertest(baseUrl)
        .post('/flows/repo-command-all-missing/run')
        .send({ sourceId: sourceRoot })
        .expect(400);
      assert.equal(res.body.error, 'invalid_request');
      assert.match(String(res.body.message ?? ''), /not found/i);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('other-repo ordering preserves caller order even when sourceLabel has whitespace', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo-trim');
      const otherA = path.join(tmpDir, 'trim-a');
      const otherB = path.join(tmpDir, 'trim-b');
      const commandName = 'task11_trimmed_label';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-trim-label',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: otherA,
        commandName,
        content: 'trim-a',
      });
      await writeRepoCommand({
        repoRoot: otherB,
        commandName,
        content: 'trim-b',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherB, id: '  Zeta  ' }),
        buildRepoEntry({ containerPath: otherA, id: '  Alpha  ' }),
      );

      const conversationId = 'flow-command-trim-order';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-trim-label/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForEvent({
        ws: wsUrl,
        predicate: (
          event: unknown,
        ): event is { type: 'turn_final'; status: string } => {
          const e = event as {
            type?: string;
            conversationId?: string;
            status?: string;
          };
          return (
            e.type === 'turn_final' &&
            e.conversationId === conversationId &&
            e.status === 'ok'
          );
        },
        timeoutMs: 5000,
      });
      const turns = memoryTurns.get(conversationId) ?? [];
      assert.ok(
        turns.some(
          (turn) => turn.role === 'user' && turn.content.includes('trim-b'),
        ),
      );
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('other-repo ordering preserves caller order when sourceLabel falls back to basename', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo-basename');
      const otherA = path.join(tmpDir, 'aaa-basename');
      const otherB = path.join(tmpDir, 'zzz-basename');
      const commandName = 'task11_basename_label';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-basename-label',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: otherA,
        commandName,
        content: 'basename-a',
      });
      await writeRepoCommand({
        repoRoot: otherB,
        commandName,
        content: 'basename-b',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherB, id: ' ' }),
        buildRepoEntry({ containerPath: otherA, id: '' }),
      );

      const conversationId = 'flow-command-basename-order';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-basename-label/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.filter((turn) => turn.role === 'assistant').length >= 1,
        5000,
        () =>
          JSON.stringify({
            state: JSON.parse(describeFlowRuntimeState(conversationId)),
          }),
      );
      assert.ok(
        turns.some(
          (turn) => turn.role === 'user' && turn.content.includes('basename-b'),
        ),
      );
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('other-repo ordering preserves caller order when labels only differ by case', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo-path-tie');
      const otherA = path.join(tmpDir, 'aaa-tie');
      const otherB = path.join(tmpDir, 'bbb-tie');
      const commandName = 'task11_path_tie';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-path-tie',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: otherA,
        commandName,
        content: 'tie-a',
      });
      await writeRepoCommand({
        repoRoot: otherB,
        commandName,
        content: 'tie-b',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherB, id: 'same-label' }),
        buildRepoEntry({ containerPath: otherA, id: 'SAME-LABEL' }),
      );

      const conversationId = 'flow-command-path-tie-order';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-path-tie/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForEvent({
        ws: wsUrl,
        predicate: (
          event: unknown,
        ): event is { type: 'turn_final'; status: string } => {
          const e = event as {
            type?: string;
            conversationId?: string;
            status?: string;
          };
          return (
            e.type === 'turn_final' &&
            e.conversationId === conversationId &&
            e.status === 'ok'
          );
        },
        timeoutMs: 5000,
      });
      const turns = memoryTurns.get(conversationId) ?? [];
      assert.ok(
        turns.some(
          (turn) => turn.role === 'user' && turn.content.includes('tie-b'),
        ),
      );
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('invalid command steps return 400 invalid_request', async () => {
  await withFlowServer(async ({ baseUrl, tmpDir }) => {
    const invalidFlow = {
      description: 'Invalid command flow',
      steps: [
        {
          type: 'command',
          agentType: 'planning_agent',
          identifier: 'missing-command',
          commandName: 'missing_command',
        },
      ],
    };
    await fs.writeFile(
      path.join(tmpDir, 'command-missing.json'),
      JSON.stringify(invalidFlow, null, 2),
    );

    const res = await supertest(baseUrl)
      .post('/flows/command-missing/run')
      .send({})
      .expect(400);

    assert.equal(res.body.error, 'invalid_request');
  });
});

test('command-load failures are retried and then fail deterministically', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '2';
  const commandName = 'task5_retry_temp_command';
  const commandPath = path.join(
    repoRoot,
    'codeinfo_agents',
    'planning_agent',
    'commands',
    `${commandName}.json`,
  );
  await fs.writeFile(
    commandPath,
    JSON.stringify({
      Description: 'Temporary command for Task 5 retry test',
      items: [{ type: 'message', role: 'user', content: ['temporary step'] }],
    }),
  );
  await withFlowServer(async ({ baseUrl, wsUrl, tmpDir }) => {
    const conversationId = 'flow-command-missing-retry-conv';
    sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

    const retryFlow = {
      description: 'Retry missing command',
      steps: [
        {
          type: 'llm',
          agentType: 'planning_agent',
          identifier: 'prep',
          messages: [{ role: 'user', content: ['__delay:300::prep'] }],
        },
        {
          type: 'command',
          agentType: 'planning_agent',
          identifier: 'missing-command',
          commandName,
        },
      ],
    };
    await fs.writeFile(
      path.join(tmpDir, 'command-missing-retry.json'),
      JSON.stringify(retryFlow, null, 2),
    );

    await supertest(baseUrl)
      .post('/flows/command-missing-retry/run')
      .send({ conversationId })
      .expect(202);
    await delay(50);
    await fs.rm(commandPath, { force: true });

    const final = await waitForEvent({
      ws: wsUrl,
      predicate: (
        event: unknown,
      ): event is { type: 'turn_final'; status: string } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          status?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.status === 'failed'
        );
      },
      timeoutMs: 5000,
      describe: () => describeCommandRetryDiagnosticState(conversationId),
    });

    assert.equal(final.status, 'failed');
    const turns = await waitForTurns(
      conversationId,
      (items) => items.filter((turn) => turn.role === 'assistant').length >= 1,
      3000,
      () => describeCommandRetryDiagnosticState(conversationId),
    );
    const assistantTurns = turns.filter((turn) => turn.role === 'assistant');
    assert.equal(assistantTurns.length, 2);

    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
  await fs.rm(commandPath, { force: true });
  if (previousRetries === undefined) {
    delete process.env.FLOW_AND_COMMAND_RETRIES;
  } else {
    process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
  }
});

test('flow run rejects path traversal attempts', async () => {
  await withFlowServer(async ({ baseUrl }) => {
    await supertest(baseUrl)
      .post('/flows/..%2Fescape/run')
      .send({})
      .expect(404);
  });
});

test('flow run rejects unsafe flow-owned agentType values before runtime fallback joins can probe repository-backed agent roots', async () => {
  await withFlowServer(async ({ baseUrl, tmpDir }) => {
    const flowName = 'unsafe-agent-type';
    await fs.writeFile(
      path.join(tmpDir, `${flowName}.json`),
      JSON.stringify({
        description: 'unsafe agent type',
        steps: [
          {
            type: 'command',
            agentType: '../escape',
            identifier: 'command-main',
            commandName: 'improve_plan',
          },
        ],
      }),
      'utf8',
    );

    const response = await supertest(baseUrl)
      .post(`/flows/${flowName}/run`)
      .send({});

    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'invalid_request');
    assert.match(
      String(response.body.reason ?? response.body.message ?? ''),
      /agentType must be a valid agent root name/u,
    );
  });
});

test('flow run rejects unsafe flow-owned commandName values before runtime fallback joins can probe repository-backed command paths', async () => {
  await withFlowServer(async ({ baseUrl, tmpDir }) => {
    const flowName = 'unsafe-command-name';
    await fs.writeFile(
      path.join(tmpDir, `${flowName}.json`),
      JSON.stringify({
        description: 'unsafe command name',
        steps: [
          {
            type: 'command',
            agentType: 'planning_agent',
            identifier: 'command-main',
            commandName: '../escape',
          },
        ],
      }),
      'utf8',
    );

    const response = await supertest(baseUrl)
      .post(`/flows/${flowName}/run`)
      .send({});

    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'invalid_request');
    assert.match(
      String(response.body.reason ?? response.body.message ?? ''),
      /valid file name/u,
    );
  });
});

test('conversation-only stop prevents nested command handoff from starting', async () => {
  await withFlowServer(async ({ wsUrl, tmpDir }) => {
    const conversationId = 'flow-command-stop-before-handoff';
    const flowName = 'command-stop-check';
    await fs.writeFile(
      path.join(tmpDir, `${flowName}.json`),
      JSON.stringify({
        description: 'stop before command handoff',
        steps: [
          {
            type: 'command',
            agentType: 'planning_agent',
            identifier: 'stop-check',
            commandName: 'improve_plan',
          },
        ],
      }),
    );
    sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

    const startedPromise = startFlowRun({
      flowName,
      conversationId,
      source: 'REST',
      chatFactory: () => new ScriptedChat(),
      onOwnershipReady: ({ runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken,
        });
      },
    });
    await startedPromise;

    const final = await waitForEvent({
      ws: wsUrl,
      predicate: (
        event: unknown,
      ): event is { type: 'turn_final'; status: string } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          status?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.status === 'stopped'
        );
      },
      timeoutMs: 5000,
    });

    assert.equal(final.status, 'stopped');
    await delay(250);

    const flowConversation = memoryConversations.get(conversationId);
    const flowFlags = (flowConversation?.flags ?? {}) as {
      flow?: {
        executionId?: string;
        agentConversations?: Record<string, string>;
      };
    };
    assert.equal(typeof flowFlags.flow?.executionId, 'string');
    assert.equal(
      flowFlags.flow?.agentConversations?.['planning_agent:stop-check'],
      undefined,
    );

    await cleanupConversationRuntime(conversationId);
  });
});

test('no stale flow continuation resumes after confirmed stop', async () => {
  await withFlowServer(async ({ wsUrl }) => {
    const conversationId = 'flow-command-stop-no-resume';
    sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

    const events: Array<{ type?: string; conversationId?: string }> = [];
    wsUrl.on('message', (raw) => {
      const parsed = JSON.parse(String(raw)) as {
        type?: string;
        conversationId?: string;
      };
      events.push(parsed);
    });

    const startedPromise = startFlowRun({
      flowName: 'command-step',
      conversationId,
      source: 'REST',
      chatFactory: () => new ScriptedChat(),
      onOwnershipReady: ({ runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken,
        });
      },
    });
    await startedPromise;

    await waitForEvent({
      ws: wsUrl,
      predicate: (
        event: unknown,
      ): event is { type: 'turn_final'; status: string } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          status?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.status === 'stopped'
        );
      },
      timeoutMs: 5000,
    });

    const turnCountAfterStop = memoryTurns.get(conversationId)?.length ?? 0;
    await delay(300);

    const finals = events.filter(
      (event) =>
        event.type === 'turn_final' && event.conversationId === conversationId,
    );
    assert.equal(finals.length, 1);
    assert.equal(
      memoryTurns.get(conversationId)?.length ?? 0,
      turnCountAfterStop,
    );

    await cleanupConversationRuntime(conversationId);
  });
});

test('stop-near-complete flow aligns final status with persisted turns and emits Task 3 diagnostics', async () => {
  let wsRef: WebSocket | null = null;
  let flowInflightId: string | null = null;
  let cancelSent = false;

  await withFlowServer(async ({ wsUrl }) => {
    wsRef = wsUrl;
    const conversationId = 'flow-command-stop-near-complete';
    sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

    const startedPromise = startFlowRun({
      flowName: 'command-step',
      conversationId,
      source: 'REST',
      chatFactory: () =>
        new CompleteThenPauseChat({
          onComplete: async () => {
            const deadline = Date.now() + 5000;
            while (!flowInflightId && Date.now() < deadline) {
              await delay(10);
              flowInflightId = getInflight(conversationId)?.inflightId ?? null;
            }
            assert.ok(flowInflightId);
            if (!cancelSent && wsRef) {
              cancelSent = true;
              sendJson(wsRef, {
                type: 'cancel_inflight',
                conversationId,
                inflightId: flowInflightId,
              });
            }
          },
        }),
    });

    await withTimeout(
      (async () => {
        while (!flowInflightId) {
          flowInflightId = getInflight(conversationId)?.inflightId ?? null;
          if (flowInflightId) {
            return;
          }
          await delay(10);
        }
      })(),
      5000,
      JSON.stringify({
        cancelSent,
        flowInflightId,
        state: JSON.parse(describeFlowRuntimeState(conversationId)),
      }),
    );
    assert.ok(flowInflightId);

    await startedPromise;
    const final = await waitForFlowFinal({
      ws: wsUrl,
      conversationId,
      status: 'stopped',
      timeoutMs: 5000,
      describe: () =>
        JSON.stringify({
          cancelSent,
          flowInflightId,
          state: JSON.parse(describeFlowRuntimeState(conversationId)),
        }),
    });
    assert.equal(final.status, 'stopped');

    const turns = await waitForTurns(
      conversationId,
      (items) =>
        items.some(
          (turn) => turn.role === 'assistant' && turn.status === 'stopped',
        ),
      4000,
      () =>
        JSON.stringify({
          final,
          cancelSent,
          flowInflightId,
          state: JSON.parse(describeFlowRuntimeState(conversationId)),
        }),
    );
    assert.equal(
      turns.some(
        (turn) => turn.role === 'assistant' && turn.status === 'stopped',
      ),
      true,
    );

    const stopPathLog = query(
      { text: 'DEV-0000049:T03:stop_path_registered' },
      50,
    ).find(
      (entry) =>
        entry.context?.conversationId === conversationId &&
        entry.context?.inflightId === flowInflightId,
    );
    assert.ok(stopPathLog);

    const reclassifiedLog = query(
      { text: 'DEV-0000049:T03:flow_instruction_status_reclassified' },
      20,
    ).find(
      (entry) =>
        entry.context?.flowConversationId === conversationId &&
        entry.context?.inflightId === flowInflightId,
    );
    assert.ok(reclassifiedLog);
    assert.equal(reclassifiedLog.context?.fromStatus, 'ok');
    assert.equal(reclassifiedLog.context?.toStatus, 'stopped');

    const persistedLogs = query(
      { text: 'DEV-0000049:T03:flow_turn_status_persisted' },
      20,
    ).filter(
      (entry) =>
        entry.context?.flowConversationId === conversationId &&
        entry.context?.inflightId === flowInflightId,
    );
    assert.equal(persistedLogs.length >= 2, true);
    assert.equal(
      persistedLogs.every((entry) => entry.context?.status === 'stopped'),
      true,
    );

    const alignedLog = query(
      { text: 'DEV-0000049:T03:deferred_final_status_aligned' },
      20,
    ).find(
      (entry) =>
        entry.context?.conversationId === conversationId &&
        entry.context?.inflightId === flowInflightId,
    );
    assert.ok(alignedLog);
    assert.equal(alignedLog.context?.pendingStatus, 'ok');
    assert.equal(alignedLog.context?.resolvedStatus, 'stopped');

    await cleanupConversationRuntime(conversationId);
  });
});
