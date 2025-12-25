import assert from 'node:assert/strict';
import test from 'node:test';

import type { LMStudioClient } from '@lmstudio/sdk';
import type { ThreadEvent } from '@openai/codex-sdk';

import type { CodexLike } from '../../chat/interfaces/ChatInterfaceCodex.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
import { createChatCancelRouter } from '../../routes/chatCancel.js';
import {
  messageString,
  messageType,
  openWs,
  sendJson,
  startWsTestServer,
  type WsJson,
  waitForMessage,
  waitForOpen,
} from './wsTestUtils.js';

class MockThread {
  constructor(private readonly id: string) {}

  async runStreamed(
    _input: string,
    opts?: { signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    const threadId = this.id;
    const signal = opts?.signal;

    async function* generator(): AsyncGenerator<ThreadEvent> {
      yield { type: 'thread.started', thread_id: threadId } as ThreadEvent;
      let text = '';

      const abortableDelay = (ms: number) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms);
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });

      for (let i = 0; i < 50; i++) {
        if (signal?.aborted) break;
        await abortableDelay(50);
        text += '.';
        yield {
          type: 'item.updated',
          item: { type: 'agent_message', text },
        } as ThreadEvent;
      }
    }

    return { events: generator() };
  }
}

class MockCodex {
  startThread() {
    return new MockThread('thread-1');
  }

  resumeThread() {
    return new MockThread('thread-1');
  }
}

test('POST /chat/cancel cancels an active inflight (happy path)', async () => {
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
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'ack' && messageString(m, 'requestId') === 'r1',
    );

    const controller = new AbortController();
    const chatPromise = fetch(`${server.baseUrl}/chat`, {
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
        if (messageType(m) !== 'inflight_snapshot') return false;
        if (!m.inflight || typeof m.inflight !== 'object') return false;
        return (m.inflight as Record<string, unknown>).inflightId === 'i1';
      },
      5000,
    );

    controller.abort();
    await chatPromise.catch(() => undefined);

    const res = await fetch(`${server.baseUrl}/chat/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'c1', inflightId: 'i1' }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, 'ok');

    const final = await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'turn_final' && m.status === 'stopped',
      5000,
    );
    assert.equal(final.inflightId, 'i1');
  } finally {
    await server.close();
  }
});
