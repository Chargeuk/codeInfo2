import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';
import pkg from '../../../package.json' with { type: 'json' };

import {
  getActiveRunOwnership,
  tryAcquireConversationLock,
  releaseConversationLock,
} from '../../agents/runLock.js';
import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
} from '../../agents/service.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { DEV_0000037_T01_REQUIRED_VERSION } from '../../config/codexSdkUpgrade.js';
import {
  __resetGitHubReviewDepsForTests,
  __setGitHubReviewDepsForTests,
} from '../../flows/githubReview.js';
import {
  __resetMarkdownFileResolverDepsForTests,
  __setMarkdownFileResolverDepsForTests,
} from '../../flows/markdownFileResolver.js';
import {
  __getPersistedFreshRunRetryOwnershipCompletionForTests,
  __resetFreshRunRetryOwnershipCompletionForTests,
  startFlowRun,
} from '../../flows/service.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { query } from '../../logStore.js';
import type { Conversation } from '../../mongo/conversation.js';
import { ConversationModel } from '../../mongo/conversation.js';
import type { Turn } from '../../mongo/turn.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { attachWs } from '../../ws/server.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
  withDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import { withMockedMongoConversationPersistence } from '../support/conversationMongoPersistenceStub.js';
import { createIsolatedProviderHomeEnv } from '../support/providerHomeHarness.js';
import {
  enterTestEnvOverrides,
  runWithTestEnvOverrides,
} from '../support/testEnvOverrideScope.js';
import { bindCurrentTestOverrides } from '../support/testOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows',
);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const buildRepoEntry = (containerPath: string): RepoEntry => ({
  id: path.posix.basename(containerPath.replace(/\\/g, '/')) || 'repo',
  description: null,
  containerPath,
  hostPath: containerPath,
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
});

class StreamingChat extends ChatInterface {
  async execute(
    _message: string,
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
    this.emit('analysis', { type: 'analysis', content: 'thinking...' });
    await delay(30);
    if (abortIfNeeded()) return;
    this.emit('token', { type: 'token', content: 'Hel' });
    await delay(30);
    if (abortIfNeeded()) return;
    this.emit('token', { type: 'token', content: 'lo' });
    await delay(30);
    if (abortIfNeeded()) return;
    this.emit('final', { type: 'final', content: 'Hello flow' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class InstantChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _message;
    void _flags;
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class DelayedInstantChat extends ChatInterface {
  constructor(private readonly delayMs: number) {
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
    this.emit('thread', { type: 'thread', threadId: conversationId });
    await delay(this.delayMs);
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class CapturingChat extends ChatInterface {
  constructor(
    private readonly messages: string[],
    private readonly finalContent = 'ok',
  ) {
    super();
  }

  async execute(
    message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _flags;
    void _model;
    this.messages.push(message);
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: this.finalContent });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
): Promise<void> => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const started = Date.now();
  while (Date.now() - started < resolvedTimeoutMs) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error('Timed out waiting for flow condition');
};

const describeRelevantFlowRuntimeLogs = (conversationId: string): string =>
  JSON.stringify(
    {
      runtimeLogs: query({ text: 'flows.test.' }, 300)
        .filter((entry) => entry.context?.conversationId === conversationId)
        .slice(-25)
        .map((entry) => ({
          message: entry.message,
          context: entry.context,
        })),
      runtimeResolutionLogs: query(
        { text: 'flows.test.runtime_resolution_' },
        120,
      )
        .filter((entry) => entry.context?.conversationId === conversationId)
        .slice(-25)
        .map((entry) => ({
          message: entry.message,
          context: entry.context,
        })),
      runtimeConfigLogs: query({ text: 'runtime.' }, 120)
        .filter(
          (entry) =>
            entry.message.startsWith('runtime.chat_config_') ||
            entry.message.startsWith('runtime.runtime_config_resolution_'),
        )
        .slice(-25)
        .map((entry) => ({
          message: entry.message,
          context: entry.context,
        })),
    },
  );

const summarizeFlowChildAgentConversations = (conversationId: string): string => {
  const conversation = memoryConversations.get(conversationId);
  const flowFlags = (conversation?.flags ?? {}) as {
    flow?: { agentConversations?: Record<string, string> };
  };
  return JSON.stringify(
    Object.entries(flowFlags.flow?.agentConversations ?? {}).map(
      ([agentKey, childConversationId]) => ({
        agentKey,
        childConversationId,
        childFlags: memoryConversations.get(childConversationId)?.flags ?? null,
        recentTurns: (memoryTurns.get(childConversationId) ?? [])
          .slice(-6)
          .map((turn) => ({
            role: turn.role,
            status: turn.status,
            content: turn.content,
          })),
      }),
    ),
  );
};

const waitForTurns = async (
  conversationId: string,
  predicate: (turns: Turn[]) => boolean,
  timeoutMs = 4000,
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
      `childAgentConversations=${summarizeFlowChildAgentConversations(
        conversationId,
      )}`,
      `runtimeLogs=${describeRelevantFlowRuntimeLogs(conversationId)}`,
      describe ? `details=${describe()}` : '',
    ].join(' | '),
  );
};

const withScopedAgentRuntime = async (
  envOverrides: Record<string, string | undefined>,
  agentServiceOverrides: Parameters<typeof __setAgentServiceDepsForTests>[0],
  run: () => Promise<void>,
) =>
  await runWithTestEnvOverrides(envOverrides, async () => {
    __setAgentServiceDepsForTests(agentServiceOverrides);
    try {
      await run();
    } finally {
      __resetAgentServiceDepsForTests();
    }
  });

const waitForTurnCountToStay = async (
  conversationId: string,
  expectedCount: number,
  quietWindowMs = 150,
  timeoutMs = 4000,
) => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const started = Date.now();
  while (Date.now() - started < resolvedTimeoutMs) {
    const initialCount = (memoryTurns.get(conversationId) ?? []).length;
    if (initialCount === expectedCount) {
      await delay(quietWindowMs);
      const finalCount = (memoryTurns.get(conversationId) ?? []).length;
      if (finalCount === expectedCount) {
        return;
      }
    }
    await delay(20);
  }
  throw new Error('Timed out waiting for flow turn count to stay stable');
};

const waitForConversationUnlocked = async (
  conversationId: string,
  timeoutMs = 4000,
) => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const started = Date.now();
  while (Date.now() - started < resolvedTimeoutMs) {
    const acquired = tryAcquireConversationLock(conversationId);
    if (acquired) {
      releaseConversationLock(conversationId);
      return;
    }
    await delay(20);
  }
  throw new Error(
    [
      `Timed out waiting for flow unlock for ${conversationId}`,
      `conversationFlags=${JSON.stringify(
        memoryConversations.get(conversationId)?.flags ?? null,
      )}`,
    ].join(' | '),
  );
};

const cleanupMemory = (...conversationIds: Array<string | undefined>) => {
  conversationIds.forEach((conversationId) => {
    if (!conversationId) return;
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
};

let providerHomes: Awaited<
  ReturnType<typeof createIsolatedProviderHomeEnv>
> | null = null;

beforeEach(async () => {
  providerHomes = await createIsolatedProviderHomeEnv(
    'flow-basic-provider-homes-',
  );
  installDeterministicCodexAvailabilityBootstrap();
  enterTestEnvOverrides({
    CODEINFO_AGENT_HOME: undefined,
    ...providerHomes.envOverrides,
  });
});

afterEach(async () => {
  resetDeterministicCodexAvailabilityBootstrap();
  __resetFreshRunRetryOwnershipCompletionForTests();
  __resetGitHubReviewDepsForTests();
  await providerHomes?.cleanup();
  providerHomes = null;
});

const writeAgentScaffold = async (params: {
  agentsHome: string;
  agentName: string;
  codexHome: string;
}) => {
  const agentHome = path.join(params.agentsHome, params.agentName);
  await fs.mkdir(params.codexHome, { recursive: true });
  await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-model-1"', 'approval_policy = "never"'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(params.codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(params.codexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(params.codexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(params.codexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );
};

const writeFlowFile = async (params: {
  flowsRoot: string;
  flowName: string;
  steps: unknown[];
}) => {
  await fs.mkdir(params.flowsRoot, { recursive: true });
  await fs.writeFile(
    path.join(params.flowsRoot, `${params.flowName}.json`),
    JSON.stringify(
      {
        description: 'markdown flow',
        steps: params.steps,
      },
      null,
      2,
    ),
    'utf8',
  );
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

const createGitHubReviewRepoFixture = async (params?: {
  repoRoot?: string;
  flowTaskNumber?: number;
}) => {
  const repoRoot =
    params?.repoRoot ??
    (await fs.mkdtemp(path.join(os.tmpdir(), 'github-flow-repo-')));
  const taskNumber = params?.flowTaskNumber ?? 4;
  await fs.mkdir(path.join(repoRoot, 'codeInfoStatus/flow-state'), {
    recursive: true,
  });
  await fs.mkdir(path.join(repoRoot, 'planning'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'scripts/flow_control'), {
    recursive: true,
  });
  const planPath =
    'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md';
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
          title: `Task ${taskNumber}`,
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
      `### Task ${taskNumber}. Fixture task`,
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
    path.join(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../../scripts/flow_control/check_github_review_has_reviewer_feedback.py',
      ),
    ),
    path.join(
      repoRoot,
      'scripts/flow_control/check_github_review_has_reviewer_feedback.py',
    ),
  );
  return repoRoot;
};

const getAgentConversationId = (conversationId: string) => {
  const conversation = memoryConversations.get(conversationId);
  const flags = (conversation?.flags ?? {}) as {
    flow?: { agentConversations?: Record<string, string> };
  };
  const agentConversationId =
    flags.flow?.agentConversations?.['coding_agent:basic'];
  assert.ok(agentConversationId, 'Missing coding_agent:basic conversation');
  return agentConversationId;
};

const collectAgentConversationIds = (conversationId: string) => {
  const conversation = memoryConversations.get(conversationId);
  const flags = (conversation?.flags ?? {}) as {
    flow?: { agentConversations?: Record<string, string> };
  };
  return Object.values(flags.flow?.agentConversations ?? {});
};

const describeConversationRuntime = (conversationId: string): string => {
  const conversation = memoryConversations.get(conversationId);
  const flags = (conversation?.flags ?? {}) as {
    flow?: { agentConversations?: Record<string, string> };
  };
  const agentConversationEntries = Object.entries(
    flags.flow?.agentConversations ?? {},
  ).map(([agentKey, agentConversationId]) => ({
    agentKey,
    agentConversationId,
    recentTurns: (memoryTurns.get(agentConversationId) ?? [])
      .slice(-6)
      .map((turn) => ({
        role: turn.role,
        status: turn.status,
        content: turn.content,
      })),
  }));
  const seen = new Set<string>();
  const runtimeLogs = query({ text: 'flows.test.' }, 400)
    .filter((entry) => entry.context?.conversationId === conversationId)
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
    .filter((entry) => entry.context?.conversationId === conversationId)
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
  return JSON.stringify({
    ownershipRunToken: getActiveRunOwnership(conversationId)?.runToken ?? null,
    agentConversationEntries,
    runtimeLogs,
    runtimeResolutionLogs,
    runtimeConfigLogs,
  });
};

const getLatestAssistantTurn = (conversationId: string) =>
  [...(memoryTurns.get(conversationId) ?? [])]
    .reverse()
    .find((turn) => turn?.role === 'assistant');

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

const withMarkdownFlowHarness = async (
  task: (params: {
    tempRoot: string;
    codeInfo2Root: string;
    localFlowsDir: string;
    buildRepoEntry: typeof buildRepoEntry;
    writeFlowFile: typeof writeFlowFile;
    writeMarkdownFile: typeof writeMarkdownFile;
    runFlow: (params: {
      flowName: string;
      conversationId: string;
      listedRepos?: RepoEntry[];
      sourceId?: string;
      finalContent?: string;
      resolverListRepos?: () => Promise<{
        repos: RepoEntry[];
        lockedModelId: string | null;
      }>;
      resolverReadFile?: (filePath: string) => Promise<Buffer>;
      turnsPredicate: (turns: Turn[]) => boolean;
    }) => Promise<{ messages: string[]; turns: Turn[] }>;
  }) => Promise<void>,
) => {
  await withDeterministicCodexAvailabilityBootstrap(async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'flows-markdown-file-'),
    );
    const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
    const localFlowsDir = path.join(codeInfo2Root, 'flows');
    const agentsHome = path.join(codeInfo2Root, 'codex_agents');
    const codexHome = path.join(tempRoot, 'codex-home');
    await fs.mkdir(localFlowsDir, { recursive: true });
    await writeAgentScaffold({
      agentsHome,
      agentName: 'coding_agent',
      codexHome,
    });

    const conversations = new Set<string>();

    try {
      await runWithTestEnvOverrides(
        {
          CODEINFO_AGENT_HOME: agentsHome,
          CODEINFO_CODEX_AGENT_HOME: agentsHome,
          CODEINFO_CODEX_HOME: codexHome,
          FLOWS_DIR: localFlowsDir,
        },
        async () => {
          await task({
            tempRoot,
            codeInfo2Root,
            localFlowsDir,
            buildRepoEntry,
            writeFlowFile,
            writeMarkdownFile,
            runFlow: async ({
              flowName,
              conversationId,
              listedRepos = [],
              sourceId,
              finalContent,
              resolverListRepos,
              resolverReadFile,
              turnsPredicate,
            }) => {
              conversations.add(conversationId);
              const messages: string[] = [];
              const repoResult = {
                repos: listedRepos,
                lockedModelId: null,
              };
              __setMarkdownFileResolverDepsForTests({
                listIngestedRepositories:
                  resolverListRepos ??
                  (async () => ({ repos: listedRepos, lockedModelId: null })),
                ...(resolverReadFile ? { readFile: resolverReadFile } : {}),
              });

              await startFlowRun({
                flowName,
                conversationId,
                source: 'REST',
                sourceId,
                chatFactory: () => new CapturingChat(messages, finalContent),
                listIngestedRepositories: async () => repoResult,
              });

              const turns = await waitForTurns(
                conversationId,
                turnsPredicate,
                4000,
                () =>
                  JSON.stringify({
                    messages,
                    runtime: JSON.parse(
                      describeConversationRuntime(conversationId),
                    ),
                  }),
              );
              collectAgentConversationIds(conversationId).forEach((id) =>
                conversations.add(id),
              );
              await waitFor(
                () =>
                  messages.length > 0 ||
                  turns.some((turn) => turn.role === 'assistant'),
              );
              return { messages, turns };
            },
          });
        },
      );
    } finally {
      __resetMarkdownFileResolverDepsForTests();
      cleanupMemory(...conversations);
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
};

test('POST /flows/:flowName/run starts a flow run and streams events', async () => {
  assert.equal(
    pkg.dependencies?.['@openai/codex-sdk'],
    DEV_0000037_T01_REQUIRED_VERSION,
  );
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-run-'));
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  enterTestEnvOverrides({
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpDir,
  });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new StreamingChat(),
        }),
      ),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const ws = await connectWs({ baseUrl });

  const conversationId = 'flow-basic-conv-1';
  const customTitle = 'Custom Flow Title';

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const res = await supertest(baseUrl)
      .post('/flows/llm-basic/run')
      .send({ conversationId, customTitle })
      .expect(202);

    assert.equal(res.body.status, 'started');
    assert.equal(res.body.flowName, 'llm-basic');
    assert.equal(res.body.conversationId, conversationId);
    assert.equal(typeof res.body.inflightId, 'string');
    assert.equal(typeof res.body.modelId, 'string');

    const userTurn = await waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'user_turn';
        conversationId: string;
        inflightId: string;
      } => {
        const e = event as { type?: string; conversationId?: string };
        return e.type === 'user_turn' && e.conversationId === conversationId;
      },
      timeoutMs: 8000,
    });
    const delta = await waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'assistant_delta';
        conversationId: string;
        inflightId: string;
        delta: string;
      } => {
        const e = event as { type?: string; conversationId?: string };
        return (
          e.type === 'assistant_delta' && e.conversationId === conversationId
        );
      },
      timeoutMs: 8000,
    });
    assert.equal(userTurn.inflightId, delta.inflightId);

    const final = await waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is { type: 'turn_final'; status: string } => {
        const e = event as { type?: string; conversationId?: string };
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 8000,
    });
    assert.equal(final.status, 'ok');

    const conversation = memoryConversations.get(conversationId);
    assert.ok(conversation);
    assert.equal(conversation?.title, customTitle);
    assert.equal(conversation?.flowName, 'llm-basic');
    assert.equal(
      getFlowChildExecutionId(getAgentConversationId(conversationId)),
      getFlowExecutionId(conversationId),
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run ignores whitespace customTitle', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-whitespace-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  enterTestEnvOverrides({
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpDir,
  });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new StreamingChat(),
        }),
      ),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const conversationId = 'flow-basic-conv-whitespace';

  try {
    await supertest(baseUrl)
      .post('/flows/llm-basic/run')
      .send({ conversationId, customTitle: '   ' })
      .expect(202);

    const conversation = memoryConversations.get(conversationId);
    assert.ok(conversation);
    assert.equal(conversation?.title, 'Flow: llm-basic');
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('fresh flow start creates a new parent conversation when an older conversationId is supplied', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-fresh-parent-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  enterTestEnvOverrides({
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpDir,
  });

  const oldConversationId = 'flow-basic-existing-parent';
  let newConversationId: string | undefined;
  memoryConversations.set(oldConversationId, {
    _id: oldConversationId,
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Flow: llm-basic',
    flowName: 'llm-basic',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'legacy-execution',
        stepPath: [0],
        loopStack: [],
        agentConversations: { 'coding_agent:basic': 'legacy-agent-conv' },
        agentThreads: {},
      },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: new Date(),
    archivedAt: null,
  });

  try {
    const result = await startFlowRun({
      flowName: 'llm-basic',
      conversationId: oldConversationId,
      source: 'REST',
      chatFactory: () => new InstantChat(),
    });
    newConversationId = result.conversationId;

    assert.notEqual(result.conversationId, oldConversationId);
    await waitForTurns(result.conversationId, (turns) =>
      turns.some((turn) => turn.role === 'assistant'),
    );

    assert.equal(
      memoryConversations.get(oldConversationId)?._id,
      oldConversationId,
    );
    assert.equal(getFlowExecutionId(oldConversationId), 'legacy-execution');
    assert.notEqual(
      getFlowExecutionId(result.conversationId),
      'legacy-execution',
    );
  } finally {
    cleanupMemory(
      oldConversationId,
      ...collectAgentConversationIds(oldConversationId),
    );
    if (newConversationId) {
      cleanupMemory(
        newConversationId,
        ...collectAgentConversationIds(newConversationId),
      );
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('initial flow-owned execution repairs the requested provider model before first run turns persist', async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-provider-repair-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const localFlowsDir = path.join(codeInfo2Root, 'flows');
  const agentsHome = path.join(codeInfo2Root, 'codeinfo_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const flowName = 'provider-repair';
  const conversationId = 'flow-provider-repair';

  await fs.mkdir(localFlowsDir, { recursive: true });
  await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });
  await fs.writeFile(
    path.join(agentsHome, 'coding_agent', 'config.toml'),
    [
      'codeinfo_provider = "codex"',
      'model = "missing-codex-model"',
      'approval_policy = "never"',
    ].join('\n'),
    'utf8',
  );
  await writeFlowFile({
    flowsRoot: localFlowsDir,
    flowName,
    steps: [
      {
        type: 'llm',
        agentType: 'coding_agent',
        identifier: 'basic',
        messages: [
          { role: 'user', content: ['repair the first-run flow model'] },
        ],
      },
    ],
  });

  try {
    await withScopedAgentRuntime(
      {
        CODEINFO_AGENT_HOME: agentsHome,
        CODEINFO_CODEX_AGENT_HOME: agentsHome,
        CODEINFO_CODEX_HOME: codexHome,
        FLOWS_DIR: localFlowsDir,
      },
      {
        getCodexDetection: () => ({
          available: true,
          authPresent: true,
          configPresent: true,
        }),
        resolveCodexCapabilities: async () => ({
          defaults: {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'never',
            modelReasoningEffort: 'high',
            networkAccessEnabled: true,
            webSearchEnabled: false,
            webSearchMode: 'disabled',
          },
          models: [
            {
              model: 'codex-repaired',
              supportedReasoningEfforts: ['high'],
              defaultReasoningEffort: 'high',
            },
          ],
          byModel: new Map(),
          warnings: [],
          fallbackUsed: false,
        }),
        getMcpStatus: async () => ({ available: true }),
        resolveCopilotReadiness: async () => ({
          available: true,
          toolsAvailable: true,
          blockingStage: 'ready',
          models: ['copilot-model'],
          modelsRaw: [
            {
              id: 'copilot-model',
              name: 'Copilot Model',
              capabilities: {
                supports: { vision: false, reasoningEffort: false },
                limits: { max_context_window_tokens: 128000 },
              },
            },
          ],
          authSource: 'env-token',
        }),
      },
      async () => {
        const result = await startFlowRun({
          flowName,
          conversationId,
          source: 'REST',
          chatFactory: () => new InstantChat(),
        });

        assert.equal(result.conversationId, conversationId);
        assert.equal(result.modelId, 'codex-repaired');

        await waitForTurns(conversationId, (turns) =>
          turns.some((turn) => turn.role === 'assistant'),
        );

        const flowConversation = memoryConversations.get(conversationId);
        assert.equal(flowConversation?.provider, 'codex');
        assert.equal(flowConversation?.model, 'codex-repaired');

        const childConversation = memoryConversations.get(
          getAgentConversationId(conversationId),
        );
        assert.equal(childConversation?.provider, 'codex');
        assert.equal(childConversation?.model, 'codex-repaired');
      },
    );
  } finally {
    cleanupMemory(
      conversationId,
      ...collectAgentConversationIds(conversationId),
    );
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('initial flow-owned execution falls back to another provider and persists the actual provider-model pair', async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-provider-fallback-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const localFlowsDir = path.join(codeInfo2Root, 'flows');
  const agentsHome = path.join(codeInfo2Root, 'codeinfo_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const copilotHome = path.join(tempRoot, 'copilot-home');
  const flowName = 'provider-fallback';
  const conversationId = 'flow-provider-fallback';

  await fs.mkdir(localFlowsDir, { recursive: true });
  await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-model"\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(agentsHome, 'coding_agent', 'config.toml'),
    [
      'codeinfo_provider = "codex"',
      'model = "missing-codex-model"',
      'approval_policy = "never"',
    ].join('\n'),
    'utf8',
  );
  await writeFlowFile({
    flowsRoot: localFlowsDir,
    flowName,
    steps: [
      {
        type: 'llm',
        agentType: 'coding_agent',
        identifier: 'basic',
        messages: [{ role: 'user', content: ['fallback the first run'] }],
      },
    ],
  });

  try {
    await withScopedAgentRuntime(
      {
        CODEINFO_AGENT_HOME: agentsHome,
        CODEINFO_CODEX_AGENT_HOME: agentsHome,
        CODEINFO_CODEX_HOME: codexHome,
        CODEINFO_COPILOT_HOME: copilotHome,
        CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER: 'copilot,codex',
        FLOWS_DIR: localFlowsDir,
      },
      {
        getCodexDetection: () => ({
          available: false,
          authPresent: false,
          configPresent: true,
          reason: 'codex unavailable',
        }),
        resolveCodexCapabilities: async () => ({
          defaults: {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'never',
            modelReasoningEffort: 'high',
            networkAccessEnabled: true,
            webSearchEnabled: false,
            webSearchMode: 'disabled',
          },
          models: [],
          byModel: new Map(),
          warnings: [],
          fallbackUsed: false,
        }),
        getMcpStatus: async () => ({ available: true }),
        resolveCopilotReadiness: async () => ({
          available: true,
          toolsAvailable: true,
          blockingStage: 'ready',
          models: ['copilot-model'],
          modelsRaw: [
            {
              id: 'copilot-model',
              name: 'Copilot Model',
              capabilities: {
                supports: { vision: false, reasoningEffort: false },
                limits: { max_context_window_tokens: 128000 },
              },
            },
          ],
          authSource: 'env-token',
        }),
      },
      async () => {
        const result = await startFlowRun({
          flowName,
          conversationId,
          source: 'REST',
          chatFactory: () => new InstantChat(),
        });

        assert.equal(result.conversationId, conversationId);
        assert.equal(result.modelId, 'copilot-model');

        await waitForTurns(conversationId, (turns) =>
          turns.some((turn) => turn.role === 'assistant'),
        );

        const flowConversation = memoryConversations.get(conversationId);
        assert.equal(flowConversation?.provider, 'copilot');
        assert.equal(flowConversation?.model, 'copilot-model');

        const childConversation = memoryConversations.get(
          getAgentConversationId(conversationId),
        );
        assert.equal(childConversation?.provider, 'copilot');
        assert.equal(childConversation?.model, 'copilot-model');
      },
    );
  } finally {
    cleanupMemory(
      conversationId,
      ...collectAgentConversationIds(conversationId),
    );
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('fresh executions of the same flow can run concurrently in different parent conversations', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-concurrent-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  enterTestEnvOverrides({
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpDir,
  });

  const flowRunA = startFlowRun({
    flowName: 'llm-basic',
    conversationId: 'flow-concurrent-a',
    source: 'REST',
    chatFactory: () => new DelayedInstantChat(75),
  });
  const flowRunB = startFlowRun({
    flowName: 'llm-basic',
    conversationId: 'flow-concurrent-b',
    source: 'REST',
    chatFactory: () => new DelayedInstantChat(75),
  });

  try {
    const [resultA, resultB] = await Promise.all([flowRunA, flowRunB]);
    assert.notEqual(resultA.conversationId, resultB.conversationId);

    await Promise.all([
      waitForTurns(resultA.conversationId, (turns) =>
        turns.some((turn) => turn.role === 'assistant'),
      ),
      waitForTurns(resultB.conversationId, (turns) =>
        turns.some((turn) => turn.role === 'assistant'),
      ),
    ]);

    assert.notEqual(
      getFlowExecutionId(resultA.conversationId),
      getFlowExecutionId(resultB.conversationId),
    );
  } finally {
    cleanupMemory(
      'flow-concurrent-a',
      ...collectAgentConversationIds('flow-concurrent-a'),
      'flow-concurrent-b',
      ...collectAgentConversationIds('flow-concurrent-b'),
    );
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('retryOwnershipPending replay distinguishes still running, finished, and accepted-then-died-before-terminal cleanup', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-retry-ownership-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  enterTestEnvOverrides({
    NODE_ENV: 'test',
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpDir,
  });
  const customTitle = 'Accepted Retry Launch';

  try {
    const firstConversationId = 'flow-retry-ownership-a';
    const retryOwnershipId = 'fresh-run-retry-1';
    const launchSignature = JSON.stringify({
      flowName: 'llm-basic',
      source: 'REST',
      customTitle,
    });
    const firstResult = await startFlowRun({
      flowName: 'llm-basic',
      conversationId: firstConversationId,
      retryOwnershipId,
      customTitle,
      source: 'REST',
      chatFactory: () => new DelayedInstantChat(250),
    });
    await waitFor(() => Boolean(getActiveRunOwnership(firstConversationId)));
    await waitFor(() =>
      Boolean(
        (
          (memoryConversations.get(firstConversationId)?.flags ?? {}) as {
            flow?: { retryOwnershipPending?: unknown };
          }
        ).flow?.retryOwnershipPending,
      ),
    );

    const replayWhileRunning = await startFlowRun({
      flowName: 'llm-basic',
      conversationId: 'flow-retry-ownership-running',
      retryOwnershipId,
      customTitle,
      source: 'REST',
      chatFactory: () => new InstantChat(),
    });
    assert.deepEqual(replayWhileRunning, firstResult);

    await waitForConversationUnlocked(firstResult.conversationId);
    await waitFor(
      async () =>
        Boolean(
          await __getPersistedFreshRunRetryOwnershipCompletionForTests({
            flowName: 'llm-basic',
            retryOwnershipId,
            launch: {
              flowName: 'llm-basic',
              source: 'REST',
              customTitle,
            },
          }),
        ),
      20000,
    );
    assert.equal(
      memoryConversations.get(firstResult.conversationId)?.title,
      customTitle,
    );
    __resetFreshRunRetryOwnershipCompletionForTests();

    const replayAfterCompletion = await startFlowRun({
      flowName: 'llm-basic',
      conversationId: 'flow-retry-ownership-finished',
      retryOwnershipId,
      customTitle,
      source: 'REST',
      chatFactory: () => new InstantChat(),
    });
    assert.deepEqual(replayAfterCompletion, firstResult);
    await waitForTurnCountToStay(firstResult.conversationId, 2);

    const firstConversation = memoryConversations.get(firstResult.conversationId);
    assert.ok(firstConversation, 'expected original retry conversation');
    const originalFlow = ((firstConversation.flags ?? {}) as {
      flow?: Record<string, unknown>;
    }).flow;
    assert.ok(originalFlow, 'expected persisted flow state');

    memoryConversations.set(firstResult.conversationId, {
      ...firstConversation,
      flags: {
        ...(firstConversation.flags ?? {}),
        flow: {
          ...originalFlow,
          retryOwnershipPending: {
            retryOwnershipId,
            launchSignature,
            result: firstResult,
          },
        },
      },
    });
    const stalePendingFlow = (
      (memoryConversations.get(firstResult.conversationId)?.flags ?? {}) as {
        flow?: Record<string, unknown>;
      }
    ).flow;
    if (stalePendingFlow) {
      delete stalePendingFlow.retryOwnershipCompletion;
    }

    __resetFreshRunRetryOwnershipCompletionForTests();

    const replayAfterCrash = await startFlowRun({
      flowName: 'llm-basic',
      conversationId: 'flow-retry-ownership-crash-retry',
      retryOwnershipId,
      customTitle,
      source: 'REST',
      chatFactory: () => new InstantChat(),
    });
    assert.equal(
      replayAfterCrash.conversationId,
      'flow-retry-ownership-crash-retry',
    );
    assert.notEqual(replayAfterCrash.inflightId, firstResult.inflightId);
    await waitForConversationUnlocked(replayAfterCrash.conversationId);
  } finally {
    cleanupMemory(
      'flow-retry-ownership-a',
      'flow-retry-ownership-running',
      'flow-retry-ownership-finished',
      'flow-retry-ownership-crash-retry',
    );
    __resetFreshRunRetryOwnershipCompletionForTests();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('retryOwnershipId replay stays scoped to sourceId for ingested flows that share the same flow name', async () => {
  const tmpLocalDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-retry-source-local-'),
  );
  const repoA = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-repo-a-'));
  const repoB = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-repo-b-'));
  await fs.mkdir(path.join(repoA, 'flows'), { recursive: true });
  await fs.mkdir(path.join(repoB, 'flows'), { recursive: true });
  await fs.cp(fixturesDir, path.join(repoA, 'flows'), { recursive: true });
  await fs.cp(fixturesDir, path.join(repoB, 'flows'), { recursive: true });
  enterTestEnvOverrides({
    NODE_ENV: 'test',
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpLocalDir,
  });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(repoA), buildRepoEntry(repoB)],
            lockedModelId: null,
          }),
        }),
      ),
    }),
  );

  try {
    const firstResult = (
      await supertest(app)
        .post('/flows/llm-basic/run')
        .send({
          conversationId: 'flow-retry-source-a',
          sourceId: repoA,
          retryOwnershipId: 'fresh-run-retry-1',
        })
        .expect(202)
    ).body as {
      conversationId: string;
      inflightId: string;
      providerId: string;
      modelId: string;
    };
    await waitForConversationUnlocked(firstResult.conversationId);
    await waitForTurns(firstResult.conversationId, (turns) =>
      turns.some((turn) => turn.role === 'assistant'),
    );

    __resetFreshRunRetryOwnershipCompletionForTests();

    const secondResult = (
      await supertest(app)
        .post('/flows/llm-basic/run')
        .send({
          conversationId: 'flow-retry-source-b',
          sourceId: repoB,
          retryOwnershipId: 'fresh-run-retry-1',
        })
        .expect(202)
    ).body as typeof firstResult;
    await waitForConversationUnlocked(secondResult.conversationId);
    await waitForTurns(secondResult.conversationId, (turns) =>
      turns.some((turn) => turn.role === 'assistant'),
    );

    assert.equal(firstResult.conversationId, 'flow-retry-source-a');
    assert.equal(secondResult.conversationId, 'flow-retry-source-b');
    assert.notDeepEqual(secondResult, firstResult);
  } finally {
    cleanupMemory('flow-retry-source-a', 'flow-retry-source-b');
    __resetFreshRunRetryOwnershipCompletionForTests();
    await fs.rm(tmpLocalDir, { recursive: true, force: true });
    await fs.rm(repoA, { recursive: true, force: true });
    await fs.rm(repoB, { recursive: true, force: true });
  }
});

test('flow run stops before turn persistence when metadata retries exhaust', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-metadata-exhaust-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  const workingFolder = path.join(tmpDir, 'repo-working-root');
  const conversationId = 'flow-metadata-retry-exhausted';
  const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;
  const originalSave = ConversationModel.prototype.save;
  let updateAttempts = 0;
  enterTestEnvOverrides({
    NODE_ENV: 'test',
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpDir,
  });

  try {
    await withMockedMongoConversationPersistence({
      seedConversations: [],
      run: async ({ conversations, turns }) => {
        ConversationModel.prototype.save = async function save(this: unknown) {
          const doc = this as { _id?: unknown; toObject?: () => unknown };
          const saved = {
            ...structuredClone(doc.toObject?.() ?? doc),
            _id: String(doc._id ?? conversationId),
          } as Conversation;
          conversations.set(String(saved._id), saved);
          return saved;
        } as typeof ConversationModel.prototype.save;
        ConversationModel.findOneAndUpdate = (() => ({
          exec: async () => {
            updateAttempts += 1;
            return null;
          },
        })) as unknown as typeof ConversationModel.findOneAndUpdate;

        const result = await startFlowRun({
          flowName: 'llm-basic',
          conversationId,
          source: 'REST',
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(workingFolder)],
            lockedModelId: null,
          }),
        });

        assert.equal(result.conversationId, conversationId);
        await waitFor(() => updateAttempts > 0, 30000);
        await waitForConversationUnlocked(conversationId, 30000);

        assert.ok(updateAttempts > 0);
        assert.equal(turns.length, 0);
        assert.equal(conversations.get(conversationId)?.provider, 'codex');
        assert.ok(conversations.get(conversationId)?.model);
      },
    });
  } finally {
    ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
    ConversationModel.prototype.save = originalSave;
    cleanupMemory(
      conversationId,
      ...collectAgentConversationIds(conversationId),
    );
    __resetFreshRunRetryOwnershipCompletionForTests();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run returns 404 for unknown sourceId', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-unknown-source-'),
  );
  enterTestEnvOverrides({
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpDir,
  });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry('/data/known-repo')],
            lockedModelId: null,
          }),
        }),
      ),
    }),
  );

  try {
    await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ sourceId: '/data/unknown-repo' })
      .expect(404);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run fails on invalid agent config supported key types (resolver regression guard)', async () => {
  const tmpAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tmpFlowsDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-invalid-config-'),
  );
  const agentHome = path.join(tmpAgentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "gpt-5.1-codex-max"', 'approval_policy = 42'].join('\n'),
    'utf8',
  );
  await fs.cp(fixturesDir, tmpFlowsDir, { recursive: true });
  enterTestEnvOverrides({
    CODEINFO_AGENT_HOME: tmpAgentsHome,
    CODEINFO_CODEX_AGENT_HOME: tmpAgentsHome,
    FLOWS_DIR: tmpFlowsDir,
  });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
        }),
      ),
    }),
  );

  try {
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ conversationId: 'flow-invalid-config-regression' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
    assert.equal(typeof res.body.message, 'string');
    assert.equal(res.body.message.length > 0, true);
  } finally {
    await fs.rm(tmpFlowsDir, { recursive: true, force: true });
    await fs.rm(tmpAgentsHome, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run uses ingested flow when sourceId provided', async () => {
  const tmpLocalDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-local-'),
  );
  const tmpRepoRoot = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-ingested-'),
  );
  const tmpRepoFlows = path.join(tmpRepoRoot, 'flows');
  await fs.mkdir(tmpRepoFlows, { recursive: true });
  await fs.cp(fixturesDir, tmpRepoFlows, { recursive: true });
  enterTestEnvOverrides({
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpLocalDir,
  });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(tmpRepoRoot)],
            lockedModelId: null,
          }),
        }),
      ),
    }),
  );

  try {
    const conversationId = 'flow-ingested-conv-1';
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ conversationId, sourceId: tmpRepoRoot })
      .expect(202);

    assert.equal(res.body.status, 'started');
    assert.equal(res.body.flowName, 'llm-basic');
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  } finally {
    await fs.rm(tmpLocalDir, { recursive: true, force: true });
    await fs.rm(tmpRepoRoot, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run requires the canonical sourceId instead of a host alias payload', async () => {
  const tmpLocalDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-local-legacy-'),
  );
  const tmpRepoRoot = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-ingested-legacy-'),
  );
  const tmpRepoFlows = path.join(tmpRepoRoot, 'flows');
  const hostAliasPath = path.join('/host-alias', path.basename(tmpRepoRoot));
  await fs.mkdir(tmpRepoFlows, { recursive: true });
  await fs.cp(fixturesDir, tmpRepoFlows, { recursive: true });
  enterTestEnvOverrides({
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpLocalDir,
  });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [
              {
                id: 'Legacy',
                description: null,
                containerPath: tmpRepoRoot,
                hostPath: hostAliasPath,
                lastIngestAt: null,
                model: 'legacy-model',
                modelId: 'legacy-model',
                counts: { files: 0, chunks: 0, embedded: 0 },
                lastError: null,
              } as unknown as RepoEntry,
            ],
            lockedModelId: null,
          }),
        }),
      ),
    }),
  );

  try {
    const rejected = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({
        conversationId: 'flow-ingested-conv-legacy-alias',
        sourceId: hostAliasPath,
      })
      .expect(404);

    assert.equal(rejected.body.error, 'not_found');

    const accepted = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({
        conversationId: 'flow-ingested-conv-legacy-canonical',
        sourceId: tmpRepoRoot,
      })
      .expect(202);

    assert.equal(accepted.body.status, 'started');
    assert.equal(accepted.body.flowName, 'llm-basic');
    memoryConversations.delete('flow-ingested-conv-legacy-alias');
    memoryTurns.delete('flow-ingested-conv-legacy-alias');
    memoryConversations.delete('flow-ingested-conv-legacy-canonical');
    memoryTurns.delete('flow-ingested-conv-legacy-canonical');
  } finally {
    await fs.rm(tmpLocalDir, { recursive: true, force: true });
    await fs.rm(tmpRepoRoot, { recursive: true, force: true });
  }
});

test('flow llm.basic stops before replay completion when persisted metadata reports not_found after a concurrent delete', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-not-found-'),
  );
  const workingFolder = path.join(tmpDir, 'repo-working-root');
  const conversationId = 'flow-not-found-conversation';
  const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;
  const originalSave = ConversationModel.prototype.save;
  let updateAttempts = 0;

  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  await fs.mkdir(workingFolder, { recursive: true });
  enterTestEnvOverrides({
    NODE_ENV: 'test',
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpDir,
  });

  try {
    await withMockedMongoConversationPersistence({
      seedConversations: [],
      run: async ({ conversations, turns }) => {
        ConversationModel.prototype.save = async function save(this: unknown) {
          const doc = this as { _id?: unknown; toObject?: () => unknown };
          const saved = {
            ...structuredClone(doc.toObject?.() ?? doc),
            _id: String(doc._id ?? conversationId),
          } as Conversation;
          conversations.set(String(saved._id), saved);
          return saved;
        } as typeof ConversationModel.prototype.save;
        ConversationModel.findOneAndUpdate = (() => ({
          exec: async () => {
            updateAttempts += 1;
            conversations.delete(conversationId);
            return null;
          },
        })) as unknown as typeof ConversationModel.findOneAndUpdate;

        const app = express();
        app.use(
          createFlowsRunRouter({
            startFlowRun: bindCurrentTestOverrides((params) =>
              startFlowRun({
                ...params,
                chatFactory: () => new InstantChat(),
                listIngestedRepositories: async () => ({
                  repos: [buildRepoEntry(workingFolder)],
                  lockedModelId: null,
                }),
              }),
            ),
          }),
        );

        const response = await supertest(app)
          .post('/flows/llm-basic/run')
          .send({
            conversationId,
            retryOwnershipId: 'flow-not-found-retry-1',
            working_folder: workingFolder,
          });

        assert.equal(response.status, 202);
        assert.equal(response.body.status, 'started');
        await waitFor(() => updateAttempts > 0, 20000);
        await waitForConversationUnlocked(conversationId, 20000);
        assert.ok(updateAttempts > 0);
        assert.equal(turns.length, 0);
        assert.equal(conversations.get(conversationId), undefined);
        assert.equal(
          await __getPersistedFreshRunRetryOwnershipCompletionForTests({
            flowName: 'llm-basic',
            retryOwnershipId: 'flow-not-found-retry-1',
            launch: {
              flowName: 'llm-basic',
              source: 'REST',
              workingFolder,
            },
          }),
          null,
        );
      },
    });
  } finally {
    ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
    ConversationModel.prototype.save = originalSave;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run uses local flows when sourceId omitted', async () => {
  const tmpLocalDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-local-only-'),
  );
  await fs.cp(fixturesDir, tmpLocalDir, { recursive: true });
  const tmpRepoRoot = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-ingested-only-'),
  );
  const tmpRepoFlows = path.join(tmpRepoRoot, 'flows');
  await fs.mkdir(tmpRepoFlows, { recursive: true });
  await fs.cp(fixturesDir, tmpRepoFlows, { recursive: true });
  enterTestEnvOverrides({
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpLocalDir,
  });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(tmpRepoRoot)],
            lockedModelId: null,
          }),
        }),
      ),
    }),
  );

  try {
    const conversationId = 'flow-local-conv-1';
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ conversationId })
      .expect(202);

    assert.equal(res.body.status, 'started');
    assert.equal(res.body.flowName, 'llm-basic');
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  } finally {
    await fs.rm(tmpLocalDir, { recursive: true, force: true });
    await fs.rm(tmpRepoRoot, { recursive: true, force: true });
  }
});

test('memory-backed flow runs preserve saved workingFolder while updating flow resume snapshots', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-working-folder-state-'),
  );
  const workingFolder = path.join(tmpDir, 'repo-working-root');
  const conversationId = 'flow-working-folder-state';

  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  await fs.mkdir(workingFolder, { recursive: true });
  enterTestEnvOverrides({
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpDir,
  });
  let executeStarted = false;

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Flow: llm-basic',
    flowName: 'llm-basic',
    source: 'REST',
    flags: { workingFolder },
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: new Date(),
    archivedAt: null,
  });

  try {
    const result = await startFlowRun({
      flowName: 'llm-basic',
      conversationId,
      working_folder: workingFolder,
      source: 'REST',
      chatFactory: () =>
        new (class extends ChatInterface {
          async execute(
            _message: string,
            _flags: Record<string, unknown>,
            childConversationId: string,
            _model: string,
          ) {
            void _message;
            void _flags;
            void _model;
            executeStarted = true;
            this.emit('thread', { type: 'thread', threadId: childConversationId });
            this.emit('final', { type: 'final', content: 'ok' });
            this.emit('complete', { type: 'complete', threadId: childConversationId });
          }
        })(),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(workingFolder)],
        lockedModelId: null,
      }),
    });

    assert.notEqual(result.conversationId, conversationId);
    await waitFor(
      () => executeStarted,
      4000,
    );

    await waitForTurns(
      result.conversationId,
      (turns) => turns.filter((turn) => turn.role === 'assistant').length > 0,
      4000,
      () =>
        JSON.stringify({
          phase: 'waiting_for_first_assistant_turn',
          executeStarted,
        }),
    );

    const conversation = memoryConversations.get(result.conversationId);
    const flags = (conversation?.flags ?? {}) as {
      workingFolder?: string;
      flow?: {
        workingFolder?: string;
        agentConversations?: Record<string, string>;
        agentWorkingFolders?: Record<string, string>;
      };
    };

    assert.equal(flags.workingFolder, workingFolder);
    assert.equal(flags.flow?.workingFolder, workingFolder);
    assert.equal(
      flags.flow?.agentWorkingFolders?.['coding_agent:basic'],
      workingFolder,
    );
    assert.equal(
      typeof flags.flow?.agentConversations?.['coding_agent:basic'],
      'string',
    );
    cleanupMemory(
      result.conversationId,
      ...collectAgentConversationIds(result.conversationId),
    );
  } finally {
    cleanupMemory(
      conversationId,
      ...collectAgentConversationIds(conversationId),
    );
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('flow llm.markdownFile prefers the parent flow repository before codeInfo2', async () => {
  await withMarkdownFlowHarness(
    async ({
      tempRoot,
      codeInfo2Root,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'source-first';
      const conversationId = 'flow-markdown-source-first';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'shared.md',
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: codeInfo2Root,
        relativePath: 'shared.md',
        content: 'codeinfo2 markdown',
      });
      await writeMarkdownFile({
        repoRoot: sourceRepo,
        relativePath: 'shared.md',
        content: 'source markdown',
      });

      const { messages } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [buildRepoEntry(sourceRepo)],
        turnsPredicate: (turns) =>
          turns.some(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ),
      });

      assert.deepEqual(messages, ['source markdown']);
    },
  );
});
test('github review skip publishes completed-with-warning and records a durable plan note', async () => {
  const tempFlowsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'github-flow-'));
  const repoRoot = await createGitHubReviewRepoFixture();
  enterTestEnvOverrides({ FLOWS_DIR: tempFlowsDir });
  const conversationId = 'github-skip-conversation';

  try {
    await writeFlowFile({
      flowsRoot: tempFlowsDir,
      flowName: 'github-skip',
      steps: [{ type: 'github_open_pr', label: 'Open PR' }],
    });

    await startFlowRun({
      flowName: 'github-skip',
      conversationId,
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () => new InstantChat(),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });

    await waitFor(async () => {
      const planRaw = await fs.readFile(
        path.join(
          repoRoot,
          'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
        ),
        'utf8',
      );
      return planRaw.includes(
        'GitHub review stage skipped during PR open: The repository-local GitHub token file `.env.local` is missing.',
      );
    }, 4000);

    const warningTurns = await waitForTurns(
      conversationId,
      (turns) =>
        turns.some(
          (turn) => turn.role === 'assistant' && turn.status === 'warning',
        ),
      4000,
    );
    const warningTurn = [...warningTurns]
      .reverse()
      .find((turn) => turn.role === 'assistant' && turn.status === 'warning');
    assert.ok(warningTurn);
    assert.match(
      warningTurn.content,
      /GitHub review stage skipped during PR open:/,
    );
  } finally {
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('github review open PR logs retry diagnostics and skips safely when post-create reconciliation exhausts all lookup attempts', async () => {
  const tempFlowsDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'github-open-pr-flow-'),
  );
  const repoRoot = await createGitHubReviewRepoFixture({ flowTaskNumber: 23 });
  enterTestEnvOverrides({ FLOWS_DIR: tempFlowsDir });
  const conversationId = 'github-open-pr-retry-failure';

  try {
    await fs.writeFile(
      path.join(repoRoot, '.env.local'),
      'CODEINFO_PR_TOKEN=test-token\n',
      'utf8',
    );
    let lookupAttempts = 0;
    __setGitHubReviewDepsForTests({
      readFile: async (filePath, encoding) =>
        await fs.readFile(filePath, encoding),
      sleep: async () => {},
      runCommand: async ({ command, args }) => {
        if (command === 'git') {
          const joined = args.join(' ');
          if (joined === 'branch --show-current') {
            return {
              exitCode: 0,
              stdout:
                'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps\n',
              stderr: '',
            };
          }
          if (joined === 'rev-parse HEAD') {
            return { exitCode: 0, stdout: 'abc123\n', stderr: '' };
          }
          if (
            joined === 'rev-parse --abbrev-ref --symbolic-full-name @{u}'
          ) {
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
              stdout: 'https://github.com/test-owner/test-repo.git\n',
              stderr: '',
            };
          }
          if (
            joined ===
            'push origin HEAD:feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps'
          ) {
            return { exitCode: 0, stdout: '', stderr: '' };
          }
          return {
            exitCode: 1,
            stdout: '',
            stderr: `unexpected git command: ${joined}`,
          };
        }
        if (command === 'gh') {
          if (args[0] === 'pr' && args[1] === 'create') {
            return {
              exitCode: 0,
              stdout: 'https://github.com/test-owner/test-repo/pull/206\n',
              stderr: '',
            };
          }
          lookupAttempts += 1;
          return {
            exitCode: 1,
            stdout: '',
            stderr: `lookup attempt ${lookupAttempts} failed`,
          };
        }
        return {
          exitCode: 1,
          stdout: '',
          stderr: `unexpected command: ${command}`,
        };
      },
    });

    await writeFlowFile({
      flowsRoot: tempFlowsDir,
      flowName: 'github-open-pr-retry-failure',
      steps: [{ type: 'github_open_pr', label: 'Open PR' }],
    });

    await startFlowRun({
      flowName: 'github-open-pr-retry-failure',
      conversationId,
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () => new InstantChat(),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });

    await waitForTurns(
      conversationId,
      (turns) =>
        turns.some(
          (turn) => turn.role === 'assistant' && turn.status === 'warning',
        ),
      4000,
    );

    const assistantTurns = [...(memoryTurns.get(conversationId) ?? [])].filter(
      (turn) => turn.role === 'assistant',
    );
    const warningTurns = assistantTurns.filter(
      (turn) => turn.status === 'warning',
    );
    assert.equal(warningTurns.length, 1);
    const retryLogs = query({
      text: 'flows.github.open_pr.lookup_retry_failed',
    }).filter(
      (entry) => entry.context?.flowName === 'github-open-pr-retry-failure',
    );
    assert.deepEqual(
      retryLogs.map((entry) => entry.context?.waitMs),
      [0, 1000, 2000, 5000],
    );

    assert.equal(
      assistantTurns.some((turn) => turn.status === 'failed'),
      false,
    );
    assert.match(
      warningTurns[0]?.content ?? '',
      /Final lookup failure 5 after 10s/i,
    );
    assert.match(
      warningTurns[0]?.content ?? '',
      /stderr: lookup attempt 5 failed/i,
    );

    const planRaw = await fs.readFile(
      path.join(
        repoRoot,
        'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
      ),
      'utf8',
    );
    assert.match(planRaw, /GitHub review stage failed during PR open\./);
    assert.match(planRaw, /Lookup retry warning 4 after 5s:/);
    assert.match(planRaw, /Final lookup failure 5 after 10s:/);
  } finally {
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('github review open PR records recovered gh pr create ambiguity without a terminal warning turn', async () => {
  const tempFlowsDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'github-open-pr-ambiguous-flow-'),
  );
  const repoRoot = await createGitHubReviewRepoFixture({ flowTaskNumber: 23 });
  enterTestEnvOverrides({ FLOWS_DIR: tempFlowsDir });
  const conversationId = 'github-open-pr-ambiguous-success';

  try {
    await fs.writeFile(
      path.join(repoRoot, '.env.local'),
      'CODEINFO_PR_TOKEN=test-token\n',
      'utf8',
    );
    const latestPullPage = JSON.stringify([
      {
        number: 45,
        html_url: 'https://github.com/test-owner/test-repo/pull/45',
        title: 'latest pull request',
        created_at: '2026-06-24T10:00:00Z',
        head: {
          ref: 'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
        },
        base: { ref: 'main' },
        user: { login: 'review-bot' },
      },
    ]);
    __setGitHubReviewDepsForTests({
      readFile: async (filePath, encoding) =>
        await fs.readFile(filePath, encoding),
      sleep: async () => {},
      runCommand: async ({ command, args }) => {
        if (command === 'git') {
          const joined = args.join(' ');
          if (joined === 'branch --show-current') {
            return {
              exitCode: 0,
              stdout:
                'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps\n',
              stderr: '',
            };
          }
          if (joined === 'rev-parse HEAD') {
            return { exitCode: 0, stdout: 'abc123\n', stderr: '' };
          }
          if (
            joined === 'rev-parse --abbrev-ref --symbolic-full-name @{u}'
          ) {
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
              stdout: 'https://github.com/test-owner/test-repo.git\n',
              stderr: '',
            };
          }
          if (
            joined ===
            'push origin HEAD:feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps'
          ) {
            return { exitCode: 0, stdout: '', stderr: '' };
          }
          return {
            exitCode: 1,
            stdout: '',
            stderr: `unexpected git command: ${joined}`,
          };
        }
        if (command === 'gh') {
          if (args[0] === 'pr' && args[1] === 'create') {
            return {
              exitCode: 1,
              stdout: '',
              stderr: 'connection dropped after create',
            };
          }
          return {
            exitCode: 0,
            stdout: latestPullPage,
            stderr: '',
          };
        }
        return {
          exitCode: 1,
          stdout: '',
          stderr: `unexpected command: ${command}`,
        };
      },
    });

    await writeFlowFile({
      flowsRoot: tempFlowsDir,
      flowName: 'github-open-pr-ambiguous-success',
      steps: [{ type: 'github_open_pr', label: 'Open PR' }],
    });

    await startFlowRun({
      flowName: 'github-open-pr-ambiguous-success',
      conversationId,
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () => new InstantChat(),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });

    await waitForConversationUnlocked(conversationId);
    const assistantTurns = [...(memoryTurns.get(conversationId) ?? [])].filter(
      (turn) => turn.role === 'assistant',
    );
    assert.equal(
      assistantTurns.some((turn) => turn.status === 'warning'),
      false,
    );
    assert.equal(
      assistantTurns.some((turn) => turn.status === 'failed'),
      false,
    );

    const planRaw = await fs.readFile(
      path.join(
        repoRoot,
        'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
      ),
      'utf8',
    );
    assert.match(
      planRaw,
      /GitHub review stage warning during PR open: gh pr create reported a failure before reconciliation, but latest-open PR lookup resolved pull request #45\./,
    );
    assert.match(planRaw, /stderr: connection dropped after create/i);
  } finally {
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('github review fetch without an open pull request publishes completed-with-warning while adjacent non-GitHub flows still complete with ok status', async () => {
  const tempFlowsDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'github-fetch-flow-'),
  );
  const repoRoot = await createGitHubReviewRepoFixture();
  enterTestEnvOverrides({ FLOWS_DIR: tempFlowsDir });

  try {
    await fs.writeFile(
      path.join(repoRoot, '.env.local'),
      'CODEINFO_PR_TOKEN=test-token\n',
      'utf8',
    );
    __setGitHubReviewDepsForTests({
      readFile: async (filePath, encoding) => await fs.readFile(filePath, encoding),
      runCommand: async ({ command, args }) => {
        if (command === 'git') {
          const joined = args.join(' ');
          if (joined === 'branch --show-current') {
            return { exitCode: 0, stdout: 'feature/0000060-test\n', stderr: '' };
          }
          if (joined === 'rev-parse HEAD') {
            return { exitCode: 0, stdout: 'abc123\n', stderr: '' };
          }
          if (
            joined === 'rev-parse --abbrev-ref --symbolic-full-name @{u}'
          ) {
            return { exitCode: 0, stdout: 'origin/feature/0000060-test\n', stderr: '' };
          }
          if (joined === 'remote get-url origin') {
            return {
              exitCode: 0,
              stdout: 'https://github.com/test-owner/test-repo.git\n',
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
          return {
            exitCode: 1,
            stdout: '',
            stderr: `unexpected git command: ${joined}`,
          };
        }
        if (command === 'gh') {
          return { exitCode: 0, stdout: '[]', stderr: '' };
        }
        return {
          exitCode: 1,
          stdout: '',
          stderr: `unexpected command: ${command}`,
        };
      },
    });

    await writeFlowFile({
      flowsRoot: tempFlowsDir,
      flowName: 'github-no-open-pr',
      steps: [{ type: 'github_fetch_reviews', label: 'Fetch reviews' }],
    });

    const warningConversationId = 'github-no-open-pr-conversation';
    await startFlowRun({
      flowName: 'github-no-open-pr',
      conversationId: warningConversationId,
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () => new InstantChat(),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });

    await waitForTurns(
      warningConversationId,
      (turns) =>
        turns.some(
          (turn) => turn.role === 'assistant' && turn.status === 'warning',
        ),
      4000,
    );
    const warningTurn = getLatestAssistantTurn(warningConversationId);
    assert.ok(warningTurn);
    assert.equal(warningTurn.status, 'warning');
    assert.match(warningTurn.content, /no latest open pull request/i);

    await writeFlowFile({
      flowsRoot: tempFlowsDir,
      flowName: 'github-adjacent-ok',
      steps: [
        {
          type: 'llm',
          agentType: 'coding_agent',
          identifier: 'basic',
          messages: [{ role: 'user', content: ['Still OK'] }],
        },
      ],
    });

    const okConversationId = 'github-adjacent-ok-conversation';
    await startFlowRun({
      flowName: 'github-adjacent-ok',
      conversationId: okConversationId,
      source: 'REST',
      chatFactory: () => new InstantChat(),
    });

    await waitForTurns(
      okConversationId,
      (turns) =>
        turns.some((turn) => turn.role === 'assistant' && turn.status === 'ok'),
      4000,
    );
    const okTurn = getLatestAssistantTurn(okConversationId);
    assert.ok(okTurn);
    assert.equal(okTurn.status, 'ok');
  } finally {
    __resetGitHubReviewDepsForTests();
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('resumed github review warning-stop stays provider-free until a later provider-backed step is actually needed', async () => {
  const tempFlowsDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'github-resume-warning-flow-'),
  );
  const repoRoot = await createGitHubReviewRepoFixture({ flowTaskNumber: 26 });
  enterTestEnvOverrides({ FLOWS_DIR: tempFlowsDir });
  const conversationId = 'github-resume-warning-conversation';

  try {
    await fs.writeFile(
      path.join(repoRoot, '.env.local'),
      'CODEINFO_PR_TOKEN=test-token\n',
      'utf8',
    );
    __setGitHubReviewDepsForTests({
      readFile: async (filePath, encoding) =>
        await fs.readFile(filePath, encoding),
      runCommand: async ({ command, args }) => {
        if (command === 'git') {
          const joined = args.join(' ');
          if (joined === 'branch --show-current') {
            return { exitCode: 0, stdout: 'feature/0000060-test\n', stderr: '' };
          }
          if (joined === 'rev-parse HEAD') {
            return { exitCode: 0, stdout: 'abc123\n', stderr: '' };
          }
          if (
            joined === 'rev-parse --abbrev-ref --symbolic-full-name @{u}'
          ) {
            return {
              exitCode: 0,
              stdout: 'origin/feature/0000060-test\n',
              stderr: '',
            };
          }
          if (joined === 'remote get-url origin') {
            return {
              exitCode: 0,
              stdout: 'https://github.com/test-owner/test-repo.git\n',
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
          return {
            exitCode: 1,
            stdout: '',
            stderr: `unexpected git command: ${joined}`,
          };
        }
        if (command === 'gh') {
          return { exitCode: 0, stdout: '[]', stderr: '' };
        }
        return {
          exitCode: 1,
          stdout: '',
          stderr: `unexpected command: ${command}`,
        };
      },
    });

    await writeFlowFile({
      flowsRoot: tempFlowsDir,
      flowName: 'github-resume-warning-stop',
      steps: [
        {
          type: 'llm',
          agentType: 'coding_agent',
          identifier: 'basic',
          messages: [{ role: 'user', content: ['Prime run state'] }],
        },
        { type: 'wait', label: 'Wait for review', seconds: 60 },
        { type: 'github_fetch_reviews', label: 'Fetch reviews' },
        {
          type: 'llm',
          agentType: 'coding_agent',
          identifier: 'basic',
          messages: [{ role: 'user', content: ['Should never run after warning'] }],
        },
      ],
    });

    await startFlowRun({
      flowName: 'github-resume-warning-stop',
      conversationId,
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () => new InstantChat(),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });

    await waitForConversationUnlocked(conversationId);
    const persistedWait = (
      (memoryConversations.get(conversationId)?.flags ?? {}) as {
        flow?: { wait?: { stepPath?: number[] } };
      }
    ).flow?.wait;
    assert.ok(Array.isArray(persistedWait?.stepPath));

    setCodexDetection({
      available: false,
      authPresent: false,
      configPresent: true,
      reason: 'Missing auth.json',
    });

    await startFlowRun({
      flowName: 'github-resume-warning-stop',
      conversationId,
      source: 'REST',
      working_folder: repoRoot,
      resumeStepPath: [...(persistedWait?.stepPath ?? [])],
      chatFactory: () => new InstantChat(),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });

    await waitForTurns(
      conversationId,
      (turns) =>
        turns.some(
          (turn) =>
            turn.role === 'assistant' &&
            turn.status === 'warning' &&
            /no latest open pull request/i.test(turn.content),
        ),
      4000,
    );

    const latestAssistantTurn = getLatestAssistantTurn(conversationId);
    assert.ok(latestAssistantTurn);
    assert.equal(latestAssistantTurn.status, 'warning');
    assert.match(latestAssistantTurn.content, /no latest open pull request/i);
    assert.equal(
      collectAgentConversationIds(conversationId).length,
      1,
      'resume should not bootstrap a second provider-backed step before the warning-stop seam finishes',
    );
  } finally {
    cleanupMemory(conversationId, ...collectAgentConversationIds(conversationId));
    __resetGitHubReviewDepsForTests();
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('flow llm.markdownFile passes loaded markdown through verbatim as one instruction', async () => {
  await withMarkdownFlowHarness(
    async ({
      codeInfo2Root,
      localFlowsDir,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const flowName = 'verbatim-markdown';
      const conversationId = 'flow-markdown-verbatim';
      const markdown = '# Title\n\n- first\n- second\n\n```\nconst x = 1;\n```';
      await writeFlowFile({
        flowsRoot: localFlowsDir,
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'verbatim.md',
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: codeInfo2Root,
        relativePath: 'verbatim.md',
        content: markdown,
      });

      const { messages } = await runFlow({
        flowName,
        conversationId,
        turnsPredicate: (turns) =>
          turns.some(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ),
      });

      assert.deepEqual(messages, [markdown]);
    },
  );
});

test('flow llm.markdownFile falls back to codeInfo2 after a same-source miss', async () => {
  await withMarkdownFlowHarness(
    async ({
      tempRoot,
      codeInfo2Root,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'codeinfo2-fallback';
      const conversationId = 'flow-markdown-codeinfo2-fallback';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'fallback.md',
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: codeInfo2Root,
        relativePath: 'fallback.md',
        content: 'codeinfo2 fallback markdown',
      });

      const { messages } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [buildRepoEntry(sourceRepo)],
        turnsPredicate: (turns) =>
          turns.some(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ),
      });

      assert.deepEqual(messages, ['codeinfo2 fallback markdown']);
    },
  );
});

test('flow llm.markdownFile falls back to another ingested repository after same-source and codeInfo2 misses', async () => {
  await withMarkdownFlowHarness(
    async ({
      tempRoot,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const otherRepo = path.join(tempRoot, 'repo-other');
      const flowName = 'other-repo-fallback';
      const conversationId = 'flow-markdown-other-fallback';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'shared.md',
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: otherRepo,
        relativePath: 'shared.md',
        content: 'other repo markdown',
      });

      const { messages } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [buildRepoEntry(sourceRepo), buildRepoEntry(otherRepo)],
        turnsPredicate: (turns) =>
          turns.some(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ),
      });

      assert.deepEqual(messages, ['other repo markdown']);
    },
  );
});

test('flow llm.markdownFile fails fast when a higher-priority markdown file is unreadable', async () => {
  await withMarkdownFlowHarness(
    async ({
      tempRoot,
      codeInfo2Root,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'unreadable-markdown';
      const conversationId = 'flow-markdown-unreadable';
      const sameSourcePath = await writeMarkdownFile({
        repoRoot: sourceRepo,
        relativePath: 'shared.md',
        content: 'unreadable source markdown',
      });
      await writeMarkdownFile({
        repoRoot: codeInfo2Root,
        relativePath: 'shared.md',
        content: 'codeinfo2 fallback that must not run',
      });
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'shared.md',
          },
        ],
      });

      const { messages, turns } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [buildRepoEntry(sourceRepo)],
        resolverReadFile: async (filePath) => {
          if (filePath === sameSourcePath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
          }
          return fs.readFile(filePath);
        },
        turnsPredicate: (items) =>
          items.some(
            (turn) => turn.role === 'assistant' && turn.status === 'failed',
          ),
      });

      assert.deepEqual(messages, []);
      const failedTurn = turns.find(
        (turn) => turn.role === 'assistant' && turn.status === 'failed',
      );
      assert.ok(failedTurn);
      assert.match(failedTurn.content, /permission denied/);
    },
  );
});

test('flow llm.markdownFile preserves caller-supplied other-repository order for duplicate-label fallbacks', async () => {
  await withMarkdownFlowHarness(
    async ({
      tempRoot,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const repoAlphaA = path.join(tempRoot, 'repo-alpha-a');
      const repoAlphaB = path.join(tempRoot, 'repo-alpha-b');
      const flowName = 'duplicate-label-order';
      const conversationId = 'flow-markdown-duplicate-labels';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'shared.md',
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: repoAlphaA,
        relativePath: 'shared.md',
        content: 'alpha-a markdown',
      });
      await writeMarkdownFile({
        repoRoot: repoAlphaB,
        relativePath: 'shared.md',
        content: 'alpha-b markdown',
      });

      const { messages } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [
          buildRepoEntry(sourceRepo),
          { ...buildRepoEntry(repoAlphaB), id: 'Alpha Repo' },
          { ...buildRepoEntry(repoAlphaA), id: 'Alpha Repo' },
        ],
        turnsPredicate: (turns) =>
          turns.some(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ),
      });

      assert.deepEqual(messages, ['alpha-b markdown']);
    },
  );
});

test('flow llm.markdownFile fails clearly when the markdown file is missing', async () => {
  await withMarkdownFlowHarness(
    async ({ tempRoot, buildRepoEntry, writeFlowFile, runFlow }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'missing-markdown';
      const conversationId = 'flow-markdown-missing';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'missing.md',
          },
        ],
      });

      const { messages, turns } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [buildRepoEntry(sourceRepo)],
        turnsPredicate: (items) =>
          items.some(
            (turn) => turn.role === 'assistant' && turn.status === 'failed',
          ),
      });

      assert.deepEqual(messages, []);
      const failedTurn = turns.find(
        (turn) => turn.role === 'assistant' && turn.status === 'failed',
      );
      assert.ok(failedTurn);
      assert.match(failedTurn.content, /was not found/);
    },
  );
});

test('flow llm.markdownFile fails clearly when markdown bytes are not valid UTF-8', async () => {
  await withMarkdownFlowHarness(
    async ({
      tempRoot,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'invalid-utf8-markdown';
      const conversationId = 'flow-markdown-invalid-utf8';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'broken.md',
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: sourceRepo,
        relativePath: 'broken.md',
        bytes: Uint8Array.from([0xc3, 0x28]),
      });

      const { messages, turns } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [buildRepoEntry(sourceRepo)],
        turnsPredicate: (items) =>
          items.some(
            (turn) => turn.role === 'assistant' && turn.status === 'failed',
          ),
      });

      assert.deepEqual(messages, []);
      const failedTurn = turns.find(
        (turn) => turn.role === 'assistant' && turn.status === 'failed',
      );
      assert.ok(failedTurn);
      assert.match(failedTurn.content, /Invalid UTF-8 markdown content/);
    },
  );
});

test('flow llm.markdownFile surfaces unexpected markdown resolver exceptions as flow-step failures', async () => {
  await withMarkdownFlowHarness(
    async ({ tempRoot, buildRepoEntry, writeFlowFile, runFlow }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'resolver-exception';
      const conversationId = 'flow-markdown-resolver-exception';
      const listedRepos = [buildRepoEntry(sourceRepo)];
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'shared.md',
          },
        ],
      });

      const { messages, turns } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos,
        resolverListRepos: async () => {
          throw new Error('resolver exploded');
        },
        turnsPredicate: (items) =>
          items.some(
            (turn) => turn.role === 'assistant' && turn.status === 'failed',
          ),
      });

      assert.deepEqual(messages, []);
      const failedTurn = turns.find(
        (turn) => turn.role === 'assistant' && turn.status === 'failed',
      );
      assert.ok(failedTurn);
      assert.match(failedTurn.content, /resolver exploded/);
    },
  );
});

test('flow llm.markdownFile reports AGENT_NOT_FOUND before markdown resolution failures', async () => {
  await withMarkdownFlowHarness(
    async ({ tempRoot, buildRepoEntry, writeFlowFile, runFlow }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'markdown-agent-precheck';
      const conversationId = 'flow-markdown-agent-precheck';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'missing_agent',
            identifier: 'basic',
            markdownFile: 'missing.md',
          },
        ],
      });

      await assert.rejects(
        async () =>
          runFlow({
            flowName,
            conversationId,
            sourceId: sourceRepo,
            listedRepos: [buildRepoEntry(sourceRepo)],
            turnsPredicate: () => false,
          }),
        (error) =>
          (error as { code?: string; reason?: string }).code ===
            'AGENT_NOT_FOUND' &&
          (error as { code?: string; reason?: string }).reason ===
            'Agent missing_agent not found',
      );
    },
  );
});

test('flow llm.markdownFile reports CODEX_UNAVAILABLE before markdown resolution failures', async () => {
  resetDeterministicCodexAvailabilityBootstrap();
  await withMarkdownFlowHarness(
    async ({ tempRoot, buildRepoEntry, writeFlowFile, runFlow }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'markdown-codex-precheck';
      const conversationId = 'flow-markdown-codex-precheck';
      const unavailableCodexHome = path.join(tempRoot, 'codex-home-missing');
      await fs.mkdir(unavailableCodexHome, { recursive: true });
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'missing.md',
          },
        ],
      });

      await runWithTestEnvOverrides(
        {
          CODEINFO_CODEX_HOME: unavailableCodexHome,
          CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER: 'codex',
        },
        async () => {
          setCodexDetection({
            available: false,
            authPresent: false,
            configPresent: true,
            reason: 'Missing auth.json',
          });
          await assert.rejects(
            async () =>
              runFlow({
                flowName,
                conversationId,
                sourceId: sourceRepo,
                listedRepos: [buildRepoEntry(sourceRepo)],
                turnsPredicate: () => false,
              }),
            (error) => {
              const code = (error as { code?: string; reason?: string }).code;
              const reason = (error as { code?: string; reason?: string })
                .reason;
              return (
                (code === 'CODEX_UNAVAILABLE' ||
                  code === 'PROVIDER_UNAVAILABLE') &&
                /Missing auth\.json/i.test(reason ?? '')
              );
            },
          );
        },
      );
    },
  );
});

test('flow continues to later steps after a successful llm.markdownFile step', async () => {
  await withMarkdownFlowHarness(
    async ({
      codeInfo2Root,
      localFlowsDir,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const flowName = 'markdown-then-message';
      const conversationId = 'flow-markdown-then-message';
      await writeFlowFile({
        flowsRoot: localFlowsDir,
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'first.md',
          },
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            messages: [
              {
                role: 'user',
                content: ['second step message'],
              },
            ],
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: codeInfo2Root,
        relativePath: 'first.md',
        content: 'first markdown step',
      });

      const { messages, turns } = await runFlow({
        flowName,
        conversationId,
        turnsPredicate: (items) =>
          items.filter(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ).length >= 2,
      });

      assert.deepEqual(messages, [
        'first markdown step',
        'second step message',
      ]);
      const agentConversationId = getAgentConversationId(conversationId);
      const agentTurns = memoryTurns.get(agentConversationId) ?? [];
      assert.equal(
        agentTurns.filter((turn) => turn.role === 'assistant').length,
        2,
      );
      cleanupMemory(agentConversationId);
      assert.equal(turns.filter((turn) => turn.role === 'assistant').length, 2);
    },
  );
});
