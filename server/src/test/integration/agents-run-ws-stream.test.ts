import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import express from 'express';

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { resetStore } from '../../logStore.js';
import { runAgentInstructionUnlocked } from '../../agents/service.js';
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
    await delay(50);
    if (abortIfNeeded()) return;
    this.emit('token', { type: 'token', content: 'Hel' });
    await delay(50);
    if (abortIfNeeded()) return;
    this.emit('token', { type: 'token', content: 'lo' });
    await delay(50);
    if (abortIfNeeded()) return;
    this.emit('final', { type: 'final', content: 'Hello world' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

test('Agents runs publish WS transcript events while the run is in progress', async () => {
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

  const conversationId = 'agents-ws-conv-1';
  const inflightId = 'agents-ws-inflight-1';
  const ws = await connectWs({ baseUrl });

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    // Start WS waits before triggering the HTTP request to avoid missing early frames.
    const userTurnPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'user_turn';
        conversationId: string;
        inflightId: string;
        content: string;
        createdAt: string;
        seq: number;
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
        };
        return (
          e.type === 'user_turn' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 8000,
    });

    const snapshotPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'inflight_snapshot';
        conversationId: string;
        inflight: { command?: { name: string; stepIndex: number } };
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflight?: { command?: { name?: string } };
        };
        return (
          e.type === 'inflight_snapshot' && e.conversationId === conversationId
        );
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
      ): event is { type: string; status: string } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          status?: string;
        };
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 8000,
    });

    const runPromise = runAgentInstructionUnlocked({
      agentName: 'coding_agent',
      instruction: 'Hello',
      conversationId,
      mustExist: false,
      command: { name: 'improve_plan', stepIndex: 1, totalSteps: 3 },
      source: 'REST',
      inflightId,
      chatFactory: () => new StreamingChat(),
    });

    const userTurn = await userTurnPromise;
    assert.equal(userTurn.content, 'Hello');
    assert.equal(typeof userTurn.createdAt, 'string');
    assert.ok(userTurn.createdAt.length > 0);

    const snapshot = await snapshotPromise;
    assert.deepEqual(snapshot.inflight.command, {
      name: 'improve_plan',
      stepIndex: 1,
      totalSteps: 3,
    });
    const delta = await deltaPromise;
    assert(
      userTurn.seq < delta.seq,
      'user_turn should be observed before assistant_delta for the same inflightId',
    );
    const final = await finalPromise;
    assert.equal(final.status, 'ok');

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

test('Agents run passes inflightId into chat.run(...) flags', async () => {
  resetStore();

  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');

  let capturedFlags: Record<string, unknown> | null = null;

  class CapturingChat extends ChatInterface {
    async execute(
      _message: string,
      flags: Record<string, unknown>,
      conversationId: string,
      _model: string,
    ) {
      void _message;
      void _model;
      capturedFlags = { ...flags };
      this.emit('thread', { type: 'thread', threadId: conversationId });
      this.emit('final', { type: 'final', content: 'ok' });
      this.emit('complete', { type: 'complete', threadId: conversationId });
    }
  }

  try {
    const conversationId = 'agents-flags-conv-1';
    const inflightId = 'agents-flags-inflight-1';

    await runAgentInstructionUnlocked({
      agentName: 'coding_agent',
      instruction: 'Hello',
      conversationId,
      mustExist: false,
      source: 'REST',
      inflightId,
      chatFactory: () => new CapturingChat(),
    });

    if (!capturedFlags) throw new Error('expected chat.execute to be called');
    assert.equal(capturedFlags['inflightId'], inflightId);
    assert.equal(capturedFlags['source'], 'REST');
  } finally {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
  }
});
