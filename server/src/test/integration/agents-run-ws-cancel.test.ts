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
