import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
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
      .send({ conversationId })
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
    assert.equal(conversation?.title, 'Flow: llm-basic');
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
