import assert from 'assert';
import type { Server } from 'http';
import { chatRequestFixture } from '@codeinfo2/common';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import { createRequestLogger } from '../../logger.js';
import { createChatRouter } from '../../routes/chat.js';
import {
  MockLMStudioClient,
  type MockScenario,
  getLastPredictionState,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';

let server: Server | null = null;
let baseUrl = '';
let events: unknown[] = [];
let statusCode: number | null = null;

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
  if (server) {
    server.close();
    server = null;
  }
  events = [];
  statusCode = null;
});

Given('chat cancellation scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

When('I start a chat stream and abort after first token', async () => {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatRequestFixture),
    signal: controller.signal,
  });

  statusCode = res.status;
  const reader = res.body?.getReader();
  if (!reader) return;

  try {
    const { value } = await reader.read();
    if (value) {
      const decoder = new TextDecoder();
      const chunk = decoder.decode(value, { stream: true });
      chunk
        .split('\n\n')
        .map((frame) => frame.trim())
        .filter((frame) => frame && !frame.startsWith(':'))
        .forEach((frame) => {
          const payload = frame.startsWith('data:')
            ? frame.slice(5).trim()
            : frame;
          try {
            events.push(JSON.parse(payload));
          } catch {
            // ignore parse errors for malformed frames
          }
        });
    }
    controller.abort();
  } catch (err) {
    const name = (err as { name?: string } | undefined)?.name;
    if (name !== 'AbortError') {
      throw err;
    }
  }
});

Then('the chat prediction is cancelled server side', async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  const state = getLastPredictionState();
  assert(state, 'prediction state missing');
  assert.strictEqual(state.cancelled, true);
});

Then('the streamed events stop before completion', () => {
  const types = events.map((event) => (event as { type?: string }).type);
  assert(!types.includes('complete'), 'should not emit complete after abort');
  assert(!types.includes('final'), 'should not emit final after abort');
  assert.strictEqual(statusCode, 200);
});
