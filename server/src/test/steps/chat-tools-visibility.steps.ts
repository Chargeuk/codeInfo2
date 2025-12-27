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
  startMock,
  stopMock,
  type MockScenario,
} from '../support/mockLmStudioSdk.js';

type ChatStartResponse = {
  status: 'started';
  conversationId: string;
  inflightId: string;
};

type ToolEvent = {
  type?: string;
  callId?: string | number;
  name?: string;
  result?: unknown;
};

type WsEvent = {
  type?: string;
  conversationId?: string;
  inflightId?: string;
  inflight?: { inflightId?: string };
  event?: ToolEvent;
};

let server: Server | null = null;
let wsHandle: WsServerHandle | null = null;
let ws: WebSocket | null = null;
let baseUrl = '';

let startResponse: ChatStartResponse | null = null;
let toolRequest: ToolEvent | null = null;
let toolResult: ToolEvent | null = null;

Before(async () => {
  resetStore();
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';

  const app = express();
  app.use(cors());
  app.use(createRequestLogger());
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

  startResponse = null;
  toolRequest = null;
  toolResult = null;
});

Given('chat visibility scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

When('I start a chat run and subscribe to its WebSocket stream', async () => {
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
      conversationId: 'chat-visibility-fixture',
      message: userMessage,
    }),
  });

  assert.equal(res.status, 202);
  startResponse = (await res.json()) as ChatStartResponse;

  ws = await connectWs({ baseUrl });
  sendJson(ws, {
    type: 'subscribe_conversation',
    conversationId: startResponse.conversationId,
  });

  // Wait for snapshot to ensure subscription is active before asserting tool events.
  await waitForEvent({
    ws,
    predicate: (event: unknown): event is WsEvent => {
      const e = event as WsEvent;
      return (
        e?.type === 'inflight_snapshot' &&
        e.conversationId === startResponse?.conversationId &&
        e.inflight?.inflightId === startResponse?.inflightId
      );
    },
  });

  // Capture at least one tool-request and one tool-result.
  while (!(toolRequest && toolResult)) {
    const next = await waitForEvent({
      ws,
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

    if (!next.event) continue;
    const evType = next.event.type;
    if (evType === 'tool-request' && !toolRequest) toolRequest = next.event;
    if (evType === 'tool-result' && !toolResult) toolResult = next.event;
  }

  const logs = query({ text: 'chat.stream.tool_event' });
  assert(logs.length > 0, 'expected tool events logged');
});

Then('the streamed tool events include call id and name', () => {
  assert.ok(toolRequest ?? toolResult, 'expected tool events');
  const request = toolResult ?? toolRequest;
  assert.ok(request);

  const callId = request.callId;
  assert.ok(['call-1', '1'].includes(String(callId)));
  assert.equal(request.name, 'VectorSearch');
});

Then('the streamed tool result includes path and repo metadata', () => {
  assert.ok(toolResult, 'expected tool-result event');
  const payload = toolResult.result as
    | { results?: Array<Record<string, unknown>> }
    | undefined;

  assert(payload && Array.isArray(payload.results), 'expected results array');
  const first = payload.results?.[0];
  assert.equal(first?.repo, 'repo');
  assert.equal(first?.relPath, 'main.txt');
  assert.equal(first?.hostPath, '/host/repo/main.txt');
});
