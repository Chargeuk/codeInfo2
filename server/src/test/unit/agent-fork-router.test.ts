import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { ForkError } from '../../agents/forkHistory.js';
import { createAgentsRouter } from '../../routes/agents.js';

const app = (
  fork: NonNullable<
    Parameters<typeof createAgentsRouter>[0]
  >['forkAgentConversation'],
) => {
  const instance = express();
  instance.use(express.json());
  instance.use(
    createAgentsRouter({
      listAgents: async () => ({ agents: [] }),
      getAgentDetails: async (name) => ({
        name,
        disabled: false,
        warnings: [],
        fallbackCandidates: [],
      }),
      forkAgentConversation: fork,
      getForkOptions: async () => ({
        sourceTitle: 'Source',
        sourceAgentName: 'same',
        agents: [{ name: 'same', sameAgent: true }],
        estimated: true,
        sourceTurnId: 'stored-response',
      }),
    }),
  );
  return instance;
};

test('fork route sends a stable DB boundary and request identity to the service', async () => {
  let input: unknown;
  const response = await request(
    app(async (value) => {
      input = value;
      return {
        conversationId: 'child',
        agentName: 'target',
        model: 'target-model',
        estimated: false,
      };
    }),
  )
    .post('/agents/conversations/source/fork')
    .send({
      requestId: 'request-123',
      sourceTurnId: 'stored-response',
      targetAgentName: 'target',
    });
  assert.equal(response.status, 200);
  assert.deepEqual(input, {
    requestId: 'request-123',
    sourceTurnId: 'stored-response',
    targetAgentName: 'target',
    sourceConversationId: 'source',
  });
  assert.equal(response.body.conversationId, 'child');
});

test('fork route preserves clear unsupported errors and rejects unstable creation identity', async () => {
  const instance = app(async () => {
    throw new ForkError('FORK_UNSUPPORTED', 'Same provider required');
  });
  const unsupported = await request(instance)
    .post('/agents/conversations/source/fork')
    .send({ requestId: 'request-123', targetAgentName: 'target' });
  assert.equal(unsupported.status, 409);
  assert.equal(unsupported.body.code, 'FORK_UNSUPPORTED');
  const invalid = await request(instance)
    .post('/agents/conversations/source/fork')
    .send({ targetAgentName: 'target' });
  assert.equal(invalid.status, 400);
});

test('fork route preserves known plain target provider errors', async () => {
  for (const failure of [
    { code: 'PROVIDER_UNAVAILABLE', reason: 'Target provider is offline' },
    { code: 'INVALID_PROVIDER', reason: 'Target provider is disabled' },
  ]) {
    const response = await request(
      app(async () => {
        throw failure;
      }),
    )
      .post('/agents/conversations/source/fork')
      .send({ requestId: 'request-123', targetAgentName: 'target' });
    assert.equal(
      response.status,
      failure.code === 'INVALID_PROVIDER' ? 409 : 503,
    );
    assert.equal(response.body.code, failure.code);
    assert.equal(response.body.message, failure.reason);
  }
});

test('fork route preserves known plain working-folder preparation errors', async () => {
  for (const failure of [
    {
      code: 'WORKING_FOLDER_INVALID',
      reason: 'folder path is invalid',
      status: 400,
    },
    {
      code: 'WORKING_FOLDER_NOT_FOUND',
      reason: 'folder was not found',
      status: 400,
    },
    {
      code: 'WORKING_FOLDER_UNAVAILABLE',
      reason: 'folder could not be checked',
      status: 503,
    },
  ]) {
    const response = await request(
      app(async () => {
        throw { code: failure.code, reason: failure.reason };
      }),
    )
      .post('/agents/conversations/source/fork')
      .send({ requestId: 'request-123', targetAgentName: 'target' });
    assert.equal(response.status, failure.status);
    assert.equal(response.body.code, failure.code);
    assert.equal(response.body.message, failure.reason);
  }
});

test('fork route keeps malformed and unknown plain errors generic', async () => {
  for (const failure of [
    { code: 'PROVIDER_UNAVAILABLE', reason: { detail: 'private' } },
    { code: 'UNRECOGNIZED', reason: 'private detail' },
  ]) {
    const response = await request(
      app(async () => {
        throw failure;
      }),
    )
      .post('/agents/conversations/source/fork')
      .send({ requestId: 'request-123', targetAgentName: 'target' });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'FORK_UNAVAILABLE');
    assert.equal(response.body.message, 'Conversation fork is unavailable.');
  }
});

test('fork options expose compatible agents and estimated-history notice', async () => {
  const response = await request(
    app(async () => ({
      conversationId: 'child',
      agentName: 'same',
      model: 'model',
      estimated: true,
    })),
  ).get(
    '/agents/conversations/source/fork-options?sourceTurnId=stored-response',
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.agents, [{ name: 'same', sameAgent: true }]);
  assert.equal(response.body.estimated, true);
});
