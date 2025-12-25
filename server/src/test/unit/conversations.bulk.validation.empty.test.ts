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

test('bulk operations reject empty conversationIds list', async () => {
  let called = false;

  const res = await request(
    appWith({
      bulkArchiveConversations: async () => {
        called = true;
        return { ok: true, conversations: [] } as never;
      },
    }),
  )
    .post('/conversations/bulk/archive')
    .send({ conversationIds: [] })
    .expect(400);

  assert.equal(res.body.error, 'validation_error');
  assert.equal(called, false);
});
