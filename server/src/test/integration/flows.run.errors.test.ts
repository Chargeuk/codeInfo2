import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';
import type WebSocket from 'ws';

import {
  tryAcquireConversationLock,
  releaseConversationLock,
} from '../../agents/runLock.js';
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
import { startFlowRun } from '../../flows/service.js';
import {
  __resetFlowServiceDepsForTests,
  __setFlowServiceDepsForTests,
} from '../../flows/service.js';
import type {
  ReingestError,
  ReingestSuccess,
} from '../../ingest/reingestService.js';
import { query, resetStore } from '../../logStore.js';
import type { Turn } from '../../mongo/turn.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { attachWs } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

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
  message: 'INVALID_PARAMS' | 'NOT_FOUND' | 'BUSY';
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

  return {
    code: 429,
    message: 'BUSY',
    data: {
      tool: 'reingest_repository',
      code: 'BUSY',
      retryable: true,
      retryMessage: 'retry',
      reingestableRepositoryIds: [],
      reingestableSourceIds: [],
      fieldErrors: [
        {
          field: 'sourceId',
          reason: 'busy',
          message: params.fieldMessage,
        },
      ],
    },
  };
};

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

test('POST /flows/:flowName/run returns 410 when conversation is archived', async () => {
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
    assert.equal(res.status, 410);
    assert.equal(res.body.error, 'archived');
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

test('busy reingest refusal stops the dedicated flow clearly', async () => {
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
          message: 'BUSY',
          fieldMessage:
            'reingest is currently locked by another ingest operation',
        }),
      }),
    });

    const result = await startFlowRun({
      flowName: 'reingest-busy',
      source: 'REST',
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

test('unexpected thrown exceptions fail the current dedicated flow', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-throws',
      steps: [{ type: 'reingest', sourceId: '/repo/source-a' }, makeLlmStep()],
    });
    __setFlowServiceDepsForTests({
      runReingestRepository: async () => {
        throw new Error('boom');
      },
    });

    const result = await startFlowRun({
      flowName: 'reingest-throws',
      source: 'REST',
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
    assert.match(turns[1]?.content ?? '', /boom/i);
  });
});

test('stop during the blocking wait prevents the next flow step from starting', async () => {
  await withFlowHarness(async ({ tmpDir, ws }) => {
    await writeFlowFile({
      tmpDir,
      flowName: 'reingest-stop-after-return',
      steps: [{ type: 'reingest', sourceId: '/repo/source-a' }, makeLlmStep()],
    });
    let resolveRun!: (value: { ok: true; value: ReingestSuccess }) => void;
    let runToken = '';
    const runPromise = new Promise<{ ok: true; value: ReingestSuccess }>(
      (resolve) => {
        resolveRun = resolve;
      },
    );

    __setFlowServiceDepsForTests({
      runReingestRepository: async () => runPromise,
      createCallId: () => 'call-stop',
    });

    const result = await startFlowRun({
      flowName: 'reingest-stop-after-return',
      source: 'REST',
      onOwnershipReady: ({ runToken: token }) => {
        runToken = token;
      },
    });
    subscribeConversation(ws, result.conversationId);

    registerPendingConversationCancel({
      conversationId: result.conversationId,
      runToken,
    });
    resolveRun({ ok: true, value: buildReingestSuccess() });

    const turns = await waitForTurns(
      result.conversationId,
      (items) => items.length >= 2,
    );
    await delay(100);
    assert.equal(turns.length, 2);
    assert.equal(turns[1]?.status, 'ok');
    assert.equal(
      (turns[1]?.toolCalls as { calls: Array<{ callId: string }> }).calls[0]
        .callId,
      'call-stop',
    );
    assert.equal((memoryTurns.get(result.conversationId) ?? []).length, 2);
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
    });
    subscribeConversation(ws, result.conversationId);
    assert.equal(result.modelId, 'gpt-5.1-codex-max');
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
    assert.equal(conversation?.model, 'gpt-5.1-codex-max');
    assert.equal(turns[0]?.model, 'gpt-5.1-codex-max');
    assert.equal(turns[1]?.model, 'gpt-5.1-codex-max');
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
