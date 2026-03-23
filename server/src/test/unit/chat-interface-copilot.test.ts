import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatEvent } from '../../chat/interfaces/ChatInterface.js';
import { ChatInterfaceCopilot } from '../../chat/interfaces/ChatInterfaceCopilot.js';
import {
  createMockCopilotSdkHarness,
  createSessionIdleEvent,
  type MockCopilotSdkHarness,
} from '../support/mockCopilotSdk.js';

const collectEvents = (chat: ChatInterfaceCopilot) => {
  const emitted: ChatEvent[] = [];
  for (const eventName of [
    'thread',
    'token',
    'analysis',
    'tool-request',
    'tool-result',
    'final',
    'complete',
    'error',
  ] as const) {
    chat.on(eventName, (event) => emitted.push(event));
  }
  return emitted;
};

const createChat = (harness: MockCopilotSdkHarness) =>
  new ChatInterfaceCopilot(harness.createLifecycle());

test('ChatInterfaceCopilot create-session path maps streamed events into ChatInterface events', async () => {
  const harness = createMockCopilotSdkHarness({
    name: 'copilot-create-session',
  });
  const chat = createChat(harness);
  const emitted = collectEvents(chat);

  await chat.run(
    'Hello from Copilot',
    { provider: 'copilot', skipPersistence: true, resumeConversation: false },
    'copilot-conversation-1',
    'copilot-gpt-5',
  );

  assert.deepEqual(
    emitted.map((event) => event.type),
    ['thread', 'token', 'final', 'complete'],
  );
  assert.equal(
    harness.getState().lastCreateSessionConfig?.sessionId,
    'copilot-conversation-1',
  );
});

test('ChatInterfaceCopilot resume path keeps event mapping aligned with create', async () => {
  const harness = createMockCopilotSdkHarness({
    name: 'copilot-resume-session',
  });
  const chat = createChat(harness);
  const emitted = collectEvents(chat);

  await chat.run(
    'Resume this thread',
    { provider: 'copilot', skipPersistence: true, resumeConversation: true },
    'copilot-conversation-2',
    'copilot-gpt-5',
  );

  assert.equal(
    harness.getState().lastResumeSession?.sessionId,
    'copilot-conversation-2',
  );
  assert.deepEqual(
    emitted.map((event) => event.type),
    ['thread', 'tool-request', 'tool-result', 'complete'],
  );
});

test('ChatInterfaceCopilot create-session config allows permissions by default', async () => {
  const harness = createMockCopilotSdkHarness({
    name: 'copilot-create-permission',
    createSessionEvents: [createSessionIdleEvent()],
  });
  const chat = createChat(harness);

  await chat.run(
    'Need permissions',
    { provider: 'copilot', skipPersistence: true, resumeConversation: false },
    'copilot-conversation-3',
    'copilot-gpt-5',
  );

  const result = await harness
    .getState()
    .lastCreateSessionConfig?.onPermissionRequest?.(
      {} as never,
      { sessionId: 'copilot-conversation-3' } as never,
    );
  assert.deepEqual(result, { kind: 'approved' });
});

test('ChatInterfaceCopilot resume path re-registers hooks and keeps permissions allowed', async () => {
  const harness = createMockCopilotSdkHarness({
    name: 'copilot-resume-permission',
    resumeSessionEvents: [createSessionIdleEvent()],
  });
  const chat = createChat(harness);

  await chat.run(
    'Resume with permissions',
    { provider: 'copilot', skipPersistence: true, resumeConversation: true },
    'copilot-conversation-4',
    'copilot-gpt-5',
  );

  const result = await harness
    .getState()
    .lastResumeSession?.config.onPermissionRequest?.(
      {} as never,
      { sessionId: 'copilot-conversation-4' } as never,
    );
  assert.deepEqual(result, { kind: 'approved' });
  assert.equal(harness.getState().resumeRegisterHooksCount > 0, true);
});

test('ChatInterfaceCopilot surfaces clear errors when resume-time hook re-registration fails', async () => {
  const harness = createMockCopilotSdkHarness({
    name: 'copilot-resume-hook-failure',
    resumeRegisterHooksError: new Error('resume hooks failed'),
    resumeSessionEvents: [createSessionIdleEvent()],
  });
  const chat = createChat(harness);

  await assert.rejects(
    () =>
      chat.run(
        'Resume and fail',
        {
          provider: 'copilot',
          skipPersistence: true,
          resumeConversation: true,
        },
        'copilot-conversation-5',
        'copilot-gpt-5',
      ),
    /resume hooks failed/u,
  );
});
