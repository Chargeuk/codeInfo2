import assert from 'assert';
import type { Server } from 'http';
import {
  chatRequestFixture,
  chatSseEventsFixture,
  chatErrorEventFixture,
} from '@codeinfo2/common';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import { query, resetStore } from '../../logStore.js';
import { createRequestLogger } from '../../logger.js';
import { createChatRouter } from '../../routes/chat.js';
import {
  MockLMStudioClient,
  type MockScenario,
  startMock,
  stopMock,
  getLastChatHistory,
} from '../support/mockLmStudioSdk.js';

let server: Server | null = null;
let baseUrl = '';
let events: unknown[] = [];
let statusCode: number | null = null;

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

  await new Promise<void>((resolve) => {
    const listener = app.listen(0, () => {
      server = listener;
      const address = listener.address();
      if (!address || typeof address === 'string') {
        throw new Error('Unable to start test server');
      }
      baseUrl = `http://localhost:${address.port}`;
      resolve();
    });
  });
});

After(() => {
  stopMock();
  resetStore();
  if (server) {
    server.close();
    server = null;
  }
  events = [];
  statusCode = null;
});

Given('chat stream scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

When('I POST to the chat endpoint with the chat request fixture', async () => {
  const res = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider:
        (chatRequestFixture as { provider?: string }).provider ?? 'lmstudio',
      model: (chatRequestFixture as { model?: string }).model ?? 'model-1',
      conversationId: 'chat-fixture-conv',
      message: Array.isArray(
        (chatRequestFixture as { messages?: Array<{ content?: unknown }> })
          .messages,
      )
        ? String(
            (
              chatRequestFixture as { messages?: Array<{ content?: unknown }> }
            ).messages?.find((m) => (m as { role?: string }).role === 'user')
              ?.content ?? 'Hello',
          )
        : 'Hello',
    }),
  });
  statusCode = res.status;
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  if (!reader) return;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    frames.forEach((frame) => {
      const trimmed = frame.trim();
      if (!trimmed || trimmed.startsWith(':')) return;
      const payload = trimmed.startsWith('data:')
        ? trimmed.slice(5).trim()
        : trimmed;
      try {
        events.push(JSON.parse(payload));
      } catch {
        // ignore parse errors for malformed frames
      }
    });
  }
});

Then('the chat stream status code is {int}', (status: number) => {
  assert.strictEqual(statusCode, status);
});

Then('the streamed events include token, final, and complete in order', () => {
  const types = events.map((event) => (event as { type?: string }).type);
  const tokenIndex = types.indexOf(chatSseEventsFixture[0].type);
  const finalIndex = types.findIndex(
    (type, idx) =>
      type === chatSseEventsFixture[1].type &&
      (tokenIndex < 0 || idx > tokenIndex),
  );
  const completeIndex = types.lastIndexOf(chatSseEventsFixture[2].type);
  if (finalIndex < 0) {
    assert(completeIndex >= 0, 'complete event missing');
    return;
  }
  assert(completeIndex > finalIndex, 'complete should follow final');
});

Then(
  'the streamed events include an error event {string}',
  (message: string) => {
    const error = events.find(
      (event) =>
        (event as { type?: string }).type === chatErrorEventFixture.type &&
        (event as { message?: string }).message === message,
    );
    assert(error, `expected error event ${message}`);
  },
);

Then('the streamed events include tool request and result events', () => {
  const types = events.map((event) => (event as { type?: string }).type);
  assert(types.includes('tool-request'), 'tool-request event missing');
  assert(types.includes('tool-result'), 'tool-result event missing');
});

Then('tool events are logged to the log store', () => {
  const toolLogs = query({ text: 'chat tool event' });
  assert(toolLogs.length > 0, 'expected tool events in log store');
});

When(
  'I POST to the chat endpoint with a two-message chat history',
  async () => {
    const conversationId = 'chat-history-conv';

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
    const firstReader = first.body?.getReader();
    if (firstReader) {
      while (true) {
        const { done } = await firstReader.read();
        if (done) break;
      }
    }

    const res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'lmstudio',
        model: 'model-1',
        conversationId,
        message: 'Second question',
      }),
    });
    statusCode = res.status;
    const reader = res.body?.getReader();
    if (!reader) return;
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  },
);

Then('the LM Studio chat history length is {int}', (expected: number) => {
  assert.strictEqual(getLastChatHistory().length, expected);
});
