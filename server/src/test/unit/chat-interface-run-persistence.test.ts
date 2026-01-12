import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import mongoose from 'mongoose';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import type { AppendTurnInput } from '../../mongo/repo.js';
import type {
  TurnSource,
  TurnTimingMetadata,
  TurnUsageMetadata,
} from '../../mongo/turn.js';

class PersistSpyChat extends ChatInterface {
  public persisted: Array<{
    role: string;
    content: string;
    model: string;
    provider: string;
    source?: string;
    usage?: TurnUsageMetadata;
    timing?: TurnTimingMetadata;
  }> = [];
  public executeCalls = 0;
  private readonly completeEvent?: {
    usage?: TurnUsageMetadata;
    timing?: TurnTimingMetadata;
  };
  private readonly beforeComplete?: () => void;

  constructor(params?: {
    completeEvent?: { usage?: TurnUsageMetadata; timing?: TurnTimingMetadata };
    beforeComplete?: () => void;
  }) {
    super();
    this.completeEvent = params?.completeEvent;
    this.beforeComplete = params?.beforeComplete;
  }

  protected override async persistTurn(
    input: AppendTurnInput & { source?: TurnSource },
  ): Promise<{ turnId?: string }> {
    this.persisted.push({
      role: input.role,
      content: input.content,
      model: input.model,
      provider: input.provider,
      source: input.source,
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
      ...(input.timing !== undefined ? { timing: input.timing } : {}),
    });

    return {};
  }

  async execute(): Promise<void> {
    this.executeCalls += 1;
    this.emitEvent({ type: 'token', content: 'partial' });
    this.emitEvent({ type: 'final', content: 'assistant-reply' });
    if (this.beforeComplete) {
      this.beforeComplete();
    }
    this.emitEvent({
      type: 'complete',
      ...(this.completeEvent ?? {}),
    });
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

  test('persists assistant usage/timing when completion provides metadata', async () => {
    const chat = new PersistSpyChat({
      completeEvent: {
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
          cachedInputTokens: 2,
        },
        timing: {
          totalTimeSec: 1.25,
          tokensPerSecond: 16,
        },
      },
    });

    await withReadyState(1, 'development', async () => {
      await chat.run(
        'hello',
        { provider: 'lmstudio', source: 'REST' },
        'conv-c',
        'model-c',
      );
    });

    assert.equal(chat.persisted.length, 2);
    assert.deepEqual(chat.persisted[1].usage, {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      cachedInputTokens: 2,
    });
    assert.deepEqual(chat.persisted[1].timing, {
      totalTimeSec: 1.25,
      tokensPerSecond: 16,
    });
  });

  test('assistant persistence omits usage/timing when missing', async () => {
    const chat = new PersistSpyChat();

    await withReadyState(1, 'development', async () => {
      await chat.run(
        'hello',
        { provider: 'lmstudio', source: 'REST' },
        'conv-d',
        'model-d',
      );
    });

    assert.equal(chat.persisted.length, 2);
    assert.equal(chat.persisted[1].usage, undefined);
    assert.equal(chat.persisted[1].timing, undefined);
  });

  test('fallback timing uses run start when provider timing missing', async () => {
    let now = 10_000;
    const originalNow = Date.now;
    Date.now = () => now;

    const chat = new PersistSpyChat({
      beforeComplete: () => {
        now = 11_500;
      },
    });

    try {
      await withReadyState(1, 'development', async () => {
        await chat.run(
          'hello',
          { provider: 'lmstudio', source: 'REST' },
          'conv-e',
          'model-e',
        );
      });
    } finally {
      Date.now = originalNow;
    }

    assert.equal(chat.persisted.length, 2);
    const totalTimeSec = chat.persisted[1].timing?.totalTimeSec ?? 0;
    assert.ok(Math.abs(totalTimeSec - 1.5) < 0.001);
  });
});
