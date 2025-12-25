import assert from 'node:assert/strict';
import test from 'node:test';

import type { Conversation } from '../../mongo/conversation.js';
import { createConversationsRouter } from '../../routes/conversations.js';
import {
  messageType,
  openWs,
  sendJson,
  startWsTestServer,
  type WsJson,
  waitForMessage,
  waitForOpen,
} from './wsTestUtils.js';

test('POST /conversations/:id/restore emits sidebar conversation_upsert archived=false', async () => {
  const now = new Date('2025-01-01T00:00:00Z');
  const server = await startWsTestServer({
    mount: (app) => {
      app.use(
        '/',
        createConversationsRouter({
          restoreConversation: async (id: string) =>
            ({
              _id: id,
              provider: 'codex',
              model: 'm',
              title: 'T',
              source: 'REST',
              flags: {},
              lastMessageAt: now,
              archivedAt: null,
              createdAt: now,
              updatedAt: now,
            }) as unknown as Conversation,
        }),
      );
    },
  });

  try {
    const ws = openWs(server.wsUrl);
    await waitForOpen(ws);
    sendJson(ws, { type: 'subscribe_sidebar', requestId: 'r1' });
    await waitForMessage<WsJson>(ws, (m) => messageType(m) === 'ack');

    const res = await fetch(`${server.baseUrl}/conversations/c1/restore`, {
      method: 'POST',
    });
    assert.equal(res.status, 200);

    const evt = await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'conversation_upsert' &&
        (m.conversation as Record<string, unknown>).conversationId === 'c1',
    );
    assert.equal((evt.conversation as Record<string, unknown>).archived, false);
  } finally {
    await server.close();
  }
});
