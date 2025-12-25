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
  archived: true,
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

test('lists conversations in active+archived mode when archived=true', async () => {
  const calls: unknown[] = [];
  const items: ConversationSummary[] = [
    { ...baseItem, conversationId: 'c2', archived: false },
    { ...baseItem, conversationId: 'c1', archived: true },
  ];

  const res = await request(
    appWith({
      listConversations: async (params) => {
        calls.push(params);
        return { items };
      },
    }),
  )
    .get('/conversations?archived=true')
    .expect(200);

  assert.equal(res.body.items.length, 2);

  const firstCall = calls[0] as {
    includeArchived?: boolean;
    archivedOnly?: boolean;
  };
  assert.equal(firstCall.includeArchived, true);
  assert.equal(firstCall.archivedOnly, false);
});
