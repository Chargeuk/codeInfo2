import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';

import type { ConversationSummary } from '../../mongo/repo.js';
import { createConversationsRouter } from '../../routes/conversations.js';

const baseItem: ConversationSummary = {
  conversationId: 'base',
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

test('GET /conversations includes flowName when set', async () => {
  const items: ConversationSummary[] = [
    {
      ...baseItem,
      conversationId: 'flow-1',
      title: 'Flow 1',
      flowName: 'daily-standup',
    },
    {
      ...baseItem,
      conversationId: 'chat-1',
      title: 'Chat 1',
    },
  ];

  const res = await request(
    appWith({
      listConversations: async () => ({ items }),
    }),
  )
    .get('/conversations?state=all')
    .expect(200);

  assert.equal(res.body.items[0].flowName, 'daily-standup');
  assert.ok(!('flowName' in res.body.items[1]));
});

test('GET /conversations flowName filter does not pull in child agent conversations that only have flowChild flags', async () => {
  const items: ConversationSummary[] = [
    {
      ...baseItem,
      conversationId: 'flow-1',
      title: 'Flow 1',
      flowName: 'daily-standup',
      flags: {
        flow: {
          executionId: 'execution-parent-1',
        },
      },
    },
    {
      ...baseItem,
      conversationId: 'child-1',
      title: 'Flow 1 (main)',
      agentName: 'coding_agent',
      flags: {
        flowChild: {
          executionId: 'execution-parent-1',
        },
      },
    },
  ];

  const res = await request(
    appWith({
      listConversations: async () => ({
        items: items.filter((item) => item.flowName === 'daily-standup'),
      }),
    }),
  )
    .get('/conversations?state=all&flowName=daily-standup')
    .expect(200);

  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].conversationId, 'flow-1');
  assert.deepEqual(res.body.items[0].flags, {
    flow: {
      executionId: 'execution-parent-1',
    },
  });
});
