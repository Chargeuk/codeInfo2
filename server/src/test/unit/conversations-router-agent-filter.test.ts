import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';
import request from 'supertest';
import { createConversationsRouter } from '../../routes/conversations.js';

function buildApp(deps: Parameters<typeof createConversationsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter(deps));
  return app;
}

test('GET /conversations forwards agentName=__none__ to repo layer', async () => {
  let captured: unknown;
  const listConversations = async (params: unknown) => {
    captured = params;
    return { items: [] };
  };

  const res = await request(
    buildApp({ listConversations: listConversations as never }),
  )
    .get('/conversations?agentName=__none__')
    .expect(200);

  assert.equal(Array.isArray(res.body.items), true);
  assert(captured);
  const params = captured as Record<string, unknown>;
  assert.equal(params.agentName, '__none__');
});

test('GET /conversations forwards agentName=<agent> to repo layer', async () => {
  let captured: unknown;
  const listConversations = async (params: unknown) => {
    captured = params;
    return { items: [] };
  };

  const res = await request(
    buildApp({ listConversations: listConversations as never }),
  )
    .get('/conversations?agentName=coding_agent')
    .expect(200);

  assert.equal(Array.isArray(res.body.items), true);
  assert(captured);
  const params = captured as Record<string, unknown>;
  assert.equal(params.agentName, 'coding_agent');
});
