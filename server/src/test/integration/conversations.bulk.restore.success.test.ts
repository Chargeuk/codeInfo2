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
  archived: false,
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

test('bulk restore restores all conversations when all IDs exist', async () => {
  const res = await request(
    appWith({
      bulkRestoreConversations: async () =>
        ({
          ok: true,
          conversations: [conversation('c1'), conversation('c2')],
        }) as never,
    }),
  )
    .post('/conversations/bulk/restore')
    .send({ conversationIds: ['c1', 'c2'] })
    .expect(200);

  assert.equal(res.body.status, 'ok');
});
