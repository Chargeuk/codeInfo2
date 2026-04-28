import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { memoryConversations } from '../../chat/memoryPersistence.js';
import { startCopilotChatServer } from './support/copilotChatHarness.js';

test('copilot chat returns explicit-provider failure when the user selected an unavailable provider directly', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-explicit-provider-failure',
      startError: new Error('copilot unavailable'),
    },
    lmstudioAvailable: true,
  });

  try {
    const conversationId = 'copilot-explicit-provider-failure';
    const response = await request(server.httpServer).post('/chat').send({
      provider: 'copilot',
      model: 'copilot-gpt-5',
      conversationId,
      message: 'Do not silently switch providers',
    });

    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
    assert.match(
      String(response.body.message),
      /copilot connectivity unavailable/i,
    );
    assert.equal(memoryConversations.get(conversationId), undefined);
  } finally {
    await server.stop();
  }
});

test('copilot chat still falls back automatically when default provider resolution prefers copilot and runtime selection must recover', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-default-provider-fallback',
      startError: new Error('copilot unavailable'),
    },
    lmstudioAvailable: true,
  });

  const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
  process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = 'copilot';

  try {
    const conversationId = 'copilot-default-provider-fallback';
    const response = await request(server.httpServer).post('/chat').send({
      conversationId,
      message: 'Fallback please',
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.provider, 'lmstudio');
    assert.equal(memoryConversations.get(conversationId)?.provider, 'lmstudio');
  } finally {
    if (originalDefaultProvider === undefined) {
      delete process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    } else {
      process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = originalDefaultProvider;
    }
    await server.stop();
  }
});
