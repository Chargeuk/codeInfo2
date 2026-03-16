import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';
import request from 'supertest';
import {
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../../agents/runLock.js';
import {
  cleanupInflight,
  createInflight,
} from '../../chat/inflightRegistry.js';
import { createConversationsRouter } from '../../routes/conversations.js';

function buildApp(deps: Parameters<typeof createConversationsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter(deps));
  return app;
}

const baseConversation = {
  _id: 'conv-working-folder',
  provider: 'codex' as const,
  model: 'gpt-5.1-codex-max',
  title: 'Conversation',
  source: 'REST' as const,
  lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  archivedAt: null,
  flags: {},
};

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

test('GET /conversations forwards flowName=__none__ to repo layer', async () => {
  let captured: unknown;
  const listConversations = async (params: unknown) => {
    captured = params;
    return { items: [] };
  };

  const res = await request(
    buildApp({ listConversations: listConversations as never }),
  )
    .get('/conversations?flowName=__none__')
    .expect(200);

  assert.equal(Array.isArray(res.body.items), true);
  assert(captured);
  const params = captured as Record<string, unknown>;
  assert.equal(params.flowName, '__none__');
});

test('GET /conversations forwards flowName=<name> to repo layer', async () => {
  let captured: unknown;
  const listConversations = async (params: unknown) => {
    captured = params;
    return { items: [] };
  };

  const res = await request(
    buildApp({ listConversations: listConversations as never }),
  )
    .get('/conversations?flowName=demo-flow')
    .expect(200);

  assert.equal(Array.isArray(res.body.items), true);
  assert(captured);
  const params = captured as Record<string, unknown>;
  assert.equal(params.flowName, 'demo-flow');
});

test('GET /conversations resolves the list backing store at request time', async () => {
  const calls: string[] = [];
  let useMemoryList = true;

  const memoryList = async () => {
    calls.push('memory');
    return { items: [] };
  };
  const mongoList = async () => {
    calls.push('mongo');
    return { items: [] };
  };

  const app = buildApp({
    resolveListConversations: () =>
      useMemoryList
        ? (memoryList as never)
        : (mongoList as never),
  });

  await request(app).get('/conversations').expect(200);
  useMemoryList = false;
  await request(app).get('/conversations').expect(200);

  assert.deepEqual(calls, ['memory', 'mongo']);
});

test('POST /conversations/:id/working-folder saves flags.workingFolder while idle', async () => {
  let captured: unknown;
  const res = await request(
    buildApp({
      findConversationById: async () => baseConversation,
      updateConversationWorkingFolder: async (params: unknown) => {
        captured = params;
        return {
          ...baseConversation,
          flags: { workingFolder: process.cwd() },
        };
      },
    }),
  )
    .post('/conversations/conv-working-folder/working-folder')
    .send({ workingFolder: process.cwd() })
    .expect(200);

  assert.deepEqual(captured, {
    conversationId: 'conv-working-folder',
    workingFolder: process.cwd(),
  });
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.conversation.flags.workingFolder, process.cwd());
});

test('POST /conversations/:id/working-folder clears flags.workingFolder while idle', async () => {
  let captured: unknown;
  const res = await request(
    buildApp({
      findConversationById: async () => ({
        ...baseConversation,
        flags: { workingFolder: process.cwd() },
      }),
      updateConversationWorkingFolder: async (params: unknown) => {
        captured = params;
        return {
          ...baseConversation,
          flags: {},
        };
      },
    }),
  )
    .post('/conversations/conv-working-folder/working-folder')
    .send({ workingFolder: null })
    .expect(200);

  assert.deepEqual(captured, {
    conversationId: 'conv-working-folder',
    workingFolder: null,
  });
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.conversation.flags.workingFolder, undefined);
});

test('POST /conversations/:id/working-folder rejects invalid absolute-path workingFolder', async () => {
  const res = await request(
    buildApp({
      findConversationById: async () => baseConversation,
    }),
  )
    .post('/conversations/conv-working-folder/working-folder')
    .send({ workingFolder: 'relative/path' })
    .expect(400);

  assert.equal(res.body.error, 'invalid_request');
  assert.equal(res.body.code, 'WORKING_FOLDER_INVALID');
});

test('POST /conversations/:id/working-folder rejects missing-on-disk workingFolder', async () => {
  const res = await request(
    buildApp({
      findConversationById: async () => baseConversation,
    }),
  )
    .post('/conversations/conv-working-folder/working-folder')
    .send({ workingFolder: '/definitely/missing/path' })
    .expect(400);

  assert.equal(res.body.error, 'invalid_request');
  assert.equal(res.body.code, 'WORKING_FOLDER_NOT_FOUND');
});

test('POST /conversations/:id/working-folder rejects edits while a related run is active', async () => {
  assert.equal(tryAcquireConversationLock('conv-working-folder'), true);
  createInflight({
    conversationId: 'conv-working-folder',
    inflightId: 'inflight-working-folder',
  });

  try {
    const res = await request(
      buildApp({
        findConversationById: async () => baseConversation,
      }),
    )
      .post('/conversations/conv-working-folder/working-folder')
      .send({ workingFolder: process.cwd() })
      .expect(409);

    assert.equal(res.body.error, 'conflict');
    assert.equal(res.body.code, 'RUN_IN_PROGRESS');
  } finally {
    cleanupInflight({
      conversationId: 'conv-working-folder',
      inflightId: 'inflight-working-folder',
    });
    releaseConversationLock('conv-working-folder');
  }
});
