import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';
import request from 'supertest';

import { createConversationsRouter } from '../../routes/conversations.js';

const appWith = (
  overrides: Parameters<typeof createConversationsRouter>[0],
) => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter(overrides));
  return app;
};

test('bulk restore is idempotent when repo layer treats already-active IDs as no-op', async () => {
  const res = await request(
    appWith({
      bulkRestoreConversations: async () =>
        ({ ok: true, conversations: [] }) as never,
    }),
  )
    .post('/conversations/bulk/restore')
    .send({ conversationIds: ['already-active', 'archived'] })
    .expect(200);

  assert.equal(res.body.status, 'ok');
});
