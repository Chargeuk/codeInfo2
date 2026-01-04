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
  type DataTable,
  setDefaultTimeout,
} from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import type { Metadata } from 'chromadb';
import cors from 'cors';
import express from 'express';
import {
  clearLockedModel,
  clearRootsCollection,
  clearVectorsCollection,
  getRootsCollection,
  getVectorsCollection,
} from '../../ingest/chromaClient.js';
import { discoverFiles } from '../../ingest/discovery.js';
import { hashFile } from '../../ingest/hashing.js';
import { resolveConfig } from '../../ingest/config.js';
import { setIngestDeps } from '../../ingest/ingestJob.js';
import { createRequestLogger } from '../../logger.js';
import { isMongoConnected } from '../../mongo/connection.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
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
let lastStatus: { state?: string; message?: string } | null = null;

const originalHashesByRelPath = new Map<string, string>();
const previousHashesByRelPath = new Map<string, string>();
let rememberedVectorCount: number | null = null;
let rememberedRunId: string | null = null;

async function ensureTempDir() {
  if (tempDir) return tempDir;
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-delta-'));
  return tempDir;
}

async function vectorIdsFor(where: Record<string, unknown>) {
  const vectors = await getVectorsCollection();
  const getter = vectors as unknown as {
    get: (opts: {
      where?: Record<string, unknown>;
      include?: string[];
    }) => Promise<{ ids?: string[]; metadatas?: Record<string, unknown>[] }>;
  };
  const raw = await getter.get({ where, include: ['metadatas'] });
  return { ids: raw.ids ?? [], metadatas: raw.metadatas ?? [] };
}

async function vectorCountForRoot(root: string) {
  const raw = await vectorIdsFor({ root });
  return raw.ids.length;
}

Before(async () => {
  setDefaultTimeout(60_000);
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
  app.use('/', createIngestRootsRouter());

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
  lastStatus = null;
  rememberedVectorCount = null;
  rememberedRunId = null;
  originalHashesByRelPath.clear();
  previousHashesByRelPath.clear();
  await clearRootsCollection();
  await clearVectorsCollection();
  await clearLockedModel();
});

Given(
  'the ingest delta test server is running with chroma and lmstudio',
  () => {
    assert(server, 'server missing');
    assert(baseUrl, 'baseUrl missing');
  },
);

Given('ingest delta chroma stores are empty', async () => {
  await clearRootsCollection();
  await clearVectorsCollection();
  await clearLockedModel();
});

Given('ingest delta models scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

Given(
  'ingest delta temp repo with file {string} containing {string}',
  async (rel: string, content: string) => {
    const dir = await ensureTempDir();
    const filePath = path.join(dir, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    const fileHash = await hashFile(filePath);
    originalHashesByRelPath.set(rel, fileHash);
  },
);

When(
  'I POST ingest start for the delta repo with model {string}',
  async (model: string) => {
    const dir = await ensureTempDir();
    const res = await fetch(`${baseUrl}/ingest/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: dir, name: 'tmp', model }),
    });
    const body = (await res.json()) as { runId?: string };
    if (res.status === 202) {
      lastRunId = body.runId ?? null;
    }
  },
);

When('I POST ingest reembed for the delta repo', async () => {
  assert(tempDir, 'temp dir missing');
  const res = await fetch(
    `${baseUrl}/ingest/reembed/${encodeURIComponent(tempDir)}`,
    { method: 'POST' },
  );
  const body = (await res.json()) as { runId?: string };
  if (res.status === 202) {
    lastRunId = body.runId ?? null;
  }
});

When(
  'I change ingest delta temp file {string} to {string}',
  async (rel: string, content: string) => {
    assert(tempDir, 'temp dir missing');
    const filePath = path.join(tempDir, rel);
    const before = await hashFile(filePath);
    previousHashesByRelPath.set(rel, before);
    await fs.writeFile(filePath, content);
  },
);

When(
  'I add ingest delta temp file {string} containing {string}',
  async (rel: string, content: string) => {
    const dir = await ensureTempDir();
    const filePath = path.join(dir, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    const fileHash = await hashFile(filePath);
    originalHashesByRelPath.set(rel, fileHash);
  },
);

When('I delete ingest delta temp file {string}', async (rel: string) => {
  assert(tempDir, 'temp dir missing');
  const filePath = path.join(tempDir, rel);
  const before = await hashFile(filePath);
  previousHashesByRelPath.set(rel, before);
  await fs.rm(filePath, { force: true });
});

When('I remember ingest delta vector count for the delta repo', async () => {
  assert(tempDir, 'temp dir missing');
  rememberedVectorCount = await vectorCountForRoot(tempDir);
});

Then(
  'ingest delta vector count for the delta repo should be unchanged',
  async () => {
    assert(tempDir, 'temp dir missing');
    assert(
      typeof rememberedVectorCount === 'number',
      'missing remembered count',
    );
    const after = await vectorCountForRoot(tempDir);
    assert.equal(after, rememberedVectorCount);
  },
);

Then(
  'ingest delta status for the last run becomes {string}',
  async (state: string) => {
    assert(lastRunId, 'runId missing');
    for (let i = 0; i < 120; i += 1) {
      const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
      const body = (await res.json()) as { state?: string; message?: string };
      lastStatus = body;
      if (body.state === state || body.state === 'error') return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`did not reach state ${state}`);
  },
);

Then(
  'ingest delta vectors for {string} should not contain the previous hash',
  async (rel: string) => {
    assert(tempDir, 'temp dir missing');
    const oldHash = previousHashesByRelPath.get(rel);
    assert(oldHash, 'previous hash missing');
    const raw = await vectorIdsFor({
      $and: [{ root: tempDir }, { relPath: rel }, { fileHash: oldHash }],
    });
    assert.equal(raw.ids.length, 0);
  },
);

Then(
  'ingest delta vectors for {string} should contain the current hash',
  async (rel: string) => {
    assert(tempDir, 'temp dir missing');
    const filePath = path.join(tempDir, rel);
    const hash = await hashFile(filePath);
    const raw = await vectorIdsFor({
      $and: [{ root: tempDir }, { relPath: rel }, { fileHash: hash }],
    });
    assert(raw.ids.length > 0, `expected vectors for ${rel} with hash ${hash}`);
  },
);

Then(
  'ingest delta vectors for {string} should be absent',
  async (rel: string) => {
    assert(tempDir, 'temp dir missing');
    const raw = await vectorIdsFor({
      $and: [{ root: tempDir }, { relPath: rel }],
    });
    assert.equal(raw.ids.length, 0);
  },
);

Then(
  'ingest delta ingest_files row for {string} should equal the current hash',
  async (rel: string) => {
    assert(tempDir, 'temp dir missing');
    assert(isMongoConnected(), 'mongo should be connected for this step');
    const filePath = path.join(tempDir, rel);
    const expected = await hashFile(filePath);
    const row = await IngestFileModel.findOne({ root: tempDir, relPath: rel })
      .lean()
      .exec();
    assert(row, 'missing ingest_files row');
    assert.equal((row as { fileHash?: string }).fileHash, expected);
  },
);

Then(
  'ingest delta ingest_files row for {string} should be absent',
  async (rel: string) => {
    assert(tempDir, 'temp dir missing');
    assert(isMongoConnected(), 'mongo should be connected for this step');
    const row = await IngestFileModel.findOne({ root: tempDir, relPath: rel })
      .lean()
      .exec();
    assert.equal(row, null);
  },
);

Then(
  'ingest delta vectors for {string} should contain its original hash',
  async (rel: string) => {
    assert(tempDir, 'temp dir missing');
    const original = originalHashesByRelPath.get(rel);
    assert(original, 'missing original hash');
    const raw = await vectorIdsFor({
      $and: [{ root: tempDir }, { relPath: rel }, { fileHash: original }],
    });
    assert(
      raw.ids.length > 0,
      `expected vectors for ${rel} with original hash`,
    );
  },
);

Then(
  'ingest delta ingest_files row for {string} should equal its original hash',
  async (rel: string) => {
    assert(tempDir, 'temp dir missing');
    assert(isMongoConnected(), 'mongo should be connected for this step');
    const original = originalHashesByRelPath.get(rel);
    assert(original, 'missing original hash');
    const row = await IngestFileModel.findOne({ root: tempDir, relPath: rel })
      .lean()
      .exec();
    assert(row, 'missing ingest_files row');
    assert.equal((row as { fileHash?: string }).fileHash, original);
  },
);

Then(
  'ingest delta discovery for the delta repo should find 0 eligible files',
  async () => {
    assert(tempDir, 'temp dir missing');
    const cfg = resolveConfig();
    const result = await discoverFiles(tempDir, cfg);
    assert.equal(result.files.length, 0);
  },
);

Then('ingest delta last status message should mention no changes', () => {
  assert(lastStatus, 'missing last status');
  const message = String(lastStatus.message ?? '');
  assert(message.length > 0, 'message should not be empty');
  assert(
    /no changes/i.test(message),
    `expected "no changes" in message: ${message}`,
  );
});

Then(
  'ingest delta last status message should not be {string}',
  (text: string) => {
    assert(lastStatus, 'missing last status');
    assert.notEqual(lastStatus.message, text);
  },
);

Then('ingest delta mongo should be disconnected', () => {
  assert.equal(isMongoConnected(), false);
});

Then('I remember the ingest delta runId', () => {
  assert(lastRunId, 'runId missing');
  rememberedRunId = lastRunId;
});

Then('I delete all ingest_files rows for the delta repo root', async () => {
  assert(tempDir, 'temp dir missing');
  assert(isMongoConnected(), 'mongo should be connected for this step');
  await IngestFileModel.deleteMany({ root: tempDir }).exec();
});

Then(
  'ingest delta vectors should not contain any vectors from the remembered runId',
  async () => {
    assert(rememberedRunId, 'missing remembered runId');
    const raw = await vectorIdsFor({ runId: rememberedRunId });
    assert.equal(raw.ids.length, 0);
  },
);

Then(
  'ingest delta ingest_files should be populated for all discovered files',
  async () => {
    assert(tempDir, 'temp dir missing');
    assert(isMongoConnected(), 'mongo should be connected for this step');
    const cfg = resolveConfig();
    const discovered = await discoverFiles(tempDir, cfg);
    const relPaths = discovered.files.map((f) => f.relPath).sort();

    const rows = (await IngestFileModel.find({ root: tempDir })
      .select({ _id: 0, relPath: 1, fileHash: 1 })
      .lean()
      .exec()) as { relPath: string; fileHash: string }[];
    const rowPaths = rows.map((r) => r.relPath).sort();
    assert.deepEqual(rowPaths, relPaths);

    for (const relPath of relPaths) {
      const expectedHash = await hashFile(path.join(tempDir, relPath));
      const row = rows.find((r) => r.relPath === relPath);
      assert(row, `missing ingest_files row for ${relPath}`);
      assert.equal(row.fileHash, expectedHash);
    }
  },
);

Given(
  'ingest delta roots collection contains duplicate metadata for the delta repo root:',
  async (table: DataTable) => {
    assert(tempDir, 'temp dir missing');
    const rows = table.hashes() as { lastIngestAt: string; name: string }[];
    assert.equal(rows.length, 2, 'expected 2 rows');

    const roots = await getRootsCollection();
    const metadatas: Metadata[] = rows.map((row) => ({
      runId: row.name === 'new-name' ? 'r2' : 'r1',
      root: tempDir,
      name: row.name,
      model: 'embed-1',
      files: 1,
      chunks: 1,
      embedded: 1,
      state: 'completed',
      lastIngestAt: row.lastIngestAt,
      ingestedAtMs: 1,
    }));

    await roots.add({
      ids: ['r1', 'r2'],
      embeddings: [Array(1).fill(0), Array(1).fill(0)],
      metadatas,
    });
  },
);

Then(
  'ingest roots for the delta repo should have name {string}',
  async (expectedName: string) => {
    assert(tempDir, 'temp dir missing');
    const res = await fetch(`${baseUrl}/ingest/roots`);
    const body = (await res.json()) as {
      roots?: { path?: string; name?: string }[];
    };
    const roots = body.roots ?? [];
    const match = roots.find((r) => r.path === tempDir);
    assert(match, 'missing roots entry');
    assert.equal(match.name, expectedName);
  },
);
