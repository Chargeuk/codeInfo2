import assert from 'node:assert/strict';
import test from 'node:test';

import type { LMStudioClient } from '@lmstudio/sdk';
import type { ThreadEvent } from '@openai/codex-sdk';

import type { CodexLike } from '../../chat/interfaces/ChatInterfaceCodex.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
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
    input: string,
    opts?: { signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    assert.equal(typeof input, 'string');
    if (opts?.signal?.aborted) {
      throw new Error('unexpected abort in detach test');
    }
    const threadId = this.id;
    async function* generator(): AsyncGenerator<ThreadEvent> {
      yield { type: 'thread.started', thread_id: threadId } as ThreadEvent;
      yield {
        type: 'item.updated',
        item: { type: 'agent_message', text: 'A' },
      } as ThreadEvent;
      await new Promise((r) => setTimeout(r, 50));
      yield {
        type: 'item.updated',
        item: { type: 'agent_message', text: 'AB' },
      } as ThreadEvent;
      await new Promise((r) => setTimeout(r, 50));
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'AB' },
      } as ThreadEvent;
      yield { type: 'turn.completed' } as ThreadEvent;
    }
    return { events: generator() };
  }
}

class MockCodex {
  startThread() {
    return new MockThread('thread-1');
  }
  resumeThread(threadId: string) {
    return new MockThread(threadId);
  }
}

test('POST /chat detach semantics keep run alive when cancelOnDisconnect=false', async () => {
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
    const chatReq = fetch(`${server.baseUrl}/chat`, {
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

    controller.abort();
    await chatReq.catch(() => undefined);

    await waitForMessage<WsJson>(
      ws,
      (m) =>
        m.type === 'assistant_delta' &&
        typeof m.delta === 'string' &&
        m.delta.length > 0,
      5000,
    );
    const final = await waitForMessage<WsJson>(
      ws,
      (m) => m.type === 'turn_final' && m.inflightId === 'i1',
      5000,
    );
    assert.equal(final.status, 'ok');
  } finally {
    await server.close();
  }
});
