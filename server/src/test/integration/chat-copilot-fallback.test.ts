import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { memoryConversations } from '../../chat/memoryPersistence.js';
import { startCopilotChatServer } from './support/copilotChatHarness.js';

test('copilot chat falls back through the shared runtime selection when Copilot is unavailable', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-fallback',
      startError: new Error('copilot unavailable'),
    },
    lmstudioAvailable: true,
  });

  try {
    const conversationId = 'copilot-fallback-conversation';
    const response = await request(server.httpServer).post('/chat').send({
      provider: 'copilot',
      model: 'copilot-gpt-5',
      conversationId,
      message: 'Fallback please',
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.provider, 'lmstudio');
    assert.equal(memoryConversations.get(conversationId)?.provider, 'lmstudio');
  } finally {
    await server.stop();
  }
});
