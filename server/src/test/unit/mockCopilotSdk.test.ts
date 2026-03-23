import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAssistantMessageDeltaEvent,
  createAssistantMessageEvent,
  createMockCopilotSdkHarness,
  createSessionErrorEvent,
  createToolExecutionCompleteEvent,
  createToolExecutionStartEvent,
} from '../support/mockCopilotSdk.js';

test('mock Copilot SDK harness boots a fake client successfully with default scenario', async () => {
  const harness = createMockCopilotSdkHarness({ name: 'boot-ok' });
  const lifecycle = harness.createLifecycle();

  await lifecycle.start();
  const models = await lifecycle.listModels();

  assert.equal(harness.getState().started, true);
  assert.equal(harness.getState().startCount, 1);
  assert.equal(models.length, 1);
  assert.equal(models[0]?.id, 'copilot-gpt-5');
});

test('mock Copilot SDK harness replays scripted assistant and tool events deterministically', async () => {
  const harness = createMockCopilotSdkHarness({
    name: 'event-sequence',
    createSessionEvents: [
      createAssistantMessageDeltaEvent({ deltaContent: 'hello ' }),
      createToolExecutionStartEvent({ toolCallId: 'tool-1', toolName: 'read' }),
      createToolExecutionCompleteEvent({
        toolCallId: 'tool-1',
        content: 'done',
      }),
      createAssistantMessageEvent({ content: 'hello world' }),
    ],
  });
  const lifecycle = harness.createLifecycle();
  const session = await lifecycle.createSession({
    sessionId: 'session-1',
    model: 'copilot-gpt-5',
    onPermissionRequest: async () => ({ kind: 'approved' }),
  });

  const seen: string[] = [];
  session.on((event) => {
    seen.push(event.type);
  });

  await session.sendAndWait({ prompt: 'hello world' });

  assert.deepEqual(seen, [
    'assistant.message_delta',
    'tool.execution_start',
    'tool.execution_complete',
    'assistant.message',
  ]);
});

test('mock Copilot SDK harness surfaces scripted startup and session failures exactly once', async () => {
  const harness = createMockCopilotSdkHarness({
    name: 'fail-on-start',
    startError: new Error('copilot fake start failed'),
    createSessionError: new Error('copilot fake session failed'),
    resumeSessionEvents: [createSessionErrorEvent('session exploded')],
  });
  const lifecycle = harness.createLifecycle();

  await assert.rejects(() => lifecycle.start(), /copilot fake start failed/u);
  assert.equal(harness.getState().startCount, 1);

  await assert.rejects(
    () =>
      lifecycle.createSession({
        sessionId: 'session-1',
        model: 'copilot-gpt-5',
        onPermissionRequest: async () => ({ kind: 'approved' }),
      }),
    /copilot fake session failed/u,
  );
});
