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
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { query, resetStore } from '../../logStore.js';
import { createConversationsRouter } from '../../routes/conversations.js';
import { setWorkingFolderStatForTests } from '../../workingFolders/state.js';

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

const buildRepoEntry = (containerPath: string): RepoEntry => ({
  id: 'repo-' + containerPath,
  description: null,
  containerPath,
  hostPath: containerPath,
  lastIngestAt: null,
  embeddingProvider: 'lmstudio',
  embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
  embeddingDimensions: 768,
  modelId: 'text-embedding-nomic-embed-text-v1.5',
  counts: { files: 0, chunks: 0, embedded: 0 },
  lastError: null,
});

test.afterEach(() => {
  setWorkingFolderStatForTests(undefined);
  resetStore();
});

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
      useMemoryList ? (memoryList as never) : (mongoList as never),
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
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(process.cwd())],
        lockedModelId: null,
      }),
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

test('GET /conversations surfaces operational working-folder diagnostics without object stringification', async () => {
  const workingFolder = '/tmp/temporarily-unreadable-working-folder';
  setWorkingFolderStatForTests(async (targetPath) => {
    if (targetPath === workingFolder) {
      const error = new Error('permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    }
    return {
      isDirectory: () => true,
    } as never;
  });

  const res = await request(
    buildApp({
      listConversations: async () => ({
        items: [
          {
            conversationId: 'conv-working-folder',
            provider: 'codex',
            model: 'gpt-5.1-codex-max',
            title: 'Conversation',
            source: 'REST',
            lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
            updatedAt: new Date('2025-01-01T00:00:00.000Z'),
            archived: false,
            flags: { workingFolder },
          },
        ],
      }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(workingFolder)],
        lockedModelId: null,
      }),
    }),
  )
    .get('/conversations')
    .expect(503);

  assert.deepEqual(res.body, {
    error: 'working_folder_unavailable',
    code: 'WORKING_FOLDER_UNAVAILABLE',
    message: 'working_folder is temporarily unavailable',
  });

  const marker = query({
    text: 'DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION',
    level: ['warn'],
  }).find(
    (entry) =>
      entry.context?.conversationId === 'conv-working-folder' &&
      entry.context?.decisionReason === 'saved_value_unavailable',
  );
  assert.ok(marker);
  assert.equal(marker?.context?.errorCode, 'WORKING_FOLDER_UNAVAILABLE');
  assert.equal(
    marker?.context?.errorReason,
    'working_folder could not be validated (EACCES)',
  );
  assert.equal(marker?.context?.causeCode, 'EACCES');
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

test('POST /conversations/:id/working-folder rejects omitted workingFolder payloads', async () => {
  let updateCalled = false;

  const res = await request(
    buildApp({
      findConversationById: async () => baseConversation,
      updateConversationWorkingFolder: async () => {
        updateCalled = true;
        return baseConversation;
      },
    }),
  )
    .post('/conversations/conv-working-folder/working-folder')
    .send({})
    .expect(400);

  assert.equal(updateCalled, false);
  assert.equal(res.body.error, 'validation_error');
  assert.match(
    String(res.body.details?.body?.workingFolder?._errors?.[0] ?? ''),
    /Required|expected string/i,
  );
});

test('POST /conversations/:id/working-folder rejects blank workingFolder payloads', async () => {
  let updateCalled = false;

  const res = await request(
    buildApp({
      findConversationById: async () => baseConversation,
      updateConversationWorkingFolder: async () => {
        updateCalled = true;
        return baseConversation;
      },
    }),
  )
    .post('/conversations/conv-working-folder/working-folder')
    .send({ workingFolder: '' })
    .expect(400);

  assert.equal(updateCalled, false);
  assert.equal(res.body.error, 'validation_error');
  assert.match(
    String(res.body.details?.body?.workingFolder?._errors?.[0] ?? ''),
    /at least 1 character|>=1 characters/i,
  );
});

test('POST /conversations/:id/working-folder rejects whitespace-only workingFolder payloads', async () => {
  let updateCalled = false;

  const res = await request(
    buildApp({
      findConversationById: async () => baseConversation,
      updateConversationWorkingFolder: async () => {
        updateCalled = true;
        return baseConversation;
      },
    }),
  )
    .post('/conversations/conv-working-folder/working-folder')
    .send({ workingFolder: '   ' })
    .expect(400);

  assert.equal(updateCalled, false);
  assert.equal(res.body.error, 'validation_error');
  assert.match(
    String(res.body.details?.body?.workingFolder?._errors?.[0] ?? ''),
    /at least 1 character|>=1 characters/i,
  );
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
