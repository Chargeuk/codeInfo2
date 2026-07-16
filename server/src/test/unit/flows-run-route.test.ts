import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';
import supertest from 'supertest';

import { createFlowsRunRouter } from '../../routes/flowsRun.js';

test('flow run status endpoint exposes terminal ownership state', async () => {
  const app = express();
  app.use(
    createFlowsRunRouter({
      getFlowRunStatus: async (conversationId) => ({
        conversationId,
        status: 'running',
        terminal: false,
        executionId: 'execution-1',
        activeSince: '2026-07-16T12:00:00.000Z',
        latestAssistantAt: null,
        subflowWaveProgress: null,
      }),
    }),
  );

  const response = await supertest(app)
    .get('/flows/runs/conversation-1')
    .expect(200);
  assert.equal(response.body.status, 'running');
  assert.equal(response.body.terminal, false);
});

test('flow run stop endpoint reports accepted and inactive runs distinctly', async () => {
  const stopped = [] as string[];
  const app = express();
  app.use(
    createFlowsRunRouter({
      stopFlowRun: (conversationId) => {
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
