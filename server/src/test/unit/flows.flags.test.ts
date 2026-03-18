import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import { ConversationModel } from '../../mongo/conversation.js';
import {
  listConversations,
  updateConversationFlowState,
  updateConversationWorkingFolder,
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
        loopStack: [{ loopStepPath: [0], iteration: 2 }],
        workingFolder: '/repos/flow-root',
        agentConversations: { 'planning_agent:main': 'agent-conv-1' },
        agentWorkingFolders: { 'planning_agent:main': '/repos/flow-root' },
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
        loopStack: [{ loopStepPath: [0], iteration: 2 }],
        workingFolder: '/repos/flow-root',
        agentConversations: { 'planning_agent:main': 'agent-conv-1' },
        agentWorkingFolders: { 'planning_agent:main': '/repos/flow-root' },
        agentThreads: { 'planning_agent:main': 'thread-1' },
      },
    },
  });
});

test('updateConversationWorkingFolder persists flags.workingFolder via nested $set', async () => {
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
    await updateConversationWorkingFolder({
      conversationId: 'flow-2',
      workingFolder: '/repos/working-root',
    });
  } finally {
    ConversationModel.findByIdAndUpdate = original;
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: originalReady,
      configurable: true,
    });
  }

  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.id, 'flow-2');
  assert.deepEqual(captured[0]?.update, {
    $set: {
      'flags.workingFolder': '/repos/working-root',
    },
  });
});

test('writing flags.workingFolder does not replace sibling flags such as threadId', async () => {
  const originalReady = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', {
    value: 1,
    configurable: true,
  });

  const original = ConversationModel.findByIdAndUpdate;
  let capturedUpdate: unknown;

  ConversationModel.findByIdAndUpdate = ((_id: unknown, update: unknown) => {
    capturedUpdate = update;
    return { exec: async () => null } as unknown as ReturnType<
      typeof ConversationModel.findByIdAndUpdate
    >;
  }) as typeof ConversationModel.findByIdAndUpdate;

  try {
    await updateConversationWorkingFolder({
      conversationId: 'flow-3',
      workingFolder: '/repos/working-root',
    });
  } finally {
    ConversationModel.findByIdAndUpdate = original;
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: originalReady,
      configurable: true,
    });
  }

  assert.deepEqual(capturedUpdate, {
    $set: {
      'flags.workingFolder': '/repos/working-root',
    },
  });
});

test('listConversations surfaces flags.workingFolder plus expanded flags.flow state', async () => {
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
                workingFolder: '/repos/working-root',
                flow: {
                  stepPath: [0, 1],
                  loopStack: [],
                  workingFolder: '/repos/working-root',
                  agentConversations: { 'agent:one': 'conv-1' },
                  agentWorkingFolders: { 'agent:one': '/repos/working-root' },
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
      workingFolder: '/repos/working-root',
      flow: {
        stepPath: [0, 1],
        loopStack: [],
        workingFolder: '/repos/working-root',
        agentConversations: { 'agent:one': 'conv-1' },
        agentWorkingFolders: { 'agent:one': '/repos/working-root' },
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

test('clearing flags.workingFolder uses nested $unset so flags.flow is preserved', async () => {
  const originalReady = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', {
    value: 1,
    configurable: true,
  });

  const original = ConversationModel.findByIdAndUpdate;
  let capturedUpdate: unknown;

  ConversationModel.findByIdAndUpdate = ((_id: unknown, update: unknown) => {
    capturedUpdate = update;
    return { exec: async () => null } as unknown as ReturnType<
      typeof ConversationModel.findByIdAndUpdate
    >;
  }) as typeof ConversationModel.findByIdAndUpdate;

  try {
    await updateConversationWorkingFolder({
      conversationId: 'flow-4',
      workingFolder: '',
    });
  } finally {
    ConversationModel.findByIdAndUpdate = original;
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: originalReady,
      configurable: true,
    });
  }

  assert.deepEqual(capturedUpdate, {
    $unset: {
      'flags.workingFolder': 1,
    },
  });
});

test('working-folder persistence avoids replacing the entire Mixed flags object', async () => {
  const originalReady = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', {
    value: 1,
    configurable: true,
  });

  const original = ConversationModel.findByIdAndUpdate;
  let capturedUpdate: unknown;

  ConversationModel.findByIdAndUpdate = ((_id: unknown, update: unknown) => {
    capturedUpdate = update;
    return { exec: async () => null } as unknown as ReturnType<
      typeof ConversationModel.findByIdAndUpdate
    >;
  }) as typeof ConversationModel.findByIdAndUpdate;

  try {
    await updateConversationWorkingFolder({
      conversationId: 'flow-5',
      workingFolder: '/repos/working-root',
    });
  } finally {
    ConversationModel.findByIdAndUpdate = original;
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: originalReady,
      configurable: true,
    });
  }

  assert.equal(
    Object.prototype.hasOwnProperty.call(capturedUpdate as object, 'flags'),
    false,
  );
});
