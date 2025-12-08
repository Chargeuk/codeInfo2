import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import type { Conversation } from '../../mongo/conversation.js';
import { createConversationsRouter } from '../../routes/conversations.js';

const appWith = (
  overrides: Parameters<typeof createConversationsRouter>[0],
) => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter(overrides));
  return app;
};

test('creates a conversation and returns generated id', async () => {
  const calls: unknown[] = [];
  const originalRandomUUID = crypto.randomUUID;
  (crypto as unknown as { randomUUID: () => string }).randomUUID = () =>
    'conv-1';

  const res = await request(
    appWith({
      createConversation: async (input) => {
        calls.push(input);
        return {
          _id: input.conversationId,
          provider: input.provider,
          model: input.model,
          title: input.title,
          flags: input.flags ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
          lastMessageAt: input.lastMessageAt ?? new Date(),
          archivedAt: null,
        } satisfies Conversation;
      },
    }),
  )
    .post('/conversations')
    .send({ provider: 'lmstudio', model: 'llama', title: 'Hello' })
    .expect(201);

  assert.equal(res.body.conversationId, 'conv-1');
  const firstCall = calls[0] as Record<string, unknown>;
  assert.equal(firstCall.conversationId, 'conv-1');
  assert.equal(firstCall.provider, 'lmstudio');
  assert.equal(firstCall.model, 'llama');
  assert.equal(firstCall.title, 'Hello');
  assert.ok(firstCall.lastMessageAt instanceof Date);

  (crypto as unknown as { randomUUID: () => string }).randomUUID =
    originalRandomUUID;
});

test('returns validation_error when body is invalid', async () => {
  const res = await request(appWith({}))
    .post('/conversations')
    .send({})
    .expect(400);
  assert.equal(res.body.error, 'validation_error');
});
