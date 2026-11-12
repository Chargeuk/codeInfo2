import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { ConversationModel } from '../../mongo/conversation.js';
import {
  appendTurn,
  listConversations,
  listTurns,
  type AppendTurnInput,
} from '../../mongo/repo.js';
import { TurnModel } from '../../mongo/turn.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';

const restore = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  original: T[K],
) => {
  (target as Record<string, unknown>)[key as string] = original as unknown;
};

test('appendTurn forwards and lists the existing handover marker only when provided', async (t) => {
  const stored: AppendTurnInput[] = [];
  t.mock.method(TurnModel, 'create', async (input: AppendTurnInput) => {
    stored.push(input);
    return input;
  });
  t.mock.method(ConversationModel, 'findByIdAndUpdate', () => ({
    exec: async () => null,
  }));
  t.mock.method(TurnModel, 'find', () => ({
    sort: () => ({
      limit: () => ({ lean: async () => stored }),
    }),
  }));
  for (const metadata of [
    { role: 'user' as const, fork: { handover: true } },
    { role: 'assistant' as const },
    { role: 'user' as const },
  ]) {
    await appendTurn({
      conversationId: 'handover-persistence',
      content: 'acknowledgement proof',
      model: 'gpt-6.1-terra',
      provider: 'codex',
      status: 'ok',
      ...metadata,
    });
  }
  const { items } = await listTurns({
    conversationId: 'handover-persistence',
    limit: 10,
  });
  assert.equal(stored.length, 3);
  assert.equal(items.length, 3);
  assert.deepEqual(stored[0].fork, { handover: true });
  assert.deepEqual(items[0].fork, { handover: true });
  assert.equal(stored[1].fork, undefined);
  assert.equal(stored[2].fork, undefined);
  assert.equal(items[1].fork, undefined);
  assert.equal(items[2].fork, undefined);
});

test('Mongo chat persistence marks only the automatic user, not assistants or subsequent users', async () => {
  class PersistSpyChat extends ChatInterface {
    readonly persisted: AppendTurnInput[] = [];

    protected override async persistTurn(
      input: AppendTurnInput,
    ): Promise<{ turnId?: string }> {
      this.persisted.push(input);
      return {};
    }

    async execute(): Promise<void> {
      this.emitEvent({ type: 'final', content: 'Acknowledged.' });
      this.emitEvent({ type: 'complete' });
    }
  }

  const chat = new PersistSpyChat();
  const originalReadyState = Object.getOwnPropertyDescriptor(
    mongoose.connection,
    'readyState',
  );
  Object.defineProperty(mongoose.connection, 'readyState', {
    value: 1,
    configurable: true,
  });
  try {
    await runWithTestEnvOverrides({ NODE_ENV: 'development' }, async () => {
      await chat.run(
        'automatic handover',
        {
          provider: 'codex',
          source: 'REST',
          userTurnFork: { handover: true },
        },
        'marked-handover',
        'gpt-6.1-terra',
      );
      await chat.run(
        'ordinary follow-up',
        { provider: 'codex', source: 'REST' },
        'marked-handover',
        'gpt-6.1-terra',
      );
    });
  } finally {
    if (originalReadyState) {
      Object.defineProperty(
        mongoose.connection,
        'readyState',
        originalReadyState,
      );
    } else {
      Reflect.deleteProperty(mongoose.connection, 'readyState');
    }
  }

  assert.deepEqual(
    chat.persisted.map((turn) => turn.role),
    ['user', 'assistant', 'user', 'assistant'],
  );
  assert.deepEqual(chat.persisted[0].fork, { handover: true });
  assert.equal(chat.persisted[1].fork, undefined);
  assert.equal(chat.persisted[2].fork, undefined);
  assert.equal(chat.persisted[3].fork, undefined);
});

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
