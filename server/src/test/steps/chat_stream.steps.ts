import assert from 'assert';
import fs from 'node:fs/promises';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { chatRequestFixture } from '@codeinfo2/common';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import type WebSocket from 'ws';

import { query, resetStore } from '../../logStore.js';
import { createRequestLogger } from '../../logger.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
import { attachWs, type WsServerHandle } from '../../ws/server.js';
import {
  MockLMStudioClient,
  type MockScenario,
  getLastChatHistory,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

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
  content?: string;
};

let server: Server | null = null;
let wsHandle: WsServerHandle | null = null;
let ws: WebSocket | null = null;
let baseUrl = '';
let statusCode: number | null = null;
let startResponse: ChatStartResponse | null = null;
let errorResponse: { code?: string; message?: string } | null = null;
let received: WsEvent[] = [];
const ORIGINAL_CODEINFO_CODEX_HOME = process.env.CODEINFO_CODEX_HOME;
let tempCodexHomeForScenario: string | null = null;

async function ensureWsSubscribed(conversationId: string) {
  if (!ws) {
    ws = await connectWs({ baseUrl });
  }
  sendJson(ws, { type: 'subscribe_conversation', conversationId });
}

Before(async () => {
  resetStore();
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';
  tempCodexHomeForScenario = await fs.mkdtemp(
    path.join(os.tmpdir(), 'chat-stream-codex-home-'),
  );
  await fs.mkdir(path.join(tempCodexHomeForScenario, 'chat'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(tempCodexHomeForScenario, 'chat', 'config.toml'),
    'model = "gpt-5.3-codex"\n',
    'utf8',
  );
  process.env.CODEINFO_CODEX_HOME = tempCodexHomeForScenario;

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
  errorResponse = null;
  if (ORIGINAL_CODEINFO_CODEX_HOME === undefined) {
    delete process.env.CODEINFO_CODEX_HOME;
  } else {
    process.env.CODEINFO_CODEX_HOME = ORIGINAL_CODEINFO_CODEX_HOME;
  }
  if (tempCodexHomeForScenario) {
    await fs.rm(tempCodexHomeForScenario, { recursive: true, force: true });
    tempCodexHomeForScenario = null;
  }
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
  const body = (await res.json()) as Record<string, unknown>;
  if (statusCode === 202) {
    startResponse = body as unknown as ChatStartResponse;
    errorResponse = null;
  } else {
    startResponse = null;
    errorResponse = {
      code: body.code as string | undefined,
      message: body.message as string | undefined,
    };
  }
});

Then('the chat stream status code is {int}', (status: number) => {
  assert.strictEqual(statusCode, status);
  if (status === 202) {
    assert.ok(startResponse);
    assert.equal(startResponse.status, 'started');
    assert.ok(startResponse.conversationId);
    assert.ok(startResponse.inflightId);
  }
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

Given('codex detection is unavailable', () => {
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'codex unavailable in test',
  });
});

Given('codex detection is available', () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
});

When(
  'I POST to the chat endpoint with provider {string} and model {string}',
  async (provider: string, model: string) => {
    const conversationId = `chat-provider-${provider}-${Date.now()}`;
    await ensureWsSubscribed(conversationId);

    const res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider,
        model,
        conversationId,
        message: 'provider fallback check',
      }),
    });
    statusCode = res.status;
    const body = (await res.json()) as Record<string, unknown>;
    if (statusCode === 202) {
      startResponse = body as unknown as ChatStartResponse;
      errorResponse = null;
    } else {
      startResponse = null;
      errorResponse = {
        code: body.code as string | undefined,
        message: body.message as string | undefined,
      };
    }
  },
);

Then('the chat start response provider is {string}', (provider: string) => {
  assert.ok(startResponse);
  assert.equal(startResponse.provider, provider);
});

Then('the chat error code is {string}', (code: string) => {
  assert.ok(errorResponse);
  assert.equal(errorResponse.code, code);
});

Then('the chat error message is {string}', (message: string) => {
  assert.ok(errorResponse);
  assert.equal(errorResponse.message, message);
});

When(
  'I POST to the chat endpoint with raw message {string}',
  async (message: string) => {
    const conversationId = `chat-raw-${Date.now()}`;
    await ensureWsSubscribed(conversationId);

    const res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'lmstudio',
        model: 'model-1',
        conversationId,
        message,
      }),
    });

    statusCode = res.status;
    const body = (await res.json()) as Record<string, unknown>;
    if (statusCode === 202) {
      startResponse = body as unknown as ChatStartResponse;
      errorResponse = null;
    } else {
      startResponse = null;
      errorResponse = {
        code: body.code as string | undefined,
        message: body.message as string | undefined,
      };
    }
  },
);

When('I POST to the chat endpoint with a whitespace-only message', async () => {
  const conversationId = `chat-whitespace-${Date.now()}`;
  await ensureWsSubscribed(conversationId);

  const res = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'lmstudio',
      model: 'model-1',
      conversationId,
      message: '   \t  ',
    }),
  });

  statusCode = res.status;
  startResponse = null;
  const body = (await res.json()) as Record<string, unknown>;
  errorResponse = {
    code: body.code as string | undefined,
    message: body.message as string | undefined,
  };
});

When('I POST to the chat endpoint with a newline-only message', async () => {
  const conversationId = `chat-newline-${Date.now()}`;
  await ensureWsSubscribed(conversationId);

  const res = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'lmstudio',
      model: 'model-1',
      conversationId,
      message: '\n\n\r\n',
    }),
  });

  statusCode = res.status;
  startResponse = null;
  const body = (await res.json()) as Record<string, unknown>;
  errorResponse = {
    code: body.code as string | undefined,
    message: body.message as string | undefined,
  };
});

Then('the user turn content is {string}', async (expected: string) => {
  assert.ok(startResponse);
  await ensureWsSubscribed(startResponse.conversationId);

  const userTurn = await waitForEvent({
    ws: ws as WebSocket,
    predicate: (event: unknown): event is WsEvent => {
      const e = event as WsEvent;
      return (
        e?.type === 'user_turn' &&
        e.conversationId === startResponse?.conversationId &&
        e.inflightId === startResponse?.inflightId
      );
    },
    timeoutMs: 4000,
  });

  assert.equal(userTurn.content, expected);
});
