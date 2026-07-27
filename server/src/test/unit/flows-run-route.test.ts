import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';
import supertest from 'supertest';

import {
  getActiveRunOwnership,
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../../agents/runLock.js';
import {
  cleanupInflight,
  cleanupPendingConversationCancel,
  createInflight,
  getPendingConversationCancel,
} from '../../chat/inflightRegistry.js';
import { memoryConversations } from '../../chat/memoryPersistence.js';
import { stopFlowRun } from '../../flows/service.js';
import type { Conversation } from '../../mongo/conversation.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';

const buildConversation = (
  conversationId: string,
  identity: { flowName?: string; agentName?: string } = {},
): Conversation => {
  const now = new Date();
  return {
    _id: conversationId,
    provider: 'lmstudio',
    model: 'test-model',
    title: conversationId,
    ...identity,
    source: 'REST',
    flags: {},
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    archivedAt: null,
  };
};

const cleanupActiveConversation = (conversationId: string): void => {
  cleanupInflight({ conversationId });
  cleanupPendingConversationCancel({ conversationId });
  releaseConversationLock(conversationId);
  memoryConversations.delete(conversationId);
};

test('flow run status endpoint exposes terminal ownership state', async () => {
  const app = express();
  app.use(
    createFlowsRunRouter({
      getFlowRunStatus: async (conversationId) => ({
        conversationId,
        status: 'running',
        terminal: false,
        terminalOutcome: 'not_applicable',
        executionId: 'execution-1',
        activeSince: '2026-07-16T12:00:00.000Z',
        latestAssistantAt: null,
        subflowWaveProgress: null,
        resumeStepPath: null,
      }),
    }),
  );

  const response = await supertest(app)
    .get('/flows/runs/conversation-1')
    .expect(200);
  assert.equal(response.body.status, 'running');
  assert.equal(response.body.terminal, false);
  assert.equal(response.body.terminalOutcome, 'not_applicable');
});

test('flow run stop endpoint reports accepted and inactive runs distinctly', async () => {
  const stopped = [] as string[];
  const app = express();
  app.use(
    createFlowsRunRouter({
      stopFlowRun: async (conversationId) => {
        stopped.push(conversationId);
        return conversationId === 'active';
      },
    }),
  );

  await supertest(app).post('/flows/runs/active/stop').expect(202);
  const inactive = await supertest(app)
    .post('/flows/runs/inactive/stop')
    .expect(409);
  assert.equal(inactive.body.code, 'FLOW_NOT_RUNNING');
  assert.deepEqual(stopped, ['active', 'inactive']);
});

test('flow stop rejects active chat and agent conversations without changing their runs', async () => {
  const cases = [
    { label: 'chat', identity: {} },
    { label: 'agent', identity: { agentName: 'coding_agent' } },
  ];

  for (const { label, identity } of cases) {
    const conversationId = `active-${label}`;
    memoryConversations.set(
      conversationId,
      buildConversation(conversationId, identity),
    );
    assert.equal(tryAcquireConversationLock(conversationId), true);
    const inflight = createInflight({
      conversationId,
      inflightId: `inflight-${label}`,
    });

    try {
      assert.equal(await stopFlowRun(conversationId), false);
      assert.notEqual(getActiveRunOwnership(conversationId), null);
      assert.equal(getPendingConversationCancel(conversationId), null);
      assert.equal(inflight.abortController.signal.aborted, false);
    } finally {
      cleanupActiveConversation(conversationId);
    }
  }
});

test('flow stop still cancels an active flow conversation', async () => {
  const conversationId = 'active-flow';
  memoryConversations.set(
    conversationId,
    buildConversation(conversationId, { flowName: 'test-flow' }),
  );
  assert.equal(tryAcquireConversationLock(conversationId), true);
  const ownership = getActiveRunOwnership(conversationId);
  assert.notEqual(ownership, null);
  const inflight = createInflight({
    conversationId,
    inflightId: 'inflight-flow',
  });

  try {
    assert.equal(await stopFlowRun(conversationId), true);
    assert.equal(
      getPendingConversationCancel(conversationId)?.runToken,
      ownership?.runToken,
    );
    assert.equal(inflight.abortController.signal.aborted, true);
  } finally {
    cleanupActiveConversation(conversationId);
  }
});

test('flow stop rejects missing and inactive flow conversations', async () => {
  const missingConversationId = 'missing-flow';
  assert.equal(tryAcquireConversationLock(missingConversationId), true);
  try {
    assert.equal(await stopFlowRun(missingConversationId), false);
    assert.notEqual(getActiveRunOwnership(missingConversationId), null);
    assert.equal(getPendingConversationCancel(missingConversationId), null);
  } finally {
    cleanupActiveConversation(missingConversationId);
  }

  const inactiveConversationId = 'inactive-flow';
  memoryConversations.set(
    inactiveConversationId,
    buildConversation(inactiveConversationId, { flowName: 'test-flow' }),
  );
  try {
    assert.equal(await stopFlowRun(inactiveConversationId), false);
    assert.equal(getPendingConversationCancel(inactiveConversationId), null);
  } finally {
    cleanupActiveConversation(inactiveConversationId);
  }
});
