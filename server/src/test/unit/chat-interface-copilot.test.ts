import assert from 'node:assert/strict';
import test from 'node:test';

import { getChatInterface } from '../../chat/factory.js';
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
  getChatInterface('copilot', {
    copilotLifecycle: harness.createLifecycle(),
  }) as ChatInterfaceCopilot;

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
  const toolRequest = emitted.find(
    (event): event is Extract<ChatEvent, { type: 'tool-request' }> =>
      event.type === 'tool-request',
  );
  const toolResult = emitted.find(
    (event): event is Extract<ChatEvent, { type: 'tool-result' }> =>
      event.type === 'tool-result',
  );
  assert.equal(toolRequest?.name, 'read_file');
  assert.equal(toolResult?.name, 'read_file');
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
  assert.deepEqual(result, { kind: 'approve-once' });
  assert.deepEqual(
    harness
      .getState()
      .lastCreateSessionConfig?.tools?.map((tool) => tool.name)
      .sort(),
    ['ListIngestedRepositories', 'VectorSearch'],
  );
  assert.deepEqual(harness.getState().lastCreateSessionConfig?.availableTools, [
    'ListIngestedRepositories',
    'VectorSearch',
  ]);
});

test('ChatInterfaceCopilot create-session maps provider-neutral flags onto real Copilot session fields before events stream', async () => {
  const harness = createMockCopilotSdkHarness({
    name: 'copilot-create-runtime-flags',
    createSessionEvents: [createSessionIdleEvent()],
  });
  const chat = createChat(harness);
  const emitted = collectEvents(chat);

  await chat.run(
    'Use runtime flags',
    {
      provider: 'copilot',
      skipPersistence: true,
      resumeConversation: false,
      agentFlags: {
        modelReasoningEffort: 'high',
        toolAccess: 'off',
      },
    },
    'copilot-conversation-4',
    'copilot-gpt-5',
  );

  assert.equal(emitted[0]?.type, 'thread');
  assert.equal(
    harness.getState().lastCreateSessionConfig?.reasoningEffort,
    'high',
  );
  assert.deepEqual(
    harness.getState().lastCreateSessionConfig?.availableTools,
    [],
  );
});

test('ChatInterfaceCopilot resume path keeps permissions allowed through the resume session config', async () => {
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
      { sessionId: 'copilot-conversation-5' } as never,
    );
  assert.deepEqual(result, { kind: 'approve-once' });
  assert.deepEqual(
    harness
      .getState()
      .lastResumeSession?.config.tools?.map((tool) => tool.name)
      .sort(),
    ['ListIngestedRepositories', 'VectorSearch'],
  );
});

test('ChatInterfaceCopilot resume-session maps provider-neutral flags onto the real Copilot resume config', async () => {
  const harness = createMockCopilotSdkHarness({
    name: 'copilot-resume-runtime-flags',
    resumeSessionEvents: [createSessionIdleEvent()],
  });
  const chat = createChat(harness);

  await chat.run(
    'Resume and keep tools off',
    {
      provider: 'copilot',
      skipPersistence: true,
      resumeConversation: true,
      agentFlags: {
        modelReasoningEffort: 'low',
        toolAccess: 'off',
      },
    },
    'copilot-conversation-6',
    'copilot-gpt-5',
  );

  assert.equal(
    harness.getState().lastResumeSession?.config.reasoningEffort,
    'low',
  );
  assert.deepEqual(
    harness.getState().lastResumeSession?.config.availableTools,
    [],
  );
});
