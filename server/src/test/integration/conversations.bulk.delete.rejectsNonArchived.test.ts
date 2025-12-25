import assert from 'node:assert/strict';
import test from 'node:test';

import mongoose from 'mongoose';

import { ConversationModel } from '../../mongo/conversation.js';
import { bulkDeleteArchivedConversations } from '../../mongo/repo.js';
import { TurnModel } from '../../mongo/turn.js';

test('bulk delete rejects any non-archived conversationId (no deletions)', async () => {
  const originalReadyState = mongoose.connection.readyState;
  const originalTransaction = mongoose.connection.transaction;
  const originalFind = ConversationModel.find.bind(ConversationModel);
  const originalTurnDeleteMany = TurnModel.deleteMany.bind(TurnModel);
  const originalConversationDeleteMany =
    ConversationModel.deleteMany.bind(ConversationModel);

  let deleteCalled = false;

  try {
    (mongoose.connection as unknown as { readyState: number }).readyState = 1;
    (mongoose.connection as unknown as { transaction: unknown }).transaction =
      (async (executor: (session: unknown) => unknown) =>
        await executor({})) as never;

    (ConversationModel as unknown as { find: unknown }).find = () =>
      ({
        session: () => ({
          lean: () => ({
            exec: async () => [
              {
                _id: 'c1',
                provider: 'lmstudio',
                model: 'm1',
                title: 't1',
                source: 'REST',
                flags: {},
                lastMessageAt: new Date('2025-01-01T00:00:00Z'),
                archivedAt: null,
                createdAt: new Date('2025-01-01T00:00:00Z'),
                updatedAt: new Date('2025-01-01T00:00:00Z'),
              },
            ],
          }),
        }),
      }) as never;

    (TurnModel as unknown as { deleteMany: unknown }).deleteMany = () => ({
      exec: async () => {
        deleteCalled = true;
        return {};
      },
    });

    (ConversationModel as unknown as { deleteMany: unknown }).deleteMany =
      () => ({
        exec: async () => {
          deleteCalled = true;
          return {};
        },
      });

    const result = await bulkDeleteArchivedConversations({
      conversationIds: ['c1'],
    });

    assert.deepEqual(result, {
      ok: false,
      error: 'not_archived',
      activeIds: ['c1'],
    });
    assert.equal(deleteCalled, false);
  } finally {
    (mongoose.connection as unknown as { readyState: number }).readyState =
      originalReadyState;
    (mongoose.connection as unknown as { transaction: unknown }).transaction =
      originalTransaction;
    (ConversationModel as unknown as { find: unknown }).find = originalFind;
    (TurnModel as unknown as { deleteMany: unknown }).deleteMany =
      originalTurnDeleteMany;
    (ConversationModel as unknown as { deleteMany: unknown }).deleteMany =
      originalConversationDeleteMany;
  }
});
