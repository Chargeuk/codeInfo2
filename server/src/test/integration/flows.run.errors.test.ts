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

import {
  tryAcquireConversationLock,
  releaseConversationLock,
} from '../../agents/runLock.js';
import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
} from '../../agents/service.js';
import { registerPendingConversationCancel } from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import {
  __resetMarkdownFileResolverDepsForTests,
  __setMarkdownFileResolverDepsForTests,
} from '../../flows/markdownFileResolver.js';
import {
  __resetFreshRunRetryOwnershipCompletionForTests,
  __resetFlowServiceDepsForTests,
  __setFlowServiceDepsForTests,
  startFlowRun,
} from '../../flows/service.js';
import type {
  ReingestError,
  ReingestSuccess,
} from '../../ingest/reingestService.js';
import type { ListReposResult, RepoEntry } from '../../lmstudio/toolService.js';
import { query, resetStore } from '../../logStore.js';
import { baseLogger } from '../../logger.js';
import type { Conversation } from '../../mongo/conversation.js';
import type { Turn } from '../../mongo/turn.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { attachWs } from '../../ws/server.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

beforeEach(() => {
  memoryConversations.clear();
  memoryTurns.clear();
  installDeterministicCodexAvailabilityBootstrap();
});

afterEach(() => {
  resetDeterministicCodexAvailabilityBootstrap();
  memoryConversations.clear();
  memoryTurns.clear();
  __resetAgentServiceDepsForTests();
});

class MinimalChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class DelayedMinimalChat extends ChatInterface {
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

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows',
);

const makeApp = () => {
  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new MinimalChat(),
        }),
    }),
  );
  return app;
};

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildReingestSuccess = (
  overrides: Partial<
    Pick<
      ReingestSuccess,
      | 'status'
      | 'errorCode'
      | 'sourceId'
      | 'runId'
      | 'resolvedRepositoryId'
      | 'completionMode'
    >
  > = {},
): ReingestSuccess => ({
  status: 'completed',
  operation: 'reembed',
  runId: 'run-123',
  sourceId: '/repo/source-a',
  resolvedRepositoryId: 'repo-a',
  completionMode: 'reingested',
  durationMs: 100,
  files: 3,
  chunks: 7,
  embedded: 7,
  errorCode: null,
  ...overrides,
});

const buildReingestError = (params: {
  message: 'INVALID_PARAMS' | 'NOT_FOUND' | 'BUSY' | 'QUEUE_UNAVAILABLE';
  fieldMessage: string;
}): ReingestError => {
  if (params.message === 'INVALID_PARAMS') {
    return {
      code: -32602,
      message: 'INVALID_PARAMS',
      data: {
        tool: 'reingest_repository',
        code: 'INVALID_SOURCE_ID',
        retryable: true,
        retryMessage: 'retry',
        reingestableRepositoryIds: [],
        reingestableSourceIds: [],
        fieldErrors: [
          {
            field: 'sourceId',
            reason: 'unknown_root',
            message: params.fieldMessage,
          },
        ],
      },
    };
  }

  if (params.message === 'NOT_FOUND') {
    return {
      code: 404,
      message: 'NOT_FOUND',
      data: {
        tool: 'reingest_repository',
        code: 'NOT_FOUND',
        retryable: true,
        retryMessage: 'retry',
        reingestableRepositoryIds: [],
        reingestableSourceIds: [],
        fieldErrors: [
          {
            field: 'sourceId',
            reason: 'unknown_root',
            message: params.fieldMessage,
          },
        ],
      },
    };
  }

  if (params.message === 'QUEUE_UNAVAILABLE') {
    return {
      code: 503,
      message: 'QUEUE_UNAVAILABLE',
      data: {
        tool: 'reingest_repository',
        code: 'QUEUE_UNAVAILABLE',
        retryable: true,
        retryMessage: 'retry',
        reingestableRepositoryIds: [],
        reingestableSourceIds: [],
        fieldErrors: [
          {
            field: 'sourceId',
            reason: 'invalid_state',
            message: params.fieldMessage,
          },
        ],
      },
    };
  }

  return {
    code: 503,
    message: 'QUEUE_UNAVAILABLE',
    data: {
      tool: 'reingest_repository',
      code: 'QUEUE_UNAVAILABLE',
      retryable: true,
      retryMessage: 'retry',
      reingestableRepositoryIds: [],
      reingestableSourceIds: [],
      fieldErrors: [
        {
          field: 'sourceId',
          reason: 'invalid_state',
          message: params.fieldMessage,
        },
      ],
    },
  };
};

const buildRepoEntry = (params: {
  id: string;
  containerPath: string;
  lastIngestAt?: string | null;
}): RepoEntry => ({
  id: params.id,
  description: null,
  containerPath: params.containerPath,
  hostPath: `/host${params.containerPath}`,
  lastIngestAt: params.lastIngestAt ?? null,
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

const listDefaultReingestRepos = async (): Promise<ListReposResult> => ({
  repos: [
    buildRepoEntry({
      id: 'repo-a',
      containerPath: '/repo/source-a',
      lastIngestAt: '2026-04-10T00:00:00.000Z',
    }),
  ],
  lockedModelId: null,
});

async function waitForTurns(
  conversationId: string,
  predicate: (turns: Turn[]) => boolean,
  timeoutMs = 4000,
): Promise<Turn[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const turns = (memoryTurns.get(conversationId) ?? []) as Turn[];
    if (predicate(turns)) return turns;
    await delay(25);
  }
  throw new Error(`Timed out waiting for turns for ${conversationId}`);
}

async function waitForConversationUnlocked(
  conversationId: string,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const acquired = tryAcquireConversationLock(conversationId);
    if (acquired) {
      releaseConversationLock(conversationId);
      return;
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for flow unlock for ${conversationId}`);
}

async function withFlowHarness(
  task: (params: {
    tmpDir: string;
    baseUrl: string;
    ws: WebSocket;
  }) => Promise<void>,
): Promise<void> {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-reingest-'));

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new MinimalChat(),
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
    await task({ tmpDir, baseUrl, ws });
  } finally {
    __resetFlowServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    resetStore();
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    if (prevAgentsHome) {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    } else {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
    memoryConversations.clear();
    memoryTurns.clear();
  }
}

async function writeFlowFile(params: {
  tmpDir: string;
  flowName: string;
  steps: unknown[];
}) {
  await fs.writeFile(
    path.join(params.tmpDir, `${params.flowName}.json`),
    JSON.stringify(
      { description: params.flowName, steps: params.steps },
      null,
      2,
    ),
    'utf8',
  );
}

const makeLlmStep = () => ({
  type: 'llm' as const,
  agentType: 'planning_agent',
  identifier: 'planner',
  messages: [{ role: 'user' as const, content: ['after'] }],
});

const waitForFlowFinal = async (params: {
  ws: WebSocket;
  conversationId: string;
  status: 'ok' | 'failed' | 'stopped';
  timeoutMs?: number;
}) =>
  waitForEvent({
    ws: params.ws,
    predicate: (
      event: unknown,
    ): event is {
      type: 'turn_final';
      status: string;
      error?: { code?: string; message?: string } | null;
    } => {
      const candidate = event as {
        type?: string;
        conversationId?: string;
        status?: string;
      };
      return (
        candidate.type === 'turn_final' &&
        candidate.conversationId === params.conversationId &&
        candidate.status === params.status
      );
    },
    timeoutMs: params.timeoutMs ?? 5000,
  });

const subscribeConversation = (ws: WebSocket, conversationId: string) => {
  sendJson(ws, { type: 'subscribe_conversation', conversationId });
};

test('POST /flows/:flowName/run returns 404 for missing flow file', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-missing-'),
  );
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  const app = makeApp();

  try {
    const res = await supertest(app).post('/flows/missing/run').send({});
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'not_found');
  } finally {
    if (prevAgentsHome) {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    } else {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run returns 400 for invalid flow files', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-invalid-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  const app = makeApp();

  try {
    const invalidJson = await supertest(app)
      .post('/flows/invalid-json/run')
      .send({});
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJson.body.error, 'invalid_request');

    const invalidSchema = await supertest(app)
      .post('/flows/invalid-schema/run')
      .send({});
    assert.equal(invalidSchema.status, 400);
    assert.equal(invalidSchema.body.error, 'invalid_request');
  } finally {
    if (prevAgentsHome) {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    } else {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run returns 400 for non-string customTitle', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-custom-title-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  const app = makeApp();

  try {
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ customTitle: 123 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
  } finally {
    if (prevAgentsHome) {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    } else {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run starts a fresh parent conversation when the selected conversation is archived', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-archived-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  const app = makeApp();
  const conversationId = 'flow-archived-conv-1';

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Flow: llm-basic',
    flowName: 'llm-basic',
    source: 'REST',
    flags: {},
    lastMessageAt: new Date(),
    archivedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ conversationId });
    assert.equal(res.status, 202);
    assert.notEqual(res.body.conversationId, conversationId);
    memoryConversations.delete(res.body.conversationId);
    memoryTurns.delete(res.body.conversationId);
  } finally {
    memoryConversations.delete(conversationId);
    if (prevAgentsHome) {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    } else {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run returns 409 for concurrent runs', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-conflict-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  const app = makeApp();
  const conversationId = 'flow-conflict-conv-1';

  const acquired = tryAcquireConversationLock(conversationId);
  assert.equal(acquired, true);

  try {
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ conversationId });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'conflict');
    assert.equal(res.body.code, 'RUN_IN_PROGRESS');
  } finally {
    releaseConversationLock(conversationId);
    if (prevAgentsHome) {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    } else {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resumed flow run keeps the saved child identity stable when the pinned model becomes unavailable', async () => {
  installDeterministicCodexAvailabilityBootstrap({
    models: [{ model: 'gpt-5.3-codex' }],
  });

  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-unavailable-'),
  );
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const flowConversationId = 'flow-resume-unavailable-conv';
  const childConversationId = 'flow-resume-unavailable-child';

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  await writeFlowFile({
    tmpDir,
    flowName: 'resume-unavailable',
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
  });

  memoryConversations.set(flowConversationId, {
    _id: flowConversationId,
    provider: 'codex',
    model: 'gpt-5.3-codex',
    title: 'Flow: resume-unavailable',
    flowName: 'resume-unavailable',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'resume-unavailable-execution',
        stepPath: [0],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': childConversationId,
        },
        agentThreads: {},
        agentProviders: {
          'coding_agent:resume-test': 'codex',
        },
        agentModels: {
          'coding_agent:resume-test': 'gpt-5.2-codex',
        },
      },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: new Date(),
    archivedAt: null,
  });
  memoryConversations.set(childConversationId, {
    _id: childConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-unavailable (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {
      flowChild: { executionId: 'resume-unavailable-execution' },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: new Date(),
    archivedAt: null,
  });

  const app = makeApp();

  try {
    const response = await supertest(app)
      .post('/flows/resume-unavailable/run')
      .send({ conversationId: flowConversationId, resumeStepPath: [0] });
    assert.equal(response.status, 202);

    await waitForConversationUnlocked(flowConversationId);
    const turns = await waitForTurns(flowConversationId, (items) =>
      items.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'failed' &&
          /Saved model "gpt-5.2-codex" is unavailable/i.test(
            turn.content ?? '',
          ),
      ),
    );
    const failureTurn = turns.find(
      (turn) =>
        turn.role === 'assistant' &&
        turn.status === 'failed' &&
        /Saved model "gpt-5.2-codex" is unavailable/i.test(turn.content ?? ''),
    );
    assert.ok(failureTurn);
    assert.equal(failureTurn.provider, 'codex');
    assert.equal(failureTurn.model, 'gpt-5.3-codex');

    const flowConversation = memoryConversations.get(flowConversationId);
    const childConversation = memoryConversations.get(childConversationId);
    const flowFlags = (flowConversation?.flags ?? {}) as {
      flow?: { agentConversations?: Record<string, string> };
    };

    assert.equal(memoryConversations.has(flowConversationId), true);
    assert.equal(memoryConversations.has(childConversationId), true);
    assert.equal(
      flowFlags.flow?.agentConversations?.['coding_agent:resume-test'],
      childConversationId,
    );
    assert.equal(childConversation?.provider, 'codex');
    assert.equal(childConversation?.model, 'gpt-5.2-codex');
    assert.deepEqual(memoryTurns.get(childConversationId) ?? [], []);
  } finally {
    resetDeterministicCodexAvailabilityBootstrap();
    memoryConversations.delete(flowConversationId);
    memoryTurns.delete(flowConversationId);
    memoryConversations.delete(childConversationId);
    memoryTurns.delete(childConversationId);
    if (prevAgentsHome) {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    } else {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('later markdown-backed llm failures preserve AGENT_NOT_FOUND after flow start and skip markdown resolution', async () => {
  await withFlowHarness(async ({ tmpDir, baseUrl, ws }) => {
    const conversationId = 'flow-markdown-precheck-after-start';
    const flowName = 'markdown-precheck-after-start';
    let markdownReadCount = 0;

    await writeFlowFile({
      tmpDir,
      flowName,
      steps: [
        makeLlmStep(),
        {
          type: 'llm',
          agentType: 'missing_agent',
          identifier: 'missing',
          markdownFile: 'task18/should-not-resolve.md',
        },
      ],
    });

    __setMarkdownFileResolverDepsForTests({
      readFile: async () => {
        markdownReadCount += 1;
        return Buffer.from('should not be read', 'utf8');
      },
    });

    subscribeConversation(ws, conversationId);

    const response = await supertest(baseUrl)
      .post(`/flows/${flowName}/run`)
      .send({ conversationId })
      .expect(202);
    assert.equal(response.body.status, 'started');

    const final = await waitForFlowFinal({
      ws,
      conversationId,
      status: 'failed',
    });
    assert.equal(final.error?.code, 'AGENT_NOT_FOUND');
    assert.match(final.error?.message ?? '', /Agent missing_agent not found/);
    assert.equal(markdownReadCount, 0);

    const turns = await waitForTurns(
      conversationId,
      (items) =>
        items.filter((turn) => turn.role === 'assistant').length >= 2 &&
        items.some(
          (turn) =>
            turn.role === 'assistant' &&
            turn.status === 'failed' &&
            turn.content.includes('Agent missing_agent not found'),
        ),
    );
    const assistantTurns = turns.filter((turn) => turn.role === 'assistant');
    assert.equal(
      assistantTurns.some(
        (turn) => turn.status === 'ok' && turn.content.includes('ok'),
      ),
      true,
    );
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.status === 'failed' &&
          turn.content.includes('Agent missing_agent not found'),
      ),
      true,
    );
  });
});

test('continueOnFailure lets a later llm step run after a terminal llm failure', async (t) => {
  const serverWarnings: Array<{
    context: Record<string, unknown>;
    message: string;
  }> = [];
  t.mock.method(baseLogger, 'warn', (context: unknown, message: unknown) => {
    serverWarnings.push({
      context: (context ?? {}) as Record<string, unknown>,
      message: String(message),
    });
  });

  await withFlowHarness(async ({ tmpDir, baseUrl, ws }) => {
    const conversationId = 'flow-llm-failure-continues';
    const flowName = 'llm-failure-continues';

    await writeFlowFile({
      tmpDir,
      flowName,
      steps: [
        makeLlmStep(),
        {
          type: 'llm',
          agentType: 'missing_agent',
          identifier: 'missing',
          continueOnFailure: true,
          messages: [{ role: 'user', content: ['tolerated failure'] }],
        },
        {
          type: 'llm',
          agentType: 'planning_agent',
          identifier: 'planner',
          messages: [{ role: 'user', content: ['after tolerated failure'] }],
        },
      ],
    });

    subscribeConversation(ws, conversationId);
    await supertest(baseUrl)
      .post(`/flows/${flowName}/run`)
      .send({ conversationId })
      .expect(202);

    await waitForFlowFinal({ ws, conversationId, status: 'ok' });
    const turns = await waitForTurns(
      conversationId,
      (items) =>
        items.some(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('after tolerated failure'),
        ) &&
        items.some(
          (turn) =>
            turn.role === 'assistant' &&
            turn.status === 'failed' &&
            turn.content.includes('Agent missing_agent not found'),
        ),
    );

    assert.equal(
      turns.some(
        (turn) =>
          turn.role === 'user' &&
          turn.content.includes('after tolerated failure'),
      ),
      true,
    );
    assert.equal(
      query({ text: 'flows.run.llm_failure_continued' }).some(
        (entry) => entry.context?.flowName === flowName,
      ),
      true,
    );
    assert.equal(
      serverWarnings.some(
        (entry) =>
          entry.message === 'flows.run.llm_failure_continued' &&
          entry.context.flowName === flowName &&
          entry.context.identifier === 'missing',
      ),
      true,
    );
  });
});

test('dedicated flow reingest terminal error remains non-fatal to later steps', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-error-continues',
      steps: [
        { type: 'reingest', sourceId: '/repo/source-a', label: 'Reingest' },
        makeLlmStep(),
      ],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess({
          status: 'error',
          errorCode: 'INGEST_ERROR',
        }),
      }),
      createCallId: () => 'call-error',
    });

    const result = await startFlowRun({
      flowName: 'reingest-error-continues',
      source: 'REST',
      chatFactory: () => new MinimalChat(),
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 4,
    );
    const reingestAssistant = turns[1] as Turn;
    assert.equal(
      (
        reingestAssistant.toolCalls as {
          calls: Array<{ result: { status: string } }>;
        }
      ).calls[0].result.status,
      'error',
    );
    assert.equal(turns[3]?.content, 'ok');
  });
});

test('dedicated flow reingest terminal cancelled remains non-fatal to later steps', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-cancelled-continues',
      steps: [{ type: 'reingest', sourceId: '/repo/source-a' }, makeLlmStep()],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess({
          status: 'cancelled',
          errorCode: 'USER_CANCELLED',
        }),
      }),
      createCallId: () => 'call-cancelled',
    });

    const result = await startFlowRun({
      flowName: 'reingest-cancelled-continues',
      source: 'REST',
      chatFactory: () => new MinimalChat(),
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 4,
    );
    assert.equal(
      (turns[1]?.toolCalls as { calls: Array<{ result: { status: string } }> })
        .calls[0].result.status,
      'cancelled',
    );
    assert.equal(turns[3]?.content, 'ok');
  });
});

test('accepted skipped outcomes stay on the public completed path for dedicated flow reingest', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-completed-continues',
      steps: [{ type: 'reingest', sourceId: '/repo/source-a' }, makeLlmStep()],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess({ status: 'completed' }),
      }),
      createCallId: () => 'call-completed',
    });

    const result = await startFlowRun({
      flowName: 'reingest-completed-continues',
      source: 'REST',
      chatFactory: () => new MinimalChat(),
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 4,
    );
    assert.equal(
      (turns[1]?.toolCalls as { calls: Array<{ result: { status: string } }> })
        .calls[0].result.status,
      'completed',
    );
    assert.equal(turns[3]?.content, 'ok');
  });
});

test('malformed sourceId stops the dedicated flow reingest step before later steps begin', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-invalid-source',
      steps: [{ type: 'reingest', sourceId: 'relative-path' }, makeLlmStep()],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: false,
        error: buildReingestError({
          message: 'INVALID_PARAMS',
          fieldMessage: 'sourceId must be an absolute path',
        }),
      }),
    });

    const result = await startFlowRun({
      flowName: 'reingest-invalid-source',
      source: 'REST',
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    await waitForFlowFinal({
      ws,
      conversationId: result.conversationId,
      status: 'failed',
    });
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 2,
    );
    assert.equal(turns.length, 2);
    assert.equal(turns[1]?.status, 'failed');
    assert.equal(turns[1]?.toolCalls, null);
  });
});

test('missing working folder stops dedicated flow target working before later steps begin', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-working-missing-folder',
      steps: [{ type: 'reingest', target: 'working' }, makeLlmStep()],
    });

    const result = await startFlowRun({
      flowName: 'reingest-working-missing-folder',
      source: 'REST',
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    const final = await waitForFlowFinal({
      ws,
      conversationId: result.conversationId,
      status: 'failed',
    });
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 2,
    );
    assert.equal(turns.length, 2);
    assert.equal(turns[1]?.status, 'failed');
    assert.match(
      final.error?.message ?? turns[1]?.content ?? '',
      /target "working" requires a selected working repository path/i,
    );
  });
});

test('missing working folder stops dedicated flow target plan_scope before later steps begin', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-plan-scope-missing-folder',
      steps: [{ type: 'reingest', target: 'plan_scope' }, makeLlmStep()],
    });

    const result = await startFlowRun({
      flowName: 'reingest-plan-scope-missing-folder',
      source: 'REST',
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    const final = await waitForFlowFinal({
      ws,
      conversationId: result.conversationId,
      status: 'failed',
    });
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 2,
    );
    assert.equal(turns.length, 2);
    assert.equal(turns[1]?.status, 'failed');
    assert.match(
      final.error?.message ?? turns[1]?.content ?? '',
      /target "plan_scope" requires a selected working repository path/i,
    );
  });
});

test('unknown sourceId stops the dedicated flow reingest step before later steps begin', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-unknown-source',
      steps: [{ type: 'reingest', sourceId: '/repo/unknown' }, makeLlmStep()],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: false,
        error: buildReingestError({
          message: 'NOT_FOUND',
          fieldMessage:
            'sourceId must match an existing ingested repository root exactly',
        }),
      }),
    });

    const result = await startFlowRun({
      flowName: 'reingest-unknown-source',
      source: 'REST',
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    await waitForFlowFinal({
      ws,
      conversationId: result.conversationId,
      status: 'failed',
    });
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 2,
    );
    assert.equal(turns.length, 2);
    assert.equal(turns[1]?.status, 'failed');
  });
});

test('selected working repository must already be ingested for dedicated flow target plan_scope', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    const workingRoot = path.join(tmpDir, 'working-not-ingested');
    await fs.mkdir(workingRoot, { recursive: true });
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-plan-scope-not-ingested',
      steps: [{ type: 'reingest', target: 'plan_scope' }, makeLlmStep()],
    });
    let listCallCount = 0;

    const result = await startFlowRun({
      flowName: 'reingest-plan-scope-not-ingested',
      source: 'REST',
      working_folder: workingRoot,
      listIngestedRepositories: async () => ({
        repos:
          listCallCount++ === 0
            ? [
                buildRepoEntry({
                  id: 'Working Repo',
                  containerPath: workingRoot,
                }),
              ]
            : [],
        lockedModelId: null,
      }),
    });
    subscribeConversation(ws, result.conversationId);
    const final = await waitForFlowFinal({
      ws,
      conversationId: result.conversationId,
      status: 'failed',
    });
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 2,
    );
    assert.equal(turns.length, 2);
    assert.equal(turns[1]?.status, 'failed');
    assert.match(
      final.error?.message ?? turns[1]?.content ?? '',
      /target "plan_scope" selected working repository is not currently ingested/i,
    );
  });
});

test('queue-unavailable reingest refusal stops the dedicated flow clearly', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-busy',
      steps: [{ type: 'reingest', sourceId: '/repo/source-a' }, makeLlmStep()],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: false,
        error: buildReingestError({
          message: 'QUEUE_UNAVAILABLE',
          fieldMessage:
            'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
        }),
      }),
    });

    const result = await startFlowRun({
      flowName: 'reingest-busy',
      source: 'REST',
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    await waitForFlowFinal({
      ws,
      conversationId: result.conversationId,
      status: 'failed',
    });
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 2,
    );
    assert.equal(turns.length, 2);
    assert.equal(turns[1]?.status, 'failed');
  });
});

test('shared prestart formatter fallback stays aligned for dedicated flow failures', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-format-fallback',
      steps: [{ type: 'reingest', sourceId: '/repo/source-a' }, makeLlmStep()],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: false,
        error: buildReingestError({
          message: 'INVALID_PARAMS',
          fieldMessage: '',
        }),
      }),
    });

    const result = await startFlowRun({
      flowName: 'reingest-format-fallback',
      source: 'REST',
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    await waitForFlowFinal({
      ws,
      conversationId: result.conversationId,
      status: 'failed',
    });
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 2,
    );
    assert.equal(turns[1]?.status, 'failed');
    assert.match(turns[1]?.content ?? '', /INVALID_PARAMS: INVALID_SOURCE_ID/);
  });
});

test('Task 19 preserves fallback runtime warnings on successful flow starts', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;

  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'codeinfo_provider = "copilot"',
      'model = "copilot-model"',
      'top_level_unknown = "ignored"',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.3-codex"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-model"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;
  __setAgentServiceDepsForTests({
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
          model: 'gpt-5.3-codex',
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
      available: false,
      toolsAvailable: false,
      blockingStage: 'authentication',
      reason: 'copilot unavailable',
      models: [],
      modelsRaw: [],
      authSource: 'unauthenticated',
    }),
  });

  try {
    await withFlowHarness(async ({ tmpDir }) => {
      await writeFlowFile({
        tmpDir,
        flowName: 'fallback-warning-flow',
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'fallback-warning',
            messages: [{ role: 'user', content: ['after'] }],
          },
        ],
      });

      const result = await startFlowRun({
        flowName: 'fallback-warning-flow',
        source: 'REST',
      });

      assert.equal(
        result.warnings?.some((warning) =>
          warning.includes('Unknown key agent.top_level_unknown'),
        ) ?? false,
        true,
      );
    });
  } finally {
    process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    process.env.CODEINFO_CODEX_AGENT_HOME = previousLegacyAgentHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(copilotHome, { recursive: true, force: true });
  }
});

test('flow start does not surface warnings for supported Codex compatibility keys', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;

  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'model = "gpt-5.4-mini"',
      'model_auto_compact_token_limit = 300000',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'config.toml'),
    [
      'web_search_mode = "disabled"',
      'hide_agent_reasoning = false',
      'model_reasoning_summary = "detailed"',
      '',
      '[features]',
      'fast_mode = false',
      '',
      '[model_providers.lmstudiospark]',
      'name = "lmstudiospark"',
      'base_url = "http://localhost:1234/v1"',
      '',
      '[plugins."github@openai-curated"]',
      'enabled = true',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.3-codex"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-model"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;
  __setAgentServiceDepsForTests({
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
          model: 'gpt-5.3-codex',
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
      available: false,
      toolsAvailable: false,
      blockingStage: 'authentication',
      reason: 'copilot unavailable',
      models: [],
      modelsRaw: [],
      authSource: 'unauthenticated',
    }),
  });

  try {
    await withFlowHarness(async ({ tmpDir }) => {
      await writeFlowFile({
        tmpDir,
        flowName: 'supported-config-flow',
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'supported-config-warning-check',
            messages: [{ role: 'user', content: ['after'] }],
          },
        ],
      });

      const result = await startFlowRun({
        flowName: 'supported-config-flow',
        source: 'REST',
      });

      const warningsText = result.warnings?.join('\n') ?? '';
      assert.equal(
        /Unknown key agent\.(web_search_mode|model_auto_compact_token_limit|hide_agent_reasoning|model_reasoning_summary|model_provider|model_providers|plugins)/u.test(
          warningsText,
        ),
        false,
      );
      assert.equal(
        /Unknown key agent\.features\.fast_mode/u.test(warningsText),
        false,
      );
    });
  } finally {
    process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    process.env.CODEINFO_CODEX_AGENT_HOME = previousLegacyAgentHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(copilotHome, { recursive: true, force: true });
  }
});

test('flow run start payload keeps providerId, warnings, and machine-readable launch truth on the first response', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;

  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-home-'));
  const flowsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['codeinfo_provider = "bad-provider"', 'model = "copilot-model"', ''].join(
      '\n',
    ),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.3-codex"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-model"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;
  process.env.FLOWS_DIR = flowsDir;
  __setAgentServiceDepsForTests({
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
          model: 'gpt-5.3-codex',
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
      available: false,
      toolsAvailable: false,
      blockingStage: 'authentication',
      reason: 'copilot unavailable',
      models: [],
      modelsRaw: [],
      authSource: 'unauthenticated',
    }),
  });

  try {
    await writeFlowFile({
      tmpDir: flowsDir,
      flowName: 'task26-flow-warning-start',
      steps: [
        {
          type: 'llm',
          agentType: 'coding_agent',
          identifier: 'warning-start',
          messages: [{ role: 'user', content: ['after'] }],
        },
      ],
    });

    const response = await supertest(makeApp())
      .post('/flows/task26-flow-warning-start/run')
      .send({})
      .expect(202);

    assert.equal(response.body.status, 'started');
    assert.equal(response.body.providerId, 'codex');
    assert.equal(response.body.modelId, 'gpt-5.3-codex');
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes('unsupported provider "bad-provider"'),
      ),
      true,
    );
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes('fallback provider "codex"'),
      ),
      true,
    );
  } finally {
    process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    process.env.CODEINFO_CODEX_AGENT_HOME = previousLegacyAgentHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    process.env.FLOWS_DIR = previousFlowsDir;
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(copilotHome, { recursive: true, force: true });
    await fs.rm(flowsDir, { recursive: true, force: true });
  }
});

test('Task 25 flow starts fall back to the same provider native path before cross-provider fallback when the configured endpoint is unavailable', async () => {
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const externalServer = await startExternalOpenAiCompatServer({
    responseMode: 'transport-failure',
  });
  const endpointId = `${externalServer.baseUrl}/v1`;

  try {
    await withFlowHarness(async ({ tmpDir, baseUrl }) => {
      const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
      const previousLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
      const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
      const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
      const agentsHome = await fs.mkdtemp(
        path.join(os.tmpdir(), 'agents-home-'),
      );
      const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
      const copilotHome = await fs.mkdtemp(
        path.join(os.tmpdir(), 'copilot-home-'),
      );
      const agentHome = path.join(agentsHome, 'coding_agent');

      await fs.mkdir(agentHome, { recursive: true });
      await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
      await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
      await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
      await fs.writeFile(
        path.join(agentHome, 'config.toml'),
        [
          'codeinfo_provider = "copilot"',
          'model = "copilot-gpt-5"',
          `codeinfo_openai_endpoint = "${endpointId}|responses,completions"`,
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
      await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        path.join(codexHome, 'chat', 'config.toml'),
        'model = "gpt-5.3-codex"\n',
        'utf8',
      );
      await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
      await fs.writeFile(
        path.join(copilotHome, 'chat', 'config.toml'),
        'model = "copilot-gpt-5"\n',
        'utf8',
      );

      process.env.CODEINFO_AGENT_HOME = agentsHome;
      process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
      process.env.CODEINFO_CODEX_HOME = codexHome;
      process.env.CODEINFO_COPILOT_HOME = copilotHome;
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = `${endpointId}|responses,completions`;
      __setAgentServiceDepsForTests({
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
              model: 'gpt-5.3-codex',
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
          reason: undefined,
          models: ['copilot-gpt-5'],
          modelsRaw: [
            {
              id: 'copilot-gpt-5',
              name: 'Copilot GPT-5',
              capabilities: {
                supports: { vision: false, reasoningEffort: false },
                limits: { max_context_window_tokens: 128000 },
              },
            },
          ],
          authSource: 'env-token',
        }),
      });

      try {
        await writeFlowFile({
          tmpDir,
          flowName: 'task25-flow-endpoint-native-fallback',
          steps: [
            {
              type: 'llm',
              agentType: 'coding_agent',
              identifier: 'endpoint-native-fallback',
              messages: [{ role: 'user', content: ['after'] }],
            },
          ],
        });

        const response = await supertest(baseUrl)
          .post('/flows/task25-flow-endpoint-native-fallback/run')
          .send({})
          .expect(202);

        assert.equal(response.body.status, 'started');
        assert.equal(response.body.providerId, 'copilot');
        assert.equal(response.body.modelId, 'copilot-gpt-5');
        assert.equal(
          response.body.warnings.some((warning: string) =>
            warning.includes(
              `Endpoint "${endpointId}" was unavailable; falling back to native copilot model "copilot-gpt-5".`,
            ),
          ),
          true,
        );
      } finally {
        __resetAgentServiceDepsForTests();
        if (previousAgentHome === undefined) {
          delete process.env.CODEINFO_AGENT_HOME;
        } else {
          process.env.CODEINFO_AGENT_HOME = previousAgentHome;
        }
        if (previousLegacyAgentHome === undefined) {
          delete process.env.CODEINFO_CODEX_AGENT_HOME;
        } else {
          process.env.CODEINFO_CODEX_AGENT_HOME = previousLegacyAgentHome;
        }
        if (previousCodexHome === undefined) {
          delete process.env.CODEINFO_CODEX_HOME;
        } else {
          process.env.CODEINFO_CODEX_HOME = previousCodexHome;
        }
        if (previousCopilotHome === undefined) {
          delete process.env.CODEINFO_COPILOT_HOME;
        } else {
          process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
        }
        await fs.rm(agentsHome, { recursive: true, force: true });
        await fs.rm(codexHome, { recursive: true, force: true });
        await fs.rm(copilotHome, { recursive: true, force: true });
      }
    });
  } finally {
    await externalServer.stop();
    if (previousCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        previousCompatEndpoints;
    }
  }
});

test('flow run survives provider-specific runtime-config failure by falling back before runtime load', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;

  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-home-'));
  const flowsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['codeinfo_provider = "copilot"', 'model = "copilot-gpt-5"', ''].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.3-codex"\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(copilotHome, 'config.toml'),
    'tool_access = [\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;
  process.env.FLOWS_DIR = flowsDir;
  __setAgentServiceDepsForTests({
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
          model: 'gpt-5.3-codex',
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
      reason: undefined,
      models: ['copilot-gpt-5'],
      modelsRaw: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });

  try {
    await writeFlowFile({
      tmpDir: flowsDir,
      flowName: 'task30-flow-provider-runtime-fallback',
      steps: [
        {
          type: 'llm',
          agentType: 'coding_agent',
          identifier: 'provider-runtime-fallback',
          messages: [{ role: 'user', content: ['after'] }],
        },
      ],
    });

    const response = await supertest(makeApp())
      .post('/flows/task30-flow-provider-runtime-fallback/run')
      .send({})
      .expect(202);

    assert.equal(response.body.status, 'started');
    assert.equal(response.body.providerId, 'codex');
    assert.equal(
      memoryConversations.get(response.body.conversationId)?.provider,
      'codex',
    );
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes(
          'requested provider "copilot" because its runtime config could not load',
        ),
      ),
      true,
    );
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes('fallback provider "codex"'),
      ),
      true,
    );
  } finally {
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousLegacyAgentHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousLegacyAgentHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    if (previousCopilotHome === undefined) {
      delete process.env.CODEINFO_COPILOT_HOME;
    } else {
      process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    }
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(copilotHome, { recursive: true, force: true });
    await fs.rm(flowsDir, { recursive: true, force: true });
  }
});

test('flow run fails clearly when no fallback provider can execute after requested runtime-config failure', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;

  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-home-'));
  const flowsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['codeinfo_provider = "copilot"', 'model = "copilot-gpt-5"', ''].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.3-codex"\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(copilotHome, 'config.toml'),
    'tool_access = [\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;
  process.env.FLOWS_DIR = flowsDir;
  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: false,
      authPresent: false,
      configPresent: false,
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
      reason: undefined,
      models: ['copilot-gpt-5'],
      modelsRaw: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });

  try {
    await writeFlowFile({
      tmpDir: flowsDir,
      flowName: 'task30-flow-provider-runtime-unavailable',
      steps: [
        {
          type: 'llm',
          agentType: 'coding_agent',
          identifier: 'provider-runtime-unavailable',
          messages: [{ role: 'user', content: ['after'] }],
        },
      ],
    });

    const response = await supertest(makeApp())
      .post('/flows/task30-flow-provider-runtime-unavailable/run')
      .send({})
      .expect(503);

    assert.equal(response.body.error, 'provider_unavailable');
    assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
    assert.match(
      String(response.body.reason),
      /runtime config could not load/i,
    );
  } finally {
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousLegacyAgentHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousLegacyAgentHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    if (previousCopilotHome === undefined) {
      delete process.env.CODEINFO_COPILOT_HOME;
    } else {
      process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    }
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(copilotHome, { recursive: true, force: true });
    await fs.rm(flowsDir, { recursive: true, force: true });
  }
});

test('pre-launch persistence failure clears stale retry ownership for later legitimate fresh runs', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'retry-ownership-persist-fails',
      steps: [makeLlmStep()],
    });
    const originalSet = memoryConversations.set;
    let failedConversationId = '';

    // Override memoryConversations.set to throw when the flow flag is being set.
    memoryConversations.set = ((key: string, value: Conversation) => {
      if (
        value?.flags &&
        Object.prototype.hasOwnProperty.call(value.flags, 'flow')
      ) {
        throw new Error('boom');
      }
      return originalSet.call(memoryConversations, key, value);
    }) as typeof memoryConversations.set;

    try {
      await assert.rejects(
        startFlowRun({
          flowName: 'retry-ownership-persist-fails',
          source: 'REST',
          retryOwnershipId: 'fresh-run-retry-1',
          chatFactory: () => new MinimalChat(),
          onOwnershipReady: ({ conversationId }) => {
            failedConversationId = conversationId;
            // Pre-create a memory conversation so the subsequent flow-state save will attempt an update that triggers our override.
            originalSet.call(memoryConversations, conversationId, {
              _id: conversationId,
              provider: 'codex',
              model: 'gpt-5.1-codex-max',
              title: 'retry-ownership-persist-fails',
              flowName: 'retry-ownership-persist-fails',
              source: 'REST',
              flags: {},
              lastMessageAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
              archivedAt: null,
            });
          },
        }),
        /boom/i,
      );
    } finally {
      // Restore original Map.set implementation
      memoryConversations.set = originalSet;
    }

    const retryResult = await startFlowRun({
      flowName: 'retry-ownership-persist-fails',
      source: 'REST',
      retryOwnershipId: 'fresh-run-retry-1',
      chatFactory: () => new MinimalChat(),
    });
    subscribeConversation(ws, retryResult.conversationId);
    await waitForFlowFinal({
      ws,
      conversationId: retryResult.conversationId,
      status: 'ok',
    });
    const turns = await waitForTurns(
      retryResult.conversationId,
      (items) => items.length >= 2,
    );
    assert.equal(turns.length, 2);
    assert.notEqual(retryResult.conversationId, failedConversationId);
  });
});

test('in-flight retryOwnershipId dedupe returns the same fresh-run launch while the first run is still active', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'retry-ownership-inflight-dedupe',
      steps: [makeLlmStep()],
    });

    const firstResult = await startFlowRun({
      flowName: 'retry-ownership-inflight-dedupe',
      source: 'REST',
      retryOwnershipId: 'fresh-run-retry-1',
      chatFactory: () => new DelayedMinimalChat(100),
    });
    subscribeConversation(ws, firstResult.conversationId);

    const secondResult = await startFlowRun({
      flowName: 'retry-ownership-inflight-dedupe',
      source: 'REST',
      retryOwnershipId: 'fresh-run-retry-1',
      chatFactory: () => new DelayedMinimalChat(100),
    });

    assert.deepEqual(secondResult, firstResult);
    await waitForFlowFinal({
      ws,
      conversationId: firstResult.conversationId,
      status: 'ok',
    });
    const turns = await waitForTurns(
      firstResult.conversationId,
      (items) => items.length >= 2,
    );
    assert.equal(turns.length, 2);
  });
});

test('same-process completed retryOwnershipId replay reuses the earlier fresh-run launch after inflight cleanup', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'retry-ownership-post-complete-replay',
      steps: [makeLlmStep()],
    });

    const firstResult = await startFlowRun({
      flowName: 'retry-ownership-post-complete-replay',
      source: 'REST',
      retryOwnershipId: 'fresh-run-retry-1',
      chatFactory: () => new MinimalChat(),
    });
    subscribeConversation(ws, firstResult.conversationId);
    await waitForFlowFinal({
      ws,
      conversationId: firstResult.conversationId,
      status: 'ok',
    });
    await waitForConversationUnlocked(firstResult.conversationId);

    const replayResult = await startFlowRun({
      flowName: 'retry-ownership-post-complete-replay',
      source: 'REST',
      retryOwnershipId: 'fresh-run-retry-1',
      chatFactory: () => new MinimalChat(),
    });

    assert.deepEqual(replayResult, firstResult);
    await delay(150);
    assert.equal((memoryTurns.get(firstResult.conversationId) ?? []).length, 2);
  });
});

test('post-success retry completion write failure is retried before ownership release and survives local barrier loss', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'retry-completion-persist-retry',
      steps: [makeLlmStep()],
    });
    const originalSet = memoryConversations.set;
    let injectedFailure = false;
    memoryConversations.set = ((key: string, value: Conversation) => {
      const flow = value.flags?.flow as
        | { retryOwnershipCompletion?: unknown }
        | undefined;
      if (!injectedFailure && flow?.retryOwnershipCompletion) {
        injectedFailure = true;
        throw new Error('post-success completion write failed once');
      }
      return originalSet.call(memoryConversations, key, value);
    }) as typeof memoryConversations.set;

    try {
      const firstResult = await startFlowRun({
        flowName: 'retry-completion-persist-retry',
        source: 'REST',
        retryOwnershipId: 'fresh-run-retry-persisted',
        chatFactory: () => new MinimalChat(),
      });
      subscribeConversation(ws, firstResult.conversationId);
      await waitForFlowFinal({
        ws,
        conversationId: firstResult.conversationId,
        status: 'ok',
      });
      await waitForConversationUnlocked(firstResult.conversationId);
      assert.equal(injectedFailure, true);
      assert.ok(
        memoryConversations.get(firstResult.conversationId)?.flags?.flow
          ?.retryOwnershipCompletion,
      );

      __resetFreshRunRetryOwnershipCompletionForTests();
      const replayResult = await startFlowRun({
        flowName: 'retry-completion-persist-retry',
        source: 'REST',
        retryOwnershipId: 'fresh-run-retry-persisted',
        chatFactory: () => new MinimalChat(),
      });
      assert.deepEqual(replayResult, firstResult);
      await delay(150);
      assert.equal(
        (memoryTurns.get(firstResult.conversationId) ?? []).length,
        2,
      );
    } finally {
      memoryConversations.set = originalSet;
    }
  });
});

test('completed retryOwnershipId replay rejects a contradictory fresh-run launch after the earlier result has been accepted', async () => {
  await withFlowHarness(async ({ tmpDir, baseUrl, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'retry-ownership-contradiction',
      steps: [makeLlmStep()],
    });

    const acceptedTitle = 'Accepted Replay Launch';
    const firstResult = await startFlowRun({
      flowName: 'retry-ownership-contradiction',
      source: 'REST',
      retryOwnershipId: 'fresh-run-retry-1',
      customTitle: acceptedTitle,
      chatFactory: () => new MinimalChat(),
    });
    subscribeConversation(ws, firstResult.conversationId);
    await waitForFlowFinal({
      ws,
      conversationId: firstResult.conversationId,
      status: 'ok',
    });
    await waitForConversationUnlocked(firstResult.conversationId);

    const conflictingResponse = await supertest(baseUrl)
      .post('/flows/retry-ownership-contradiction/run')
      .send({
        retryOwnershipId: 'fresh-run-retry-1',
        customTitle: 'Contradictory Replay Launch',
      });

    assert.equal(conflictingResponse.status, 400);
    assert.equal(conflictingResponse.body.error, 'invalid_request');
    assert.equal(conflictingResponse.body.code, 'INVALID_REQUEST');
    assert.equal(
      memoryConversations.get(firstResult.conversationId)?.title,
      acceptedTitle,
    );
  });
});

test('distinct retryOwnershipId values still launch a fresh run after the earlier completion barrier is written', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'retry-ownership-new-request',
      steps: [makeLlmStep()],
    });

    const firstResult = await startFlowRun({
      flowName: 'retry-ownership-new-request',
      source: 'REST',
      retryOwnershipId: 'fresh-run-retry-1',
      customTitle: 'First Fresh Request',
      chatFactory: () => new MinimalChat(),
    });
    subscribeConversation(ws, firstResult.conversationId);
    await waitForFlowFinal({
      ws,
      conversationId: firstResult.conversationId,
      status: 'ok',
    });
    await waitForConversationUnlocked(firstResult.conversationId);

    const secondResult = await startFlowRun({
      flowName: 'retry-ownership-new-request',
      source: 'REST',
      retryOwnershipId: 'fresh-run-retry-2',
      customTitle: 'Second Fresh Request',
      chatFactory: () => new MinimalChat(),
    });
    subscribeConversation(ws, secondResult.conversationId);
    await waitForFlowFinal({
      ws,
      conversationId: secondResult.conversationId,
      status: 'ok',
    });
    await waitForConversationUnlocked(secondResult.conversationId);

    assert.notEqual(secondResult.conversationId, firstResult.conversationId);
    assert.equal((memoryTurns.get(firstResult.conversationId) ?? []).length, 2);
    assert.equal(
      (memoryTurns.get(secondResult.conversationId) ?? []).length,
      2,
    );
  });
});

test('stop during the blocking wait keeps later flow steps from executing', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-stop-after-return',
      steps: [{ type: 'reingest', sourceId: '/repo/source-a' }, makeLlmStep()],
    });
    let resolveRun!: (value: { ok: true; value: ReingestSuccess }) => void;
    const runPromise = new Promise<{ ok: true; value: ReingestSuccess }>(
      (resolve) => {
        resolveRun = resolve;
      },
    );

    __setFlowServiceDepsForTests({
      runReingestRepository: async () => runPromise,
      createCallId: () => 'call-stop',
    });

    const conversationId = 'flow-reingest-stop-after-return';
    const result = await startFlowRun({
      flowName: 'reingest-stop-after-return',
      conversationId,
      source: 'REST',
      listIngestedRepositories: listDefaultReingestRepos,
      onOwnershipReady: ({ runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken,
        });
      },
    });
    subscribeConversation(ws, result.conversationId);

    resolveRun({ ok: true, value: buildReingestSuccess() });

    await waitForConversationUnlocked(result.conversationId);
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 2,
    );
    assert.equal(turns[1]?.status, 'ok');
    assert.equal(
      (turns[1]?.toolCalls as { calls: Array<{ callId: string }> }).calls[0]
        .callId,
      'call-stop',
    );
    assert.equal(
      turns.some((turn) => (turn.content ?? '').trim() === 'ok'),
      false,
    );
  });
});

test('timeout terminal results stay structured as nested dedicated flow reingest errors', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-timeout-structured',
      steps: [{ type: 'reingest', sourceId: '/repo/source-a' }, makeLlmStep()],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess({
          status: 'error',
          errorCode: 'WAIT_TIMEOUT',
        }),
      }),
      createCallId: () => 'call-timeout',
    });

    const result = await startFlowRun({
      flowName: 'reingest-timeout-structured',
      source: 'REST',
      chatFactory: () => new MinimalChat(),
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 4,
    );
    const payload = (
      turns[1]?.toolCalls as {
        calls: Array<{ result: { status: string; errorCode: string | null } }>;
      }
    ).calls[0].result;
    assert.equal(payload.status, 'error');
    assert.equal(payload.errorCode, 'WAIT_TIMEOUT');
  });
});

test('missing-run terminal results stay structured as nested dedicated flow reingest errors', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-missing-structured',
      steps: [{ type: 'reingest', sourceId: '/repo/source-a' }, makeLlmStep()],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess({
          status: 'error',
          errorCode: 'RUN_STATUS_MISSING',
        }),
      }),
      createCallId: () => 'call-missing',
    });

    const result = await startFlowRun({
      flowName: 'reingest-missing-structured',
      source: 'REST',
      chatFactory: () => new MinimalChat(),
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 4,
    );
    const payload = (
      turns[1]?.toolCalls as {
        calls: Array<{ result: { errorCode: string | null } }>;
      }
    ).calls[0].result;
    assert.equal(payload.errorCode, 'RUN_STATUS_MISSING');
  });
});

test('unknown terminal results stay structured as nested dedicated flow reingest errors', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-unknown-terminal',
      steps: [{ type: 'reingest', sourceId: '/repo/source-a' }, makeLlmStep()],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess({
          status: 'error',
          errorCode: 'UNKNOWN_TERMINAL_STATE',
        }),
      }),
      createCallId: () => 'call-unknown',
    });

    const result = await startFlowRun({
      flowName: 'reingest-unknown-terminal',
      source: 'REST',
      chatFactory: () => new MinimalChat(),
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 4,
    );
    const payload = (
      turns[1]?.toolCalls as {
        calls: Array<{ result: { errorCode: string | null } }>;
      }
    ).calls[0].result;
    assert.equal(payload.errorCode, 'UNKNOWN_TERMINAL_STATE');
  });
});

test('flows containing only dedicated reingest steps start with the fallback model path', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-only-flow',
      steps: [
        {
          type: 'reingest',
          sourceId: '/repo/source-a',
          label: 'Only reingest',
        },
      ],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess(),
      }),
      createCallId: () => 'call-only',
    });

    const result = await startFlowRun({
      flowName: 'reingest-only-flow',
      source: 'REST',
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    assert.equal(result.modelId, 'gpt-5.6-sol');
    await waitForFlowFinal({
      ws,
      conversationId: result.conversationId,
      status: 'ok',
    });
    const conversation = memoryConversations.get(result.conversationId);
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 2,
    );
    assert.equal(conversation?.model, 'gpt-5.6-sol');
    assert.equal(turns[0]?.model, 'gpt-5.6-sol');
    assert.equal(turns[1]?.model, 'gpt-5.6-sol');
  });
});

test('dedicated reingest steps publish live and persisted flow metadata without fake agent fields', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-metadata',
      steps: [
        { type: 'reingest', sourceId: '/repo/source-a', label: 'Refresh repo' },
      ],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess(),
      }),
      createCallId: () => 'call-metadata',
    });

    const result = await startFlowRun({
      flowName: 'reingest-metadata',
      source: 'REST',
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    const snapshot = await waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'inflight_snapshot';
        inflight: { command?: Record<string, unknown> };
      } => {
        const candidate = event as {
          type?: string;
          conversationId?: string;
          inflight?: { command?: Record<string, unknown> };
        };
        return (
          candidate.type === 'inflight_snapshot' &&
          candidate.conversationId === result.conversationId &&
          Boolean(candidate.inflight?.command)
        );
      },
      timeoutMs: 5000,
    });

    await waitForFlowFinal({
      ws,
      conversationId: result.conversationId,
      status: 'ok',
    });
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 2,
    );
    const persistedCommand = turns[1]?.command as Record<string, unknown>;
    const liveCommand = snapshot.inflight.command as Record<string, unknown>;

    assert.deepEqual(liveCommand, {
      name: 'flow',
      stepIndex: 1,
      totalSteps: 1,
      loopDepth: 0,
      label: 'Refresh repo',
    });
    assert.deepEqual(persistedCommand, liveCommand);
    assert.equal('agentType' in persistedCommand, false);
    assert.equal('identifier' in persistedCommand, false);

    const logs = query(
      { text: 'DEV-0000045:T10:flow_reingest_step_recorded' },
      10,
    );
    assert.equal(
      logs.some(
        (item) =>
          item.message === 'DEV-0000045:T10:flow_reingest_step_recorded',
      ),
      true,
    );
  });
});

test('multiple dedicated reingest steps targeting the same sourceId keep distinct callIds', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-double',
      steps: [
        { type: 'reingest', sourceId: '/repo/source-a' },
        { type: 'reingest', sourceId: '/repo/source-a' },
      ],
    });
    const callIds = ['call-a', 'call-b'];
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess(),
      }),
      createCallId: () => {
        const next = callIds.shift();
        if (!next) throw new Error('missing callId');
        return next;
      },
    });

    const result = await startFlowRun({
      flowName: 'reingest-double',
      source: 'REST',
      listIngestedRepositories: listDefaultReingestRepos,
    });
    subscribeConversation(ws, result.conversationId);
    await waitForFlowFinal({
      ws,
      conversationId: result.conversationId,
      status: 'ok',
    });
    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 4,
    );
    const assistantTurns = turns.filter((turn) => turn.role === 'assistant');
    assert.deepEqual(
      assistantTurns.map(
        (turn) =>
          (turn.toolCalls as { calls: Array<{ callId: string }> }).calls[0]
            .callId,
      ),
      ['call-a', 'call-b'],
    );
  });
});
