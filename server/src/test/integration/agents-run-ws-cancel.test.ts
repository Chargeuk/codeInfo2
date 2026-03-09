import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { getActiveRunOwnership } from '../../agents/runLock.js';
import {
  startAgentInstruction,
  runAgentInstructionUnlocked,
} from '../../agents/service.js';
import {
  getInflight,
  getPendingConversationCancel,
} from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { resetStore } from '../../logStore.js';
import { attachWs } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForRuntimeCleanup(
  conversationId: string,
  timeoutMs = 8_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (
      getInflight(conversationId) === undefined &&
      getActiveRunOwnership(conversationId) === null &&
      getPendingConversationCancel(conversationId) === null
    ) {
      return;
    }
    await delay(25);
  }
  throw new Error(`runtime cleanup did not finish for ${conversationId}`);
}

class SlowStreamingChat extends ChatInterface {
  async execute(
    _message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _message;
    void _model;

    const signal = (flags as { signal?: AbortSignal }).signal;
    const abortIfNeeded = () => {
      if (!signal?.aborted) return false;
      this.emit('error', { type: 'error', message: 'aborted' });
      return true;
    };

    this.emit('thread', { type: 'thread', threadId: conversationId });

    for (const chunk of ['Hel', 'lo', ' ', 'wor', 'ld', '!']) {
      await delay(75);
      if (abortIfNeeded()) return;
      this.emit('token', { type: 'token', content: chunk });
    }

    this.emit('final', { type: 'final', content: 'Hello world!' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

async function setupWsTestServer() {
  resetStore();

  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');

  const app = express();
  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const ws = await connectWs({ baseUrl });

  return {
    ws,
    wsHandle,
    httpServer,
    restoreEnv() {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    },
  };
}

test('Agents cancel_inflight publishes turn_final status stopped and run resolves', async () => {
  resetStore();

  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');

  const app = express();
  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const conversationId = 'agents-ws-conv-cancel-1';
  const inflightId = 'agents-ws-inflight-cancel-1';
  const ws = await connectWs({ baseUrl });

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const deltaPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'assistant_delta';
        conversationId: string;
        inflightId: string;
        seq: number;
        delta: string;
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
        };
        return (
          e.type === 'assistant_delta' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 8000,
    });

    const finalPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'turn_final';
        status: string;
        conversationId: string;
        inflightId: string;
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
          status?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 8000,
    });

    const runPromise = runAgentInstructionUnlocked({
      agentName: 'coding_agent',
      instruction: 'Hello',
      conversationId,
      mustExist: false,
      source: 'REST',
      inflightId,
      chatFactory: () => new SlowStreamingChat(),
    });

    await deltaPromise;

    sendJson(ws, {
      type: 'cancel_inflight',
      conversationId,
      inflightId,
    });

    const final = await finalPromise;
    assert.equal(final.status, 'stopped');

    const result = await runPromise;
    assert.equal(result.conversationId, conversationId);
    assert.equal(result.agentName, 'coding_agent');
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
  }
});

test('Agents startup-race conversation-only stop finishes a normal run as stopped', async () => {
  const server = await setupWsTestServer();
  const conversationId = 'agents-ws-conv-startup-stop-1';

  try {
    sendJson(server.ws, { type: 'subscribe_conversation', conversationId });

    const finalPromise = waitForEvent({
      ws: server.ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'turn_final';
        status: string;
        conversationId: string;
        inflightId: string;
      } => {
        const e = event as {
          type?: string;
          status?: string;
          conversationId?: string;
          inflightId?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          typeof e.inflightId === 'string'
        );
      },
      timeoutMs: 8_000,
    });

    const started = await startAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      conversationId,
      source: 'REST',
      chatFactory: () => new SlowStreamingChat(),
    });

    sendJson(server.ws, {
      type: 'cancel_inflight',
      conversationId,
    });

    const final = await finalPromise;
    assert.equal(final.status, 'stopped');
    assert.equal(final.inflightId, started.inflightId);
    await waitForRuntimeCleanup(conversationId);
  } finally {
    await closeWs(server.ws);
    await server.wsHandle.close();
    await new Promise<void>((resolve) =>
      server.httpServer.close(() => resolve()),
    );
    server.restoreEnv();
  }
});

test('Duplicate stop requests for a normal agent run emit one terminal event', async () => {
  const server = await setupWsTestServer();
  const conversationId = 'agents-ws-conv-duplicate-stop-1';
  const events: Array<{ type?: string; conversationId?: string }> = [];
  server.ws.on('message', (raw) => {
    events.push(
      JSON.parse(String(raw)) as { type?: string; conversationId?: string },
    );
  });

  try {
    sendJson(server.ws, { type: 'subscribe_conversation', conversationId });

    const finalPromise = waitForEvent({
      ws: server.ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'turn_final';
        status: string;
        conversationId: string;
      } => {
        const e = event as {
          type?: string;
          status?: string;
          conversationId?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.status === 'stopped'
        );
      },
      timeoutMs: 8_000,
    });

    await startAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      conversationId,
      source: 'REST',
      chatFactory: () => new SlowStreamingChat(),
    });

    sendJson(server.ws, { type: 'cancel_inflight', conversationId });
    sendJson(server.ws, { type: 'cancel_inflight', conversationId });

    await finalPromise;
    await delay(200);

    const finalEvents = events.filter(
      (event) =>
        event.type === 'turn_final' && event.conversationId === conversationId,
    );
    assert.equal(finalEvents.length, 1);
    await waitForRuntimeCleanup(conversationId);
  } finally {
    await closeWs(server.ws);
    await server.wsHandle.close();
    await new Promise<void>((resolve) =>
      server.httpServer.close(() => resolve()),
    );
    server.restoreEnv();
  }
});

test('Normal agent stop cleanup fallback still releases runtime state', async () => {
  const server = await setupWsTestServer();
  const conversationId = 'agents-ws-conv-cleanup-fallback-1';

  try {
    sendJson(server.ws, { type: 'subscribe_conversation', conversationId });

    const finalPromise = waitForEvent({
      ws: server.ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'turn_final';
        status: string;
        conversationId: string;
      } => {
        const e = event as {
          type?: string;
          status?: string;
          conversationId?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.status === 'stopped'
        );
      },
      timeoutMs: 8_000,
    });

    const started = await startAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      conversationId,
      source: 'REST',
      chatFactory: () => new SlowStreamingChat(),
      cleanupInflightFn: ({ conversationId: cleanupConversationId }) => {
        if (cleanupConversationId === conversationId) {
          throw new Error('forced cleanup failure');
        }
      },
    });

    const waitForInflight = async () => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 4_000) {
        const inflight = getInflight(conversationId);
        if (inflight?.inflightId === started.inflightId) return;
        await delay(25);
      }
      throw new Error('inflight was not created before stop');
    };

    await waitForInflight();
    sendJson(server.ws, { type: 'cancel_inflight', conversationId });

    await finalPromise;
    await waitForRuntimeCleanup(conversationId);
  } finally {
    await closeWs(server.ws);
    await server.wsHandle.close();
    await new Promise<void>((resolve) =>
      server.httpServer.close(() => resolve()),
    );
    server.restoreEnv();
  }
});

test('A new normal agent run can start on the same conversation after confirmed stop', async () => {
  const server = await setupWsTestServer();
  const conversationId = 'agents-ws-conv-reuse-1';

  try {
    sendJson(server.ws, { type: 'subscribe_conversation', conversationId });

    const firstFinalPromise = waitForEvent({
      ws: server.ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'turn_final';
        status: string;
        conversationId: string;
      } => {
        const e = event as {
          type?: string;
          status?: string;
          conversationId?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.status === 'stopped'
        );
      },
      timeoutMs: 8_000,
    });

    await startAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      conversationId,
      source: 'REST',
      chatFactory: () => new SlowStreamingChat(),
    });

    sendJson(server.ws, { type: 'cancel_inflight', conversationId });
    await firstFinalPromise;
    await waitForRuntimeCleanup(conversationId);

    const secondRun = await startAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello again',
      conversationId,
      source: 'REST',
      chatFactory: () => new SlowStreamingChat(),
    });

    assert.equal(secondRun.conversationId, conversationId);
    sendJson(server.ws, { type: 'cancel_inflight', conversationId });
    await waitForRuntimeCleanup(conversationId);
  } finally {
    await closeWs(server.ws);
    await server.wsHandle.close();
    await new Promise<void>((resolve) =>
      server.httpServer.close(() => resolve()),
    );
    server.restoreEnv();
  }
});
