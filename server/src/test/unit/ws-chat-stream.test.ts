import assert from 'node:assert/strict';
import http from 'node:http';
import test, { afterEach, beforeEach } from 'node:test';

import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';

import { getInflight } from '../../chat/inflightRegistry.js';
import {
  getMemoryTurns,
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { createChatRouter } from '../../routes/chat.js';
import { attachWs } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

type WsTranscriptEvent = {
  protocolVersion?: string;
  type?: string;
  seq?: number;
  conversationId?: string;
  inflightId?: string;
  inflight?: {
    inflightId?: string;
    assistantText?: string;
    assistantThink?: string;
    toolEvents?: unknown[];
  };
  event?: { type?: string };
  status?: string;
  threadId?: string | null;
  error?: { code?: string; message?: string };
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ScriptedChat extends ChatInterface {
  constructor(
    private readonly script: (
      chat: ChatInterface,
      signal?: AbortSignal,
    ) => Promise<void>,
  ) {
    super();
  }

  async execute(
    _message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ): Promise<void> {
    void _model;
    const signal = (flags as { signal?: AbortSignal }).signal;
    // Provide a stable thread id for turn_final in tests.
    this.emit('thread', { type: 'thread', threadId: conversationId });
    await this.script(this, signal);
  }
}

function buildChatFactory(params: {
  withAnalysis?: boolean;
  withTools?: boolean;
  delayMs?: number;
}) {
  const delayMs = params.delayMs ?? 25;

  return () =>
    new ScriptedChat(async (chat, signal) => {
      const abortIfNeeded = () => {
        if (!signal?.aborted) return false;
        // Providers emit an error event on cancellation; the stream bridge maps this to turn_final.
        chat.emit('error', {
          type: 'error',
          message: 'aborted',
        });
        return true;
      };

      if (params.withAnalysis) {
        chat.emit('analysis', { type: 'analysis', content: 'thinking...' });
        chat.emit('analysis', {
          type: 'analysis',
          content: 'still thinking...',
        });
      }

      await delay(delayMs);
      if (abortIfNeeded()) return;
      chat.emit('token', { type: 'token', content: 'Hel' });

      await delay(delayMs);
      if (abortIfNeeded()) return;
      chat.emit('token', { type: 'token', content: 'lo' });

      if (params.withTools) {
        await delay(delayMs);
        if (abortIfNeeded()) return;
        chat.emit('tool-request', {
          type: 'tool-request',
          callId: 'call-1',
          name: 'VectorSearch',
          params: { query: 'hi' },
          stage: 'started',
        });

        await delay(delayMs);
        if (abortIfNeeded()) return;
        chat.emit('tool-result', {
          type: 'tool-result',
          callId: 'call-1',
          name: 'VectorSearch',
          params: { query: 'hi' },
          stage: 'success',
          result: { ok: true },
          error: null,
        });
      }

      await delay(delayMs);
      if (abortIfNeeded()) return;
      chat.emit('final', { type: 'final', content: 'Hello world' });
      chat.emit('complete', { type: 'complete', threadId: 'thread' });
    });
}

async function startServer(params: { chatFactory: () => ChatInterface }) {
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: () => ({}) as unknown as LMStudioClient,
      chatFactory: () => params.chatFactory(),
      toolFactory: () => ({ tools: [] }),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  return {
    httpServer,
    wsHandle,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: {
  httpServer: http.Server;
  wsHandle: { close: () => Promise<void> };
}) {
  await server.wsHandle.close();
  await new Promise<void>((resolve) =>
    server.httpServer.close(() => resolve()),
  );
}

beforeEach(() => {
  memoryConversations.clear();
  memoryTurns.clear();
});

afterEach(() => {
  memoryConversations.clear();
  memoryTurns.clear();
});

test('transcript seq increases monotonically per conversation stream', async () => {
  const server = await startServer({
    chatFactory: buildChatFactory({
      withAnalysis: true,
      withTools: true,
      delayMs: 30,
    }),
  });
  const conversationId = 'ws-seq-1';

  const ws = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const res = await request(server.httpServer)
      .post('/chat')
      .send({ provider: 'lmstudio', model: 'm', conversationId, message: 'hi' })
      .expect(202);

    const inflightId = res.body.inflightId as string;
    assert.equal(res.body.status, 'started');

    let lastSeq = 0;
    let sawFinal = false;

    while (!sawFinal) {
      const event = await waitForEvent({
        ws,
        predicate: (candidate: unknown): candidate is WsTranscriptEvent => {
          const e = candidate as WsTranscriptEvent;
          if (e.protocolVersion !== 'v1') return false;
          if (e.conversationId !== conversationId) return false;
          if (e.type === 'inflight_snapshot') {
            return e.inflight?.inflightId === inflightId;
          }
          if (
            e.type === 'assistant_delta' ||
            e.type === 'analysis_delta' ||
            e.type === 'tool_event' ||
            e.type === 'turn_final'
          ) {
            return e.inflightId === inflightId;
          }
          return false;
        },
        timeoutMs: 5000,
      });

      assert.equal(typeof event.seq, 'number');
      assert.ok((event.seq ?? 0) >= lastSeq, 'seq must not decrease');
      lastSeq = event.seq ?? lastSeq;
      if (event.type === 'turn_final') sawFinal = true;
    }
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('late subscriber receives inflight_snapshot with partial assistant/tool state', async () => {
  const server = await startServer({
    chatFactory: buildChatFactory({
      withAnalysis: true,
      withTools: true,
      delayMs: 35,
    }),
  });
  const conversationId = 'ws-catchup-1';

  const ws1 = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws1, { type: 'subscribe_conversation', conversationId });
    const res = await request(server.httpServer)
      .post('/chat')
      .send({ provider: 'lmstudio', model: 'm', conversationId, message: 'hi' })
      .expect(202);

    const inflightId = res.body.inflightId as string;

    // Wait for at least one delta/tool event so the inflight state is non-empty.
    await waitForEvent({
      ws: ws1,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'assistant_delta' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });

    await waitForEvent({
      ws: ws1,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'tool_event' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });

    const ws2 = await connectWs({ baseUrl: server.baseUrl });
    try {
      sendJson(ws2, { type: 'subscribe_conversation', conversationId });

      const snapshot = await waitForEvent({
        ws: ws2,
        predicate: (event: unknown): event is WsTranscriptEvent => {
          const e = event as WsTranscriptEvent;
          return (
            e.type === 'inflight_snapshot' &&
            e.conversationId === conversationId &&
            e.inflight?.inflightId === inflightId
          );
        },
        timeoutMs: 5000,
      });

      assert.ok((snapshot.inflight?.assistantText ?? '').length > 0);
      assert.ok(Array.isArray(snapshot.inflight?.toolEvents));
      assert.ok((snapshot.inflight?.toolEvents ?? []).length > 0);
    } finally {
      await closeWs(ws2);
    }
  } finally {
    await closeWs(ws1);
    await stopServer(server);
  }
});

test('analysis_delta updates assistantThink and appears in inflight_snapshot', async () => {
  const server = await startServer({
    chatFactory: buildChatFactory({
      withAnalysis: true,
      withTools: false,
      delayMs: 40,
    }),
  });
  const conversationId = 'ws-analysis-1';

  const ws1 = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws1, { type: 'subscribe_conversation', conversationId });
    // Give the WS server a tick to register the subscription before the run
    // starts emitting analysis_delta events.
    await delay(10);
    const res = await request(server.httpServer)
      .post('/chat')
      .send({ provider: 'lmstudio', model: 'm', conversationId, message: 'hi' })
      .expect(202);

    const inflightId = res.body.inflightId as string;

    const firstAnalysis = await waitForEvent({
      ws: ws1,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'analysis_delta' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });

    const ws2 = await connectWs({ baseUrl: server.baseUrl });
    try {
      sendJson(ws2, { type: 'subscribe_conversation', conversationId });
      const snapshot = await waitForEvent({
        ws: ws2,
        predicate: (event: unknown): event is WsTranscriptEvent => {
          const e = event as WsTranscriptEvent;
          return (
            e.type === 'inflight_snapshot' &&
            e.conversationId === conversationId &&
            e.inflight?.inflightId === inflightId
          );
        },
        timeoutMs: 5000,
      });

      assert.ok((snapshot.inflight?.assistantThink ?? '').length > 0);

      const secondAnalysis = await waitForEvent({
        ws: ws1,
        predicate: (event: unknown): event is WsTranscriptEvent => {
          const e = event as WsTranscriptEvent;
          return (
            e.type === 'analysis_delta' &&
            e.conversationId === conversationId &&
            e.inflightId === inflightId
          );
        },
        timeoutMs: 5000,
      });
      assert.ok(
        (secondAnalysis.seq ?? 0) >= (firstAnalysis.seq ?? 0),
        'analysis seq must not decrease',
      );
    } finally {
      await closeWs(ws2);
    }
  } finally {
    await closeWs(ws1);
    await stopServer(server);
  }
});

test('cancel_inflight with invalid inflightId yields turn_final failed INFLIGHT_NOT_FOUND', async () => {
  const server = await startServer({
    chatFactory: buildChatFactory({
      withAnalysis: false,
      withTools: false,
      delayMs: 50,
    }),
  });
  const conversationId = 'ws-cancel-invalid-1';

  const ws = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    sendJson(ws, {
      type: 'cancel_inflight',
      conversationId,
      inflightId: 'does-not-exist',
    });

    const final = await waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 3000,
    });

    assert.equal(final.status, 'failed');
    assert.equal(final.error?.code, 'INFLIGHT_NOT_FOUND');
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('unsubscribe_conversation does not cancel run; turns still persist', async () => {
  const server = await startServer({
    chatFactory: buildChatFactory({
      withAnalysis: false,
      withTools: false,
      delayMs: 60,
    }),
  });
  const conversationId = 'ws-unsub-1';

  const ws = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    const res = await request(server.httpServer)
      .post('/chat')
      .send({ provider: 'lmstudio', model: 'm', conversationId, message: 'hi' })
      .expect(202);

    const inflightId = res.body.inflightId as string;
    await waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'inflight_snapshot' &&
          e.conversationId === conversationId &&
          e.inflight?.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });

    sendJson(ws, { type: 'unsubscribe_conversation', conversationId });

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const turns = getMemoryTurns(conversationId);
      if (
        turns.some((t) => t.role === 'assistant' && (t.content ?? '').length)
      ) {
        return;
      }
      await delay(50);
    }
    assert.fail('expected assistant turn persisted after unsubscribe');
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('inflight registry entry removed after turn_final', async () => {
  const server = await startServer({
    chatFactory: buildChatFactory({
      withAnalysis: true,
      withTools: false,
      delayMs: 35,
    }),
  });
  const conversationId = 'ws-registry-clean-1';

  const ws = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    const res = await request(server.httpServer)
      .post('/chat')
      .send({ provider: 'lmstudio', model: 'm', conversationId, message: 'hi' })
      .expect(202);

    const inflightId = res.body.inflightId as string;

    await waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });

    assert.equal(getInflight(conversationId), undefined);
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});
