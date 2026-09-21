import assert from 'node:assert/strict';
import nodeTest from 'node:test';

import request from 'supertest';

import { getInflight } from '../../chat/inflightRegistry.js';
import { getMemoryTurns } from '../../chat/memoryPersistence.js';
import {
  beginScopedTestEnvIsolation,
  endScopedTestEnvIsolation,
} from '../support/processEnvIsolation.js';
import { waitForTestCondition } from '../support/testTimeouts.js';
import {
  subscribeConversationAndWaitReady,
  closeWs,
  connectWs,
  waitForEvent,
} from '../support/wsClient.js';
import { startCopilotChatServer } from './support/copilotChatHarness.js';

type WsTurnFinalEvent = {
  type: 'turn_final';
  conversationId: string;
  inflightId: string;
  status: 'ok' | 'stopped' | 'failed';
};

const test = (name: string, fn: () => Promise<void> | void) =>
  nodeTest(name, async () => {
    beginScopedTestEnvIsolation();
    try {
      await fn();
    } finally {
      endScopedTestEnvIsolation();
    }
  });

test('copilot chat shares the stop path and settles the inflight run cleanly', async () => {
  let releaseSendGate!: () => void;
  const sendGate = new Promise<void>((resolve) => {
    releaseSendGate = resolve;
  });
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-stop',
      sendGate,
    },
    withWs: true,
  });
  const ws = await connectWs({ baseUrl: server.baseUrl });
  const stopCountBeforeRun = server.harness.getState().stopCount;

  try {
    const conversationId = 'copilot-stop-conversation';
    await subscribeConversationAndWaitReady({ ws: ws, conversationId });

    const response = await request(server.httpServer).post('/chat').send({
      provider: 'copilot',
      model: 'copilot-gpt-5',
      conversationId,
      message: 'Start and stop',
    });

    assert.equal(response.status, 202);
    const inflightId = response.body.inflightId as string;
    await waitForTestCondition(
      () => server.harness.getState().lastSendAndWaitPrompt !== undefined,
      { description: 'Copilot sendAndWait to enter the test gate' },
    );
    const inflightSignal = getInflight(conversationId)?.abortController.signal;
    assert.ok(inflightSignal);
    const abortObserved = new Promise<void>((resolve) => {
      if (inflightSignal.aborted) {
        resolve();
        return;
      }
      inflightSignal.addEventListener('abort', () => resolve(), { once: true });
    });
    ws.send(
      JSON.stringify({
        protocolVersion: 'v1',
        type: 'cancel_inflight',
        conversationId,
        inflightId,
        requestId: 'copilot-stop-request',
      }),
    );
    await abortObserved;
    releaseSendGate();

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
    assert.ok(server.harness.getState().stopCount >= stopCountBeforeRun + 1);
  } finally {
    releaseSendGate();
    await closeWs(ws);
    await server.stop();
  }
});

test('copilot chat failure still tears the runtime down before leaving the run failed', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-failure-cleanup',
      sendError: new Error('copilot send failed'),
    },
    withWs: true,
  });
  const ws = await connectWs({ baseUrl: server.baseUrl });
  const stopCountBeforeRun = server.harness.getState().stopCount;

  try {
    const conversationId = 'copilot-failure-conversation';
    await subscribeConversationAndWaitReady({ ws: ws, conversationId });

    const response = await request(server.httpServer).post('/chat').send({
      provider: 'copilot',
      model: 'copilot-gpt-5',
      conversationId,
      message: 'Start and fail',
    });

    assert.equal(response.status, 202);
    const inflightId = response.body.inflightId as string;

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

    assert.equal(finalEvent.status, 'failed');
    assert.ok(server.harness.getState().stopCount >= stopCountBeforeRun + 1);
  } finally {
    await closeWs(ws);
    await server.stop();
  }
});
