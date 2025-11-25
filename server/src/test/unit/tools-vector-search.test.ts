import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import express from 'express';
import request from 'supertest';
import * as chromaClient from '../../ingest/chromaClient.js';
import { createToolsVectorSearchRouter } from '../../routes/toolsVectorSearch.js';

const ORIGINAL_HOST = process.env.HOST_INGEST_DIR;

beforeEach(() => {
  delete process.env.HOST_INGEST_DIR;
});

afterEach(() => {
  mock.restoreAll();
  if (ORIGINAL_HOST === undefined) {
    delete process.env.HOST_INGEST_DIR;
  } else {
    process.env.HOST_INGEST_DIR = ORIGINAL_HOST;
  }
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createToolsVectorSearchRouter());
  return app;
}

function mockRoots(repoId = 'repo-one', rootPath = '/data/repo-one') {
  mock.method(
    chromaClient,
    'getRootsCollection',
    async () =>
      ({
        get: async () => ({
          ids: ['run-1'],
          metadatas: [
            {
              root: rootPath,
              name: repoId,
              model: 'text-embed',
            },
          ],
        }),
      }) as unknown,
  );
}

test('fails validation when query is missing', async () => {
  mockRoots();
  mock.method(
    chromaClient,
    'getVectorsCollection',
    async () =>
      ({
        query: async () => ({}),
      }) as unknown,
  );
  mock.method(chromaClient, 'getLockedModel', async () => 'text-embed');

  const res = await request(buildApp()).post('/tools/vector-search').send({});

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'VALIDATION_FAILED');
  assert.ok(Array.isArray(res.body.details));
});

test('returns 404 when repository id is unknown', async () => {
  mockRoots('repo-one', '/data/repo-one');
  mock.method(
    chromaClient,
    'getVectorsCollection',
    async () =>
      ({
        query: async () => ({}),
      }) as unknown,
  );
  mock.method(chromaClient, 'getLockedModel', async () => 'text-embed');

  const res = await request(buildApp())
    .post('/tools/vector-search')
    .send({ query: 'hello', repository: 'missing' });

  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'REPO_NOT_FOUND');
});

test('returns mapped search results with host path and model id', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  mockRoots('repo-one', '/data/repo-one');

  mock.method(
    chromaClient,
    'getVectorsCollection',
    async () =>
      ({
        query: async () => ({
          ids: [['hash-1']],
          documents: [['chunk body']],
          metadatas: [
            [
              {
                root: '/data/repo-one',
                relPath: 'docs/readme.md',
                model: 'text-embed',
                chunkHash: 'hash-1',
              },
            ],
          ],
          distances: [[0.12]],
        }),
      }) as unknown,
  );

  mock.method(chromaClient, 'getLockedModel', async () => 'text-embed');

  const res = await request(buildApp())
    .post('/tools/vector-search')
    .send({ query: 'hello world' });

  assert.equal(res.status, 200);
  assert.equal(res.body.modelId, 'text-embed');
  assert.equal(res.body.results.length, 1);
  const result = res.body.results[0];
  assert.equal(result.repo, 'repo-one');
  assert.equal(result.relPath, 'docs/readme.md');
  assert.equal(result.containerPath, '/data/repo-one/docs/readme.md');
  assert.equal(result.hostPath, '/host/base/repo-one/docs/readme.md');
  assert.equal(result.chunkId, 'hash-1');
  assert.equal(result.chunk, 'chunk body');
  assert.equal(result.score, 0.12);
  assert.equal(result.modelId, 'text-embed');
});

test('caps limit to 20 and applies repository filter when provided', async () => {
  mockRoots('repo-one', '/data/repo-one');
  let capturedLimit = 0;
  let capturedWhere: Record<string, unknown> | undefined;

  mock.method(
    chromaClient,
    'getVectorsCollection',
    async () =>
      ({
        query: async (opts: {
          nResults?: number;
          where?: Record<string, unknown>;
        }) => {
          capturedLimit = opts.nResults ?? 0;
          capturedWhere = opts.where;
          return {
            ids: [[]],
            documents: [[]],
            metadatas: [[]],
            distances: [[]],
          };
        },
      }) as unknown,
  );

  mock.method(chromaClient, 'getLockedModel', async () => null);

  const res = await request(buildApp())
    .post('/tools/vector-search')
    .send({ query: 'test', limit: 50, repository: 'repo-one' });

  assert.equal(res.status, 200);
  assert.equal(capturedLimit, 20);
  assert.deepEqual(capturedWhere, { root: '/data/repo-one' });
});
