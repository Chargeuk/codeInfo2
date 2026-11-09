import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationModel } from '../../mongo/conversation.js';
import {
  listConversations,
  type ListConversationsParams,
} from '../../mongo/repo.js';

const restore = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  original: T[K],
) => {
  (target as Record<string, unknown>)[key as string] = original as unknown;
};

test('listConversations conversationId adds a literal _id predicate and preserves state and scoped predicates', async () => {
  const originalFind = ConversationModel.find;
  let capturedQuery: unknown;
  const conversationId = 'saved conversation /?+&%#';
  const cursor = new Date('2026-01-02T00:00:00Z');
  const cases: {
    params: ListConversationsParams;
    query: Record<string, unknown>;
  }[] = [
    {
      params: { limit: 20, conversationId },
      query: { _id: conversationId, archivedAt: null },
    },
    {
      params: { limit: 20, conversationId, state: 'active' },
      query: { _id: conversationId, archivedAt: null },
    },
    {
      params: { limit: 20, conversationId, state: 'archived' },
      query: { _id: conversationId, archivedAt: { $ne: null } },
    },
    {
      params: { limit: 20, conversationId, state: 'all' },
      query: { _id: conversationId },
    },
    {
      params: {
        limit: 20,
        conversationId,
        state: 'all',
        cursor: cursor.toISOString(),
        agentName: 'coding_agent',
        flowName: 'daily-flow',
        ancestorConversationId: 'root',
      },
      query: {
        _id: conversationId,
        agentName: 'coding_agent',
        flowName: 'daily-flow',
        'flags.flowChild.ancestors.conversationId': 'root',
        $and: [
          { flowName: { $exists: true, $nin: [null, ''] } },
          { agentName: { $in: [null, ''] } },
        ],
        lastMessageAt: { $lt: cursor },
      },
    },
    {
      params: {
        limit: 20,
        conversationId,
        state: 'all',
        agentName: '__none__',
        flowName: '__none__',
      },
      query: {
        _id: conversationId,
        $and: [
          {
            $or: [
              { agentName: { $exists: false } },
              { agentName: null },
              { agentName: '' },
            ],
          },
          {
            $or: [
              { flowName: { $exists: false } },
              { flowName: null },
              { flowName: '' },
            ],
          },
        ],
      },
    },
    {
      params: { limit: 20, state: 'all', agentName: 'coding_agent' },
      query: { agentName: 'coding_agent' },
    },
  ];
  (ConversationModel as unknown as Record<string, unknown>).find = (
    query: unknown,
  ) => {
    capturedQuery = query;
    return {
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    };
  };

  try {
    for (const { params, query } of cases) {
      assert.deepEqual(await listConversations(params), { items: [] });
      assert.deepEqual(capturedQuery, query, JSON.stringify(params));
    }
  } finally {
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
  }
});

test('listConversations agentName=__none__ adds an $or filter matching missing/empty agentName', async () => {
  const originalFind = ConversationModel.find;
  let capturedQuery: unknown;

  (ConversationModel as unknown as Record<string, unknown>).find = (
    query: unknown,
  ) => {
    capturedQuery = query;
    return {
      sort: () => ({
        limit: () => ({
          lean: async () => [],
        }),
      }),
    };
  };

  try {
    await listConversations({
      limit: 10,
      includeArchived: true,
      agentName: '__none__',
    });

    assert.equal(typeof capturedQuery, 'object');
    assert(capturedQuery);
    const query = capturedQuery as Record<string, unknown>;
    assert.equal(Array.isArray(query.$or), true);
    assert.deepEqual(query.$or, [
      { agentName: { $exists: false } },
      { agentName: null },
      { agentName: '' },
    ]);
  } finally {
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
  }
});

test('listConversations agentName=<agent> adds an exact match filter', async () => {
  const originalFind = ConversationModel.find;
  let capturedQuery: unknown;

  (ConversationModel as unknown as Record<string, unknown>).find = (
    query: unknown,
  ) => {
    capturedQuery = query;
    return {
      sort: () => ({
        limit: () => ({
          lean: async () => [],
        }),
      }),
    };
  };

  try {
    await listConversations({
      limit: 10,
      includeArchived: true,
      agentName: 'coding_agent',
    });

    assert.equal(typeof capturedQuery, 'object');
    assert(capturedQuery);
    const query = capturedQuery as Record<string, unknown>;
    assert.equal(query.agentName, 'coding_agent');
  } finally {
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
  }
});

test('listConversations flowName=__none__ adds an $or filter matching missing/empty flowName', async () => {
  const originalFind = ConversationModel.find;
  let capturedQuery: unknown;

  (ConversationModel as unknown as Record<string, unknown>).find = (
    query: unknown,
  ) => {
    capturedQuery = query;
    return {
      sort: () => ({
        limit: () => ({
          lean: async () => [],
        }),
      }),
    };
  };

  try {
    await listConversations({
      limit: 10,
      includeArchived: true,
      flowName: '__none__',
    });

    assert.equal(typeof capturedQuery, 'object');
    assert(capturedQuery);
    const query = capturedQuery as Record<string, unknown>;
    assert.equal(Array.isArray(query.$or), true);
    assert.deepEqual(query.$or, [
      { flowName: { $exists: false } },
      { flowName: null },
      { flowName: '' },
    ]);
  } finally {
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
  }
});

test('listConversations flowName=<name> adds an exact match filter', async () => {
  const originalFind = ConversationModel.find;
  let capturedQuery: unknown;

  (ConversationModel as unknown as Record<string, unknown>).find = (
    query: unknown,
  ) => {
    capturedQuery = query;
    return {
      sort: () => ({
        limit: () => ({
          lean: async () => [],
        }),
      }),
    };
  };

  try {
    await listConversations({
      limit: 10,
      includeArchived: true,
      flowName: 'demo-flow',
    });

    assert.equal(typeof capturedQuery, 'object');
    assert(capturedQuery);
    const query = capturedQuery as Record<string, unknown>;
    assert.equal(query.flowName, 'demo-flow');
  } finally {
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
  }
});

test('listConversations agentName filtering stays keyed to the saved agentName even when provider/model drift elsewhere', async () => {
  const originalFind = ConversationModel.find;
  let capturedQuery: unknown;

  (ConversationModel as unknown as Record<string, unknown>).find = (
    query: unknown,
  ) => {
    capturedQuery = query;
    return {
      sort: () => ({
        limit: () => ({
          lean: async () => [],
        }),
      }),
    };
  };

  try {
    await listConversations({
      limit: 10,
      includeArchived: true,
      agentName: 'coding_agent',
    });

    assert.equal(typeof capturedQuery, 'object');
    assert(capturedQuery);
    const query = capturedQuery as Record<string, unknown>;
    assert.equal(query.agentName, 'coding_agent');
    assert.equal('provider' in query, false);
    assert.equal('model' in query, false);
  } finally {
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
  }
});

test('ancestor list filtering uses persisted ancestry and excludes agent transcript copies while preserving scopes', async () => {
  const originalFind = ConversationModel.find;
  let capturedQuery: Record<string, unknown> = {};
  (ConversationModel as unknown as Record<string, unknown>).find = (
    query: Record<string, unknown>,
  ) => {
    capturedQuery = query;
    return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) };
  };
  try {
    await listConversations({
      limit: 100,
      state: 'all',
      ancestorConversationId: 'root',
      flowName: 'child',
    });
    assert.equal(
      capturedQuery['flags.flowChild.ancestors.conversationId'],
      'root',
    );
    assert.equal(capturedQuery.flowName, 'child');
    assert.deepEqual(capturedQuery.$and, [
      { flowName: { $exists: true, $nin: [null, ''] } },
      { agentName: { $in: [null, ''] } },
    ]);
    assert.equal(capturedQuery.archivedAt, undefined);
  } finally {
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
  }
});
