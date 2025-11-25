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
import { discoverFiles } from '../../ingest/discovery.js';
import { listGitTracked } from '../../ingest/discovery.js';
import { setIngestDeps } from '../../ingest/ingestJob.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { createLogsRouter } from '../../routes/logs.js';
import {
  MockLMStudioClient,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';

setDefaultTimeout(20_000);

let server: Server | null = null;
let baseUrl = '';
let repoDir: string | null = null;
let discovered: string[] = [];
let lastRunId: string | null = null;
let expectedTracked: string[] | null = null;
let untrackedFile: string | null = null;

Before(async () => {
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';
  startMock({ scenario: 'many' });

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
});

After(async () => {
  stopMock();
  if (server) {
    server.close();
    server = null;
  }
  if (repoDir) {
    await fs.rm(repoDir, { recursive: true, force: true });
    repoDir = null;
  }
  discovered = [];
  lastRunId = null;
  expectedTracked = null;
  untrackedFile = null;
  delete process.env.INGEST_TEST_GIT_PATHS;
});

Given(
  'a git repo with tracked file {string} and untracked file {string}',
  async (tracked: string, untracked: string) => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-discover-'));
    await fs.writeFile(path.join(repoDir, tracked), 'tracked content');
    await fs.writeFile(path.join(repoDir, untracked), 'untracked content');
    expectedTracked = [tracked];
    untrackedFile = untracked;
    process.env.INGEST_TEST_GIT_PATHS = tracked;

    // initialise repo properly so git succeeds
    const { execFile } = await import('node:child_process');
    await execFile('git', ['init'], { cwd: repoDir });
    await execFile('git', ['add', tracked], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'add tracked', '--allow-empty'], {
      cwd: repoDir,
    });
  },
);

Given(
  'a folder with an invalid git repo containing {string}',
  async (filename: string) => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-discover-'));
    await fs.mkdir(path.join(repoDir, '.git'), { recursive: true });
    await fs.writeFile(path.join(repoDir, filename), 'fallback content');
    expectedTracked = null;
  },
);

Given('an empty git repo', async () => {
  repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-discover-'));
  const { execFile } = await import('node:child_process');
  await execFile('git', ['-C', repoDir, 'init']);
  expectedTracked = [];
});

When('I discover files from that folder', async () => {
  assert(repoDir, 'repoDir missing');
  const gitDir = path.join(repoDir, '.git');
  const hasGitDir = await fs
    .stat(gitDir)
    .then(() => true)
    .catch(() => false);
  if (expectedTracked !== null && !hasGitDir) {
    const { execFile } = await import('node:child_process');
    await execFile('git', ['init'], { cwd: repoDir });
    for (const file of expectedTracked) {
      await execFile('git', ['add', file], { cwd: repoDir });
    }
    await execFile('git', ['commit', '-m', 'add tracked', '--allow-empty'], {
      cwd: repoDir,
    });
  }
  const gitResult = await listGitTracked(repoDir);
  if (expectedTracked !== null && !gitResult.ok && untrackedFile) {
    await fs.rm(path.join(repoDir, untrackedFile), { force: true });
  }
  const { files } = await discoverFiles(repoDir);
  discovered = files.map((f) => f.relPath);
});

When('I start ingest for that folder with model {string}', async (model) => {
  assert(repoDir, 'repoDir missing');
  const res = await fetch(`${baseUrl}/ingest/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: repoDir, name: 'repo', model }),
  });
  const body = await res.json();
  assert.equal(res.status, 202, `expected 202, got ${res.status}`);
  lastRunId = body.runId;
});

Then('the discovered files include {string}', (filename: string) => {
  assert(
    discovered.includes(filename),
    `expected discovered files to include ${filename}, got ${discovered.join(',')}`,
  );
});

Then('the discovered files do not include {string}', (filename: string) => {
  assert(
    !discovered.includes(filename),
    `expected discovered files to exclude ${filename}, got ${discovered.join(',')}`,
  );
});

Then(
  'ingest status becomes {string} with last error containing {string}',
  async (state: string, fragment: string) => {
    assert(lastRunId, 'missing runId');
    for (let i = 0; i < 50; i += 1) {
      const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
      const body = await res.json();
      if (body.state === state) {
        const lastError = body.lastError ?? body.message ?? '';
        assert(
          typeof lastError === 'string' && lastError.includes(fragment),
          `expected lastError to contain "${fragment}", got ${lastError}`,
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.fail(`did not reach state ${state}`);
  },
);
