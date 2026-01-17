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
import type { TurnSummary } from '../../mongo/repo.js';
import { createConversationsRouter } from '../../routes/conversations.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { attachWs } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class SlowChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _flags;
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('token', { type: 'token', content: 'Hi' });
    await delay(1500);
    this.emit('final', { type: 'final', content: 'Hello flow' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const listTurnsFromMemory = (conversationId: string): TurnSummary[] => {
  const turns = memoryTurns.get(conversationId) ?? [];
  return turns.map((turn, index) => ({
    turnId: (() => {
      const stored = (turn as { turnId?: unknown }).turnId;
      return typeof stored === 'string' && stored.length > 0
        ? stored
        : String(index);
    })(),
    conversationId: turn.conversationId,
    role: turn.role,
    content: turn.content,
    model: turn.model,
    provider: turn.provider,
    source: turn.source ?? 'REST',
    toolCalls: turn.toolCalls ?? null,
    status: turn.status,
    command: turn.command,
    usage: turn.usage,
    timing: turn.timing,
    createdAt: turn.createdAt ?? new Date(),
  }));
};

test('flow turns include command metadata in snapshots and history', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-meta-'));

  const flow = {
    description: 'Metadata flow',
    steps: [
      {
        type: 'llm',
        agentType: 'coding_agent',
        identifier: 'flow-meta',
        messages: [{ role: 'user', content: ['Hello'] }],
      },
    ],
  };
  await fs.writeFile(
    path.join(tmpDir, 'flow-metadata.json'),
    JSON.stringify(flow, null, 2),
  );

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new SlowChat(),
        }),
    }),
  );
  app.use(
    createConversationsRouter({
      findConversationById: async (id) => {
        const convo = memoryConversations.get(id);
        if (!convo) return null;
        return {
          _id: String(convo._id ?? id),
          archivedAt: convo.archivedAt ?? null,
        };
      },
      listAllTurns: async (id) => ({ items: listTurnsFromMemory(id) }),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const conversationId = 'flow-metadata-conv-1';
  const expectedCommand = {
    name: 'flow',
    stepIndex: 1,
    totalSteps: 1,
    loopDepth: 0,
    agentType: 'coding_agent',
    identifier: 'flow-meta',
    label: 'llm',
  };

  const wsPrimary = await connectWs({ baseUrl });

  try {
    sendJson(wsPrimary, { type: 'subscribe_conversation', conversationId });

    const userTurnPromise = waitForEvent({
      ws: wsPrimary,
      predicate: (
        event: unknown,
      ): event is {
        type: 'user_turn';
        conversationId: string;
      } => {
        const e = event as { type?: string; conversationId?: string };
        return e.type === 'user_turn' && e.conversationId === conversationId;
      },
      timeoutMs: 8000,
    });

    const finalPromise = waitForEvent({
      ws: wsPrimary,
      predicate: (
        event: unknown,
      ): event is { type: 'turn_final'; conversationId: string } => {
        const e = event as { type?: string; conversationId?: string };
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 8000,
    });

    await supertest(baseUrl)
      .post('/flows/flow-metadata/run')
      .send({ conversationId })
      .expect(202);

    await userTurnPromise;

    const wsSnapshot = await connectWs({ baseUrl });
    try {
      sendJson(wsSnapshot, { type: 'subscribe_conversation', conversationId });
      const snapshot = await waitForEvent({
        ws: wsSnapshot,
        predicate: (
          event: unknown,
        ): event is {
          type: 'inflight_snapshot';
          inflight: { command?: Record<string, unknown> };
        } => {
          const e = event as {
            type?: string;
            inflight?: { command?: unknown };
          };
          return e.type === 'inflight_snapshot' && Boolean(e.inflight?.command);
        },
        timeoutMs: 8000,
      });

      assert.deepEqual(snapshot.inflight.command, expectedCommand);
    } finally {
      await closeWs(wsSnapshot);
    }

    await finalPromise;

    const turnsRes = await supertest(baseUrl)
      .get(`/conversations/${conversationId}/turns`)
      .expect(200);

    const items = turnsRes.body.items ?? [];
    assert.equal(items.length >= 2, true);
    assert.deepEqual(items[0].command, expectedCommand);
    assert.deepEqual(items[1].command, expectedCommand);
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await closeWs(wsPrimary);
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
