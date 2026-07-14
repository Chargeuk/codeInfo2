import '../support/chromaContainer.js';
import '../support/mockLmStudioSdk.js';
import '../support/mongoContainer.js';
import assert from 'assert';
import fs from 'fs/promises';
import type { Server } from 'http';
import path from 'path';
import { After, Before, Given, Then, When, setDefaultTimeout, } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import { clearLockedModel, clearRootsCollection, clearVectorsCollection, getRootsCollection, setLockedModel, } from '../../ingest/chromaClient.js';
import { __resetIngestJobsForTest, __setJobInputForTest, __setStatusForTest, __setQueueRuntimeOpsForTest, __setRunProcessorForTest, __validateQueueReplayStartForTest, getStatus, isBusy, pumpIngestQueue, recoverIngestQueueOnStartup, setIngestDeps, } from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import { query, resetStore } from '../../logStore.js';
import { createRequestLogger } from '../../logger.js';
import { IngestQueueRequestModel } from '../../mongo/ingestQueueRequest.js';
import { createIngestCancelRouter } from '../../routes/ingestCancel.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';
import { createIngestRemoveRouter } from '../../routes/ingestRemove.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { seedMixedShapeCanonicalOpenAiRoot } from '../support/mixedShapeRuntimeBridge.js';
import { MockLMStudioClient, type MockScenario, releaseControlledEmbeddingCall, waitForControlledEmbeddingCalls, startMock, stopMock, } from '../support/mockLmStudioSdk.js';
import { createTempRepoRoot } from '../support/tempRepoRoot.js';
setDefaultTimeout(30000);
let server: Server | null = null;
let baseUrl = '';
let response: {
    status: number;
    body: unknown;
} | null = null;
let capturedRootsResponse: {
    status: number;
    body: unknown;
} | null = null;
let tempDir: string | null = null;
let lastRunId: string | null = null;
let queueRuntimeAttemptedPaths: string[] = [];
let queueRuntimeStartedPaths: string[] = [];
let lastQueuePumpResult: {
    started: boolean;
    blockedByCleanup: boolean;
    requestId: string | null;
    runId: string | null;
} | null = null;
let queueRuntimeAttemptObserved: Promise<void> | null = null;
let resolveQueueRuntimeAttemptObserved: (() => void) | null = null;
let queueRuntimeStartObserved: Promise<void> | null = null;
let resolveQueueRuntimeStartObserved: (() => void) | null = null;
const queueRuntimeTerminalWaiters = new Map<string, Promise<void>>();
const queueRuntimeTerminalResolvers = new Map<string, () => void>();
function resetQueueRuntimeObservationWaiters() {
    queueRuntimeAttemptObserved = new Promise<void>((resolve) => {
        resolveQueueRuntimeAttemptObserved = resolve;
    });
    queueRuntimeStartObserved = new Promise<void>((resolve) => {
        resolveQueueRuntimeStartObserved = resolve;
    });
    queueRuntimeTerminalWaiters.clear();
    queueRuntimeTerminalResolvers.clear();
}
function getQueueRuntimeTerminalWaiter(runId: string) {
    let waiter = queueRuntimeTerminalWaiters.get(runId);
    if (!waiter) {
        waiter = new Promise<void>((resolve) => {
            queueRuntimeTerminalResolvers.set(runId, resolve);
        });
        queueRuntimeTerminalWaiters.set(runId, waiter);
    }
    return waiter;
}
function resolveQueueRuntimeTerminalWaiter(runId: string) {
    queueRuntimeTerminalResolvers.get(runId)?.();
}
async function waitForQueueRuntimeSignal(signal: Promise<void> | null, label: string, timeoutMs = 2000) {
    if (!signal) {
        throw new Error(`Missing queue runtime signal for ${label}`);
    }
    await Promise.race([
        signal,
        new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Timed out waiting for ${label}`));
            }, timeoutMs);
        }),
    ]);
}
function getCapturedRootsPayload() {
    assert(capturedRootsResponse, 'expected captured roots response');
    return (capturedRootsResponse.body as {
        roots?: unknown[];
    }).roots ?? [];
}
function findCapturedRootByPath(rootPath: string) {
    const roots = getCapturedRootsPayload();
    const entry = roots.find((root) => (root as {
        path?: string;
    }).path === rootPath) as {
        path?: string;
        name?: string;
        requestId?: string | null;
        runId?: string | null;
        queueState?: string | null;
        queuePosition?: number | null;
    } | undefined;
    assert(entry, `expected root entry for ${rootPath}`);
    return entry;
}
async function seedQueuedReembedRequest(params: {
    rootPath: string;
    queueState: 'waiting' | 'running' | 'cleanup-blocked';
    runId?: string | null;
    requestPayloadPath?: string | null;
    nonReplayableAt?: Date;
    terminalPublishedAt?: Date;
    name?: string;
}) {
    const requestPayload: Record<string, unknown> = {
        name: params.name ?? (path.posix.basename(params.rootPath) || 'repo'),
        model: 'embed-1',
    };
    if (params.requestPayloadPath !== null) {
        requestPayload.path = params.requestPayloadPath ?? params.rootPath;
    }
    await IngestQueueRequestModel.create({
        canonicalTargetPath: params.rootPath,
        operation: 'reembed',
        queueState: params.queueState,
        requestPayload,
        sourceSurface: 'cucumber',
        runId: params.runId ?? null,
        ...(params.nonReplayableAt
            ? { nonReplayableAt: params.nonReplayableAt }
            : {}),
        ...(params.terminalPublishedAt
            ? { terminalPublishedAt: params.terminalPublishedAt }
            : {}),
    });
}
Before(async () => {
    setScopedTestEnvValue("NODE_ENV", 'test');
    clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
    release();
    __resetIngestJobsForTest();
    if (mongoose.connection.readyState === 1) {
        await IngestQueueRequestModel.deleteMany({}).exec();
    }
    resetStore();
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'ws://localhost:1234');
    setScopedTestEnvValue("CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT", '1');
    setScopedTestEnvValue("CODEINFO_INGEST_MAX_QUEUE_SIZE", '1');
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(createRequestLogger());
    app.use((req, res, next) => {
        const requestId = (req as unknown as {
            id?: string;
        }).id;
        if (requestId)
            res.locals.requestId = requestId;
        next();
    });
    setIngestDeps({
        lmClientFactory: () => new MockLMStudioClient() as unknown as LMStudioClient,
        baseUrl: process.env.CODEINFO_LMSTUDIO_BASE_URL ?? '',
    });
    app.use('/', createIngestStartRouter({
        clientFactory: () => new MockLMStudioClient() as unknown as LMStudioClient,
    }));
    app.use('/', createIngestCancelRouter());
    app.use('/', createIngestReembedRouter({
        clientFactory: () => new MockLMStudioClient() as unknown as LMStudioClient,
    }));
    app.use('/', createIngestRemoveRouter());
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
    release();
    stopMock();
    clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
    if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        server = null;
    }
    if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
        tempDir = null;
    }
    response = null;
    capturedRootsResponse = null;
    lastRunId = null;
    queueRuntimeAttemptedPaths = [];
    queueRuntimeStartedPaths = [];
    lastQueuePumpResult = null;
    resetQueueRuntimeObservationWaiters();
    if (process.env.NODE_ENV === 'test') {
        __setQueueRuntimeOpsForTest({
            deleteQueueRequestById: async () => null,
            ensureQueueRequestRunId: async () => null,
            findOldestCleanupBlockedQueueRequest: async () => null,
            findOldestRunningQueueRequest: async () => null,
            getQueueRequestId: () => 'noop',
            markQueueRequestCleanupBlocked: async () => null,
            markQueueRequestTerminalPublished: async () => null,
            promoteOldestWaitingQueueRequest: async () => null,
        });
        __setRunProcessorForTest(null);
        __resetIngestJobsForTest();
    }
    if (mongoose.connection.readyState === 1) {
        await IngestQueueRequestModel.deleteMany({}).exec();
    }
    resetStore();
    await clearRootsCollection();
    await clearVectorsCollection();
    await clearLockedModel();
    clearScopedTestEnvValue("CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT");
    clearScopedTestEnvValue("CODEINFO_INGEST_MAX_QUEUE_SIZE");
});
Given('ingest manage chroma stub is empty', async () => {
    await clearRootsCollection();
    await clearVectorsCollection();
    await clearLockedModel();
});
Given('ingest manage mongo queue is empty', async () => {
    await IngestQueueRequestModel.deleteMany({}).exec();
});
Given('ingest manage models scenario {string}', (name: string) => {
    startMock({ scenario: name as MockScenario });
});
Given('ingest manage temp repo with file {string} containing {string}', async (rel: string, content: string) => {
    tempDir = await createTempRepoRoot('ingest-manage-');
    const filePath = path.join(tempDir, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
});
When('I POST ingest manage start with model {string}', async (model: string) => {
    if (!tempDir) {
        tempDir = await createTempRepoRoot('ingest-manage-');
    }
    const res = await fetch(`${baseUrl}/ingest/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: tempDir, name: 'tmp', model }),
    });
    response = { status: res.status, body: await res.json() };
    if (response.status === 202) {
        lastRunId = (response.body as {
            runId?: string;
        }).runId ?? null;
    }
});
When('I POST ingest manage cancel for the last run', async () => {
    assert(lastRunId, 'runId missing');
    const res = await fetch(`${baseUrl}/ingest/cancel/${lastRunId}`, {
        method: 'POST',
    });
    response = { status: res.status, body: await res.json() };
});
When('I POST ingest manage reembed for the temp repo', async () => {
    assert(tempDir, 'temp dir missing');
    const res = await fetch(`${baseUrl}/ingest/reembed/${encodeURIComponent(tempDir)}`, {
        method: 'POST',
    });
    response = { status: res.status, body: await res.json() };
    if (response.status === 202) {
        lastRunId = (response.body as {
            runId?: string;
        }).runId ?? null;
    }
});
When('I POST ingest manage reembed for root {string}', async (root: string) => {
    const res = await fetch(`${baseUrl}/ingest/reembed/${encodeURIComponent(root)}`, {
        method: 'POST',
    });
    response = { status: res.status, body: await res.json() };
    if (response.status === 202) {
        lastRunId = (response.body as {
            runId?: string;
        }).runId ?? null;
    }
});
When('I POST ingest manage remove for the temp repo', async () => {
    assert(tempDir, 'temp dir missing');
    const res = await fetch(`${baseUrl}/ingest/remove/${encodeURIComponent(tempDir)}`, {
        method: 'POST',
    });
    response = { status: res.status, body: await res.json() };
});
When('I POST ingest manage remove for root {string}', async (root: string) => {
    const res = await fetch(`${baseUrl}/ingest/remove/${encodeURIComponent(root)}`, {
        method: 'POST',
    });
    response = { status: res.status, body: await res.json() };
});
When('I change ingest manage temp file {string} to {string}', async (rel: string, content: string) => {
    assert(tempDir, 'temp dir missing');
    const filePath = path.join(tempDir, rel);
    await fs.writeFile(filePath, content);
});
Then('ingest manage status for the last run becomes {string}', async (state: string) => {
    assert(lastRunId, 'runId missing');
    for (let i = 0; i < 120; i += 1) {
        const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
        const body = await res.json();
        console.log(`[ingest-manage] poll ${i} runId=${lastRunId} state=${body.state} message=${body.message ?? ''}`);
        if (body.state === state) {
            if (state === 'completed' || state === 'error') {
                for (let j = 0; j < 60; j += 1) {
                    if (!isBusy())
                        return;
                    await new Promise((r) => setTimeout(r, 100));
                }
                assert.fail(`ingest reached ${state} but busy cleanup did not settle`);
            }
            return;
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`did not reach state ${state}`);
});
Then('ingest manage status for run {string} becomes {string}', async (runId: string, state: string) => {
    for (let i = 0; i < 120; i += 1) {
        const res = await fetch(`${baseUrl}/ingest/status/${runId}`);
        const body = await res.json();
        if ((body as {
            state?: string;
        }).state === state) {
            return;
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`did not reach state ${state} for run ${runId}`);
});
Then('ingest manage status for run {string} has last error {string}', async (runId: string, expectedError: string) => {
    const res = await fetch(`${baseUrl}/ingest/status/${runId}`);
    const body = await res.json();
    assert.equal((body as {
        lastError?: string | null;
    }).lastError, expectedError);
});
Then('ingest manage roots first status is {string}', async (state: string) => {
    for (let i = 0; i < 50; i += 1) {
        const roots = getCapturedRootsPayload();
        if (roots.length > 0 &&
            (roots[0] as {
                status?: string;
            }).status === state) {
            return;
        }
        const res = await fetch(`${baseUrl}/ingest/roots`);
        capturedRootsResponse = { status: res.status, body: await res.json() };
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const roots = getCapturedRootsPayload();
    assert(roots.length > 0, 'no roots returned');
    assert.equal((roots[0] as {
        status?: string;
    }).status, state);
});
Then('ingest manage roots first model is {string}', (model: string) => {
    const roots = getCapturedRootsPayload();
    assert(roots.length > 0, 'no roots returned');
    assert.equal((roots[0] as {
        model?: string;
    }).model, model);
});
Then('ingest manage roots first embedding provider is {string}', (provider: string) => {
    const roots = getCapturedRootsPayload();
    assert(roots.length > 0, 'no roots returned');
    assert.equal((roots[0] as {
        embeddingProvider?: string;
    }).embeddingProvider, provider);
});
Then('ingest manage roots first request id is present', () => {
    const roots = getCapturedRootsPayload();
    assert(roots.length > 0, 'no roots returned');
    assert.equal(typeof (roots[0] as {
        requestId?: string | null;
    }).requestId, 'string');
});
Then('ingest manage roots first id is {string}', (expectedId: string) => {
    const roots = getCapturedRootsPayload();
    assert(roots.length > 0, 'no roots returned');
    assert.equal((roots[0] as {
        id?: string;
    }).id, expectedId);
});
Then('ingest manage roots first run id is null', () => {
    const roots = getCapturedRootsPayload();
    assert(roots.length > 0, 'no roots returned');
    assert.equal((roots[0] as {
        runId?: string | null;
    }).runId, null);
});
Then('ingest manage roots entry for {string} has id {string}', (rootPath: string, expectedId: string) => {
    const root = findCapturedRootByPath(rootPath) as {
        id?: string;
    };
    assert.equal(root.id, expectedId);
});
Then('ingest manage roots entry for {string} has canonical id {string}', (rootPath: string, expectedId: string) => {
    const root = findCapturedRootByPath(rootPath) as {
        id?: string;
    };
    assert.equal(root.id, expectedId);
});
Then('ingest manage roots entry for {string} keeps canonical id {string} when resumed', (rootPath: string, expectedId: string) => {
    const root = findCapturedRootByPath(rootPath) as {
        id?: string;
    };
    assert.equal(root.id, expectedId);
});
Then('ingest manage roots entry for {string} has name {string}', (rootPath: string, expectedName: string) => {
    const root = findCapturedRootByPath(rootPath);
    assert.equal(root.name, expectedName);
});
Then('ingest manage roots entry for {string} has request id present', (rootPath: string) => {
    const root = findCapturedRootByPath(rootPath);
    assert.equal(typeof root.requestId, 'string');
});
Then('ingest manage roots entry for {string} has run id null', (rootPath: string) => {
    const root = findCapturedRootByPath(rootPath);
    assert.equal(root.runId, null);
});
Then('ingest manage roots entry for {string} has run id {string}', (rootPath: string, expectedRunId: string) => {
    const root = findCapturedRootByPath(rootPath);
    assert.equal(root.runId, expectedRunId);
});
Then('ingest manage roots entry for {string} has queue state {string}', (rootPath: string, queueState: string) => {
    const root = findCapturedRootByPath(rootPath);
    assert.equal(root.queueState, queueState);
});
Then('ingest manage roots entry for {string} has queue position {int}', (rootPath: string, queuePosition: number) => {
    const root = findCapturedRootByPath(rootPath);
    assert.equal(root.queuePosition, queuePosition);
});
Then('ingest manage roots entry for {string} has embedding provider {string}', (rootPath: string, expectedProvider: string) => {
    const root = findCapturedRootByPath(rootPath) as {
        embeddingProvider?: string;
    };
    assert.equal(root.embeddingProvider, expectedProvider);
});
Then('ingest manage roots entry for the temp repo has embedding provider {string}', (expectedProvider: string) => {
    assert(tempDir, 'temp dir missing');
    const root = findCapturedRootByPath(tempDir) as {
        embeddingProvider?: string;
    };
    assert.equal(root.embeddingProvider, expectedProvider);
});
Then('ingest manage roots entry for {string} has embedding model {string}', (rootPath: string, expectedModel: string) => {
    const root = findCapturedRootByPath(rootPath) as {
        embeddingModel?: string;
        model?: string;
        modelId?: string;
    };
    assert.equal(root.embeddingModel, expectedModel);
    assert.equal(root.model, expectedModel);
    assert.equal(root.modelId, expectedModel);
});
Then('ingest manage roots entry for the temp repo has embedding model {string}', (expectedModel: string) => {
    assert(tempDir, 'temp dir missing');
    const root = findCapturedRootByPath(tempDir) as {
        embeddingModel?: string;
        model?: string;
        modelId?: string;
    };
    assert.equal(root.embeddingModel, expectedModel);
    assert.equal(root.model, expectedModel);
    assert.equal(root.modelId, expectedModel);
});
Then('ingest manage roots entry for {string} has last error {string}', (rootPath: string, expectedError: string) => {
    const root = findCapturedRootByPath(rootPath) as {
        lastError?: string | null;
    };
    assert.equal(root.lastError, expectedError);
});
Then('ingest manage roots entry for {string} has no diagnostics', (rootPath: string) => {
    const root = findCapturedRootByPath(rootPath) as {
        lastError?: string | null;
        error?: unknown;
    };
    assert.equal(root.lastError, null);
    assert.equal(root.error ?? null, null);
});
Then('ingest manage roots entry for {string} has runtime error {string} with message {string}', (rootPath: string, expectedCode: string, expectedMessage: string) => {
    const root = findCapturedRootByPath(rootPath) as {
        error?: {
            error?: string;
            message?: string;
            retryable?: boolean;
            provider?: string;
        } | null;
    };
    assert.equal(root.error?.error, expectedCode);
    assert.equal(root.error?.message, expectedMessage);
    assert.equal(root.error?.retryable, true);
    assert.equal(root.error?.provider, 'openai');
});
Then('ingest manage roots entry for {string} has structured error provider {string} code {string} with message {string}', (rootPath: string, expectedProvider: string, expectedCode: string, expectedMessage: string) => {
    const root = findCapturedRootByPath(rootPath) as {
        error?: {
            error?: string;
            message?: string;
            retryable?: boolean;
            provider?: string;
        } | null;
    };
    assert.equal(root.error?.provider, expectedProvider);
    assert.equal(root.error?.error, expectedCode);
    assert.equal(root.error?.message, expectedMessage);
});
Then('ingest manage roots first queue state is {string}', (queueState: string) => {
    const roots = getCapturedRootsPayload();
    assert(roots.length > 0, 'no roots returned');
    assert.equal((roots[0] as {
        queueState?: string;
    }).queueState, queueState);
});
Then('ingest manage roots first queue position is {int}', (queuePosition: number) => {
    const roots = getCapturedRootsPayload();
    assert(roots.length > 0, 'no roots returned');
    assert.equal((roots[0] as {
        queuePosition?: number | null;
    }).queuePosition, queuePosition);
});
Then('ingest manage roots count is {int}', (count: number) => {
    const roots = getCapturedRootsPayload();
    assert.equal(roots.length, count);
});
Then('ingest manage locked model id is null', () => {
    assert(response, 'expected response');
    const locked = (response.body as {
        lockedModelId?: string | null;
    })
        .lockedModelId;
    assert.equal(locked, null);
});
Then('ingest manage roots first entry has canonical and alias lock parity', () => {
    assert(response, 'expected response');
    const roots = (response.body as {
        roots?: unknown[];
    }).roots ?? [];
    assert(roots.length > 0, 'no roots returned');
    const first = roots[0] as {
        embeddingProvider?: string;
        embeddingModel?: string;
        embeddingDimensions?: number;
        model?: string;
        modelId?: string;
        lock?: {
            embeddingProvider?: string;
            embeddingModel?: string;
            embeddingDimensions?: number;
            lockedModelId?: string;
            modelId?: string;
        };
    };
    assert.equal(typeof first.embeddingProvider, 'string');
    assert.equal(typeof first.embeddingModel, 'string');
    assert.equal(typeof first.embeddingDimensions, 'number');
    assert.equal(first.model, first.embeddingModel);
    assert.equal(first.modelId, first.embeddingModel);
    assert.equal(first.lock?.embeddingProvider, first.embeddingProvider);
    assert.equal(first.lock?.embeddingModel, first.embeddingModel);
    assert.equal(first.lock?.embeddingDimensions, first.embeddingDimensions);
    assert.equal(first.lock?.lockedModelId, first.embeddingModel);
    assert.equal(first.lock?.modelId, first.embeddingModel);
});
Then('ingest manage roots payload is fetched', async () => {
    const res = await fetch(`${baseUrl}/ingest/roots`);
    const body = await res.json();
    response = { status: res.status, body };
    capturedRootsResponse = { status: res.status, body };
});
When('I GET ingest manage roots', async () => {
    const res = await fetch(`${baseUrl}/ingest/roots`);
    const body = await res.json();
    response = { status: res.status, body };
    capturedRootsResponse = { status: res.status, body };
});
Then('ingest manage waits for {int} controlled embedding calls', async (count: number) => {
    await waitForControlledEmbeddingCalls(count);
});
When('ingest manage releases controlled embedding call {int}', (index: number) => {
    releaseControlledEmbeddingCall(index);
});
Then('ingest manage logs include {string}', (marker: string) => {
    const matches = query({ text: marker }, 50);
    assert.ok(matches.length > 0, `expected log marker ${marker}`);
});
Given('ingest manage root metadata exists for {string} with legacy model {string}', async (rootPath: string, model: string) => {
    const roots = await getRootsCollection();
    await roots.add({
        ids: ['legacy-root-run'],
        embeddings: [[0]],
        metadatas: [
            {
                runId: 'legacy-root-run',
                root: rootPath,
                name: 'legacy-repo',
                model,
                files: 1,
                chunks: 1,
                embedded: 1,
                state: 'completed',
                lastIngestAt: new Date().toISOString(),
                ingestedAtMs: Date.now(),
            },
        ],
    });
});
Given('ingest manage root metadata exists for {string} with stale persisted error {string}', async (rootPath: string, message: string) => {
    const roots = await getRootsCollection();
    await roots.add({
        ids: ['legacy-error-run'],
        embeddings: [[0]],
        metadatas: [
            {
                runId: 'legacy-error-run',
                root: rootPath,
                name: 'legacy-error-repo',
                model: 'stale-model',
                state: 'error',
                lastError: message,
                files: 1,
                chunks: 1,
                embedded: 0,
                lastIngestAt: new Date().toISOString(),
                ingestedAtMs: Date.now(),
            },
        ],
    });
});
Given('ingest manage root metadata exists for the temp repo in state {string}', async (state: string) => {
    assert(tempDir, 'temp dir missing');
    const roots = await getRootsCollection();
    await roots.add({
        ids: ['temp-root-state-run'],
        embeddings: [[0]],
        metadatas: [
            {
                runId: 'temp-root-state-run',
                root: tempDir,
                name: 'temp-repo',
                model: 'embed-1',
                files: 1,
                chunks: 1,
                embedded: 1,
                state,
                lastIngestAt: new Date().toISOString(),
                ingestedAtMs: Date.now(),
            },
        ],
    });
});
Given('ingest manage mixed-shape canonical OpenAI root metadata exists for the temp repo', async () => {
    assert(tempDir, 'temp dir missing');
    const previousDimensions = process.env.CODEINFO_MAIN_STACK_MIXED_SHAPE_VECTOR_DIMENSIONS;
    setScopedTestEnvValue("CODEINFO_MAIN_STACK_MIXED_SHAPE_VECTOR_DIMENSIONS", '1');
    try {
        await seedMixedShapeCanonicalOpenAiRoot({
            rootPath: tempDir,
            name: 'temp-mixed-shape-repo',
        });
    }
    finally {
        if (previousDimensions === undefined) {
            clearScopedTestEnvValue("CODEINFO_MAIN_STACK_MIXED_SHAPE_VECTOR_DIMENSIONS");
        }
        else {
            setScopedTestEnvValue("CODEINFO_MAIN_STACK_MIXED_SHAPE_VECTOR_DIMENSIONS", previousDimensions);
        }
    }
});
Given('ingest manage lock is provider {string} model {string} dimensions {int}', async (provider: string, model: string, dimensions: number) => {
    await setLockedModel({
        embeddingProvider: provider as 'lmstudio' | 'openai',
        embeddingModel: model,
        embeddingDimensions: dimensions,
    });
});
Then('ingest manage response status is {int} with code {string}', (status: number, code: string) => {
    assert(response, 'expected response');
    assert.equal(response.status, status);
    assert.equal((response.body as {
        code?: string;
    }).code, code);
});
Then('ingest manage response status is {int}', (status: number) => {
    assert(response, 'expected response');
    assert.equal(response.status, status);
});
Then('ingest manage mongo queue remains empty', async () => {
    const count = await IngestQueueRequestModel.countDocuments({});
    assert.equal(count, 0);
});
Given('ingest manage mongo queue has running request for {string} with run id {string}', async (rootPath: string, runId: string) => {
    await seedQueuedReembedRequest({
        rootPath,
        queueState: 'running',
        runId,
    });
});
Given('ingest manage runtime status for run {string} is error {string} with message {string}', (runId: string, code: string, message: string) => {
    __setStatusForTest(runId, {
        runId,
        state: 'error',
        counts: { files: 1, chunks: 1, embedded: 0 },
        lastError: message,
        error: {
            error: code,
            message,
            retryable: true,
            provider: 'openai',
        },
    });
});
Given('ingest manage runtime status for run {string} is ingest error {string} with message {string}', (runId: string, code: string, message: string) => {
    __setStatusForTest(runId, {
        runId,
        state: 'error',
        counts: { files: 1, chunks: 1, embedded: 0 },
        lastError: message,
        error: {
            error: code,
            message,
            retryable: false,
            provider: 'ingest',
        },
    });
});
Given('ingest manage runtime status for run {string} is healthy {string}', (runId: string, state: string) => {
    assert(state === 'queued' || state === 'scanning' || state === 'embedding', `unsupported ingest state ${state}`);
    __setStatusForTest(runId, {
        runId,
        state: state as 'queued' | 'scanning' | 'embedding',
        counts: { files: 1, chunks: 1, embedded: 0 },
        lastError: null,
        error: null,
    });
});
Given('ingest manage mongo queue has running request for {string} with run id {string} and persisted path {string}', async (rootPath: string, runId: string, requestPayloadPath: string) => {
    await seedQueuedReembedRequest({
        rootPath,
        queueState: 'running',
        runId,
        requestPayloadPath,
    });
});
Given('ingest manage mongo queue has running request for {string} with run id {string} missing persisted path', async (rootPath: string, runId: string) => {
    await seedQueuedReembedRequest({
        rootPath,
        queueState: 'running',
        runId,
        requestPayloadPath: null,
    });
});
Given('ingest manage mongo queue has running request for the temp repo with run id {string} and canonical model value {int}', async (runId: string, canonicalModelValue: number) => {
    assert(tempDir, 'temp dir missing');
    await IngestQueueRequestModel.create({
        canonicalTargetPath: tempDir,
        operation: 'reembed',
        queueState: 'running',
        requestPayload: {
            path: tempDir,
            name: path.posix.basename(tempDir) || 'repo',
            model: 'embed-1',
            embeddingProvider: 'lmstudio',
            embeddingModel: canonicalModelValue,
        },
        sourceSurface: 'cucumber',
        runId,
    });
});
Given('ingest manage mongo queue has barrier-backed running request for {string} with run id {string}', async (rootPath: string, runId: string) => {
    await seedQueuedReembedRequest({
        rootPath,
        queueState: 'running',
        runId,
        nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
    });
});
Given('ingest manage mongo queue has cleanup-blocked request for {string} with run id {string}', async (rootPath: string, runId: string) => {
    await seedQueuedReembedRequest({
        rootPath,
        queueState: 'cleanup-blocked',
        runId,
    });
});
Given('ingest manage mongo queue has partial cleanup-blocked request for {string} with run id {string}', async (rootPath: string, runId: string) => {
    await seedQueuedReembedRequest({
        rootPath,
        queueState: 'cleanup-blocked',
        runId,
        nonReplayableAt: new Date('2026-01-01T00:00:00.000Z'),
        terminalPublishedAt: new Date('2026-01-01T00:00:05.000Z'),
    });
});
Given('ingest manage mongo queue has waiting request for {string}', async (rootPath: string) => {
    await seedQueuedReembedRequest({
        rootPath,
        queueState: 'waiting',
    });
});
Given('ingest manage mongo queue has waiting request for the temp repo', async () => {
    assert(tempDir, 'temp dir missing');
    await seedQueuedReembedRequest({
        rootPath: tempDir,
        queueState: 'waiting',
    });
});
Given('ingest manage active runtime owns root {string} with run id {string}', (rootPath: string, runId: string) => {
    __setJobInputForTest(runId, {
        path: rootPath,
        root: rootPath,
        name: 'active-remove-target',
        model: 'embed-1',
        operation: 'start',
    });
    __setStatusForTest(runId, {
        runId,
        state: 'embedding',
        counts: { files: 1, chunks: 1, embedded: 0 },
        message: 'Embedding files',
        lastError: null,
        error: null,
    });
});
Given('ingest manage mongo queue has waiting request for {string} named {string}', async (rootPath: string, name: string) => {
    await seedQueuedReembedRequest({
        rootPath,
        queueState: 'waiting',
        name,
    });
});
Given('ingest manage mongo queue has waiting request for {string} named {string} with provider {string} model {string}', async (rootPath: string, name: string, provider: string, model: string) => {
    await IngestQueueRequestModel.create({
        canonicalTargetPath: rootPath,
        operation: 'reembed',
        queueState: 'waiting',
        requestPayload: {
            path: rootPath,
            name,
            model,
            embeddingProvider: provider,
            embeddingModel: model,
        },
        sourceSurface: 'cucumber',
        runId: null,
    });
});
Given('ingest manage mongo queue has waiting request for {string} named {string} with canonical provider {string} canonical model {string} and legacy model {string}', async (rootPath: string, name: string, provider: string, canonicalModel: string, legacyModel: string) => {
    await IngestQueueRequestModel.create({
        canonicalTargetPath: rootPath,
        operation: 'reembed',
        queueState: 'waiting',
        requestPayload: {
            path: rootPath,
            name,
            model: legacyModel,
            embeddingProvider: provider,
            embeddingModel: canonicalModel,
        },
        sourceSurface: 'cucumber',
        runId: null,
    });
});
Given('ingest manage mongo queue has waiting request for {string} named {string} with legacy provider-qualified model {string}', async (rootPath: string, name: string, legacyModel: string) => {
    await IngestQueueRequestModel.create({
        canonicalTargetPath: rootPath,
        operation: 'reembed',
        queueState: 'waiting',
        requestPayload: {
            path: rootPath,
            name,
            model: legacyModel,
        },
        sourceSurface: 'cucumber',
        runId: null,
    });
});
Given('ingest manage mongo queue has waiting request for {string} named {string} with canonical provider {string} and legacy model {string}', async (rootPath: string, name: string, provider: string, legacyModel: string) => {
    await IngestQueueRequestModel.create({
        canonicalTargetPath: rootPath,
        operation: 'reembed',
        queueState: 'waiting',
        requestPayload: {
            path: rootPath,
            name,
            model: legacyModel,
            embeddingProvider: provider,
        },
        sourceSurface: 'cucumber',
        runId: null,
    });
});
Given('ingest manage queue runtime records processor attempts and validation-passed starts', () => {
    queueRuntimeAttemptedPaths = [];
    queueRuntimeStartedPaths = [];
    resetQueueRuntimeObservationWaiters();
    __setRunProcessorForTest(async (runId, input) => {
        try {
            queueRuntimeAttemptedPaths.push(input.path);
            resolveQueueRuntimeAttemptObserved?.();
            await __validateQueueReplayStartForTest(input);
            queueRuntimeStartedPaths.push(input.path);
            resolveQueueRuntimeStartObserved?.();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? 'unknown');
            const code = typeof (error as {
                code?: unknown;
            })?.code === 'string'
                ? ((error as {
                    code?: string;
                }).code as string)
                : 'VALIDATION';
            const previousStatus = getStatus(runId);
            __setStatusForTest(runId, {
                runId,
                state: 'error',
                counts: previousStatus?.counts ?? {
                    files: 0,
                    chunks: 0,
                    embedded: 0,
                },
                message,
                lastError: message,
                error: {
                    error: code,
                    message,
                    retryable: false,
                    provider: 'ingest',
                },
            });
            resolveQueueRuntimeTerminalWaiter(runId);
        }
        finally {
            release(runId);
        }
    });
});
Given('ingest manage mongo queue has running request for the temp repo with run id {string} and mismatched persisted path', async (runId: string) => {
    assert(tempDir, 'temp dir missing');
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", path.dirname(tempDir));
    await IngestQueueRequestModel.create({
        canonicalTargetPath: tempDir,
        operation: 'reembed',
        queueState: 'running',
        requestPayload: {
            path: `${tempDir}-other`,
            name: 'temp-repo',
            model: 'embed-model',
        },
        sourceSurface: 'cucumber',
        runId,
    });
});
When('ingest manage startup recovery runs', async () => {
    await recoverIngestQueueOnStartup();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
});
When('ingest manage queue pump runs', async () => {
    lastQueuePumpResult = await pumpIngestQueue();
    await new Promise((resolve) => setImmediate(resolve));
});
Then('ingest manage queue runtime validation-passed started paths are {string}', async (pathsCsv: string) => {
    const expected = pathsCsv.trim().length === 0
        ? []
        : pathsCsv.split(',').map((item) => item.trim());
    if (expected.length > 0) {
        await waitForQueueRuntimeSignal(queueRuntimeStartObserved, 'queue runtime validation-passed start');
    }
    assert.deepEqual(queueRuntimeStartedPaths, expected);
});
Then('ingest manage queue runtime validation-passed started paths are empty', () => {
    assert.deepEqual(queueRuntimeStartedPaths, []);
});
Then('ingest manage queue runtime made no processor attempt', () => {
    assert.deepEqual(queueRuntimeAttemptedPaths, []);
});
Then('ingest manage queue runtime attempted paths are {string}', async (pathsCsv: string) => {
    const expected = pathsCsv.trim().length === 0
        ? []
        : pathsCsv.split(',').map((item) => item.trim());
    if (expected.length > 0) {
        await waitForQueueRuntimeSignal(queueRuntimeAttemptObserved, 'queue runtime processor attempt');
    }
    assert.deepEqual(queueRuntimeAttemptedPaths, expected);
});
Then('ingest manage queue runtime attempted paths are the temp repo', async () => {
    assert(tempDir, 'temp dir missing');
    await waitForQueueRuntimeSignal(queueRuntimeAttemptObserved, 'queue runtime processor attempt for temp repo');
    assert.deepEqual(queueRuntimeAttemptedPaths, [tempDir]);
});
Then('ingest manage runtime status for the last queue run is error {string} with message {string}', async (expectedCode: string, expectedMessage: string) => {
    assert(lastQueuePumpResult?.runId, 'expected last queue run id');
    const initialStatus = getStatus(lastQueuePumpResult.runId);
    if (initialStatus?.state !== 'error') {
        await waitForQueueRuntimeSignal(getQueueRuntimeTerminalWaiter(lastQueuePumpResult.runId), `queue runtime terminal status for ${lastQueuePumpResult.runId}`, 3000);
    }
    const status = getStatus(lastQueuePumpResult.runId);
    assert(status, 'expected runtime status');
    assert.equal(status.state, 'error');
    assert.equal(status.error?.error, expectedCode);
    assert.equal(status.error?.message, expectedMessage);
});
Then('ingest manage runtime status for run {string} reports error {string} with message {string}', async (runId: string, expectedCode: string, expectedMessage: string) => {
    const initialStatus = getStatus(runId);
    if (initialStatus?.state !== 'error') {
        await waitForQueueRuntimeSignal(getQueueRuntimeTerminalWaiter(runId), `queue runtime terminal status for ${runId}`, 3000);
    }
    const status = getStatus(runId);
    assert(status, `expected runtime status for ${runId}`);
    assert.equal(status.state, 'error');
    assert.equal(status.error?.error, expectedCode);
    assert.equal(status.error?.message, expectedMessage);
});
Then('ingest manage queue pump reports cleanup blocked', () => {
    assert(lastQueuePumpResult, 'expected queue pump result');
    assert.equal(lastQueuePumpResult.started, false);
    assert.equal(lastQueuePumpResult.blockedByCleanup, true);
});
