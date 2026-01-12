import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import express from 'express';
import WebSocket, { type RawData } from 'ws';

import {
  __resetIngestJobsForTest,
  __setStatusAndPublishForTest,
  __setStatusForTest,
} from '../../ingest/ingestJob.js';
import { query, resetStore } from '../../logStore.js';
import {
  emitConversationUpsert,
  type ConversationEventSummary,
} from '../../mongo/events.js';
import { attachWs, publishTurnFinal } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

const ORIGINAL_ENV = process.env.NODE_ENV;

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve());
  });

  const address = httpServer.address();
  assert(address && typeof address === 'object');
  return {
    port: address.port,
    httpServer,
    wsHandle,
  };
}

async function stopServer(params: {
  httpServer: http.Server;
  wsHandle: { close: () => Promise<void> };
}) {
  await params.wsHandle.close();
  await new Promise<void>((resolve) =>
    params.httpServer.close(() => resolve()),
  );
}

function waitForMessage(ws: WebSocket) {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WS message'));
    }, 1000);

    const onMessage = (data: RawData) => {
      cleanup();
      resolve(rawDataToString(data));
    };
    const onError = (err: unknown) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function waitForClose(ws: WebSocket) {
  return new Promise<{ code: number; reason: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeAllListeners('close');
      reject(new Error('Timed out waiting for WS close'));
    }, 1000);

    ws.once('close', (code, rawReason) => {
      clearTimeout(timeout);
      resolve({ code, reason: rawReason.toString() });
    });
  });
}

test.beforeEach(() => {
  resetStore();
  process.env.NODE_ENV = 'test';
  __resetIngestJobsForTest();
});

test.afterEach(() => {
  __resetIngestJobsForTest();
  process.env.NODE_ENV = ORIGINAL_ENV;
});

test('WS accepts connection on /ws and processes JSON message (happy path)', async () => {
  const server = await startServer();
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);

  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    ws.send(
      JSON.stringify({
        protocolVersion: 'v1',
        requestId: 'req-1',
        type: 'subscribe_sidebar',
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(query({ text: 'chat.ws.subscribe_sidebar' }).length > 0);

    const conversation: ConversationEventSummary = {
      conversationId: 'c-1',
      provider: 'lmstudio',
      model: 'model',
      title: 'Title',
      source: 'REST',
      lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
      archived: false,
      flags: {},
    };

    emitConversationUpsert(conversation);
    const payload = await waitForMessage(ws);
    const event = JSON.parse(payload) as Record<string, unknown>;

    assert.equal(event.protocolVersion, 'v1');
    assert.equal(event.type, 'conversation_upsert');
    assert.equal(typeof event.seq, 'number');
    assert.equal(
      (event.conversation as Record<string, unknown>).conversationId,
      'c-1',
    );
  } finally {
    ws.close();
    await waitForClose(ws);
    await stopServer(server);
  }
});

test('WS invalid/missing protocolVersion closes socket', async () => {
  const server = await startServer();
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);

  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    ws.send(
      JSON.stringify({
        requestId: 'req-1',
        type: 'subscribe_sidebar',
      }),
    );

    const closed = await waitForClose(ws);
    assert.equal(closed.code, 1008);
  } finally {
    await stopServer(server);
  }
});

test('WS malformed JSON closes socket', async () => {
  const server = await startServer();
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);

  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    ws.send('{');

    const closed = await waitForClose(ws);
    assert.equal(closed.code, 1008);
  } finally {
    await stopServer(server);
  }
});

test('WS unknown message type is ignored (connection stays open)', async () => {
  const server = await startServer();
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);

  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    ws.send(
      JSON.stringify({
        protocolVersion: 'v1',
        requestId: 'req-1',
        type: 'future_message',
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(ws.readyState, WebSocket.OPEN);

    ws.send(
      JSON.stringify({
        protocolVersion: 'v1',
        requestId: 'req-2',
        type: 'subscribe_sidebar',
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 25));

    emitConversationUpsert({
      conversationId: 'c-2',
      provider: 'lmstudio',
      model: 'model',
      title: 'Title',
      source: 'REST',
      lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
      archived: false,
      flags: {},
    });

    const payload = await waitForMessage(ws);
    const event = JSON.parse(payload) as Record<string, unknown>;
    assert.equal(event.type, 'conversation_upsert');
  } finally {
    ws.close();
    await waitForClose(ws);
    await stopServer(server);
  }
});

test('WS subscribe_conversation missing conversationId is rejected', async () => {
  const server = await startServer();
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);

  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    ws.send(
      JSON.stringify({
        protocolVersion: 'v1',
        requestId: 'req-1',
        type: 'subscribe_conversation',
      }),
    );

    const closed = await waitForClose(ws);
    assert.equal(closed.code, 1008);
  } finally {
    await stopServer(server);
  }
});

test('publishTurnFinal omits usage/timing when not provided', async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });
  const conversationId = 'ws-turn-final-omit-1';
  const inflightId = 'inflight-omit-1';

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    await new Promise((resolve) => setTimeout(resolve, 10));

    publishTurnFinal({
      conversationId,
      inflightId,
      status: 'ok',
    });

    const event = await waitForEvent({
      ws,
      predicate: (payload): payload is Record<string, unknown> =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string; conversationId?: string }).type ===
          'turn_final' &&
        (payload as { conversationId?: string }).conversationId ===
          conversationId,
    });

    assert.ok(!('usage' in event));
    assert.ok(!('timing' in event));
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('WS subscribe_ingest sends placeholder ingest_snapshot', async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });

  try {
    sendJson(ws, { type: 'subscribe_ingest' });
    const event = await waitForEvent({
      ws,
      predicate: (payload): payload is { type: string; status: null } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'ingest_snapshot',
    });

    assert.equal(event.status, null);
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('WS subscribe_ingest sends active ingest snapshot', async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });
  const runId = 'run-active';
  __setStatusForTest(runId, {
    runId,
    state: 'embedding',
    counts: { files: 2, chunks: 4, embedded: 1 },
    message: 'Embedding',
    lastError: null,
  });

  try {
    sendJson(ws, { type: 'subscribe_ingest' });
    const event = await waitForEvent({
      ws,
      predicate: (
        payload,
      ): payload is { type: string; status: { runId: string } } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'ingest_snapshot',
    });

    assert.equal(event.status.runId, runId);
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('WS ingest_update emitted on status change', async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });
  const runId = 'run-update';

  try {
    sendJson(ws, { type: 'subscribe_ingest' });
    await waitForEvent({
      ws,
      predicate: (payload): payload is { type: string } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'ingest_snapshot',
    });

    __setStatusAndPublishForTest(runId, {
      runId,
      state: 'embedding',
      counts: { files: 1, chunks: 1, embedded: 0 },
      message: 'Embedding',
      lastError: null,
    });

    const event = await waitForEvent({
      ws,
      predicate: (
        payload,
      ): payload is { type: string; status: { state: string } } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'ingest_update',
    });

    assert.equal(event.status.state, 'embedding');
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('WS ingest_update seq increases on subsequent updates', async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });
  const runId = 'run-seq';

  try {
    sendJson(ws, { type: 'subscribe_ingest' });
    await waitForEvent({
      ws,
      predicate: (payload): payload is { type: string } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'ingest_snapshot',
    });

    __setStatusAndPublishForTest(runId, {
      runId,
      state: 'scanning',
      counts: { files: 2, chunks: 0, embedded: 0 },
      message: 'Scanning',
      lastError: null,
    });

    const first = await waitForEvent({
      ws,
      predicate: (payload): payload is { type: string; seq: number } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'ingest_update',
    });

    __setStatusAndPublishForTest(runId, {
      runId,
      state: 'embedding',
      counts: { files: 2, chunks: 4, embedded: 1 },
      message: 'Embedding',
      lastError: null,
    });

    const second = await waitForEvent({
      ws,
      predicate: (payload): payload is { type: string; seq: number } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'ingest_update',
    });

    assert.ok(second.seq > first.seq);
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('WS unsubscribe_ingest stops ingest_update events', async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });
  const runId = 'run-unsubscribe';

  try {
    sendJson(ws, { type: 'subscribe_ingest' });
    await waitForEvent({
      ws,
      predicate: (payload): payload is { type: string } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'ingest_snapshot',
    });

    sendJson(ws, { type: 'unsubscribe_ingest' });

    await new Promise((resolve) => setTimeout(resolve, 25));

    let updateReceived = false;
    const onMessage = (raw: RawData) => {
      const payload = JSON.parse(rawDataToString(raw)) as { type?: string };
      if (payload.type === 'ingest_update') {
        updateReceived = true;
      }
    };

    ws.on('message', onMessage);
    __setStatusAndPublishForTest(runId, {
      runId,
      state: 'embedding',
      counts: { files: 1, chunks: 1, embedded: 0 },
      message: 'Embedding',
      lastError: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    ws.off('message', onMessage);

    assert.equal(updateReceived, false);
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});
