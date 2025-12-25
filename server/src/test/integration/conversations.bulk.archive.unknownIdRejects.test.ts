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

test('bulk archive rejects unknown IDs and applies no changes', async () => {
  const res = await request(
    appWith({
      bulkArchiveConversations: async () =>
        ({ ok: false, error: 'not_found', missingIds: ['missing'] }) as never,
    }),
  )
    .post('/conversations/bulk/archive')
    .send({ conversationIds: ['c1', 'missing'] })
    .expect(404);

  assert.equal(res.body.error, 'not_found');
  assert.deepEqual(res.body.missingIds, ['missing']);
});
