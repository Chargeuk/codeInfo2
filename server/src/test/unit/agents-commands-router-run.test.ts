import assert from 'node:assert/strict';
import { test } from 'node:test';

import express from 'express';
import request from 'supertest';

import { createAgentsCommandsRouter } from '../../routes/agentsCommands.js';

function buildApp(deps?: {
  startAgentCommand?: (params: unknown) => Promise<unknown>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/agents',
    createAgentsCommandsRouter({
      listAgentCommands: async () => ({ commands: [] }),
      startAgentCommand:
        deps?.startAgentCommand ??
        (async () => {
          throw new Error('not implemented');
        }),
    } as unknown as Parameters<typeof createAgentsCommandsRouter>[0]),
  );
  return app;
}

test('POST /agents/:agentName/commands/run returns 202 + a stable started payload shape', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async (params: unknown) => {
        assert.equal(
          (params as { commandName?: string }).commandName,
          'improve_plan',
        );
        return {
          agentName: 'planning_agent',
          commandName: 'improve_plan',
          conversationId: 'conv-1',
          modelId: 'model-from-config',
        };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 202);
  assert.equal(res.body.status, 'started');
  assert.equal(res.body.agentName, 'planning_agent');
  assert.equal(res.body.commandName, 'improve_plan');
  assert.equal(res.body.conversationId, 'conv-1');
  assert.equal(typeof res.body.modelId, 'string');
  assert.equal(res.body.modelId.length > 0, true);
});

test('POST /agents/:agentName/commands/run maps RUN_IN_PROGRESS to 409 conflict + stable payload', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'RUN_IN_PROGRESS' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'conflict');
  assert.equal(res.body.code, 'RUN_IN_PROGRESS');
});

test('POST /agents/:agentName/commands/run maps invalid commandName to 400 + COMMAND_INVALID', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'COMMAND_INVALID' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: '../bad' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
  assert.equal(res.body.code, 'COMMAND_INVALID');
});

test("POST /agents/:agentName/commands/run maps COMMAND_NOT_FOUND to 404 { error: 'not_found' }", async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'COMMAND_NOT_FOUND' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'does_not_exist' });

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'not_found' });
});

test("POST /agents/:agentName/commands/run maps CONVERSATION_ARCHIVED to 410 { error: 'archived' }", async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'CONVERSATION_ARCHIVED' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 410);
  assert.deepEqual(res.body, { error: 'archived' });
});

test("POST /agents/:agentName/commands/run maps AGENT_MISMATCH to 400 { error: 'agent_mismatch' }", async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'AGENT_MISMATCH' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'agent_mismatch' });
});

test('POST /agents/:agentName/commands/run maps CODEX_UNAVAILABLE to 503', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'CODEX_UNAVAILABLE', reason: 'missing codex config' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, {
    error: 'codex_unavailable',
    reason: 'missing codex config',
  });
});

test('POST /agents/:agentName/commands/run maps COMMAND_INVALID to 400 + code', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'COMMAND_INVALID', reason: 'Invalid command file' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
  assert.equal(res.body.code, 'COMMAND_INVALID');
  assert.equal(typeof res.body.message, 'string');
});

test('POST /agents/:agentName/commands/run maps WORKING_FOLDER_INVALID to 400 + code', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'WORKING_FOLDER_INVALID' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan', working_folder: '/tmp' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
  assert.equal(res.body.code, 'WORKING_FOLDER_INVALID');
});

test('POST /agents/:agentName/commands/run maps WORKING_FOLDER_NOT_FOUND to 400 + code', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'WORKING_FOLDER_NOT_FOUND' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan', working_folder: '/tmp' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
  assert.equal(res.body.code, 'WORKING_FOLDER_NOT_FOUND');
});

test("POST /agents/:agentName/commands/run maps unknown agent to 404 { error: 'not_found' }", async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'AGENT_NOT_FOUND' };
      },
    }),
  )
    .post('/agents/does-not-exist/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'not_found' });
});
