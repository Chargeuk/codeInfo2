import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach, mock } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import { ChromaClient } from 'chromadb';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import {
  __resetAstParserLogStateForTest,
  __setParseAstSourceForTest,
} from '../../ast/parser.js';
import { resetCollectionsForTests } from '../../ingest/chromaClient.js';
import { hashFile } from '../../ingest/hashing.js';
import {
  __resetIngestJobsForTest,
  getStatus,
  startIngest,
} from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import { query, resetStore } from '../../logStore.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';

function buildApp(options?: {
  reembed?: (
    root: string,
  ) => Promise<`${string}-${string}-${string}-${string}-${string}`>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    createIngestReembedRouter({
      clientFactory: () => ({}) as never,
      isBusy: () => false,
      reembed: async (root) =>
        options?.reembed
          ? options.reembed(root)
          : ('00000000-0000-0000-0000-000000000001' as const),
    }),
  );
  return app;
}

test.beforeEach(() => {
  resetStore();
});

beforeEach(() => {
  mock.restoreAll();
  mock.reset();
  __resetIngestJobsForTest();
  __resetAstParserLogStateForTest();
  __setParseAstSourceForTest();
  resetCollectionsForTests();
  release();
  delete process.env.INGEST_TEST_GIT_PATHS;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  mock.restoreAll();
  mock.reset();
  __resetIngestJobsForTest();
  __resetAstParserLogStateForTest();
  __setParseAstSourceForTest();
  resetCollectionsForTests();
  release();
  delete process.env.INGEST_TEST_GIT_PATHS;
  delete process.env.NODE_ENV;
});

const createTempRepo = async (files: Record<string, string>) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-reembed-'));
  await fs.mkdir(path.join(root, '.git'));
  await Promise.all(
    Object.entries(files).map(async ([relPath, contents]) => {
      const fullPath = path.join(root, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, contents, 'utf8');
    }),
  );
  process.env.INGEST_TEST_GIT_PATHS = Object.keys(files).join(',');
  return {
    root,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
};

const waitForTerminal = async (runId: string) => {
  const terminal = new Set(['completed', 'skipped', 'cancelled', 'error']);
  for (let i = 0; i < 100; i += 1) {
    const status = getStatus(runId);
    if (status && terminal.has(status.state)) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ingest ${runId}`);
};

const setupIngestChromaMocks = () => {
  const vectors = {
    metadata: { lockedModelId: 'embed-model' as string | null },
    add: mock.fn(async () => {}),
    get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    delete: mock.fn(async () => {}),
    modify: async ({ metadata }: { metadata?: Record<string, unknown> }) => {
      vectors.metadata = {
        ...(vectors.metadata ?? {}),
        ...(metadata ?? {}),
      } as { lockedModelId: string | null };
    },
    count: async () => 0,
  };
  const roots = {
    get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    add: mock.fn(async () => {}),
    delete: mock.fn(async () => {}),
  };

  mock.method(
    ChromaClient.prototype,
    'getOrCreateCollection',
    async (opts: { name?: string }) => {
      if (opts.name === 'ingest_roots') return roots as never;
      return vectors as never;
    },
  );
  mock.method(ChromaClient.prototype, 'deleteCollection', async () => {});
  mock.method(IngestFileModel, 'find', () => ({
    select: () => ({
      lean: () => ({
        exec: async () => [],
      }),
    }),
  }));
  mock.method(
    IngestFileModel,
    'bulkWrite',
    mock.fn(async () => ({})),
  );
  mock.method(
    IngestFileModel,
    'deleteMany',
    mock.fn(() => ({ exec: async () => ({}) })),
  );
  (mongoose.connection as unknown as { readyState: number }).readyState = 0;
  process.env.NODE_ENV = 'test';
  __setParseAstSourceForTest(async () => ({
    status: 'ok',
    language: 'typescript',
    symbols: [],
    edges: [],
    references: [],
    imports: [],
  }));

  return { vectors, roots };
};

const buildIngestDeps = () => ({
  baseUrl: 'http://lmstudio.local',
  lmClientFactory: () =>
    ({
      embedding: {
        model: async () => ({
          embed: async () => ({ embedding: [0.1, 0.2, 0.3] }),
          getContextLength: async () => 256,
          countTokens: async (text: string) =>
            text.split(/\s+/).filter(Boolean).length,
        }),
      },
    }) as unknown as LMStudioClient,
});

test('ingest-reembed catch-path logs retryable failures as warn', async () => {
  const response = await request(
    buildApp({
      reembed: async () => {
        const error = new Error('temporarily busy');
        (error as { code?: string }).code = 'BUSY';
        throw error;
      },
    }),
  ).post('/ingest/reembed/%2Ftmp%2Frepo');

  assert.equal(response.status, 429);
  assert.equal(response.body.code, 'BUSY');

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const warnEntry = entries.find(
    (entry) =>
      entry.level === 'warn' &&
      entry.context?.surface === 'ingest/reembed' &&
      entry.context?.code === 'BUSY',
  );
  assert.ok(warnEntry, 'expected retryable reembed warn log');
});

test('ingest-reembed catch-path logs non-retryable failures as error', async () => {
  const response = await request(
    buildApp({
      reembed: async () => {
        const error = new Error('model locked');
        (error as { code?: string }).code = 'MODEL_LOCKED';
        throw error;
      },
    }),
  ).post('/ingest/reembed/%2Ftmp%2Frepo');

  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'MODEL_LOCKED');

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const errorEntry = entries.find(
    (entry) =>
      entry.level === 'error' &&
      entry.context?.surface === 'ingest/reembed' &&
      entry.context?.code === 'MODEL_LOCKED',
  );
  assert.ok(errorEntry, 'expected non-retryable reembed error log');
  assert.equal(errorEntry?.context?.retryable, false);
  assert.equal(errorEntry?.context?.root, '/tmp/repo');
  assert.equal(errorEntry?.context?.runId, undefined);
});

test('blank-only delta reembed keeps completed no-op semantics', async () => {
  setupIngestChromaMocks();
  const { root, cleanup } = await createTempRepo({
    'src/blank.ts': '   \n\t\n',
  });

  try {
    const fileHash = await hashFile(path.join(root, 'src/blank.ts'));
    mock.method(IngestFileModel, 'find', () => ({
      select: () => ({
        lean: () => ({
          exec: async () => [{ relPath: 'src/blank.ts', fileHash }],
        }),
      }),
    }));

    const runId = await startIngest(
      {
        path: root,
        name: 'blank-reembed',
        model: 'embed-model',
        operation: 'reembed',
      },
      buildIngestDeps(),
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'completed');
    assert.equal(status.error, null);
    assert.doesNotMatch(
      String(status.lastError ?? status.message ?? ''),
      /no eligible files/i,
    );
  } finally {
    await cleanup();
  }
});

test('deletions-only delta reembed stays completed and does not use fresh-ingest failure', async () => {
  setupIngestChromaMocks();
  const { root, cleanup } = await createTempRepo({
    'src/deleted.ts': 'export const deleted = 1;\n',
  });

  try {
    mock.method(IngestFileModel, 'find', () => ({
      select: () => ({
        lean: () => ({
          exec: async () => [
            { relPath: 'src/deleted.ts', fileHash: 'deleted-hash' },
          ],
        }),
      }),
    }));
    await fs.rm(path.join(root, 'src/deleted.ts'));
    process.env.INGEST_TEST_GIT_PATHS = '';

    const runId = await startIngest(
      {
        path: root,
        name: 'deleted-reembed',
        model: 'embed-model',
        operation: 'reembed',
      },
      buildIngestDeps(),
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'completed');
    assert.notEqual(status.error?.error, 'NO_ELIGIBLE_FILES');
    assert.doesNotMatch(String(status.message ?? ''), /no eligible files/i);
  } finally {
    await cleanup();
  }
});
