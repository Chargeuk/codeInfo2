import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import { ChromaClient } from 'chromadb';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { resetCollectionsForTests } from '../../ingest/chromaClient.js';
import { createEmbeddingDispatcher } from '../../ingest/embeddingDispatcher.js';
import { hashFile } from '../../ingest/hashing.js';
import { __setBeforeTerminalStatusPublishHookForTest, __setJobInputForTest, __setQueueRequestIdForRunForTest, __setQueueRuntimeOpsForTest, __setRunProcessorForTest, __resetIngestJobsForTest, __setStatusForTest, cancelRun, getStatus, setIngestDeps, startIngest, } from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import { query, resetStore } from '../../logStore.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import { createIngestCancelRouter } from '../../routes/ingestCancel.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';
function buildApp(options?: {
    cancelRun?: (runId: string) => Promise<{
        cleanupState: 'complete';
        found: boolean;
    }>;
    getStatus?: (runId: string) => {
        runId: string;
    } | null;
}) {
    const app = express();
    app.use(express.json());
    app.use(createIngestCancelRouter({
        cancelRun: options?.cancelRun as never,
        getStatus: (options?.getStatus ?? (() => ({ runId: 'run-1' }))) as never,
        isBusy: () => false,
    }));
    return app;
}
test.beforeEach(() => {
    setScopedTestEnvValue("NODE_ENV", 'test');
    resetStore();
    __resetIngestJobsForTest();
    resetCollectionsForTests();
    release();
});
test.afterEach(() => {
    __setBeforeTerminalStatusPublishHookForTest(null);
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
    resetCollectionsForTests();
    release();
    clearScopedTestEnvValue("CODEINFO_INGEST_FLUSH_EVERY");
    clearScopedTestEnvValue("CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT");
    clearScopedTestEnvValue("CODEINFO_INGEST_MAX_QUEUE_SIZE");
    clearScopedTestEnvValue("CODEINFO_INGEST_TEST_GIT_PATHS");
});
function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
}
async function createTempRepo(files: Record<string, string>) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-cancel-'));
    await fs.mkdir(path.join(root, '.git'));
    await Promise.all(Object.entries(files).map(async ([relPath, contents]) => {
        const fullPath = path.join(root, relPath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, contents, 'utf8');
    }));
    setScopedTestEnvValue("CODEINFO_INGEST_TEST_GIT_PATHS", Object.keys(files).join(','));
    return {
        root,
        cleanup: async () => {
            await fs.rm(root, { recursive: true, force: true });
        },
    };
}
async function waitForTerminal(runId: string) {
    const terminal = new Set(['completed', 'skipped', 'cancelled', 'error']);
    const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(2000);
    const startedAt = Date.now();
    while (Date.now() - startedAt < resolvedTimeoutMs) {
        const status = getStatus(runId);
        if (status && terminal.has(status.state)) {
            return status;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for terminal status for ${runId} after ${resolvedTimeoutMs}ms`);
}
async function waitForStatus(runId: string, predicate: (status: ReturnType<typeof getStatus>) => boolean) {
    const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(2000);
    const startedAt = Date.now();
    while (Date.now() - startedAt < resolvedTimeoutMs) {
        const status = getStatus(runId);
        if (predicate(status)) {
            return status;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for matching status for ${runId} after ${resolvedTimeoutMs}ms`);
}
async function waitForCondition(label: string, predicate: () => boolean, timeoutMs = 2000) {
    const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
    const startedAt = Date.now();
    while (Date.now() - startedAt < resolvedTimeoutMs) {
        if (predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${label} after ${resolvedTimeoutMs}ms`);
}
function setupChromaMocks() {
    const storedVectors = new Map<string, Record<string, unknown>>();
    const extractWhereValue = (where: Record<string, unknown> | undefined, key: string): unknown => {
        if (!where)
            return undefined;
        if (key in where) {
            return where[key];
        }
        const andConditions = Array.isArray(where.$and)
            ? (where.$and as Record<string, unknown>[])
            : [];
        for (const condition of andConditions) {
            if (key in condition) {
                return condition[key];
            }
        }
        return undefined;
    };
    const vectors = {
        addCalls: [] as Array<{
            ids: string[];
        }>,
        deleteCalls: [] as Array<{
            where?: Record<string, unknown>;
        }>,
        metadata: { lockedModelId: null as string | null },
        add: async (payload: {
            ids: string[];
            metadatas?: Record<string, unknown>[];
        }) => {
            vectors.addCalls.push(payload);
            for (const [index, id] of payload.ids.entries()) {
                storedVectors.set(id, payload.metadatas?.[index] ?? {});
            }
        },
        get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
        delete: async (payload?: {
            where?: Record<string, unknown>;
        }) => {
            vectors.deleteCalls.push(payload ?? {});
            const runId = extractWhereValue(payload?.where, 'runId');
            const root = extractWhereValue(payload?.where, 'root');
            const relPath = extractWhereValue(payload?.where, 'relPath');
            for (const [id, metadata] of storedVectors.entries()) {
                if ((runId === undefined || metadata.runId === runId) &&
                    (root === undefined || metadata.root === root) &&
                    (relPath === undefined || metadata.relPath === relPath)) {
                    storedVectors.delete(id);
                }
            }
        },
        modify: async ({ metadata }: {
            metadata?: Record<string, unknown>;
        }) => {
            vectors.metadata = {
                ...(vectors.metadata ?? {}),
                ...(metadata ?? {}),
            } as {
                lockedModelId: string | null;
            };
        },
        count: async () => storedVectors.size,
        storedVectors,
    };
    const roots = {
        addCalls: [] as Array<{
            ids: string[];
            embeddings: number[][];
            metadatas: Record<string, unknown>[];
        }>,
        dimension: 3,
        get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
        add: async (payload: {
            ids: string[];
            embeddings: number[][];
            metadatas: Record<string, unknown>[];
        }) => {
            roots.addCalls.push(payload);
        },
        delete: async () => { },
    };
    test.mock.method(ChromaClient.prototype, 'getOrCreateCollection', async (opts: {
        name?: string;
    }) => {
        if (opts.name === 'ingest_roots')
            return roots as never;
        return vectors as never;
    });
    test.mock.method(ChromaClient.prototype, 'deleteCollection', async () => { });
    return { vectors, roots };
}
function buildDeps(options: {
    onEmbedStart?: (text: string) => void;
    embedPromiseFactory: (text: string, options?: {
        signal?: AbortSignal;
    }) => Promise<{
        embedding: number[];
    }>;
}) {
    let embedCalls = 0;
    return {
        baseUrl: 'http://lmstudio.local',
        lmClientFactory: () => ({
            embedding: {
                model: async () => ({
                    embed: async (text: string, requestOptions?: {
                        signal?: AbortSignal;
                    }) => {
                        embedCalls += 1;
                        options.onEmbedStart?.(text);
                        return options.embedPromiseFactory(text, requestOptions);
                    },
                    getContextLength: async () => 256,
                    countTokens: async (text: string) => text.split(/\s+/).filter(Boolean).length,
                }),
            },
        }) as unknown as LMStudioClient,
        getEmbedCalls: () => embedCalls,
    };
}
test('ingest-cancel catch path logs retryable failures as warn', async () => {
    const response = await request(buildApp({
        cancelRun: async () => {
            const error = new Error('temporary unavailable');
            (error as {
                code?: string;
            }).code = 'BUSY';
            throw error;
        },
    })).post('/ingest/cancel/run-1');
    assert.equal(response.status, 429);
    assert.equal(response.body.code, 'BUSY');
    const entries = query({ text: 'DEV-0000036:T17:ingest_provider_failure' }, 20);
    const warnEntry = entries.find((entry) => entry.level === 'warn' &&
        entry.context?.surface === 'ingest/cancel' &&
        entry.context?.code === 'BUSY');
    assert.ok(warnEntry, 'expected warn-level cancel failure log');
    assert.equal(warnEntry?.context?.retryable, true);
});
test('ingest-cancel catch path logs non-retryable failures as error', async () => {
    const response = await request(buildApp({
        cancelRun: async () => {
            const error = new Error('lock metadata invalid');
            (error as {
                code?: string;
            }).code = 'INVALID_LOCK_METADATA';
            throw error;
        },
    })).post('/ingest/cancel/run-2');
    assert.equal(response.status, 500);
    assert.equal(response.body.code, 'INVALID_LOCK_METADATA');
    const entries = query({ text: 'DEV-0000036:T17:ingest_provider_failure' }, 20);
    const errorEntry = entries.find((entry) => entry.level === 'error' &&
        entry.context?.surface === 'ingest/cancel' &&
        entry.context?.code === 'INVALID_LOCK_METADATA');
    assert.ok(errorEntry, 'expected error-level cancel failure log');
    assert.equal(errorEntry?.context?.retryable, false);
});
test('cancel waits on an unresolved cleanup gate before newer queued work advances', async () => {
    const deleteGate = createDeferred<void>();
    const events: string[] = [];
    __setStatusForTest('run-cancel', {
        runId: 'run-cancel',
        state: 'embedding',
        counts: { files: 1, chunks: 1, embedded: 0 },
        message: 'Embedding',
        lastError: null,
    });
    __setJobInputForTest('run-cancel', {
        path: '/data/repo-cancel',
        name: 'repo-cancel',
        model: 'embed-1',
        operation: 'reembed',
    });
    __setQueueRequestIdForRunForTest('run-cancel', 'queue-cancel');
    setIngestDeps({
        lmClientFactory: () => ({}) as never,
        baseUrl: 'ws://host.docker.internal:1234',
    });
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async () => {
            events.push('delete-start');
            await deleteGate.promise;
            events.push('delete-complete');
            return {
                _id: { toString: () => 'queue-cancel' },
                canonicalTargetPath: '/data/repo-cancel',
                operation: 'reembed',
                queueState: 'running',
                requestPayload: { path: '/data/repo-cancel', model: 'embed-1' },
                runId: 'run-cancel',
            } as never;
        },
        findOldestCleanupBlockedQueueRequest: async () => null,
        markQueueRequestTerminalPublished: async () => null,
        promoteOldestWaitingQueueRequest: async (runId: string) => ({
            _id: { toString: () => 'queue-next' },
            canonicalTargetPath: '/data/repo-next',
            operation: 'reembed',
            queueState: 'running',
            requestPayload: {
                path: '/data/repo-next',
                name: 'repo-next',
                model: 'embed-1',
            },
            runId,
        }) as never,
    });
    __setRunProcessorForTest(async (runId, input) => {
        events.push(`start:${input.path}`);
        release(runId);
    });
    const cancelPromise = cancelRun('run-cancel');
    await waitForStatus('run-cancel', (status) => status?.state === 'cancelled' && events.includes('delete-start'));
    let resolvedEarly = false;
    void cancelPromise.then(() => {
        resolvedEarly = true;
    });
    await Promise.resolve();
    assert.equal(resolvedEarly, false);
    assert.deepEqual(events, ['delete-start']);
    deleteGate.resolve();
    const result = await cancelPromise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(result, { cleanupState: 'complete', found: true });
    assert.deepEqual(events, [
        'delete-start',
        'delete-complete',
        'start:/data/repo-next',
    ]);
});
test('cancel stops new embedding work immediately once dispatch has started', async () => {
    const { vectors } = setupChromaMocks();
    setScopedTestEnvValue("CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT", '1');
    setScopedTestEnvValue("CODEINFO_INGEST_MAX_QUEUE_SIZE", '0');
    const firstEmbedding = createDeferred<{
        embedding: number[];
    }>();
    const embedStarted = createDeferred<void>();
    const deps = buildDeps({
        onEmbedStart: () => {
            embedStarted.resolve();
        },
        embedPromiseFactory: async () => firstEmbedding.promise,
    });
    const { root, cleanup } = await createTempRepo({
        'a.txt': 'alpha beta gamma',
        'b.txt': 'delta epsilon zeta',
        'c.txt': 'eta theta iota',
    });
    try {
        const runId = await startIngest({
            path: root,
            name: 'cancel-stop-dispatch',
            model: 'embed-1',
        }, deps);
        await embedStarted.promise;
        await cancelRun(runId);
        firstEmbedding.resolve({ embedding: [0.1, 0.2, 0.3] });
        const finalStatus = await waitForTerminal(runId);
        assert.equal(finalStatus?.state, 'cancelled');
        assert.equal(deps.getEmbedCalls(), 1, 'cancel should stop any new dispatch after the first request');
        assert.equal(vectors.addCalls.length, 0, 'cancelled run should not persist embeddings after cleanup');
    }
    finally {
        await cleanup();
    }
});
test('cancel after production completes still reaches cancelled cleanup with queued work', async () => {
    const { vectors } = setupChromaMocks();
    setScopedTestEnvValue("CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT", '1');
    setScopedTestEnvValue("CODEINFO_INGEST_MAX_QUEUE_SIZE", '-1');
    const firstEmbedding = createDeferred<{
        embedding: number[];
    }>();
    const embedStarted = createDeferred<void>();
    const deps = buildDeps({
        onEmbedStart: () => {
            embedStarted.resolve();
        },
        embedPromiseFactory: async () => firstEmbedding.promise,
    });
    const { root, cleanup } = await createTempRepo({
        'a.txt': 'alpha beta gamma',
        'b.txt': 'delta epsilon zeta',
    });
    try {
        const runId = await startIngest({
            path: root,
            name: 'cancel-post-production-deadlock',
            model: 'embed-1',
        }, deps);
        await embedStarted.promise;
        await waitForStatus(runId, (status) => (status?.counts.chunks ?? 0) >= 2 && status?.state === 'embedding');
        await new Promise((resolve) => setTimeout(resolve, 0));
        await cancelRun(runId);
        firstEmbedding.resolve({ embedding: [0.1, 0.2, 0.3] });
        const finalStatus = await waitForTerminal(runId);
        assert.equal(finalStatus?.state, 'cancelled');
        assert.equal(deps.getEmbedCalls(), 1, 'cancel should not dispatch queued work after production completed');
        assert.equal(vectors.addCalls.length, 0, 'cancelled run should not persist embeddings after queued work is dropped');
    }
    finally {
        await cleanup();
    }
});
test('cancel after provider result resolution does not leave vectors behind', async () => {
    const { vectors } = setupChromaMocks();
    setScopedTestEnvValue("CODEINFO_INGEST_FLUSH_EVERY", '1');
    setScopedTestEnvValue("CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT", '1');
    setScopedTestEnvValue("CODEINFO_INGEST_MAX_QUEUE_SIZE", '-1');
    const persistStarted = createDeferred<void>();
    const releasePersist = createDeferred<void>();
    const originalAdd = vectors.add;
    vectors.add = async (payload) => {
        persistStarted.resolve();
        await releasePersist.promise;
        await originalAdd(payload);
    };
    const deps = buildDeps({
        embedPromiseFactory: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });
    const { root, cleanup } = await createTempRepo({
        'a.txt': 'alpha beta gamma',
    });
    try {
        const runId = await startIngest({
            path: root,
            name: 'cancel-after-result-before-persist',
            model: 'embed-1',
        }, deps);
        await persistStarted.promise;
        const cancelPromise = cancelRun(runId);
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(vectors.storedVectors.size, 0, 'persist should still be blocked when cancel cleanup starts');
        releasePersist.resolve();
        await cancelPromise;
        const finalStatus = await waitForTerminal(runId);
        await waitForCondition('cancelled vector cleanup', () => {
            return vectors.storedVectors.size === 0;
        });
        assert.equal(finalStatus?.state, 'cancelled');
        assert.equal(vectors.storedVectors.size, 0, 'cancelled run should not retain vectors written during the fenced persist window');
        assert.ok(vectors.deleteCalls.some((call) => {
            const where = call.where ?? {};
            return (where.runId === runId ||
                ((where.$and as Array<Record<string, unknown>> | undefined) ?? []).some((condition) => condition.runId === runId));
        }), 'expected cancel cleanup to delete vectors for the cancelled run');
    }
    finally {
        await cleanup();
    }
});
test('cancel after dispatcher drain does not overwrite terminal state back to completed', async () => {
    const { roots } = setupChromaMocks();
    const completedRootWriteStarted = createDeferred<void>();
    const releaseCompletedRootWrite = createDeferred<void>();
    const originalRootsAdd = roots.add;
    roots.add = async (payload) => {
        const state = payload.metadatas?.[0]?.state;
        if (state === 'completed') {
            completedRootWriteStarted.resolve();
            await releaseCompletedRootWrite.promise;
        }
        await originalRootsAdd(payload);
    };
    const deps = buildDeps({
        embedPromiseFactory: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });
    const { root, cleanup } = await createTempRepo({
        'a.txt': 'alpha beta gamma',
    });
    try {
        const runId = await startIngest({
            path: root,
            name: 'cancel-after-dispatch-drain',
            model: 'embed-1',
        }, deps);
        await completedRootWriteStarted.promise;
        const cancelPromise = cancelRun(runId);
        await new Promise((resolve) => setTimeout(resolve, 0));
        releaseCompletedRootWrite.resolve();
        await cancelPromise;
        const finalStatus = await waitForTerminal(runId);
        assert.equal(finalStatus?.state, 'cancelled');
        assert.equal(roots.addCalls.at(-1)?.metadatas?.[0]?.state, 'cancelled', 'final root metadata should converge on cancelled after late cancel');
        assert.equal(query({ text: 'ingest completed' }, 20).filter((entry) => entry.context?.runId === runId).length, 0, 'late cancel should prevent the worker from publishing completed');
    }
    finally {
        await cleanup();
    }
});
test('cancel after the last fenced finalization step does not publish completed or skipped', async () => {
    const { roots } = setupChromaMocks();
    const beforeTerminalPublishStarted = createDeferred<void>();
    const releaseTerminalPublish = createDeferred<void>();
    __setBeforeTerminalStatusPublishHookForTest(async () => {
        beforeTerminalPublishStarted.resolve();
        await releaseTerminalPublish.promise;
    });
    const deps = buildDeps({
        embedPromiseFactory: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });
    const { root, cleanup } = await createTempRepo({
        'a.txt': 'alpha beta gamma',
    });
    try {
        const runId = await startIngest({
            path: root,
            name: 'cancel-before-final-terminal-publish',
            model: 'embed-1',
        }, deps);
        await beforeTerminalPublishStarted.promise;
        const cancelPromise = cancelRun(runId);
        await new Promise((resolve) => setTimeout(resolve, 0));
        releaseTerminalPublish.resolve();
        await cancelPromise;
        const finalStatus = await waitForTerminal(runId);
        assert.equal(finalStatus?.state, 'cancelled');
        assert.equal(roots.addCalls.at(-1)?.metadatas?.[0]?.state, 'cancelled', 'late cancel should win over the final terminal publish window');
        assert.equal(query({ text: 'ingest completed' }, 20).filter((entry) => entry.context?.runId === runId).length, 0, 'late cancel should prevent the worker from publishing completed');
        assert.equal(query({ text: 'ingest skipped' }, 20).filter((entry) => entry.context?.runId === runId).length, 0, 'late cancel should prevent the worker from publishing skipped');
    }
    finally {
        __setBeforeTerminalStatusPublishHookForTest(null);
        await cleanup();
    }
});
test('late cancel on delta no-op reembed does not overwrite terminal state back to completed', async () => {
    const { roots } = setupChromaMocks();
    const completedRootWriteStarted = createDeferred<void>();
    const releaseCompletedRootWrite = createDeferred<void>();
    const originalRootsAdd = roots.add;
    roots.add = async (payload) => {
        const state = payload.metadatas?.[0]?.state;
        if (state === 'completed') {
            completedRootWriteStarted.resolve();
            await releaseCompletedRootWrite.promise;
        }
        await originalRootsAdd(payload);
    };
    const { root, cleanup } = await createTempRepo({
        'docs/notes.txt': 'alpha beta gamma\n',
    });
    try {
        const fileHash = await hashFile(path.join(root, 'docs/notes.txt'));
        test.mock.method(IngestFileModel, 'find', () => ({
            select: () => ({
                lean: () => ({
                    exec: async () => [{ relPath: 'docs/notes.txt', fileHash }],
                }),
            }),
        }));
        const runId = await startIngest({
            path: root,
            name: 'cancel-delta-noop-fast-path',
            model: 'embed-1',
            operation: 'reembed',
        }, buildDeps({
            embedPromiseFactory: async () => ({ embedding: [0.1, 0.2, 0.3] }),
        }));
        await completedRootWriteStarted.promise;
        const cancelPromise = cancelRun(runId);
        await new Promise((resolve) => setTimeout(resolve, 0));
        releaseCompletedRootWrite.resolve();
        await cancelPromise;
        const finalStatus = await waitForTerminal(runId);
        assert.equal(finalStatus?.state, 'cancelled');
        assert.equal(roots.addCalls.at(-1)?.metadatas?.[0]?.state, 'cancelled', 'delta no-op fast path should converge on cancelled after late cancel');
        assert.equal(query({ text: 'ingest completed' }, 20).filter((entry) => entry.context?.runId === runId).length, 0, 'late cancel should prevent delta no-op fast path from publishing completed');
    }
    finally {
        await cleanup();
    }
});
test('cancelled delta no-op reembed does not regress back to embedding after the worker resumes', async () => {
    setupChromaMocks();
    const previousIndexGate = createDeferred<void>();
    const { root, cleanup } = await createTempRepo({
        'docs/notes.txt': 'alpha beta gamma\n',
    });
    const previousReadyState = (mongoose.connection as unknown as {
        readyState: number;
    }).readyState;
    try {
        (mongoose.connection as unknown as {
            readyState: number;
        }).readyState = 1;
        const fileHash = await hashFile(path.join(root, 'docs/notes.txt'));
        test.mock.method(IngestFileModel, 'find', () => ({
            select: () => ({
                lean: () => ({
                    exec: async () => {
                        await previousIndexGate.promise;
                        return [{ root, relPath: 'docs/notes.txt', fileHash }];
                    },
                }),
            }),
        }));
        const runId = await startIngest({
            path: root,
            name: 'cancel-delta-noop-status-monotonic',
            model: 'embed-1',
            operation: 'reembed',
        }, buildDeps({
            embedPromiseFactory: async () => ({ embedding: [0.1, 0.2, 0.3] }),
        }));
        await waitForStatus(runId, (status) => status?.state === 'scanning');
        await cancelRun(runId);
        assert.equal(getStatus(runId)?.state, 'cancelled');
        previousIndexGate.resolve();
        await waitForCondition('delta no-op worker resume', () => {
            return query({ text: 'REEMBED_NO_CHANGE_EARLY_RETURN' }, 20).some((entry) => entry.context?.runId === runId);
        });
        const observedStates = new Set<string>();
        const startedAt = Date.now();
        const timeoutMs = resolveConfiguredTestTimeoutMs(300);
        while (Date.now() - startedAt < timeoutMs) {
            observedStates.add(String(getStatus(runId)?.state ?? 'missing'));
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.deepEqual([...observedStates], ['cancelled'], `expected cancelled to remain monotonic after worker resume, observed ${[...observedStates].join(' -> ')}`);
    }
    finally {
        (mongoose.connection as unknown as {
            readyState: number;
        }).readyState =
            previousReadyState;
        previousIndexGate.resolve();
        await cleanup();
    }
});
test('late cancel on deletions-only reembed does not publish completed or skipped', async () => {
    const { roots } = setupChromaMocks();
    const beforeTerminalPublishStarted = createDeferred<void>();
    const releaseTerminalPublish = createDeferred<void>();
    __setBeforeTerminalStatusPublishHookForTest(async () => {
        beforeTerminalPublishStarted.resolve();
        await releaseTerminalPublish.promise;
    });
    const { root, cleanup } = await createTempRepo({
        'docs/deleted.txt': 'to be removed\n',
    });
    try {
        test.mock.method(IngestFileModel, 'find', () => ({
            select: () => ({
                lean: () => ({
                    exec: async () => [
                        { relPath: 'docs/deleted.txt', fileHash: 'deleted-hash' },
                    ],
                }),
            }),
        }));
        await fs.rm(path.join(root, 'docs/deleted.txt'));
        setScopedTestEnvValue("CODEINFO_INGEST_TEST_GIT_PATHS", '');
        const runId = await startIngest({
            path: root,
            name: 'cancel-delta-deletions-fast-path',
            model: 'embed-1',
            operation: 'reembed',
        }, buildDeps({
            embedPromiseFactory: async () => ({ embedding: [0.1, 0.2, 0.3] }),
        }));
        await beforeTerminalPublishStarted.promise;
        const cancelPromise = cancelRun(runId);
        await new Promise((resolve) => setTimeout(resolve, 0));
        releaseTerminalPublish.resolve();
        await cancelPromise;
        const finalStatus = await waitForTerminal(runId);
        assert.equal(finalStatus?.state, 'cancelled');
        assert.equal(roots.addCalls.at(-1)?.metadatas?.[0]?.state, 'cancelled', 'deletions-only fast path should converge on cancelled after late cancel');
        assert.equal(query({ text: 'ingest completed' }, 20).filter((entry) => entry.context?.runId === runId).length, 0, 'late cancel should prevent deletions-only fast path from publishing completed');
        assert.equal(query({ text: 'ingest skipped' }, 20).filter((entry) => entry.context?.runId === runId).length, 0, 'late cancel should prevent deletions-only fast path from publishing skipped');
    }
    finally {
        __setBeforeTerminalStatusPublishHookForTest(null);
        await cleanup();
    }
});
test('cancel does not issue a fresh dimension probe when lookup fails', async () => {
    const { roots } = setupChromaMocks();
    setScopedTestEnvValue("CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT", '1');
    setScopedTestEnvValue("CODEINFO_INGEST_MAX_QUEUE_SIZE", '0');
    const firstEmbedding = createDeferred<{
        embedding: number[];
    }>();
    const embedStarted = createDeferred<void>();
    roots.get = async () => ({ embeddings: [] });
    Reflect.deleteProperty(roots, 'dimension');
    const deps = buildDeps({
        onEmbedStart: () => {
            embedStarted.resolve();
        },
        embedPromiseFactory: async () => firstEmbedding.promise,
    });
    const { root, cleanup } = await createTempRepo({
        'a.txt': 'alpha beta gamma',
    });
    try {
        const runId = await startIngest({
            path: root,
            name: 'cancel-no-dimension-probe',
            model: 'embed-1',
        }, deps);
        await embedStarted.promise;
        await cancelRun(runId);
        firstEmbedding.resolve({ embedding: [0.1, 0.2, 0.3] });
        const finalStatus = await waitForTerminal(runId);
        assert.equal(finalStatus?.state, 'cancelled');
        assert.equal(deps.getEmbedCalls(), 1, 'cancel fallback should not issue a second embedding call for dimension probing');
        assert.equal(roots.addCalls.length, 1);
        assert.equal(roots.addCalls[0]?.embeddings[0]?.length, 1);
        assert.equal(roots.addCalls[0]?.metadatas[0]?.embeddingDimensions, 1);
    }
    finally {
        await cleanup();
    }
});
test('cancel reuses the roots collection dimension when rows were removed first', async () => {
    const { roots } = setupChromaMocks();
    setScopedTestEnvValue("CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT", '1');
    setScopedTestEnvValue("CODEINFO_INGEST_MAX_QUEUE_SIZE", '0');
    const firstEmbedding = createDeferred<{
        embedding: number[];
    }>();
    const embedStarted = createDeferred<void>();
    let rootsCleared = false;
    roots.dimension = 2560;
    roots.get = async () => ({
        embeddings: rootsCleared ? [] : [[0.1, 0.2, 0.3]],
    });
    roots.delete = async () => {
        rootsCleared = true;
    };
    const deps = buildDeps({
        onEmbedStart: () => {
            embedStarted.resolve();
        },
        embedPromiseFactory: async () => firstEmbedding.promise,
    });
    const { root, cleanup } = await createTempRepo({
        'large.md': '# heading\n\n' + 'alpha beta gamma '.repeat(5000),
    });
    try {
        const runId = await startIngest({
            path: root,
            name: 'cancel-roots-dimension',
            model: 'embed-1',
        }, deps);
        await embedStarted.promise;
        await cancelRun(runId);
        firstEmbedding.resolve({ embedding: [0.1, 0.2, 0.3] });
        const finalStatus = await waitForTerminal(runId);
        assert.equal(finalStatus?.state, 'cancelled');
        assert.equal(roots.addCalls.length, 1);
        assert.equal(roots.addCalls[0]?.embeddings[0]?.length, 2560);
        assert.equal(roots.addCalls[0]?.metadatas[0]?.embeddingDimensions, 2560);
    }
    finally {
        await cleanup();
    }
});
test('late provider results are ignored after cancel instead of being written', async () => {
    const resultDeferred = createDeferred<number[][]>();
    let cancelled = false;
    const persisted: string[] = [];
    let lateResultIgnored = false;
    const dispatcher = createEmbeddingDispatcher({
        model: {
            modelKey: 'cancel-proof',
            effectiveBatchSize: 1,
            supportsAbort: false,
            async embedText() {
                return [0.1];
            },
            async embedBatch() {
                return resultDeferred.promise;
            },
            async countTokens(text: string) {
                return text.split(/\s+/).filter(Boolean).length;
            },
            async getContextLength() {
                return 64;
            },
        },
        effectiveBatchSize: 1,
        maxInFlight: 1,
        maxQueueSize: 1,
        isCancelled: () => cancelled,
        onDispatch: () => { },
        onCompleted: async (results) => {
            persisted.push(...results.map((result) => result.text));
        },
        onLateResultIgnored: () => {
            lateResultIgnored = true;
        },
    });
    await dispatcher.enqueue({
        sequence: 0,
        text: 'alpha beta gamma',
        meta: null,
    });
    dispatcher.completeProduction();
    await new Promise((resolve) => setTimeout(resolve, 0));
    cancelled = true;
    dispatcher.cancel();
    resultDeferred.resolve([[0.4, 0.5, 0.6]]);
    await dispatcher.waitForIdle();
    assert.deepEqual(persisted, [], 'late result should be ignored instead of written after cancel');
    assert.equal(lateResultIgnored, true);
});
test('wrapped abort errors from LM Studio still converge to cancelled after cancel', async () => {
    const embedStarted = createDeferred<void>();
    const deps = buildDeps({
        onEmbedStart: () => {
            embedStarted.resolve();
        },
        embedPromiseFactory: async (_text, options) => await new Promise<{
            embedding: number[];
        }>((_resolve, reject) => {
            const abortError = new Error('aborted');
            abortError.name = 'AbortError';
            if (options?.signal?.aborted) {
                reject(abortError);
                return;
            }
            options?.signal?.addEventListener('abort', () => reject(abortError), {
                once: true,
            });
        }),
    });
    const { root, cleanup } = await createTempRepo({
        'a.txt': 'alpha beta gamma',
        'b.txt': 'delta epsilon zeta',
    });
    try {
        const runId = await startIngest({
            path: root,
            name: 'cancel-wrapped-abort',
            model: 'embed-1',
        }, deps);
        await embedStarted.promise;
        await cancelRun(runId);
        const finalStatus = await waitForTerminal(runId);
        assert.equal(finalStatus?.state, 'cancelled');
    }
    finally {
        await cleanup();
    }
});
