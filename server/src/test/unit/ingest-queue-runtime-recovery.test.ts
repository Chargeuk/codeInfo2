import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { ChromaClient } from 'chromadb';
import { __finalizeQueueRequestForRunForTest, __setQueueRuntimeOpsForTest, __setQueueRequestIdForRunForTest, __setRunProcessorForTest, __setStatusForTest, getStatus, pumpIngestQueue, recoverIngestQueueOnStartup, } from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import * as requestQueue from '../../ingest/requestQueue.js';
import { createQueueRequest, createTempRepo, installQueueRuntimeTestHooks, setupIngestChromaMocks, waitForQueueManagedTerminalStatus, waitForNextTurn, } from './ingest-queue-runtime.helpers.js';
installQueueRuntimeTestHooks();
const ORIGINAL_CODEINFO_CODEX_WORKDIR = process.env.CODEINFO_CODEX_WORKDIR;
test.afterEach(() => {
    if (ORIGINAL_CODEINFO_CODEX_WORKDIR === undefined) {
        clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
    }
    else {
        setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", ORIGINAL_CODEINFO_CODEX_WORKDIR);
    }
});
test('startup recovery skips replay for lost-terminal-marker running rows whose durable replay barrier was already recorded before cleanup', async () => {
    const events: string[] = [];
    const deletedRequestIds: string[] = [];
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async (requestId: string) => {
            deletedRequestIds.push(requestId);
            events.push(`deleted:${requestId}`);
            return createQueueRequest({
                requestId: '11',
                root: '/data/repo-running',
                queueState: 'running',
                runId: 'run-recovered',
                nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
            });
        },
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => createQueueRequest({
            requestId: '11',
            root: '/data/repo-running',
            queueState: 'running',
            runId: 'run-recovered',
            nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
        }),
        markQueueRequestNonReplayable: async () => null,
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
    await waitForNextTurn();
    assert.equal(result.recovered, true);
    assert.deepEqual(events, [
        'deleted:000000000000000000000011',
        'waiting-promoted',
    ]);
    assert.deepEqual(deletedRequestIds, ['000000000000000000000011']);
});
test('cleanup continuation still runs after the durable replay barrier is recorded', async () => {
    const events: string[] = [];
    __setStatusForTest('run-cleanup-after-barrier', {
        runId: 'run-cleanup-after-barrier',
        state: 'completed',
        counts: { files: 1, chunks: 1, embedded: 1 },
        message: 'Completed',
        lastError: null,
    });
    __setQueueRequestIdForRunForTest('run-cleanup-after-barrier', 'queue-cleanup-after-barrier');
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async () => {
            events.push('cleanup-delete-attempted');
            throw new Error('delete failed');
        },
        findOldestCleanupBlockedQueueRequest: async () => createQueueRequest({
            requestId: '31',
            root: '/data/repo-cleanup-after-barrier',
            queueState: 'cleanup-blocked',
            runId: 'run-cleanup-after-barrier',
            nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
        }),
        markQueueRequestCleanupBlocked: async () => {
            events.push('cleanup-blocked-persisted');
            return createQueueRequest({
                requestId: '31',
                root: '/data/repo-cleanup-after-barrier',
                queueState: 'cleanup-blocked',
                runId: 'run-cleanup-after-barrier',
                nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
            });
        },
    });
    const cleaned = await __finalizeQueueRequestForRunForTest('run-cleanup-after-barrier');
    assert.equal(cleaned, false);
    assert.deepEqual(events, [
        'cleanup-delete-attempted',
        'cleanup-blocked-persisted',
    ]);
    assert.equal(getStatus('run-cleanup-after-barrier')?.state, 'cleanup-blocked');
});
test('startup recovery still retries genuinely unfinished running work before newer waiting work', async () => {
    const events: string[] = [];
    const runningQueueRequest = createQueueRequest({
        requestId: '11',
        root: '/data/repo-running',
        queueState: 'running',
        runId: 'run-recovered',
    });
    __setQueueRuntimeOpsForTest({
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => {
            events.push('running-selected');
            return runningQueueRequest;
        },
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
    assert.deepEqual(events, [
        'running-selected',
        'started:run-recovered:/data/repo-running',
    ]);
});
test('startup recovery replays queued reembed work using persisted requestPayload.path as the executable root before discovery resumes', async () => {
    const events: string[] = [];
    const canonicalRoot = '/data/canonical-running-root';
    const mountedExecutionRoot = '/mounted/workdir/canonical-running-root';
    const recoveryQueueRequest = createQueueRequest({
        requestId: '12',
        root: canonicalRoot,
        queueState: 'running',
        runId: 'run-recovered-split',
    });
    recoveryQueueRequest.requestPayload.path = mountedExecutionRoot;
    __setQueueRuntimeOpsForTest({
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => {
            events.push('running-selected');
            return recoveryQueueRequest;
        },
        promoteOldestWaitingQueueRequest: async () => {
            events.push('waiting-promoted');
            return null;
        },
    });
    __setRunProcessorForTest(async (runId, input) => {
        events.push(`started:${runId}:${input.path}`);
        events.push(`canonical:${input.canonicalTargetPath}`);
        release(runId);
    });
    const result = await recoverIngestQueueOnStartup();
    await waitForNextTurn();
    assert.equal(result.recovered, true);
    assert.deepEqual(events, [
        'running-selected',
        `started:run-recovered-split:${mountedExecutionRoot}`,
        `canonical:${canonicalRoot}`,
    ]);
});
test('startup recovery rejects missing start_ingest requestPayload.name before discovery resumes', async () => {
    let getOrCreateCollectionCalls = 0;
    const deletedRequestIds: string[] = [];
    const recoveryQueueRequest = createQueueRequest({
        requestId: '17',
        root: '/missing/start-recovery-without-name',
        operation: 'start',
        queueState: 'running',
        runId: 'run-recovered-missing-name',
    });
    delete recoveryQueueRequest.requestPayload.name;
    mock.method(ChromaClient.prototype, 'getOrCreateCollection', async () => {
        getOrCreateCollectionCalls += 1;
        return {
            get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
        } as never;
    });
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async (requestId: string) => {
            deletedRequestIds.push(requestId);
            return null;
        },
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => recoveryQueueRequest,
        markQueueRequestNonReplayable: async () => null,
        markQueueRequestTerminalPublished: async () => null,
        promoteOldestWaitingQueueRequest: async () => null,
    });
    const result = await recoverIngestQueueOnStartup();
    assert.equal(result.recovered, true);
    const terminal = await waitForQueueManagedTerminalStatus(requestQueue.getQueueRequestId(recoveryQueueRequest), 1000);
    await waitForNextTurn();
    await waitForNextTurn();
    assert.equal(terminal.state, 'error');
    assert.equal(terminal.lastError, 'path and name are required');
    assert.equal(terminal.error?.error, 'VALIDATION');
    assert.equal(getOrCreateCollectionCalls, 0);
    assert.deepEqual(deletedRequestIds, [
        requestQueue.getQueueRequestId(recoveryQueueRequest),
    ]);
});
test('startup recovery rejects unrelated persisted reembed paths before discovery resumes', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/allowed/workdir');
    const canonicalRoot = '/allowed/workdir/recover-canonical-root';
    const mismatchedPersistedPath = '/allowed/workdir/recover-other-root';
    const deletedRequestIds: string[] = [];
    const recoveryQueueRequest = createQueueRequest({
        requestId: '13',
        root: canonicalRoot,
        queueState: 'running',
        runId: 'run-recovered-mismatched-path',
    });
    recoveryQueueRequest.requestPayload.path = mismatchedPersistedPath;
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async (requestId: string) => {
            deletedRequestIds.push(requestId);
            return null;
        },
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => recoveryQueueRequest,
        markQueueRequestNonReplayable: async () => null,
        markQueueRequestTerminalPublished: async () => null,
        promoteOldestWaitingQueueRequest: async () => null,
    });
    const result = await recoverIngestQueueOnStartup();
    assert.equal(result.recovered, true);
    const terminal = await waitForQueueManagedTerminalStatus(requestQueue.getQueueRequestId(recoveryQueueRequest), 1000);
    await waitForNextTurn();
    await waitForNextTurn();
    assert.equal(terminal.state, 'error');
    assert.equal(terminal.lastError, 'queued reembed requestPayload.path must match the mounted canonicalTargetPath');
    assert.ok(deletedRequestIds.length >= 1);
    assert.equal(deletedRequestIds.every((requestId) => requestId === '000000000000000000000013'), true);
});
test('startup recovery rejects relative persisted reembed paths before discovery resumes', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/allowed/workdir');
    const canonicalRoot = '/data/recover-relative-root';
    const deletedRequestIds: string[] = [];
    const recoveryQueueRequest = createQueueRequest({
        requestId: '15',
        root: canonicalRoot,
        queueState: 'running',
        runId: 'run-recovered-relative-path',
    });
    recoveryQueueRequest.requestPayload.path = 'relative/recover-root';
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async (requestId: string) => {
            deletedRequestIds.push(requestId);
            return null;
        },
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => recoveryQueueRequest,
        markQueueRequestNonReplayable: async () => null,
        markQueueRequestTerminalPublished: async () => null,
        promoteOldestWaitingQueueRequest: async () => null,
    });
    const result = await recoverIngestQueueOnStartup();
    assert.equal(result.recovered, true);
    const terminal = await waitForQueueManagedTerminalStatus(requestQueue.getQueueRequestId(recoveryQueueRequest), 1000);
    await waitForNextTurn();
    await waitForNextTurn();
    assert.equal(terminal.state, 'error');
    assert.equal(terminal.lastError, 'requestPayload.path must be an absolute normalized repository root path');
    assert.deepEqual(deletedRequestIds, [
        requestQueue.getQueueRequestId(recoveryQueueRequest),
    ]);
});
test('startup recovery rejects outside-workdir persisted reembed paths before discovery resumes', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/allowed/workdir');
    const canonicalRoot = '/data/recover-outside-root';
    const deletedRequestIds: string[] = [];
    const recoveryQueueRequest = createQueueRequest({
        requestId: '16',
        root: canonicalRoot,
        queueState: 'running',
        runId: 'run-recovered-outside-path',
    });
    recoveryQueueRequest.requestPayload.path = '/outside/workdir/recover-root';
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async (requestId: string) => {
            deletedRequestIds.push(requestId);
            return null;
        },
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => recoveryQueueRequest,
        markQueueRequestNonReplayable: async () => null,
        markQueueRequestTerminalPublished: async () => null,
        promoteOldestWaitingQueueRequest: async () => null,
    });
    const result = await recoverIngestQueueOnStartup();
    assert.equal(result.recovered, true);
    const terminal = await waitForQueueManagedTerminalStatus(requestQueue.getQueueRequestId(recoveryQueueRequest), 1000);
    await waitForNextTurn();
    await waitForNextTurn();
    assert.equal(terminal.state, 'error');
    assert.equal(terminal.lastError, 'requestPayload.path must stay within /allowed/workdir');
    assert.deepEqual(deletedRequestIds, [
        requestQueue.getQueueRequestId(recoveryQueueRequest),
    ]);
});
test('startup recovery uses canonicalTargetPath as the executable root when persisted requestPayload.path is missing', async () => {
    const events: string[] = [];
    const canonicalRoot = '/data/canonical-degraded-root';
    const recoveryQueueRequest = createQueueRequest({
        requestId: '14',
        root: canonicalRoot,
        queueState: 'running',
        runId: 'run-recovered-degraded',
    });
    delete (recoveryQueueRequest.requestPayload as {
        path?: string;
    }).path;
    __setQueueRuntimeOpsForTest({
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => {
            events.push('running-selected');
            return recoveryQueueRequest;
        },
        promoteOldestWaitingQueueRequest: async () => {
            events.push('waiting-promoted');
            return null;
        },
    });
    __setRunProcessorForTest(async (runId, input) => {
        events.push(`started:${runId}:${input.path}`);
        events.push(`canonical:${input.canonicalTargetPath}`);
        release(runId);
    });
    const result = await recoverIngestQueueOnStartup();
    await waitForNextTurn();
    assert.equal(result.recovered, true);
    assert.deepEqual(events, [
        'running-selected',
        `started:run-recovered-degraded:${canonicalRoot}`,
        `canonical:${canonicalRoot}`,
    ]);
});
test('startup recovery refuses out-of-scope persisted ingest-start paths before discovery begins', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/allowed/workdir');
    const deletedRequestIds: string[] = [];
    let getOrCreateCollectionCalls = 0;
    const recoveryQueueRequest = createQueueRequest({
        requestId: '24',
        root: '/outside/repo',
        operation: 'start',
        queueState: 'running',
        runId: 'run-recovered-invalid-root',
    });
    mock.method(ChromaClient.prototype, 'getOrCreateCollection', async () => {
        getOrCreateCollectionCalls += 1;
        return {
            get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
        } as never;
    });
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async (requestId: string) => {
            deletedRequestIds.push(requestId);
            return null;
        },
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => recoveryQueueRequest,
        markQueueRequestNonReplayable: async () => null,
        markQueueRequestTerminalPublished: async () => null,
        promoteOldestWaitingQueueRequest: async () => null,
    });
    const result = await recoverIngestQueueOnStartup();
    assert.equal(result.recovered, true);
    const terminal = await waitForQueueManagedTerminalStatus(requestQueue.getQueueRequestId(recoveryQueueRequest), 1000);
    await waitForNextTurn();
    await waitForNextTurn();
    assert.equal(terminal.state, 'error');
    assert.equal(terminal.lastError, 'path must stay within /allowed/workdir');
    assert.equal(terminal.error?.error, 'VALIDATION');
    assert.equal(getOrCreateCollectionCalls, 0);
    assert.deepEqual(deletedRequestIds, [
        requestQueue.getQueueRequestId(recoveryQueueRequest),
    ]);
});
test('startup recovery rejects malformed non-placeholder CODEINFO_CODEX_WORKDIR before replay starts', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/allowed/workdir/');
    const deletedRequestIds: string[] = [];
    let getOrCreateCollectionCalls = 0;
    const recoveryQueueRequest = createQueueRequest({
        requestId: '25',
        root: '/allowed/workdir/recover-root',
        operation: 'start',
        queueState: 'running',
        runId: 'run-recovered-malformed-workdir',
    });
    mock.method(ChromaClient.prototype, 'getOrCreateCollection', async () => {
        getOrCreateCollectionCalls += 1;
        return {
            get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
        } as never;
    });
    __setRunProcessorForTest(null);
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async (requestId: string) => {
            deletedRequestIds.push(requestId);
            return null;
        },
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => recoveryQueueRequest,
        markQueueRequestNonReplayable: async () => null,
        markQueueRequestTerminalPublished: async () => null,
        promoteOldestWaitingQueueRequest: async () => null,
    });
    const result = await recoverIngestQueueOnStartup();
    assert.equal(result.recovered, true);
    const terminal = await waitForQueueManagedTerminalStatus(requestQueue.getQueueRequestId(recoveryQueueRequest), 1000);
    await waitForNextTurn();
    await waitForNextTurn();
    assert.equal(terminal.state, 'error');
    assert.equal(terminal.lastError, 'CODEINFO_CODEX_WORKDIR must be an absolute normalized repository root path or the exact placeholder "$CODEINFO_CODEX_WORKDIR"');
    assert.equal(terminal.error?.error, 'CONFIGURATION');
    assert.equal(getOrCreateCollectionCalls, 0);
    assert.deepEqual(deletedRequestIds, [
        requestQueue.getQueueRequestId(recoveryQueueRequest),
    ]);
});
test('startup recovery rejects blank canonical model even when a legacy model is also present and does not leave partial running state behind', async () => {
    setupIngestChromaMocks();
    const { root, cleanup } = await createTempRepo({
        'src/recover.ts': 'export const recover = true;\n',
    });
    const deletedRequestIds: string[] = [];
    const recoveryQueueRequest = createQueueRequest({
        requestId: '14',
        root,
        queueState: 'running',
        runId: 'run-recovered-invalid-payload',
    });
    recoveryQueueRequest.requestPayload = {
        ...recoveryQueueRequest.requestPayload,
        path: root,
        model: 'embed-1',
        embeddingProvider: 'lmstudio',
        embeddingModel: '',
        operation: 'reembed',
    };
    try {
        __setQueueRuntimeOpsForTest({
            deleteQueueRequestById: async (deletedRequestId: string) => {
                deletedRequestIds.push(deletedRequestId);
                return null;
            },
            findOldestCleanupBlockedQueueRequest: async () => null,
            findOldestRunningQueueRequest: async () => recoveryQueueRequest,
            markQueueRequestNonReplayable: async () => null,
            markQueueRequestTerminalPublished: async () => null,
            promoteOldestWaitingQueueRequest: async () => null,
        });
        const result = await recoverIngestQueueOnStartup();
        assert.equal(result.recovered, true);
        const terminal = await waitForQueueManagedTerminalStatus(requestQueue.getQueueRequestId(recoveryQueueRequest), 1000);
        await waitForNextTurn();
        await waitForNextTurn();
        assert.equal(terminal.state, 'error');
        assert.equal(terminal.lastError, 'embeddingProvider and embeddingModel are required when canonical fields are present');
        assert.equal(terminal.error?.error, 'VALIDATION');
        assert.deepEqual(deletedRequestIds, [
            requestQueue.getQueueRequestId(recoveryQueueRequest),
        ]);
        await waitForNextTurn();
        await waitForNextTurn();
        const afterRecovery = await pumpIngestQueue();
        assert.equal(afterRecovery.started, false);
        assert.equal(afterRecovery.blockedByCleanup, false);
        assert.equal(afterRecovery.runId, null);
    }
    finally {
        await cleanup();
    }
});
test('startup recovery rejects non-string canonical provider payloads and does not leave partial running state behind', async () => {
    setupIngestChromaMocks();
    const { root, cleanup } = await createTempRepo({
        'src/recover-provider-invalid.ts': 'export const recoverProviderInvalid = true;\n',
    });
    const deletedRequestIds: string[] = [];
    const recoveryQueueRequest = createQueueRequest({
        requestId: '28',
        root,
        queueState: 'running',
        runId: 'run-recovered-invalid-provider-type',
    });
    recoveryQueueRequest.requestPayload = {
        ...recoveryQueueRequest.requestPayload,
        path: root,
        model: 'embed-1',
        embeddingProvider: { provider: 'lmstudio' },
        embeddingModel: 'embed-1',
        operation: 'reembed',
    };
    try {
        __setQueueRuntimeOpsForTest({
            deleteQueueRequestById: async (deletedRequestId: string) => {
                deletedRequestIds.push(deletedRequestId);
                return null;
            },
            findOldestCleanupBlockedQueueRequest: async () => null,
            findOldestRunningQueueRequest: async () => recoveryQueueRequest,
            markQueueRequestNonReplayable: async () => null,
            markQueueRequestTerminalPublished: async () => null,
            promoteOldestWaitingQueueRequest: async () => null,
        });
        const result = await recoverIngestQueueOnStartup();
        assert.equal(result.recovered, true);
        const terminal = await waitForQueueManagedTerminalStatus(requestQueue.getQueueRequestId(recoveryQueueRequest), 1000);
        await waitForNextTurn();
        await waitForNextTurn();
        assert.equal(terminal.state, 'error');
        assert.equal(terminal.lastError, 'embeddingProvider and embeddingModel are required when canonical fields are present');
        assert.equal(terminal.error?.error, 'VALIDATION');
        assert.deepEqual(deletedRequestIds, [
            requestQueue.getQueueRequestId(recoveryQueueRequest),
        ]);
        const afterRecovery = await pumpIngestQueue();
        assert.equal(afterRecovery.started, false);
        assert.equal(afterRecovery.blockedByCleanup, false);
        assert.equal(afterRecovery.runId, null);
    }
    finally {
        await cleanup();
    }
});
test('startup recovery rejects non-string canonical model payloads and does not leave partial running state behind', async () => {
    setupIngestChromaMocks();
    const { root, cleanup } = await createTempRepo({
        'src/recover-model-invalid.ts': 'export const recoverModelInvalid = true;\n',
    });
    const deletedRequestIds: string[] = [];
    const recoveryQueueRequest = createQueueRequest({
        requestId: '29',
        root,
        queueState: 'running',
        runId: 'run-recovered-invalid-model-type',
    });
    recoveryQueueRequest.requestPayload = {
        ...recoveryQueueRequest.requestPayload,
        path: root,
        model: 'embed-1',
        embeddingProvider: 'lmstudio',
        embeddingModel: 42,
        operation: 'reembed',
    };
    try {
        __setQueueRuntimeOpsForTest({
            deleteQueueRequestById: async (deletedRequestId: string) => {
                deletedRequestIds.push(deletedRequestId);
                return null;
            },
            findOldestCleanupBlockedQueueRequest: async () => null,
            findOldestRunningQueueRequest: async () => recoveryQueueRequest,
            markQueueRequestNonReplayable: async () => null,
            markQueueRequestTerminalPublished: async () => null,
            promoteOldestWaitingQueueRequest: async () => null,
        });
        const result = await recoverIngestQueueOnStartup();
        assert.equal(result.recovered, true);
        const terminal = await waitForQueueManagedTerminalStatus(requestQueue.getQueueRequestId(recoveryQueueRequest), 1000);
        await waitForNextTurn();
        await waitForNextTurn();
        assert.equal(terminal.state, 'error');
        assert.equal(terminal.lastError, 'embeddingProvider and embeddingModel are required when canonical fields are present');
        assert.equal(terminal.error?.error, 'VALIDATION');
        assert.deepEqual(deletedRequestIds, [
            requestQueue.getQueueRequestId(recoveryQueueRequest),
        ]);
        const afterRecovery = await pumpIngestQueue();
        assert.equal(afterRecovery.started, false);
        assert.equal(afterRecovery.blockedByCleanup, false);
        assert.equal(afterRecovery.runId, null);
    }
    finally {
        await cleanup();
    }
});
