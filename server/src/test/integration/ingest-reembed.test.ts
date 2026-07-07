import assert from 'node:assert/strict';
import test from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';
import { __finalizeQueueRequestForRunForTest, __resetIngestJobsForTest, __setQueueRequestIdForRunForTest, __setQueueRuntimeOpsForTest, __setRunProcessorForTest, __setStatusForTest, getActiveStatus, pumpIngestQueue, recoverIngestQueueOnStartup, setIngestDeps, } from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import type { CurrentQueueRequestPositionResult, EnqueueIngestRequestResult, } from '../../ingest/requestQueue.js';
import type { ListReposResult, RepoEntry } from '../../lmstudio/toolService.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';
function waitForNextTurn() {
    return new Promise<void>((resolve) => {
        setImmediate(resolve);
    });
}
function setNoopQueueRuntimeOps() {
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
}
function buildReembedRepo(): RepoEntry {
    return {
        id: 'repo',
        name: 'repo',
        description: null,
        containerPath: '/tmp/reembed-root',
        hostPath: '/host/tmp/reembed-root',
        lastIngestAt: '2026-01-01T00:00:00.000Z',
        embeddingProvider: 'lmstudio',
        embeddingModel: 'embed-1',
        embeddingDimensions: 768,
        model: 'embed-1',
        modelId: 'embed-1',
        lock: {
            embeddingProvider: 'lmstudio',
            embeddingModel: 'embed-1',
            embeddingDimensions: 768,
            lockedModelId: 'embed-1',
            modelId: 'embed-1',
        },
        counts: { files: 1, chunks: 1, embedded: 1 },
        lastError: null,
    };
}
function buildReembedApp(options?: {
    listIngestedRepositories?: () => Promise<ListReposResult>;
    enqueueOrReuseIngestRequest?: () => Promise<EnqueueIngestRequestResult>;
    getCurrentQueueRequestPosition?: (requestId: string) => Promise<CurrentQueueRequestPositionResult>;
}) {
    const app = express();
    let lastQueueResult: EnqueueIngestRequestResult | null = null;
    app.use(express.json());
    app.use(createIngestReembedRouter({
        clientFactory: () => ({}) as LMStudioClient,
        listIngestedRepositories: async () => options?.listIngestedRepositories
            ? options.listIngestedRepositories()
            : {
                repos: [buildReembedRepo()],
                lockedModelId: 'embed-1',
            },
        enqueueOrReuseIngestRequest: async () => {
            const result: EnqueueIngestRequestResult = options?.enqueueOrReuseIngestRequest
                ? await options.enqueueOrReuseIngestRequest()
                : {
                    requestId: 'queue-request-123',
                    canonicalTargetPath: '/tmp/reembed-root',
                    queueState: 'waiting',
                    queuePosition: 1,
                    runId: null,
                    reusedExisting: false,
                    updatedExisting: false,
                    queueRequest: {} as EnqueueIngestRequestResult['queueRequest'],
                };
            lastQueueResult = result;
            return result;
        },
        getCurrentQueueRequestPosition: async (requestId) => options?.getCurrentQueueRequestPosition
            ? options.getCurrentQueueRequestPosition(requestId)
            : {
                requestId,
                queueState: lastQueueResult?.queueState ?? null,
                queuePosition: lastQueueResult?.queuePosition ?? null,
                runId: lastQueueResult?.runId ?? null,
            },
        pumpIngestQueue: async () => ({
            started: false,
            blockedByCleanup: false,
            requestId: null,
            runId: null,
        }),
    }));
    return app;
}
test.beforeEach(() => {
    setScopedTestEnvValue("NODE_ENV", 'test');
    __resetIngestJobsForTest();
    release();
    setIngestDeps({
        lmClientFactory: () => ({}) as never,
        baseUrl: 'ws://host.docker.internal:1234',
    });
});
test.afterEach(() => {
    setNoopQueueRuntimeOps();
    __setRunProcessorForTest(null);
    __resetIngestJobsForTest();
    release();
});
test('startup recovery does not replay committed-before-cleanup running work', async () => {
    const events: string[] = [];
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async () => ({
            _id: { toString: () => 'queue-running' },
            canonicalTargetPath: '/data/repo-running',
            operation: 'reembed',
            queueState: 'running',
            requestPayload: {
                path: '/data/repo-running',
                name: 'repo-running',
                model: 'embed-1',
            },
            runId: 'run-recovered',
            terminalPublishedAt: new Date('2026-01-01T00:00:05.000Z'),
        }) as never,
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => ({
            _id: { toString: () => 'queue-running' },
            canonicalTargetPath: '/data/repo-running',
            operation: 'reembed',
            queueState: 'running',
            requestPayload: {
                path: '/data/repo-running',
                name: 'repo-running',
                model: 'embed-1',
            },
            runId: 'run-recovered',
            terminalPublishedAt: new Date('2026-01-01T00:00:05.000Z'),
        }) as never,
        markQueueRequestTerminalPublished: async () => null,
        promoteOldestWaitingQueueRequest: async () => {
            events.push('waiting-promoted');
            return null;
        },
    });
    __setRunProcessorForTest(async (runId, input) => {
        events.push(`started:${runId}:${input.path}`);
        release(runId);
    });
    const result = await recoverIngestQueueOnStartup();
    await waitForNextTurn();
    assert.equal(result.recovered, true);
    assert.deepEqual(events, ['waiting-promoted']);
});
test('startup recovery still retries leftover running work before newer waiting work', async () => {
    const events: string[] = [];
    __setQueueRuntimeOpsForTest({
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => ({
            _id: { toString: () => 'queue-running' },
            canonicalTargetPath: '/data/repo-running',
            operation: 'reembed',
            queueState: 'running',
            requestPayload: {
                path: '/data/repo-running',
                name: 'repo-running',
                model: 'embed-1',
            },
            runId: 'run-recovered',
        }) as never,
        promoteOldestWaitingQueueRequest: async () => {
            events.push('waiting-promoted');
            return null;
        },
    });
    __setRunProcessorForTest(async (runId, input) => {
        events.push(`started:${runId}:${input.path}`);
        release(runId);
    });
    const result = await recoverIngestQueueOnStartup();
    await waitForNextTurn();
    assert.equal(result.recovered, true);
    assert.deepEqual(events, ['started:run-recovered:/data/repo-running']);
});
test('cleanup boundary exposes a deterministic next-item-not-started state before queue advancement', async () => {
    const deleteGate = (() => {
        let resolve!: () => void;
        const promise = new Promise<void>((nextResolve) => {
            resolve = nextResolve;
        });
        return { promise, resolve };
    })();
    const events: string[] = [];
    __setStatusForTest('run-finished', {
        runId: 'run-finished',
        state: 'completed',
        counts: { files: 1, chunks: 1, embedded: 1 },
        message: 'Completed',
        lastError: null,
    });
    __setQueueRequestIdForRunForTest('run-finished', 'queue-finished');
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async () => {
            events.push('delete-start');
            await deleteGate.promise;
            events.push('delete-complete');
            return {
                _id: { toString: () => 'queue-finished' },
                canonicalTargetPath: '/data/repo-finished',
                operation: 'reembed',
                queueState: 'running',
                requestPayload: { path: '/data/repo-finished', model: 'embed-1' },
                runId: 'run-finished',
            } as never;
        },
        findOldestCleanupBlockedQueueRequest: async () => null,
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
    const finalizePromise = __finalizeQueueRequestForRunForTest('run-finished');
    await waitForNextTurn();
    assert.deepEqual(events, ['delete-start']);
    assert.equal(getActiveStatus(), null);
    const stalledWhileCleanupPending = await pumpIngestQueue();
    assert.equal(stalledWhileCleanupPending.started, false);
    assert.equal(stalledWhileCleanupPending.blockedByCleanup, true);
    deleteGate.resolve();
    await finalizePromise;
    for (let attempt = 0; attempt < 10 && events.length < 3; attempt += 1) {
        await waitForNextTurn();
    }
    assert.deepEqual(events, [
        'delete-start',
        'delete-complete',
        'start:/data/repo-next',
    ]);
});
test('ingest-reembed rejects a dot-segment root alias through the public route before queue admission', async () => {
    let enqueueCalled = false;
    const response = await request(buildReembedApp({
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return {
                requestId: 'queue-request-123',
                canonicalTargetPath: '/tmp/reembed-root',
                queueState: 'waiting',
                queuePosition: 1,
                runId: null,
                reusedExisting: false,
                updatedExisting: false,
                queueRequest: {} as EnqueueIngestRequestResult['queueRequest'],
            };
        },
    })).post('/ingest/reembed/%2Ftmp%2Freembed-root%2F..%2Freembed-root');
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'NOT_FOUND');
    assert.equal(enqueueCalled, false);
});
test('ingest-reembed rejects a whitespace-only root through the public route before repo-list dependency I/O can run', async () => {
    let listCalls = 0;
    const response = await request(buildReembedApp({
        listIngestedRepositories: async () => {
            listCalls += 1;
            const error = new Error('repo list should not run');
            (error as {
                code?: string;
            }).code = 'QUEUE_UNAVAILABLE';
            throw error;
        },
    })).post('/ingest/reembed/%20%20%20');
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'NOT_FOUND');
    assert.equal(listCalls, 0);
});
test('ingest-reembed keeps OPENAI_MODEL_UNAVAILABLE as a structured pre-run route contract without queuing work', async () => {
    let enqueueCalled = false;
    const response = await request(buildReembedApp({
        listIngestedRepositories: async () => ({
            repos: [
                {
                    ...buildReembedRepo(),
                    embeddingProvider: 'openai',
                    embeddingModel: 'text-embedding-ada-002',
                    model: 'openai/text-embedding-ada-002',
                    modelId: 'openai/text-embedding-ada-002',
                    lock: {
                        embeddingProvider: 'openai',
                        embeddingModel: 'text-embedding-ada-002',
                        embeddingDimensions: 1536,
                        lockedModelId: 'openai/text-embedding-ada-002',
                        modelId: 'openai/text-embedding-ada-002',
                    },
                },
            ],
            lockedModelId: 'openai/text-embedding-ada-002',
        }),
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return {
                requestId: 'queue-request-123',
                canonicalTargetPath: '/tmp/reembed-root',
                queueState: 'waiting',
                queuePosition: 1,
                runId: null,
                reusedExisting: false,
                updatedExisting: false,
                queueRequest: {} as EnqueueIngestRequestResult['queueRequest'],
            };
        },
    })).post('/ingest/reembed/%2Ftmp%2Freembed-root');
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
        status: 'error',
        code: 'OPENAI_MODEL_UNAVAILABLE',
    });
    assert.equal(enqueueCalled, false);
});
test('ingest-reembed keeps the queue-aware acceptance contract for valid requests after the admission guard repair', async () => {
    let enqueueCalled = false;
    const response = await request(buildReembedApp({
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return {
                requestId: 'queue-request-123',
                canonicalTargetPath: '/tmp/reembed-root',
                queueState: 'waiting',
                queuePosition: 1,
                runId: null,
                reusedExisting: false,
                updatedExisting: false,
                queueRequest: {} as EnqueueIngestRequestResult['queueRequest'],
            };
        },
    })).post('/ingest/reembed/%2Ftmp%2Freembed-root');
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, {
        queued: true,
        requestId: 'queue-request-123',
        queuePosition: 1,
    });
    assert.equal(enqueueCalled, true);
});
