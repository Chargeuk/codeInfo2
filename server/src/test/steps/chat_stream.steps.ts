import assert from 'assert';
import http, { type Server } from 'node:http';

import { chatRequestFixture } from '@codeinfo2/common';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import type WebSocket from 'ws';

import { query, resetStore } from '../../logStore.js';
import { createRequestLogger } from '../../logger.js';
import { createChatRouter } from '../../routes/chat.js';
import { attachWs, type WsServerHandle } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';
import {
  MockLMStudioClient,
  type MockScenario,
  getLastChatHistory,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';

type ChatStartResponse = {
  status: 'started';
  conversationId: string;
  inflightId: string;
  provider: string;
  model: string;
};

type WsEvent = {
  protocolVersion?: string;
  type?: string;
  conversationId?: string;
  inflightId?: string;
  inflight?: { inflightId?: string; toolEvents?: unknown[] };
  event?: { type?: string };
  status?: string;
  error?: { message?: string };
};

let server: Server | null = null;
let wsHandle: WsServerHandle | null = null;
let ws: WebSocket | null = null;
let baseUrl = '';
let statusCode: number | null = null;
let startResponse: ChatStartResponse | null = null;
let received: WsEvent[] = [];

async function ensureWsSubscribed(conversationId: string) {
  if (!ws) {
    ws = await connectWs({ baseUrl });
  }
  sendJson(ws, { type: 'subscribe_conversation', conversationId });
}

Before(async () => {
  resetStore();
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';

  const app = express();
  app.use(cors());
  app.use(createRequestLogger());
  app.use((req, res, next) => {
    const requestId = (req as unknown as { id?: string }).id;
    if (requestId) res.locals.requestId = requestId;
    next();
  });
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: () =>
        new MockLMStudioClient() as unknown as LMStudioClient,
    }),
  );

  const httpServer = http.createServer(app);
  server = httpServer;
  wsHandle = attachWs({ httpServer });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const address = httpServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('Unable to start test server');
      }
      baseUrl = `http://localhost:${address.port}`;
      resolve();
    });
  });
});

After(async () => {
  stopMock();
  resetStore();

  if (ws) {
    await closeWs(ws);
    ws = null;
  }

  if (wsHandle) {
    await wsHandle.close();
    wsHandle = null;
  }

  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }

  received = [];
  statusCode = null;
  startResponse = null;
});

Given('chat stream scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

When('I POST to the chat endpoint with the chat request fixture', async () => {
  await ensureWsSubscribed('chat-fixture-conv');

  const userMessage = Array.isArray(chatRequestFixture.messages)
    ? String(
        chatRequestFixture.messages.find(
          (msg) => (msg as { role?: string }).role === 'user',
        )?.content ?? 'Hello',
      )
    : 'Hello';

  const res = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider:
        (chatRequestFixture as { provider?: string }).provider ?? 'lmstudio',
      model: (chatRequestFixture as { model?: string }).model ?? 'model-1',
      conversationId: 'chat-fixture-conv',
      message: userMessage,
    }),
  });
  statusCode = res.status;
  startResponse = (await res.json()) as ChatStartResponse;
});

Then('the chat stream status code is {int}', (status: number) => {
  assert.strictEqual(statusCode, status);
  assert.ok(startResponse);
  assert.equal(startResponse.status, 'started');
  assert.ok(startResponse.conversationId);
  assert.ok(startResponse.inflightId);
});

Then(
  'I can subscribe via WebSocket and receive an inflight snapshot and a final event',
  async () => {
    assert.ok(startResponse);
    await ensureWsSubscribed(startResponse.conversationId);

    const snapshot = await waitForEvent({
      ws: ws as WebSocket,
      predicate: (event: unknown): event is WsEvent => {
        const e = event as WsEvent;
        return (
          e?.type === 'inflight_snapshot' &&
          e.conversationId === startResponse?.conversationId &&
          e.inflight?.inflightId === startResponse?.inflightId
        );
      },
    });
    received.push(snapshot);

    const final = await waitForEvent({
      ws: ws as WebSocket,
      predicate: (event: unknown): event is WsEvent => {
        const e = event as WsEvent;
        return (
          e?.type === 'turn_final' &&
          e.conversationId === startResponse?.conversationId &&
          e.inflightId === startResponse?.inflightId
        );
      },
      timeoutMs: 4000,
    });
    received.push(final);
  },
);

Then(
  'the WebSocket stream includes a failed final event {string}',
  async (message: string) => {
    assert.ok(startResponse);
    await ensureWsSubscribed(startResponse.conversationId);

    await waitForEvent({
      ws: ws as WebSocket,
      predicate: (event: unknown): event is WsEvent => {
        const e = event as WsEvent;
        return (
          e?.type === 'turn_final' &&
          e.conversationId === startResponse?.conversationId &&
          e.inflightId === startResponse?.inflightId &&
          e.status === 'failed' &&
          (e.error?.message ?? '').includes(message)
        );
      },
      timeoutMs: 4000,
    });
  },
);

Then('the streamed events include tool request and result events', async () => {
  assert.ok(startResponse);
  await ensureWsSubscribed(startResponse.conversationId);

  const seen = new Set<string>();

  const snapshot = await waitForEvent({
    ws: ws as WebSocket,
    predicate: (event: unknown): event is WsEvent => {
      const e = event as WsEvent;
      return (
        e?.type === 'inflight_snapshot' &&
        e.conversationId === startResponse?.conversationId &&
        e.inflight?.inflightId === startResponse?.inflightId
      );
    },
  });

  (snapshot.inflight?.toolEvents ?? []).forEach((tool) => {
    const type = (tool as { type?: string }).type;
    if (type) seen.add(type);
  });
  received.push(snapshot);

  // Also wait for at least one live tool_event so this scenario asserts WS streaming.
  const firstTool = await waitForEvent({
    ws: ws as WebSocket,
    predicate: (event: unknown): event is WsEvent => {
      const e = event as WsEvent;
      return (
        e?.type === 'tool_event' &&
        e.conversationId === startResponse?.conversationId &&
        e.inflightId === startResponse?.inflightId
      );
    },
    timeoutMs: 4000,
  });
  received.push(firstTool);
  if (firstTool.event?.type) seen.add(firstTool.event.type);

  // If we didn't see both request/result yet, wait a bit longer.
  while (!(seen.has('tool-request') && seen.has('tool-result'))) {
    const next = await waitForEvent({
      ws: ws as WebSocket,
      predicate: (event: unknown): event is WsEvent => {
        const e = event as WsEvent;
        return (
          e?.type === 'tool_event' &&
          e.conversationId === startResponse?.conversationId &&
          e.inflightId === startResponse?.inflightId
        );
      },
      timeoutMs: 4000,
    });
    received.push(next);
    if (next.event?.type) seen.add(next.event.type);
  }

  assert(seen.has('tool-request'), 'tool-request missing');
  assert(seen.has('tool-result'), 'tool-result missing');
});

Then('tool events are logged to the log store', () => {
  const toolLogs = query({ text: 'chat.stream.tool_event' });
  assert(toolLogs.length > 0, 'expected tool events in log store');
});

When(
  'I POST to the chat endpoint with a two-message chat history',
  async () => {
    const conversationId = 'chat-history-conv';
    await ensureWsSubscribed(conversationId);

    const first = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'lmstudio',
        model: 'model-1',
        conversationId,
        message: 'First question',
      }),
    });
    const firstBody = (await first.json()) as ChatStartResponse;
    statusCode = first.status;

    await waitForEvent({
      ws: ws as WebSocket,
      predicate: (event: unknown): event is WsEvent => {
        const e = event as WsEvent;
        return (
          e?.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.inflightId === firstBody.inflightId
        );
      },
      timeoutMs: 4000,
    });

    const second = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'lmstudio',
        model: 'model-1',
        conversationId,
        message: 'Second question',
      }),
    });
    const secondBody = (await second.json()) as ChatStartResponse;
    statusCode = second.status;

    await waitForEvent({
      ws: ws as WebSocket,
      predicate: (event: unknown): event is WsEvent => {
        const e = event as WsEvent;
        return (
          e?.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.inflightId === secondBody.inflightId
        );
      },
      timeoutMs: 4000,
    });
  },
);

Then('the LM Studio chat history length is {int}', (expected: number) => {
  assert.strictEqual(getLastChatHistory().length, expected);
});
