import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { getMemoryTurns } from '../../chat/memoryPersistence.js';
import {
  startCopilotChatServer,
  waitForAssistantTurn,
} from './support/copilotChatHarness.js';

test('copilot resume failures stay explicit instead of silently creating a fresh session', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-resume-failure',
      resumeSessionError: new Error('resume failed'),
    },
  });

  try {
    const conversationId = 'copilot-resume-failure';
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

    const deadline = Date.now() + 4000;
    let failedTurn = '';
    while (Date.now() < deadline) {
      const assistantTurns = getMemoryTurns(conversationId).filter(
        (turn) => turn.role === 'assistant',
      );
      const match = assistantTurns.find((turn) =>
        turn.content.includes('Copilot session resume failed'),
      );
      if (match) {
        failedTurn = match.content;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.match(failedTurn, /Copilot session resume failed/u);
    assert.equal(
      server.harness.getState().lastCreateSessionConfig?.sessionId,
      conversationId,
    );
  } finally {
    await server.stop();
  }
});
