import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { startFlowRun } from '../../flows/service.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { attachWs } from '../../ws/server.js';
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

test('POST /flows/:flowName/run starts a flow run and streams events', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const fixturesDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../fixtures/flows',
  );
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-run-'));
  await fs.cp(fixturesDir, tmpDir, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new StreamingChat(),
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

  const conversationId = 'flow-basic-conv-1';
  const customTitle = 'Custom Flow Title';

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const userTurnPromise = waitForEvent({
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

    const deltaPromise = waitForEvent({
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

    const finalPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is { type: 'turn_final'; status: string } => {
        const e = event as { type?: string; conversationId?: string };
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 8000,
    });

    const res = await supertest(baseUrl)
      .post('/flows/llm-basic/run')
      .send({ conversationId, customTitle })
      .expect(202);

    assert.equal(res.body.status, 'started');
    assert.equal(res.body.flowName, 'llm-basic');
    assert.equal(res.body.conversationId, conversationId);
    assert.equal(typeof res.body.inflightId, 'string');
    assert.equal(typeof res.body.modelId, 'string');

    const userTurn = await userTurnPromise;
    const delta = await deltaPromise;
    assert.equal(userTurn.inflightId, delta.inflightId);

    const final = await finalPromise;
    assert.equal(final.status, 'ok');

    const conversation = memoryConversations.get(conversationId);
    assert.ok(conversation);
    assert.equal(conversation?.title, customTitle);
    assert.equal(conversation?.flowName, 'llm-basic');
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run ignores whitespace customTitle', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const fixturesDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../fixtures/flows',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-whitespace-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new StreamingChat(),
        }),
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
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run returns 404 for unknown sourceId', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-unknown-source-'),
  );
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry('/data/known-repo')],
            lockedModelId: null,
          }),
        }),
    }),
  );

  try {
    await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ sourceId: '/data/unknown-repo' })
      .expect(404);
  } finally {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run fails on invalid agent config supported key types (resolver regression guard)', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
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

  process.env.CODEINFO_CODEX_AGENT_HOME = tmpAgentsHome;
  process.env.FLOWS_DIR = tmpFlowsDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
        }),
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
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpFlowsDir, { recursive: true, force: true });
    await fs.rm(tmpAgentsHome, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run uses ingested flow when sourceId provided', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpLocalDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-local-'),
  );
  const tmpRepoRoot = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-ingested-'),
  );
  const tmpRepoFlows = path.join(tmpRepoRoot, 'flows');
  await fs.mkdir(tmpRepoFlows, { recursive: true });
  await fs.cp(fixturesDir, tmpRepoFlows, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpLocalDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(tmpRepoRoot)],
            lockedModelId: null,
          }),
        }),
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
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpLocalDir, { recursive: true, force: true });
    await fs.rm(tmpRepoRoot, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run resolves sourceId with legacy alias payloads', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpLocalDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-local-legacy-'),
  );
  const tmpRepoRoot = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-ingested-legacy-'),
  );
  const tmpRepoFlows = path.join(tmpRepoRoot, 'flows');
  await fs.mkdir(tmpRepoFlows, { recursive: true });
  await fs.cp(fixturesDir, tmpRepoFlows, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpLocalDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [
              {
                id: 'Legacy',
                description: null,
                containerPath: tmpRepoRoot,
                hostPath: tmpRepoRoot,
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
    }),
  );

  try {
    const conversationId = 'flow-ingested-conv-legacy';
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ conversationId, sourceId: tmpRepoRoot })
      .expect(202);

    assert.equal(res.body.status, 'started');
    assert.equal(res.body.flowName, 'llm-basic');
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  } finally {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpLocalDir, { recursive: true, force: true });
    await fs.rm(tmpRepoRoot, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run uses local flows when sourceId omitted', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
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

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpLocalDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(tmpRepoRoot)],
            lockedModelId: null,
          }),
        }),
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
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpLocalDir, { recursive: true, force: true });
    await fs.rm(tmpRepoRoot, { recursive: true, force: true });
  }
});
