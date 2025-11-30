import assert from 'node:assert/strict';
import test, { beforeEach, mock } from 'node:test';
import { createLmStudioTools } from '../../lmstudio/tools.js';

const baseDeps = {
  getRootsCollection: async () =>
    ({
      get: async () => ({
        ids: ['repo-id'],
        metadatas: [
          {
            root: '/data/repo-id',
            name: 'repo-name',
            description: 'desc',
            model: 'embed-model',
            lastIngestAt: '2025-01-01T00:00:00.000Z',
            files: 1,
            chunks: 2,
            embedded: 2,
          },
        ],
      }),
    }) as unknown as import('chromadb').Collection,
  getVectorsCollection: async () =>
    ({
      query: async () => ({
        ids: [['chunk-1']],
        documents: [['chunk body']],
        metadatas: [
          [
            {
              root: '/data/repo-id',
              relPath: 'docs/readme.md',
              model: 'embed-model',
              chunkHash: 'chunk-1',
            },
          ],
        ],
        distances: [[0.42]],
      }),
    }) as unknown as import('chromadb').Collection,
  getLockedModel: async () => 'embed-model',
};

const buildToolContext = () => ({
  status: () => undefined,
  warn: () => undefined,
  signal: new AbortController().signal,
  callId: 1,
});

beforeEach(() => {
  process.env.HOST_INGEST_DIR = '/host/base';
});

test('ListIngestedRepositories tool returns mapped repos and logs metadata', async () => {
  const log = mock.fn();
  const { listIngestedRepositoriesTool } = createLmStudioTools({
    deps: baseDeps,
    log,
  });

  const result = await listIngestedRepositoriesTool.implementation(
    {},
    buildToolContext(),
  );

  assert.equal(result.lockedModelId, 'embed-model');
  assert.equal(result.repos.length, 1);
  const repo = result.repos[0];
  assert.equal(repo.id, 'repo-name');
  assert.equal(repo.containerPath, '/data/repo-id');
  assert.equal(repo.hostPath, '/host/base/repo-id');
  assert.equal(repo.counts.embedded, 2);
  assert.equal(log.mock.calls.length, 1);
  assert.equal(log.mock.calls[0].arguments[0].tool, 'ListIngestedRepositories');
});

test('VectorSearch tool returns chunk with paths and clamps limit', async () => {
  const log = mock.fn();
  const { vectorSearchTool } = createLmStudioTools({
    deps: baseDeps,
    log,
  });

  const result = await vectorSearchTool.implementation(
    {
      query: 'hello',
      limit: 20,
    },
    buildToolContext(),
  );

  assert.equal(result.modelId, 'embed-model');
  assert.equal(result.results.length, 1);
  const item = result.results[0];
  assert.equal(item.repo, 'repo-name');
  assert.equal(item.relPath, 'docs/readme.md');
  assert.equal(item.containerPath, '/data/repo-id/docs/readme.md');
  assert.equal(item.hostPath, '/host/base/repo-id/docs/readme.md');
  assert.equal(item.chunkId, 'chunk-1');
  assert.equal(item.chunk, 'chunk body');
  assert.equal(item.score, 0.42);
  assert.equal(log.mock.calls.at(-1)?.arguments[0].limit, 20);
});

test('VectorSearch tool surfaces repo not found as an error', async () => {
  const { vectorSearchTool } = createLmStudioTools({
    deps: baseDeps,
  });

  await assert.rejects(
    () =>
      vectorSearchTool.implementation(
        {
          query: 'hello',
          repository: 'missing',
          limit: 5,
        },
        buildToolContext(),
      ),
    (err: unknown) => err instanceof Error && err.message === 'REPO_NOT_FOUND',
  );
});
