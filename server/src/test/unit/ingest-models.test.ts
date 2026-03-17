import assert from 'node:assert/strict';
import test from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';
import type { LockedEmbeddingModel } from '../../ingest/chromaClient.js';
import { OpenAiEmbeddingError } from '../../ingest/providers/index.js';
import { createIngestModelsRouter } from '../../routes/ingestModels.js';

type DownloadedModel = {
  modelKey: string;
  displayName: string;
  type?: string;
  capabilities?: string[];
};

function createClient(models: DownloadedModel[] | Error) {
  return {
    system: {
      listDownloadedModels: async () => {
        if (models instanceof Error) throw models;
        return models;
      },
    },
  } as LMStudioClient;
}

function buildApp({
  lock,
  lmModels,
  openAiModels,
}: {
  lock: LockedEmbeddingModel | null;
  lmModels: DownloadedModel[] | Error;
  openAiModels?: Array<{ id: string }> | Error;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createIngestModelsRouter({
      clientFactory: () => createClient(lmModels),
      getLockedModel: async () => lock,
      openAiListModels:
        openAiModels === undefined
          ? undefined
          : async () => {
              if (openAiModels instanceof Error) throw openAiModels;
              return openAiModels;
            },
    }),
  );
  return app;
}

const ORIGINAL_BASE_URL = process.env.CODEINFO_LMSTUDIO_BASE_URL;
const ORIGINAL_OPENAI_KEY = process.env.CODEINFO_OPENAI_EMBEDDING_KEY;

test.beforeEach(() => {
  process.env.CODEINFO_LMSTUDIO_BASE_URL = 'http://localhost:1234';
  process.env.CODEINFO_OPENAI_EMBEDDING_KEY = 'sk-test';
});

test.afterEach(() => {
  if (ORIGINAL_BASE_URL === undefined) {
    delete process.env.CODEINFO_LMSTUDIO_BASE_URL;
  } else {
    process.env.CODEINFO_LMSTUDIO_BASE_URL = ORIGINAL_BASE_URL;
  }

  if (ORIGINAL_OPENAI_KEY === undefined) {
    delete process.env.CODEINFO_OPENAI_EMBEDDING_KEY;
  } else {
    process.env.CODEINFO_OPENAI_EMBEDDING_KEY = ORIGINAL_OPENAI_KEY;
  }
});

test('lock resolver returns canonical lock envelope and alias parity', async () => {
  const response = await request(
    buildApp({
      lock: {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 1536,
        lockedModelId: 'text-embedding-3-small',
        source: 'canonical',
      },
      lmModels: [
        {
          modelKey: 'embed-1',
          displayName: 'Embedding Model',
          type: 'embedding',
        },
      ],
      openAiModels: [{ id: 'text-embedding-3-small' }],
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.lock, {
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
  });
  assert.equal(response.body.lockedModelId, 'text-embedding-3-small');
});

test('missing key maps openai to disabled and does not require OpenAI list', async () => {
  delete process.env.CODEINFO_OPENAI_EMBEDDING_KEY;
  const response = await request(
    buildApp({
      lock: null,
      lmModels: [
        {
          modelKey: 'embed-1',
          displayName: 'Embedding Model',
          type: 'embedding',
        },
      ],
      openAiModels: new Error('should not be called'),
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  assert.equal(response.body.openai.enabled, false);
  assert.equal(response.body.openai.status, 'disabled');
  assert.equal(response.body.openai.statusCode, 'OPENAI_DISABLED');
  assert.equal(response.body.models.length, 1);
  assert.equal(response.body.models[0].provider, 'lmstudio');
});

test('blank key maps openai to disabled', async () => {
  process.env.CODEINFO_OPENAI_EMBEDDING_KEY = '   ';
  const response = await request(
    buildApp({
      lock: null,
      lmModels: [],
      openAiModels: new Error('should not be called'),
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  assert.equal(response.body.openai.enabled, false);
  assert.equal(response.body.openai.statusCode, 'OPENAI_DISABLED');
});

test('OpenAI allowlist filter and deterministic ordering are enforced', async () => {
  const response = await request(
    buildApp({
      lock: null,
      lmModels: [],
      openAiModels: [
        { id: 'text-embedding-3-large' },
        { id: 'text-embedding-3-small' },
        { id: 'text-embedding-ada-002' },
      ],
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.models.map((m: { id: string }) => m.id),
    ['text-embedding-3-small', 'text-embedding-3-large'],
  );
  assert.equal(response.body.openai.status, 'ok');
  assert.equal(response.body.openai.warning, undefined);
});

test('allowlist no-match returns warning with retryable false', async () => {
  const response = await request(
    buildApp({
      lock: null,
      lmModels: [],
      openAiModels: [{ id: 'text-embedding-ada-002' }],
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  assert.equal(response.body.models.length, 0);
  assert.equal(response.body.openai.statusCode, 'OPENAI_ALLOWLIST_NO_MATCH');
  assert.equal(response.body.openai.warning.retryable, false);
});

test('transient OpenAI failure maps to temporary failure warning', async () => {
  const response = await request(
    buildApp({
      lock: null,
      lmModels: [
        {
          modelKey: 'embed-1',
          displayName: 'Embedding Model',
          type: 'embedding',
        },
      ],
      openAiModels: new OpenAiEmbeddingError(
        'OPENAI_TIMEOUT',
        'timeout',
        true,
        408,
        2000,
      ),
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  assert.equal(
    response.body.openai.statusCode,
    'OPENAI_MODELS_LIST_TEMPORARY_FAILURE',
  );
  assert.equal(response.body.openai.warning.retryable, true);
  assert.equal(response.body.models.length, 1);
  assert.equal(response.body.models[0].provider, 'lmstudio');
});

test('OpenAI auth failure maps to auth failed warning', async () => {
  const response = await request(
    buildApp({
      lock: null,
      lmModels: [],
      openAiModels: new OpenAiEmbeddingError(
        'OPENAI_AUTH_FAILED',
        'bad key',
        false,
        401,
      ),
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  assert.equal(
    response.body.openai.statusCode,
    'OPENAI_MODELS_LIST_AUTH_FAILED',
  );
  assert.equal(response.body.openai.warning.retryable, false);
});

test('OpenAI unavailable failure maps to unavailable warning', async () => {
  const response = await request(
    buildApp({
      lock: null,
      lmModels: [],
      openAiModels: new OpenAiEmbeddingError(
        'OPENAI_UNAVAILABLE',
        'down',
        true,
        503,
      ),
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  assert.equal(
    response.body.openai.statusCode,
    'OPENAI_MODELS_LIST_UNAVAILABLE',
  );
});

test('invalid CODEINFO_LMSTUDIO_BASE_URL yields warning envelope and preserves OpenAI options', async () => {
  process.env.CODEINFO_LMSTUDIO_BASE_URL = 'not-a-url';
  const response = await request(
    buildApp({
      lock: null,
      lmModels: new Error('should not be called'),
      openAiModels: [{ id: 'text-embedding-3-small' }],
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  assert.equal(response.body.lmstudio.status, 'warning');
  assert.equal(response.body.models.length, 1);
  assert.equal(response.body.models[0].provider, 'openai');
});

test('LM Studio-only failure still returns 200 warning envelope', async () => {
  const response = await request(
    buildApp({
      lock: null,
      lmModels: new Error('timeout'),
      openAiModels: [{ id: 'text-embedding-3-small' }],
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  assert.equal(response.body.lmstudio.status, 'warning');
  assert.equal(response.body.openai.status, 'ok');
  assert.equal(response.body.models.length, 1);
});

test('both providers fail still returns deterministic 200 envelope', async () => {
  const response = await request(
    buildApp({
      lock: null,
      lmModels: new Error('lm down'),
      openAiModels: new OpenAiEmbeddingError(
        'OPENAI_UNAVAILABLE',
        'openai down',
        true,
        503,
      ),
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  assert.equal(response.body.models.length, 0);
  assert.equal(response.body.lmstudio.status, 'warning');
  assert.equal(response.body.openai.status, 'warning');
});

test('model entry shape stays id/displayName/provider only', async () => {
  const response = await request(
    buildApp({
      lock: null,
      lmModels: [
        {
          modelKey: 'embed-1',
          displayName: 'Embedding Model',
          type: 'embedding',
          capabilities: ['embedding'],
        },
      ],
      openAiModels: [{ id: 'text-embedding-3-small' }],
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  for (const model of response.body.models as Array<Record<string, unknown>>) {
    assert.deepEqual(Object.keys(model).sort(), [
      'displayName',
      'id',
      'provider',
    ]);
  }
});
