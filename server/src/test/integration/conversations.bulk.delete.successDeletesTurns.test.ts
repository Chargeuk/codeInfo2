import assert from 'node:assert/strict';
import test from 'node:test';

import mongoose from 'mongoose';

import { ConversationModel } from '../../mongo/conversation.js';
import { bulkDeleteArchivedConversations } from '../../mongo/repo.js';
import { TurnModel } from '../../mongo/turn.js';

test('bulk delete deletes conversations and turns (archived-only)', async () => {
  const originalReadyState = mongoose.connection.readyState;
  const originalTransaction = mongoose.connection.transaction;
  const originalFind = ConversationModel.find.bind(ConversationModel);
  const originalTurnDeleteMany = TurnModel.deleteMany.bind(TurnModel);
  const originalConversationDeleteMany =
    ConversationModel.deleteMany.bind(ConversationModel);

  const deletedTurns: unknown[] = [];
  const deletedConversations: unknown[] = [];

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
                archivedAt: new Date('2025-01-01T00:00:00Z'),
                createdAt: new Date('2025-01-01T00:00:00Z'),
                updatedAt: new Date('2025-01-01T00:00:00Z'),
              },
              {
                _id: 'c2',
                provider: 'lmstudio',
                model: 'm1',
                title: 't2',
                source: 'REST',
                flags: {},
                lastMessageAt: new Date('2025-01-02T00:00:00Z'),
                archivedAt: new Date('2025-01-02T00:00:00Z'),
                createdAt: new Date('2025-01-02T00:00:00Z'),
                updatedAt: new Date('2025-01-02T00:00:00Z'),
              },
            ],
          }),
        }),
      }) as never;

    (TurnModel as unknown as { deleteMany: unknown }).deleteMany = (
      filter: unknown,
    ) => ({
      exec: async () => {
        deletedTurns.push(filter);
        return {};
      },
    });

    (ConversationModel as unknown as { deleteMany: unknown }).deleteMany = (
      filter: unknown,
    ) => ({
      exec: async () => {
        deletedConversations.push(filter);
        return {};
      },
    });

    const result = await bulkDeleteArchivedConversations({
      conversationIds: ['c1', 'c2'],
    });

    assert.equal(result.ok, true);
    assert.equal(deletedTurns.length, 1);
    assert.equal(deletedConversations.length, 1);
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
