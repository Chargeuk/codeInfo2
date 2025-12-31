import assert from 'assert';
import http, { type Server } from 'node:http';

import { chatRequestFixture } from '@codeinfo2/common';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import type WebSocket from 'ws';

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
  getLastPredictionState,
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
  type?: string;
  conversationId?: string;
  inflightId?: string;
  inflight?: { inflightId?: string };
  status?: string;
};

let server: Server | null = null;
let wsHandle: WsServerHandle | null = null;
let ws: WebSocket | null = null;
let baseUrl = '';
let startResponse: ChatStartResponse | null = null;

async function ensureWs() {
  if (!ws) {
    ws = await connectWs({ baseUrl });
  }
  return ws;
}

Before(async () => {
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
  startResponse = null;
});

Given('chat cancellation scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

When(
  'I start a chat run and unsubscribe from the conversation stream',
  async () => {
    const controller = new AbortController();
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
        conversationId: 'chat-cancel-fixture',
        message: userMessage,
      }),
      signal: controller.signal,
    });

    startResponse = (await res.json()) as ChatStartResponse;
    assert.equal(res.status, 202);
    assert.ok(startResponse.inflightId);

    const socket = await ensureWs();
    sendJson(socket, {
      type: 'subscribe_conversation',
      conversationId: startResponse.conversationId,
    });

    // Wait for the subscription snapshot to prove we're receiving events, then unsubscribe.
    await waitForEvent({
      ws: socket,
      predicate: (event: unknown): event is WsEvent => {
        const e = event as WsEvent;
        return (
          e?.type === 'inflight_snapshot' &&
          e.conversationId === startResponse?.conversationId &&
          e.inflight?.inflightId === startResponse?.inflightId
        );
      },
    });

    sendJson(socket, {
      type: 'unsubscribe_conversation',
      conversationId: startResponse.conversationId,
    });
  },
);

Then('the chat prediction is not cancelled server side', async () => {
  const state = getLastPredictionState();
  assert(state, 'prediction state missing');
  assert.strictEqual(state.cancelled, false);
});

When('I send cancel_inflight for the active run', async () => {
  assert.ok(startResponse);
  const socket = await ensureWs();

  // Re-subscribe so we can observe the final status.
  sendJson(socket, {
    type: 'subscribe_conversation',
    conversationId: startResponse.conversationId,
  });

  await waitForEvent({
    ws: socket,
    predicate: (event: unknown): event is WsEvent => {
      const e = event as WsEvent;
      return (
        e?.type === 'inflight_snapshot' &&
        e.conversationId === startResponse?.conversationId &&
        e.inflight?.inflightId === startResponse?.inflightId
      );
    },
  });

  sendJson(socket, {
    type: 'cancel_inflight',
    conversationId: startResponse.conversationId,
    inflightId: startResponse.inflightId,
  });
});

Then(
  'the WebSocket stream final status is {string}',
  async (status: string) => {
    assert.ok(startResponse);
    const socket = await ensureWs();

    const final = await waitForEvent({
      ws: socket,
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

    assert.equal(final.status, status);
    const state = getLastPredictionState();
    assert(state, 'prediction state missing');
    assert.strictEqual(state.cancelled, true);
  },
);
