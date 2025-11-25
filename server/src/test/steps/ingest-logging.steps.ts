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
import { setIngestDeps } from '../../ingest/ingestJob.js';
import { resetStore } from '../../logStore.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';
import { createIngestRemoveRouter } from '../../routes/ingestRemove.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { createLogsRouter } from '../../routes/logs.js';
import {
  MockLMStudioClient,
  type MockScenario,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';

let server: Server | null = null;
let baseUrl = '';
let lastRunId: string | null = null;
let tempDir: string | null = null;

setDefaultTimeout(20000);

async function startTestServer() {
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(createRequestLogger());
  app.use((req, res, next) => {
    const requestId = (req as unknown as { id?: string }).id;
    if (requestId) res.locals.requestId = requestId;
    next();
  });

  setIngestDeps({
    lmClientFactory: () =>
      new MockLMStudioClient() as unknown as LMStudioClient,
    baseUrl: process.env.LMSTUDIO_BASE_URL ?? '',
  });

  app.use(
    '/',
    createIngestStartRouter({
      clientFactory: () =>
        new MockLMStudioClient() as unknown as LMStudioClient,
    }),
  );
  app.use(
    '/',
    createIngestReembedRouter({
      clientFactory: () =>
        new MockLMStudioClient() as unknown as LMStudioClient,
    }),
  );
  app.use('/', createIngestRemoveRouter());
  app.use('/', createIngestRootsRouter());
  app.use('/logs', createLogsRouter());

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

Before(async () => {
  resetStore();
  startMock({ scenario: 'many' as MockScenario });
  await startTestServer();
});

After(async () => {
  stopMock();
  if (server) {
    server.close();
    server = null;
  }
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  resetStore();
});

Given('an ingest logging test server', () => {});

Given(
  'logging temp repo with file {string} containing {string}',
  async (rel, content) => {
    if (!tempDir) {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-logging-'));
    }
    const filePath = path.join(tempDir, rel as string);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content as string);
  },
);

Given('an empty logging temp repo', async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-logging-'));
});

When(
  'I POST ingest logging start with model {string}',
  async (model: string) => {
    assert(tempDir, 'tempDir missing');
    const res = await fetch(`${baseUrl}/ingest/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: tempDir, name: 'tmp', model }),
    });
    const body = await res.json();
    if (res.status === 202) {
      lastRunId = body.runId as string;
    }
  },
);

When('I POST ingest logging reembed for the last root', async () => {
  assert(tempDir, 'tempDir missing');
  const res = await fetch(
    `${baseUrl}/ingest/reembed/${encodeURIComponent(tempDir)}`,
    {
      method: 'POST',
    },
  );
  const body = await res.json();
  if (res.status === 202) {
    lastRunId = body.runId as string;
  } else {
    throw new Error(`reembed failed ${res.status} ${JSON.stringify(body)}`);
  }
});

When('I POST ingest logging remove for the last root', async () => {
  assert(tempDir, 'tempDir missing');
  const res = await fetch(
    `${baseUrl}/ingest/remove/${encodeURIComponent(tempDir)}`,
    {
      method: 'POST',
    },
  );
  assert.equal(res.status, 200);
});

When(
  'I delete the file {string} from the logging temp repo',
  async (rel: string) => {
    assert(tempDir, 'tempDir missing');
    await fs.rm(path.join(tempDir, rel), { force: true });
  },
);

Then(
  'ingest logging status for the last run becomes {string}',
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

async function fetchLogsByText(text: string) {
  const res = await fetch(
    `${baseUrl}/logs?text=${encodeURIComponent(text)}&limit=50`,
  );
  const body = await res.json();
  return body.items as Array<{
    level: string;
    context?: Record<string, unknown>;
  }>;
}

Then(
  'logs for the last run contain state {string} and level {string}',
  async (state: string, level: string) => {
    assert(lastRunId, 'runId missing');
    for (let i = 0; i < 20; i += 1) {
      const items = await fetchLogsByText(lastRunId);
      const match = items.find(
        (item) =>
          item.level === level && (item.context?.state as string) === state,
      );
      if (match) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`No log entry with state ${state} and level ${level}`);
  },
);

Then(
  'logs for the last action contain "remove" entries at level {string}',
  async (level: string) => {
    assert(tempDir, 'tempDir missing');
    for (let i = 0; i < 20; i += 1) {
      const items = await fetchLogsByText(tempDir);
      const match = items.find(
        (item) =>
          item.level === level &&
          typeof item.context?.operation === 'string' &&
          (item.context?.operation as string).includes('remove'),
      );
      if (match) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail('No remove log entry found');
  },
);
