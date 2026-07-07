import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { mock } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import mongoose from 'mongoose';
import { hashFile } from '../../ingest/hashing.js';
import { __finalizeQueueRequestForRunForTest, __getIngestEventListenerCountForTest, __getQueueRequestTerminalStatusCountForTest, __persistQueueTerminalBarrierForTest, __setQueueRequestIdForRunForTest, __setQueueRequestTerminalStatusNowForTest, __setQueueRequestTerminalStatusTtlForTest, __setQueueRuntimeOpsForTest, __setRunSchedulerForTest, __setStatusAndPublishForTest, __setStatusForTest, QUEUE_READ_FAILED_WAIT_REASON, getStatus, pumpIngestQueue, recoverIngestQueueOnStartup, startIngest, waitForQueueRequestTerminalStatus, } from '../../ingest/ingestJob.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import { createQueueRequest, createTempRepo, installQueueRuntimeTestHooks, setupIngestChromaMocks, waitForQueueManagedTerminalStatus, waitForNextTurn, } from './ingest-queue-runtime.helpers.js';
installQueueRuntimeTestHooks();
function buildIngestDeps() {
    return {
        baseUrl: 'http://lmstudio.local',
        lmClientFactory: () => ({}) as LMStudioClient,
    };
}
test('terminal queue cleanup deletes the current queue record before the next waiting item starts', async () => {
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
            events.push('delete-current');
            return createQueueRequest({
                requestId: '5',
                root: '/data/repo-finished',
                queueState: 'running',
                runId: 'run-finished',
            });
        },
        findOldestCleanupBlockedQueueRequest: async () => null,
        promoteOldestWaitingQueueRequest: async () => {
            events.push('promote-next');
            return null;
        },
    });
    const cleaned = await __finalizeQueueRequestForRunForTest('run-finished');
    await waitForNextTurn();
    await waitForNextTurn();
    assert.equal(cleaned, true);
    assert.deepEqual(events, ['delete-current', 'promote-next']);
});
test('terminal queue request cache retains completed entries until expiry and evicts them deterministically after the boundary', async () => {
    let terminalStatusNowMs = 1000;
    const advanceTerminalStatusTime = (ms: number) => {
        terminalStatusNowMs += ms;
        __setQueueRequestTerminalStatusNowForTest(terminalStatusNowMs);
    };
    __setQueueRequestTerminalStatusNowForTest(terminalStatusNowMs);
    __setQueueRequestIdForRunForTest('run-evicted', 'queue-evicted');
    __setQueueRequestTerminalStatusTtlForTest(5);
    __setStatusAndPublishForTest('run-evicted', {
        runId: 'run-evicted',
        state: 'completed',
        counts: { files: 1, chunks: 1, embedded: 1 },
        message: 'Completed',
        lastError: null,
    });
    assert.equal(__getQueueRequestTerminalStatusCountForTest(), 1);
    advanceTerminalStatusTime(4);
    assert.equal(__getQueueRequestTerminalStatusCountForTest(), 1);
    advanceTerminalStatusTime(1);
    assert.equal(__getQueueRequestTerminalStatusCountForTest(), 0);
});
test('normal terminal path with queue deletion failure does not settle the request waiter as success and leaves cleanup-blocked status', async () => {
    const initialListeners = __getIngestEventListenerCountForTest();
    __setQueueRequestIdForRunForTest('run-cleanup-fails', 'queue-cleanup-fails');
    __setStatusForTest('run-cleanup-fails', {
        runId: 'run-cleanup-fails',
        state: 'embedding',
        counts: { files: 1, chunks: 1, embedded: 1 },
        message: 'Running',
        lastError: null,
    });
    __setQueueRuntimeOpsForTest({
        findQueueRequestById: async () => createQueueRequest({
            requestId: 'queue-cleanup-fails',
            root: '/data/repo-cleanup-fails',
            queueState: 'running',
            runId: 'run-cleanup-fails',
        }),
        deleteQueueRequestById: async () => {
            throw new Error('queue delete failed');
        },
        markQueueRequestCleanupBlocked: async () => createQueueRequest({
            requestId: 'queue-cleanup-fails',
            root: '/data/repo-cleanup-fails',
            queueState: 'cleanup-blocked',
            runId: 'run-cleanup-fails',
        }),
    });
    const waitResultPromise = waitForQueueRequestTerminalStatus('queue-cleanup-fails', { timeoutMs: 1000 });
    await waitForNextTurn();
    __setStatusAndPublishForTest('run-cleanup-fails', {
        runId: 'run-cleanup-fails',
        state: 'completed',
        counts: { files: 1, chunks: 1, embedded: 1 },
        message: 'Completed',
        lastError: null,
    }, { publishQueueTerminal: false });
    await waitForNextTurn();
    const cleaned = await __finalizeQueueRequestForRunForTest('run-cleanup-fails');
    const waitResult = await waitResultPromise;
    assert.equal(cleaned, false);
    assert.equal(waitResult.reason, 'terminal');
    assert.equal(waitResult.status?.state, 'cleanup-blocked');
    assert.equal(waitResult.status?.lastError, 'queue delete failed');
    assert.equal(getStatus('run-cleanup-fails')?.state, 'cleanup-blocked');
    assert.equal(__getIngestEventListenerCountForTest(), initialListeners);
});
test('skipped terminal path with queue deletion failure does not settle the request waiter as success before cleanup is finalized', async () => {
    const initialListeners = __getIngestEventListenerCountForTest();
    __setQueueRequestIdForRunForTest('run-skipped-cleanup-fails', 'queue-skipped');
    __setStatusForTest('run-skipped-cleanup-fails', {
        runId: 'run-skipped-cleanup-fails',
        state: 'embedding',
        counts: { files: 0, chunks: 0, embedded: 0 },
        message: 'Running',
        lastError: null,
    });
    __setQueueRuntimeOpsForTest({
        findQueueRequestById: async () => createQueueRequest({
            requestId: 'queue-skipped',
            root: '/data/repo-skipped',
            queueState: 'running',
            runId: 'run-skipped-cleanup-fails',
        }),
        deleteQueueRequestById: async () => {
            throw new Error('skipped queue delete failed');
        },
        markQueueRequestCleanupBlocked: async () => createQueueRequest({
            requestId: 'queue-skipped',
            root: '/data/repo-skipped',
            queueState: 'cleanup-blocked',
            runId: 'run-skipped-cleanup-fails',
        }),
    });
    const waitResultPromise = waitForQueueRequestTerminalStatus('queue-skipped', {
        timeoutMs: 1000,
    });
    await waitForNextTurn();
    __setStatusAndPublishForTest('run-skipped-cleanup-fails', {
        runId: 'run-skipped-cleanup-fails',
        state: 'skipped',
        counts: { files: 0, chunks: 0, embedded: 0 },
        message: 'No changes detected',
        lastError: null,
    }, { publishQueueTerminal: false });
    await waitForNextTurn();
    const cleaned = await __finalizeQueueRequestForRunForTest('run-skipped-cleanup-fails');
    const waitResult = await waitResultPromise;
    assert.equal(cleaned, false);
    assert.equal(waitResult.reason, 'terminal');
    assert.equal(waitResult.status?.state, 'cleanup-blocked');
    assert.equal(waitResult.status?.lastError, 'skipped queue delete failed');
    assert.equal(getStatus('run-skipped-cleanup-fails')?.state, 'cleanup-blocked');
    assert.equal(__getIngestEventListenerCountForTest(), initialListeners);
});
test('request-aware queue wait uses timeout fallback only when no terminal state can be read and still cleans up listeners', async () => {
    const initialListeners = __getIngestEventListenerCountForTest();
    __setQueueRuntimeOpsForTest({
        findQueueRequestById: async () => null,
    });
    const result = await waitForQueueRequestTerminalStatus('queue-timeout', {
        timeoutMs: 5,
    });
    assert.equal(result.reason, 'timeout');
    assert.equal(result.runId, null);
    assert.equal(result.status, null);
    assert.equal(__getIngestEventListenerCountForTest(), initialListeners);
    assert.equal(__getQueueRequestTerminalStatusCountForTest(), 0);
});
test('request-aware queue wait cleans up listeners on queue-read failure', async () => {
    const initialListeners = __getIngestEventListenerCountForTest();
    __setQueueRuntimeOpsForTest({
        findQueueRequestById: async () => {
            throw new Error('queue read failed');
        },
    });
    const queueReadFailed = await waitForQueueRequestTerminalStatus('queue-read-failed', {
        timeoutMs: 20,
    });
    assert.equal(queueReadFailed.reason, QUEUE_READ_FAILED_WAIT_REASON);
    assert.equal(__getIngestEventListenerCountForTest(), initialListeners);
    assert.equal(__getQueueRequestTerminalStatusCountForTest(), 0);
});
test('request-aware queue wait cleans up listeners on cancellation and immediate cached terminal reuse', async () => {
    const initialListeners = __getIngestEventListenerCountForTest();
    __setQueueRuntimeOpsForTest({
        findQueueRequestById: async (requestId) => requestId === 'queue-cancelled-live'
            ? createQueueRequest({
                requestId,
                root: '/data/repo-cancelled-live',
                queueState: 'running',
                runId: 'run-cancelled-live',
            })
            : null,
    });
    __setStatusForTest('run-cancelled-live', {
        runId: 'run-cancelled-live',
        state: 'queued',
        counts: { files: 0, chunks: 0, embedded: 0 },
        message: 'Queued',
        lastError: null,
    });
    __setQueueRequestIdForRunForTest('run-cancelled-live', 'queue-cancelled-live');
    const cancelledPromise = waitForQueueRequestTerminalStatus('queue-cancelled-live', {
        timeoutMs: 1000,
    });
    await waitForNextTurn();
    __setStatusAndPublishForTest('run-cancelled-live', {
        runId: 'run-cancelled-live',
        state: 'cancelled',
        counts: { files: 0, chunks: 0, embedded: 0 },
        message: 'Cancelled',
        lastError: 'Cancelled',
    });
    const cancelled = await cancelledPromise;
    assert.equal(cancelled.reason, 'terminal');
    assert.equal(cancelled.status?.state, 'cancelled');
    assert.equal(__getIngestEventListenerCountForTest(), initialListeners);
    assert.equal(__getQueueRequestTerminalStatusCountForTest(), 1);
    __setQueueRuntimeOpsForTest({
        findQueueRequestById: async () => {
            throw new Error('queue read failed');
        },
        markQueueRequestNonReplayable: async () => null,
        markQueueRequestTerminalPublished: async () => null,
    });
    await __persistQueueTerminalBarrierForTest('run-cancelled-live');
    const immediate = await waitForQueueRequestTerminalStatus('queue-cancelled-live', {
        timeoutMs: 20,
    });
    assert.equal(immediate.reason, 'terminal');
    assert.equal(immediate.status?.state, 'cancelled');
    assert.equal(__getIngestEventListenerCountForTest(), initialListeners);
});
test('cleanup-blocked queue records stay visible and stall newer waiting work', async () => {
    __setStatusForTest('run-blocked', {
        runId: 'run-blocked',
        state: 'completed',
        counts: { files: 1, chunks: 1, embedded: 1 },
        message: 'Completed',
        lastError: null,
    });
    __setQueueRequestIdForRunForTest('run-blocked', 'queue-blocked');
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async () => {
            throw new Error('delete failed');
        },
        markQueueRequestCleanupBlocked: async () => createQueueRequest({
            requestId: '7',
            root: '/data/repo-blocked',
            queueState: 'cleanup-blocked',
            runId: 'run-blocked',
        }),
        findOldestCleanupBlockedQueueRequest: async () => createQueueRequest({
            requestId: '7',
            root: '/data/repo-blocked',
            queueState: 'cleanup-blocked',
            runId: 'run-blocked',
        }),
    });
    const cleaned = await __finalizeQueueRequestForRunForTest('run-blocked');
    const stalled = await pumpIngestQueue();
    assert.equal(cleaned, false);
    assert.equal(getStatus('run-blocked')?.state, 'cleanup-blocked');
    assert.equal(stalled.started, false);
    assert.equal(stalled.blockedByCleanup, true);
});
test('delete failure plus cleanup-blocked persistence failure leaves retry ownership that stalls newer waiting work until queue record removal', async () => {
    const events: string[] = [];
    let deleteAttempts = 0;
    __setStatusForTest('run-partial-cleanup', {
        runId: 'run-partial-cleanup',
        state: 'completed',
        counts: { files: 1, chunks: 1, embedded: 1 },
        message: 'Completed',
        lastError: null,
    });
    __setQueueRequestIdForRunForTest('run-partial-cleanup', 'queue-partial-cleanup');
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async () => {
            deleteAttempts += 1;
            events.push(`delete-${deleteAttempts}`);
            if (deleteAttempts === 1) {
                throw new Error('delete failed before durable cleanup-blocked write');
            }
            return null;
        },
        findOldestCleanupBlockedQueueRequest: async () => {
            events.push('cleanup-blocked-lookup');
            return null;
        },
        markQueueRequestCleanupBlocked: async () => {
            events.push('mark-cleanup-blocked');
            throw new Error('cleanup-blocked write failed');
        },
        promoteOldestWaitingQueueRequest: async () => {
            events.push('waiting-promote');
            return null;
        },
    });
    const cleaned = await __finalizeQueueRequestForRunForTest('run-partial-cleanup');
    const stalled = await pumpIngestQueue();
    const startup = await recoverIngestQueueOnStartup();
    assert.equal(cleaned, false);
    assert.equal(stalled.started, false);
    assert.equal(stalled.blockedByCleanup, true);
    assert.equal(stalled.requestId, 'queue-partial-cleanup');
    assert.equal(stalled.runId, 'run-partial-cleanup');
    assert.deepEqual(startup, {
        recovered: false,
        blockedByActiveLock: false,
        blockedByCleanup: true,
        requestId: 'queue-partial-cleanup',
        runId: 'run-partial-cleanup',
    });
    assert.equal(getStatus('run-partial-cleanup')?.state, 'cleanup-blocked');
    assert.deepEqual(events, ['delete-1', 'mark-cleanup-blocked']);
    const cleanedAfterRemoval = await __finalizeQueueRequestForRunForTest('run-partial-cleanup');
    const unblocked = await pumpIngestQueue();
    assert.equal(cleanedAfterRemoval, true);
    assert.equal(unblocked.started, false);
    assert.equal(unblocked.blockedByCleanup, false);
    assert.deepEqual(events, [
        'delete-1',
        'mark-cleanup-blocked',
        'delete-2',
        'cleanup-blocked-lookup',
        'waiting-promote',
        'cleanup-blocked-lookup',
        'waiting-promote',
    ]);
});
test('deletions-only cleanup degradation publishes the shared cleanup-blocked queue state and stalls later waiting work', async () => {
    let scheduledTask: (() => void) | null = null;
    __setRunSchedulerForTest((task) => {
        scheduledTask = task;
    });
    const events: string[] = [];
    const { vectors } = setupIngestChromaMocks();
    (mongoose.connection as unknown as {
        readyState: number;
    }).readyState = 1;
    const { root, cleanup } = await createTempRepo({
        'docs/keep.md': '# keep\n',
        'docs/delete-a.md': '# delete a\n',
    });
    let cleanupBlockedRequestId: string | null = null;
    let deletedDuringFinalize = false;
    let promotedDuringCleanupBlocked = false;
    let activeRunId: string | null = null;
    try {
        vectors.delete = mock.fn(async () => {
            events.push('vector-delete');
            (mongoose.connection as unknown as {
                readyState: number;
            }).readyState = 0;
        });
        const keepHash = await hashFile(`${root}/docs/keep.md`);
        mock.method(IngestFileModel, 'find', () => ({
            select: () => ({
                lean: () => ({
                    exec: async () => [
                        { relPath: 'docs/keep.md', fileHash: keepHash },
                        { relPath: 'docs/delete-a.md', fileHash: 'delete-a-hash' },
                    ],
                }),
            }),
        }));
        await fs.rm(`${root}/docs/delete-a.md`);
        setScopedTestEnvValue("CODEINFO_INGEST_TEST_GIT_PATHS", 'docs/keep.md');
        __setQueueRuntimeOpsForTest({
            findQueueRequestById: async (requestId) => requestId === '11' && activeRunId
                ? createQueueRequest({
                    requestId,
                    root,
                    queueState: cleanupBlockedRequestId
                        ? 'cleanup-blocked'
                        : 'running',
                    runId: activeRunId,
                })
                : null,
            deleteQueueRequestById: async () => {
                deletedDuringFinalize = true;
                return null;
            },
            findOldestCleanupBlockedQueueRequest: async () => cleanupBlockedRequestId
                ? createQueueRequest({
                    requestId: cleanupBlockedRequestId,
                    root,
                    queueState: 'cleanup-blocked',
                    runId: 'blocked-run',
                })
                : null,
            markQueueRequestCleanupBlocked: async ({ requestId, runId }) => {
                cleanupBlockedRequestId = requestId;
                return createQueueRequest({
                    requestId,
                    root,
                    queueState: 'cleanup-blocked',
                    runId,
                });
            },
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
            markQueueRequestTerminalPublished: async ({ requestId, runId }) => {
                events.push(`terminal:${runId}:${requestId}`);
                return createQueueRequest({
                    requestId,
                    root,
                    queueState: 'running',
                    runId,
                    nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
                    terminalPublishedAt: new Date('2026-01-01T00:00:06.000Z'),
                });
            },
            promoteOldestWaitingQueueRequest: async () => {
                promotedDuringCleanupBlocked = true;
                return null;
            },
        });
        const runId = await startIngest({
            path: root,
            name: 'queue-cleanup-blocked-deletions-reembed',
            model: 'embed-1',
            operation: 'reembed',
        }, buildIngestDeps());
        activeRunId = runId;
        __setQueueRequestIdForRunForTest(runId, '11');
        if (scheduledTask === null) {
            throw new Error('expected captured run task before execution');
        }
        const executeScheduledTask = scheduledTask as () => void;
        executeScheduledTask();
        const status = await waitForQueueManagedTerminalStatus('11');
        for (let attempt = 0; attempt < 5 && cleanupBlockedRequestId === null; attempt += 1) {
            await waitForNextTurn();
        }
        let stalled = await pumpIngestQueue();
        for (let attempt = 0; attempt < 5 && !stalled.blockedByCleanup && !stalled.started; attempt += 1) {
            await waitForNextTurn();
            stalled = await pumpIngestQueue();
        }
        assert.equal(status.state, 'cleanup-blocked');
        assert.equal(cleanupBlockedRequestId, '11');
        assert.equal(deletedDuringFinalize, false);
        assert.equal(promotedDuringCleanupBlocked, false);
        assert.equal(stalled.started, false);
        assert.equal(stalled.blockedByCleanup, true);
        assert.deepEqual(events.slice(0, 2), [
            `barrier:${runId}:11`,
            'vector-delete',
        ]);
    }
    finally {
        await cleanup();
    }
});
test('queue-managed finalization fails closed when replay barrier persistence fails before modeled side effects', async () => {
    let scheduledTask: (() => void) | null = null;
    __setRunSchedulerForTest((task) => {
        scheduledTask = task;
    });
    const events: string[] = [];
    const { vectors } = setupIngestChromaMocks();
    (mongoose.connection as unknown as {
        readyState: number;
    }).readyState = 1;
    const { root, cleanup } = await createTempRepo({
        'docs/keep.md': '# keep\n',
        'docs/delete-a.md': '# delete a\n',
    });
    try {
        vectors.delete = mock.fn(async () => {
            events.push('vector-delete');
        });
        const keepHash = await hashFile(`${root}/docs/keep.md`);
        mock.method(IngestFileModel, 'find', () => ({
            select: () => ({
                lean: () => ({
                    exec: async () => [
                        { relPath: 'docs/keep.md', fileHash: keepHash },
                        { relPath: 'docs/delete-a.md', fileHash: 'delete-a-hash' },
                    ],
                }),
            }),
        }));
        await fs.rm(`${root}/docs/delete-a.md`);
        setScopedTestEnvValue("CODEINFO_INGEST_TEST_GIT_PATHS", 'docs/keep.md');
        __setQueueRuntimeOpsForTest({
            deleteQueueRequestById: async (requestId) => {
                events.push(`delete:${requestId}`);
                return null;
            },
            findQueueRequestById: async (requestId) => requestId === '12'
                ? createQueueRequest({
                    requestId,
                    root,
                    queueState: 'running',
                    runId: 'run-barrier-fails',
                })
                : null,
            findOldestCleanupBlockedQueueRequest: async () => null,
            markQueueRequestNonReplayable: async ({ requestId, runId }) => {
                events.push(`barrier-failed:${runId}:${requestId}`);
                throw new Error('non-replayable barrier write failed');
            },
            markQueueRequestTerminalPublished: async ({ requestId, runId }) => {
                events.push(`terminal:${runId}:${requestId}`);
                return null;
            },
            promoteOldestWaitingQueueRequest: async () => null,
        });
        const runId = await startIngest({
            path: root,
            name: 'queue-barrier-failure-reembed',
            model: 'embed-1',
            operation: 'reembed',
        }, buildIngestDeps());
        __setQueueRequestIdForRunForTest(runId, '12');
        if (scheduledTask === null) {
            throw new Error('expected captured run task before execution');
        }
        const executeScheduledTask = scheduledTask as () => void;
        executeScheduledTask();
        const status = await waitForQueueManagedTerminalStatus('12');
        assert.equal(status.state, 'error');
        assert.equal(status.lastError?.includes('non-replayable barrier write failed'), true);
        assert.deepEqual(events, [
            `barrier-failed:${runId}:12`,
            `barrier-failed:${runId}:12`,
            'delete:12',
        ]);
    }
    finally {
        await cleanup();
    }
});
test('startup recovery resolves cleanup-blocked before retrying running work or waiting work', async () => {
    const events: string[] = [];
    __setQueueRequestIdForRunForTest('run-cleanup', 'queue-cleanup');
    __setQueueRuntimeOpsForTest({
        findOldestCleanupBlockedQueueRequest: async () => createQueueRequest({
            requestId: '8',
            root: '/data/repo-cleanup',
            queueState: 'cleanup-blocked',
            runId: 'run-cleanup',
        }),
        deleteQueueRequestById: async () => {
            events.push('cleanup-first');
            return createQueueRequest({
                requestId: '8',
                root: '/data/repo-cleanup',
                queueState: 'cleanup-blocked',
                runId: 'run-cleanup',
            });
        },
        findOldestRunningQueueRequest: async () => {
            events.push('running-lookup');
            return null;
        },
        promoteOldestWaitingQueueRequest: async () => {
            events.push('waiting-promote');
            return null;
        },
    });
    const result = await recoverIngestQueueOnStartup();
    await waitForNextTurn();
    await waitForNextTurn();
    assert.equal(result.recovered, true);
    assert.deepEqual(events, ['cleanup-first']);
});
test('startup recovery does not advance past cleanup-blocked rows with missing runId', async () => {
    const events: string[] = [];
    __setQueueRuntimeOpsForTest({
        findOldestCleanupBlockedQueueRequest: async () => createQueueRequest({
            requestId: '10',
            root: '/data/repo-cleanup-missing-run',
            queueState: 'cleanup-blocked',
            runId: null,
        }),
        findOldestRunningQueueRequest: async () => {
            events.push('running-lookup');
            return null;
        },
        promoteOldestWaitingQueueRequest: async () => {
            events.push('waiting-promote');
            return null;
        },
    });
    const result = await recoverIngestQueueOnStartup();
    assert.equal(result.recovered, false);
    assert.deepEqual(events, []);
});
test('queue-managed completion records a durable replay barrier even when terminal marker persistence fails after commit', async () => {
    const events: string[] = [];
    __setStatusForTest('run-barrier-written', {
        runId: 'run-barrier-written',
        state: 'completed',
        counts: { files: 1, chunks: 1, embedded: 1 },
        message: 'Completed',
        lastError: null,
    });
    __setQueueRequestIdForRunForTest('run-barrier-written', 'queue-barrier-written');
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async (requestId: string) => {
            events.push(`deleted:${requestId}`);
            return null;
        },
        findOldestCleanupBlockedQueueRequest: async () => null,
        markQueueRequestNonReplayable: async ({ requestId, runId }) => {
            events.push(`barrier:${runId}:${requestId}`);
            return createQueueRequest({
                requestId: '30',
                root: '/data/repo-barrier',
                queueState: 'running',
                runId: runId ?? 'missing-run-id',
                nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
            });
        },
        markQueueRequestTerminalPublished: async () => {
            events.push('terminal-marker-failed');
            throw new Error('terminal marker write failed');
        },
        promoteOldestWaitingQueueRequest: async () => null,
    });
    await __persistQueueTerminalBarrierForTest('run-barrier-written');
    const cleaned = await __finalizeQueueRequestForRunForTest('run-barrier-written');
    assert.equal(cleaned, true);
    assert.deepEqual(events, [
        'barrier:run-barrier-written:queue-barrier-written',
        'terminal-marker-failed',
        'deleted:queue-barrier-written',
    ]);
});
