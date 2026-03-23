import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { startCopilotChatServer } from './support/copilotChatHarness.js';

test('copilot chat keeps the existing conversation lock for concurrent turns', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-lock',
      sendDelayMs: 200,
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

    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = await request(server.httpServer).post('/chat').send({
      provider: 'copilot',
      model: 'copilot-gpt-5',
      conversationId,
      message: 'Second turn',
    });

    const firstResponse = await first;
    assert.equal(firstResponse.status, 202);
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'RUN_IN_PROGRESS');
  } finally {
    await server.stop();
  }
});
