import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { getMemoryTurns } from '../../chat/memoryPersistence.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';
import { startCopilotChatServer } from './support/copilotChatHarness.js';

type WsTurnFinalEvent = {
  type: 'turn_final';
  conversationId: string;
  inflightId: string;
  status: 'ok' | 'stopped' | 'failed';
};

test('copilot chat shares the stop path and settles the inflight run cleanly', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-stop',
      sendDelayMs: 250,
    },
    withWs: true,
  });
  const ws = await connectWs({ baseUrl: server.baseUrl });

  try {
    const conversationId = 'copilot-stop-conversation';
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const response = await request(server.httpServer).post('/chat').send({
      provider: 'copilot',
      model: 'copilot-gpt-5',
      conversationId,
      message: 'Start and stop',
    });

    assert.equal(response.status, 202);
    const inflightId = response.body.inflightId as string;
    sendJson(ws, { type: 'cancel_inflight', conversationId, inflightId });

    const finalEvent = await waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTurnFinalEvent => {
        const candidate = event as Partial<WsTurnFinalEvent>;
        return (
          candidate.type === 'turn_final' &&
          candidate.conversationId === conversationId &&
          candidate.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });

    assert.equal(finalEvent.status, 'stopped');
    const assistantTurn = getMemoryTurns(conversationId)
      .filter((turn) => turn.role === 'assistant')
      .at(-1);
    assert.equal(assistantTurn?.status, 'stopped');
  } finally {
    await closeWs(ws);
    await server.stop();
  }
});
