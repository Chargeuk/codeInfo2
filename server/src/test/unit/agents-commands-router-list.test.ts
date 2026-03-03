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

type AgentPromptSummary = {
  relativePath: string;
  fullPath: string;
};

function buildApp(params: {
  listAgentCommands?: (args: {
    agentName: string;
  }) => Promise<{ commands: AgentCommandSummary[] }>;
  listAgentPrompts?: (args: {
    agentName: string;
    working_folder: string;
  }) => Promise<{ prompts: AgentPromptSummary[] }>;
  queryOverride?: (req: express.Request) => unknown;
}) {
  const app = express();
  app.use(express.json());
  if (params.queryOverride) {
    app.use((req, _res, next) => {
      Object.defineProperty(req, 'query', {
        configurable: true,
        value: params.queryOverride?.(req),
      });
      next();
    });
  }
  app.use(
    '/agents',
    createAgentsCommandsRouter({
      listAgentCommands:
        params.listAgentCommands ??
        (async () => {
          return { commands: [] };
        }),
      listAgentPrompts:
        params.listAgentPrompts ??
        (async () => {
          return { prompts: [] };
        }),
      startAgentCommand: async () => {
        throw new Error('not implemented');
      },
    }),
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

test('GET /agents/:agentName/prompts returns payload with prompts array', async () => {
  const app = buildApp({
    listAgentPrompts: async ({ agentName, working_folder }) => {
      assert.equal(agentName, 'coding_agent');
      assert.equal(working_folder, '/tmp/repo');
      return {
        prompts: [
          {
            relativePath: 'onboarding/start.md',
            fullPath: '/data/repo/.github/prompts/onboarding/start.md',
          },
        ],
      };
    },
  });

  const res = await request(app).get(
    '/agents/coding_agent/prompts?working_folder=/tmp/repo',
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    prompts: [
      {
        relativePath: 'onboarding/start.md',
        fullPath: '/data/repo/.github/prompts/onboarding/start.md',
      },
    ],
  });
});

test('GET /agents/:agentName/prompts returns 400 invalid_request for invalid agentName path param', async () => {
  const app = buildApp({});

  const res = await request(app).get(
    '/agents/%20/prompts?working_folder=/tmp/repo',
  );

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'invalid_request' });
});

test('GET /agents/:agentName/prompts returns 400 invalid_request for missing and blank working_folder', async () => {
  const app = buildApp({});

  const missing = await request(app).get('/agents/coding_agent/prompts');
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.body, {
    error: 'invalid_request',
    message: 'working_folder is required',
  });

  const blank = await request(app).get(
    '/agents/coding_agent/prompts?working_folder=%20%20',
  );
  assert.equal(blank.status, 400);
  assert.deepEqual(blank.body, {
    error: 'invalid_request',
    message: 'working_folder is required',
  });
});

test('GET /agents/:agentName/prompts returns 400 invalid_request for non-string working_folder', async () => {
  const app = buildApp({
    queryOverride: () => ({ working_folder: 123 }),
  });

  const res = await request(app).get('/agents/coding_agent/prompts');

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: 'invalid_request',
    message: 'working_folder must be a string',
  });
});

test('GET /agents/:agentName/prompts returns 400 invalid_request for array/object working_folder query shapes', async () => {
  const appArray = buildApp({
    queryOverride: () => ({ working_folder: ['/tmp/repo'] }),
  });
  const arrayRes = await request(appArray).get('/agents/coding_agent/prompts');
  assert.equal(arrayRes.status, 400);
  assert.deepEqual(arrayRes.body, {
    error: 'invalid_request',
    message: 'working_folder must be a string',
  });

  const appObject = buildApp({
    queryOverride: () => ({ working_folder: { path: '/tmp/repo' } }),
  });
  const objectRes = await request(appObject).get(
    '/agents/coding_agent/prompts',
  );
  assert.equal(objectRes.status, 400);
  assert.deepEqual(objectRes.body, {
    error: 'invalid_request',
    message: 'working_folder must be a string',
  });
});

test("GET /agents/:agentName/prompts maps AGENT_NOT_FOUND to 404 { error: 'not_found' }", async () => {
  const app = buildApp({
    listAgentPrompts: async () => {
      throw { code: 'AGENT_NOT_FOUND' };
    },
  });

  const res = await request(app).get(
    '/agents/does-not-exist/prompts?working_folder=/tmp/repo',
  );

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'not_found' });
});

test('GET /agents/:agentName/prompts maps WORKING_FOLDER_INVALID to 400 invalid_request', async () => {
  const app = buildApp({
    listAgentPrompts: async () => {
      throw {
        code: 'WORKING_FOLDER_INVALID',
        reason: 'working_folder must be an absolute path',
      };
    },
  });

  const res = await request(app).get(
    '/agents/coding_agent/prompts?working_folder=repo',
  );

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: 'invalid_request',
    code: 'WORKING_FOLDER_INVALID',
    message: 'working_folder must be an absolute path',
  });
});

test('GET /agents/:agentName/prompts maps WORKING_FOLDER_NOT_FOUND to 400 invalid_request', async () => {
  const app = buildApp({
    listAgentPrompts: async () => {
      throw {
        code: 'WORKING_FOLDER_NOT_FOUND',
        reason: 'working_folder not found',
      };
    },
  });

  const res = await request(app).get(
    '/agents/coding_agent/prompts?working_folder=/tmp/repo',
  );

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: 'invalid_request',
    code: 'WORKING_FOLDER_NOT_FOUND',
    message: 'working_folder not found',
  });
});

test("GET /agents/:agentName/prompts returns 500 { error: 'agent_prompts_failed' } for unknown errors", async () => {
  const app = buildApp({
    listAgentPrompts: async () => {
      throw new Error('boom');
    },
  });

  const res = await request(app).get(
    '/agents/coding_agent/prompts?working_folder=/tmp/repo',
  );

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'agent_prompts_failed' });
});

test('GET /agents/:agentName/prompts returns success envelope with empty prompts array', async () => {
  const app = buildApp({
    listAgentPrompts: async () => ({ prompts: [] }),
  });

  const res = await request(app).get(
    '/agents/coding_agent/prompts?working_folder=/tmp/repo',
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { prompts: [] });
});
