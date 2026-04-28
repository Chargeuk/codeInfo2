import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { memoryConversations } from '../../chat/memoryPersistence.js';
import { startCopilotChatServer } from './support/copilotChatHarness.js';

test('copilot chat rejects stale Codex-only top-level flags after Task 3 validation tightening', async () => {
  const server = await startCopilotChatServer({
    scenario: { name: 'copilot-chat-flags' },
  });

  try {
    const conversationId = 'copilot-flags-conversation';
    const response = await request(server.httpServer).post('/chat').send({
      provider: 'copilot',
      model: 'copilot-gpt-5',
      conversationId,
      message: 'Ignore Codex flags',
      threadId: 'codex-thread-id',
      sandboxMode: 'read-only',
      approvalPolicy: 'on-request',
      modelReasoningEffort: 'medium',
      networkAccessEnabled: false,
      webSearchEnabled: true,
    });

    assert.equal(response.status, 400);
    assert.match(
      String(response.body?.message ?? ''),
      /legacy top-level chat flag "sandboxMode".*agentFlags\.sandboxMode/i,
    );
    assert.equal(memoryConversations.get(conversationId), undefined);
  } finally {
    await server.stop();
  }
});
