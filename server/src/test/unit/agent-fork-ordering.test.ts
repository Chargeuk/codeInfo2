import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { orderForkDisplayHistory } from '../../agents/forkHistory.js';
import { copyForkTurn } from '../../agents/forkService.js';
import type { Conversation } from '../../mongo/conversation.js';
import type { TurnSummary } from '../../mongo/repo.js';
import { createConversationsRouter } from '../../routes/conversations.js';

test('existing tied-timestamp agent history retains its displayed order and the fork matches it with new IDs', async () => {
  const now = new Date('2026-09-30T00:00:00Z');
  const source: Conversation = {
    _id: 'ordering-source',
    agentName: 'source-agent',
    provider: 'codex',
    model: 'model',
    title: 'Source',
    source: 'REST',
    flags: {},
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    archivedAt: null,
  };
  const child = { ...source, _id: 'ordering-child', agentName: 'target-agent' };
  const turn = (turnId: string, role: TurnSummary['role']): TurnSummary => ({
    turnId,
    role,
    content: turnId,
    conversationId: source._id,
    provider: 'codex',
    model: 'historic-model',
    source: 'REST',
    status: 'ok',
    toolCalls: null,
    createdAt: now,
  });
  const history = [
    turn('z-user', 'user'),
    turn('a-assistant', 'assistant'),
    turn('y-user', 'user'),
    turn('b-assistant', 'assistant'),
  ];
  const orders = new Map(
    orderForkDisplayHistory(history).map((row, index) => [row.turnId, index]),
  );
  const copied = history.map(
    (row, index): TurnSummary => ({
      ...copyForkTurn(row, child._id, 'child-native', orders.get(row.turnId)!),
      turnId: `new-${history.length - index}`,
    }),
  );
  const app = express();
  app.use(
    createConversationsRouter({
      findConversationById: async (id) => (id === source._id ? source : child),
      listAllTurns: async (id) => ({
        items:
          id === source._id
            ? history.slice().reverse()
            : copied.slice().reverse(),
      }),
    }),
  );
  const before = await request(app)
    .get(`/conversations/${source._id}/turns`)
    .expect(200);
  const after = await request(app)
    .get(`/conversations/${child._id}/turns`)
    .expect(200);
  const content = (body: { items: Array<{ content: string }> }) =>
    body.items.map((row) => row.content);
  assert.deepEqual(content(before.body), [
    'b-assistant',
    'a-assistant',
    'z-user',
    'y-user',
  ]);
  assert.deepEqual(content(after.body), content(before.body));
  assert.equal(
    history.every((row) => row.displayOrder === undefined),
    true,
  );
  assert.deepEqual(
    copied.map((row) => row.createdAt),
    history.map((row) => row.createdAt),
  );
});
