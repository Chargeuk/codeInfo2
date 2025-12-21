import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationModel } from '../../mongo/conversation.js';
import { appendTurn, listTurns } from '../../mongo/repo.js';
import { TurnModel, type TurnCommandMetadata } from '../../mongo/turn.js';

const restore = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  original: T[K],
) => {
  (target as Record<string, unknown>)[key as string] = original as unknown;
};

test('stores + returns command when provided', async () => {
  const stored: Array<Record<string, unknown>> = [];

  const originalCreate = TurnModel.create;
  const originalFind = TurnModel.find;
  const originalUpdate = ConversationModel.findByIdAndUpdate;

  (TurnModel as unknown as Record<string, unknown>).create = async (
    doc: Record<string, unknown>,
  ) => {
    stored.push(doc);
    return doc;
  };

  (TurnModel as unknown as Record<string, unknown>).find = () => ({
    sort: () => ({
      limit: () => ({
        lean: async () => stored,
      }),
    }),
  });

  (ConversationModel as unknown as Record<string, unknown>).findByIdAndUpdate =
    () => ({
      exec: async () => null,
    });

  try {
    const command: TurnCommandMetadata = {
      name: 'improve_plan',
      stepIndex: 2,
      totalSteps: 12,
    };

    await appendTurn({
      conversationId: 'c1',
      role: 'user',
      content: 'hello',
      model: 'm1',
      provider: 'codex',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      command,
    });

    const { items } = await listTurns({ conversationId: 'c1', limit: 10 });
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].command, command);
  } finally {
    restore(
      TurnModel as unknown as Record<string, unknown>,
      'create',
      originalCreate,
    );
    restore(
      TurnModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'findByIdAndUpdate',
      originalUpdate,
    );
  }
});

test('omitting command keeps existing behavior', async () => {
  const stored: Array<Record<string, unknown>> = [];

  const originalCreate = TurnModel.create;
  const originalFind = TurnModel.find;
  const originalUpdate = ConversationModel.findByIdAndUpdate;

  (TurnModel as unknown as Record<string, unknown>).create = async (
    doc: Record<string, unknown>,
  ) => {
    stored.push(doc);
    return doc;
  };

  (TurnModel as unknown as Record<string, unknown>).find = () => ({
    sort: () => ({
      limit: () => ({
        lean: async () => stored,
      }),
    }),
  });

  (ConversationModel as unknown as Record<string, unknown>).findByIdAndUpdate =
    () => ({
      exec: async () => null,
    });

  try {
    await appendTurn({
      conversationId: 'c2',
      role: 'assistant',
      content: 'hi',
      model: 'm1',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
    });

    const { items } = await listTurns({ conversationId: 'c2', limit: 10 });
    assert.equal(items.length, 1);
    assert.equal(items[0].command, undefined);
  } finally {
    restore(
      TurnModel as unknown as Record<string, unknown>,
      'create',
      originalCreate,
    );
    restore(
      TurnModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'findByIdAndUpdate',
      originalUpdate,
    );
  }
});
