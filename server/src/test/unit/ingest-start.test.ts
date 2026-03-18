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
import {
  __resetIngestJobsForTest,
  getStatus,
  startIngest,
} from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import { query, resetStore } from '../../logStore.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
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

afterEach(() => {
  mock.restoreAll();
  mock.reset();
  __resetIngestJobsForTest();
  __resetAstParserLogStateForTest();
  __setParseAstSourceForTest();
  resetCollectionsForTests();
  release();
  delete process.env.CODEINFO_INGEST_TEST_GIT_PATHS;
  delete process.env.NODE_ENV;
});

const createTempRepo = async (files: Record<string, string>) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-ingest-'));
  await fs.mkdir(path.join(root, '.git'));
  await Promise.all(
    Object.entries(files).map(async ([relPath, contents]) => {
      const fullPath = path.join(root, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, contents, 'utf8');
    }),
  );
  process.env.CODEINFO_INGEST_TEST_GIT_PATHS = Object.keys(files).join(',');
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
    metadata: { lockedModelId: null as string | null },
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

const buildIngestDeps = () => {
  let embedCalls = 0;
  const embeddingModel = {
    embed: async () => {
      embedCalls += 1;
      return { embedding: [0.1, 0.2, 0.3] };
    },
    getContextLength: async () => 256,
    countTokens: async (text: string) =>
      text.split(/\s+/).filter(Boolean).length,
  };
  return {
    baseUrl: 'http://lmstudio.local',
    lmClientFactory: () =>
      ({
        embedding: {
          model: async () => embeddingModel,
        },
      }) as unknown as LMStudioClient,
    getEmbedCalls: () => embedCalls,
  };
};

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

test('blank-only fresh ingest now fails with the zero-files NO_ELIGIBLE_FILES contract', async () => {
  const { roots, vectors } = setupIngestChromaMocks();
  const deps = buildIngestDeps();
  const { root, cleanup } = await createTempRepo({
    'src/blank.ts': '   \n\t  \n',
  });

  try {
    const runId = await startIngest(
      { path: root, name: 'blank-repo', model: 'embed-model' },
      deps,
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'error');
    assert.equal(status.error?.error, 'NO_ELIGIBLE_FILES');
    assert.match(String(status.lastError ?? ''), /no eligible files/i);
    assert.equal(deps.getEmbedCalls(), 0);
    assert.equal(vectors.add.mock.calls.length, 0);
    assert.equal(roots.add.mock.calls.length, 0);
  } finally {
    await cleanup();
  }
});

test('blank-only fresh ingest leaves no completed root summary or success persistence behind', async () => {
  const { roots, vectors } = setupIngestChromaMocks();
  const ingestFileBulkWrite = IngestFileModel.bulkWrite as unknown as {
    mock: { calls: unknown[] };
  };
  const { root, cleanup } = await createTempRepo({
    'src/blank.ts': '\n   \n',
  });

  try {
    const runId = await startIngest(
      { path: root, name: 'blank-repo', model: 'embed-model' },
      buildIngestDeps(),
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'error');
    assert.equal(roots.add.mock.calls.length, 0);
    assert.equal(vectors.add.mock.calls.length, 0);
    assert.equal(ingestFileBulkWrite.mock.calls.length, 0);
    const entries = query({
      text: 'DEV-0000046:T5:fresh-ingest-zero-embeddable',
    });
    assert.ok(entries.length > 0, 'expected Task 5 verification log');
  } finally {
    await cleanup();
  }
});

test('fresh ingest with valid and blank files succeeds while embedding only valid chunks', async () => {
  const { roots, vectors } = setupIngestChromaMocks();
  const deps = buildIngestDeps();
  const { root, cleanup } = await createTempRepo({
    'src/blank.ts': '   \n\n',
    'src/valid.ts': 'export function keepMe() { return 1; }\n',
  });

  try {
    const runId = await startIngest(
      { path: root, name: 'mixed-repo', model: 'embed-model' },
      deps,
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'completed');
    assert.equal(status.counts.files, 2);
    assert.ok(status.counts.chunks > 0);
    assert.ok(status.counts.embedded > 0);
    assert.equal(deps.getEmbedCalls(), status.counts.embedded);
    assert.equal(vectors.add.mock.calls.length, 1);
    assert.equal(roots.add.mock.calls.length, 1);
  } finally {
    await cleanup();
  }
});
