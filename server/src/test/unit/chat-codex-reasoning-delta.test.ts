import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import type { ThreadOptions as CodexThreadOptions } from '@openai/codex-sdk';
import { ChatInterfaceCodex } from '../../chat/interfaces/ChatInterfaceCodex.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { modelReasoningEfforts } from '../../routes/chatValidators.js';

type CodexEvent = Record<string, unknown>;

async function* streamEvents(events: CodexEvent[]) {
  for (const event of events) {
    yield event;
  }
}

beforeEach(() => {
  setCodexDetection({
    available: true,
    cliPath: '/usr/bin/codex',
    authPresent: true,
    configPresent: true,
  });
});

test('Codex reasoning deltas handle multi-item resets without truncation', async () => {
  const events: CodexEvent[] = [
    {
      type: 'item.updated',
      item: { type: 'reasoning', id: 'r1', text: 'Reasoning part A...' },
    },
    {
      type: 'item.updated',
      item: {
        type: 'reasoning',
        id: 'r1',
        text: 'Reasoning part A... continued',
      },
    },
    // Second reasoning item resets to a shorter / non-prefix text.
    {
      type: 'item.updated',
      item: { type: 'reasoning', id: 'r2', text: 'New block' },
    },
    {
      type: 'item.updated',
      item: { type: 'reasoning', id: 'r2', text: 'New block extended' },
    },
    { type: 'turn.completed' },
  ];

  const chat = new ChatInterfaceCodex(() => ({
    startThread: () => ({
      runStreamed: async () => ({ events: streamEvents(events) }),
    }),
    resumeThread: () => ({
      runStreamed: async () => ({ events: streamEvents(events) }),
    }),
  }));

  const analysisDeltas: string[] = [];
  chat.on('analysis', (event) => analysisDeltas.push(event.content));

  await chat.execute(
    'Hello',
    {
      threadId: 't1',
      useConfigDefaults: true,
      requestId: 'req-1',
    },
    'conv-1',
    'gpt-5.2',
  );

  const combined = analysisDeltas.join('');
  assert.ok(
    combined.includes('Reasoning part A... continued'),
    'should include streamed reasoning from the first item',
  );
  assert.ok(
    combined.includes('New block'),
    'should include reasoning from the second item even when it resets',
  );
});

test('passes every supported reasoning effort through thread options', async () => {
  let lastOptions: CodexThreadOptions | undefined;
  const chat = new ChatInterfaceCodex(() => ({
    startThread: (opts?: CodexThreadOptions) => {
      lastOptions = opts;
      return {
        runStreamed: async () =>
          ({
            events: streamEvents([{ type: 'turn.completed' }]),
          }) as {
            events: AsyncGenerator<unknown>;
          },
      };
    },
    resumeThread: () => {
      throw new Error('resumeThread should not be called in this test');
    },
  }));

  for (const reasoningEffort of modelReasoningEfforts) {
    await chat.execute(
      'Hello',
      {
        codexFlags: { modelReasoningEffort: reasoningEffort },
      },
      `conv-${reasoningEffort}`,
      'gpt-5.2-codex',
    );
    assert.equal(lastOptions?.modelReasoningEffort, reasoningEffort);
  }
});
