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
import { clearLockedModel } from '../../ingest/chromaClient.js';
import { setIngestDeps } from '../../ingest/ingestJob.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import {
  MockLMStudioClient,
  startMock,
  stopMock,
  type MockScenario,
} from '../support/mockLmStudioSdk.js';

setDefaultTimeout(10000);

let server: Server | null = null;
let baseUrl = '';
let lastRunId: string | null = null;
let tempDir: string | null = null;
let expectedFiles = 0;

Before(async () => {
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(createRequestLogger());

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
  lastRunId = null;
  expectedFiles = 0;
  await clearLockedModel();
});

Given('ingest status models scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

Given('temp repo for ingest status with {int} files', async (count: number) => {
  expectedFiles = count;
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-status-'));
  for (let i = 0; i < count; i += 1) {
    const rel = `file-${i + 1}.txt`;
    const filePath = path.join(tempDir, rel);
    await fs.writeFile(filePath, `content ${i}`);
  }
});

When(
  'I POST ingest start for status with model {string}',
  async (model: string) => {
    if (!tempDir) {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-status-'));
      expectedFiles = 1;
      await fs.writeFile(path.join(tempDir, 'file-1.txt'), 'content');
    }

    const res = await fetch(`${baseUrl}/ingest/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: tempDir, name: 'tmp', model }),
    });

    const body = (await res.json()) as { runId?: string };
    if (res.status !== 202) {
      assert.fail(`ingest start failed with ${res.status}`);
    }
    lastRunId = body.runId ?? null;
    assert.ok(lastRunId, 'runId missing from ingest start');
  },
);

Then(
  'ingest status eventually includes progress fields for {int} files',
  async (expected: number) => {
    assert.equal(expected, expectedFiles);
    assert(lastRunId, 'runId missing');

    let snapshot: Record<string, unknown> | null = null;

    for (let i = 0; i < 50; i += 1) {
      const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
      const body = (await res.json()) as Record<string, unknown>;

      if (body.state === 'error') {
        assert.fail(
          `ingest errored: ${(body.lastError as string) ?? body.message}`,
        );
      }

      const hasFields =
        typeof body.fileTotal === 'number' &&
        typeof body.fileIndex === 'number' &&
        typeof body.percent === 'number' &&
        typeof body.currentFile === 'string' &&
        (body.currentFile as string).length > 0;

      if (hasFields) {
        snapshot = body;
        break;
      }

      await new Promise((r) => setTimeout(r, 100));
    }

    assert(snapshot, 'expected status snapshot with progress fields');

    assert.equal(snapshot?.fileTotal, expectedFiles);
    const fileIndex = snapshot?.fileIndex as number;
    const fileTotal = snapshot?.fileTotal as number;
    const percent = snapshot?.percent as number;
    const expectedPercent = Number(((fileIndex / fileTotal) * 100).toFixed(1));
    assert.equal(percent, expectedPercent);
    assert.equal(typeof snapshot?.currentFile, 'string');
    assert.ok(
      (snapshot?.currentFile as string).includes('file-'),
      'expected currentFile to include file name',
    );
    assert.equal(
      snapshot?.etaMs === undefined || typeof snapshot?.etaMs === 'number',
      true,
    );
  },
);
