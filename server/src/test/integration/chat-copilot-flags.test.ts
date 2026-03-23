import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { memoryConversations } from '../../chat/memoryPersistence.js';
import { query } from '../../logStore.js';
import {
  startCopilotChatServer,
  waitForAssistantTurn,
} from './support/copilotChatHarness.js';

test('copilot chat ignores Codex-only flags and logs the documented warnings', async () => {
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

    assert.equal(response.status, 202);
    await waitForAssistantTurn(conversationId);

    assert.equal(
      memoryConversations.get(conversationId)?.flags?.threadId,
      undefined,
    );

    const warnings = query({ text: 'chat codex flag ignored' });
    assert.equal(warnings.length >= 5, true);
    assert.equal(
      warnings.some((entry) =>
        String(entry.context?.warning ?? '').includes('sandboxMode'),
      ),
      true,
    );
    assert.equal(
      warnings.some((entry) =>
        String(entry.context?.warning ?? '').includes('approvalPolicy'),
      ),
      true,
    );
  } finally {
    await server.stop();
  }
});
