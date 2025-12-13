import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { runCodebaseQuestion } from '../../mcp2/tools/codebaseQuestion.js';
import { ConversationModel } from '../../mongo/conversation.js';
import { TurnModel } from '../../mongo/turn.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';

test('MCP chat persists conversation/turn with source MCP when persistence is available', async () => {
  const savedConversations: Record<string, unknown>[] = [];
  const savedTurns: Record<string, unknown>[] = [];

  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  const originalReady = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', {
    value: 1,
    configurable: true,
  });

  const originalFindById = ConversationModel.findById;
  const originalCreate = (
    ConversationModel as unknown as Record<string, unknown>
  ).create;
  const originalSave = (
    ConversationModel as unknown as { prototype: { save: unknown } }
  ).prototype.save;
  const originalFindByIdAndUpdate = ConversationModel.findByIdAndUpdate;
  const originalTurnCreate = TurnModel.create;
  const originalTurnFind = TurnModel.find;
  const originalTurnUpdate = ConversationModel.findByIdAndUpdate;

  // stub conversation lookups/saves
  (ConversationModel as unknown as Record<string, unknown>).findById = () => ({
    lean: () => ({
      exec: async () => null,
    }),
  });
  (
    ConversationModel as unknown as {
      prototype: { save: () => Promise<unknown> };
    }
  ).prototype.save = function saveMock(this: Record<string, unknown>) {
    savedConversations.push(this);
    return Promise.resolve(this);
  };
  (ConversationModel as unknown as Record<string, unknown>).findByIdAndUpdate =
    () => ({
      exec: async () => null,
    });

  // stub turn creation/update
  (TurnModel as unknown as Record<string, unknown>).find = () => ({
    sort: () => ({
      limit: () => ({
        lean: async () => [],
      }),
    }),
  });
  (TurnModel as unknown as Record<string, unknown>).create = async (
    payload: Record<string, unknown>,
  ) => {
    savedTurns.push(payload);
    return { ...payload, createdAt: new Date() };
  };

  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  try {
    const result = await runCodebaseQuestion(
      {
        question: 'Hello world?',
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
      },
      {
        codexFactory: () => ({
          startThread: () => ({
            runStreamed: async () => ({
              events: (async function* () {
                yield { type: 'turn.completed' };
              })(),
            }),
          }),
          resumeThread: () => ({
            runStreamed: async () => ({
              events: (async function* () {
                yield { type: 'turn.completed' };
              })(),
            }),
          }),
        }),
      },
    );

    assert.ok(result.content[0]?.text);
    assert.equal(savedConversations.length > 0, true);
    const firstConversation = savedConversations[0] as Record<string, unknown>;
    assert.equal(firstConversation.source, 'MCP');
    assert.equal(savedTurns.length, 2);
    const userTurn = savedTurns.find(
      (t) => (t as { role?: string }).role === 'user',
    ) as Record<string, unknown>;
    const assistantTurn = savedTurns.find(
      (t) => (t as { role?: string }).role === 'assistant',
    ) as Record<string, unknown>;
    assert.ok(userTurn);
    assert.ok(assistantTurn);
    assert.equal(userTurn.source, 'MCP');
    assert.equal(assistantTurn.source, 'MCP');
  } finally {
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: originalReady,
      configurable: true,
    });
    if (originalEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalEnv;
    }
    (ConversationModel as unknown as Record<string, unknown>).findById =
      originalFindById;
    (ConversationModel as unknown as Record<string, unknown>).create =
      originalCreate;
    (
      ConversationModel as unknown as { prototype: { save: unknown } }
    ).prototype.save = originalSave;
    (
      ConversationModel as unknown as Record<string, unknown>
    ).findByIdAndUpdate = originalFindByIdAndUpdate;
    (TurnModel as unknown as Record<string, unknown>).create =
      originalTurnCreate;
    (TurnModel as unknown as Record<string, unknown>).find = originalTurnFind;
    (
      ConversationModel as unknown as Record<string, unknown>
    ).findByIdAndUpdate = originalTurnUpdate;
  }
});
