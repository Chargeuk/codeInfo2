import assert from 'assert';
import type { Server } from 'http';
import { chatRequestFixture } from '@codeinfo2/common';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import { query, resetStore } from '../../logStore.js';
import { createRequestLogger } from '../../logger.js';
import { createChatRouter } from '../../routes/chat.js';
import {
  MockLMStudioClient,
  startMock,
  stopMock,
  type MockScenario,
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

Given('chat visibility scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

When('I stream the chat endpoint with the chat request fixture', async () => {
  const res = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatRequestFixture),
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
        // ignore parse errors
      }
    });
  }
});

Then('the streamed tool events include call id and name', () => {
  assert.strictEqual(statusCode, 200);
  const request =
    events.find(
      (event) =>
        (event as { type?: string }).type === 'tool-request' &&
        typeof (event as { name?: unknown }).name === 'string',
    ) ??
    events.find((event) => (event as { type?: string }).type === 'tool-result');

  assert.ok(request, 'expected tool-request event');
  const callId = (request as { callId?: string | number }).callId;
  assert.equal(String(callId), 'call-1');
  assert.equal((request as { name?: string }).name, 'VectorSearch');

  const logs = query({ text: 'chat tool event' });
  assert(logs.length > 0, 'expected tool events logged');
});

Then('the streamed tool result includes path and repo metadata', () => {
  const result = events.find(
    (event) => (event as { type?: string }).type === 'tool-result',
  );
  assert.ok(result, 'expected tool-result event');
  const payload = (result as { result?: unknown }).result as
    | { results?: Array<Record<string, unknown>> }
    | undefined;
  assert(payload && Array.isArray(payload.results), 'expected results array');
  const first = payload.results?.[0];
  assert.equal(first?.repo, 'repo');
  assert.equal(first?.relPath, 'main.txt');
  assert.equal(first?.hostPath, '/host/repo/main.txt');
});
