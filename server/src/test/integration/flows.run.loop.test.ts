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

import { AbortError, delayWithAbort } from '../../agents/retry.js';
import {
  getActiveRunOwnership,
  releaseConversationLock,
} from '../../agents/runLock.js';
import { prepareFlowOwnedAgentExecution } from '../../agents/service.js';
import {
  cleanupInflight,
  getInflight,
  getPendingConversationCancel,
  registerPendingConversationCancel,
} from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import {
  __resetGitHubReviewDepsForTests,
  __setGitHubReviewDepsForTests,
  MAX_GITHUB_INLINE_REVIEW_COMMENTS,
  MAX_GITHUB_REVIEW_SUBMISSIONS,
  readGitHubReviewScratch,
  materializeGitHubExternalReviewInput,
  writeGitHubReviewScratch,
} from '../../flows/githubReview.js';
import {
  __resetFlowWaitResumeDepsForTests,
  startFlowRun,
} from '../../flows/service.js';
import type { ListReposResult, RepoEntry } from '../../lmstudio/toolService.js';
import { query } from '../../logStore.js';
import type { Turn } from '../../mongo/turn.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { attachWs } from '../../ws/server.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
  withDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import { withIsolatedProviderHomeTestEnv } from '../support/providerHomeHarness.js';
import { bindCurrentTestOverrides } from '../support/testOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
  waitForClose,
} from '../support/wsClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  installDeterministicCodexAvailabilityBootstrap();
});

afterEach(() => {
  resetDeterministicCodexAvailabilityBootstrap();
  __resetGitHubReviewDepsForTests();
  __resetFlowWaitResumeDepsForTests();
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

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 10000,
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

const closeHttpServer = async (
  httpServer: http.Server,
  timeoutMs = 2000,
): Promise<void> => {
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
    timeoutMs,
    'Timed out waiting for loop-test HTTP server shutdown',
  );
};

const closeFlowHarness = async (params: {
  ws: WebSocket;
  wsHandle: Awaited<ReturnType<typeof attachWs>>;
  httpServer: http.Server;
}) => {
  const forceCloseServer = () => {
    params.httpServer.closeAllConnections?.();
    params.httpServer.closeIdleConnections?.();
  };

  try {
    await withTimeout(
      closeWs(params.ws),
      2000,
      'Timed out gracefully closing loop-test WebSocket client',
    );
  } catch {
    try {
      params.ws.terminate();
      await waitForClose(params.ws, 500);
    } catch {
      // Ignore forced-close failures and continue draining the server.
    }
  }

  try {
    await withTimeout(
      params.wsHandle.close(),
      2000,
      'Timed out waiting for loop-test WebSocket server shutdown',
    );
  } catch {
    forceCloseServer();
  }

  try {
    await closeHttpServer(params.httpServer);
  } catch (error) {
    forceCloseServer();
    await closeHttpServer(params.httpServer, 1000).catch(() => {
      throw error;
    });
  }
};

class ScriptedChat extends ChatInterface {
  constructor(
    private readonly responder: (message: string) => string,
    private readonly options: {
      onExecute?: (params: {
        message: string;
        flags: Record<string, unknown>;
        conversationId: string;
      }) => void;
    } = {},
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
    const signal = (flags as { signal?: AbortSignal }).signal;
    if (signal?.aborted) {
      this.emit('error', { type: 'error', message: 'aborted' });
      return;
    }
    this.options.onExecute?.({ message, flags, conversationId });
    this.emit('thread', { type: 'thread', threadId: conversationId });
    const rawResponse = this.responder(message);
    const delayedMatch = rawResponse.match(/^__delay:(\d+)::([\s\S]*)$/);
    if (delayedMatch) {
      try {
        await delayWithAbort(Number(delayedMatch[1]), signal);
      } catch (error) {
        if (error instanceof AbortError) {
          this.emit('error', { type: 'error', message: 'aborted' });
          return;
        }
        throw error;
      }
      if (signal?.aborted) {
        this.emit('error', { type: 'error', message: 'aborted' });
        return;
      }
    }
    const response = delayedMatch ? delayedMatch[2] : rawResponse;
    this.emit('final', { type: 'final', content: response });
    this.emit('complete', { type: 'complete', threadId: conversationId });
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
const githubReviewFixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows/github-review',
);

const createGitHubReviewRepoFixture = async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'github-loop-repo-'),
  );
  const planPath =
    'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md';
  await fs.mkdir(path.join(repoRoot, 'codeInfoStatus/flow-state'), {
    recursive: true,
  });
  await fs.mkdir(path.join(repoRoot, 'planning'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'scripts/flow_control'), {
    recursive: true,
  });
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
          number: 4,
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
  await fs.copyFile(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../scripts/flow_control/check_github_review_has_reviewer_feedback.py',
    ),
    path.join(
      repoRoot,
      'scripts/flow_control/check_github_review_has_reviewer_feedback.py',
    ),
  );
  await fs.writeFile(
    path.join(repoRoot, '.env.local'),
    'CODEINFO_PR_TOKEN=secret\n',
    'utf8',
  );
  return repoRoot;
};

const writeGitHubReviewHandoff = async (params: {
  repoRoot: string;
  executionId?: string;
  reviewCount: number;
  commentCount?: number;
  legacyReviewCount?: number;
  legacyCommentCount?: number;
}) => {
  const reviewsDir = path.join(params.repoRoot, 'codeInfoTmp/reviews');
  await fs.mkdir(reviewsDir, { recursive: true });
  const executionId = params.executionId ?? 'exec-1';

  const writeHandoff = async (
    reviewCount: number,
    commentCount: number,
  ) => {
    const handoffPath = path.join(
      reviewsDir,
      `0000060-github-review-${executionId}-current.json`,
    );
    await fs.writeFile(
      path.join(reviewsDir, '0000060-github-review-current.json'),
      JSON.stringify(
        {
          selector_kind: 'github-review-selector-v1',
          execution_id: executionId,
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: params.repoRoot,
          branch_name: 'feature/0000060-demo',
          handoff_path: handoffPath,
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      handoffPath,
      JSON.stringify(
        {
          handoff_kind: 'github-review-handoff-v1',
          execution_id: executionId,
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: params.repoRoot,
          filtered_review_count: reviewCount,
          filtered_review_comment_count: commentCount,
        },
        null,
        2,
      ),
      'utf8',
    );
  };

  await writeHandoff(params.reviewCount, params.commentCount ?? 0);
  if (
    params.legacyReviewCount !== undefined ||
    params.legacyCommentCount !== undefined
  ) {
    await fs.writeFile(
      path.join(reviewsDir, '0000060-current-review.json'),
      JSON.stringify(
        {
          filtered_review_count: params.legacyReviewCount ?? 0,
          filtered_review_comment_count: params.legacyCommentCount ?? 0,
        },
        null,
        2,
      ),
      'utf8',
    );
  }
};

const writeGitHubReviewRuntimeFlow = async (params: {
  dir: string;
  flowName: string;
  includeWait?: boolean;
  thenSteps: Array<Record<string, unknown>>;
  elseSteps: Array<Record<string, unknown>>;
}) => {
  const steps: Array<Record<string, unknown>> = [];
  if (params.includeWait) {
    steps.push({
      type: 'wait',
      label: 'Wait for review feedback',
      seconds: 60,
    });
  }
  steps.push({
    type: 'if',
    condition: 'scripts/flow_control/check_github_review_has_reviewer_feedback.py',
    then: params.thenSteps,
    else: params.elseSteps,
  });

  await fs.writeFile(
    path.join(params.dir, `${params.flowName}.json`),
    JSON.stringify(
      {
        description: 'GitHub review runtime branch-authority fixture',
        steps,
      },
      null,
      2,
    ),
    'utf8',
  );
};

const buildHarnessRepoEntry = (containerPath: string): RepoEntry => ({
  id: path.basename(containerPath) || 'flow-test-repo',
  description: null,
  containerPath,
  hostPath: `/host${containerPath}`,
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
  counts: { files: 1, chunks: 1, embedded: 1 },
  lastError: null,
});

const listHarnessRepo = async (
  containerPath: string,
): Promise<ListReposResult> => ({
  repos: [buildHarnessRepoEntry(containerPath)],
  lockedModelId: null,
});

const withFlowServer = async (
  responder: (message: string) => string,
  task: (params: {
    baseUrl: string;
    wsUrl: WebSocket;
    tmpDir: string;
  }) => Promise<void>,
  options?: {
    chatFactory?: () => ChatInterface;
    cleanupInflightFn?: (params: {
      conversationId: string;
      inflightId?: string;
    }) => void;
    listIngestedRepositoriesFn?: () => Promise<ListReposResult>;
    releaseConversationLockFn?: (
      conversationId: string,
      expectedRunToken?: string,
    ) => boolean;
    onStopUnwindCheckpoint?: (params: {
      checkpoint: string;
      conversationId: string;
      detail?: string;
    }) => void | Promise<void>;
    registerTmpDirAsRepo?: boolean;
  },
) => {
  await withDeterministicCodexAvailabilityBootstrap(async () => {
    const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-loop-'));
    await fs.cp(fixturesDir, tmpDir, { recursive: true });

    try {
      await withIsolatedProviderHomeTestEnv(
        {
          prefix: 'flows-loop-provider-homes-',
          overrides: {
            CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
            FLOWS_DIR: tmpDir,
          },
        },
        async () => {
          const app = express();
          app.use(
            createFlowsRunRouter({
              startFlowRun: bindCurrentTestOverrides((params) =>
                startFlowRun({
                  ...params,
                  chatFactory:
                    options?.chatFactory ?? (() => new ScriptedChat(responder)),
                  listIngestedRepositories:
                    options?.listIngestedRepositoriesFn ??
                    (options?.registerTmpDirAsRepo
                      ? () => listHarnessRepo(tmpDir)
                      : undefined),
                  onStopUnwindCheckpoint: options?.onStopUnwindCheckpoint,
                  cleanupInflightFn: options?.cleanupInflightFn,
                  releaseConversationLockFn: options?.releaseConversationLockFn,
                })),
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
            await closeFlowHarness({ ws, wsHandle, httpServer });
          }
        },
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
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
      describe ? `details=${describe()}` : '',
    ].join(' | '),
  );
};

const getAgentConversationId = (
  conversationId: string,
  agentKey: string,
): string => {
  const flowConversation = memoryConversations.get(conversationId);
  const flowFlags = (flowConversation?.flags ?? {}) as {
    flow?: { agentConversations?: Record<string, string> };
  };
  const agentConversationId = flowFlags.flow?.agentConversations?.[agentKey];
  assert.ok(agentConversationId, `Missing agent conversation for ${agentKey}`);
  return agentConversationId;
};

const getAgentConversationIds = (
  conversationId: string,
  agentKeys: string[],
): string[] => {
  const flowConversation = memoryConversations.get(conversationId);
  const flowFlags = (flowConversation?.flags ?? {}) as {
    flow?: { agentConversations?: Record<string, string> };
  };

  return agentKeys
    .map((agentKey) => flowFlags.flow?.agentConversations?.[agentKey])
    .filter((agentConversationId): agentConversationId is string =>
      Boolean(agentConversationId),
    );
};

const getLoopContinueAgentConversationIds = (conversationId: string) =>
  getAgentConversationIds(conversationId, [
    'coding_agent:outer',
    'coding_agent:outer-continue',
    'coding_agent:post-continue',
    'coding_agent:outer-break',
  ]);

const getConversationScopedRuntimeLogs = (
  conversationId: string,
  options?: {
    flowLogLimit?: number;
    runtimeLockLogLimit?: number;
    tailSize?: number;
  },
) => {
  const flowLogLimit = options?.flowLogLimit ?? 400;
  const runtimeLockLogLimit = options?.runtimeLockLogLimit ?? 40;
  const tailSize = options?.tailSize ?? 120;
  const seen = new Set<string>();
  const combined = query({ text: 'flows.test.' }, flowLogLimit)
    .filter((entry) => entry.context?.conversationId === conversationId)
    .concat(query({ text: 'runtime.chat_config_lock_' }, runtimeLockLogLimit))
    .filter((entry) => {
      const dedupeKey = `${entry.timestamp}|${entry.message}|${JSON.stringify(entry.context ?? null)}`;
      if (seen.has(dedupeKey)) {
        return false;
      }
      seen.add(dedupeKey);
      return true;
    })
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  return combined.slice(-tailSize).map((entry) => ({
    message: entry.message,
    context: entry.context,
  }));
};

const getConversationScopedRuntimeResolutionLogs = (
  conversationId: string,
  limit = 80,
) =>
  query({ text: 'flows.test.runtime_resolution_' }, limit)
    .filter((entry) => entry.context?.conversationId === conversationId)
    .map((entry) => ({
      message: entry.message,
      context: entry.context,
    }));

const getGlobalRuntimeConfigLogs = (limit = 80) =>
  query({ text: 'runtime.' }, limit)
    .filter(
      (entry) =>
        entry.message.startsWith('runtime.chat_config_') ||
        entry.message.startsWith('runtime.runtime_config_resolution_'),
    )
    .map((entry) => ({
      message: entry.message,
      context: entry.context,
    }));

const describeFlowRuntimeState = (
  conversationId: string,
  agentKeys: string[] = [],
  options?: {
    expectedNextStepPath?: number[];
    scriptedMessages?: string[];
    stopUnwindCheckpoints?: StopUnwindCheckpoint[];
  },
): string =>
  JSON.stringify({
    inflightId: getInflight(conversationId)?.inflightId ?? null,
    ownershipRunToken: getActiveRunOwnership(conversationId)?.runToken ?? null,
    pendingCancelState: snapshotRuntimeCleanupState(conversationId),
    conversationFlags: memoryConversations.get(conversationId)?.flags ?? null,
    expectedNextStepPath: options?.expectedNextStepPath ?? null,
    agentConversations: getAgentConversationIds(conversationId, agentKeys).map(
      (agentConversationId) => ({
        agentConversationId,
        recentTurns: (memoryTurns.get(agentConversationId) ?? [])
          .slice(-6)
          .map((turn) => ({
            role: turn.role,
            status: turn.status,
            content: turn.content,
        })),
      }),
    ),
    scriptedMessages: options?.scriptedMessages
      ? {
          totalMessages: options.scriptedMessages.length,
          recentMessages: options.scriptedMessages.slice(-12),
        }
      : undefined,
    stopUnwind: options?.stopUnwindCheckpoints
      ? {
          totalCheckpoints: options.stopUnwindCheckpoints.length,
          recentCheckpoints: options.stopUnwindCheckpoints.slice(-12),
        }
      : undefined,
    runtimeLogs: getConversationScopedRuntimeLogs(conversationId),
    runtimeResolutionLogs:
      getConversationScopedRuntimeResolutionLogs(conversationId),
    runtimeConfigLogs: getGlobalRuntimeConfigLogs(),
  });

const describeLoopContinueResumeState = (conversationId: string): string =>
  JSON.stringify({
    flowState: JSON.parse(
      describeFlowRuntimeState(conversationId, [
        'coding_agent:outer',
        'coding_agent:outer-continue',
        'coding_agent:post-continue',
        'coding_agent:outer-break',
      ]),
    ),
    turns: (memoryTurns.get(conversationId) ?? []).map((turn) => ({
      role: turn.role,
      status: turn.status,
      content: turn.content,
    })),
  });

type ObservedLoopTerminalOutcome = {
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  source: 'ws' | 'persisted';
};

const getLatestLoopTerminalTurn = (
  conversationId: string,
): Turn | undefined => {
  const turns = memoryTurns.get(conversationId) ?? [];
  return [...turns]
    .reverse()
    .find((turn) => turn.role === 'assistant');
};

const getLatestPublishedTurnFinalLog = (conversationId: string) =>
  query({ text: 'chat.ws.server_publish_turn_final' }, 120)
    .filter((entry) => entry.context?.conversationId === conversationId)
    .at(-1);

const getPersistedLoopTerminalOutcome = (
  conversationId: string,
): ObservedLoopTerminalOutcome | null => {
  const terminalTurn = getLatestLoopTerminalTurn(conversationId);
  const publishedTurnFinal = getLatestPublishedTurnFinalLog(conversationId);
  const statusFromLog = publishedTurnFinal?.context?.status;
  const errorCodeFromLog = publishedTurnFinal?.context?.errorCode;
  const status =
    typeof statusFromLog === 'string'
      ? statusFromLog
      : terminalTurn?.status ?? null;

  if (!status) {
    return null;
  }

  return {
    status,
    errorCode: typeof errorCodeFromLog === 'string' ? errorCodeFromLog : null,
    errorMessage: terminalTurn?.content ?? null,
    source: 'persisted',
  };
};

const waitForLoopTerminalOutcome = async (params: {
  ws: WebSocket;
  conversationId: string;
  expectedStatus: string | string[];
  timeoutMs?: number;
  describe?: () => string;
}): Promise<ObservedLoopTerminalOutcome> => {
  const expectedStatuses = Array.isArray(params.expectedStatus)
    ? params.expectedStatus
    : [params.expectedStatus];
  const persistedFallbackTimeoutMs = Math.max(
    2000,
    Math.min(5000, params.timeoutMs ?? 4000),
  );
  try {
    const final = await waitForEvent({
      ws: params.ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'turn_final';
        status: string;
        error?: { code?: string; message?: string };
      } => {
        const candidate = event as {
          type?: string;
          conversationId?: string;
          status?: string;
          error?: { code?: string; message?: string };
        };
        return (
          candidate.type === 'turn_final' &&
          candidate.conversationId === params.conversationId &&
          expectedStatuses.includes(candidate.status ?? '')
        );
      },
      timeoutMs: params.timeoutMs,
      describe: params.describe,
      inspectCurrent: () =>
        describeFlowRuntimeState(params.conversationId, [
          'coding_agent:outer',
          'coding_agent:inner',
          'coding_agent:inner-break',
          'coding_agent:outer-break',
        ]),
      describeEvent: (event) => JSON.stringify(event),
    });

    return {
      status: final.status,
      errorCode: final.error?.code ?? null,
      errorMessage: final.error?.message ?? null,
      source: 'ws',
    };
  } catch (error) {
    await waitFor(
      () =>
        expectedStatuses.includes(
          getPersistedLoopTerminalOutcome(params.conversationId)?.status ?? '',
        ),
      persistedFallbackTimeoutMs,
      () =>
        [
          params.describe?.(),
          `runtimeState=${describeFlowRuntimeState(params.conversationId, [
            'coding_agent:outer',
            'coding_agent:inner',
            'coding_agent:inner-break',
            'coding_agent:outer-break',
          ])}`,
        ]
          .filter((part): part is string => Boolean(part))
          .join(' | '),
    ).catch(() => {
      throw error;
    });

    const persisted = getPersistedLoopTerminalOutcome(params.conversationId);
    assert.ok(
      persisted,
      `Missing persisted loop terminal outcome for ${params.conversationId}`,
    );
    return persisted;
  }
};

const cleanupMemory = (...conversationIds: Array<string | undefined>) => {
  conversationIds.forEach((conversationId) => {
    if (!conversationId) return;
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
};

type RuntimeCleanupSnapshot = {
  inflightId: string | null;
  ownershipRunToken: string | null;
  pendingCancelRunToken: string | null;
  pendingCancelInflightId: string | null;
};

type OwnershipReleaseCall = {
  expectedRunToken?: string;
  released: boolean;
  beforeState: RuntimeCleanupSnapshot;
  afterState: RuntimeCleanupSnapshot;
};

type StopUnwindCheckpoint = {
  checkpoint: string;
  conversationId: string;
  detail?: string;
  state: RuntimeCleanupSnapshot;
};

type CleanupPhaseCheckpoint = {
  label: string;
  conversationId: string;
  state: RuntimeCleanupSnapshot;
};

const snapshotRuntimeCleanupState = (
  conversationId: string,
): RuntimeCleanupSnapshot => {
  const pendingCancel = getPendingConversationCancel(conversationId);
  return {
    inflightId: getInflight(conversationId)?.inflightId ?? null,
    ownershipRunToken: getActiveRunOwnership(conversationId)?.runToken ?? null,
    pendingCancelRunToken: pendingCancel?.runToken ?? null,
    pendingCancelInflightId: pendingCancel?.boundInflightId ?? null,
  };
};

const pushStopUnwindCheckpoint = (
  checkpoints: StopUnwindCheckpoint[],
  params: {
    checkpoint: string;
    conversationId: string;
    detail?: string;
  },
  limit = 20,
) => {
  checkpoints.push({
    ...params,
    state: snapshotRuntimeCleanupState(params.conversationId),
  });
  if (checkpoints.length > limit) {
    checkpoints.splice(0, checkpoints.length - limit);
  }
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

const waitForRuntimeCleanup = async (
  conversationId: string,
  timeoutMs = 8000,
  describe?: () => string,
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
  const inflight = getInflight(conversationId);
  const ownership = getActiveRunOwnership(conversationId);
  throw new Error(
    [
      `Timed out waiting for flow runtime cleanup (inflight=${String(Boolean(inflight))}, ownership=${String(Boolean(ownership))}, inflightId=${inflight?.inflightId ?? 'none'}, runToken=${ownership?.runToken ?? 'none'})`,
      describe ? `details=${describe()}` : '',
    ]
      .filter(Boolean)
      .join(' | '),
  );
};

const waitForPredicate = async (
  predicate: () => boolean,
  timeoutMs: number,
  message: string,
) => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const started = Date.now();
  while (Date.now() - started < resolvedTimeoutMs) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error(message);
};

const expectNoTerminalFinal = async (
  ws: WebSocket,
  conversationId: string,
  waitMs = 300,
) => {
  await assert.rejects(
    () =>
      waitForEvent({
        ws,
        predicate: (
          event: unknown,
        ): event is { type: 'turn_final'; status: string } => {
          const e = event as {
            type?: string;
            conversationId?: string;
            status?: string;
          };
          return e.type === 'turn_final' && e.conversationId === conversationId;
        },
        timeoutMs: waitMs,
      }),
    /Timed out waiting for WebSocket event/,
  );
};

test('flow loops until break answer matches breakOn', async () => {
  let outerBreakCount = 0;
  const scriptedMessages: string[] = [];
  const stopUnwindCheckpoints: StopUnwindCheckpoint[] = [];
  await withFlowServer(
    (message) => {
      scriptedMessages.push(message);
      if (message.includes('Exit inner loop?')) {
        return JSON.stringify({ answer: 'yes' });
      }
      if (message.includes('Exit outer loop?')) {
        outerBreakCount += 1;
        return JSON.stringify({ answer: outerBreakCount >= 2 ? 'yes' : 'no' });
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-conv-1';
      const customTitle = 'Loop Custom Title';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId, customTitle })
        .expect(202);

      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.filter(
            (turn) =>
              turn.role === 'user' && turn.content.includes('Exit outer loop?'),
          ).length === 2,
        35000,
        () =>
          JSON.stringify({
            outerBreakCount,
            state: JSON.parse(
              describeFlowRuntimeState(conversationId, [
                'coding_agent:outer',
                'coding_agent:inner',
                'coding_agent:inner-break',
                'coding_agent:outer-break',
              ], {
                expectedNextStepPath: [0, 1],
                scriptedMessages,
                stopUnwindCheckpoints,
              }),
            ),
          }),
      );

      const outerBreakTurns = turns.filter(
        (turn) =>
          turn.role === 'user' && turn.content.includes('Exit outer loop?'),
      );
      const innerBreakTurns = turns.filter(
        (turn) =>
          turn.role === 'user' && turn.content.includes('Exit inner loop?'),
      );
      const breakAnswers = turns.filter(
        (turn) =>
          turn.role === 'assistant' && turn.content.includes('"answer"'),
      );

      assert.equal(outerBreakTurns.length, 2);
      assert.equal(innerBreakTurns.length, 2);
      assert.equal(breakAnswers.length, 4);
      assert.equal(outerBreakCount, 2);
      const agentConversationId = getAgentConversationId(
        conversationId,
        'coding_agent:outer',
      );
      const agentConversation = memoryConversations.get(agentConversationId);
      assert.equal(agentConversation?.title, `${customTitle} (outer)`);
      await cleanupConversationRuntime(conversationId, agentConversationId);
    },
    {
      onStopUnwindCheckpoint: (params) => {
        pushStopUnwindCheckpoint(stopUnwindCheckpoints, params);
      },
    },
  );
});

test('github review bounded corpus scratch replacement stays authoritative before classification', async () => {
  const repoRoot = await createGitHubReviewRepoFixture();
  try {
    const selectorPath = path.join(
      repoRoot,
      'codeInfoTmp/reviews/0000060-github-review-current.json',
    );
    const handoffPath = path.join(
      repoRoot,
      'codeInfoTmp/reviews/0000060-github-review-exec-1-current.json',
    );
    const rawArtifactPath = path.join(
      repoRoot,
      'codeInfoTmp/reviews/0000060-github-review-exec-1-pr-45.json',
    );
    await fs.mkdir(path.dirname(handoffPath), { recursive: true });
    await fs.writeFile(
      path.join(
        repoRoot,
        'codeInfoTmp/reviews/0000060-github-review-exec-1-external-review-input.md',
      ),
      'stale input\n',
      'utf8',
    );
    await fs.writeFile(
      selectorPath,
      JSON.stringify(
        {
          selector_kind: 'github-review-selector-v1',
          execution_id: 'exec-1',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: repoRoot,
          branch_name: 'feature/0000060-demo',
          handoff_path: handoffPath,
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      handoffPath,
      JSON.stringify(
        {
          handoff_kind: 'github-review-handoff-v1',
          execution_id: 'exec-1',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: repoRoot,
          branch_name: 'feature/0000060-demo',
          head_sha: 'deadbeef',
          raw_review_artifact_path: rawArtifactPath,
          pull_request: {
            number: 45,
            url: 'https://github.com/example/repo/pull/45',
            headRefName: 'feature/0000060-demo',
            baseRefName: 'main',
            authorLogin: 'review-author',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    const reviews = Array.from(
      { length: MAX_GITHUB_REVIEW_SUBMISSIONS },
      (_, index) => ({
        id: 3000 + index + 1,
        user: { login: `reviewer-${String(index + 1)}` },
        body:
          index === 0
            ? 'Fresh bounded review entry one.'
            : index === MAX_GITHUB_REVIEW_SUBMISSIONS - 1
              ? 'Fresh bounded review entry final.'
              : `Fresh bounded review entry ${String(index + 1)}.`,
        state: 'COMMENTED',
        submitted_at: new Date(
          Date.UTC(2026, 5, 24, 10, 0, index + 1),
        ).toISOString(),
      }),
    );
    const reviewComments = Array.from(
      { length: MAX_GITHUB_INLINE_REVIEW_COMMENTS },
      (_, index) => ({
        id: 4000 + index + 1,
        pull_request_review_id: 3000 + index + 1,
        user: { login: `inline-reviewer-${String(index + 1)}` },
        body:
          index === 0
            ? 'Fresh bounded inline entry one.'
            : index === MAX_GITHUB_INLINE_REVIEW_COMMENTS - 1
              ? 'Fresh bounded inline entry final.'
              : `Fresh bounded inline entry ${String(index + 1)}.`,
        path: 'server/src/flows/githubReview.ts',
        line: index + 1,
        created_at: new Date(
          Date.UTC(2026, 5, 24, 11, 0, index + 1),
        ).toISOString(),
      }),
    );
    await fs.writeFile(
      rawArtifactPath,
      JSON.stringify(
        {
          repository: { owner: 'example', name: 'repo' },
          pullRequest: {
            number: 45,
            url: 'https://github.com/example/repo/pull/45',
            headRefName: 'feature/0000060-demo',
            baseRefName: 'main',
            authorLogin: 'review-author',
          },
          fetchedAt: '2026-06-24T12:00:00.000Z',
          reviews,
          reviewComments,
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await materializeGitHubExternalReviewInput({
      handoff: await (async () => {
        const parsed = await readGitHubReviewScratch({ handoffPath: selectorPath });
        assert.equal(parsed.kind, 'ok');
        return parsed.value;
      })(),
    });
    assert.equal(result.kind, 'ok');

    const updatedHandoff = JSON.parse(
      await fs.readFile(handoffPath, 'utf8'),
    ) as {
      filtered_review_count?: number;
      filtered_review_comment_count?: number;
      external_review_input_file?: string;
    };
    const externalInput = await fs.readFile(
      path.join(
        repoRoot,
        'codeInfoTmp/reviews/0000060-github-review-exec-1-external-review-input.md',
      ),
      'utf8',
    );
    assert.equal(
      updatedHandoff.filtered_review_count,
      MAX_GITHUB_REVIEW_SUBMISSIONS,
    );
    assert.equal(
      updatedHandoff.filtered_review_comment_count,
      MAX_GITHUB_INLINE_REVIEW_COMMENTS,
    );
    assert.match(
      updatedHandoff.external_review_input_file ?? '',
      /0000060-github-review-exec-1-external-review-input\.md$/,
    );
    assert.match(externalInput, /Fresh bounded review entry one\./);
    assert.match(externalInput, /Fresh bounded review entry final\./);
    assert.match(externalInput, /Fresh bounded inline entry one\./);
    assert.match(externalInput, /Fresh bounded inline entry final\./);
    assert.doesNotMatch(externalInput, /stale input/);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('checked-in GitHub review flow variant keeps clean ordering and closes PRs only inside findings repair paths', async () => {
  const variant = JSON.parse(
    await fs.readFile(
      path.join(repoRoot, 'flows/implement_next_plan_github_review.json'),
      'utf8',
    ),
  ) as {
    steps: Array<Record<string, unknown>>;
  };

  const flattenSteps = (
    steps: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> =>
    steps.flatMap((step) => {
      const nested = Array.isArray(step.steps)
        ? flattenSteps(step.steps as Array<Record<string, unknown>>)
        : [];
      const thenBranch = Array.isArray(step.then)
        ? flattenSteps(step.then as Array<Record<string, unknown>>)
        : [];
      const elseBranch = Array.isArray(step.else)
        ? flattenSteps(step.else as Array<Record<string, unknown>>)
        : [];
      return [step, ...nested, ...thenBranch, ...elseBranch];
    });

  const flattened = flattenSteps(variant.steps);
  const openIndex = flattened.findIndex(
    (step) => step.type === 'github_open_pr',
  );
  const waitIndex = flattened.findIndex((step) => step.type === 'wait');
  const fetchIndex = flattened.findIndex(
    (step) => step.type === 'github_fetch_reviews',
  );
  const ifIndex = flattened.findIndex((step) => step.type === 'if');
  const closeLabels = flattened
    .filter((step) => step.type === 'github_close_pr')
    .map((step) => step.label);

  assert.ok(openIndex > -1);
  assert.ok(waitIndex > openIndex);
  assert.ok(fetchIndex > waitIndex);
  assert.ok(ifIndex > fetchIndex);
  assert.deepEqual(closeLabels, [
    'Close GitHub Review Pull Request Before Minor Fix Loopback',
    'Close GitHub Review Pull Request Before Task-Up Loopback',
  ]);
  assert.ok(
    flattened.some((step) => step.commandName === 'external_review_findings'),
  );
});

test('github review runtime keeps clean-cycle reachable before untaken findings agent validation', async () => {
  const workingRepo = await createGitHubReviewRepoFixture();
  try {
    await writeGitHubReviewHandoff({
      repoRoot: workingRepo,
      reviewCount: 0,
    });

    await withFlowServer(
      () => 'ok',
      async ({ tmpDir, wsUrl, baseUrl }) => {
        await writeGitHubReviewRuntimeFlow({
          dir: tmpDir,
          flowName: 'github-review-runtime-clean',
          thenSteps: [
            {
              type: 'llm',
              agentType: 'missing_agent',
              identifier: 'untaken-findings',
              messages: [
                {
                  role: 'user',
                  content: ['Untaken findings branch should stay excluded.'],
                },
              ],
            },
          ],
          elseSteps: [
            {
              type: 'llm',
              agentType: 'planning_agent',
              identifier: 'main',
              messages: [
                {
                  role: 'user',
                  content: ['Clean-cycle branch stayed reachable.'],
                },
              ],
            },
          ],
        });

        const result = await supertest(baseUrl)
          .post('/flows/github-review-runtime-clean/run')
          .send({
            source: 'REST',
            working_folder: workingRepo,
          });
        assert.equal(result.status, 202);

        const conversationId = result.body.conversationId;
        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes('Clean-cycle branch stayed reachable.'),
            ),
          4000,
        );
        assert.equal(
          turns.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Clean-cycle branch stayed reachable.'),
          ).length,
          1,
        );
        assert.equal(
          turns.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes(
                'Untaken findings branch should stay excluded.',
              ),
          ).length,
          0,
        );
        await cleanupConversationRuntime(
          conversationId,
          ...getAgentConversationIds(conversationId, ['planning_agent:main']),
        );
      },
      { listIngestedRepositoriesFn: async () => listHarnessRepo(workingRepo) },
    );
  } finally {
    await fs.rm(workingRepo, { recursive: true, force: true });
  }
});

test('github review runtime keeps findings-present reachable before untaken clean-branch command validation', async () => {
  const workingRepo = await createGitHubReviewRepoFixture();
  try {
    await writeGitHubReviewHandoff({
      repoRoot: workingRepo,
      reviewCount: 2,
      commentCount: 1,
    });

    await withFlowServer(
      () => 'ok',
      async ({ tmpDir, wsUrl, baseUrl }) => {
        await writeGitHubReviewRuntimeFlow({
          dir: tmpDir,
          flowName: 'github-review-runtime-findings',
          thenSteps: [
            {
              type: 'llm',
              agentType: 'planning_agent',
              identifier: 'main',
              messages: [
                {
                  role: 'user',
                  content: ['Findings branch stayed reachable.'],
                },
              ],
            },
          ],
          elseSteps: [
            {
              type: 'command',
              agentType: 'planning_agent',
              identifier: 'untaken-clean',
              commandName: 'missing_command',
            },
            {
              type: 'llm',
              agentType: 'planning_agent',
              identifier: 'main',
              messages: [
                {
                  role: 'user',
                  content: ['Untaken clean branch should stay excluded.'],
                },
              ],
            },
          ],
        });

        const result = await supertest(baseUrl)
          .post('/flows/github-review-runtime-findings/run')
          .send({
            source: 'REST',
            working_folder: workingRepo,
          });
        assert.equal(result.status, 202);

        const conversationId = result.body.conversationId;
        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes('Findings branch stayed reachable.'),
            ),
          4000,
        );
        assert.equal(
          turns.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Findings branch stayed reachable.'),
          ).length,
          1,
        );
        assert.equal(
          turns.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes(
                'Untaken clean branch should stay excluded.',
              ),
          ).length,
          0,
        );
        await cleanupConversationRuntime(
          conversationId,
          ...getAgentConversationIds(conversationId, ['planning_agent:main']),
        );
      },
      { listIngestedRepositoriesFn: async () => listHarnessRepo(workingRepo) },
    );
  } finally {
    await fs.rm(workingRepo, { recursive: true, force: true });
  }
});

test('github review runtime resumes through repaired wait and review handoff state before untaken branch validation', async () => {
  const workingRepo = await createGitHubReviewRepoFixture();
  try {
    await writeGitHubReviewHandoff({
      repoRoot: workingRepo,
      reviewCount: 1,
      commentCount: 1,
      legacyReviewCount: 0,
      legacyCommentCount: 0,
    });

    await withFlowServer(
      () => 'ok',
      async ({ tmpDir, wsUrl, baseUrl }) => {
        await writeGitHubReviewRuntimeFlow({
          dir: tmpDir,
          flowName: 'github-review-runtime-resume',
          includeWait: true,
          thenSteps: [
            {
              type: 'llm',
              agentType: 'planning_agent',
              identifier: 'main',
              messages: [
                {
                  role: 'user',
                  content: ['Resumed review context stayed on findings branch.'],
                },
              ],
            },
          ],
          elseSteps: [
            {
              type: 'command',
              agentType: 'planning_agent',
              identifier: 'untaken-clean',
              commandName: 'missing_command',
            },
            {
              type: 'llm',
              agentType: 'planning_agent',
              identifier: 'main',
              messages: [
                {
                  role: 'user',
                  content: ['Stale clean-cycle scratch should stay excluded.'],
                },
              ],
            },
          ],
        });

        const result = await supertest(baseUrl)
          .post('/flows/github-review-runtime-resume/run')
          .send({
            source: 'REST',
            working_folder: workingRepo,
            retryOwnershipId: 'review-resume-retry',
          });
        assert.equal(result.status, 202);

        const conversationId = result.body.conversationId;
        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await waitForPredicate(() => {
          const flowState = (memoryConversations.get(conversationId)?.flags ??
            {}) as {
            flow?: {
              wait?: { stepPath?: number[] };
            };
          };
          return (
            Array.isArray(flowState.flow?.wait?.stepPath) &&
            flowState.flow?.wait?.stepPath?.[0] === 0
          );
        }, 4000, 'Timed out waiting for persisted review wait state');
        const resumed = await supertest(baseUrl)
          .post('/flows/github-review-runtime-resume/run')
          .send({
            conversationId,
            source: 'REST',
            working_folder: workingRepo,
            resumeStepPath: [0],
          });
        assert.equal(resumed.status, 202);

        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes(
                  'Resumed review context stayed on findings branch.',
                ),
            ),
          4000,
          () =>
            describeFlowRuntimeState(conversationId, [
              'planning_agent:main',
              'planning_agent:untaken-clean',
            ]),
        );
        assert.equal(
          turns.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes(
                'Resumed review context stayed on findings branch.',
              ),
          ).length,
          1,
        );
        assert.equal(
          turns.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes(
                'Stale clean-cycle scratch should stay excluded.',
              ),
          ).length,
          0,
        );
        await waitForPredicate(() => {
          const flowState = (memoryConversations.get(conversationId)?.flags ??
            {}) as {
            flow?: { wait?: unknown };
          };
          return flowState.flow?.wait === undefined;
        }, 4000, 'Timed out waiting for resumed review wait state to clear');
        await cleanupConversationRuntime(
          conversationId,
          ...getAgentConversationIds(conversationId, ['planning_agent:main']),
        );
      },
      { listIngestedRepositoriesFn: async () => listHarnessRepo(workingRepo) },
    );
  } finally {
    await fs.rm(workingRepo, { recursive: true, force: true });
  }
});

test('github review runtime re-derives canonical execution-scoped handoff authority before helper launch reads disk', async () => {
  const workingRepo = await createGitHubReviewRepoFixture();
  try {
    await withFlowServer(
      () => 'ok',
      async ({ tmpDir, wsUrl, baseUrl }) => {
        await writeGitHubReviewRuntimeFlow({
          dir: tmpDir,
          flowName: 'github-review-runtime-canonical-resume-authority',
          includeWait: true,
          thenSteps: [
            {
              type: 'llm',
              agentType: 'planning_agent',
              identifier: 'main',
              messages: [
                {
                  role: 'user',
                  content: [
                    'Canonical resumed handoff authority stayed on the findings branch.',
                  ],
                },
              ],
            },
          ],
          elseSteps: [
            {
              type: 'llm',
              agentType: 'planning_agent',
              identifier: 'untaken-clean',
              messages: [
                {
                  role: 'user',
                  content: [
                    'Foreign resumed handoff path should stay excluded before helper reads disk.',
                  ],
                },
              ],
            },
          ],
        });

        const result = await supertest(baseUrl)
          .post('/flows/github-review-runtime-canonical-resume-authority/run')
          .send({
            source: 'REST',
            working_folder: workingRepo,
            retryOwnershipId: 'canonical-review-resume-retry',
          });
        assert.equal(result.status, 202);

        const conversationId = result.body.conversationId;
        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await waitForPredicate(() => {
          const flowState = (memoryConversations.get(conversationId)?.flags ??
            {}) as {
            flow?: { wait?: { stepPath?: number[] } };
          };
          return (
            Array.isArray(flowState.flow?.wait?.stepPath) &&
            flowState.flow?.wait?.stepPath?.[0] === 0
          );
        }, 4000, 'Timed out waiting for persisted canonical review wait state');

        const foreignHandoffDir = path.join(
          workingRepo,
          'codeInfoTmp/reviews/foreign-handoff-dir',
        );
        const foreignSelectorDir = path.join(
          workingRepo,
          'codeInfoTmp/reviews/foreign-selector-dir',
        );
        await fs.mkdir(foreignHandoffDir, { recursive: true });
        await fs.mkdir(foreignSelectorDir, { recursive: true });

        const flowFlags = (memoryConversations.get(conversationId)?.flags ??
          {}) as {
          flow?: {
            executionId?: string;
            wait?: {
              githubReviewContext?: {
                executionId?: string;
                prNumber?: number;
                storyNumber?: string;
                branchName?: string;
                selectorPath?: string;
                handoffPath?: string;
              };
            };
          };
        };
        assert.ok(flowFlags.flow?.executionId);
        await writeGitHubReviewHandoff({
          repoRoot: workingRepo,
          executionId: flowFlags.flow!.executionId,
          reviewCount: 1,
          commentCount: 1,
          legacyReviewCount: 0,
          legacyCommentCount: 0,
        });
        flowFlags.flow!.wait!.githubReviewContext = {
          executionId: flowFlags.flow!.executionId,
          storyNumber: '0000060',
          branchName: 'feature/0000060-demo',
          selectorPath: foreignSelectorDir,
          handoffPath: foreignHandoffDir,
        };
        memoryConversations.get(conversationId)!.flags = flowFlags;

        const resumed = await supertest(baseUrl)
          .post('/flows/github-review-runtime-canonical-resume-authority/run')
          .send({
            conversationId,
            source: 'REST',
            working_folder: workingRepo,
            resumeStepPath: [0],
          });
        assert.equal(resumed.status, 202);

        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes(
                  'Canonical resumed handoff authority stayed on the findings branch.',
                ),
            ),
          4000,
        );
        assert.equal(
          turns.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes(
                'Canonical resumed handoff authority stayed on the findings branch.',
              ),
          ).length,
          1,
        );
        assert.equal(
          turns.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes(
                'Foreign resumed handoff path should stay excluded before helper reads disk.',
              ),
          ).length,
          0,
        );
        assert.equal(
          turns.some(
            (turn) =>
              turn.role === 'assistant' &&
              turn.status === 'failed' &&
              turn.content.includes(
                'canonical execution-scoped ownership contract',
              ),
          ),
          false,
        );
        await waitForPredicate(() => {
          const flowState = (memoryConversations.get(conversationId)?.flags ??
            {}) as {
            flow?: { wait?: unknown };
          };
          return flowState.flow?.wait === undefined;
        }, 4000, 'Timed out waiting for canonical resumed review wait state to clear');
        await cleanupConversationRuntime(
          conversationId,
          ...getAgentConversationIds(conversationId, ['planning_agent:main']),
        );
      },
      { listIngestedRepositoriesFn: async () => listHarnessRepo(workingRepo) },
    );
  } finally {
    await fs.rm(workingRepo, { recursive: true, force: true });
  }
});

test('github review runtime keeps the newer execution selector authoritative after an older run later attempts to reclaim scratch ownership', async () => {
  const repoRoot = await createGitHubReviewRepoFixture();
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoTmp/reviews'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoTmp/reviews/0000060-current-review.json'),
      JSON.stringify(
        {
          pull_request: { number: 12 },
          stale: true,
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoTmp/reviews/0000060-external-review-input.md'),
      'stale input\n',
      'utf8',
    );

    const latestPullPage = JSON.stringify([
      {
        number: 45,
        html_url: 'https://github.com/example/repo/pull/45',
        title: 'latest pull request',
        created_at: '2026-06-24T10:00:00Z',
        head: {
          ref: 'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
        },
        base: { ref: 'main' },
        user: { login: 'review-bot' },
      },
    ]);
    const reviewsSlurp = await fs.readFile(
      path.join(githubReviewFixturesDir, 'reviews-slurp.json'),
      'utf8',
    );
    const commentsSlurp = await fs.readFile(
      path.join(githubReviewFixturesDir, 'comments-slurp.json'),
      'utf8',
    );

    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        const joined = params.args.join(' ');
        if (joined === 'branch --show-current') {
          return {
            exitCode: 0,
            stdout:
              'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps\n',
            stderr: '',
          };
        }
        if (joined === 'rev-parse HEAD') {
          return { exitCode: 0, stdout: 'deadbeef\n', stderr: '' };
        }
        if (joined === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') {
          return {
            exitCode: 0,
            stdout:
              'origin/feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps\n',
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
        if (
          joined ===
          'push origin HEAD:feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps'
        ) {
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        if (params.args[0] === 'pr' && params.args[1] === 'create') {
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'connection dropped after create',
          };
        }
        const endpoint = params.args.at(-1) ?? '';
        if (endpoint.includes('/pulls?state=open&head=')) {
          return { exitCode: 0, stdout: latestPullPage, stderr: '' };
        }
        if (endpoint.endsWith('/pulls/45')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              number: 45,
              html_url: 'https://github.com/example/repo/pull/45',
              head: {
                ref: 'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
              },
              base: { ref: 'main' },
            }),
            stderr: '',
          };
        }
        if (endpoint.includes('/reviews?')) {
          return { exitCode: 0, stdout: reviewsSlurp, stderr: '' };
        }
        if (endpoint.includes('/comments?')) {
          return { exitCode: 0, stdout: commentsSlurp, stderr: '' };
        }
        throw new Error(`Unexpected command: ${joined}`);
      },
      sleep: async () => {},
    });

    await withFlowServer(
      () => 'ok',
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const conversationId = 'github-review-runtime-conv';
        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

        await fs.writeFile(
          path.join(tmpDir, 'github-review-runtime.json'),
          JSON.stringify(
            {
              description: 'Minimal GitHub review runtime proof',
              steps: [
                {
                  type: 'github_open_pr',
                  label: 'Open GitHub Review Pull Request',
                },
                {
                  type: 'github_fetch_reviews',
                  label: 'Fetch GitHub Review Feedback',
                },
              ],
            },
            null,
            2,
          ),
          'utf8',
        );

        await supertest(baseUrl)
          .post('/flows/github-review-runtime/run')
          .send({ conversationId, working_folder: repoRoot })
          .expect(202);

        const selectorPath = path.join(
          repoRoot,
          'codeInfoTmp/reviews/0000060-github-review-current.json',
        );
        let handoff:
          | {
              handoff_kind?: string;
              execution_id?: string;
              pull_request: { number: number };
              external_review_input_file?: string;
            }
          | undefined;
        let externalInput = '';
        const started = Date.now();
        while (Date.now() - started < 4000) {
          try {
            const parsed = await readGitHubReviewScratch({
              handoffPath: selectorPath,
            });
            if (parsed.kind !== 'ok') {
              throw new Error(parsed.message);
            }
            const currentHandoff = parsed.value;
            handoff = currentHandoff as typeof handoff;
            externalInput = await fs.readFile(
              currentHandoff.external_review_input_file ?? '',
              'utf8',
            );
            if (
              currentHandoff.pull_request.number === 45 &&
              /Please revisit the retry wording\./u.test(externalInput)
            ) {
              break;
            }
          } catch {
            // Keep polling until the runtime publishes the fresh Task 7 scratch.
          }
          await delay(25);
        }

        assert.ok(handoff);
        assert.equal(handoff.handoff_kind, 'github-review-handoff-v1');
        assert.ok(handoff.execution_id);
        assert.equal(handoff.pull_request.number, 45);
        assert.match(
          handoff.external_review_input_file ?? '',
          /0000060-github-review-.*-external-review-input\.md$/,
        );
        assert.match(externalInput, /Please revisit the retry wording\./);
        assert.doesNotMatch(externalInput, /stale input/);

        const reclaimAttempt = await writeGitHubReviewScratch({
          repository: {
            workingRepositoryRoot: repoRoot,
            repositoryOwner: 'example',
            repositoryName: 'repo',
            repositoryFullName: 'example/repo',
            currentBranch:
              'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
            headSha: 'cafebabe',
            upstreamRemote: 'origin',
            upstreamBranch:
              'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
            baseBranch: 'main',
            remoteUrl: 'https://github.com/example/repo.git',
          },
          executionId: 'older-execution',
          pullRequest: {
            number: 12,
            url: 'https://github.com/example/repo/pull/12',
            headRefName:
              'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
            baseRefName: 'main',
          },
          artifact: {
            repository: { owner: 'example', name: 'repo' },
            pullRequest: {
              number: 12,
              url: 'https://github.com/example/repo/pull/12',
              headRefName:
                'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
              baseRefName: 'main',
            },
            fetchedAt: '2026-06-27T11:00:00Z',
            reviews: [],
            reviewComments: [],
          },
        });
        assert.equal(reclaimAttempt.kind, 'error');
        assert.match(reclaimAttempt.message, /newer or foreign flow execution/i);

        const stillAuthoritative = await readGitHubReviewScratch({
          handoffPath: selectorPath,
        });
        assert.equal(stillAuthoritative.kind, 'ok');
        assert.equal(
          stillAuthoritative.value.execution_id,
          handoff.execution_id,
        );
        assert.equal(stillAuthoritative.value.pull_request.number, 45);

        await cleanupConversationRuntime(conversationId);
      },
      {
        listIngestedRepositoriesFn: async () => listHarnessRepo(repoRoot),
      },
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('github review runtime preserves producer-side token loader failures instead of rewriting them into skip warnings', async () => {
  const repoRoot = await createGitHubReviewRepoFixture();
  try {
    await fs.rm(path.join(repoRoot, '.env.local'), { force: true });
    await fs.mkdir(path.join(repoRoot, '.env.local'));

    await withFlowServer(
      () => 'ok',
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const conversationId = 'github-review-runtime-token-loader-failure';
        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

        await fs.writeFile(
          path.join(tmpDir, 'github-review-runtime-token-loader-failure.json'),
          JSON.stringify(
            {
              description: 'Minimal GitHub review runtime failure proof',
              steps: [
                {
                  type: 'github_open_pr',
                  label: 'Open GitHub Review Pull Request',
                },
              ],
            },
            null,
            2,
          ),
          'utf8',
        );

        await supertest(baseUrl)
          .post('/flows/github-review-runtime-token-loader-failure/run')
          .send({ conversationId, working_folder: repoRoot })
          .expect(202);

        const final = await waitForLoopTerminalOutcome({
          ws: wsUrl,
          conversationId,
          expectedStatus: 'failed',
          timeoutMs: 4000,
        });

        assert.equal(final.status, 'failed');
        assert.equal(final.errorCode, 'ENV_LOCAL_READ_FAILED');
        assert.match(
          final.errorMessage ?? '',
          /(?:\.env\.local|EISDIR|permission denied)/u,
        );

        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) => turn.role === 'assistant' && turn.status === 'failed',
            ),
          4000,
        );
        assert.equal(
          turns.some(
            (turn) =>
              turn.role === 'assistant' &&
              turn.status === 'warning' &&
              turn.content.includes('GitHub review stage skipped during PR open'),
          ),
          false,
        );

        await cleanupConversationRuntime(conversationId);
      },
      {
        listIngestedRepositoriesFn: async () => listHarnessRepo(repoRoot),
      },
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('github review resume keeps execution-scoped fetch and close authority even when a newer run owns the shared selector', async () => {
  const repoRoot = await createGitHubReviewRepoFixture();
  try {
    const selectorPath = path.join(
      repoRoot,
      'codeInfoTmp/reviews/0000060-github-review-current.json',
    );
    const oldHandoffPath = path.join(
      repoRoot,
      'codeInfoTmp/reviews/0000060-github-review-exec-old-current.json',
    );
    const newHandoffPath = path.join(
      repoRoot,
      'codeInfoTmp/reviews/0000060-github-review-exec-new-current.json',
    );
    await fs.mkdir(path.dirname(selectorPath), { recursive: true });
    await fs.writeFile(
      oldHandoffPath,
      JSON.stringify(
        {
          handoff_kind: 'github-review-handoff-v1',
          execution_id: 'exec-old',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: repoRoot,
          branch_name:
            'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
          head_sha: 'oldsha',
          raw_review_artifact_path: path.join(
            repoRoot,
            'codeInfoTmp/reviews/0000060-github-review-exec-old-pr-77.json',
          ),
          pull_request: {
            number: 77,
            url: 'https://github.com/example/repo/pull/77',
            headRefName:
              'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
            baseRefName: 'main',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      newHandoffPath,
      JSON.stringify(
        {
          handoff_kind: 'github-review-handoff-v1',
          execution_id: 'exec-new',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: repoRoot,
          branch_name:
            'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
          head_sha: 'newsha',
          raw_review_artifact_path: path.join(
            repoRoot,
            'codeInfoTmp/reviews/0000060-github-review-exec-new-pr-88.json',
          ),
          pull_request: {
            number: 88,
            url: 'https://github.com/example/repo/pull/88',
            headRefName:
              'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
            baseRefName: 'main',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      selectorPath,
      JSON.stringify(
        {
          selector_kind: 'github-review-selector-v1',
          execution_id: 'exec-new',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: repoRoot,
          branch_name:
            'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
          handoff_path: newHandoffPath,
        },
        null,
        2,
      ),
      'utf8',
    );

    const commandLog: string[] = [];
    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        const joined = params.args.join(' ');
        commandLog.push(`${params.command} ${joined}`);
        if (params.command === 'git') {
          if (joined === 'branch --show-current') {
            return {
              exitCode: 0,
              stdout:
                'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps\n',
              stderr: '',
            };
          }
          if (joined === 'rev-parse HEAD') {
            return { exitCode: 0, stdout: 'cafebabe\n', stderr: '' };
          }
          if (joined === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') {
            return {
              exitCode: 0,
              stdout:
                'origin/feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps\n',
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
        }
        if (params.command === 'gh') {
          const endpoint = params.args.at(-1) ?? '';
          if (endpoint.includes('/pulls?state=open&head=')) {
            throw new Error(
              'resumed execution should not fall back to branch-latest PR lookup',
            );
          }
          if (endpoint.includes('/pulls/77/reviews?')) {
            return {
              exitCode: 0,
              stdout: JSON.stringify([[{
                id: 101,
                user: { login: 'reviewer' },
                body: 'Persist the older execution authority.',
                state: 'COMMENTED',
                submitted_at: '2026-06-27T18:45:00Z',
              }]]),
              stderr: '',
            };
          }
          if (endpoint.includes('/pulls/77/comments?')) {
            return {
              exitCode: 0,
              stdout: JSON.stringify([[{
                id: 202,
                user: { login: 'reviewer' },
                body: 'Inline reminder',
                path: 'server/src/flows/service.ts',
                line: 1,
                created_at: '2026-06-27T18:46:00Z',
              }]]),
              stderr: '',
            };
          }
          if (joined === 'pr close 77 --repo example/repo') {
            return { exitCode: 0, stdout: '', stderr: '' };
          }
        }
        throw new Error(`Unexpected command: ${params.command} ${joined}`);
      },
    });

    await withFlowServer(
      () => 'ok',
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const conversationId = 'github-review-resume-authority-conv';
        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

        memoryConversations.set(conversationId, {
          _id: conversationId,
          provider: 'codex',
          model: 'gpt-5.2-codex',
          title: 'Flow: github-review-resume-authority',
          flowName: 'github-review-resume-authority',
          source: 'REST',
          flags: {
            flow: {
              executionId: 'exec-old',
              stepPath: [0],
              loopStack: [],
              agentConversations: {},
              agentThreads: {},
              wait: {
                executionId: 'exec-old',
                stepPath: [0],
                loopStack: [],
                workingFolder: repoRoot,
                resumeAt: Date.now() - 1000,
                githubReviewContext: {
                  executionId: 'exec-old',
                  prNumber: 77,
                  storyNumber: '0000060',
                  branchName:
                    'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
                  selectorPath,
                  handoffPath: oldHandoffPath,
                },
              },
            },
          },
          lastMessageAt: new Date(),
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await fs.writeFile(
          path.join(tmpDir, 'github-review-resume-authority.json'),
          JSON.stringify(
            {
              description:
                'Resume GitHub review with execution-scoped authority',
              steps: [
                {
                  type: 'wait',
                  label: 'Wait before resuming review authority',
                  seconds: 60,
                },
                {
                  type: 'github_fetch_reviews',
                  label: 'Fetch persisted GitHub review feedback',
                },
                {
                  type: 'github_close_pr',
                  label: 'Close persisted GitHub review pull request',
                },
              ],
            },
            null,
            2,
          ),
          'utf8',
        );

        await supertest(baseUrl)
          .post('/flows/github-review-resume-authority/run')
          .send({
            conversationId,
            working_folder: repoRoot,
            resumeStepPath: [0],
          })
          .expect(202);

        const started = Date.now();
        while (Date.now() - started < 4000) {
          const currentHandoff = await readGitHubReviewScratch({
            handoffPath: oldHandoffPath,
            expectedExecutionId: 'exec-old',
          });
          if (
            currentHandoff.kind === 'ok' &&
            currentHandoff.value.filtered_review_count === 1 &&
            currentHandoff.value.filtered_review_comment_count === 1 &&
            commandLog.some((entry) => entry.includes('gh pr close 77 --repo'))
          ) {
            break;
          }
          await delay(25);
        }

        const selector = JSON.parse(
          await fs.readFile(selectorPath, 'utf8'),
        ) as { execution_id: string };
        assert.equal(selector.execution_id, 'exec-new');
        const handoff = await readGitHubReviewScratch({
          handoffPath: oldHandoffPath,
          expectedExecutionId: 'exec-old',
        });
        assert.equal(handoff.kind, 'ok');
        assert.equal(handoff.value.pull_request.number, 77);
        assert.equal(handoff.value.filtered_review_count, 1);
        assert.equal(handoff.value.filtered_review_comment_count, 1);
        assert.ok(
          commandLog.some((entry) => entry.includes('gh pr close 77 --repo')),
        );
        assert.equal(
          commandLog.some((entry) => entry.includes('/pulls?state=open&head=')),
          false,
        );

        await cleanupConversationRuntime(conversationId);
      },
      {
        listIngestedRepositoriesFn: async () => listHarnessRepo(repoRoot),
      },
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('github review resume warns on PR mismatch and adopts a same-branch newer PR for fetch and close', async () => {
  const repoRoot = await createGitHubReviewRepoFixture();
  try {
    const selectorPath = path.join(
      repoRoot,
      'codeInfoTmp/reviews/0000060-github-review-current.json',
    );
    const handoffPath = path.join(
      repoRoot,
      'codeInfoTmp/reviews/0000060-github-review-exec-mismatch-current.json',
    );
    await fs.mkdir(path.dirname(selectorPath), { recursive: true });
    await fs.writeFile(
      handoffPath,
      JSON.stringify(
        {
          handoff_kind: 'github-review-handoff-v1',
          execution_id: 'exec-mismatch',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: repoRoot,
          branch_name:
            'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
          head_sha: 'oldsha',
          raw_review_artifact_path: path.join(
            repoRoot,
            'codeInfoTmp/reviews/0000060-github-review-exec-mismatch-pr-77.json',
          ),
          pull_request: {
            number: 77,
            url: 'https://github.com/example/repo/pull/77',
            headRefName:
              'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
            baseRefName: 'main',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      selectorPath,
      JSON.stringify(
        {
          selector_kind: 'github-review-selector-v1',
          execution_id: 'exec-mismatch',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: repoRoot,
          branch_name:
            'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
          handoff_path: handoffPath,
        },
        null,
        2,
      ),
      'utf8',
    );

    const commandLog: string[] = [];
    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        const joined = params.args.join(' ');
        commandLog.push(`${params.command} ${joined}`);
        if (params.command === 'git') {
          if (joined === 'branch --show-current') {
            return {
              exitCode: 0,
              stdout:
                'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps\n',
              stderr: '',
            };
          }
          if (joined === 'rev-parse HEAD') {
            return { exitCode: 0, stdout: 'cafebabe\n', stderr: '' };
          }
          if (joined === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') {
            return {
              exitCode: 0,
              stdout:
                'origin/feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps\n',
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
        }
        if (params.command === 'gh') {
          const endpoint = params.args.at(-1) ?? '';
          if (endpoint.includes('/pulls?state=open&head=')) {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                [
                  {
                    number: 79,
                    html_url: 'https://github.com/example/repo/pull/79',
                    head: {
                      ref: 'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
                    },
                    base: { ref: 'main' },
                    created_at: '2026-06-28T19:00:00Z',
                  },
                ],
              ]),
              stderr: '',
            };
          }
          if (endpoint.includes('/pulls/79/reviews?')) {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                [
                  {
                    id: 301,
                    user: { login: 'reviewer' },
                    body: 'Use the newer same-branch PR.',
                    state: 'COMMENTED',
                    submitted_at: '2026-06-28T19:10:00Z',
                  },
                ],
              ]),
              stderr: '',
            };
          }
          if (endpoint.includes('/pulls/79/comments?')) {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                [
                  {
                    id: 302,
                    user: { login: 'reviewer' },
                    body: 'Inline reminder on the newer PR.',
                    path: 'server/src/flows/service.ts',
                    line: 1,
                    created_at: '2026-06-28T19:11:00Z',
                  },
                ],
              ]),
              stderr: '',
            };
          }
          if (joined === 'pr close 79 --repo example/repo') {
            return { exitCode: 0, stdout: '', stderr: '' };
          }
        }
        throw new Error(`Unexpected command: ${params.command} ${joined}`);
      },
    });

    await withFlowServer(
      () => 'ok',
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const conversationId = 'github-review-resume-mismatch-conv';
        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

        memoryConversations.set(conversationId, {
          _id: conversationId,
          provider: 'codex',
          model: 'gpt-5.2-codex',
          title: 'Flow: github-review-resume-mismatch',
          flowName: 'github-review-resume-mismatch',
          source: 'REST',
          flags: {
            flow: {
              executionId: 'exec-mismatch',
              stepPath: [0],
              loopStack: [],
              agentConversations: {},
              agentThreads: {},
              wait: {
                executionId: 'exec-mismatch',
                stepPath: [0],
                loopStack: [],
                workingFolder: repoRoot,
                resumeAt: Date.now() - 1000,
                githubReviewContext: {
                  executionId: 'exec-mismatch',
                  prNumber: 78,
                  storyNumber: '0000060',
                  branchName:
                    'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
                  selectorPath,
                  handoffPath,
                },
              },
            },
          },
          lastMessageAt: new Date(),
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await fs.writeFile(
          path.join(tmpDir, 'github-review-resume-mismatch.json'),
          JSON.stringify(
            {
              description:
                'Resume GitHub review with mismatch recovery to newer PR',
              steps: [
                {
                  type: 'wait',
                  label: 'Wait before resuming review mismatch flow',
                  seconds: 60,
                },
                {
                  type: 'github_fetch_reviews',
                  label: 'Fetch reconciled GitHub review feedback',
                },
                {
                  type: 'github_close_pr',
                  label: 'Close reconciled GitHub review pull request',
                },
              ],
            },
            null,
            2,
          ),
          'utf8',
        );

        await supertest(baseUrl)
          .post('/flows/github-review-resume-mismatch/run')
          .send({
            conversationId,
            working_folder: repoRoot,
            resumeStepPath: [0],
          })
          .expect(202);

        const warningTurns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'assistant' &&
                turn.status === 'warning' &&
                turn.content.includes(
                  'Resumed GitHub review execution expected persisted pull request #77',
                ),
            ),
          4000,
        );
        assert.equal(
          warningTurns.filter(
            (turn) =>
              turn.role === 'assistant' &&
              turn.status === 'warning' &&
              turn.content.includes('Adopting newer pull request #79'),
          ).length,
          1,
        );

        const started = Date.now();
        while (Date.now() - started < 4000) {
          const currentHandoff = await readGitHubReviewScratch({
            handoffPath,
            expectedExecutionId: 'exec-mismatch',
          });
          if (
            currentHandoff.kind === 'ok' &&
            currentHandoff.value.pull_request.number === 79 &&
            currentHandoff.value.filtered_review_count === 1 &&
            currentHandoff.value.filtered_review_comment_count === 1 &&
            commandLog.some((entry) => entry.includes('gh pr close 79 --repo'))
          ) {
            break;
          }
          await delay(25);
        }

        const updatedHandoff = await readGitHubReviewScratch({
          handoffPath,
          expectedExecutionId: 'exec-mismatch',
        });
        assert.equal(updatedHandoff.kind, 'ok');
        assert.equal(updatedHandoff.value.pull_request.number, 79);
        assert.equal(updatedHandoff.value.filtered_review_count, 1);
        assert.equal(updatedHandoff.value.filtered_review_comment_count, 1);
        assert.ok(
          commandLog.some((entry) => entry.includes('/pulls?state=open&head=')),
        );
        assert.ok(
          commandLog.some((entry) => entry.includes('/pulls/79/reviews?')),
        );
        assert.ok(
          commandLog.some((entry) => entry.includes('gh pr close 79 --repo')),
        );

        await cleanupConversationRuntime(conversationId);
      },
      {
        listIngestedRepositoriesFn: async () => listHarnessRepo(repoRoot),
      },
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('github review resume re-enters same-branch authority before stale PR fallback when the execution-scoped handoff is missing', async () => {
  const repoRoot = await createGitHubReviewRepoFixture();
  try {
    const selectorPath = path.join(
      repoRoot,
      'codeInfoTmp/reviews/0000060-github-review-current.json',
    );
    const handoffPath = path.join(
      repoRoot,
      'codeInfoTmp/reviews/0000060-github-review-exec-missing-current.json',
    );
    await fs.mkdir(path.dirname(selectorPath), { recursive: true });
    await fs.writeFile(
      selectorPath,
      JSON.stringify(
        {
          selector_kind: 'github-review-selector-v1',
          execution_id: 'exec-missing',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: repoRoot,
          branch_name:
            'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
          handoff_path: handoffPath,
        },
        null,
        2,
      ),
      'utf8',
    );

    const commandLog: string[] = [];
    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        const joined = params.args.join(' ');
        commandLog.push(`${params.command} ${joined}`);
        if (params.command === 'git') {
          if (joined === 'branch --show-current') {
            return {
              exitCode: 0,
              stdout:
                'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps\n',
              stderr: '',
            };
          }
          if (joined === 'rev-parse HEAD') {
            return { exitCode: 0, stdout: 'cafebabe\n', stderr: '' };
          }
          if (joined === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') {
            return {
              exitCode: 0,
              stdout:
                'origin/feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps\n',
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
        }
        if (params.command === 'gh') {
          const endpoint = params.args.at(-1) ?? '';
          if (endpoint.includes('/pulls?state=open&head=')) {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                [
                  {
                    number: 79,
                    html_url: 'https://github.com/example/repo/pull/79',
                    head: {
                      ref: 'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
                    },
                    base: { ref: 'main' },
                    created_at: '2026-06-28T19:00:00Z',
                  },
                ],
              ]),
              stderr: '',
            };
          }
          if (endpoint.includes('/pulls/79/reviews?')) {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                [
                  {
                    id: 401,
                    user: { login: 'reviewer' },
                    body: 'Use the latest branch PR.',
                    state: 'COMMENTED',
                    submitted_at: '2026-06-28T19:20:00Z',
                  },
                ],
              ]),
              stderr: '',
            };
          }
          if (endpoint.includes('/pulls/79/comments?')) {
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                [
                  {
                    id: 402,
                    user: { login: 'reviewer' },
                    body: 'Inline on the recovered PR.',
                    path: 'server/src/flows/service.ts',
                    line: 1,
                    created_at: '2026-06-28T19:21:00Z',
                  },
                ],
              ]),
              stderr: '',
            };
          }
          if (joined === 'pr close 79 --repo example/repo') {
            return { exitCode: 0, stdout: '', stderr: '' };
          }
        }
        throw new Error(`Unexpected command: ${params.command} ${joined}`);
      },
    });

    await withFlowServer(
      () => 'ok',
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const conversationId = 'github-review-resume-missing-handoff-conv';
        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

        memoryConversations.set(conversationId, {
          _id: conversationId,
          provider: 'codex',
          model: 'gpt-5.2-codex',
          title: 'Flow: github-review-resume-missing-handoff',
          flowName: 'github-review-resume-missing-handoff',
          source: 'REST',
          flags: {
            flow: {
              executionId: 'exec-missing',
              stepPath: [0],
              loopStack: [],
              agentConversations: {},
              agentThreads: {},
              wait: {
                executionId: 'exec-missing',
                stepPath: [0],
                loopStack: [],
                workingFolder: repoRoot,
                resumeAt: Date.now() - 1000,
                githubReviewContext: {
                  executionId: 'exec-missing',
                  prNumber: 78,
                  storyNumber: '0000060',
                  branchName:
                    'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
                  selectorPath,
                  handoffPath,
                },
              },
            },
          },
          lastMessageAt: new Date(),
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await fs.writeFile(
          path.join(tmpDir, 'github-review-resume-missing-handoff.json'),
          JSON.stringify(
            {
              description:
                'Resume GitHub review after losing the execution-scoped handoff',
              steps: [
                {
                  type: 'wait',
                  label: 'Wait before resuming review after handoff loss',
                  seconds: 60,
                },
                {
                  type: 'github_fetch_reviews',
                  label: 'Fetch recovered GitHub review feedback',
                },
                {
                  type: 'github_close_pr',
                  label: 'Close recovered GitHub review pull request',
                },
              ],
            },
            null,
            2,
          ),
          'utf8',
        );

        await supertest(baseUrl)
          .post('/flows/github-review-resume-missing-handoff/run')
          .send({
            conversationId,
            working_folder: repoRoot,
            resumeStepPath: [0],
          })
          .expect(202);

        const warningTurns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'assistant' &&
                turn.status === 'warning' &&
                turn.content.includes('lost its execution-scoped handoff'),
            ),
          4000,
        );
        assert.equal(
          warningTurns.filter(
            (turn) =>
              turn.role === 'assistant' &&
              turn.status === 'warning' &&
              turn.content.includes('lost its execution-scoped handoff'),
          ).length,
          1,
        );

        const started = Date.now();
        while (Date.now() - started < 4000) {
          const currentHandoff = await readGitHubReviewScratch({
            handoffPath,
            expectedExecutionId: 'exec-missing',
          });
          if (
            currentHandoff.kind === 'ok' &&
            currentHandoff.value.pull_request.number === 79 &&
            currentHandoff.value.filtered_review_count === 1 &&
            currentHandoff.value.filtered_review_comment_count === 1 &&
            commandLog.some((entry) => entry.includes('gh pr close 79 --repo'))
          ) {
            break;
          }
          await delay(25);
        }

        const updatedHandoff = await readGitHubReviewScratch({
          handoffPath,
          expectedExecutionId: 'exec-missing',
        });
        assert.equal(updatedHandoff.kind, 'ok');
        assert.equal(updatedHandoff.value.pull_request.number, 79);
        assert.equal(updatedHandoff.value.filtered_review_count, 1);
        assert.equal(updatedHandoff.value.filtered_review_comment_count, 1);
        assert.ok(
          commandLog.some((entry) => entry.includes('/pulls?state=open&head=')),
        );
        assert.equal(
          commandLog.some((entry) => entry.includes('/pulls/78')),
          false,
        );
        assert.ok(
          commandLog.some((entry) => entry.includes('gh pr close 79 --repo')),
        );

        await cleanupConversationRuntime(conversationId);
      },
      {
        listIngestedRepositoriesFn: async () => listHarnessRepo(repoRoot),
      },
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('continue step skips remaining iteration steps and starts the next iteration', async () => {
  let continueCount = 0;
  await withFlowServer(
    (message) => {
      if (message.includes('Skip remaining loop steps?')) {
        continueCount += 1;
        return JSON.stringify({
          answer: continueCount === 1 ? 'yes' : 'no',
        });
      }
      if (message.includes('Exit outer loop?')) {
        return JSON.stringify({ answer: 'yes' });
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-continue-conv-1';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-continue/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'ok',
        timeoutMs: 4000,
        describe: () =>
          describeFlowRuntimeState(conversationId, [
            'coding_agent:outer',
            'coding_agent:outer-continue',
            'coding_agent:post-continue',
            'coding_agent:outer-break',
          ]),
      });

      assert.equal(final.status, 'ok');
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Skip remaining loop steps?'),
          ).length === 2 &&
          items.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Reached post-continue step.'),
          ).length === 1 &&
          items.filter(
            (turn) =>
              turn.role === 'user' && turn.content.includes('Exit outer loop?'),
          ).length === 1,
        15000,
      );
      const outerLoopTurns = turns.filter(
        (turn) =>
          turn.role === 'user' && turn.content.includes('Outer loop step.'),
      );
      const continueTurns = turns.filter(
        (turn) =>
          turn.role === 'user' &&
          turn.content.includes('Skip remaining loop steps?'),
      );
      const postContinueTurns = turns.filter(
        (turn) =>
          turn.role === 'user' &&
          turn.content.includes('Reached post-continue step.'),
      );
      const breakTurns = turns.filter(
        (turn) =>
          turn.role === 'user' && turn.content.includes('Exit outer loop?'),
      );
      const decisionAnswers = turns.filter(
        (turn) =>
          turn.role === 'assistant' && turn.content.includes('"answer"'),
      );

      assert.equal(outerLoopTurns.length, 2);
      assert.equal(continueTurns.length, 2);
      assert.equal(postContinueTurns.length, 1);
      assert.equal(breakTurns.length, 1);
      assert.equal(decisionAnswers.length, 3);
      assert.equal(continueCount, 2);
      await cleanupConversationRuntime(
        conversationId,
        ...getLoopContinueAgentConversationIds(conversationId),
      );
    },
  );
});

test('continue resume starts the next iteration instead of replaying skipped steps', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Skip remaining loop steps?')) {
        return JSON.stringify({ answer: 'no' });
      }
      if (message.includes('Exit outer loop?')) {
        return JSON.stringify({ answer: 'yes' });
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-continue-resume-conv';
      const outerConversationId = 'flow-loop-continue-resume-outer';
      const continueConversationId = 'flow-loop-continue-resume-continue';

      memoryConversations.set(conversationId, {
        _id: conversationId,
        provider: 'codex',
        model: 'gpt-5.2-codex',
        title: 'Flow: loop-continue',
        flowName: 'loop-continue',
        source: 'REST',
        flags: {
          flow: {
            executionId: 'resume-execution-continue-1',
            stepPath: [0, 1],
            loopStack: [{ loopStepPath: [0], iteration: 1 }],
            pendingLoopControl: {
              kind: 'continue',
              loopStepPath: [0],
            },
            agentConversations: {
              'coding_agent:outer': outerConversationId,
              'coding_agent:outer-continue': continueConversationId,
            },
            agentThreads: {},
          },
        },
        lastMessageAt: new Date(),
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      memoryConversations.set(outerConversationId, {
        _id: outerConversationId,
        provider: 'codex',
        model: 'gpt-5.2-codex',
        title: 'Flow: loop-continue (outer)',
        agentName: 'coding_agent',
        source: 'REST',
        flags: {
          flowChild: {
            executionId: 'resume-execution-continue-1',
          },
        },
        lastMessageAt: new Date(),
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      memoryConversations.set(continueConversationId, {
        _id: continueConversationId,
        provider: 'codex',
        model: 'gpt-5.2-codex',
        title: 'Flow: loop-continue (outer-continue)',
        agentName: 'coding_agent',
        source: 'REST',
        flags: {
          flowChild: {
            executionId: 'resume-execution-continue-1',
          },
        },
        lastMessageAt: new Date(),
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-continue/run')
        .send({ conversationId, resumeStepPath: [0, 1] })
        .expect(202);

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'ok',
        timeoutMs: 4000,
        describe: () => describeLoopContinueResumeState(conversationId),
      });

      assert.equal(final.status, 'ok');
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.filter(
            (turn) =>
              turn.role === 'user' && turn.content.includes('Outer loop step.'),
          ).length === 1 &&
          items.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Skip remaining loop steps?'),
          ).length === 1 &&
          items.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Reached post-continue step.'),
          ).length === 1 &&
          items.filter(
            (turn) =>
              turn.role === 'user' && turn.content.includes('Exit outer loop?'),
          ).length === 1,
        4000,
        () =>
          describeFlowRuntimeState(conversationId, [
            'coding_agent:outer',
            'coding_agent:outer-continue',
            'coding_agent:post-continue',
            'coding_agent:outer-break',
          ]),
      );

      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' && turn.content.includes('Outer loop step.'),
        ).length,
        1,
      );
      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('Skip remaining loop steps?'),
        ).length,
        1,
      );
      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('Reached post-continue step.'),
        ).length,
        1,
      );
      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' && turn.content.includes('Exit outer loop?'),
        ).length,
        1,
      );

      const flowConversation = memoryConversations.get(conversationId);
      const flowFlags = (flowConversation?.flags ?? {}) as {
        flow?: {
          pendingLoopControl?: unknown;
        };
      };
      assert.equal(flowFlags.flow?.pendingLoopControl, undefined);
      await cleanupConversationRuntime(
        conversationId,
        ...getLoopContinueAgentConversationIds(conversationId),
      );
    },
  );
});

test('continue resume keeps its boundary marker until the next iteration makes progress', async () => {
  let runPhase: 'stop' | 'finish' = 'stop';
  let stopRegisteredAtOuterStepStart = false;
  const conversationId = 'flow-loop-continue-resume-stop-conv';
  const outerConversationId = 'flow-loop-continue-resume-stop-outer';
  const continueConversationId = 'flow-loop-continue-resume-stop-continue';
  await withFlowServer(
    (message) => {
      if (message.includes('Outer loop step.')) {
        return runPhase === 'stop' ? '__delay:1000::ok' : 'ok';
      }
      if (message.includes('Skip remaining loop steps?')) {
        return JSON.stringify({ answer: 'no' });
      }
      if (message.includes('Exit outer loop?')) {
        return JSON.stringify({ answer: 'yes' });
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      memoryConversations.set(conversationId, {
        _id: conversationId,
        provider: 'codex',
        model: 'gpt-5.2-codex',
        title: 'Flow: loop-continue',
        flowName: 'loop-continue',
        source: 'REST',
        flags: {
          flow: {
            executionId: 'resume-execution-continue-stop-1',
            stepPath: [0, 1],
            loopStack: [{ loopStepPath: [0], iteration: 1 }],
            pendingLoopControl: {
              kind: 'continue',
              loopStepPath: [0],
            },
            agentConversations: {
              'coding_agent:outer': outerConversationId,
              'coding_agent:outer-continue': continueConversationId,
            },
            agentThreads: {},
          },
        },
        lastMessageAt: new Date(),
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      memoryConversations.set(outerConversationId, {
        _id: outerConversationId,
        provider: 'codex',
        model: 'gpt-5.2-codex',
        title: 'Flow: loop-continue (outer)',
        agentName: 'coding_agent',
        source: 'REST',
        flags: {
          flowChild: {
            executionId: 'resume-execution-continue-stop-1',
          },
        },
        lastMessageAt: new Date(),
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      memoryConversations.set(continueConversationId, {
        _id: continueConversationId,
        provider: 'codex',
        model: 'gpt-5.2-codex',
        title: 'Flow: loop-continue (outer-continue)',
        agentName: 'coding_agent',
        source: 'REST',
        flags: {
          flowChild: {
            executionId: 'resume-execution-continue-stop-1',
          },
        },
        lastMessageAt: new Date(),
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      const firstRun = await supertest(baseUrl)
        .post('/flows/loop-continue/run')
        .send({ conversationId, resumeStepPath: [0, 1] })
        .expect(202);

      await waitFor(
        () => stopRegisteredAtOuterStepStart,
        8000,
        () =>
          JSON.stringify({
            phase: 'waiting_for_stop_registration',
            firstRunInflightId: firstRun.body.inflightId as string,
            stopRegisteredAtOuterStepStart,
            state: JSON.parse(describeLoopContinueResumeState(conversationId)),
          }),
      );

      const stopped = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: ['stopped', 'failed'],
        timeoutMs: 8000,
        describe: () =>
          JSON.stringify({
            phase: 'waiting_for_stopped_terminal_event',
            current: JSON.parse(describeLoopContinueResumeState(conversationId)),
          }),
      });

      assert.ok(stopped.status === 'stopped' || stopped.status === 'failed');
      await waitForRuntimeCleanup(conversationId);

      // The important contract here is behavioral: after the stopped resume,
      // the flow must not have already advanced past the next-iteration
      // boundary. The exact persistence moment for pendingLoopControl is
      // timing-sensitive under load, so assert on visible progress instead of
      // a single internal snapshot.
      const stoppedTurns = memoryTurns.get(conversationId) ?? [];
      const outerCountAfterStop = stoppedTurns.filter(
        (turn) =>
          turn.role === 'user' && turn.content.includes('Outer loop step.'),
      ).length;
      const continueCountAfterStop = stoppedTurns.filter(
        (turn) =>
          turn.role === 'user' &&
          turn.content.includes('Skip remaining loop steps?'),
      ).length;
      const postContinueCountAfterStop = stoppedTurns.filter(
        (turn) =>
          turn.role === 'user' &&
          turn.content.includes('Reached post-continue step.'),
      ).length;
      const breakCountAfterStop = stoppedTurns.filter(
        (turn) =>
          turn.role === 'user' && turn.content.includes('Exit outer loop?'),
      ).length;
      const stopSnapshot = JSON.parse(
        describeLoopContinueResumeState(conversationId),
      ) as Record<string, unknown>;

      assert.ok(continueCountAfterStop <= 1);
      assert.ok(postContinueCountAfterStop <= 1);
      assert.ok(breakCountAfterStop <= 1);

      runPhase = 'finish';

      await supertest(baseUrl)
        .post('/flows/loop-continue/run')
        .send({ conversationId, resumeStepPath: [0, 1] })
        .expect(202);

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'ok',
        timeoutMs: 10000,
        describe: () =>
          JSON.stringify({
            phase: 'waiting_for_ok_terminal_event',
            stopSnapshot,
            current: JSON.parse(describeLoopContinueResumeState(conversationId)),
          }),
      });

      assert.equal(final.status, 'ok');
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Outer loop step.'),
          ).length ===
            outerCountAfterStop + 1 &&
          items.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Skip remaining loop steps?'),
          ).length === 1 &&
          items.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Reached post-continue step.'),
          ).length === 1 &&
          items.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Exit outer loop?'),
          ).length === 1,
        15000,
        () =>
          JSON.stringify({
            phase: 'waiting_for_next_iteration_progress',
            stopSnapshot,
            afterStop: {
              outerCountAfterStop,
              continueCountAfterStop,
              postContinueCountAfterStop,
              breakCountAfterStop,
            },
            current: {
              snapshot: JSON.parse(
                describeLoopContinueResumeState(conversationId),
              ),
              outerCount: (memoryTurns.get(conversationId) ?? []).filter(
                (turn) =>
                  turn.role === 'user' &&
                  turn.content.includes('Outer loop step.'),
              ).length,
              continueCount: (memoryTurns.get(conversationId) ?? []).filter(
                (turn) =>
                  turn.role === 'user' &&
                  turn.content.includes('Skip remaining loop steps?'),
              ).length,
              postContinueCount: (memoryTurns.get(conversationId) ?? []).filter(
                (turn) =>
                  turn.role === 'user' &&
                  turn.content.includes('Reached post-continue step.'),
              ).length,
              breakCount: (memoryTurns.get(conversationId) ?? []).filter(
                (turn) =>
                  turn.role === 'user' &&
                  turn.content.includes('Exit outer loop?'),
              ).length,
            },
          }),
      );

      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' && turn.content.includes('Outer loop step.'),
        ).length,
        outerCountAfterStop + 1,
      );
      const continueCountAfterResume = turns.filter(
        (turn) =>
          turn.role === 'user' &&
          turn.content.includes('Skip remaining loop steps?'),
      ).length;
      const postContinueCountAfterResume = turns.filter(
        (turn) =>
          turn.role === 'user' &&
          turn.content.includes('Reached post-continue step.'),
      ).length;
      const breakCountAfterResume = turns.filter(
        (turn) =>
          turn.role === 'user' && turn.content.includes('Exit outer loop?'),
      ).length;

      assert.ok(continueCountAfterResume >= continueCountAfterStop);
      assert.ok(continueCountAfterResume <= continueCountAfterStop + 1);
      assert.equal(continueCountAfterResume, 1);
      assert.ok(postContinueCountAfterResume >= postContinueCountAfterStop);
      assert.ok(postContinueCountAfterResume <= postContinueCountAfterStop + 1);
      assert.equal(postContinueCountAfterResume, 1);
      assert.ok(breakCountAfterResume >= breakCountAfterStop);
      assert.ok(breakCountAfterResume <= breakCountAfterStop + 1);
      assert.equal(breakCountAfterResume, 1);

      const completedConversation = memoryConversations.get(conversationId);
      const completedFlags = (completedConversation?.flags ?? {}) as {
        flow?: {
          pendingLoopControl?: unknown;
        };
      };
      assert.equal(completedFlags.flow?.pendingLoopControl, undefined);
      await cleanupConversationRuntime(
        conversationId,
        ...getLoopContinueAgentConversationIds(conversationId),
      );
    },
    {
      chatFactory: () =>
        new ScriptedChat(
          (message) => {
            if (message.includes('Outer loop step.')) {
              return runPhase === 'stop' ? '__delay:1000::ok' : 'ok';
            }
            if (message.includes('Skip remaining loop steps?')) {
              return JSON.stringify({ answer: 'no' });
            }
            if (message.includes('Exit outer loop?')) {
              return JSON.stringify({ answer: 'yes' });
            }
            return 'ok';
          },
          {
            onExecute: ({ message, conversationId: activeConversationId }) => {
              if (
                runPhase === 'stop' &&
                message.includes('Outer loop step.') &&
                activeConversationId === outerConversationId &&
                !stopRegisteredAtOuterStepStart
              ) {
                const parentRunToken =
                  getActiveRunOwnership(conversationId)?.runToken;
                if (!parentRunToken) {
                  return;
                }
                stopRegisteredAtOuterStepStart = true;
                registerPendingConversationCancel({
                  conversationId,
                  runToken: parentRunToken,
                });
              }
            },
          },
        ),
    },
  );
});

test('continue step fails on invalid JSON response', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Skip remaining loop steps?')) {
        return 'not json';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-continue-invalid-json';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-continue/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'failed',
        timeoutMs: 4000,
        describe: () =>
          describeFlowRuntimeState(conversationId, ['coding_agent:outer-break']),
      });

      assert.equal(final.status, 'failed');
      assert.equal(final.errorCode, 'INVALID_CONTINUE_RESPONSE');
      assert.equal(
        final.errorMessage,
        'Continue response must be valid JSON with {"answer":"yes"|"no"}.',
      );
      await cleanupConversationRuntime(
        conversationId,
        ...getLoopContinueAgentConversationIds(conversationId),
      );
    },
  );
});

test('continue step recovers from wrapper output containing json fence', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Skip remaining loop steps?')) {
        return 'wrapper output\n```json\n{"answer":"no"}\n```';
      }
      if (message.includes('Exit outer loop?')) {
        return 'wrapper output\n```json\n{"answer":"yes"}\n```';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-continue-wrapper-json';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-continue/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'ok',
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'ok');
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Skip remaining loop steps?'),
          ).length === 1 &&
          items.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Reached post-continue step.'),
          ).length === 1 &&
          items.filter(
            (turn) =>
              turn.role === 'user' && turn.content.includes('Exit outer loop?'),
          ).length === 1,
        4000,
      );
      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('Skip remaining loop steps?'),
        ).length,
        1,
      );
      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('Reached post-continue step.'),
        ).length,
        1,
      );
      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' && turn.content.includes('Exit outer loop?'),
        ).length,
        1,
      );
      await cleanupConversationRuntime(
        conversationId,
        ...getLoopContinueAgentConversationIds(conversationId),
      );
    },
  );
});

test('continue step fails with INVALID_CONTINUE_RESPONSE when wrappers contain no valid answer', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Skip remaining loop steps?')) {
        return '```json\\n{\"answer\":\"maybe\"}\\n``` trailing text';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-continue-wrapper-invalid';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-continue/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'failed',
        timeoutMs: 4000,
        describe: () =>
          describeFlowRuntimeState(conversationId, [
            'coding_agent:outer',
            'coding_agent:inner',
            'coding_agent:inner-break',
            'coding_agent:outer-break',
          ]),
      });

      assert.equal(final.status, 'failed');
      assert.equal(final.errorCode, 'INVALID_CONTINUE_RESPONSE');
      assert.equal(
        final.errorMessage,
        'Continue response must include answer "yes" or "no".',
      );
      await cleanupConversationRuntime(
        conversationId,
        ...getLoopContinueAgentConversationIds(conversationId),
      );
    },
  );
});

test('continue step fails on invalid answer value', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Skip remaining loop steps?')) {
        return JSON.stringify({ answer: 'maybe' });
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-continue-invalid-answer';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-continue/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'failed',
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'failed');
      assert.equal(final.errorCode, 'INVALID_CONTINUE_RESPONSE');
      assert.equal(
        final.errorMessage,
        'Continue response must include answer "yes" or "no".',
      );
      await cleanupConversationRuntime(
        conversationId,
        ...getLoopContinueAgentConversationIds(conversationId),
      );
    },
  );
});

test('break step fails on invalid JSON response', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return JSON.stringify({ answer: 'yes' });
      }
      if (message.includes('Exit outer loop?')) {
        return 'not json';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-conv-invalid-json';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'failed',
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'failed');
      assert.equal(final.errorCode, 'INVALID_BREAK_RESPONSE');
      assert.equal(
        final.errorMessage,
        'Break response must be valid JSON with {"answer":"yes"|"no"}.',
      );
      await cleanupConversationRuntime(conversationId);
    },
  );
});

test('break step recovers from wrapper output containing json fence', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return 'wrapper output\n```json\n{"answer":"yes"}\n```';
      }
      if (message.includes('Exit outer loop?')) {
        return 'analysis first\n```json\n{"answer":"yes"}\n```';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-conv-wrapper-json';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'ok',
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'ok');
      await cleanupConversationRuntime(conversationId);
    },
  );
});

test('break step fails with INVALID_BREAK_RESPONSE when wrappers contain no valid answer', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return '{"answer":"yes"}';
      }
      if (message.includes('Exit outer loop?')) {
        return '```json\\n{\"answer\":\"maybe\"}\\n``` trailing text';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-conv-wrapper-invalid';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'failed',
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'failed');
      assert.equal(final.errorCode, 'INVALID_BREAK_RESPONSE');
      assert.equal(
        final.errorMessage,
        'Break response must include answer "yes" or "no".',
      );
      await cleanupConversationRuntime(conversationId);
    },
  );
});

test('break step fails on invalid answer value', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return JSON.stringify({ answer: 'yes' });
      }
      if (message.includes('Exit outer loop?')) {
        return JSON.stringify({ answer: 'maybe' });
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-conv-invalid-answer';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'failed',
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'failed');
      await cleanupConversationRuntime(conversationId);
    },
  );
});

test('flow step persists per-agent transcript', async () => {
  await withFlowServer(
    () => 'Flow agent response',
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-agent-single-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/llm-basic/run')
        .send({ conversationId })
        .expect(202);

      await waitForTurns(
        conversationId,
        (items) =>
          items.filter((turn) => turn.role === 'assistant').length === 1,
      );

      const agentConversationId = getAgentConversationId(
        conversationId,
        'coding_agent:basic',
      );
      const agentTurns = await waitForTurns(
        agentConversationId,
        (items) => items.length >= 2,
      );
      const userTurns = agentTurns.filter((turn) => turn.role === 'user');
      const assistantTurns = agentTurns.filter(
        (turn) => turn.role === 'assistant',
      );

      assert.equal(userTurns.length, 1);
      assert.equal(assistantTurns.length, 1);
      assert.ok(userTurns[0].content.includes('Say hello from a flow step.'));
      assert.equal(assistantTurns[0].content, 'Flow agent response');

      await cleanupConversationRuntime(conversationId, agentConversationId);
    },
  );
});

test('flow agent transcripts stay isolated by agent', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Alpha step.')) return 'Alpha response';
      if (message.includes('Beta step.')) return 'Beta response';
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-agent-multi-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/multi-agent/run')
        .send({ conversationId })
        .expect(202);

      await waitForTurns(
        conversationId,
        (items) =>
          items.filter((turn) => turn.role === 'assistant').length === 2,
        2000,
        () =>
          describeFlowRuntimeState(conversationId, [
            'coding_agent:alpha',
            'planning_agent:beta',
          ]),
      );

      const alphaConversationId = getAgentConversationId(
        conversationId,
        'coding_agent:alpha',
      );
      const betaConversationId = getAgentConversationId(
        conversationId,
        'planning_agent:beta',
      );
      const alphaTurns = await waitForTurns(
        alphaConversationId,
        (items) => items.length >= 2,
      );
      const betaTurns = await waitForTurns(
        betaConversationId,
        (items) => items.length >= 2,
      );

      const alphaContent = alphaTurns.map((turn) => turn.content).join(' ');
      const betaContent = betaTurns.map((turn) => turn.content).join(' ');

      assert.ok(alphaContent.includes('Alpha step.'));
      assert.ok(alphaContent.includes('Alpha response'));
      assert.ok(!alphaContent.includes('Beta step.'));
      assert.ok(!alphaContent.includes('Beta response'));

      assert.ok(betaContent.includes('Beta step.'));
      assert.ok(betaContent.includes('Beta response'));
      assert.ok(!betaContent.includes('Alpha step.'));
      assert.ok(!betaContent.includes('Alpha response'));

      await cleanupConversationRuntime(
        conversationId,
        alphaConversationId,
        betaConversationId,
      );
    },
  );
});

test('flow conversation remains merged with command metadata', async () => {
  await withFlowServer(
    (message) => `${message} response`,
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-agent-merged-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/multi-agent/run')
        .send({ conversationId })
        .expect(202);

      const flowTurns = await waitForTurns(
        conversationId,
        (items) => items.length >= 4,
      );

      assert.equal(flowTurns.length, 4);
      assert.ok(
        flowTurns.every((turn) =>
          turn.command && typeof turn.command === 'object'
            ? turn.command.name === 'flow'
            : false,
        ),
      );
      const stepIndexes = flowTurns
        .map((turn) => (turn.command as { stepIndex?: number })?.stepIndex)
        .filter((stepIndex): stepIndex is number => stepIndex !== undefined);
      assert.ok(stepIndexes.includes(1));
      assert.ok(stepIndexes.includes(2));

      await cleanupConversationRuntime(conversationId);
    },
  );
});

test('failed flow step persists to agent conversation', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return JSON.stringify({ answer: 'yes' });
      }
      if (message.includes('Exit outer loop?')) {
        return 'not json';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-agent-failed-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'failed',
        timeoutMs: 4000,
      });

      const agentConversationId = getAgentConversationId(
        conversationId,
        'coding_agent:outer-break',
      );
      const agentTurns = await waitForTurns(agentConversationId, (items) =>
        items.some((turn) => turn.role === 'assistant'),
      );
      const assistantTurns = agentTurns.filter(
        (turn) => turn.role === 'assistant',
      );
      const failedTurn = assistantTurns.find((turn) =>
        ['failed', 'stopped'].includes(turn.status),
      );

      assert.ok(
        failedTurn,
        'Expected failed assistant turn in agent transcript',
      );
      assert.ok(failedTurn?.content.length);

      await cleanupConversationRuntime(conversationId, agentConversationId);
    },
  );
});

test('flow step retries transient failures and eventually succeeds', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '3';
  let outerBreakAttempts = 0;
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) return '{"answer":"yes"}';
      if (message.includes('Exit outer loop?')) {
        outerBreakAttempts += 1;
        if (outerBreakAttempts < 2) return '{"answer":"maybe"}';
        return '{"answer":"yes"}';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-retry-success';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.role === 'user' && turn.content.includes('Exit outer loop?'),
          ) &&
          items.some(
            (turn) =>
              turn.role === 'assistant' &&
              turn.content.includes('{"answer":"yes"}'),
          ),
        5000,
        () =>
          JSON.stringify({
            outerBreakAttempts,
            state: JSON.parse(
              describeFlowRuntimeState(conversationId, ['coding_agent:outer-break']),
            ),
          }),
      );
      assert.equal(outerBreakAttempts, 2);
      await cleanupConversationRuntime(conversationId);
    },
  );
  if (previousRetries === undefined) {
    delete process.env.FLOW_AND_COMMAND_RETRIES;
  } else {
    process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
  }
});

test('flow step retries to exhaustion and emits one terminal failure', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '2';
  let outerBreakAttempts = 0;
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) return '{"answer":"yes"}';
      if (message.includes('Exit outer loop?')) {
        outerBreakAttempts += 1;
        return '{"answer":"maybe"}';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-retry-exhausted';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'failed',
        timeoutMs: 5000,
      });

      assert.equal(final.status, 'failed');
      assert.equal(outerBreakAttempts, 2);
      await expectNoTerminalFinal(wsUrl, conversationId);
      await cleanupConversationRuntime(conversationId);
    },
  );
  if (previousRetries === undefined) {
    delete process.env.FLOW_AND_COMMAND_RETRIES;
  } else {
    process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
  }
});

test(
  'scoped deterministic Codex overrides stay isolated across concurrent runtime resolution work',
  async () => {
    const configPath = path.join(
      repoRoot,
      'codeinfo_agents/coding_agent/config.toml',
    );

    const [successProviderId] = await Promise.all([
      withDeterministicCodexAvailabilityBootstrap(async () => {
        await delay(25);
        const result = await prepareFlowOwnedAgentExecution({
          agentName: 'coding_agent',
          configPath,
          source: 'REST',
          allowFallback: false,
        });
        return result.executionProviderId;
      }),
      withDeterministicCodexAvailabilityBootstrap(async () => {
        setCodexDetection({
          available: false,
          authPresent: false,
          configPresent: true,
          reason: 'Missing auth.json',
        });
        await delay(10);
        await assert.rejects(
          async () =>
            prepareFlowOwnedAgentExecution({
              agentName: 'coding_agent',
              configPath,
              source: 'REST',
              allowFallback: false,
            }),
          (error) =>
            (error as { code?: string; reason?: string }).code ===
              'PROVIDER_UNAVAILABLE' &&
            /Missing auth\.json/i.test(
              (error as { reason?: string }).reason ?? '',
            ),
        );
      }),
    ]);

    assert.equal(successProviderId, 'codex');
  },
);

test('aborted flow step is not retried', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '3';
  let outerBreakAttempts = 0;
  let stopRegisteredAtStepStart = false;
  const conversationId = 'flow-loop-retry-aborted';
  const cleanupEvents: Array<{
    label: string;
    conversationId: string;
    detail?: string;
    state: RuntimeCleanupSnapshot;
  }> = [];
  const ownershipReleaseCalls: OwnershipReleaseCall[] = [];
  const stopUnwindCheckpoints: StopUnwindCheckpoint[] = [];
  const recordCleanupEvent = (
    label: string,
    conversationId: string,
    detail?: string,
  ) => {
    cleanupEvents.push({
      label,
      conversationId,
      detail,
      state: snapshotRuntimeCleanupState(conversationId),
    });
    if (cleanupEvents.length > 20) {
      cleanupEvents.splice(0, cleanupEvents.length - 20);
    }
  };
  const recordStopUnwindCheckpoint = (params: {
    checkpoint: string;
    conversationId: string;
    detail?: string;
  }) => {
    stopUnwindCheckpoints.push({
      checkpoint: params.checkpoint,
      conversationId: params.conversationId,
      detail: params.detail,
      state: snapshotRuntimeCleanupState(params.conversationId),
    });
    if (stopUnwindCheckpoints.length > 20) {
      stopUnwindCheckpoints.splice(0, stopUnwindCheckpoints.length - 20);
    }
  };
  const describeAbortedRetryState = (conversationId: string) =>
    JSON.stringify({
      outerBreakAttempts,
      flowState: JSON.parse(describeFlowRuntimeState(conversationId)),
      recentTurns: (memoryTurns.get(conversationId) ?? []).slice(-8).map((turn) => ({
        role: turn.role,
        status: turn.status,
        content: turn.content,
      })),
      cleanupEvents,
      ownershipReleaseCalls,
      stopUnwindCheckpoints,
    });
  await withFlowServer(
    (message) => {
      if (message.includes('Say hello from a flow step.')) {
        outerBreakAttempts += 1;
        return '__delay:1000::Flow agent response';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      try {
        const response = await supertest(baseUrl)
          .post('/flows/llm-basic/run')
          .send({ conversationId })
          .expect(202);

        await waitFor(
          () => stopRegisteredAtStepStart,
          5000,
          () =>
            JSON.stringify({
              responseInflightId: response.body.inflightId as string,
              stopRegisteredAtStepStart,
              state: JSON.parse(describeAbortedRetryState(conversationId)),
            }),
        );

        const final = await waitForLoopTerminalOutcome({
          ws: wsUrl,
          conversationId,
          expectedStatus: ['stopped', 'failed'],
          timeoutMs: 5000,
        });

        assert.ok(final.status === 'stopped' || final.status === 'failed');
        assert.equal(outerBreakAttempts <= 1, true);
      } finally {
        await waitForRuntimeCleanup(
          conversationId,
          15000,
          () => describeAbortedRetryState(conversationId),
        );
        cleanupMemory(conversationId);
      }
    },
    {
      chatFactory: () =>
        new ScriptedChat(
          (message) => {
            if (message.includes('Say hello from a flow step.')) {
              outerBreakAttempts += 1;
              return '__delay:1000::Flow agent response';
            }
            return 'ok';
          },
          {
            onExecute: ({ message }) => {
              if (
                !stopRegisteredAtStepStart &&
                message.includes('Say hello from a flow step.')
              ) {
                const runToken =
                  getActiveRunOwnership(conversationId)?.runToken;
                if (!runToken) {
                  return;
                }
                stopRegisteredAtStepStart = true;
                registerPendingConversationCancel({
                  conversationId,
                  runToken,
                });
              }
            },
          },
        ),
      cleanupInflightFn: (params) => {
        recordCleanupEvent(
          'before cleanupInflightFn',
          params.conversationId,
          `inflightId=${params.inflightId ?? 'none'}`,
        );
        cleanupInflight(params);
        recordCleanupEvent(
          'after cleanupInflightFn',
          params.conversationId,
          `inflightId=${params.inflightId ?? 'none'}`,
        );
      },
      releaseConversationLockFn: (conversationId, expectedRunToken) => {
        const beforeState = snapshotRuntimeCleanupState(conversationId);
        const released = releaseConversationLock(conversationId, expectedRunToken);
        const afterState = snapshotRuntimeCleanupState(conversationId);
        ownershipReleaseCalls.push({
          expectedRunToken,
          released,
          beforeState,
          afterState,
        });
        if (ownershipReleaseCalls.length > 12) {
          ownershipReleaseCalls.splice(0, ownershipReleaseCalls.length - 12);
        }
        return released;
      },
      onStopUnwindCheckpoint: (params) => {
        recordStopUnwindCheckpoint(params);
      },
    },
  );
  if (previousRetries === undefined) {
    delete process.env.FLOW_AND_COMMAND_RETRIES;
  } else {
    process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
  }
});

test('startup-race conversation-only stop still terminalizes a flow as stopped', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Say hello from a flow step.')) {
        return '__delay:1000::Flow agent response';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-startup-stop-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      try {
        await supertest(baseUrl)
          .post('/flows/llm-basic/run')
          .send({ conversationId })
          .expect(202);

        sendJson(wsUrl, { type: 'cancel_inflight', conversationId });

        const final = await waitForLoopTerminalOutcome({
          ws: wsUrl,
          conversationId,
          expectedStatus: 'stopped',
          timeoutMs: 5000,
        });

        assert.equal(final.status, 'stopped');
      } finally {
        await cleanupConversationRuntime(conversationId);
      }
    },
  );
});

test('duplicate flow stop requests emit one terminal stopped event', async () => {
  const events: Array<{ type?: string; conversationId?: string }> = [];

  await withFlowServer(
    (message) => {
      if (message.includes('Say hello from a flow step.')) {
        return '__delay:1000::Flow agent response';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-duplicate-stop-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      wsUrl.on('message', (raw) => {
        const parsed = JSON.parse(String(raw)) as {
          type?: string;
          conversationId?: string;
        };
        events.push(parsed);
      });

      try {
        await supertest(baseUrl)
          .post('/flows/llm-basic/run')
          .send({ conversationId })
          .expect(202);

        sendJson(wsUrl, { type: 'cancel_inflight', conversationId });
        sendJson(wsUrl, { type: 'cancel_inflight', conversationId });

        await waitForLoopTerminalOutcome({
          ws: wsUrl,
          conversationId,
          expectedStatus: 'stopped',
          timeoutMs: 5000,
        });

        await waitForRuntimeCleanup(conversationId);

        const finals = events.filter(
          (event) =>
            event.type === 'turn_final' &&
            event.conversationId === conversationId,
        );
        assert.equal(finals.length, 1);
      } finally {
        await cleanupConversationRuntime(conversationId);
      }
    },
  );
});

test('flow stop cleanup fallback still releases runtime state', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Say hello from a flow step.')) {
        return '__delay:1000::Flow agent response';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-cleanup-fallback-conv';
      let secondConversationId: string | undefined;
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      try {
        const firstRun = await supertest(baseUrl)
          .post('/flows/llm-basic/run')
          .send({ conversationId })
          .expect(202);
        assert.equal(firstRun.body.conversationId, conversationId);

        sendJson(wsUrl, { type: 'cancel_inflight', conversationId });

        await waitForLoopTerminalOutcome({
          ws: wsUrl,
          conversationId,
          expectedStatus: 'stopped',
          timeoutMs: 5000,
        });

        await waitForRuntimeCleanup(conversationId);

        const secondRun = await supertest(baseUrl)
          .post('/flows/llm-basic/run')
          .send({ conversationId })
          .expect(202);
        secondConversationId = secondRun.body.conversationId as string;
        assert.notEqual(secondConversationId, conversationId);
        sendJson(wsUrl, {
          type: 'subscribe_conversation',
          conversationId: secondConversationId,
        });

        await waitForLoopTerminalOutcome({
          ws: wsUrl,
          conversationId: secondConversationId,
          expectedStatus: 'ok',
          timeoutMs: 5000,
        });
      } finally {
        await cleanupConversationRuntime(
          conversationId,
          ...(secondConversationId ? [secondConversationId] : []),
        );
      }
    },
    {
      cleanupInflightFn: ({ conversationId: cleanupConversationId }) => {
        if (cleanupConversationId === 'flow-cleanup-fallback-conv') {
          throw new Error('forced cleanup failure');
        }
      },
    },
  );
});

test('flow stop during a looped flow prevents later iterations from continuing', async () => {
  const cleanupEventLimit = 20;
  let cleanupEventCount = 0;
  const ownershipReleaseCalls: OwnershipReleaseCall[] = [];
  let ownershipReacquiredAfterRelease = false;
  let ownershipReacquiredState: RuntimeCleanupSnapshot | null = null;
  const stopUnwindCheckpointLimit = 20;
  const stopUnwindCheckpoints: StopUnwindCheckpoint[] = [];
  const cleanupPhaseCheckpointLimit = 12;
  const cleanupPhaseCheckpoints: CleanupPhaseCheckpoint[] = [];
  let stopWs: WebSocket | null = null;
  let stopRequestedAtBoundary = false;
  const cleanupEvents: Array<
    {
      label: string;
      state: RuntimeCleanupSnapshot;
    } & Partial<{
      conversationId: string;
      inflightId: string;
      expectedRunToken: string;
      released: boolean;
    }>
  > = [];
  const recordCleanupEvent = (
    label: string,
    conversationId: string,
    extra?: Partial<{
      inflightId: string;
      expectedRunToken: string;
      released: boolean;
    }>,
  ) => {
    const state = snapshotRuntimeCleanupState(conversationId);
    cleanupEventCount += 1;
    if (
      !ownershipReacquiredAfterRelease &&
      ownershipReleaseCalls.some(
        (call) => call.released && call.afterState.ownershipRunToken === null,
      ) &&
      state.ownershipRunToken !== null
    ) {
      ownershipReacquiredAfterRelease = true;
      ownershipReacquiredState = state;
    }
    cleanupEvents.push({
      label,
      conversationId,
      state,
      ...extra,
    });
    if (cleanupEvents.length > cleanupEventLimit) {
      cleanupEvents.shift();
    }
  };
  const buildOwnershipReleaseSummary = () => ({
    branch:
      ownershipReleaseCalls.length === 0
        ? 'never_reached'
        : ownershipReleaseCalls.some((call) => !call.released)
          ? 'returned_false'
          : ownershipReacquiredAfterRelease
            ? 'reacquired_after_release'
            : 'released_without_reacquire_observed',
    releaseCallCount: ownershipReleaseCalls.length,
    releaseFalseCount: ownershipReleaseCalls.filter((call) => !call.released)
      .length,
    releaseTrueCount: ownershipReleaseCalls.filter((call) => call.released)
      .length,
    ownershipReacquiredAfterRelease,
    ownershipReacquiredState,
    recentReleaseCalls: ownershipReleaseCalls.slice(-5),
  });
  const recordStopUnwindCheckpoint = (params: {
    checkpoint: string;
    conversationId: string;
    detail?: string;
  }) => {
    stopUnwindCheckpoints.push({
      ...params,
      state: snapshotRuntimeCleanupState(params.conversationId),
    });
    if (stopUnwindCheckpoints.length > stopUnwindCheckpointLimit) {
      stopUnwindCheckpoints.shift();
    }
  };
  const waitForStopUnwindCheckpoint = async (
    checkpoint: string,
    conversationId: string,
    timeoutMs = 5000,
  ) => {
    await waitForPredicate(
      () =>
        stopUnwindCheckpoints.some(
          (item) =>
            item.checkpoint === checkpoint &&
            item.conversationId === conversationId,
        ),
      timeoutMs,
      `Timed out waiting for stop-unwind checkpoint ${checkpoint}`,
    );
  };
  const waitForStopUnwindCheckpointMatching = async (
    predicate: (item: StopUnwindCheckpoint) => boolean,
    description: string,
    timeoutMs = 5000,
  ) => {
    await waitForPredicate(
      () => stopUnwindCheckpoints.some((item) => predicate(item)),
      timeoutMs,
      `Timed out waiting for stop-unwind checkpoint ${description}`,
    );
  };
  const recordCleanupPhaseCheckpoint = (
    label: string,
    conversationId: string,
  ) => {
    cleanupPhaseCheckpoints.push({
      label,
      conversationId,
      state: snapshotRuntimeCleanupState(conversationId),
    });
    if (cleanupPhaseCheckpoints.length > cleanupPhaseCheckpointLimit) {
      cleanupPhaseCheckpoints.shift();
    }
  };
  const buildCleanupPhaseSummary = () => {
    const labels = new Set(cleanupPhaseCheckpoints.map((item) => item.label));
    const branch = labels.has('before cleanupConversationRuntime')
      ? labels.has('after cleanupConversationRuntime')
        ? 'post_test_teardown_or_resource_cleanup'
        : 'stop_runtime_cleanup_divergence'
      : labels.has('after stop request sent') ||
          labels.has('after first outer break observed') ||
          labels.has('after stopped final observed')
        ? 'setup_not_owner'
        : 'setup_contamination_or_earlier';
    return {
      branch,
      totalCheckpoints: cleanupPhaseCheckpoints.length,
      recentCheckpoints: cleanupPhaseCheckpoints,
    };
  };

  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return '{"answer":"yes"}';
      }
      if (message.includes('Exit outer loop?')) {
        return '__delay:1000::{"answer":"no"}';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-stop-boundary-conv';
      stopWs = wsUrl;
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      try {
        await supertest(baseUrl)
          .post('/flows/loop-break/run')
          .send({ conversationId })
          .expect(202);

        await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes('Exit outer loop?'),
            ),
          4000,
        );
        recordCleanupPhaseCheckpoint(
          'after first outer break observed',
          conversationId,
        );
        await waitForStopUnwindCheckpoint(
          'runStartLoopStep.before_next_iteration',
          conversationId,
        );
        recordCleanupPhaseCheckpoint(
          'after between-iteration gap observed',
          conversationId,
        );

        recordCleanupPhaseCheckpoint(
          'after stop request reached loop boundary',
          conversationId,
        );

        await waitForStopUnwindCheckpointMatching(
          (item) =>
            item.conversationId === conversationId &&
            (item.checkpoint.startsWith(
              'runStartLoopStep.return.stop.pending_cancel',
            ) ||
              item.checkpoint === 'runSteps.return.stop.llm'),
          'loop stop boundary after cancel request',
        );

        await waitForStopUnwindCheckpoint(
          'runFlowUnlocked.finalize.exit',
          conversationId,
        );
        recordCleanupPhaseCheckpoint(
          'after stop unwind finalized',
          conversationId,
        );
        recordCleanupEvent('after stop unwind finalized', conversationId);
        const turns = memoryTurns.get(conversationId) ?? [];
        const outerBreakTurns = turns.filter(
          (turn) =>
            turn.role === 'user' && turn.content.includes('Exit outer loop?'),
        );
        assert.equal(outerBreakTurns.length, 1);
      } finally {
        recordCleanupPhaseCheckpoint(
          'before cleanupConversationRuntime',
          conversationId,
        );
        recordCleanupEvent('before cleanupConversationRuntime', conversationId);
        try {
          try {
            await waitForRuntimeCleanup(conversationId, 15000);
          } finally {
            cleanupMemory(conversationId);
          }
          recordCleanupPhaseCheckpoint(
            'after cleanupConversationRuntime',
            conversationId,
          );
        } catch (error) {
          const ownershipReleaseSummary = buildOwnershipReleaseSummary();
          const cleanupPhaseSummary = buildCleanupPhaseSummary();
          console.error(
            'FLOW_LOOP_CLEANUP_EVENTS',
            JSON.stringify({
              totalEvents: cleanupEventCount,
              recentEvents: cleanupEvents,
            }),
          );
          console.error(
            'FLOW_LOOP_OWNERSHIP_RELEASE',
            JSON.stringify(ownershipReleaseSummary),
          );
          console.error(
            'FLOW_LOOP_STOP_UNWIND',
            JSON.stringify({
              totalCheckpoints: stopUnwindCheckpoints.length,
              recentCheckpoints: stopUnwindCheckpoints,
            }),
          );
          console.error(
            'FLOW_LOOP_CLEANUP_PHASE',
            JSON.stringify(cleanupPhaseSummary),
          );
          if (error instanceof Error) {
            error.message += ` cleanupEvents=${JSON.stringify({ totalEvents: cleanupEventCount, recentEvents: cleanupEvents })} ownershipRelease=${JSON.stringify(ownershipReleaseSummary)} stopUnwind=${JSON.stringify({ totalCheckpoints: stopUnwindCheckpoints.length, recentCheckpoints: stopUnwindCheckpoints })} cleanupPhase=${JSON.stringify(cleanupPhaseSummary)}`;
          }
          throw error;
        }
      }
    },
    {
      cleanupInflightFn: (params) => {
        recordCleanupEvent('before cleanupInflightFn', params.conversationId, {
          inflightId: params.inflightId,
        });
        cleanupInflight(params);
        recordCleanupEvent('after cleanupInflightFn', params.conversationId, {
          inflightId: params.inflightId,
        });
      },
      releaseConversationLockFn: (conversationId, expectedRunToken) => {
        const beforeState = snapshotRuntimeCleanupState(conversationId);
        recordCleanupEvent('before releaseConversationLockFn', conversationId, {
          expectedRunToken,
        });
        const released = releaseConversationLock(
          conversationId,
          expectedRunToken,
        );
        const afterState = snapshotRuntimeCleanupState(conversationId);
        ownershipReleaseCalls.push({
          expectedRunToken,
          released,
          beforeState,
          afterState,
        });
        recordCleanupEvent('after releaseConversationLockFn', conversationId, {
          expectedRunToken,
          released,
        });
        return released;
      },
      onStopUnwindCheckpoint: async (params) => {
        recordStopUnwindCheckpoint(params);
        if (
          params.conversationId === 'flow-loop-stop-boundary-conv' &&
          params.checkpoint === 'runStartLoopStep.before_next_iteration' &&
          !stopRequestedAtBoundary
        ) {
          assert.ok(
            stopWs,
            'Expected loop-stop websocket before stop boundary',
          );
          stopRequestedAtBoundary = true;
          sendJson(stopWs, {
            type: 'cancel_inflight',
            conversationId: params.conversationId,
          });
          recordCleanupPhaseCheckpoint(
            'after stop request sent',
            params.conversationId,
          );
          await waitForPredicate(
            () => Boolean(getPendingConversationCancel(params.conversationId)),
            1000,
            'Timed out waiting for pending cancel at loop boundary',
          );
        }
      },
    },
  );
});

test('parallel subflow batch stop reports mixed child outcomes instead of a clean stopped parent status', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('slow child')) {
        return '__delay:1000::ok';
      }
      return 'ok';
    },
    async ({ tmpDir, wsUrl, baseUrl }) => {
      const writeFlow = async (flowName: string, steps: unknown[]) => {
        await fs.writeFile(
          path.join(tmpDir, `${flowName}.json`),
          JSON.stringify(
            {
              description: flowName,
              steps,
            },
            null,
            2,
          ),
          'utf8',
        );
      };
      const childStep = (content: string) => ({
        type: 'llm' as const,
        label: 'Child Step',
        agentType: 'planning_agent',
        identifier: 'main',
        messages: [{ role: 'user' as const, content: [content] }],
      });

      await writeFlow('child-fast-ok', [childStep('child ok')]);
      await writeFlow('child-slow-ok', [childStep('slow child')]);
      await writeFlow('parent-mixed-subflow-stop', [
        {
          type: 'subflow',
          label: 'Run Slow Batch',
          flowNames: ['child-fast-ok', 'child-slow-ok'],
        },
      ]);

      const conversationId = 'flow-subflow-mixed-stop-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/parent-mixed-subflow-stop/run')
        .send({ conversationId, customTitle: 'Parent Review' })
        .expect(202);

      await waitForPredicate(() => {
        const activeSubflows = (
          (memoryConversations.get(conversationId)?.flags ?? {}) as {
            flow?: {
              activeSubflows?: Array<{
                flowName?: string;
                conversationId?: string;
              }>;
            };
          }
        ).flow?.activeSubflows;
        return Array.isArray(activeSubflows) && activeSubflows.length === 2;
      }, 4000, 'Timed out waiting for active parallel subflows');

      const activeSubflows = (
        (memoryConversations.get(conversationId)?.flags ?? {}) as {
          flow?: {
            activeSubflows?: Array<{
              flowName?: string;
              conversationId?: string;
            }>;
          };
        }
      ).flow?.activeSubflows;
      assert.ok(Array.isArray(activeSubflows));
      const fastChildConversationId = String(
        activeSubflows.find((child) => child.flowName === 'child-fast-ok')
          ?.conversationId ?? '',
      );
      const slowChildConversationId = String(
        activeSubflows.find((child) => child.flowName === 'child-slow-ok')
          ?.conversationId ?? '',
      );
      assert.ok(fastChildConversationId);
      assert.ok(slowChildConversationId);

      await waitForTurns(
        fastChildConversationId,
        (items) =>
          items.some(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ),
        4000,
      );

      sendJson(wsUrl, { type: 'cancel_inflight', conversationId });

      const final = await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: ['warning', 'failed'],
        timeoutMs: 4000,
      });
      assert.equal(final.status, 'warning');

      await waitForTurns(
        slowChildConversationId,
        (items) =>
          items.some(
            (turn) => turn.role === 'assistant' && turn.status === 'stopped',
          ),
        4000,
      );
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) => turn.role === 'assistant' && turn.status === 'warning',
          ),
        4000,
      );
      const finalAssistant = [...turns]
        .reverse()
        .find((turn) => turn.role === 'assistant');
      assert.equal(finalAssistant?.status, 'warning');
      assert.equal(
        finalAssistant?.content,
        'Subflow batch stop had mixed child outcomes (stopped: Parent Review-Run Slow Batch-child-slow-ok; completed: Parent Review-Run Slow Batch-child-fast-ok)',
      );

      await cleanupConversationRuntime(
        conversationId,
        fastChildConversationId,
        slowChildConversationId,
      );
    },
  );
});

test('shared decision seam follows valid script-driven if branch through happy path', async () => {
  await withFlowServer(
    () => 'ok',
    async ({ tmpDir, wsUrl, baseUrl }) => {
      await fs.writeFile(
        path.join(tmpDir, 'shared-decision-if-flow.json'),
        JSON.stringify({
          description: 'Flow with if-step using script decision',
          steps: [
            {
              type: 'if',
              condition: 'flow-control/decision-yes.py',
              then: [
                {
                  type: 'llm',
                  agentType: 'planning_agent',
                  identifier: 'main',
                  messages: [
                    {
                      role: 'user',
                      content: [
                        'Decision was yes, proceeding with then branch.',
                      ],
                    },
                  ],
                },
              ],
              else: [
                {
                  type: 'llm',
                  agentType: 'planning_agent',
                  identifier: 'main',
                  messages: [
                    {
                      role: 'user',
                      content: ['Else branch should not run.'],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        'utf8',
      );

      const result = await supertest(baseUrl)
        .post('/flows/shared-decision-if-flow/run')
        .send({
          source: 'REST',
          working_folder: tmpDir,
        });
      assert.equal(result.status, 202);

      const conversationId = result.body.conversationId;
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'ok',
        timeoutMs: 4000,
      });

      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes(
                'Decision was yes, proceeding with then branch.',
              ),
          ),
        4000,
      );
      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes(
              'Decision was yes, proceeding with then branch.',
            ),
        ).length,
        1,
      );
      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('Else branch should not run.'),
        ).length,
        0,
      );
      await cleanupConversationRuntime(
        conversationId,
        ...getAgentConversationIds(conversationId, ['planning_agent:main']),
        ...getLoopContinueAgentConversationIds(conversationId),
      );
    },
    { registerTmpDirAsRepo: true },
  );
});

test('shared decision seam follows valid script-driven break branch through happy path', async () => {
  await withFlowServer(
    () => 'ok',
    async ({ tmpDir, wsUrl, baseUrl }) => {
      await fs.writeFile(
        path.join(tmpDir, 'shared-decision-break-flow.json'),
        JSON.stringify({
          description: 'Flow with break-step using script decision',
          steps: [
            {
              type: 'startLoop',
              steps: [
                {
                  type: 'break',
                  agentType: 'planning_agent',
                  identifier: 'main',
                  question: 'flow-control/decision-yes.py',
                  breakOn: 'yes',
                },
                {
                  type: 'llm',
                  agentType: 'planning_agent',
                  identifier: 'main',
                  messages: [
                    {
                      role: 'user',
                      content: ['Loop body should stop before this step.'],
                    },
                  ],
                },
              ],
            },
            {
              type: 'llm',
              agentType: 'planning_agent',
              identifier: 'main',
              messages: [
                {
                  role: 'user',
                  content: ['Break exited the loop cleanly.'],
                },
              ],
            },
          ],
        }),
        'utf8',
      );

      const result = await supertest(baseUrl)
        .post('/flows/shared-decision-break-flow/run')
        .send({
          source: 'REST',
          working_folder: tmpDir,
        });
      assert.equal(result.status, 202);

      const conversationId = result.body.conversationId;
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'ok',
        timeoutMs: 4000,
      });

      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Break exited the loop cleanly.'),
          ),
        4000,
      );
      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('Loop body should stop before this step.'),
        ).length,
        0,
      );
      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('Break exited the loop cleanly.'),
        ).length,
        1,
      );
      await cleanupConversationRuntime(
        conversationId,
        ...getAgentConversationIds(conversationId, ['planning_agent:main']),
        ...getLoopContinueAgentConversationIds(conversationId),
      );
    },
    { registerTmpDirAsRepo: true },
  );
});

test('shared decision seam follows valid script-driven continue branch through happy path', async () => {
  await withFlowServer(
    () => 'ok',
    async ({ tmpDir, wsUrl, baseUrl }) => {
      await fs.writeFile(
        path.join(tmpDir, 'flow-control', 'decision-continue-once.py'),
        [
          '#!/usr/bin/env python3',
          'import json',
          'from pathlib import Path',
          '',
          "state_file = Path('.continue-once-state')",
          'count = int(state_file.read_text()) if state_file.exists() else 0',
          'count += 1',
          'state_file.write_text(str(count))',
          "answer = 'yes' if count == 1 else 'no'",
          'print(json.dumps({"answer": answer}))',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        path.join(tmpDir, 'shared-decision-continue-flow.json'),
        JSON.stringify({
          description: 'Flow with continue-step using script decision',
          steps: [
            {
              type: 'startLoop',
              steps: [
                {
                  type: 'continue',
                  agentType: 'planning_agent',
                  identifier: 'main',
                  question: 'flow-control/decision-continue-once.py',
                  continueOn: 'yes',
                },
                {
                  type: 'llm',
                  agentType: 'planning_agent',
                  identifier: 'main',
                  messages: [
                    {
                      role: 'user',
                      content: ['Reached post-continue step.'],
                    },
                  ],
                },
                {
                  type: 'break',
                  agentType: 'planning_agent',
                  identifier: 'main',
                  question: 'flow-control/decision-yes.py',
                  breakOn: 'yes',
                },
              ],
            },
          ],
        }),
        'utf8',
      );

      const result = await supertest(baseUrl)
        .post('/flows/shared-decision-continue-flow/run')
        .send({
          source: 'REST',
          working_folder: tmpDir,
        });
      assert.equal(result.status, 202);

      const conversationId = result.body.conversationId;
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await waitForLoopTerminalOutcome({
        ws: wsUrl,
        conversationId,
        expectedStatus: 'ok',
        timeoutMs: 4000,
      });

      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.filter(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('Reached post-continue step.'),
          ).length === 1,
        4000,
      );
      assert.equal(
        turns.filter(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('Reached post-continue step.'),
        ).length,
        1,
      );
      await cleanupConversationRuntime(
        conversationId,
        ...getAgentConversationIds(conversationId, ['planning_agent:main']),
        ...getLoopContinueAgentConversationIds(conversationId),
      );
    },
    { registerTmpDirAsRepo: true },
  );
});
