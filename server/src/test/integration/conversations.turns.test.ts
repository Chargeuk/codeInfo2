import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import {
  appendAnalysisDelta,
  appendAssistantDelta,
  appendToolEvent,
  bumpSeq,
  cleanupInflight,
  createInflight,
  markInflightFinal,
} from '../../chat/inflightRegistry.js';
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

test('optionally includes inflight snapshot when requested', async () => {
  createInflight({
    conversationId: 'c1',
    inflightId: 'i1',
    provider: 'lmstudio',
    model: 'llama',
    source: 'REST',
    userTurn: {
      content: 'hello',
      createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    },
  });
  appendAssistantDelta({ conversationId: 'c1', inflightId: 'i1', delta: 'Hi' });
  bumpSeq('c1');
  appendAnalysisDelta({
    conversationId: 'c1',
    inflightId: 'i1',
    delta: 'thinking...',
  });
  bumpSeq('c1');
  appendToolEvent({
    conversationId: 'c1',
    inflightId: 'i1',
    event: {
      type: 'tool-request',
      callId: 'call-1',
      name: 'VectorSearch',
      parameters: { query: 'hello' },
    },
  });
  bumpSeq('c1');

  try {
    const res = await request(
      appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        listTurns: async () => ({ items: [] }),
      }),
    )
      .get('/conversations/c1/turns?includeInflight=true')
      .expect(200);

    assert.equal(Array.isArray(res.body.items), true);
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.items[0].role, 'assistant');
    assert.equal(res.body.items[0].content, 'Hi');
    assert.equal(res.body.items[1].role, 'user');
    assert.equal(res.body.items[1].content, 'hello');
    assert.equal(typeof res.body.inflight?.inflightId, 'string');
    assert.equal(res.body.inflight.inflightId, 'i1');
    assert.equal(res.body.inflight.assistantText, 'Hi');
    assert.equal(res.body.inflight.assistantThink, 'thinking...');
    assert.equal(Array.isArray(res.body.inflight.toolEvents), true);
    assert.equal(res.body.inflight.toolEvents.length, 1);
    assert.equal(res.body.inflight.toolEvents[0].type, 'tool-request');
    assert.equal(res.body.inflight.toolEvents[0].name, 'VectorSearch');
    assert.equal(typeof res.body.inflight.startedAt, 'string');
    assert.equal(typeof res.body.inflight.seq, 'number');
    assert.ok(res.body.inflight.seq >= 0);
  } finally {
    cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
  }
});

test('always merges inflight turns into snapshot items (includeInflight omitted)', async () => {
  createInflight({
    conversationId: 'c1',
    inflightId: 'i1',
    provider: 'lmstudio',
    model: 'llama',
    source: 'REST',
    userTurn: {
      content: 'hello',
      createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    },
  });
  appendAssistantDelta({ conversationId: 'c1', inflightId: 'i1', delta: 'Hi' });

  try {
    const res = await request(
      appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        listTurns: async () => ({ items: [] }),
      }),
    )
      .get('/conversations/c1/turns')
      .expect(200);

    assert.equal(res.body.inflight, undefined);
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.items[0].role, 'assistant');
    assert.equal(res.body.items[0].content, 'Hi');
    assert.equal(res.body.items[1].role, 'user');
    assert.equal(res.body.items[1].content, 'hello');
  } finally {
    cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
  }
});

test('keeps inflight merged after final until persistence completes, then stops after cleanup', async () => {
  const userCreatedAt = new Date('2025-01-01T00:00:00.000Z').toISOString();
  createInflight({
    conversationId: 'c1',
    inflightId: 'i1',
    provider: 'lmstudio',
    model: 'llama',
    source: 'REST',
    userTurn: { content: 'hello', createdAt: userCreatedAt },
  });
  appendAssistantDelta({ conversationId: 'c1', inflightId: 'i1', delta: 'Hi' });
  markInflightFinal({ conversationId: 'c1', inflightId: 'i1', status: 'ok' });

  const persistedUserOnly: TurnSummary[] = [
    {
      conversationId: 'c1',
      role: 'user',
      content: 'hello',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      createdAt: new Date(userCreatedAt),
    },
  ];

  try {
    const resBefore = await request(
      appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        listTurns: async () => ({ items: persistedUserOnly }),
      }),
    )
      .get('/conversations/c1/turns')
      .expect(200);

    assert.equal(resBefore.body.items.length, 2);
    assert.equal(resBefore.body.items[0].role, 'assistant');
    assert.equal(resBefore.body.items[0].content, 'Hi');

    cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });

    const persistedBoth: TurnSummary[] = [
      {
        conversationId: 'c1',
        role: 'assistant',
        content: 'Hi',
        model: 'llama',
        provider: 'lmstudio',
        source: 'REST',
        toolCalls: null,
        status: 'ok',
        createdAt: new Date('2025-01-01T00:00:00.500Z'),
      },
      persistedUserOnly[0],
    ];

    const resAfter = await request(
      appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        listTurns: async () => ({ items: persistedBoth }),
      }),
    )
      .get('/conversations/c1/turns?includeInflight=true')
      .expect(200);

    assert.equal(resAfter.body.items.length, 2);
    assert.equal(resAfter.body.inflight, undefined);
  } finally {
    cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
  }
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
