import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import {
  __resetIngestJobsForTest,
  __setJobInputForTest,
  __setStatusForTest,
} from '../../ingest/ingestJob.js';
import { baseLogger } from '../../logger.js';
import { createMcpRouter } from '../../mcp/server.js';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DEV_0000038_MARKERS = process.env.DEV_0000038_MARKERS;

function createMcpApp({ lockedModelId }: { lockedModelId: string | null }) {
  const app = express();
  app.use(express.json());
  app.use(
    createMcpRouter({
      getRootsCollection: async () =>
        ({
          get: async () => ({
            ids: ['run-1'],
            metadatas: [
              {
                name: 'repo',
                root: '/data/repo',
                model: 'embed-model',
                files: 3,
                chunks: 12,
                embedded: 12,
                lastIngestAt: '2026-01-01T00:00:00.000Z',
                state: 'completed',
                description: 'sample',
                lastError: null,
              },
            ],
          }),
        }) as never,
      getLockedModel: async () => lockedModelId,
    }),
  );
  return app;
}

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  __resetIngestJobsForTest();
});

test.afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
  if (ORIGINAL_DEV_0000038_MARKERS === undefined) {
    delete process.env.DEV_0000038_MARKERS;
  } else {
    process.env.DEV_0000038_MARKERS = ORIGINAL_DEV_0000038_MARKERS;
  }
});

test('ListIngestedRepositories returns canonical lock from resolver', async () => {
  const app = createMcpApp({ lockedModelId: 'text-embedding-openai' });
  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'lock-parity',
      method: 'tools/call',
      params: {
        name: 'ListIngestedRepositories',
        arguments: {},
      },
    });

  assert.equal(response.status, 200);
  assert.equal(typeof response.body?.result?.content?.[0]?.text, 'string');
  const parsed = JSON.parse(
    response.body?.result?.content?.[0]?.text ?? '{}',
  ) as {
    lock: {
      embeddingProvider: string;
      embeddingModel: string;
      embeddingDimensions: number;
      lockedModelId: string;
      modelId: string;
    } | null;
    schemaVersion: string;
    lockedModelId: string | null;
    repos: Array<{
      id: string;
      status: string;
      phase?: string;
      embeddingProvider: string;
      embeddingModel: string;
      modelId: string;
      model: string;
      lock: { embeddingModel: string; modelId: string };
      hostPath: string;
    }>;
  };
  assert.equal(parsed.lockedModelId, 'text-embedding-openai');
  assert.equal(parsed.lock?.embeddingModel, 'text-embedding-openai');
  assert.equal(parsed.lock?.modelId, 'text-embedding-openai');
  assert.equal(parsed.schemaVersion, '0000038-status-phase-v1');
  assert.equal(parsed.repos.length, 1);
  assert.equal(parsed.repos[0].id, 'repo');
  assert.equal(parsed.repos[0].embeddingProvider, 'lmstudio');
  assert.equal(parsed.repos[0].embeddingModel, 'embed-model');
  assert.equal(parsed.repos[0].model, 'embed-model');
  assert.equal(parsed.repos[0].modelId, 'embed-model');
  assert.equal(parsed.repos[0].lock.embeddingModel, 'embed-model');
  assert.equal(parsed.repos[0].lock.modelId, 'embed-model');
  assert.equal(parsed.repos[0].status, 'completed');
  assert.equal(parsed.repos[0].phase, undefined);
});

test('ListIngestedRepositories omits phase for terminal statuses and maps skipped to completed', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createMcpRouter({
      getRootsCollection: async () =>
        ({
          get: async () => ({
            ids: ['done', 'cancelled', 'errored', 'skipped'],
            metadatas: [
              { name: 'done', root: '/data/done', state: 'completed' },
              {
                name: 'cancelled',
                root: '/data/cancelled',
                state: 'cancelled',
              },
              { name: 'errored', root: '/data/errored', state: 'error' },
              { name: 'skipped', root: '/data/skipped', state: 'skipped' },
            ],
          }),
        }) as never,
      getLockedModel: async () => 'text-embed',
    }),
  );

  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'terminals',
      method: 'tools/call',
      params: { name: 'ListIngestedRepositories', arguments: {} },
    });
  const parsed = JSON.parse(
    response.body?.result?.content?.[0]?.text ?? '{}',
  ) as { repos: Array<{ id: string; status: string; phase?: string }> };
  const byId = new Map(parsed.repos.map((repo) => [repo.id, repo]));
  assert.equal(byId.get('done')?.status, 'completed');
  assert.equal(byId.get('done')?.phase, undefined);
  assert.equal(byId.get('cancelled')?.status, 'cancelled');
  assert.equal(byId.get('cancelled')?.phase, undefined);
  assert.equal(byId.get('errored')?.status, 'error');
  assert.equal(byId.get('errored')?.phase, undefined);
  assert.equal(byId.get('skipped')?.status, 'completed');
  assert.equal(byId.get('skipped')?.phase, undefined);
});

test('ListIngestedRepositories shows active overlay and synthesized active entries', async () => {
  __setStatusForTest('active-run', {
    runId: 'active-run',
    state: 'queued',
    counts: { files: 9, chunks: 9, embedded: 0 },
  });
  __setJobInputForTest('active-run', {
    path: '/data/repo',
    root: '/data/repo',
    name: 'repo',
    model: 'text-embed',
  });
  const app = express();
  app.use(express.json());
  app.use(
    createMcpRouter({
      getRootsCollection: async () =>
        ({
          get: async () => ({
            ids: ['persisted'],
            metadatas: [
              {
                name: 'repo',
                root: '/data/repo',
                state: 'completed',
                lastIngestAt: '2026-01-02T00:00:00.000Z',
              },
            ],
          }),
        }) as never,
      getLockedModel: async () => 'text-embed',
    }),
  );

  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'active-overlay',
      method: 'tools/call',
      params: { name: 'ListIngestedRepositories', arguments: {} },
    });
  const parsed = JSON.parse(
    response.body?.result?.content?.[0]?.text ?? '{}',
  ) as {
    repos: Array<{ containerPath: string; status: string; phase?: string }>;
  };
  const overlaid = parsed.repos.find(
    (repo) => repo.containerPath === '/data/repo',
  );
  assert.equal(overlaid?.status, 'ingesting');
  assert.equal(overlaid?.phase, 'queued');
});

test('ListIngestedRepositories synthesizes active-only entries', async () => {
  __setStatusForTest('active-only-run', {
    runId: 'active-only-run',
    state: 'scanning',
    counts: { files: 1, chunks: 0, embedded: 0 },
  });
  __setJobInputForTest('active-only-run', {
    path: '/data/only-active',
    root: '/data/only-active',
    name: 'only-active',
    model: 'text-embed',
  });
  const app = express();
  app.use(express.json());
  app.use(
    createMcpRouter({
      getRootsCollection: async () =>
        ({
          get: async () => ({
            ids: [],
            metadatas: [],
          }),
        }) as never,
      getLockedModel: async () => 'text-embed',
    }),
  );

  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'active-synth',
      method: 'tools/call',
      params: { name: 'ListIngestedRepositories', arguments: {} },
    });
  const parsed = JSON.parse(
    response.body?.result?.content?.[0]?.text ?? '{}',
  ) as {
    repos: Array<{ containerPath: string; status: string; phase?: string }>;
  };
  const synthesized = parsed.repos.find(
    (repo) => repo.containerPath === '/data/only-active',
  );
  assert.equal(synthesized?.status, 'ingesting');
  assert.equal(synthesized?.phase, 'scanning');
});

test('ListIngestedRepositories marker logs are gated behind DEV_0000038_MARKERS', async () => {
  const originalInfo = baseLogger.info;
  const loggedMessages: string[] = [];
  baseLogger.info = ((...args: unknown[]) => {
    const message = args.find((arg) => typeof arg === 'string') as
      | string
      | undefined;
    if (message) loggedMessages.push(message);
  }) as typeof baseLogger.info;

  const app = createMcpApp({ lockedModelId: 'text-embedding-openai' });
  const payload = {
    jsonrpc: '2.0',
    id: 'marker-gate',
    method: 'tools/call',
    params: {
      name: 'ListIngestedRepositories',
      arguments: {},
    },
  };

  try {
    delete process.env.DEV_0000038_MARKERS;
    const defaultResponse = await request(app).post('/mcp').send(payload);
    assert.equal(defaultResponse.status, 200);
    assert.equal(
      loggedMessages.some((entry) => entry.includes('[DEV-0000038][T5]')),
      false,
    );

    loggedMessages.length = 0;
    process.env.DEV_0000038_MARKERS = 'true';
    const debugResponse = await request(app).post('/mcp').send(payload);
    assert.equal(debugResponse.status, 200);
    assert.equal(
      loggedMessages.some((entry) =>
        entry.includes('[DEV-0000038][T5] INGEST_LIST_STATUS_MAPPED'),
      ),
      true,
    );
  } finally {
    baseLogger.info = originalInfo;
  }
});
