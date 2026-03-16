import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';
import WebSocket, { type RawData } from 'ws';

import { runAgentCommandRunner } from '../../agents/commandsRunner.js';
import {
  cleanupInflight,
  createInflight,
} from '../../chat/inflightRegistry.js';
import {
  __resetIngestJobsForTest,
  __setStatusAndPublishForTest,
  __setStatusForTest,
  type IngestJobStatus,
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
      flowName: 'flow-alpha',
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
    assert.equal(
      (event.conversation as Record<string, unknown>).flowName,
      'flow-alpha',
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

test('WS conversation_upsert payload preserves flags.workingFolder', async () => {
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
        requestId: 'req-working-folder',
        type: 'subscribe_sidebar',
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 25));

    emitConversationUpsert({
      conversationId: 'c-working-folder',
      provider: 'lmstudio',
      model: 'model',
      title: 'Title',
      source: 'REST',
      lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
      archived: false,
      flags: { workingFolder: '/repos/working-root' },
    });

    const payload = await waitForMessage(ws);
    const event = JSON.parse(payload) as {
      conversation: { flags: Record<string, unknown> };
    };

    assert.deepEqual(event.conversation.flags, {
      workingFolder: '/repos/working-root',
    });
  } finally {
    ws.close();
    await waitForClose(ws);
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

test('WS cancel_inflight accepts payload with conversationId only', async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId: 'c-only' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    sendJson(ws, {
      type: 'cancel_inflight',
      conversationId: 'c-only',
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(ws.readyState, WebSocket.OPEN);
    assert.ok(
      query({
        text: '[DEV-0000038][T1] CANCEL_INFLIGHT_RECEIVED conversationId=c-only inflightId=none',
      }).length > 0,
    );
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('WS cancel_inflight accepts payload with conversationId and inflightId', async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId: 'c-both' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    sendJson(ws, {
      type: 'cancel_inflight',
      conversationId: 'c-both',
      inflightId: 'i-both',
    });

    const final = await waitForEvent({
      ws,
      predicate: (
        payload,
      ): payload is { type: string; error?: { code?: string } } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'turn_final',
      timeoutMs: 1000,
    });
    assert.equal(final.error?.code, 'INFLIGHT_NOT_FOUND');
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('WS cancel_inflight with wrong active inflightId keeps explicit invalid-target failure behavior', async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });
  const conversationId = 'c-wrong-active-target';

  createInflight({
    conversationId,
    inflightId: 'active-inflight',
  });

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    await new Promise((resolve) => setTimeout(resolve, 10));

    sendJson(ws, {
      type: 'cancel_inflight',
      conversationId,
      inflightId: 'wrong-inflight',
    });

    const final = await waitForEvent({
      ws,
      predicate: (
        payload,
      ): payload is { type: string; error?: { code?: string } } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'turn_final',
      timeoutMs: 1000,
    });

    assert.equal(final.error?.code, 'INFLIGHT_NOT_FOUND');
  } finally {
    cleanupInflight({ conversationId });
    await closeWs(ws);
    await stopServer(server);
  }
});

test('WS cancel_inflight rejects malformed payloads', async () => {
  {
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
          requestId: 'req-malformed-1',
          type: 'cancel_inflight',
        }),
      );
      const closed = await waitForClose(ws);
      assert.equal(closed.code, 1008);
    } finally {
      await stopServer(server);
    }
  }

  {
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
          requestId: 'req-malformed-2',
          type: 'cancel_inflight',
          conversationId: 'c1',
          inflightId: '',
        }),
      );
      const closed = await waitForClose(ws);
      assert.equal(closed.code, 1008);
    } finally {
      await stopServer(server);
    }
  }

  assert.equal(
    query({
      text: '[DEV-0000038][T1] ABORT_AGENT_RUN_REQUESTED',
    }).length,
    0,
  );
});

test('WS conversation-only cancel does not emit INFLIGHT_NOT_FOUND turn_final', async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });
  const conversationId = 'c-no-inflight-final';

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    await new Promise((resolve) => setTimeout(resolve, 10));

    sendJson(ws, { type: 'cancel_inflight', conversationId });

    const ack = await waitForEvent({
      ws,
      predicate: (
        payload,
      ): payload is {
        type: string;
        conversationId?: string;
        result?: string;
      } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'cancel_ack',
      timeoutMs: 1000,
    });

    assert.equal(ack.conversationId, conversationId);
    assert.equal(ack.result, 'noop');

    await assert.rejects(
      waitForEvent({
        ws,
        predicate: (
          payload,
        ): payload is { type: string; error?: { code?: string } } =>
          typeof payload === 'object' &&
          payload !== null &&
          (payload as { type?: string }).type === 'turn_final',
        timeoutMs: 300,
      }),
    );
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('WS conversation-only cancel_ack requestId matches the initiating request', async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });
  const conversationId = 'c-noop-request-correlation';

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const { requestId } = sendJson(ws, {
      type: 'cancel_inflight',
      conversationId,
    });

    const ack = await waitForEvent({
      ws,
      predicate: (
        payload,
      ): payload is { type: string; requestId?: string; result?: string } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'cancel_ack',
      timeoutMs: 1000,
    });

    assert.equal(ack.requestId, requestId);
    assert.equal(ack.result, 'noop');
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('WS conversation-only cancel attempts command abort by conversationId', async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });
  const conversationId = 'c-conversation-only-abort';

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    await new Promise((resolve) => setTimeout(resolve, 10));

    sendJson(ws, { type: 'cancel_inflight', conversationId });
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.ok(
      query({
        text: `[DEV-0000038][T1] ABORT_AGENT_RUN_REQUESTED conversationId=${conversationId}`,
      }).length > 0,
    );
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('WS conversation-only cancel emits no invalid-target final while an agent command run is active', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ws-server-command-cancel-'),
  );
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });
  const conversationId = 'c-command-active-cancel';

  try {
    const agentHome = path.join(tmpDir, 'agent-a');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(agentHome, 'commands', 'wait.json'),
      JSON.stringify({
        Description: 'Wait for stop',
        items: [{ type: 'message', role: 'user', content: ['step 1'] }],
      }),
      'utf-8',
    );

    let resolveAbortWait: (() => void) | undefined;
    let started: (() => void) | undefined;
    const stepStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const abortObserved = new Promise<void>((resolve) => {
      resolveAbortWait = resolve;
    });

    const runPromise = runAgentCommandRunner({
      agentName: 'agent-a',
      agentHome,
      commandName: 'wait',
      conversationId,
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        started?.();
        params.signal?.addEventListener('abort', () => resolveAbortWait?.(), {
          once: true,
        });
        await abortObserved;
        return { modelId: 'm1' };
      },
    });

    await stepStarted;
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    await new Promise((resolve) => setTimeout(resolve, 10));

    sendJson(ws, { type: 'cancel_inflight', conversationId });
    await runPromise;

    assert.ok(
      query({
        text: `[DEV-0000038][T1] ABORT_AGENT_RUN_REQUESTED conversationId=${conversationId}`,
      }).length > 0,
    );
    await assert.rejects(
      waitForEvent({
        ws,
        predicate: (
          payload,
        ): payload is { type: string; error?: { code?: string } } =>
          typeof payload === 'object' &&
          payload !== null &&
          (payload as { type?: string }).type === 'turn_final',
        timeoutMs: 300,
      }),
    );
  } finally {
    await closeWs(ws);
    await stopServer(server);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('WS explicit cancel for an active command-step inflight stops the command run completely', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ws-server-command-explicit-stop-'),
  );
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });
  const conversationId = 'c-command-explicit-stop';
  const inflightId = 'command-step-1';

  try {
    const agentHome = path.join(tmpDir, 'agent-a');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(agentHome, 'commands', 'wait.json'),
      JSON.stringify({
        Description: 'Wait for explicit stop',
        items: [
          { type: 'message', role: 'user', content: ['step 1'] },
          { type: 'message', role: 'user', content: ['step 2'] },
        ],
      }),
      'utf-8',
    );

    let startedStepOne: (() => void) | undefined;
    const stepOneStarted = new Promise<void>((resolve) => {
      startedStepOne = resolve;
    });
    const calls: number[] = [];

    const runPromise = runAgentCommandRunner({
      agentName: 'agent-a',
      agentHome,
      commandName: 'wait',
      conversationId,
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        const stepIndex = params.command?.stepIndex ?? -1;
        calls.push(stepIndex);
        if (stepIndex === 1) {
          createInflight({
            conversationId,
            inflightId,
            command: { name: 'wait', stepIndex: 1, totalSteps: 2 },
          });
          startedStepOne?.();
          await new Promise<void>((resolve) => {
            params.signal?.addEventListener(
              'abort',
              () => {
                cleanupInflight({ conversationId });
                resolve();
              },
              { once: true },
            );
          });
        }
        return { modelId: 'm1' };
      },
    });

    await stepOneStarted;
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    await new Promise((resolve) => setTimeout(resolve, 10));

    sendJson(ws, {
      type: 'cancel_inflight',
      conversationId,
      inflightId,
    });

    await runPromise;
    assert.deepEqual(calls, [1]);
    await assert.rejects(
      waitForEvent({
        ws,
        predicate: (
          payload,
        ): payload is { type: string; error?: { code?: string } } =>
          typeof payload === 'object' &&
          payload !== null &&
          (payload as { type?: string }).type === 'turn_final',
        timeoutMs: 300,
      }),
    );
  } finally {
    cleanupInflight({ conversationId });
    await closeWs(ws);
    await stopServer(server);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('WS explicit cancel with wrong inflightId does not abort an active command run', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ws-server-command-wrong-explicit-stop-'),
  );
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = await connectWs({ baseUrl });
  const conversationId = 'c-command-wrong-explicit-stop';
  const activeInflightId = 'command-step-1-active';

  try {
    const agentHome = path.join(tmpDir, 'agent-a');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(agentHome, 'commands', 'continue.json'),
      JSON.stringify({
        Description: 'Continue after invalid target',
        items: [
          { type: 'message', role: 'user', content: ['step 1'] },
          { type: 'message', role: 'user', content: ['step 2'] },
        ],
      }),
      'utf-8',
    );

    let startedStepOne: (() => void) | undefined;
    let allowStepOneToFinish: (() => void) | undefined;
    const stepOneStarted = new Promise<void>((resolve) => {
      startedStepOne = resolve;
    });
    const continueAfterFailure = new Promise<void>((resolve) => {
      allowStepOneToFinish = resolve;
    });
    const calls: number[] = [];

    const runPromise = runAgentCommandRunner({
      agentName: 'agent-a',
      agentHome,
      commandName: 'continue',
      conversationId,
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        const stepIndex = params.command?.stepIndex ?? -1;
        calls.push(stepIndex);
        if (stepIndex === 1) {
          createInflight({
            conversationId,
            inflightId: activeInflightId,
            command: { name: 'continue', stepIndex: 1, totalSteps: 2 },
          });
          startedStepOne?.();
          await continueAfterFailure;
          cleanupInflight({ conversationId });
        }
        return { modelId: 'm1' };
      },
    });

    await stepOneStarted;
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    await new Promise((resolve) => setTimeout(resolve, 10));

    sendJson(ws, {
      type: 'cancel_inflight',
      conversationId,
      inflightId: 'wrong-inflight-id',
    });

    const final = await waitForEvent({
      ws,
      predicate: (
        payload,
      ): payload is { type: string; error?: { code?: string } } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'turn_final',
      timeoutMs: 1000,
    });

    assert.equal(final.error?.code, 'INFLIGHT_NOT_FOUND');
    allowStepOneToFinish?.();
    await runPromise;
    assert.deepEqual(calls, [1, 2]);
  } finally {
    cleanupInflight({ conversationId });
    await closeWs(ws);
    await stopServer(server);
    await fs.rm(tmpDir, { recursive: true, force: true });
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
    ast: { supportedFileCount: 2, skippedFileCount: 0, failedFileCount: 0 },
    message: 'Embedding',
    lastError: null,
  });

  try {
    sendJson(ws, { type: 'subscribe_ingest' });
    const event = await waitForEvent({
      ws,
      predicate: (
        payload,
      ): payload is { type: string; status: IngestJobStatus } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'ingest_snapshot',
    });

    assert.equal(event.status.runId, runId);
    assert.equal(event.status.ast?.supportedFileCount, 2);
    assert.equal(event.status.ast?.skippedFileCount, 0);
    assert.equal(event.status.ast?.failedFileCount, 0);
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
      ast: { supportedFileCount: 1, skippedFileCount: 0, failedFileCount: 0 },
      message: 'Embedding',
      lastError: null,
    });

    const event = await waitForEvent({
      ws,
      predicate: (
        payload,
      ): payload is { type: string; status: IngestJobStatus } =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { type?: string }).type === 'ingest_update',
    });

    assert.equal(event.status.state, 'embedding');
    assert.equal(event.status.ast?.supportedFileCount, 1);
    assert.equal(event.status.ast?.skippedFileCount, 0);
    assert.equal(event.status.ast?.failedFileCount, 0);
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
