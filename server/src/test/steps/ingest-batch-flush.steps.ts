import '../support/chromaContainer.js';
import '../support/mockLmStudioSdk.js';
import assert from 'assert';
import fs from 'fs/promises';
import type { Server } from 'http';
import os from 'os';
import path from 'path';
import {
  After,
  Before,
  Given,
  Then,
  When,
  setDefaultTimeout,
} from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import '../support/chromaContainer.js';
import '../support/mockLmStudioSdk.js';
import { getVectorsCollection } from '../../ingest/chromaClient.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import {
  MockLMStudioClient,
  type MockScenario,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';

let server: Server | null = null;
let baseUrl = '';
let tempDir: string | null = null;
let lastRunId: string | null = null;
let previousLmStudioUrl: string | undefined;
let previousFlushEvery: string | undefined;

setDefaultTimeout(20000);

async function startTestServer() {
  previousLmStudioUrl = process.env.LMSTUDIO_BASE_URL;
  previousFlushEvery = process.env.INGEST_FLUSH_EVERY;

  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';
  process.env.INGEST_FLUSH_EVERY = '1';

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(createRequestLogger());

  app.use(
    '/',
    createIngestStartRouter({
      clientFactory: () =>
        new MockLMStudioClient() as unknown as LMStudioClient,
    }),
  );

  await new Promise<void>((resolve) => {
    const listener = app.listen(0, () => {
      server = listener;
      const address = listener.address();
      if (!address || typeof address === 'string') {
        throw new Error('Unable to start test server');
      }
      baseUrl = `http://localhost:${address.port}`;
      resolve();
    });
  });
}

Before({ tags: '@batch-flush' }, async () => {
  startMock({ scenario: 'many' as MockScenario });
  await startTestServer();
});

After({ tags: '@batch-flush' }, async () => {
  stopMock();
  if (server) {
    server.close();
    server = null;
  }
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  lastRunId = null;

  if (previousFlushEvery === undefined) delete process.env.INGEST_FLUSH_EVERY;
  else process.env.INGEST_FLUSH_EVERY = previousFlushEvery;

  if (previousLmStudioUrl === undefined) delete process.env.LMSTUDIO_BASE_URL;
  else process.env.LMSTUDIO_BASE_URL = previousLmStudioUrl;
});

Given('a batch flush temp repo with {int} files', async (count: number) => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-batch-'));
  for (let i = 0; i < count; i += 1) {
    const filePath = path.join(tempDir, `file-${i}.txt`);
    await fs.writeFile(filePath, `file ${i} content ${'x'.repeat(10)}`);
  }
});

When('I start a batch flush ingest run', async () => {
  assert(tempDir, 'tempDir missing');
  const res = await fetch(`${baseUrl}/ingest/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: tempDir, name: 'batch', model: 'embed-1' }),
  });
  const body = await res.json();
  assert.equal(res.status, 202, `Unexpected status ${res.status}`);
  lastRunId = body.runId as string;
});

Then(
  'the batch flush run completes with state {string}',
  async (state: string) => {
    assert(lastRunId, 'runId missing');
    for (let i = 0; i < 60; i += 1) {
      const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
      const body = await res.json();
      if (body.state === state) return;
      if (body.state === 'error' && state !== 'error') {
        throw new Error(`Run ended in error: ${body.lastError}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`did not reach state ${state}`);
  },
);

Then(
  'the vectors add calls should be at least {int}',
  async (expected: number) => {
    const vectors = (await getVectorsCollection()) as unknown as {
      addCalls?: number;
      embeddings?: number[][];
      count?: () => Promise<number>;
    };
    if (typeof vectors.addCalls === 'number') {
      assert(
        vectors.addCalls >= expected,
        `addCalls ${vectors.addCalls} < ${expected}`,
      );
      return;
    }

    const totalEmbeddings = vectors.embeddings?.length ?? 0;
    if (totalEmbeddings >= expected) return;

    if (typeof vectors.count === 'function') {
      const count = await vectors.count();
      assert(count >= expected, `vector count ${count} < ${expected}`);
      return;
    }

    assert(false, 'Unable to determine vector count for batch flush assertion');
  },
);

Then(
  'the vectors embedding count should be at least {int}',
  async (min: number) => {
    const vectors = (await getVectorsCollection()) as unknown as {
      embeddings?: number[][];
      count?: () => Promise<number>;
    };
    if (vectors.embeddings) {
      assert(
        (vectors.embeddings as number[][]).length >= min,
        `embeddings count ${(vectors.embeddings as number[][]).length} < ${min}`,
      );
      return;
    }

    if (typeof vectors.count === 'function') {
      const count = await vectors.count();
      assert(count >= min, `vector count ${count} < ${min}`);
      return;
    }

    assert(false, 'embeddings missing');
  },
);
