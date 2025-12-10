import assert from 'node:assert/strict';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { memoryTurns } from '../../chat/memoryPersistence.js';

class StubChat extends ChatInterface {
  executeCalls = 0;
  async execute(): Promise<void> {
    this.executeCalls += 1;
    this.emitEvent({ type: 'complete' });
  }
}

test('REST chat run stores a single user turn with source REST in memory mode', async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalReady = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', {
    value: 0,
    configurable: true,
  });
  process.env.NODE_ENV = 'test';

  const chat = new StubChat();
  const conversationId = 'rest-memory-conv';
  const message = 'Hello!';
  memoryTurns.delete(conversationId);

  try {
    await chat.run(
      message,
      { provider: 'lmstudio', source: 'REST' },
      conversationId,
      'lm-model',
    );

    const turns = memoryTurns.get(conversationId) ?? [];
    assert.equal(chat.executeCalls, 1);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.role, 'user');
    assert.equal(turns[0]?.content, message);
    assert.equal(turns[0]?.source, 'REST');
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
    memoryTurns.delete(conversationId);
  }
});
