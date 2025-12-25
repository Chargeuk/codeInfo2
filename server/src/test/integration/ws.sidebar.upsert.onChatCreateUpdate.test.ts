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
  async runStreamed(): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    async function* generator(): AsyncGenerator<ThreadEvent> {
      yield { type: 'thread.started', thread_id: 't1' } as ThreadEvent;
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Hi' },
      } as ThreadEvent;
      yield { type: 'turn.completed' } as ThreadEvent;
    }
    return { events: generator() };
  }
}

class MockCodex {
  startThread() {
    return new MockThread();
  }
  resumeThread() {
    return new MockThread();
  }
}

test('sidebar receives conversation_upsert on REST chat create/update', async () => {
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

    sendJson(ws, { type: 'subscribe_sidebar', requestId: 'r1' });
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'ack' && messageString(m, 'requestId') === 'r1',
    );

    await fetch(`${server.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        conversationId: 'c1',
        inflightId: 'i1',
        message: 'Hi',
      }),
    }).then((r) => r.text());

    const first = await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'conversation_upsert' &&
        (m.conversation as Record<string, unknown>).conversationId === 'c1',
      5000,
    );

    await fetch(`${server.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        conversationId: 'c1',
        inflightId: 'i2',
        message: 'Again',
      }),
    }).then((r) => r.text());

    const second = await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'conversation_upsert' &&
        (m.conversation as Record<string, unknown>).conversationId === 'c1' &&
        m.seq !== first.seq,
      5000,
    );

    assert.equal(typeof first.seq, 'number');
    assert.equal(typeof second.seq, 'number');
    const firstSeq = first.seq as number;
    const secondSeq = second.seq as number;
    assert.equal(secondSeq > firstSeq, true);
    assert.equal(
      typeof (second.conversation as Record<string, unknown>).lastMessageAt,
      'string',
    );
  } finally {
    await server.close();
  }
});
