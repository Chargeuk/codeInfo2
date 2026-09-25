import assert from 'node:assert/strict';
import nodeTest from 'node:test';

import request from 'supertest';

import { getActiveRunOwnership } from '../../agents/runLock.js';
import {
  beginScopedTestEnvIsolation,
  endScopedTestEnvIsolation,
} from '../support/processEnvIsolation.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';
import { startCopilotChatServer } from './support/copilotChatHarness.js';

const test = (name: string, fn: () => Promise<void> | void) =>
  nodeTest(name, async () => {
    beginScopedTestEnvIsolation();
    try {
      await fn();
    } finally {
      endScopedTestEnvIsolation();
    }
  });

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function waitForConversationLock(
  conversationId: string,
  timeoutMs = 4000,
) {
  const deadline = Date.now() + resolveConfiguredTestTimeoutMs(timeoutMs);
  while (Date.now() < deadline) {
    if (getActiveRunOwnership(conversationId)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for conversation lock: ${conversationId}`);
}

test('copilot chat keeps the existing conversation lock while the first run remains active', async () => {
  const sendGate = createDeferred();
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-lock',
      sendGate: sendGate.promise,
    },
  });

  try {
    const conversationId = 'copilot-locked-conversation';
    const first = request(server.httpServer)
      .post('/chat')
      .send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId,
        message: 'First turn',
      })
      .then((response) => response);

    await waitForConversationLock(conversationId);

    const second = await request(server.httpServer).post('/chat').send({
      provider: 'copilot',
      model: 'copilot-gpt-5',
      conversationId,
      message: 'Second turn',
    });

    sendGate.resolve();
    const firstResponse = await first;
    assert.equal(firstResponse.status, 202);
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'RUN_IN_PROGRESS');
  } finally {
    await server.stop();
  }
});
