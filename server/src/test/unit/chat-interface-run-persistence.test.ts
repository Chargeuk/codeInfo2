import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import mongoose from 'mongoose';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import type { TurnStatus } from '../../mongo/turn.js';

class PersistSpyChat extends ChatInterface {
  public persisted: Array<{
    role: string;
    content: string;
    model: string;
    provider: string;
    source?: string;
  }> = [];
  public executeCalls = 0;

  protected override async persistTurn(input: {
    conversationId: string;
    role: string;
    content: string;
    model: string;
    provider: string;
    status: TurnStatus;
    source?: string;
  }): Promise<void> {
    this.persisted.push({
      role: input.role,
      content: input.content,
      model: input.model,
      provider: input.provider,
      source: input.source,
    });
  }

  async execute(): Promise<void> {
    this.executeCalls += 1;
    this.emitEvent({ type: 'token', content: 'partial' });
    this.emitEvent({ type: 'final', content: 'assistant-reply' });
    this.emitEvent({ type: 'complete' });
  }
}

const withReadyState = async (
  readyState: number,
  nodeEnv: string,
  fn: () => Promise<void>,
) => {
  const originalEnv = process.env.NODE_ENV;
  const originalReady = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', {
    value: readyState,
    configurable: true,
  });
  process.env.NODE_ENV = nodeEnv;
  try {
    await fn();
  } finally {
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: originalReady,
      configurable: true,
    });
    process.env.NODE_ENV = originalEnv;
  }
};

describe('ChatInterface.run persistence', () => {
  test('persists user turn then executes when Mongo is available', async () => {
    const chat = new PersistSpyChat();
    await withReadyState(1, 'development', async () => {
      await chat.run(
        'hello',
        { provider: 'codex', source: 'REST' },
        'conv-a',
        'model-a',
      );
    });

    assert.equal(chat.executeCalls, 1);
    assert.equal(chat.persisted.length, 2);
    assert.deepEqual(chat.persisted[0], {
      role: 'user',
      content: 'hello',
      model: 'model-a',
      provider: 'codex',
      source: 'REST',
    });
    assert.deepEqual(chat.persisted[1], {
      role: 'assistant',
      content: 'assistant-reply',
      model: 'model-a',
      provider: 'codex',
      source: 'REST',
    });
  });

  test('skips Mongo and does not call persistTurn when using memory fallback', async () => {
    const chat = new PersistSpyChat();
    await withReadyState(0, 'test', async () => {
      await chat.run(
        'hello',
        { provider: 'lmstudio', source: 'MCP' },
        'conv-b',
        'model-b',
      );
    });

    assert.equal(chat.executeCalls, 1);
    assert.equal(chat.persisted.length, 0);
  });
});
