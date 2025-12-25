import assert from 'node:assert/strict';
import test from 'node:test';

import type { LMStudioClient } from '@lmstudio/sdk';
import type { ThreadEvent } from '@openai/codex-sdk';

import type { CodexLike } from '../../chat/interfaces/ChatInterfaceCodex.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
import { createChatCancelRouter } from '../../routes/chatCancel.js';
import {
  messageType,
  openWs,
  sendJson,
  startWsTestServer,
  type WsJson,
  waitForMessage,
  waitForOpen,
} from './wsTestUtils.js';

class HangingThread {
  async runStreamed(
    input: string,
    opts?: { signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    assert.equal(typeof input, 'string');
    const signal = opts?.signal;
    async function* generator(): AsyncGenerator<ThreadEvent> {
      yield { type: 'thread.started', thread_id: 'thread-1' } as ThreadEvent;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 60_000);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
    return { events: generator() };
  }
}

class MockCodex {
  startThread() {
    return new HangingThread();
  }
  resumeThread() {
    return new HangingThread();
  }
}

test('POST /chat returns 409 RUN_IN_PROGRESS when a run is already active', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const server = await startWsTestServer({
    mount: (app) => {
      app.use(
        '/chat',
        createChatRouter({
          clientFactory: () => ({}) as unknown as LMStudioClient,
          codexFactory: () => new MockCodex() as unknown as CodexLike,
        }),
      );
      app.use('/chat', createChatCancelRouter());
    },
  });

  try {
    const ws = openWs(server.wsUrl);
    await waitForOpen(ws);
    sendJson(ws, {
      type: 'subscribe_conversation',
      requestId: 'r1',
      conversationId: 'c1',
    });
    await waitForMessage<WsJson>(ws, (m) => messageType(m) === 'ack');

    const controller = new AbortController();
    const first = fetch(`${server.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        conversationId: 'c1',
        inflightId: 'i1',
        cancelOnDisconnect: false,
        message: 'Hi',
      }),
      signal: controller.signal,
    });

    await waitForMessage<WsJson>(
      ws,
      (m) => {
        if (m.type !== 'inflight_snapshot') return false;
        if (!m.inflight || typeof m.inflight !== 'object') return false;
        return (m.inflight as Record<string, unknown>).inflightId === 'i1';
      },
      5000,
    );

    const second = await fetch(`${server.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        conversationId: 'c1',
        inflightId: 'i2',
        message: 'Hi again',
      }),
    });

    assert.equal(second.status, 409);
    const body = await second.json();
    assert.equal(body.error, 'conflict');
    assert.equal(body.code, 'RUN_IN_PROGRESS');

    await fetch(`${server.baseUrl}/chat/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'c1', inflightId: 'i1' }),
    });

    controller.abort();
    await first.catch(() => undefined);
  } finally {
    await server.close();
  }
});
