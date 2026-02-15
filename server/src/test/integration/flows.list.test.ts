import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';

import type { RepoEntry } from '../../lmstudio/toolService.js';
import { createFlowsRouter } from '../../routes/flows.js';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows',
);

const buildRepoEntry = (params: {
  id: string;
  containerPath: string;
}): RepoEntry => ({
  id: params.id,
  description: null,
  containerPath: params.containerPath,
  hostPath: params.containerPath,
  lastIngestAt: null,
  modelId: 'model-1',
  counts: { files: 0, chunks: 0, embedded: 0 },
  lastError: null,
});

const flowTemplate = (description: string) =>
  JSON.stringify({
    description,
    steps: [
      {
        type: 'llm',
        agentType: 'coding_agent',
        identifier: 'main',
        messages: [{ role: 'user', content: ['Hello'] }],
      },
    ],
  });

const writeFlowFile = async (
  dir: string,
  name: string,
  description: string,
) => {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${name}.json`),
    flowTemplate(description),
    'utf-8',
  );
};

const withFlowsDir = async (dir: string, run: () => Promise<void>) => {
  const prevFlowsDir = process.env.FLOWS_DIR;
  process.env.FLOWS_DIR = dir;
  try {
    await run();
  } finally {
    if (prevFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = prevFlowsDir;
    }
  }
};

const buildApp = (params?: {
  listIngestedRepositories?: () => Promise<{
    repos: RepoEntry[];
    lockedModelId: string | null;
  }>;
}) => {
  const app = express();
  app.use(
    createFlowsRouter({
      listIngestedRepositories: params?.listIngestedRepositories,
    }),
  );
  return app;
};

describe('GET /flows', () => {
  test('missing flows folder returns empty list', async () => {
    const missingDir = path.join(process.cwd(), 'tmp-flows-missing');
    await fs.rm(missingDir, { recursive: true, force: true });
    await withFlowsDir(missingDir, async () => {
      const response = await supertest(buildApp()).get('/flows');

      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { flows: [] });
    });
  });

  test('lists flows with disabled/error states for invalid entries', async () => {
    const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-'));
    await fs.cp(fixturesDir, tmpDir, { recursive: true });
    await withFlowsDir(tmpDir, async () => {
      const response = await supertest(buildApp()).get('/flows');

      assert.equal(response.status, 200);
      const names = response.body.flows.map(
        (flow: { name: string }) => flow.name,
      );
      assert.deepEqual(names, [
        'command-step',
        'hot-reload',
        'invalid-json',
        'invalid-schema',
        'llm-basic',
        'loop-break',
        'multi-agent',
        'valid-flow',
      ]);

      const invalidJson = response.body.flows.find(
        (flow: { name: string }) => flow.name === 'invalid-json',
      );
      assert.equal(invalidJson.disabled, true);
      assert.ok(invalidJson.error);

      const invalidSchema = response.body.flows.find(
        (flow: { name: string }) => flow.name === 'invalid-schema',
      );
      assert.equal(invalidSchema.disabled, true);
      assert.ok(invalidSchema.error);

      const valid = response.body.flows.find(
        (flow: { name: string }) => flow.name === 'valid-flow',
      );
      assert.equal(valid.disabled, false);
      assert.equal(valid.description, 'Valid flow');
    });

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('ingested flows include source metadata and sort by display label', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(process.cwd(), 'tmp-flows-local-'),
    );
    const ingestedRoot = await fs.mkdtemp(
      path.join(process.cwd(), 'tmp-flows-ingested-'),
    );
    await writeFlowFile(tmpDir, 'alpha', 'Alpha');
    await writeFlowFile(path.join(ingestedRoot, 'flows'), 'beta', 'Beta');

    await withFlowsDir(tmpDir, async () => {
      const response = await supertest(
        buildApp({
          listIngestedRepositories: async () => ({
            repos: [
              buildRepoEntry({ id: 'Repo A', containerPath: ingestedRoot }),
            ],
            lockedModelId: null,
          }),
        }),
      ).get('/flows');

      assert.equal(response.status, 200);
      const names = response.body.flows.map(
        (flow: { name: string; sourceLabel?: string }) =>
          flow.sourceLabel ? `${flow.name} - [${flow.sourceLabel}]` : flow.name,
      );
      assert.deepEqual(names, ['alpha', 'beta - [Repo A]']);

      const ingested = response.body.flows.find(
        (flow: { name: string }) => flow.name === 'beta',
      );
      assert.equal(ingested.sourceId, ingestedRoot);
      assert.equal(ingested.sourceLabel, 'Repo A');
    });

    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(ingestedRoot, { recursive: true, force: true });
  });

  test('local flows omit source metadata', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(process.cwd(), 'tmp-flows-local-'),
    );
    await writeFlowFile(tmpDir, 'local-flow', 'Local');

    await withFlowsDir(tmpDir, async () => {
      const response = await supertest(
        buildApp({
          listIngestedRepositories: async () => ({
            repos: [],
            lockedModelId: null,
          }),
        }),
      ).get('/flows');

      assert.equal(response.status, 200);
      const local = response.body.flows.find(
        (flow: { name: string }) => flow.name === 'local-flow',
      );
      assert.equal(Object.hasOwn(local, 'sourceId'), false);
      assert.equal(Object.hasOwn(local, 'sourceLabel'), false);
    });

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('ingested sourceLabel falls back to container basename', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(process.cwd(), 'tmp-flows-local-'),
    );
    const ingestedRoot = await fs.mkdtemp(
      path.join(process.cwd(), 'tmp-flows-repo-folder-'),
    );
    await writeFlowFile(path.join(ingestedRoot, 'flows'), 'release', 'Release');

    await withFlowsDir(tmpDir, async () => {
      const response = await supertest(
        buildApp({
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry({ id: '', containerPath: ingestedRoot })],
            lockedModelId: null,
          }),
        }),
      ).get('/flows');

      assert.equal(response.status, 200);
      const ingested = response.body.flows.find(
        (flow: { name: string }) => flow.name === 'release',
      );
      assert.equal(
        ingested.sourceLabel,
        path.posix.basename(ingestedRoot.replace(/\\/g, '/')),
      );
    });

    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(ingestedRoot, { recursive: true, force: true });
  });

  test('duplicate ingested flow names are retained and sorted by label', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(process.cwd(), 'tmp-flows-local-'),
    );
    const ingestedA = await fs.mkdtemp(
      path.join(process.cwd(), 'tmp-flows-ingested-a-'),
    );
    const ingestedB = await fs.mkdtemp(
      path.join(process.cwd(), 'tmp-flows-ingested-b-'),
    );
    await writeFlowFile(path.join(ingestedA, 'flows'), 'release', 'Release A');
    await writeFlowFile(path.join(ingestedB, 'flows'), 'release', 'Release B');

    await withFlowsDir(tmpDir, async () => {
      const response = await supertest(
        buildApp({
          listIngestedRepositories: async () => ({
            repos: [
              buildRepoEntry({ id: 'Alpha', containerPath: ingestedA }),
              buildRepoEntry({ id: 'Beta', containerPath: ingestedB }),
            ],
            lockedModelId: null,
          }),
        }),
      ).get('/flows');

      assert.equal(response.status, 200);
      const labels = response.body.flows.map(
        (flow: { name: string; sourceLabel?: string }) =>
          flow.sourceLabel ? `${flow.name} - [${flow.sourceLabel}]` : flow.name,
      );
      assert.deepEqual(labels, ['release - [Alpha]', 'release - [Beta]']);
    });

    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(ingestedA, { recursive: true, force: true });
    await fs.rm(ingestedB, { recursive: true, force: true });
  });

  test('missing ingest root directories are skipped and local flows still return', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(process.cwd(), 'tmp-flows-local-'),
    );
    await writeFlowFile(tmpDir, 'local', 'Local');

    await withFlowsDir(tmpDir, async () => {
      const response = await supertest(
        buildApp({
          listIngestedRepositories: async () => ({
            repos: [
              buildRepoEntry({
                id: 'Missing',
                containerPath: path.join(tmpDir, 'missing-root'),
              }),
            ],
            lockedModelId: null,
          }),
        }),
      ).get('/flows');

      assert.equal(response.status, 200);
      const names = response.body.flows.map(
        (flow: { name: string }) => flow.name,
      );
      assert.deepEqual(names, ['local']);
    });

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('ingest roots with no flows directory are skipped', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(process.cwd(), 'tmp-flows-local-'),
    );
    const ingestedRoot = await fs.mkdtemp(
      path.join(process.cwd(), 'tmp-flows-empty-'),
    );
    await writeFlowFile(tmpDir, 'local', 'Local');

    await withFlowsDir(tmpDir, async () => {
      const response = await supertest(
        buildApp({
          listIngestedRepositories: async () => ({
            repos: [
              buildRepoEntry({ id: 'Empty', containerPath: ingestedRoot }),
            ],
            lockedModelId: null,
          }),
        }),
      ).get('/flows');

      assert.equal(response.status, 200);
      const names = response.body.flows.map(
        (flow: { name: string }) => flow.name,
      );
      assert.deepEqual(names, ['local']);
    });

    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(ingestedRoot, { recursive: true, force: true });
  });

  test('ingest repository failures return local flows only', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(process.cwd(), 'tmp-flows-local-'),
    );
    await writeFlowFile(tmpDir, 'local', 'Local');

    await withFlowsDir(tmpDir, async () => {
      const response = await supertest(
        buildApp({
          listIngestedRepositories: async () => {
            throw new Error('boom');
          },
        }),
      ).get('/flows');

      assert.equal(response.status, 200);
      const names = response.body.flows.map(
        (flow: { name: string }) => flow.name,
      );
      assert.deepEqual(names, ['local']);
    });

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
