import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { getLockedEmbeddingModel } from '../../ingest/chromaClient.js';
import { __setQueueRuntimeOpsForTest, __setRunProcessorForTest, __setRunSchedulerForTest, getStatus, pumpIngestQueue, } from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import * as requestQueue from '../../ingest/requestQueue.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import { createQueueRequest, createTempRepo, installQueueRuntimeTestHooks, setupIngestChromaMocks, waitForQueueManagedTerminalStatus, waitForNextTurn, } from './ingest-queue-runtime.helpers.js';
installQueueRuntimeTestHooks();
test('queue pump immediately promotes the oldest eligible queue item when the ingest lock is idle', async () => {
    const promoted = createQueueRequest({
        requestId: '1',
        root: '/data/repo-one',
        queueState: 'running',
        runId: 'pump-run-1',
    });
    let capturedRunId = '';
    let capturedPath = '';
    __setQueueRuntimeOpsForTest({
        findOldestCleanupBlockedQueueRequest: async () => null,
        promoteOldestWaitingQueueRequest: async (runId: string) => {
            capturedRunId = runId;
            return { ...promoted, runId };
        },
    });
    __setRunProcessorForTest(async (runId, input) => {
        capturedRunId = runId;
        capturedPath = input.path;
        release(runId);
    });
    const result = await pumpIngestQueue();
    await waitForNextTurn();
    assert.equal(result.started, true);
    assert.equal(result.blockedByCleanup, false);
    assert.equal(result.requestId, requestQueue.getQueueRequestId(promoted));
    assert.equal(capturedPath, '/data/repo-one');
    assert.equal(getStatus(capturedRunId)?.state, 'queued');
});
test('queue pump preserves FIFO waiting order by not starting the next item while the first run still owns the lock', async () => {
    const queueRequests = [
        createQueueRequest({
            requestId: '2',
            root: '/data/repo-first',
            queueState: 'running',
        }),
        createQueueRequest({
            requestId: '3',
            root: '/data/repo-second',
            queueState: 'running',
        }),
    ];
    const startedRoots: string[] = [];
    let releaseFirstRun: (() => void) | null = null;
    __setQueueRuntimeOpsForTest({
        findOldestCleanupBlockedQueueRequest: async () => null,
        promoteOldestWaitingQueueRequest: async (runId: string) => {
            const next = queueRequests.shift();
            return next ? { ...next, runId } : null;
        },
    });
    __setRunProcessorForTest(async (runId, input) => {
        startedRoots.push(input.path);
        if (input.path === '/data/repo-first') {
            await new Promise<void>((resolve) => {
                releaseFirstRun = () => {
                    release(runId);
                    resolve();
                };
            });
            return;
        }
        release(runId);
    });
    const first = await pumpIngestQueue();
    await waitForNextTurn();
    const secondWhileLocked = await pumpIngestQueue();
    assert.equal(first.started, true);
    assert.equal(secondWhileLocked.started, false);
    assert.deepEqual(startedRoots, ['/data/repo-first']);
    if (!releaseFirstRun) {
        throw new Error('expected first run release hook to be captured');
    }
    (releaseFirstRun as () => void)();
    await waitForNextTurn();
    const secondAfterRelease = await pumpIngestQueue();
    await waitForNextTurn();
    assert.equal(secondAfterRelease.started, true);
    assert.deepEqual(startedRoots, ['/data/repo-first', '/data/repo-second']);
});
test('queue pump creates the real runId only when queued work actually starts', async () => {
    const promoted = createQueueRequest({
        requestId: '4',
        root: '/data/repo-runid',
        queueState: 'running',
    });
    let promotedRunId = '';
    __setQueueRuntimeOpsForTest({
        findOldestCleanupBlockedQueueRequest: async () => null,
        promoteOldestWaitingQueueRequest: async (runId: string) => {
            promotedRunId = runId;
            return { ...promoted, runId };
        },
    });
    __setRunProcessorForTest(async () => { });
    const result = await pumpIngestQueue();
    assert.equal(result.started, true);
    assert.ok(promotedRunId.length > 0);
    assert.equal(getStatus(promotedRunId)?.runId, promotedRunId);
});
test('queue promotion rejects missing start_ingest requestPayload.name before discovery and still allows the next valid waiting start request to run', async () => {
    setupIngestChromaMocks();
    const { root: validRoot, cleanup } = await createTempRepo({
        'src/valid.ts': 'export const valid = true;\n',
    });
    try {
        const scheduledRuns: Array<() => void> = [];
        __setRunSchedulerForTest((task) => {
            scheduledRuns.push(task);
        });
        const malformed = createQueueRequest({
            requestId: 'start-missing-name',
            root: '/missing/start-without-name',
            operation: 'start',
            queueState: 'running',
        });
        delete malformed.requestPayload.name;
        const valid = createQueueRequest({
            requestId: 'start-valid-waiting',
            root: validRoot,
            operation: 'start',
            queueState: 'running',
        });
        const queueRequests = [malformed, valid];
        let promotedMalformedRunId = '';
        const startedPaths: string[] = [];
        __setQueueRuntimeOpsForTest({
            deleteQueueRequestById: async () => null,
            findOldestCleanupBlockedQueueRequest: async () => null,
            markQueueRequestNonReplayable: async () => null,
            markQueueRequestTerminalPublished: async () => null,
            promoteOldestWaitingQueueRequest: async (runId: string) => {
                const next = queueRequests.shift();
                if (!next) {
                    return null;
                }
                if (next === malformed) {
                    promotedMalformedRunId = runId;
                }
                return { ...next, runId };
            },
        });
        const malformedResult = await pumpIngestQueue();
        assert.equal(malformedResult.started, true);
        assert.equal(scheduledRuns.length, 1);
        scheduledRuns.shift()?.();
        const malformedTerminal = await waitForQueueManagedTerminalStatus(malformedResult.requestId as string, 1000);
        await waitForNextTurn();
        await waitForNextTurn();
        assert.equal(malformedTerminal.state, 'error');
        assert.equal(malformedTerminal.lastError, 'path and name are required');
        assert.equal(malformedTerminal.error?.error, 'VALIDATION');
        assert.equal(getStatus(promotedMalformedRunId)?.state, 'error', 'missing requestPayload.name should fail before queue promotion reaches discovery work');
        __setRunProcessorForTest(async (runId, input) => {
            startedPaths.push(input.path);
            release(runId);
        });
        const validScheduledDeadline = Date.now() + 1000;
        while (Date.now() < validScheduledDeadline && scheduledRuns.length < 1) {
            await waitForNextTurn();
        }
        assert.equal(scheduledRuns.length >= 1, true);
        scheduledRuns.shift()?.();
        await waitForNextTurn();
        assert.deepEqual(startedPaths, [validRoot]);
    }
    finally {
        await cleanup();
    }
});
test('queue promotion rejects queued zero-work reembed drift at execution time and releases queue ownership cleanly', async () => {
    const { vectors } = setupIngestChromaMocks();
    const { root, cleanup } = await createTempRepo({
        'src/blank.ts': '   \n\t\n',
    });
    const deletedRequestIds: string[] = [];
    const events: string[] = [];
    try {
        const blankFileHash = 'blank-file-hash';
        mock.method(IngestFileModel, 'find', (query: {
            root?: string;
        }) => ({
            select: () => ({
                lean: () => ({
                    exec: async () => query.root === root
                        ? [{ relPath: 'src/blank.ts', fileHash: blankFileHash }]
                        : [],
                }),
            }),
        }));
        await getLockedEmbeddingModel();
        vectors.metadata = {
            lockedModelId: 'embed-locked',
            embeddingProvider: 'lmstudio',
            embeddingModel: 'embed-locked',
            embeddingDimensions: 768,
        };
        const promoted = createQueueRequest({
            requestId: '5',
            root,
            queueState: 'running',
        });
        let promotedOnce = false;
        __setQueueRuntimeOpsForTest({
            deleteQueueRequestById: async (deletedRequestId: string) => {
                events.push(`delete:${deletedRequestId}`);
                deletedRequestIds.push(deletedRequestId);
                return null;
            },
            findOldestCleanupBlockedQueueRequest: async () => null,
            markQueueRequestNonReplayable: async ({ requestId, runId }) => {
                events.push(`barrier:${runId}:${requestId}`);
                return createQueueRequest({
                    requestId,
                    root,
                    queueState: 'running',
                    runId,
                    nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
                });
            },
            markQueueRequestTerminalPublished: async () => null,
            promoteOldestWaitingQueueRequest: async (runId: string) => {
                if (promotedOnce) {
                    return null;
                }
                promotedOnce = true;
                return {
                    ...promoted,
                    runId,
                    requestPayload: {
                        ...promoted.requestPayload,
                        path: root,
                        canonicalTargetPath: `${root}-queued`,
                        model: 'embed-1',
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 'embed-1',
                        operation: 'reembed',
                    },
                };
            },
        });
        const result = await pumpIngestQueue();
        assert.equal(result.started, true);
        assert.ok(result.runId);
        const terminal = await waitForQueueManagedTerminalStatus(result.requestId as string, 1000);
        await waitForNextTurn();
        await waitForNextTurn();
        assert.equal(terminal.state, 'error');
        assert.equal(terminal.lastError, 'MODEL_LOCKED');
        assert.ok(deletedRequestIds.length >= 1, 'promotion-time rejection should still finalize and release the queued request');
        assert.equal(events[0]?.startsWith('barrier:'), true);
        assert.equal(events[1], `delete:${deletedRequestIds[0]}`);
        const afterTerminal = await pumpIngestQueue();
        assert.equal(afterTerminal.started, false);
        assert.equal(afterTerminal.blockedByCleanup, false);
        assert.equal(afterTerminal.runId, null);
    }
    finally {
        await cleanup();
    }
});
test('queue promotion rejects bogus canonical provider even when a legacy model is also present and releases queue ownership cleanly', async () => {
    setupIngestChromaMocks();
    const { root, cleanup } = await createTempRepo({
        'src/index.ts': 'export const value = 1;\n',
    });
    const deletedRequestIds: string[] = [];
    try {
        const promoted = createQueueRequest({
            requestId: '6',
            root,
            queueState: 'running',
        });
        let promotedOnce = false;
        __setQueueRuntimeOpsForTest({
            deleteQueueRequestById: async (deletedRequestId: string) => {
                deletedRequestIds.push(deletedRequestId);
                return null;
            },
            findOldestCleanupBlockedQueueRequest: async () => null,
            markQueueRequestNonReplayable: async () => null,
            markQueueRequestTerminalPublished: async () => null,
            promoteOldestWaitingQueueRequest: async (runId: string) => {
                if (promotedOnce) {
                    return null;
                }
                promotedOnce = true;
                return {
                    ...promoted,
                    runId,
                    requestPayload: {
                        ...promoted.requestPayload,
                        path: root,
                        canonicalTargetPath: root,
                        operation: 'reembed',
                        model: 'embed-1',
                        embeddingProvider: 'bogus',
                        embeddingModel: 'embed-1',
                    },
                };
            },
        });
        const result = await pumpIngestQueue();
        assert.equal(result.started, true);
        assert.ok(result.runId);
        const terminal = await waitForQueueManagedTerminalStatus(result.requestId as string, 1000);
        await waitForNextTurn();
        await waitForNextTurn();
        assert.equal(terminal.state, 'error');
        assert.equal(terminal.lastError, 'embeddingProvider and embeddingModel are required when canonical fields are present');
        assert.equal(terminal.error?.error, 'VALIDATION');
        assert.ok(deletedRequestIds.length >= 1, 'invalid canonical provider payloads should still finalize and release the queued request');
        await waitForNextTurn();
        await waitForNextTurn();
        const afterTerminal = await pumpIngestQueue();
        assert.equal(afterTerminal.started, false);
        assert.equal(afterTerminal.blockedByCleanup, false);
        assert.equal(afterTerminal.runId, null);
    }
    finally {
        await cleanup();
    }
});
test('queue promotion rejects non-string canonical provider payloads instead of silently falling back to the legacy model and releases queue ownership cleanly', async () => {
    setupIngestChromaMocks();
    const { root, cleanup } = await createTempRepo({
        'src/provider-invalid.ts': 'export const providerInvalid = true;\n',
    });
    const deletedRequestIds: string[] = [];
    try {
        const promoted = createQueueRequest({
            requestId: '26',
            root,
            queueState: 'running',
        });
        let promotedOnce = false;
        __setQueueRuntimeOpsForTest({
            deleteQueueRequestById: async (deletedRequestId: string) => {
                deletedRequestIds.push(deletedRequestId);
                return null;
            },
            findOldestCleanupBlockedQueueRequest: async () => null,
            markQueueRequestNonReplayable: async () => null,
            markQueueRequestTerminalPublished: async () => null,
            promoteOldestWaitingQueueRequest: async (runId: string) => {
                if (promotedOnce) {
                    return null;
                }
                promotedOnce = true;
                return {
                    ...promoted,
                    runId,
                    requestPayload: {
                        ...promoted.requestPayload,
                        path: root,
                        canonicalTargetPath: root,
                        operation: 'reembed',
                        model: 'embed-1',
                        embeddingProvider: { provider: 'lmstudio' },
                        embeddingModel: 'embed-1',
                    },
                };
            },
        });
        const result = await pumpIngestQueue();
        assert.equal(result.started, true);
        assert.ok(result.runId);
        const terminal = await waitForQueueManagedTerminalStatus(result.requestId as string, 1000);
        await waitForNextTurn();
        await waitForNextTurn();
        assert.equal(terminal.state, 'error');
        assert.equal(terminal.lastError, 'embeddingProvider and embeddingModel are required when canonical fields are present');
        assert.equal(terminal.error?.error, 'VALIDATION');
        assert.deepEqual(deletedRequestIds, ['000000000000000000000026']);
        const afterTerminal = await pumpIngestQueue();
        assert.equal(afterTerminal.started, false);
        assert.equal(afterTerminal.blockedByCleanup, false);
        assert.equal(afterTerminal.runId, null);
    }
    finally {
        await cleanup();
    }
});
test('queue promotion rejects non-string canonical model payloads instead of falling back to the legacy model and releases queue ownership cleanly', async () => {
    setupIngestChromaMocks();
    const { root, cleanup } = await createTempRepo({
        'src/model-invalid.ts': 'export const modelInvalid = true;\n',
    });
    const deletedRequestIds: string[] = [];
    try {
        const promoted = createQueueRequest({
            requestId: '27',
            root,
            queueState: 'running',
        });
        let promotedOnce = false;
        __setQueueRuntimeOpsForTest({
            deleteQueueRequestById: async (deletedRequestId: string) => {
                deletedRequestIds.push(deletedRequestId);
                return null;
            },
            findOldestCleanupBlockedQueueRequest: async () => null,
            markQueueRequestNonReplayable: async () => null,
            markQueueRequestTerminalPublished: async () => null,
            promoteOldestWaitingQueueRequest: async (runId: string) => {
                if (promotedOnce) {
                    return null;
                }
                promotedOnce = true;
                return {
                    ...promoted,
                    runId,
                    requestPayload: {
                        ...promoted.requestPayload,
                        path: root,
                        canonicalTargetPath: root,
                        operation: 'reembed',
                        model: 'embed-1',
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 42,
                    },
                };
            },
        });
        const result = await pumpIngestQueue();
        assert.equal(result.started, true);
        assert.ok(result.runId);
        const terminal = await waitForQueueManagedTerminalStatus(result.requestId as string, 1000);
        await waitForNextTurn();
        await waitForNextTurn();
        assert.equal(terminal.state, 'error');
        assert.equal(terminal.lastError, 'embeddingProvider and embeddingModel are required when canonical fields are present');
        assert.equal(terminal.error?.error, 'VALIDATION');
        assert.deepEqual(deletedRequestIds, ['000000000000000000000027']);
        const afterTerminal = await pumpIngestQueue();
        assert.equal(afterTerminal.started, false);
        assert.equal(afterTerminal.blockedByCleanup, false);
        assert.equal(afterTerminal.runId, null);
    }
    finally {
        await cleanup();
    }
});
test('queue-managed deferred reembed rejects cancelled root drift before delta work begins', async () => {
    const { root, cleanup } = await createTempRepo({
        'src/deferred-cancelled.ts': 'export const deferredCancelled = true;\n',
    });
    setupIngestChromaMocks({
        rootIds: ['root-deferred-cancelled'],
        rootMetadatas: [
            {
                root,
                state: 'cancelled',
                lastIngestAt: '2026-01-02T00:00:00.000Z',
            },
        ],
    });
    const deletedRequestIds: string[] = [];
    const listRootCalls = mock.fn(() => ({
        select: () => ({
            lean: () => ({
                exec: async () => [],
            }),
        }),
    }));
    try {
        mock.method(IngestFileModel, 'find', listRootCalls);
        __setQueueRuntimeOpsForTest({
            deleteQueueRequestById: async (requestId: string) => {
                deletedRequestIds.push(requestId);
                return null;
            },
            findOldestCleanupBlockedQueueRequest: async () => null,
            markQueueRequestNonReplayable: async () => null,
            markQueueRequestTerminalPublished: async () => null,
            promoteOldestWaitingQueueRequest: async (runId: string) => ({
                ...createQueueRequest({
                    requestId: '21',
                    root,
                    queueState: 'running',
                    runId,
                }),
                runId,
            }),
        });
        const started = await pumpIngestQueue();
        assert.equal(started.started, true);
        assert.ok(started.runId);
        const terminal = await waitForQueueManagedTerminalStatus(started.requestId!, 1000);
        assert.equal(terminal.state, 'error');
        assert.equal(terminal.lastError, 'INVALID_REEMBED_STATE');
        assert.equal(listRootCalls.mock.calls.length, 0);
        for (let attempt = 0; attempt < 5 && deletedRequestIds.length === 0; attempt += 1) {
            await waitForNextTurn();
        }
        assert.ok(deletedRequestIds.length >= 1);
        assert.equal(deletedRequestIds.every((requestId) => requestId === '000000000000000000000021'), true);
    }
    finally {
        await cleanup();
    }
});
test('queue-managed deferred reembed uses canonicalTargetPath as the executable root before discovery begins', async () => {
    const events: string[] = [];
    const canonicalRoot = '/allowed/workdir/reembed-canonical';
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/allowed/workdir');
    __setQueueRuntimeOpsForTest({
        findOldestCleanupBlockedQueueRequest: async () => null,
        markQueueRequestNonReplayable: async () => null,
        markQueueRequestTerminalPublished: async () => null,
        promoteOldestWaitingQueueRequest: async (runId: string) => ({
            ...createQueueRequest({
                requestId: '23',
                root: canonicalRoot,
                queueState: 'running',
                runId,
            }),
            runId,
        }),
    });
    __setRunProcessorForTest(async (runId, input) => {
        events.push(`started:${runId}:${input.path}`);
        events.push(`canonical:${input.canonicalTargetPath}`);
        release(runId);
    });
    const started = await pumpIngestQueue();
    await waitForNextTurn();
    assert.equal(started.started, true);
    assert.ok(started.runId);
    assert.deepEqual(events, [
        `started:${started.runId}:${canonicalRoot}`,
        `canonical:${canonicalRoot}`,
    ]);
});
