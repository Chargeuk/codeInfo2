import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { memoryTurns } from '../../chat/memoryPersistence.js';

class MemoryChat extends ChatInterface {
  async execute(): Promise<void> {
    this.emitEvent({ type: 'final', content: 'ok' });
    this.emitEvent({ type: 'complete' });
  }
}

const withEnv = async (key: string, value: string, fn: () => Promise<void>) => {
  const original = process.env[key];
  process.env[key] = value;
  try {
    await fn();
  } finally {
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
};

describe('ChatInterface command metadata persistence', () => {
  test('persists command on both user and assistant turns', async () => {
    memoryTurns.clear();

    await withEnv('NODE_ENV', 'test', async () => {
      const chat = new MemoryChat();
      await chat.run(
        'hello',
        {
          provider: 'codex',
          source: 'REST',
          command: { name: 'improve_plan', stepIndex: 1, totalSteps: 3 },
        },
        'conv-command-a',
        'model-a',
      );
    });

    const turns = memoryTurns.get('conv-command-a') ?? [];
    assert.equal(turns.length, 2);
    assert.deepEqual(turns[0].command, {
      name: 'improve_plan',
      stepIndex: 1,
      totalSteps: 3,
    });
    assert.deepEqual(turns[1].command, {
      name: 'improve_plan',
      stepIndex: 1,
      totalSteps: 3,
    });
  });

  test('persists flow command metadata with default label', async () => {
    memoryTurns.clear();

    await withEnv('NODE_ENV', 'test', async () => {
      const chat = new MemoryChat();
      await chat.run(
        'hello',
        {
          provider: 'codex',
          source: 'REST',
          command: {
            name: 'flow',
            stepIndex: 1,
            totalSteps: 2,
            loopDepth: 0,
            agentType: 'coding_agent',
            identifier: 'flow-1',
          },
        },
        'conv-command-flow',
        'model-flow',
      );
    });

    const turns = memoryTurns.get('conv-command-flow') ?? [];
    assert.equal(turns.length, 2);
    assert.deepEqual(turns[0].command, {
      name: 'flow',
      stepIndex: 1,
      totalSteps: 2,
      loopDepth: 0,
      agentType: 'coding_agent',
      identifier: 'flow-1',
      label: 'flow',
    });
  });

  test('aborted run persists stopped assistant turn with command', async () => {
    memoryTurns.clear();

    await withEnv('NODE_ENV', 'test', async () => {
      class AbortChat extends ChatInterface {
        async execute(
          _message: string,
          flags: Record<string, unknown>,
        ): Promise<void> {
          const signal = (flags as { signal?: AbortSignal }).signal;
          await new Promise<void>((_resolve, reject) => {
            if (!signal) {
              reject(new Error('missing signal'));
              return;
            }
            if (signal.aborted) {
              reject(new Error('aborted'));
              return;
            }
            signal.addEventListener(
              'abort',
              () => {
                reject(new Error('aborted'));
              },
              { once: true },
            );
          });
        }
      }

      const controller = new AbortController();
      const chat = new AbortChat();
      const runPromise = chat.run(
        'hello',
        {
          provider: 'codex',
          source: 'REST',
          command: { name: 'improve_plan', stepIndex: 2, totalSteps: 3 },
          signal: controller.signal,
        },
        'conv-command-b',
        'model-b',
      );

      controller.abort();

      await assert.rejects(runPromise);
    });

    const turns = memoryTurns.get('conv-command-b') ?? [];
    assert.equal(turns.length, 2);
    assert.equal(turns[1].status, 'stopped');
    assert.deepEqual(turns[1].command, {
      name: 'improve_plan',
      stepIndex: 2,
      totalSteps: 3,
    });
  });
});
