import assert from 'node:assert/strict';
import { test } from 'node:test';

import express from 'express';
import request from 'supertest';

import { createAgentsRunRouter } from '../../routes/agentsRun.js';

function buildApp(deps?: {
  runAgentInstruction?: (params: unknown) => Promise<unknown>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    createAgentsRunRouter({
      runAgentInstruction:
        deps?.runAgentInstruction ??
        (async () => {
          throw new Error('not implemented');
        }),
    } as unknown as Parameters<typeof createAgentsRunRouter>[0]),
  );
  return app;
}

test('POST /agents/:agentName/run validates request body (missing instruction -> 400)', async () => {
  const res = await request(buildApp())
    .post('/agents/coding_agent/run')
    .send({});

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
});

test('POST /agents/:agentName/run maps unknown agent to 404', async () => {
  const res = await request(
    buildApp({
      runAgentInstruction: async () => {
        throw { code: 'AGENT_NOT_FOUND' };
      },
    }),
  )
    .post('/agents/coding_agent/run')
    .send({ instruction: 'hello' });

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'not_found' });
});

test('POST /agents/:agentName/run returns a stable success payload shape', async () => {
  const res = await request(
    buildApp({
      runAgentInstruction: async (params: unknown) => {
        void params;
        return {
          agentName: 'coding_agent',
          conversationId: 'conv-1',
          modelId: 'gpt-5.1-codex-max',
          segments: [{ type: 'answer', text: 'ok' }],
        };
      },
    }),
  )
    .post('/agents/coding_agent/run')
    .send({ instruction: 'hello' });

  assert.equal(res.status, 200);
  assert.equal(res.body.agentName, 'coding_agent');
  assert.equal(res.body.conversationId, 'conv-1');
  assert.equal(res.body.modelId, 'gpt-5.1-codex-max');
  assert.equal(Array.isArray(res.body.segments), true);
});
