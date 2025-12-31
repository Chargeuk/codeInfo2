import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import type { ConversationSummary } from '../../mongo/repo.js';
import { createConversationsRouter } from '../../routes/conversations.js';

const baseItem: ConversationSummary = {
  conversationId: 'c1',
  provider: 'lmstudio',
  model: 'llama',
  title: 'Title',
  source: 'REST',
  lastMessageAt: new Date('2025-01-01T00:00:00Z'),
  archived: false,
  flags: {},
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const appWith = (
  overrides: Parameters<typeof createConversationsRouter>[0],
) => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter(overrides));
  return app;
};

test('lists conversations newest-first with nextCursor when page is full', async () => {
  const calls: unknown[] = [];
  const items: ConversationSummary[] = [
    baseItem,
    {
      ...baseItem,
      conversationId: 'c0',
      lastMessageAt: new Date('2024-12-31T23:00:00Z'),
    },
  ];

  const res = await request(
    appWith({
      listConversations: async (params) => {
        calls.push(params);
        return { items: items.slice(0, params.limit) };
      },
    }),
  )
    .get('/conversations?limit=1&archived=true')
    .expect(200);

  assert.equal(res.body.items[0].conversationId, 'c1');
  assert.equal(res.body.nextCursor, items[0].lastMessageAt.toISOString());

  const firstCall = calls[0] as { state?: string };
  assert.equal(firstCall.state, 'all');
});

test('default list behaves like state=active (excludes archived)', async () => {
  const activeItem: ConversationSummary = { ...baseItem, archived: false };
  const archivedItem: ConversationSummary = {
    ...baseItem,
    conversationId: 'c2',
    archived: true,
  };

  const res = await request(
    appWith({
      listConversations: async (params) => {
        if (params.state === 'active') return { items: [activeItem] };
        if (params.state === 'archived') return { items: [archivedItem] };
        return { items: [activeItem, archivedItem] };
      },
    }),
  )
    .get('/conversations')
    .expect(200);

  assert.deepEqual(
    res.body.items.map((c: { conversationId: string }) => c.conversationId),
    ['c1'],
  );
});

test('state=active returns only active conversations', async () => {
  const activeItem: ConversationSummary = { ...baseItem, archived: false };
  const archivedItem: ConversationSummary = {
    ...baseItem,
    conversationId: 'c2',
    archived: true,
  };

  const res = await request(
    appWith({
      listConversations: async (params) => {
        if (params.state === 'active') return { items: [activeItem] };
        if (params.state === 'archived') return { items: [archivedItem] };
        return { items: [activeItem, archivedItem] };
      },
    }),
  )
    .get('/conversations?state=active')
    .expect(200);

  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].archived, false);
});

test('state=archived returns only archived conversations', async () => {
  const activeItem: ConversationSummary = { ...baseItem, archived: false };
  const archivedItem: ConversationSummary = {
    ...baseItem,
    conversationId: 'c2',
    archived: true,
  };

  const res = await request(
    appWith({
      listConversations: async (params) => {
        if (params.state === 'active') return { items: [activeItem] };
        if (params.state === 'archived') return { items: [archivedItem] };
        return { items: [activeItem, archivedItem] };
      },
    }),
  )
    .get('/conversations?state=archived')
    .expect(200);

  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].archived, true);
});

test('state=all returns active + archived conversations', async () => {
  const activeItem: ConversationSummary = { ...baseItem, archived: false };
  const archivedItem: ConversationSummary = {
    ...baseItem,
    conversationId: 'c2',
    archived: true,
  };

  const res = await request(
    appWith({
      listConversations: async (params) => {
        if (params.state === 'active') return { items: [activeItem] };
        if (params.state === 'archived') return { items: [archivedItem] };
        return { items: [activeItem, archivedItem] };
      },
    }),
  )
    .get('/conversations?state=all')
    .expect(200);

  assert.equal(res.body.items.length, 2);
  assert.equal(
    res.body.items.some((c: { archived: boolean }) => c.archived === true),
    true,
  );
  assert.equal(
    res.body.items.some((c: { archived: boolean }) => c.archived === false),
    true,
  );
});

test('archived=true remains backward compatible (maps to state=all)', async () => {
  const activeItem: ConversationSummary = { ...baseItem, archived: false };
  const archivedItem: ConversationSummary = {
    ...baseItem,
    conversationId: 'c2',
    archived: true,
  };

  const res = await request(
    appWith({
      listConversations: async (params) => {
        if (params.state === 'active') return { items: [activeItem] };
        if (params.state === 'archived') return { items: [archivedItem] };
        return { items: [activeItem, archivedItem] };
      },
    }),
  )
    .get('/conversations?archived=true')
    .expect(200);

  assert.equal(res.body.items.length, 2);
});

test('invalid state query returns 400 VALIDATION_FAILED', async () => {
  const res = await request(
    appWith({
      listConversations: async () => {
        throw new Error('listConversations should not be called');
      },
    }),
  )
    .get('/conversations?state=not-a-state')
    .expect(400);

  assert.equal(res.body.status, 'error');
  assert.equal(res.body.code, 'VALIDATION_FAILED');
});

test('omits nextCursor when fewer results than limit', async () => {
  const res = await request(
    appWith({ listConversations: async () => ({ items: [baseItem] }) }),
  )
    .get('/conversations?limit=5')
    .expect(200);

  assert.equal(res.body.nextCursor, undefined);
});

test('returns validation_error on bad cursor', async () => {
  const res = await request(appWith({}))
    .get('/conversations?cursor=not-a-date')
    .expect(400);
  assert.equal(res.body.error, 'validation_error');
});
