import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { startFlowRun } from '../../flows/service.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import { withIsolatedProviderHomeTestEnv } from '../support/providerHomeHarness.js';
import { bindCurrentTestOverrides } from '../support/testOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows',
);

const buildRepoEntry = (containerPath: string): RepoEntry => ({
  id: path.posix.basename(containerPath.replace(/\\/g, '/')) || 'repo',
  description: null,
  containerPath,
  hostPath: containerPath,
  lastIngestAt: null,
  embeddingProvider: 'lmstudio',
  embeddingModel: 'model',
  embeddingDimensions: 768,
  model: 'model',
  modelId: 'model',
  lock: {
    embeddingProvider: 'lmstudio',
    embeddingModel: 'model',
    embeddingDimensions: 768,
    lockedModelId: 'model',
    modelId: 'model',
  },
  counts: { files: 0, chunks: 0, embedded: 0 },
  lastError: null,
});

class CapturingChat extends ChatInterface {
  constructor(private readonly onMessage: (message: string) => void) {
    super();
  }

  async execute(
    message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    this.onMessage(message);
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const started = Date.now();
  while (Date.now() - started < resolvedTimeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition');
};

beforeEach(() => {
  installDeterministicCodexAvailabilityBootstrap();
});

afterEach(() => {
  resetDeterministicCodexAvailabilityBootstrap();
});

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const withFlowFixtureEnv = async (tmpDir: string, run: () => Promise<void>) =>
  await withIsolatedProviderHomeTestEnv(
    {
      prefix: 'flow-hot-reload-provider-homes-',
      overrides: {
        CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
        FLOWS_DIR: tmpDir,
      },
    },
    async () => await run(),
  );

test('Flow run reloads flow file between runs', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-reload-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });

  const observedMessages: string[] = [];
  let nextMessageResolver: (() => void) | null = null;

  const chatFactory = () =>
    new CapturingChat((message) => {
      observedMessages.push(message);
      if (nextMessageResolver) nextMessageResolver();
    });

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      const app = express();
      app.use(
        createFlowsRunRouter({
          startFlowRun: bindCurrentTestOverrides((params) =>
            startFlowRun({
              ...params,
              chatFactory,
            }),
          ),
        }),
      );
      nextMessageResolver = null;
      const firstMessagePromise = new Promise<void>((resolve) => {
        nextMessageResolver = resolve;
      });

      await supertest(app).post('/flows/hot-reload/run').send({});
      await firstMessagePromise;
      await waitFor(() => observedMessages.length >= 1);
      assert.equal(observedMessages[0], 'First run');

      const updatedFlow = {
        description: 'Hot reload flow',
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'reload',
            messages: [{ role: 'user', content: ['Updated run'] }],
          },
        ],
      };
      await fs.writeFile(
        path.join(tmpDir, 'hot-reload.json'),
        JSON.stringify(updatedFlow, null, 2),
        'utf8',
      );

      nextMessageResolver = null;
      const secondMessagePromise = new Promise<void>((resolve) => {
        nextMessageResolver = resolve;
      });
      await supertest(app).post('/flows/hot-reload/run').send({});
      await secondMessagePromise;
      await waitFor(() => observedMessages.length >= 2);
      assert.equal(observedMessages[1], 'Updated run');
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Flow run returns 404 when ingested flow file is missing', async () => {
  const tmpLocalDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-local-ingest-missing-'),
  );
  const tmpRepoRoot = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-ingest-missing-'),
  );
  await fs.mkdir(path.join(tmpRepoRoot, 'flows'), { recursive: true });

  try {
    await withFlowFixtureEnv(tmpLocalDir, async () => {
      const app = express();
      app.use(
        createFlowsRunRouter({
          startFlowRun: bindCurrentTestOverrides((params) =>
            startFlowRun({
              ...params,
              chatFactory: () => new CapturingChat(() => undefined),
              listIngestedRepositories: async () => ({
                repos: [buildRepoEntry(tmpRepoRoot)],
                lockedModelId: null,
              }),
            }),
          ),
        }),
      );
      await supertest(app)
        .post('/flows/missing-ingested/run')
        .send({ sourceId: tmpRepoRoot })
        .expect(404);
    });
  } finally {
    await fs.rm(tmpLocalDir, { recursive: true, force: true });
    await fs.rm(tmpRepoRoot, { recursive: true, force: true });
  }
});
