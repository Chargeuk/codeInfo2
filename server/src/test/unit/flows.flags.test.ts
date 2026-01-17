import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import { ConversationModel } from '../../mongo/conversation.js';
import {
  listConversations,
  updateConversationFlowState,
} from '../../mongo/repo.js';

const restore = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  original: T[K],
) => {
  (target as Record<string, unknown>)[key as string] = original as unknown;
};

test('updateConversationFlowState persists flags.flow via $set', async () => {
  const originalReady = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', {
    value: 1,
    configurable: true,
  });

  const original = ConversationModel.findByIdAndUpdate;
  const captured: Array<{
    id: unknown;
    update: unknown;
    options: unknown;
  }> = [];

  ConversationModel.findByIdAndUpdate = ((
    id: unknown,
    update: unknown,
    options: unknown,
  ) => {
    captured.push({ id, update, options });
    return { exec: async () => null } as unknown as ReturnType<
      typeof ConversationModel.findByIdAndUpdate
    >;
  }) as typeof ConversationModel.findByIdAndUpdate;

  try {
    await updateConversationFlowState({
      conversationId: 'flow-1',
      flow: {
        stepPath: [1, 2],
        loopStack: [{ stepPath: [0], iteration: 2 }],
        agentConversations: { 'planning_agent:main': 'agent-conv-1' },
        agentThreads: { 'planning_agent:main': 'thread-1' },
      },
    });
  } finally {
    ConversationModel.findByIdAndUpdate = original;
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: originalReady,
      configurable: true,
    });
  }

  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.id, 'flow-1');
  assert.deepEqual(captured[0]?.update, {
    $set: {
      'flags.flow': {
        stepPath: [1, 2],
        loopStack: [{ stepPath: [0], iteration: 2 }],
        agentConversations: { 'planning_agent:main': 'agent-conv-1' },
        agentThreads: { 'planning_agent:main': 'thread-1' },
      },
    },
  });
});

test('listConversations surfaces flags.flow', async () => {
  const originalFind = ConversationModel.find;
  (ConversationModel as unknown as Record<string, unknown>).find = () => ({
    sort: () => ({
      limit: () => ({
        lean: async () =>
          [
            {
              _id: 'flow-1',
              provider: 'codex',
              model: 'gpt-5',
              title: 'Flow: example',
              flowName: 'example',
              flags: {
                flow: {
                  stepPath: [0, 1],
                  loopStack: [],
                  agentConversations: { 'agent:one': 'conv-1' },
                  agentThreads: {},
                },
              },
              lastMessageAt: new Date('2025-01-01T00:00:00Z'),
              archivedAt: null,
              createdAt: new Date('2025-01-01T00:00:00Z'),
              updatedAt: new Date('2025-01-01T00:00:00Z'),
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
    assert.equal(items.length, 1);
    assert.deepEqual(items[0]?.flags, {
      flow: {
        stepPath: [0, 1],
        loopStack: [],
        agentConversations: { 'agent:one': 'conv-1' },
        agentThreads: {},
      },
    });
  } finally {
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
  }
});
