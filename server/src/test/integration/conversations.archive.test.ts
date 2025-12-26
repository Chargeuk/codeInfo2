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

test('archives an existing conversation', async () => {
  const calls: unknown[] = [];
  const res = await request(
    appWith({
      archiveConversation: async (id) => {
        calls.push(id);
        return { _id: id } as never;
      },
    }),
  )
    .post('/conversations/abc/archive')
    .expect(200);

  assert.equal(res.body.status, 'ok');
  assert.equal(calls[0], 'abc');
});

test('returns not_found when archiving missing conversation', async () => {
  const res = await request(appWith({ archiveConversation: async () => null }))
    .post('/conversations/missing/archive')
    .expect(404);
  assert.equal(res.body.error, 'not_found');
});

test('restores an archived conversation', async () => {
  const calls: unknown[] = [];
  const res = await request(
    appWith({
      restoreConversation: async (id) => {
        calls.push(id);
        return { _id: id } as never;
      },
    }),
  )
    .post('/conversations/archived/restore')
    .expect(200);

  assert.equal(res.body.status, 'ok');
  assert.equal(calls[0], 'archived');
});
