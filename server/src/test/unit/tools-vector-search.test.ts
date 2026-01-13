import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createToolsVectorSearchRouter } from '../../routes/toolsVectorSearch.js';

const ORIGINAL_HOST = process.env.HOST_INGEST_DIR;
const ORIGINAL_CUTOFF = process.env.CODEINFO_RETRIEVAL_DISTANCE_CUTOFF;
const ORIGINAL_CUTOFF_DISABLED = process.env.CODEINFO_RETRIEVAL_CUTOFF_DISABLED;
const ORIGINAL_FALLBACK = process.env.CODEINFO_RETRIEVAL_FALLBACK_CHUNKS;
const ORIGINAL_TOOL_MAX = process.env.CODEINFO_TOOL_MAX_CHARS;
const ORIGINAL_TOOL_CHUNK = process.env.CODEINFO_TOOL_CHUNK_MAX_CHARS;

beforeEach(() => {
  delete process.env.HOST_INGEST_DIR;
  delete process.env.CODEINFO_RETRIEVAL_DISTANCE_CUTOFF;
  delete process.env.CODEINFO_RETRIEVAL_CUTOFF_DISABLED;
  delete process.env.CODEINFO_RETRIEVAL_FALLBACK_CHUNKS;
  delete process.env.CODEINFO_TOOL_MAX_CHARS;
  delete process.env.CODEINFO_TOOL_CHUNK_MAX_CHARS;
});

afterEach(() => {
  if (ORIGINAL_HOST === undefined) {
    delete process.env.HOST_INGEST_DIR;
  } else {
    process.env.HOST_INGEST_DIR = ORIGINAL_HOST;
  }
  if (ORIGINAL_CUTOFF === undefined) {
    delete process.env.CODEINFO_RETRIEVAL_DISTANCE_CUTOFF;
  } else {
    process.env.CODEINFO_RETRIEVAL_DISTANCE_CUTOFF = ORIGINAL_CUTOFF;
  }
  if (ORIGINAL_CUTOFF_DISABLED === undefined) {
    delete process.env.CODEINFO_RETRIEVAL_CUTOFF_DISABLED;
  } else {
    process.env.CODEINFO_RETRIEVAL_CUTOFF_DISABLED = ORIGINAL_CUTOFF_DISABLED;
  }
  if (ORIGINAL_FALLBACK === undefined) {
    delete process.env.CODEINFO_RETRIEVAL_FALLBACK_CHUNKS;
  } else {
    process.env.CODEINFO_RETRIEVAL_FALLBACK_CHUNKS = ORIGINAL_FALLBACK;
  }
  if (ORIGINAL_TOOL_MAX === undefined) {
    delete process.env.CODEINFO_TOOL_MAX_CHARS;
  } else {
    process.env.CODEINFO_TOOL_MAX_CHARS = ORIGINAL_TOOL_MAX;
  }
  if (ORIGINAL_TOOL_CHUNK === undefined) {
    delete process.env.CODEINFO_TOOL_CHUNK_MAX_CHARS;
  } else {
    process.env.CODEINFO_TOOL_CHUNK_MAX_CHARS = ORIGINAL_TOOL_CHUNK;
  }
});

type RootsData = { ids?: string[]; metadatas?: Record<string, unknown>[] };

function buildApp({
  roots,
  lockedModelId = null,
  vectorsQuery,
}: {
  roots: RootsData;
  lockedModelId?: string | null;
  vectorsQuery: (opts: {
    nResults?: number;
    where?: Record<string, unknown>;
  }) => Promise<unknown>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    createToolsVectorSearchRouter({
      getRootsCollection: async () =>
        ({
          get: async () => roots,
        }) as unknown as import('chromadb').Collection,
      getVectorsCollection: async () =>
        ({
          query: vectorsQuery,
        }) as unknown as import('chromadb').Collection,
      getLockedModel: async () => lockedModelId,
    }),
  );
  return app;
}

const defaultRoots = {
  ids: ['run-1'],
  metadatas: [
    {
      root: '/data/repo-one',
      name: 'repo-one',
      model: 'text-embed',
    },
  ],
};

test('fails validation when query is missing', async () => {
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({}),
    }),
  )
    .post('/tools/vector-search')
    .send({});

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'VALIDATION_FAILED');
  assert.ok(Array.isArray(res.body.details));
});

test('returns 404 when repository id is unknown', async () => {
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({}),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello', repository: 'missing' });

  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'REPO_NOT_FOUND');
});

test('returns mapped search results with host path and model id', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
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
    }),
  )
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
  assert.equal(result.lineCount, 1);
  assert.ok(Array.isArray(res.body.files));
  assert.equal(res.body.files.length, 1);
  const file = res.body.files[0];
  assert.equal(file.hostPath, '/host/base/repo-one/docs/readme.md');
  assert.equal(file.chunkCount, 1);
  assert.equal(file.highestMatch, 0.12);
  assert.equal(file.lineCount, 1);
});

test('aggregates files by host path with summed lines and min score', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2']],
        documents: [['first line', 'second\nline']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
          ],
        ],
        distances: [[0.33, 0.12]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.files));
  assert.equal(res.body.files.length, 1);
  const file = res.body.files[0];
  assert.equal(file.hostPath, '/host/base/repo-one/docs/readme.md');
  assert.equal(file.chunkCount, 2);
  assert.equal(file.highestMatch, 0.12);
  assert.equal(file.lineCount, 3);
});

test('highestMatch remains null when no numeric distances exist', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
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
        distances: [[null]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  const file = res.body.files[0];
  assert.equal(file.highestMatch, null);
});

test('filters results by cutoff when enabled', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.CODEINFO_RETRIEVAL_DISTANCE_CUTOFF = '0.2';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2']],
        documents: [['first line', 'second line']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
          ],
        ],
        distances: [[0.12, 0.33]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 1);
  assert.equal(res.body.results[0].chunkId, 'hash-1');
  assert.equal(res.body.files.length, 1);
  assert.equal(res.body.files[0].chunkCount, 1);
});

test('keeps all results when cutoff is disabled', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.CODEINFO_RETRIEVAL_DISTANCE_CUTOFF = '0.2';
  process.env.CODEINFO_RETRIEVAL_CUTOFF_DISABLED = 'true';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2']],
        documents: [['first line', 'second line']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
          ],
        ],
        distances: [[0.12, 0.33]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 2);
});

test('falls back to the best results when none pass cutoff', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.CODEINFO_RETRIEVAL_DISTANCE_CUTOFF = '0.1';
  process.env.CODEINFO_RETRIEVAL_FALLBACK_CHUNKS = '2';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2', 'hash-3']],
        documents: [['first line', 'second line', 'third line']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-3',
            },
          ],
        ],
        distances: [[0.33, 0.12, 0.5]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.results.map((result: { score: number | null }) => result.score),
    [0.33, 0.12],
  );
});

test('returns empty payloads when no results exist', async () => {
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [[]],
        documents: [[]],
        metadatas: [[]],
        distances: [[]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 0);
  assert.equal(res.body.files.length, 0);
});

test('missing distances only pass through fallback selection', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2']],
        documents: [['first line', 'second line']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
          ],
        ],
        distances: [[null, null]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 2);
  assert.equal(res.body.results[0].score, null);
  assert.equal(res.body.results[1].score, null);
});

test('fallback preserves original order when distances tie', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.CODEINFO_RETRIEVAL_DISTANCE_CUTOFF = '0.1';
  process.env.CODEINFO_RETRIEVAL_FALLBACK_CHUNKS = '2';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2', 'hash-3']],
        documents: [['first line', 'second line', 'third line']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-3',
            },
          ],
        ],
        distances: [[0.2, 0.2, 0.2]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.results.map((result: { chunkId: string }) => result.chunkId),
    ['hash-1', 'hash-2'],
  );
});

test('files summaries reflect filtered results', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.CODEINFO_RETRIEVAL_DISTANCE_CUTOFF = '1.4';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2']],
        documents: [['first line', 'second line']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/other.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
          ],
        ],
        distances: [[0.12, 2.0]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 1);
  assert.equal(res.body.files.length, 1);
  assert.equal(
    res.body.files[0].hostPath,
    '/host/base/repo-one/docs/readme.md',
  );
});

test('invalid env values fall back to defaults', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.CODEINFO_RETRIEVAL_DISTANCE_CUTOFF = 'not-a-number';
  process.env.CODEINFO_RETRIEVAL_FALLBACK_CHUNKS = '-4';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2']],
        documents: [['first line', 'second line']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
          ],
        ],
        distances: [[1.2, 2.0]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 1);
  assert.equal(res.body.results[0].score, 1.2);
});

test('truncates each chunk to the per-chunk cap', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.CODEINFO_TOOL_CHUNK_MAX_CHARS = '4';
  process.env.CODEINFO_TOOL_MAX_CHARS = '100';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1']],
        documents: [['abcdefgh']],
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
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results[0].chunk, 'abcd');
});

test('drops additional chunks once total cap is reached', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.CODEINFO_TOOL_CHUNK_MAX_CHARS = '10';
  process.env.CODEINFO_TOOL_MAX_CHARS = '5';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2']],
        documents: [['hello', 'world']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
          ],
        ],
        distances: [[0.12, 0.33]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 1);
  assert.equal(res.body.results[0].chunkId, 'hash-1');
});

test('returns no chunks when total cap is too small', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.CODEINFO_TOOL_CHUNK_MAX_CHARS = '10';
  process.env.CODEINFO_TOOL_MAX_CHARS = '3';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1']],
        documents: [['hello']],
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
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 0);
  assert.equal(res.body.files.length, 0);
});

test('lineCount reflects truncated chunks', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.CODEINFO_TOOL_CHUNK_MAX_CHARS = '7';
  process.env.CODEINFO_TOOL_MAX_CHARS = '100';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1']],
        documents: [['one\ntwo\nthree']],
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
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results[0].lineCount, 2);
});

test('files summaries reflect capped results', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.CODEINFO_TOOL_CHUNK_MAX_CHARS = '10';
  process.env.CODEINFO_TOOL_MAX_CHARS = '5';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2']],
        documents: [['hello', 'world']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
          ],
        ],
        distances: [[0.12, 0.33]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.files[0].chunkCount, 1);
  assert.equal(res.body.files[0].lineCount, 1);
});

test('invalid cap env values fall back to defaults', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.CODEINFO_TOOL_MAX_CHARS = 'nope';
  process.env.CODEINFO_TOOL_CHUNK_MAX_CHARS = '-2';
  const chunk = 'a'.repeat(6000);
  const chunk2 = 'b'.repeat(6000);
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2']],
        documents: [[chunk, chunk2]],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
          ],
        ],
        distances: [[0.12, 0.33]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 2);
  assert.equal(res.body.results[0].chunk.length, 5000);
});

test('dedupes duplicate chunk ids and keeps top 2 per file', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-dup', 'hash-2', 'hash-3']],
        documents: [['first', 'second', 'third', 'fourth']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-3',
            },
          ],
        ],
        distances: [[0.3, 0.2, 0.1, 0.4]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.results.map((result: { chunkId: string }) => result.chunkId),
    ['hash-1', 'hash-2'],
  );
});

test('dedupes identical chunk text within the same file', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2']],
        documents: [['repeat', 'repeat']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
          ],
        ],
        distances: [[0.1, 0.2]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 1);
});

test('does not dedupe identical chunk text across files', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2']],
        documents: [['repeat', 'repeat']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/other.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
          ],
        ],
        distances: [[0.1, 0.2]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 2);
});

test('missing distances are lowest priority in dedupe ranking', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async () => ({
        ids: [['hash-1', 'hash-2', 'hash-3']],
        documents: [['first', 'second', 'third']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-1',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-2',
            },
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: 'text-embed',
              chunkHash: 'hash-3',
            },
          ],
        ],
        distances: [[0.1, null, 0.2]],
      }),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'hello world', limit: 5 });

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.results.map((result: { score: number | null }) => result.score),
    [0.1, 0.2],
  );
});

test('caps limit to 20 and applies repository filter when provided', async () => {
  let capturedLimit = 0;
  let capturedWhere: Record<string, unknown> | undefined;

  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: 'text-embed',
      vectorsQuery: async (opts: {
        nResults?: number;
        where?: Record<string, unknown>;
      }) => {
        capturedLimit = opts.nResults ?? 0;
        capturedWhere = opts.where;
        return { ids: [[]], documents: [[]], metadatas: [[]], distances: [[]] };
      },
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'test', limit: 50, repository: 'repo-one' });

  assert.equal(res.status, 200);
  assert.equal(capturedLimit, 20);
  assert.deepEqual(capturedWhere, { root: '/data/repo-one' });
});

test('returns 409 when no locked model is present', async () => {
  const res = await request(
    buildApp({
      roots: defaultRoots,
      lockedModelId: null,
      vectorsQuery: async () => ({}),
    }),
  )
    .post('/tools/vector-search')
    .send({ query: 'needs ingest' });

  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'INGEST_REQUIRED');
});
