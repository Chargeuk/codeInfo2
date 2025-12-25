import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';
import request from 'supertest';

import type { ConversationSummary } from '../../mongo/repo.js';
import { createConversationsRouter } from '../../routes/conversations.js';

const base: Omit<ConversationSummary, 'conversationId' | 'archived'> = {
  provider: 'lmstudio',
  model: 'llama',
  title: 'Title',
  source: 'REST',
  lastMessageAt: new Date('2025-01-01T00:00:00Z'),
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

test('agentName=__none__ list mode returns only non-agent conversations (router passes filter through)', async () => {
  const items: ConversationSummary[] = [
    {
      ...base,
      conversationId: 'agent',
      archived: false,
      agentName: 'coding_agent',
    },
    {
      ...base,
      conversationId: 'chat',
      archived: false,
    },
  ];

  const res = await request(
    appWith({
      listConversations: async (params) => {
        const agentName = (params as { agentName?: string }).agentName;
        if (agentName === '__none__') {
          return { items: items.filter((item) => item.agentName == null) };
        }
        return { items };
      },
    }),
  )
    .get('/conversations?agentName=__none__')
    .expect(200);

  assert.deepEqual(
    res.body.items.map((i: { conversationId: string }) => i.conversationId),
    ['chat'],
  );
});
