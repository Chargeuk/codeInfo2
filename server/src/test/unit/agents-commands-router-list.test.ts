import assert from 'node:assert/strict';
import { test } from 'node:test';

import express from 'express';
import request from 'supertest';
import { createAgentsCommandsRouter } from '../../routes/agentsCommands.js';

type AgentCommandSummary = {
  name: string;
  description: string;
  disabled: boolean;
};

function buildApp(params: {
  listAgentCommands: (args: {
    agentName: string;
  }) => Promise<{ commands: AgentCommandSummary[] }>;
  runAgentCommand?: (args: unknown) => Promise<unknown>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/agents',
    createAgentsCommandsRouter({
      ...params,
      runAgentCommand:
        params.runAgentCommand ??
        (async () => {
          throw new Error('not implemented');
        }),
    } as unknown as Parameters<typeof createAgentsCommandsRouter>[0]),
  );
  return app;
}

test('GET /agents/:agentName/commands returns payload with commands array', async () => {
  const app = buildApp({
    listAgentCommands: async ({ agentName }) => {
      assert.equal(agentName, 'coding_agent');
      return {
        commands: [
          { name: 'hello', description: 'Says hello', disabled: false },
        ],
      };
    },
  });

  const res = await request(app).get('/agents/coding_agent/commands');

  assert.equal(res.status, 200);
  assert.equal(Array.isArray(res.body.commands), true);
  assert.equal(res.body.commands.length, 1);
  assert.equal(res.body.commands[0].name, 'hello');
});

test('GET /agents/:agentName/commands includes disabled entries', async () => {
  const app = buildApp({
    listAgentCommands: async () => ({
      commands: [
        {
          name: 'bad',
          description: 'Invalid command file',
          disabled: true,
        },
      ],
    }),
  });

  const res = await request(app).get('/agents/coding_agent/commands');

  assert.equal(res.status, 200);
  assert.equal(res.body.commands.length, 1);
  assert.equal(res.body.commands[0].name, 'bad');
  assert.equal(res.body.commands[0].disabled, true);
});

test("GET /agents/:agentName/commands returns 404 when agent doesn't exist", async () => {
  const app = buildApp({
    listAgentCommands: async () => {
      throw { code: 'AGENT_NOT_FOUND' };
    },
  });

  const res = await request(app).get('/agents/does-not-exist/commands');

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'not_found' });
});

test('GET /agents/:agentName/commands returns empty array when agent has no commands', async () => {
  const app = buildApp({
    listAgentCommands: async () => ({ commands: [] }),
  });

  const res = await request(app).get('/agents/coding_agent/commands');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { commands: [] });
});
