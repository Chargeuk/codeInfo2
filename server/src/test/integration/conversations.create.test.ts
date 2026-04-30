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
          source: input.source ?? 'REST',
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

test('rejects malformed persisted agentFlags before createConversation can sanitize them into success', async () => {
  let createCalls = 0;

  const res = await request(
    appWith({
      createConversation: async () => {
        createCalls += 1;
        throw new Error('createConversation should not be called');
      },
    }),
  )
    .post('/conversations')
    .send({
      provider: 'lmstudio',
      model: 'llama',
      flags: {
        agentFlags: 'not-an-object',
      },
    })
    .expect(400);

  assert.equal(res.body.error, 'validation_error');
  assert.deepEqual(res.body.details.flags._errors, [
    'flags.agentFlags must be an object',
  ]);
  assert.equal(createCalls, 0);
});

test('rejects provider-incompatible persisted flags instead of silently dropping them', async () => {
  let createCalls = 0;

  const res = await request(
    appWith({
      createConversation: async () => {
        createCalls += 1;
        throw new Error('createConversation should not be called');
      },
    }),
  )
    .post('/conversations')
    .send({
      provider: 'lmstudio',
      model: 'llama',
      flags: {
        agentFlags: {
          sandboxMode: 'read-only',
        },
      },
    })
    .expect(400);

  assert.equal(res.body.error, 'validation_error');
  assert.deepEqual(res.body.details.flags._errors, [
    'flags.agentFlags.sandboxMode is not supported for provider "lmstudio"',
  ]);
  assert.equal(createCalls, 0);
});

test('rejects server-owned parent and child flow metadata on ordinary conversation creates', async () => {
  let createCalls = 0;

  const flowRes = await request(
    appWith({
      createConversation: async () => {
        createCalls += 1;
        throw new Error('createConversation should not be called');
      },
    }),
  )
    .post('/conversations')
    .send({
      provider: 'codex',
      model: 'gpt-5',
      flags: {
        flow: {
          executionId: 'smuggled-parent-1',
        },
      },
    })
    .expect(400);

  assert.equal(flowRes.body.error, 'validation_error');
  assert.deepEqual(flowRes.body.details.flags._errors, [
    'flags.flow is server-owned and cannot be set via conversations API',
  ]);

  const flowChildRes = await request(
    appWith({
      createConversation: async () => {
        createCalls += 1;
        throw new Error('createConversation should not be called');
      },
    }),
  )
    .post('/conversations')
    .send({
      provider: 'codex',
      model: 'gpt-5',
      flags: {
        flowChild: {
          executionId: 'smuggled-child-1',
        },
      },
    })
    .expect(400);

  assert.equal(flowChildRes.body.error, 'validation_error');
  assert.deepEqual(flowChildRes.body.details.flags._errors, [
    'flags.flowChild is server-owned and cannot be set via conversations API',
  ]);
  assert.equal(createCalls, 0);
});
