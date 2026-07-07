import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { __finalizeQueueRequestForRunForTest, __resetIngestJobsForTest, __setQueueRuntimeOpsForTest, __setQueueRequestIdForRunForTest, __setStatusForTest, getActiveStatus, getStatus, pumpIngestQueue, } from '../../ingest/ingestJob.js';
import { acquire, release } from '../../ingest/lock.js';
const ORIGINAL_ENV = process.env.NODE_ENV;
beforeEach(() => {
    setScopedTestEnvValue("NODE_ENV", 'test');
    __resetIngestJobsForTest();
    release();
});
afterEach(() => {
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async () => null,
        ensureQueueRequestRunId: async () => null,
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => null,
        getQueueRequestId: () => 'noop',
        markQueueRequestCleanupBlocked: async () => null,
        promoteOldestWaitingQueueRequest: async () => null,
    });
    __resetIngestJobsForTest();
    release();
    setScopedTestEnvValue("NODE_ENV", ORIGINAL_ENV);
});
test('includes per-file progress fields in ingest status snapshots', () => {
    const runId = 'run-123';
    const status = {
        runId,
        state: 'embedding' as const,
        counts: { files: 3, chunks: 5, embedded: 2 },
        ast: { supportedFileCount: 2, skippedFileCount: 1, failedFileCount: 0 },
        message: 'Embedding 3 files',
        lastError: null,
        currentFile: '/repo/a.txt',
        fileIndex: 1,
        fileTotal: 3,
        percent: 33.3,
        etaMs: 1200,
    };
    __setStatusForTest(runId, status);
    const snapshot = getStatus(runId);
    assert.ok(snapshot, 'expected status to be stored');
    assert.equal(snapshot?.currentFile, status.currentFile);
    assert.equal(snapshot?.fileIndex, status.fileIndex);
    assert.equal(snapshot?.fileTotal, status.fileTotal);
    assert.equal(snapshot?.percent, status.percent);
    assert.equal(snapshot?.etaMs, status.etaMs);
    assert.equal(snapshot?.ast?.supportedFileCount, status.ast.supportedFileCount);
    assert.equal(snapshot?.ast?.skippedFileCount, status.ast.skippedFileCount);
    assert.equal(snapshot?.ast?.failedFileCount, status.ast.failedFileCount);
});
test('getActiveStatus prefers active lock owner', () => {
    const lockedRun = 'run-locked';
    const otherRun = 'run-other';
    __setStatusForTest(lockedRun, {
        runId: lockedRun,
        state: 'embedding',
        counts: { files: 1, chunks: 2, embedded: 0 },
        message: 'Embedding',
        lastError: null,
    });
    __setStatusForTest(otherRun, {
        runId: otherRun,
        state: 'scanning',
        counts: { files: 2, chunks: 0, embedded: 0 },
        message: 'Scanning',
        lastError: null,
    });
    assert.equal(acquire(lockedRun), true);
    const active = getActiveStatus();
    assert.equal(active?.runId, lockedRun);
});
test('getActiveStatus falls back when lock owner is terminal', () => {
    const lockedRun = 'run-terminal';
    const activeRun = 'run-active';
    __setStatusForTest(lockedRun, {
        runId: lockedRun,
        state: 'completed',
        counts: { files: 1, chunks: 2, embedded: 2 },
        message: 'Completed',
        lastError: null,
    });
    __setStatusForTest(activeRun, {
        runId: activeRun,
        state: 'embedding',
        counts: { files: 1, chunks: 1, embedded: 0 },
        message: 'Embedding',
        lastError: null,
    });
    assert.equal(acquire(lockedRun), true);
    const active = getActiveStatus();
    assert.equal(active?.runId, activeRun);
});
test('getActiveStatus falls back when lock owner run is missing', () => {
    const missingRun = 'run-missing';
    const activeRun = 'run-active';
    __setStatusForTest(activeRun, {
        runId: activeRun,
        state: 'scanning',
        counts: { files: 3, chunks: 0, embedded: 0 },
        message: 'Scanning',
        lastError: null,
    });
    assert.equal(acquire(missingRun), true);
    const active = getActiveStatus();
    assert.equal(active?.runId, activeRun);
});
test('getActiveStatus returns null when only terminal runs exist', () => {
    __setStatusForTest('run-one', {
        runId: 'run-one',
        state: 'completed',
        counts: { files: 1, chunks: 1, embedded: 1 },
        message: 'Completed',
        lastError: null,
    });
    __setStatusForTest('run-two', {
        runId: 'run-two',
        state: 'error',
        counts: { files: 1, chunks: 0, embedded: 0 },
        message: 'Error',
        lastError: 'boom',
    });
    const active = getActiveStatus();
    assert.equal(active, null);
});
test('ingest status snapshots preserve normalized error object with legacy lastError', () => {
    const runId = 'run-openai-error';
    __setStatusForTest(runId, {
        runId,
        state: 'error',
        counts: { files: 2, chunks: 4, embedded: 1 },
        message: 'Failed',
        lastError: 'quota exhausted',
        error: {
            error: 'OPENAI_QUOTA_EXCEEDED',
            message: 'quota exhausted',
            retryable: false,
            provider: 'openai',
            upstreamStatus: 429,
        },
    });
    const snapshot = getStatus(runId);
    assert.ok(snapshot);
    assert.equal(snapshot?.lastError, 'quota exhausted');
    assert.equal(snapshot?.error?.error, 'OPENAI_QUOTA_EXCEEDED');
    assert.equal(snapshot?.error?.retryable, false);
});
test('cleanup-blocked status stays visible and stalls newer queued work', async () => {
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
        markQueueRequestCleanupBlocked: async () => ({
            _id: { toString: () => 'queue-blocked' },
            canonicalTargetPath: '/data/repo-blocked',
            operation: 'reembed',
            queueState: 'cleanup-blocked',
            requestPayload: { path: '/data/repo-blocked', model: 'embed-1' },
            runId: 'run-blocked',
        }) as never,
        findOldestCleanupBlockedQueueRequest: async () => ({
            _id: { toString: () => 'queue-blocked' },
            canonicalTargetPath: '/data/repo-blocked',
            operation: 'reembed',
            queueState: 'cleanup-blocked',
            requestPayload: { path: '/data/repo-blocked', model: 'embed-1' },
            runId: 'run-blocked',
        }) as never,
    });
    const cleaned = await __finalizeQueueRequestForRunForTest('run-blocked');
    const stalled = await pumpIngestQueue();
    assert.equal(cleaned, false);
    assert.equal(getStatus('run-blocked')?.state, 'cleanup-blocked');
    assert.equal(stalled.started, false);
    assert.equal(stalled.blockedByCleanup, true);
});
