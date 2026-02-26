import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import { query, resetStore } from '../../logStore.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';

function buildApp(options?: {
  locked?: {
    embeddingProvider: 'lmstudio' | 'openai';
    embeddingModel: string;
    embeddingDimensions: number;
    lockedModelId: string;
    source: 'canonical' | 'legacy';
  } | null;
  collectionEmpty?: boolean;
  startIngest?: (input: {
    path: string;
    name: string;
    description?: string;
    model: string;
    embeddingProvider?: 'lmstudio' | 'openai';
    embeddingModel?: string;
    dryRun?: boolean;
    operation?: 'start' | 'reembed';
  }) => Promise<`${string}-${string}-${string}-${string}-${string}`>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    createIngestStartRouter({
      clientFactory: () => ({}) as never,
      collectionIsEmpty: async () => options?.collectionEmpty ?? true,
      getLockedEmbeddingModel: async () => options?.locked ?? null,
      startIngest: async (input) =>
        options?.startIngest
          ? options.startIngest(input)
          : ('00000000-0000-0000-0000-000000000001' as const),
    }),
  );
  return app;
}

beforeEach(() => {
  resetStore();
});

test('ingest-start canonical fields are authoritative when legacy model is also present', async () => {
  let capturedModel = '';
  let capturedProvider: 'lmstudio' | 'openai' | undefined;
  let capturedEmbeddingModel: string | undefined;
  const response = await request(
    buildApp({
      startIngest: async (input) => {
        capturedModel = input.model;
        capturedProvider = input.embeddingProvider;
        capturedEmbeddingModel = input.embeddingModel;
        return '00000000-0000-0000-0000-000000000123';
      },
    }),
  )
    .post('/ingest/start')
    .send({
      path: '/tmp/repo',
      name: 'repo',
      model: 'legacy-model',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      dryRun: true,
    });

  assert.equal(response.status, 202);
  assert.equal(response.body.runId, '00000000-0000-0000-0000-000000000123');
  assert.equal(capturedModel, 'openai/text-embedding-3-small');
  assert.equal(capturedProvider, 'openai');
  assert.equal(capturedEmbeddingModel, 'text-embedding-3-small');
});

test('ingest-start legacy model maps to lmstudio compatibility input', async () => {
  let capturedModel = '';
  let capturedProvider: 'lmstudio' | 'openai' | undefined;
  const response = await request(
    buildApp({
      startIngest: async (input) => {
        capturedModel = input.model;
        capturedProvider = input.embeddingProvider;
        return '00000000-0000-0000-0000-000000000124';
      },
    }),
  )
    .post('/ingest/start')
    .send({
      path: '/tmp/repo',
      name: 'repo',
      model: 'nomic-embed',
    });

  assert.equal(response.status, 202);
  assert.equal(response.body.runId, '00000000-0000-0000-0000-000000000124');
  assert.equal(capturedModel, 'nomic-embed');
  assert.equal(capturedProvider, 'lmstudio');
});

test('ingest-start rejects non-allowlisted OpenAI model ids deterministically', async () => {
  const response = await request(buildApp()).post('/ingest/start').send({
    path: '/tmp/repo',
    name: 'repo',
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-ada-002',
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'OPENAI_MODEL_UNAVAILABLE');
});

test('ingest-start conflict payload includes canonical lock and compatibility alias', async () => {
  const response = await request(
    buildApp({
      collectionEmpty: false,
      locked: {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 1536,
        lockedModelId: 'text-embedding-3-small',
        source: 'canonical',
      },
    }),
  )
    .post('/ingest/start')
    .send({
      path: '/tmp/repo',
      name: 'repo',
      model: 'nomic-embed',
    });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'MODEL_LOCKED');
  assert.equal(response.body.lockedModelId, 'text-embedding-3-small');
  assert.deepEqual(response.body.lock, {
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
  });
});

test('ingest-start sanitizes secret-like values in generic 500 messages', async () => {
  const response = await request(
    buildApp({
      startIngest: async () => {
        throw new Error('Authorization: Bearer sk-secret-token-value');
      },
    }),
  )
    .post('/ingest/start')
    .send({
      path: '/tmp/repo',
      name: 'repo',
      model: 'nomic-embed',
    });

  assert.equal(response.status, 500);
  assert.equal(typeof response.body.message, 'string');
  assert.equal(response.body.message.includes('sk-secret-token-value'), false);
  assert.equal(
    /authorization:\*\*\*|bearer \*\*\*/i.test(response.body.message),
    true,
  );

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const errorEntry = entries.find(
    (entry) =>
      entry.level === 'error' &&
      entry.context?.surface === 'ingest/start' &&
      entry.context?.retryable === false,
  );
  assert.ok(errorEntry, 'expected non-retryable error log for generic 500');
});

test('ingest-start catch-path logs retryable failures as warn', async () => {
  const response = await request(
    buildApp({
      startIngest: async () => {
        const error = new Error('temporarily busy');
        (error as { code?: string }).code = 'BUSY';
        throw error;
      },
    }),
  )
    .post('/ingest/start')
    .send({
      path: '/tmp/repo',
      name: 'repo',
      model: 'nomic-embed',
    });

  assert.equal(response.status, 429);
  assert.equal(response.body.code, 'BUSY');

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const warnEntry = entries.find(
    (entry) =>
      entry.level === 'warn' &&
      entry.context?.surface === 'ingest/start' &&
      entry.context?.code === 'BUSY',
  );
  assert.ok(warnEntry, 'expected retryable warn log for BUSY');
});
