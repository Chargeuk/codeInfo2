import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';
import request from 'supertest';

import type { ConversationSummary } from '../../mongo/repo.js';
import { createConversationsRouter } from '../../routes/conversations.js';

const base: Omit<ConversationSummary, 'conversationId' | 'lastMessageAt'> = {
  provider: 'lmstudio',
  model: 'llama',
  title: 'Title',
  source: 'REST',
  archived: false,
  flags: {},
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const items: ConversationSummary[] = [
  {
    ...base,
    conversationId: 'c3',
    lastMessageAt: new Date('2025-01-03T00:00:00Z'),
  },
  {
    ...base,
    conversationId: 'c2',
    lastMessageAt: new Date('2025-01-02T00:00:00Z'),
  },
  {
    ...base,
    conversationId: 'c1',
    lastMessageAt: new Date('2025-01-01T00:00:00Z'),
  },
];

const appWith = (
  overrides: Parameters<typeof createConversationsRouter>[0],
) => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter(overrides));
  return app;
};

test('cursor pagination returns non-overlapping pages', async () => {
  const res1 = await request(
    appWith({
      listConversations: async (params) => {
        const cursor = (params as { cursor?: string }).cursor;
        const limit = (params as { limit: number }).limit;
        const subset = cursor
          ? items.filter((i) => i.lastMessageAt < new Date(cursor))
          : items;
        return { items: subset.slice(0, limit) };
      },
    }),
  )
    .get('/conversations?limit=2')
    .expect(200);

  assert.deepEqual(
    res1.body.items.map((i: { conversationId: string }) => i.conversationId),
    ['c3', 'c2'],
  );
  assert.equal(res1.body.nextCursor, items[1].lastMessageAt.toISOString());

  const res2 = await request(
    appWith({
      listConversations: async (params) => {
        const cursor = (params as { cursor?: string }).cursor;
        const limit = (params as { limit: number }).limit;
        const subset = cursor
          ? items.filter((i) => i.lastMessageAt < new Date(cursor))
          : items;
        return { items: subset.slice(0, limit) };
      },
    }),
  )
    .get(
      `/conversations?limit=2&cursor=${encodeURIComponent(res1.body.nextCursor)}`,
    )
    .expect(200);

  assert.deepEqual(
    res2.body.items.map((i: { conversationId: string }) => i.conversationId),
    ['c1'],
  );
  assert.equal(res2.body.nextCursor, undefined);
});
