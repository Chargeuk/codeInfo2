import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import type {
  BulkConversationDeleteResult,
  BulkConversationUpdateResult,
} from '../../mongo/repo.js';
import { createConversationsRouter } from '../../routes/conversations.js';

type ConversationState = { archived: boolean };

const appWith = (
  overrides: Parameters<typeof createConversationsRouter>[0],
) => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter(overrides));
  return app;
};

const createInMemoryBulkOps = (input: {
  conversations: Map<string, ConversationState>;
  turns: Map<string, string[]>;
}) => {
  return {
    bulkArchiveConversations: async (
      conversationIds: string[],
    ): Promise<BulkConversationUpdateResult> => {
      const invalidIds = Array.from(new Set(conversationIds)).filter(
        (id) => !input.conversations.has(id),
      );
      if (invalidIds.length > 0) {
        return { status: 'conflict', invalidIds, invalidStateIds: [] };
      }

      for (const id of conversationIds) {
        input.conversations.set(id, { archived: true });
      }

      return { status: 'ok', updatedCount: conversationIds.length };
    },
    bulkRestoreConversations: async (
      conversationIds: string[],
    ): Promise<BulkConversationUpdateResult> => {
      const invalidIds = Array.from(new Set(conversationIds)).filter(
        (id) => !input.conversations.has(id),
      );
      if (invalidIds.length > 0) {
        return { status: 'conflict', invalidIds, invalidStateIds: [] };
      }

      for (const id of conversationIds) {
        input.conversations.set(id, { archived: false });
      }

      return { status: 'ok', updatedCount: conversationIds.length };
    },
    bulkDeleteConversations: async (
      conversationIds: string[],
    ): Promise<BulkConversationDeleteResult> => {
      const invalidIds = Array.from(new Set(conversationIds)).filter(
        (id) => !input.conversations.has(id),
      );
      const invalidStateIds = Array.from(new Set(conversationIds)).filter(
        (id) => input.conversations.get(id)?.archived !== true,
      );

      if (invalidIds.length > 0 || invalidStateIds.length > 0) {
        return { status: 'conflict', invalidIds, invalidStateIds };
      }

      for (const id of conversationIds) {
        input.turns.delete(id);
        input.conversations.delete(id);
      }

      return { status: 'ok', deletedCount: conversationIds.length };
    },
  };
};

test('POST /conversations/bulk/archive returns 200 with updatedCount (happy path)', async () => {
  const conversations = new Map<string, ConversationState>([
    ['c1', { archived: false }],
    ['c2', { archived: false }],
  ]);
  const turns = new Map<string, string[]>();

  const res = await request(
    appWith(createInMemoryBulkOps({ conversations, turns })),
  )
    .post('/conversations/bulk/archive')
    .send({ conversationIds: ['c1', 'c2'] })
    .expect(200);

  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.updatedCount, 2);
  assert.equal(conversations.get('c1')?.archived, true);
  assert.equal(conversations.get('c2')?.archived, true);
});

test('POST /conversations/bulk/restore returns 200 with updatedCount (happy path)', async () => {
  const conversations = new Map<string, ConversationState>([
    ['c1', { archived: true }],
    ['c2', { archived: true }],
  ]);
  const turns = new Map<string, string[]>();

  const res = await request(
    appWith(createInMemoryBulkOps({ conversations, turns })),
  )
    .post('/conversations/bulk/restore')
    .send({ conversationIds: ['c1', 'c2'] })
    .expect(200);

  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.updatedCount, 2);
  assert.equal(conversations.get('c1')?.archived, false);
  assert.equal(conversations.get('c2')?.archived, false);
});

test('POST /conversations/bulk/delete deletes archived conversations and turns (happy path)', async () => {
  const conversations = new Map<string, ConversationState>([
    ['c1', { archived: true }],
  ]);
  const turns = new Map<string, string[]>([['c1', ['t1', 't2']]]);

  const res = await request(
    appWith(createInMemoryBulkOps({ conversations, turns })),
  )
    .post('/conversations/bulk/delete')
    .send({ conversationIds: ['c1'] })
    .expect(200);

  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.deletedCount, 1);
  assert.equal(conversations.has('c1'), false);
  assert.equal(turns.has('c1'), false);
});

test('bulk endpoints reject missing conversationIds with 400 VALIDATION_FAILED', async () => {
  const res = await request(appWith({}))
    .post('/conversations/bulk/archive')
    .send({})
    .expect(400);

  assert.equal(res.body.status, 'error');
  assert.equal(res.body.code, 'VALIDATION_FAILED');
});

test('bulk endpoints reject non-array conversationIds with 400 VALIDATION_FAILED', async () => {
  const res = await request(appWith({}))
    .post('/conversations/bulk/archive')
    .send({ conversationIds: 'nope' })
    .expect(400);

  assert.equal(res.body.status, 'error');
  assert.equal(res.body.code, 'VALIDATION_FAILED');
});

test('bulk endpoints reject non-string ids with 400 VALIDATION_FAILED', async () => {
  const res = await request(appWith({}))
    .post('/conversations/bulk/archive')
    .send({ conversationIds: [123] })
    .expect(400);

  assert.equal(res.body.status, 'error');
  assert.equal(res.body.code, 'VALIDATION_FAILED');
});

test('bulk endpoints reject empty conversationIds array with 400 VALIDATION_FAILED', async () => {
  const res = await request(appWith({}))
    .post('/conversations/bulk/archive')
    .send({ conversationIds: [] })
    .expect(400);

  assert.equal(res.body.status, 'error');
  assert.equal(res.body.code, 'VALIDATION_FAILED');
});

test('bulk endpoints accept duplicate conversationIds and treat them as unique', async () => {
  const conversations = new Map<string, ConversationState>([
    ['c1', { archived: false }],
  ]);
  const turns = new Map<string, string[]>();

  const res = await request(
    appWith(createInMemoryBulkOps({ conversations, turns })),
  )
    .post('/conversations/bulk/archive')
    .send({ conversationIds: ['c1', 'c1'] })
    .expect(200);

  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.updatedCount, 1);
  assert.equal(conversations.get('c1')?.archived, true);
});

test('bulk archive rejects invalid id with 409 BATCH_CONFLICT and performs no writes', async () => {
  const conversations = new Map<string, ConversationState>([
    ['c1', { archived: false }],
  ]);
  const turns = new Map<string, string[]>();

  const res = await request(
    appWith(createInMemoryBulkOps({ conversations, turns })),
  )
    .post('/conversations/bulk/archive')
    .send({ conversationIds: ['c1', 'missing'] })
    .expect(409);

  assert.equal(res.body.status, 'error');
  assert.equal(res.body.code, 'BATCH_CONFLICT');
  assert.deepEqual(res.body.details.invalidIds, ['missing']);
  assert.deepEqual(res.body.details.invalidStateIds, []);
  assert.equal(conversations.get('c1')?.archived, false);
});

test('bulk delete rejects non-archived ids with 409 BATCH_CONFLICT and performs no deletes', async () => {
  const conversations = new Map<string, ConversationState>([
    ['c1', { archived: true }],
    ['c2', { archived: false }],
  ]);
  const turns = new Map<string, string[]>([
    ['c1', ['t1']],
    ['c2', ['t2']],
  ]);

  const res = await request(
    appWith(createInMemoryBulkOps({ conversations, turns })),
  )
    .post('/conversations/bulk/delete')
    .send({ conversationIds: ['c1', 'c2'] })
    .expect(409);

  assert.equal(res.body.status, 'error');
  assert.equal(res.body.code, 'BATCH_CONFLICT');
  assert.deepEqual(res.body.details.invalidIds, []);
  assert.deepEqual(res.body.details.invalidStateIds, ['c2']);
  assert.equal(conversations.has('c1'), true);
  assert.equal(conversations.has('c2'), true);
  assert.equal(turns.has('c1'), true);
  assert.equal(turns.has('c2'), true);
});
