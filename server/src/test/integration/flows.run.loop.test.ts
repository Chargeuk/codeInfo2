import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';
import type WebSocket from 'ws';

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { startFlowRun } from '../../flows/service.js';
import type { Turn } from '../../mongo/turn.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { attachWs } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ScriptedChat extends ChatInterface {
  constructor(private readonly responder: (message: string) => string) {
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
    this.emit('thread', { type: 'thread', threadId: conversationId });
    const response = this.responder(message);
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

const withFlowServer = async (
  responder: (message: string) => string,
  task: (params: { baseUrl: string; wsUrl: WebSocket }) => Promise<void>,
) => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-loop-'));
  await fs.cp(fixturesDir, tmpDir, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new ScriptedChat(responder),
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
    await task({ baseUrl, wsUrl: ws });
  } finally {
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
};

const waitForTurns = async (
  conversationId: string,
  predicate: (turns: Turn[]) => boolean,
  timeoutMs = 2000,
) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const turns = memoryTurns.get(conversationId) ?? [];
    if (predicate(turns)) return turns;
    await delay(20);
  }
  throw new Error('Timed out waiting for flow turns');
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

const cleanupMemory = (...conversationIds: Array<string | undefined>) => {
  conversationIds.forEach((conversationId) => {
    if (!conversationId) return;
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
};

test('flow loops until break answer matches breakOn', async () => {
  let outerBreakCount = 0;
  await withFlowServer(
    (message) => {
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
        4000,
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
      cleanupMemory(conversationId, agentConversationId);
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
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'failed');
      cleanupMemory(conversationId);
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
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'failed');
      cleanupMemory(conversationId);
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

      cleanupMemory(conversationId, agentConversationId);
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

      cleanupMemory(conversationId, alphaConversationId, betaConversationId);
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

      cleanupMemory(conversationId);
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
            e.status === 'failed'
          );
        },
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

      cleanupMemory(conversationId, agentConversationId);
    },
  );
});
