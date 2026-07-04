import '../support/chromaContainer.js';
import '../support/mockLmStudioSdk.js';
import assert from 'assert';
import fs from 'fs/promises';
import type { Server } from 'http';
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
import { resolveConfig } from '../../ingest/config.js';
import { discoverFiles } from '../../ingest/discovery.js';
import { hashFile } from '../../ingest/hashing.js';
import { setIngestDeps } from '../../ingest/ingestJob.js';
import { query, resetStore } from '../../logStore.js';
import { createRequestLogger } from '../../logger.js';
import { AstCoverageModel } from '../../mongo/astCoverage.js';
import { disconnectMongo, isMongoConnected } from '../../mongo/connection.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import { createIngestCancelRouter } from '../../routes/ingestCancel.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import {
  MockLMStudioClient,
  type MockScenario,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';
import { createTempRepoRoot } from '../support/tempRepoRoot.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

let server: Server | null = null;
let baseUrl = '';
let tempDir: string | null = null;
let lastRunId: string | null = null;
let lastStatus: { state?: string; message?: string } | null = null;
let lastResponse: { status: number; body: unknown } | null = null;

const originalHashesByRelPath = new Map<string, string>();
const previousHashesByRelPath = new Map<string, string>();
let rememberedVectorCount: number | null = null;
let rememberedRunId: string | null = null;
let rememberedAstCoverageTimestamp: string | null = null;

async function waitForIngestTerminalStateStability(
  poll: () => Promise<string>,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
    stabilityWindowMs?: number;
  },
) {
  const timeoutMs = resolveConfiguredTestTimeoutMs(options?.timeoutMs ?? 10_000);
  const intervalMs = options?.intervalMs ?? 100;
  const stabilityWindowMs = options?.stabilityWindowMs ?? 1_000;
  const startedAt = Date.now();
  let observedTerminal: string | null = null;
  let stableSince: number | null = null;
  const observedStates: string[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    const state = await poll();
    observedStates.push(state);

    if (!['completed', 'cancelled', 'error'].includes(state)) {
      observedTerminal = null;
      stableSince = null;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }

    if (!observedTerminal) {
      observedTerminal = state;
      stableSince = Date.now();
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }

    assert.equal(state, observedTerminal);

    if (stableSince !== null && Date.now() - stableSince >= stabilityWindowMs) {
      return { observedTerminal, observedStates, timeoutMs };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  assert.fail(
    `expected one terminal state to be observed within ${timeoutMs}ms; observed states=${observedStates.join(' -> ') || 'none'}`,
  );
}

function buildGeneratedRelPaths(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    path.posix.join(
      prefix,
      `generated-${String(index + 1).padStart(3, '0')}.md`,
    ),
  );
}

async function ensureTempDir() {
  if (tempDir) return tempDir;
  tempDir = await createTempRepoRoot('ingest-delta-');
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
  resetStore();
  process.env.CODEINFO_LMSTUDIO_BASE_URL = 'ws://localhost:1234';

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
    baseUrl: process.env.CODEINFO_LMSTUDIO_BASE_URL ?? '',
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
  app.use('/', createIngestCancelRouter());
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
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  lastRunId = null;
  lastStatus = null;
  lastResponse = null;
  rememberedVectorCount = null;
  rememberedRunId = null;
  rememberedAstCoverageTimestamp = null;
  originalHashesByRelPath.clear();
  previousHashesByRelPath.clear();
  resetStore();
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

Given(
  'ingest delta temp repo with {int} generated files under {string} containing {string}',
  async (count: number, prefix: string, content: string) => {
    const dir = await ensureTempDir();
    for (const rel of buildGeneratedRelPaths(prefix, count)) {
      const filePath = path.join(dir, rel);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
      const fileHash = await hashFile(filePath);
      originalHashesByRelPath.set(rel, fileHash);
    }
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
    lastResponse = { status: res.status, body };
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
  lastResponse = { status: res.status, body };
  if (res.status === 202) {
    lastRunId = body.runId ?? null;
  }
});

When('I POST ingest delta cancel for the last run', async () => {
  assert(lastRunId, 'runId missing');
  const res = await fetch(`${baseUrl}/ingest/cancel/${lastRunId}`, {
    method: 'POST',
  });
  assert.ok(
    res.status === 200 || res.status === 404,
    `unexpected cancel status ${res.status}`,
  );
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

When(
  'I delete {int} generated ingest delta temp files under {string}',
  async (count: number, prefix: string) => {
    assert(tempDir, 'temp dir missing');
    for (const rel of buildGeneratedRelPaths(prefix, count)) {
      const filePath = path.join(tempDir, rel);
      const before = await hashFile(filePath);
      previousHashesByRelPath.set(rel, before);
      await fs.rm(filePath, { force: true });
    }
  },
);

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
  { timeout: 60_000 },
  async (state: string) => {
    assert(lastRunId, 'runId missing');
    const deadline = Date.now() + 55_000;
    while (Date.now() < deadline) {
      const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
      const body = (await res.json()) as {
        state?: string;
        message?: string;
        lastError?: string | null;
        error?: {
          error?: string;
          message?: string;
          retryable?: boolean;
          provider?: string;
          upstreamStatus?: number;
          retryAfterMs?: number;
        } | null;
      };
      lastStatus = body;
      if (body.state === state) return;
      if (body.state === 'error' && state !== 'error') {
        throw new Error(
          `Run ended in error: ${body.lastError ?? body.error?.message ?? body.message ?? 'unknown error'}` +
            ` [code=${body.error?.error ?? 'unknown'}]`,
        );
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(
      `did not reach state ${state}; last observed state=${String(lastStatus?.state ?? 'unknown')} message=${String(lastStatus?.message ?? '')}`,
    );
  },
);

Then(
  'ingest delta response status is {int} with code {string}',
  (status: number, code: string) => {
    assert(lastResponse, 'missing last response');
    assert.equal(lastResponse.status, status);
    assert.equal((lastResponse.body as { code?: string }).code, code);
  },
);

Then(
  'ingest delta terminal outcome should stabilize as a single terminal state',
  async () => {
    assert(lastRunId, 'runId missing');
    const result = await waitForIngestTerminalStateStability(async () => {
      const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
      const body = (await res.json()) as { state?: string; message?: string };
      lastStatus = body;
      return String(body.state ?? '');
    });
    assert.ok(result.observedTerminal, 'expected one terminal state to be observed');
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
  'ingest delta vectors under {string} should be absent',
  async (prefix: string) => {
    assert(tempDir, 'temp dir missing');
    const raw = await vectorIdsFor({ root: tempDir });
    const remaining = raw.metadatas.filter((metadata) =>
      String((metadata as Metadata | undefined)?.relPath ?? '').startsWith(
        `${prefix}/`,
      ),
    );
    assert.equal(remaining.length, 0);
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
  'ingest delta ingest_files rows under {string} should be absent',
  async (prefix: string) => {
    assert(tempDir, 'temp dir missing');
    assert(isMongoConnected(), 'mongo should be connected for this step');
    const rows = (await IngestFileModel.find({ root: tempDir })
      .select({ _id: 0, relPath: 1 })
      .lean()
      .exec()) as Array<{ relPath: string }>;
    const remaining = rows.filter((row) =>
      row.relPath.startsWith(`${prefix}/`),
    );
    assert.deepEqual(remaining, []);
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

When('I disconnect ingest delta mongo before reembed', async () => {
  await disconnectMongo();
});

Then('ingest delta mongo should already be disconnected', () => {
  assert.equal(
    isMongoConnected(),
    false,
    'expected ingest delta mongo to already be disconnected before this assertion step',
  );
});

Then('ingest delta mongo should be disconnected', () => {
  assert.equal(isMongoConnected(), false);
});

When('I remember the ingest delta runId', () => {
  assert(lastRunId, 'runId missing');
  rememberedRunId = lastRunId;
});

When('I delete all ingest_files rows for the delta repo root', async () => {
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

When(
  'I remember ingest delta AST coverage timestamp for the delta repo',
  async () => {
    assert(tempDir, 'temp dir missing');
    assert(isMongoConnected(), 'mongo should be connected for this step');
    const row = await AstCoverageModel.findOne({ root: tempDir }).lean().exec();
    assert(row, 'missing ast coverage row');
    const lastIndexedAt = (row as { lastIndexedAt?: Date | string })
      .lastIndexedAt;
    assert(lastIndexedAt, 'missing ast coverage timestamp');
    rememberedAstCoverageTimestamp = new Date(lastIndexedAt).toISOString();
  },
);

Then(
  'ingest delta AST coverage timestamp for the delta repo should remain unchanged',
  async () => {
    assert(tempDir, 'temp dir missing');
    assert(
      rememberedAstCoverageTimestamp,
      'missing remembered ast coverage timestamp',
    );
    assert(isMongoConnected(), 'mongo should be connected for this step');
    const row = await AstCoverageModel.findOne({ root: tempDir }).lean().exec();
    assert(row, 'missing ast coverage row');
    const currentTimestamp = new Date(
      (row as { lastIndexedAt?: Date | string }).lastIndexedAt ?? '',
    ).toISOString();
    assert.equal(currentTimestamp, rememberedAstCoverageTimestamp);
  },
);

Then(
  'ingest delta AST coverage timestamp for the delta repo should change',
  async () => {
    assert(tempDir, 'temp dir missing');
    assert(
      rememberedAstCoverageTimestamp,
      'missing remembered ast coverage timestamp',
    );
    assert(isMongoConnected(), 'mongo should be connected for this step');
    const row = await AstCoverageModel.findOne({ root: tempDir }).lean().exec();
    assert(row, 'missing ast coverage row');
    const currentTimestamp = new Date(
      (row as { lastIndexedAt?: Date | string }).lastIndexedAt ?? '',
    ).toISOString();
    assert.notEqual(currentTimestamp, rememberedAstCoverageTimestamp);
  },
);

Then(
  'ingest delta runtime marker {string} should include mode {string}',
  (marker: string, expectedMode: string) => {
    assert(tempDir, 'temp dir missing');
    const matches = query({ text: marker }, 50);
    assert(matches.length > 0, `missing marker ${marker}`);
    assert.ok(
      matches.some(
        (entry) =>
          entry.context?.root === tempDir &&
          entry.context?.mode === expectedMode,
      ),
      `missing ${marker} log with mode ${expectedMode}`,
    );
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
