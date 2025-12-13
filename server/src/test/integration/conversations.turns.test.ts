import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import type { TurnSummary } from '../../mongo/repo.js';
import { createConversationsRouter } from '../../routes/conversations.js';

const appWith = (
  overrides: Parameters<typeof createConversationsRouter>[0],
) => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter(overrides));
  return app;
};

test('lists turns newest-first and returns nextCursor when full', async () => {
  const turns: TurnSummary[] = [
    {
      conversationId: 'c1',
      role: 'assistant',
      content: 'hi',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      createdAt: new Date('2025-01-01T10:00:00Z'),
    },
    {
      conversationId: 'c1',
      role: 'user',
      content: 'hello',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      createdAt: new Date('2025-01-01T09:00:00Z'),
    },
  ];

  const res = await request(
    appWith({
      findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
      listTurns: async (params) => ({ items: turns.slice(0, params.limit) }),
    }),
  )
    .get('/conversations/c1/turns?limit=1')
    .expect(200);

  assert.equal(res.body.items[0].content, 'hi');
  assert.equal(res.body.nextCursor, turns[0].createdAt.toISOString());
});

test('returns not_found when conversation is missing', async () => {
  const res = await request(appWith({ findConversationById: async () => null }))
    .get('/conversations/missing/turns')
    .expect(404);
  assert.equal(res.body.error, 'not_found');
});

test('rejects appending to archived conversation', async () => {
  const res = await request(
    appWith({
      findConversationById: async () => ({ _id: 'c1', archivedAt: new Date() }),
    }),
  )
    .post('/conversations/c1/turns')
    .send({
      role: 'user',
      content: 'hello',
      model: 'llama',
      provider: 'lmstudio',
      status: 'ok',
    })
    .expect(410);

  assert.equal(res.body.error, 'archived');
});

test('appends turn when conversation active', async () => {
  const calls: unknown[] = [];
  await request(
    appWith({
      findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
      appendTurn: async (payload) => {
        calls.push(payload);
        return payload as never;
      },
    }),
  )
    .post('/conversations/c1/turns')
    .send({
      role: 'assistant',
      content: 'hi there',
      model: 'llama',
      provider: 'lmstudio',
      toolCalls: { foo: 'bar' },
      status: 'ok',
    })
    .expect(201);

  const payload = calls[0] as Record<string, unknown>;
  assert.equal(payload.conversationId, 'c1');
  assert.equal(payload.role, 'assistant');
  assert.equal(payload.content, 'hi there');
  assert.equal((payload as { source?: string }).source, 'REST');
});

test('returns validation_error on bad body', async () => {
  const res = await request(
    appWith({
      findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
    }),
  )
    .post('/conversations/c1/turns')
    .send({})
    .expect(400);
  assert.equal(res.body.error, 'validation_error');
});
