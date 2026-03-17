import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import type { Conversation } from '../../mongo/conversation.js';
import {
  type AppendTurnInput,
  type ConversationSummary,
} from '../../mongo/repo.js';
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

const buildRepoEntry = (containerPath: string): RepoEntry => ({
  id: crypto.randomUUID(),
  description: null,
  containerPath,
  hostPath: containerPath,
  lastIngestAt: null,
  embeddingProvider: 'lmstudio',
  embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
  embeddingDimensions: 768,
  modelId: 'text-embedding-nomic-embed-text-v1.5',
  counts: { files: 0, chunks: 0, embedded: 0 },
  lastError: null,
});

const appWith = (
  overrides: Parameters<typeof createConversationsRouter>[0],
) => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter(overrides));
  return app;
};

const applyConversationFilters = (
  items: ConversationSummary[],
  params: { agentName?: string; flowName?: string },
) => {
  let filtered = items;
  if (params.agentName !== undefined) {
    if (params.agentName === '__none__') {
      filtered = filtered.filter((item) => !item.agentName);
    } else {
      filtered = filtered.filter((item) => item.agentName === params.agentName);
    }
  }
  if (params.flowName !== undefined) {
    if (params.flowName === '__none__') {
      filtered = filtered.filter((item) => !item.flowName);
    } else {
      filtered = filtered.filter((item) => item.flowName === params.flowName);
    }
  }
  return filtered;
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

test('flowName query forwards to repo layer', async () => {
  const calls: unknown[] = [];
  const res = await request(
    appWith({
      listConversations: async (params) => {
        calls.push(params);
        return {
          items: [
            {
              ...baseItem,
              flowName: 'demo-flow',
            },
          ],
        };
      },
    }),
  )
    .get('/conversations?flowName=demo-flow')
    .expect(200);

  assert.equal(res.body.items[0].flowName, 'demo-flow');
  assert.equal((calls[0] as { flowName?: string }).flowName, 'demo-flow');
});

test('conversation list responses preserve flags.workingFolder', async () => {
  const res = await request(
    appWith({
      listConversations: async () => ({
        items: [
          {
            ...baseItem,
            flags: { workingFolder: process.cwd() },
          },
        ],
      }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(process.cwd())],
        lockedModelId: null,
      }),
    }),
  )
    .get('/conversations')
    .expect(200);

  assert.deepEqual(res.body.items[0].flags, {
    workingFolder: process.cwd(),
  });
});

test('REST-seeded conversations become visible through GET /conversations after turns are added', async () => {
  const originalRandomUUID = crypto.randomUUID;
  (crypto as unknown as { randomUUID: () => string }).randomUUID = () =>
    'conv-seeded';

  const storedConversations = new Map<string, Conversation>();

  const app = appWith({
    createConversation: async (input) => {
      const conversation = {
        _id: input.conversationId,
        provider: input.provider,
        model: input.model,
        title: input.title,
        source: input.source ?? 'REST',
        flags: input.flags ?? {},
        lastMessageAt: input.lastMessageAt ?? new Date(),
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
        archivedAt: null,
      } satisfies Conversation;
      storedConversations.set(input.conversationId, conversation);
      return conversation;
    },
    findConversationById: async (id) => storedConversations.get(id) ?? null,
    appendTurn: async (input: AppendTurnInput) => {
      const existing = storedConversations.get(input.conversationId);
      if (!existing) {
        throw new Error(`Conversation not found: ${input.conversationId}`);
      }
      const createdAt = input.createdAt ?? new Date('2025-01-01T00:01:00Z');
      storedConversations.set(input.conversationId, {
        ...existing,
        lastMessageAt: createdAt,
        updatedAt: createdAt,
      } satisfies Conversation);
      return {
        _id: 'turn-seeded',
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        model: input.model,
        provider: input.provider,
        source: input.source ?? 'REST',
        toolCalls: input.toolCalls ?? null,
        status: input.status,
        command: input.command,
        usage: input.usage,
        timing: input.timing,
        runtime: input.runtime,
        createdAt,
      };
    },
    resolveListConversations:
      () =>
      async ({ limit }) => {
        const items = [...storedConversations.values()]
          .sort(
            (left, right) =>
              right.lastMessageAt.getTime() - left.lastMessageAt.getTime(),
          )
          .slice(0, limit)
          .map(
            (conversation) =>
              ({
                conversationId: conversation._id,
                provider: conversation.provider,
                model: conversation.model,
                title: conversation.title,
                source: conversation.source ?? 'REST',
                lastMessageAt: conversation.lastMessageAt,
                archived: conversation.archivedAt != null,
                flags: conversation.flags ?? {},
                createdAt: conversation.createdAt,
                updatedAt: conversation.updatedAt,
              }) satisfies ConversationSummary,
          );
        return { items };
      },
  });

  try {
    const createRes = await request(app)
      .post('/conversations')
      .send({ provider: 'codex', model: 'gpt-5.1-codex-max', title: 'Seeded' })
      .expect(201);

    assert.equal(createRes.body.conversationId, 'conv-seeded');

    await request(app)
      .post('/conversations/conv-seeded/turns')
      .send({
        role: 'assistant',
        content: 'Seeded reply',
        model: 'gpt-5.1-codex-max',
        provider: 'codex',
        status: 'ok',
      })
      .expect(201);

    const listRes = await request(app).get('/conversations').expect(200);

    assert.equal(listRes.body.items.length, 1);
    assert.equal(listRes.body.items[0].conversationId, 'conv-seeded');
    assert.equal(listRes.body.items[0].title, 'Seeded');
  } finally {
    (crypto as unknown as { randomUUID: () => string }).randomUUID =
      originalRandomUUID;
  }
});

test('flowName=__none__ forwards sentinel to repo layer', async () => {
  const calls: unknown[] = [];
  const res = await request(
    appWith({
      listConversations: async (params) => {
        calls.push(params);
        return { items: [baseItem] };
      },
    }),
  )
    .get('/conversations?flowName=__none__')
    .expect(200);

  assert.equal(Array.isArray(res.body.items), true);
  assert.equal((calls[0] as { flowName?: string }).flowName, '__none__');
});

test('agentName=__none__&flowName=__none__ returns only chat conversations', async () => {
  const items: ConversationSummary[] = [
    baseItem,
    { ...baseItem, conversationId: 'c2', flowName: 'demo-flow' },
    { ...baseItem, conversationId: 'c3', agentName: 'coding_agent' },
    {
      ...baseItem,
      conversationId: 'c4',
      agentName: 'coding_agent',
      flowName: 'demo-flow',
    },
  ];

  const res = await request(
    appWith({
      listConversations: async (params) => ({
        items: applyConversationFilters(items, params),
      }),
    }),
  )
    .get('/conversations?agentName=__none__&flowName=__none__')
    .expect(200);

  assert.deepEqual(
    res.body.items.map((c: { conversationId: string }) => c.conversationId),
    ['c1'],
  );
});

test('agentName=__none__&flowName=<name> returns non-agent flow conversations only', async () => {
  const items: ConversationSummary[] = [
    baseItem,
    { ...baseItem, conversationId: 'c2', flowName: 'demo-flow' },
    { ...baseItem, conversationId: 'c3', agentName: 'coding_agent' },
    {
      ...baseItem,
      conversationId: 'c4',
      agentName: 'coding_agent',
      flowName: 'demo-flow',
    },
  ];

  const res = await request(
    appWith({
      listConversations: async (params) => ({
        items: applyConversationFilters(items, params),
      }),
    }),
  )
    .get('/conversations?agentName=__none__&flowName=demo-flow')
    .expect(200);

  assert.deepEqual(
    res.body.items.map((c: { conversationId: string }) => c.conversationId),
    ['c2'],
  );
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
