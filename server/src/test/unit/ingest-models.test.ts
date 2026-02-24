import assert from 'node:assert/strict';
import type { LMStudioClient } from '@lmstudio/sdk';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { createIngestModelsRouter } from '../../routes/ingestModels.js';

function createClient(
  models: {
    modelKey: string;
    displayName: string;
    type?: string;
    capabilities?: string[];
  }[],
) {
  return {
    system: {
      listDownloadedModels: async () => models,
    },
  } as LMStudioClient;
}

function buildApp({
  lockedModelId,
  models,
}: {
  lockedModelId: string | null;
  models: {
    modelKey: string;
    displayName: string;
    type?: string;
    capabilities?: string[];
  }[];
}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createIngestModelsRouter({
      clientFactory: () => createClient(models),
      getLockedModel: async () => lockedModelId,
    }),
  );
  return app;
}

const ORIGINAL_BASE_URL = process.env.LMSTUDIO_BASE_URL;
test.beforeEach(() => {
  process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';
});

test.afterEach(() => {
  if (ORIGINAL_BASE_URL === undefined) {
    delete process.env.LMSTUDIO_BASE_URL;
  } else {
    process.env.LMSTUDIO_BASE_URL = ORIGINAL_BASE_URL;
  }
});

test('lock resolver returns canonical locked model value for /ingest/models', async () => {
  const response = await request(
    buildApp({
      lockedModelId: 'text-embedding-openai',
      models: [
        {
          modelKey: 'text-embedding-3-small',
          displayName: 'text-embedding-3-small',
          type: 'embedding',
        },
        {
          modelKey: 'codex',
          displayName: 'codex',
          type: 'llm',
        },
      ],
    }),
  ).get('/ingest/models');

  assert.equal(response.status, 200);
  assert.equal(response.body.lockedModelId, 'text-embedding-openai');
  assert.equal(response.body.models.length, 1);
  assert.equal(response.body.models[0].id, 'text-embedding-3-small');
});
