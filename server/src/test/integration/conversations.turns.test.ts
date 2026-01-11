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
  markInflightPersisted,
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

test('returns full turn history newest-first (ignores pagination query)', async () => {
  const turns: TurnSummary[] = [
    {
      turnId: 't2',
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
      turnId: 't1',
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
      listAllTurns: async () => ({ items: turns }),
    }),
  )
    .get('/conversations/c1/turns?limit=1&cursor=2025-01-01T00:00:00.000Z')
    .expect(200);

  assert.equal(res.body.items[0].content, 'hi');
  assert.equal(typeof res.body.items[0].turnId, 'string');
  assert.equal(res.body.items.length, 2);
  assert.equal('nextCursor' in res.body, false);
});

test('returns not_found when conversation is missing', async () => {
  const res = await request(appWith({ findConversationById: async () => null }))
    .get('/conversations/missing/turns')
    .expect(404);
  assert.equal(res.body.error, 'not_found');
});

test('inflight-only snapshot returns inflight items and inflight payload', async () => {
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
        listAllTurns: async () => ({ items: [] }),
      }),
    )
      .get('/conversations/c1/turns')
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

test('returns full history when no inflight exists', async () => {
  const turns: TurnSummary[] = [
    {
      turnId: 't4',
      conversationId: 'c1',
      role: 'assistant',
      content: 'second assistant',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      createdAt: new Date('2025-01-01T10:01:00Z'),
    },
    {
      turnId: 't3',
      conversationId: 'c1',
      role: 'user',
      content: 'second user',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      createdAt: new Date('2025-01-01T10:00:00Z'),
    },
    {
      turnId: 't2',
      conversationId: 'c1',
      role: 'assistant',
      content: 'first assistant',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      createdAt: new Date('2025-01-01T09:01:00Z'),
    },
    {
      turnId: 't1',
      conversationId: 'c1',
      role: 'user',
      content: 'first user',
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
      listAllTurns: async () => ({ items: turns }),
    }),
  )
    .get('/conversations/c1/turns')
    .expect(200);

  assert.equal(res.body.items.length, 4);
  assert.equal(res.body.items[0].content, 'second assistant');
  assert.equal(res.body.items[3].content, 'first user');
  assert.equal(res.body.inflight, undefined);
});

test('dedupes inflight merge by turnId and preserves newest-first ordering', async () => {
  const userCreatedAt = new Date('2025-01-01T00:00:00.000Z').toISOString();
  createInflight({
    conversationId: 'c1',
    inflightId: 'i1',
    provider: 'lmstudio',
    model: 'llama',
    source: 'REST',
    userTurn: { content: 'inflight user', createdAt: userCreatedAt },
  });
  markInflightPersisted({
    conversationId: 'c1',
    inflightId: 'i1',
    role: 'user',
    turnId: 't-user',
  });
  appendAssistantDelta({
    conversationId: 'c1',
    inflightId: 'i1',
    delta: 'inflight assistant',
  });
  markInflightPersisted({
    conversationId: 'c1',
    inflightId: 'i1',
    role: 'assistant',
    turnId: 't-assistant',
  });

  const persisted: TurnSummary[] = [
    {
      turnId: 't-assistant',
      conversationId: 'c1',
      role: 'assistant',
      content: 'persisted assistant',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      createdAt: new Date('2025-01-01T00:00:00.500Z'),
    },
    {
      turnId: 't-user',
      conversationId: 'c1',
      role: 'user',
      content: 'persisted user',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      createdAt: new Date(userCreatedAt),
    },
  ];

  try {
    const res = await request(
      appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        listAllTurns: async () => ({ items: persisted }),
      }),
    )
      .get('/conversations/c1/turns')
      .expect(200);

    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.items[0].turnId, 't-assistant');
    assert.equal(res.body.items[0].role, 'assistant');
    assert.equal(res.body.items[1].turnId, 't-user');
    assert.equal(res.body.items[1].role, 'user');
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
      turnId: 't1',
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
        listAllTurns: async () => ({ items: persistedUserOnly }),
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
        turnId: 't2',
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
        listAllTurns: async () => ({ items: persistedBoth }),
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

test('orders same-timestamp turns deterministically (assistant before user)', async () => {
  const shared = new Date('2025-01-01T12:00:00.000Z');
  const turns: TurnSummary[] = [
    {
      turnId: 'ta',
      conversationId: 'c1',
      role: 'assistant',
      content: 'assistant',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      createdAt: shared,
    },
    {
      turnId: 'tu',
      conversationId: 'c1',
      role: 'user',
      content: 'user',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      createdAt: shared,
    },
  ];

  const res = await request(
    appWith({
      findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
      listAllTurns: async () => ({ items: turns }),
    }),
  )
    .get('/conversations/c1/turns')
    .expect(200);

  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].role, 'assistant');
  assert.equal(res.body.items[1].role, 'user');
});

test('dedupes inflight merge by turnId even when createdAt differs', async () => {
  createInflight({
    conversationId: 'c1',
    inflightId: 'i1',
    provider: 'lmstudio',
    model: 'llama',
    source: 'REST',
    userTurn: {
      content: 'inflight version',
      createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    },
  });
  markInflightPersisted({
    conversationId: 'c1',
    inflightId: 'i1',
    role: 'user',
    turnId: 't-user',
  });
  appendAssistantDelta({
    conversationId: 'c1',
    inflightId: 'i1',
    delta: 'assistant',
  });

  const persisted: TurnSummary[] = [
    {
      turnId: 't-user',
      conversationId: 'c1',
      role: 'user',
      content: 'persisted version',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      createdAt: new Date('2025-01-01T02:00:00.000Z'),
    },
  ];

  try {
    const res = await request(
      appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        listAllTurns: async () => ({ items: persisted }),
      }),
    )
      .get('/conversations/c1/turns')
      .expect(200);

    assert.equal(res.body.items.length, 2);
    const userTurn = res.body.items.find(
      (item: { role: string }) => item.role === 'user',
    );
    const assistantTurn = res.body.items.find(
      (item: { role: string }) => item.role === 'assistant',
    );
    assert.equal(Boolean(userTurn), true);
    assert.equal(Boolean(assistantTurn), true);
    assert.equal((userTurn as { turnId?: string }).turnId, 't-user');
    assert.equal(
      (userTurn as { content?: string }).content,
      'persisted version',
    );
  } finally {
    cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
  }
});

test('fallback dedupe does not drop distinct turns when turnId is missing', async () => {
  const createdAt = new Date('2025-01-01T00:00:00.000Z');
  createInflight({
    conversationId: 'c1',
    inflightId: 'i1',
    provider: 'lmstudio',
    model: 'llama',
    source: 'REST',
    userTurn: {
      content: 'inflight',
      createdAt: createdAt.toISOString(),
    },
  });

  const persisted: TurnSummary[] = [
    {
      turnId: 't-user',
      conversationId: 'c1',
      role: 'user',
      content: 'persisted',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      createdAt,
    },
  ];

  try {
    const res = await request(
      appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        listAllTurns: async () => ({ items: persisted }),
      }),
    )
      .get('/conversations/c1/turns')
      .expect(200);

    assert.equal(res.body.items.length, 2);
    const contents = res.body.items.map(
      (item: { content: string }) => item.content,
    );
    assert.equal(contents.includes('persisted'), true);
    assert.equal(contents.includes('inflight'), true);
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

test('accepts assistant usage/timing metadata on append', async () => {
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
      status: 'ok',
      usage: {
        inputTokens: 12,
        outputTokens: 6,
        totalTokens: 18,
        cachedInputTokens: 4,
      },
      timing: {
        totalTimeSec: 1.5,
        tokensPerSecond: 12.5,
      },
    })
    .expect(201);

  const payload = calls[0] as Record<string, unknown>;
  assert.deepEqual(payload.usage, {
    inputTokens: 12,
    outputTokens: 6,
    totalTokens: 18,
    cachedInputTokens: 4,
  });
  assert.deepEqual(payload.timing, {
    totalTimeSec: 1.5,
    tokensPerSecond: 12.5,
  });
});

test('rejects user usage/timing metadata on append', async () => {
  const res = await request(
    appWith({
      findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
    }),
  )
    .post('/conversations/c1/turns')
    .send({
      role: 'user',
      content: 'hello',
      model: 'llama',
      provider: 'lmstudio',
      status: 'ok',
      usage: { inputTokens: 2 },
      timing: { totalTimeSec: 0.5 },
    })
    .expect(400);

  assert.equal(res.body.error, 'validation_error');
});

test('returns usage/timing fields for assistant turns', async () => {
  const turns: TurnSummary[] = [
    {
      turnId: 't2',
      conversationId: 'c1',
      role: 'assistant',
      content: 'hi',
      model: 'llama',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      timing: { totalTimeSec: 0.4 },
      createdAt: new Date('2025-01-01T10:00:00Z'),
    },
  ];

  const res = await request(
    appWith({
      findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
      listAllTurns: async () => ({ items: turns }),
    }),
  )
    .get('/conversations/c1/turns')
    .expect(200);

  assert.deepEqual(res.body.items[0].usage, {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  });
  assert.deepEqual(res.body.items[0].timing, { totalTimeSec: 0.4 });
});

test('omits usage/timing when assistant turn has no metadata', async () => {
  const turns: TurnSummary[] = [
    {
      turnId: 't2',
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
  ];

  const res = await request(
    appWith({
      findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
      listAllTurns: async () => ({ items: turns }),
    }),
  )
    .get('/conversations/c1/turns')
    .expect(200);

  assert.equal('usage' in res.body.items[0], false);
  assert.equal('timing' in res.body.items[0], false);
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
