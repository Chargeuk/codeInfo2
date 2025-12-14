import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationModel } from '../../mongo/conversation.js';
import { listConversations, listTurns } from '../../mongo/repo.js';
import { TurnModel } from '../../mongo/turn.js';

const restore = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  original: T[K],
) => {
  (target as Record<string, unknown>)[key as string] = original as unknown;
};

test('listConversations defaults source to REST when missing', async () => {
  const originalFind = ConversationModel.find;
  (ConversationModel as unknown as Record<string, unknown>).find = () => ({
    sort: () => ({
      limit: () => ({
        lean: async () =>
          [
            {
              _id: 'c1',
              provider: 'lmstudio',
              model: 'llama',
              title: 'Hi',
              flags: {},
              lastMessageAt: new Date('2025-01-01T00:00:00Z'),
              archivedAt: null,
              createdAt: new Date('2025-01-01T00:00:00Z'),
              updatedAt: new Date('2025-01-01T00:00:00Z'),
            },
            {
              _id: 'c2',
              provider: 'codex',
              model: 'gpt',
              title: 'MCP chat',
              agentName: 'coding_agent',
              source: 'MCP',
              flags: {},
              lastMessageAt: new Date('2025-01-02T00:00:00Z'),
              archivedAt: null,
              createdAt: new Date('2025-01-02T00:00:00Z'),
              updatedAt: new Date('2025-01-02T00:00:00Z'),
            },
          ] as unknown[],
      }),
    }),
  });

  try {
    const { items } = await listConversations({
      limit: 10,
      includeArchived: true,
    });
    const c1 = items.find((c) => c.conversationId === 'c1');
    const c2 = items.find((c) => c.conversationId === 'c2');
    assert(c1);
    assert(c2);
    assert.equal(c1.source, 'REST');
    assert.equal(c2.source, 'MCP');
    assert.equal(c2.agentName, 'coding_agent');
  } finally {
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
  }
});

test('listTurns defaults source to REST when missing', async () => {
  const originalFind = TurnModel.find;
  (TurnModel as unknown as Record<string, unknown>).find = () => ({
    sort: () => ({
      limit: () => ({
        lean: async () =>
          [
            {
              conversationId: 'c1',
              role: 'assistant',
              content: 'hi',
              model: 'llama',
              provider: 'lmstudio',
              toolCalls: null,
              status: 'ok',
              createdAt: new Date('2025-01-01T00:00:00Z'),
            },
            {
              conversationId: 'c1',
              role: 'user',
              content: 'hello',
              model: 'gpt',
              provider: 'codex',
              source: 'MCP',
              toolCalls: null,
              status: 'ok',
              createdAt: new Date('2025-01-01T00:01:00Z'),
            },
          ] as unknown[],
      }),
    }),
  });

  try {
    const { items } = await listTurns({ conversationId: 'c1', limit: 10 });
    const first = items.find((t) => t.provider === 'lmstudio');
    const second = items.find((t) => t.provider === 'codex');
    assert(first);
    assert(second);
    assert.equal(first.source, 'REST');
    assert.equal(second.source, 'MCP');
  } finally {
    restore(
      TurnModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
  }
});
