import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';
import request from 'supertest';

import type { ConversationSummary } from '../../mongo/repo.js';
import { createConversationsRouter } from '../../routes/conversations.js';

const conversation = (conversationId: string): ConversationSummary => ({
  conversationId,
  provider: 'lmstudio',
  model: 'llama',
  title: `Title ${conversationId}`,
  source: 'REST',
  lastMessageAt: new Date('2025-01-01T00:00:00Z'),
  archived: true,
  flags: {},
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
});

const appWith = (
  overrides: Parameters<typeof createConversationsRouter>[0],
) => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter(overrides));
  return app;
};

test('bulk archive archives all conversations when all IDs exist', async () => {
  let captured: unknown;

  const res = await request(
    appWith({
      bulkArchiveConversations: async (params) => {
        captured = params;
        return {
          ok: true,
          conversations: [conversation('c1'), conversation('c2')],
        } as never;
      },
    }),
  )
    .post('/conversations/bulk/archive')
    .send({ conversationIds: ['c1', 'c2'] })
    .expect(200);

  assert.equal(res.body.status, 'ok');
  assert.deepEqual(
    (captured as { conversationIds: string[] }).conversationIds,
    ['c1', 'c2'],
  );
});
