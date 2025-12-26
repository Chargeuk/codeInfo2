import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationModel } from '../../mongo/conversation.js';
import { listConversations } from '../../mongo/repo.js';

const restore = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  original: T[K],
) => {
  (target as Record<string, unknown>)[key as string] = original as unknown;
};

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
