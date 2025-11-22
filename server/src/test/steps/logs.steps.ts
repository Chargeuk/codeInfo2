import assert from 'assert';
import type { Server } from 'http';
import type { Readable } from 'node:stream';
import {
  After,
  Before,
  Given,
  Then,
  When,
  type DataTable,
} from '@cucumber/cucumber';
import cors from 'cors';
import express from 'express';
import fetch, { type Response as FetchResponse } from 'node-fetch';
import { resetStore } from '../../logStore.js';
import { createRequestLogger } from '../../logger.js';
import { createLogsRouter } from '../../routes/logs.js';

let server: Server | null = null;
let baseUrl = '';
type ApiResponse = { status: number; body: unknown | null } | null;
let lastResponse: ApiResponse = null;
let streamAbort: AbortController | null = null;
let streamResponse: FetchResponse | null = null;
let streamHeartbeats = 0;
let streamEvents: string[] = [];

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(createRequestLogger());
  app.use((req, res, next) => {
    const requestId = (req as unknown as { id?: string }).id;
    if (requestId) res.locals.requestId = requestId;
    next();
  });
  app.use('/logs', createLogsRouter());

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
}

Before(async () => {
  resetStore();
  await startServer();
});

After(() => {
  if (streamAbort) {
    streamAbort.abort();
    streamAbort = null;
  }
  const streamBody = streamResponse?.body as unknown as Readable | undefined;
  if (streamBody) {
    streamBody.removeAllListeners?.();
    streamBody.destroy?.();
  }
  streamResponse = null;
  streamEvents = [];
  streamHeartbeats = 0;
  if (server) {
    server.close();
    server = null;
  }
  resetStore();
});

async function postJson(path: string, body: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  lastResponse = { status: res.status, body: json };
}

async function getPath(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  lastResponse = { status: res.status, body: json };
}

function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs)
        return reject(new Error('Timed out waiting for condition'));
      setTimeout(check, 50);
    };
    check();
  });
}

When('I POST {string} with body:', async (path: string, body: string) => {
  await postJson(path, body);
});

When('I POST an oversize log payload', async () => {
  const payload = {
    level: 'info',
    message: 'x'.repeat(33_000),
    timestamp: '2025-01-01T00:00:00.000Z',
    source: 'client',
  };
  await postJson('/logs', JSON.stringify(payload));
});

Given('these logs exist:', async (table: DataTable) => {
  for (const row of table.hashes()) {
    const payload = {
      level: row.level,
      message: row.message,
      timestamp: '2025-01-01T00:00:00.000Z',
      source: row.source,
    };
    await postJson('/logs', JSON.stringify(payload));
    assert.equal(lastResponse?.status, 202);
  }
});

When('I GET {string} from logs API', async (path: string) => {
  await getPath(path);
});

When('I start the log stream', async () => {
  streamHeartbeats = 0;
  streamEvents = [];
  streamAbort = new AbortController();
  const res = await fetch(`${baseUrl}/logs/stream`, {
    signal: streamAbort.signal,
    headers: { Accept: 'text/event-stream' },
  });
  streamResponse = res;
  if (!res.body) throw new Error('Expected stream body');
  res.body.setEncoding('utf8');
  let buffer = '';
  res.body.on('data', (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      if (!part.trim()) continue;
      if (part.startsWith(':')) {
        streamHeartbeats += 1;
        continue;
      }
      const dataLine = part
        .split('\n')
        .find((line) => line.startsWith('data: '));
      if (dataLine) {
        streamEvents.push(dataLine.replace('data: ', '').trim());
      }
    }
  });
});

Then('the log response status code is {int}', (status: number) => {
  assert(lastResponse, 'expected response');
  assert.equal(lastResponse.status, status);
});

Then(
  'the log response field {string} is greater than {int}',
  (field: string, compare: number) => {
    assert(lastResponse?.body, 'expected response body');
    const value = (lastResponse.body as Record<string, unknown>)[field];
    assert(typeof value === 'number');
    assert(value > compare, `${field} expected > ${compare}`);
  },
);

Then('all returned log levels are {string}', (expected: string) => {
  assert(lastResponse?.body, 'expected response body');
  const items = (lastResponse.body as { items?: { level: string }[] }).items;
  assert(Array.isArray(items), 'expected items array');
  items.forEach((item) => assert.equal(item.level, expected));
});

Then('I receive a heartbeat and an SSE log event', async () => {
  await waitFor(() => streamHeartbeats > 0 && streamEvents.length > 0, 5000);
  const first = streamEvents[0];
  assert(first, 'expected SSE event');
  const parsed = JSON.parse(first) as { message?: string };
  assert.equal(parsed.message, 'stream me');
});

Then('the latest log context redacts passwords', () => {
  assert(lastResponse?.body, 'expected response body');
  const body = lastResponse.body as {
    items?: { context?: Record<string, unknown> }[];
  };
  const items = body.items;
  assert(Array.isArray(items), 'expected items array');
  const latest = items[items.length - 1];
  assert(latest?.context, 'expected context');
  const context = latest.context as Record<string, unknown>;
  assert.equal(context.password, '[redacted]');
  assert.equal(context.note, 'ok');
});
