import assert from 'node:assert/strict';
import nodeTest from 'node:test';

import request from 'supertest';

import { memoryConversations } from '../../chat/memoryPersistence.js';
import {
  beginScopedTestEnvIsolation,
  endScopedTestEnvIsolation,
} from '../support/processEnvIsolation.js';
import {
  startCopilotChatServer,
  waitForAssistantTurn,
} from './support/copilotChatHarness.js';

const test = (name: string, fn: () => Promise<void> | void) =>
  nodeTest(name, async () => {
    beginScopedTestEnvIsolation();
    try {
      await fn();
    } finally {
      endScopedTestEnvIsolation();
    }
  });

test('copilot chat persists a conversation and resumes the same session identity on a follow-up turn', async () => {
  const server = await startCopilotChatServer({
    scenario: { name: 'copilot-chat-resume' },
  });

  try {
    const conversationId = 'copilot-chat-conversation';
    await request(server.httpServer)
      .post('/chat')
      .send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId,
        message: 'First turn',
      })
      .expect(202);

    await waitForAssistantTurn(conversationId);

    await request(server.httpServer)
      .post('/chat')
      .send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId,
        message: 'Second turn',
      })
      .expect(202);

    const turns = await waitForAssistantTurn(conversationId);
    assert.equal(
      server.harness.getState().lastResumeSession?.sessionId,
      conversationId,
    );
    assert.equal(
      memoryConversations.get(conversationId)?.flags?.copilotSessionId,
      undefined,
    );
    assert.equal(
      turns.filter((turn) => turn.role === 'assistant').length >= 2,
      true,
    );
  } finally {
    await server.stop();
  }
});
