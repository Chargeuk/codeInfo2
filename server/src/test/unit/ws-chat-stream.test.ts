import assert from 'node:assert/strict';
import http from 'node:http';
import test, { afterEach, beforeEach } from 'node:test';

import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';

import { getInflight } from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  getMemoryTurns,
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { query, resetStore } from '../../logStore.js';
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
  content?: string;
  createdAt?: string;
  message?: string;
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
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
  };
  timing?: {
    totalTimeSec?: number;
    tokensPerSecond?: number;
  };
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
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';
  memoryConversations.clear();
  memoryTurns.clear();
  resetStore();
});

afterEach(() => {
  delete process.env.LMSTUDIO_BASE_URL;
  memoryConversations.clear();
  memoryTurns.clear();
  resetStore();
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

test('turn_final includes usage/timing when supplied by completion event', async () => {
  const usage = {
    inputTokens: 10,
    outputTokens: 6,
    totalTokens: 16,
    cachedInputTokens: 2,
  };
  const timing = { totalTimeSec: 1.25, tokensPerSecond: 33 };
  const server = await startServer({
    chatFactory: () =>
      new ScriptedChat(async (chat) => {
        chat.emit('token', { type: 'token', content: 'Hello' });
        chat.emit('final', { type: 'final', content: 'Hello world' });
        chat.emit('complete', {
          type: 'complete',
          threadId: 'thread',
          usage,
          timing,
        });
      }),
  });
  const conversationId = 'ws-turn-final-usage-1';

  const ws = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const res = await request(server.httpServer)
      .post('/chat')
      .send({ provider: 'lmstudio', model: 'm', conversationId, message: 'hi' })
      .expect(202);

    const inflightId = res.body.inflightId as string;

    const final = await waitForEvent({
      ws,
      predicate: (candidate: unknown): candidate is WsTranscriptEvent => {
        const e = candidate as WsTranscriptEvent;
        return (
          e.protocolVersion === 'v1' &&
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });

    assert.deepEqual(final.usage, usage);
    assert.deepEqual(final.timing, timing);
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('server logs WS publish milestones to log store', async () => {
  const server = await startServer({
    chatFactory: buildChatFactory({
      withTools: false,
      withAnalysis: false,
      delayMs: 20,
    }),
  });
  const conversationId = 'ws-logs-1';

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
      predicate: (candidate: unknown): candidate is WsTranscriptEvent => {
        const e = candidate as WsTranscriptEvent;
        return (
          e.protocolVersion === 'v1' &&
          e.conversationId === conversationId &&
          e.type === 'turn_final' &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });

    const userTurnLogs = query({
      source: ['server'],
      text: 'chat.ws.server_publish_user_turn',
    });
    assert.ok(userTurnLogs.length > 0);

    const userTurnContext = userTurnLogs.at(-1)?.context as
      | Record<string, unknown>
      | undefined;
    assert.equal(userTurnContext?.conversationId, conversationId);
    assert.equal(userTurnContext?.inflightId, inflightId);

    const deltaLogs = query({
      source: ['server'],
      text: 'chat.ws.server_publish_assistant_delta',
    });
    assert.ok(deltaLogs.length > 0);

    const deltaContext = deltaLogs.at(-1)?.context as
      | Record<string, unknown>
      | undefined;
    assert.equal(deltaContext?.conversationId, conversationId);
    assert.equal(deltaContext?.inflightId, inflightId);

    const finalLogs = query({
      source: ['server'],
      text: 'chat.ws.server_publish_turn_final',
    });
    assert.ok(finalLogs.length > 0);

    const finalContext = finalLogs.at(-1)?.context as
      | Record<string, unknown>
      | undefined;
    assert.equal(finalContext?.conversationId, conversationId);
    assert.equal(finalContext?.inflightId, inflightId);
    assert.equal(finalContext?.status, 'ok');
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

test('transient reconnect errors do not fail the stream (published as warnings)', async () => {
  const server = await startServer({
    chatFactory: () =>
      new ScriptedChat(async (chat) => {
        chat.emit('error', { type: 'error', message: 'Reconnecting... 1/5' });
        await delay(25);
        chat.emit('token', { type: 'token', content: 'Still ' });
        await delay(25);
        chat.emit('token', { type: 'token', content: 'going' });
        chat.emit('final', { type: 'final', content: 'Still going' });
        chat.emit('complete', { type: 'complete', threadId: 'thread' });
      }),
  });
  const conversationId = 'ws-transient-reconnect-1';

  const ws = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const res = await request(server.httpServer)
      .post('/chat')
      .send({ provider: 'lmstudio', model: 'm', conversationId, message: 'hi' })
      .expect(202);

    const inflightId = res.body.inflightId as string;

    const warning = await waitForEvent({
      ws,
      predicate: (candidate: unknown): candidate is WsTranscriptEvent => {
        const e = candidate as WsTranscriptEvent;
        return (
          e.protocolVersion === 'v1' &&
          e.type === 'stream_warning' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });

    assert.equal(warning.message, 'Reconnecting... 1/5');

    const final = await waitForEvent({
      ws,
      predicate: (candidate: unknown): candidate is WsTranscriptEvent => {
        const e = candidate as WsTranscriptEvent;
        return (
          e.protocolVersion === 'v1' &&
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });

    assert.notEqual(final.status, 'failed');
  } finally {
    await closeWs(ws);
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

test('streams user turn over WS at run start', async () => {
  const server = await startServer({
    chatFactory: buildChatFactory({
      withAnalysis: false,
      withTools: false,
      delayMs: 40,
    }),
  });
  const conversationId = 'ws-user-turn-1';

  const ws = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    await delay(10);

    const res = await request(server.httpServer)
      .post('/chat')
      .send({
        provider: 'lmstudio',
        model: 'm',
        conversationId,
        message: 'Hello',
      })
      .expect(202);

    const inflightId = res.body.inflightId as string;

    const userTurn = await waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'user_turn' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });

    assert.equal(userTurn.content, 'Hello');
    assert.equal(typeof userTurn.createdAt, 'string');
    assert.ok((userTurn.createdAt ?? '').length > 0);

    const firstDelta = await waitForEvent({
      ws,
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

    assert.ok(
      (userTurn.seq ?? 0) < (firstDelta.seq ?? 0),
      'user_turn event must arrive before assistant deltas',
    );
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
