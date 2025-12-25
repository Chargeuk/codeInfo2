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

test('bulk operations dedupe conversationIds before calling repo layer', async () => {
  let captured: unknown;

  const res = await request(
    appWith({
      bulkArchiveConversations: async (params) => {
        captured = params;
        return { ok: true, conversations: [] } as never;
      },
    }),
  )
    .post('/conversations/bulk/archive')
    .send({ conversationIds: ['c1', 'c1', 'c2', 'c2', 'c3'] })
    .expect(200);

  assert.equal(res.body.status, 'ok');
  assert.deepEqual(
    (captured as { conversationIds: string[] }).conversationIds,
    ['c1', 'c2', 'c3'],
  );
});
