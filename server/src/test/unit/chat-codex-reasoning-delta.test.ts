import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { ChatInterfaceCodex } from '../../chat/interfaces/ChatInterfaceCodex.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';

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
