import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import { __setQueueRuntimeOpsForTest, pumpIngestQueue, setIngestDeps, } from '../../ingest/ingestJob.js';
import { createQueueRequest, createTempRepo, installQueueRuntimeTestHooks, setupIngestChromaMocks, waitForQueueManagedTerminalStatus, waitForNextTurn, } from './ingest-queue-runtime.helpers.js';
installQueueRuntimeTestHooks();
test('queue-managed deferred reembed executes a mounted requestPayload.path while retaining canonical queue identity', async () => {
    const { roots } = setupIngestChromaMocks();
    setIngestDeps({
        baseUrl: 'http://lmstudio.local',
        lmClientFactory: () => ({
            embedding: {
                model: async () => ({
                    embed: async () => ({ embedding: [0.1, 0.2, 0.3] }),
                    getContextLength: async () => 256,
                    countTokens: async (text: string) => text.split(/\s+/).filter(Boolean).length,
                }),
            },
        }) as unknown as LMStudioClient,
    });
    const { root: mountedRoot, cleanup } = await createTempRepo({
        'src/mounted.ts': 'export const mounted = true;\n',
    });
    const canonicalRoot = `/data/${path.basename(mountedRoot)}`;
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", path.dirname(mountedRoot));
    let promotedOnce = false;
    try {
        __setQueueRuntimeOpsForTest({
            deleteQueueRequestById: async () => null,
            findOldestCleanupBlockedQueueRequest: async () => null,
            markQueueRequestNonReplayable: async () => null,
            markQueueRequestTerminalPublished: async () => null,
            promoteOldestWaitingQueueRequest: async (runId: string) => {
                if (promotedOnce) {
                    return null;
                }
                promotedOnce = true;
                return {
                    ...createQueueRequest({
                        requestId: '23',
                        root: canonicalRoot,
                        queueState: 'running',
                        runId,
                    }),
                    runId,
                    requestPayload: {
                        path: mountedRoot,
                        name: 'mounted-repo',
                        model: 'embed-1',
                        operation: 'reembed',
                    },
                };
            },
        });
        const started = await pumpIngestQueue();
        assert.equal(started.started, true);
        assert.ok(started.runId);
        const terminal = await waitForQueueManagedTerminalStatus(started.requestId!, 20000);
        assert.equal(terminal.state, 'completed', terminal.lastError ?? undefined);
        const rootAddCalls = roots.add.mock.calls as unknown as Array<{
            arguments: [
                {
                    metadatas?: Array<{
                        root?: unknown;
                    }>;
                }
            ];
        }>;
        assert.equal(rootAddCalls.some((call) => {
            const payload = call.arguments[0];
            return payload.metadatas?.some((metadata) => metadata.root === canonicalRoot);
        }), true);
    }
    finally {
        await cleanup();
    }
});
test('queue-managed deferred reembed rejects unrelated persisted requestPayload.path before discovery begins', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/allowed/workdir');
    const canonicalRoot = '/allowed/workdir/reembed-canonical';
    const mismatchedPersistedPath = '/allowed/workdir/reembed-other';
    const deletedRequestIds: string[] = [];
    let promotedOnce = false;
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async (requestId: string) => {
            deletedRequestIds.push(requestId);
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
                ...createQueueRequest({
                    requestId: '24',
                    root: canonicalRoot,
                    queueState: 'running',
                    runId,
                }),
                runId,
                requestPayload: {
                    path: mismatchedPersistedPath,
                    name: 'repo',
                    model: 'embed-1',
                    operation: 'reembed',
                },
            };
        },
    });
    const started = await pumpIngestQueue();
    assert.equal(started.started, true);
    assert.ok(started.runId);
    const terminal = await waitForQueueManagedTerminalStatus(started.requestId!, 1000);
    await waitForNextTurn();
    await waitForNextTurn();
    assert.equal(terminal.state, 'error');
    assert.equal(terminal.lastError, 'queued reembed requestPayload.path must match the mounted canonicalTargetPath');
    assert.ok(deletedRequestIds.length >= 1);
    assert.equal(deletedRequestIds.every((requestId) => requestId === '000000000000000000000024'), true);
});
test('queue-managed deferred reembed rejects relative persisted requestPayload.path before discovery begins', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/allowed/workdir');
    const canonicalRoot = '/data/reembed-relative';
    const deletedRequestIds: string[] = [];
    let promotedOnce = false;
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async (requestId: string) => {
            deletedRequestIds.push(requestId);
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
                ...createQueueRequest({
                    requestId: '25',
                    root: canonicalRoot,
                    queueState: 'running',
                    runId,
                }),
                runId,
                requestPayload: {
                    path: 'relative/reembed',
                    name: 'repo',
                    model: 'embed-1',
                    operation: 'reembed',
                },
            };
        },
    });
    const started = await pumpIngestQueue();
    assert.equal(started.started, true);
    const terminal = await waitForQueueManagedTerminalStatus(started.requestId!, 1000);
    await waitForNextTurn();
    await waitForNextTurn();
    assert.equal(terminal.state, 'error');
    assert.equal(terminal.lastError, 'requestPayload.path must be an absolute normalized repository root path');
    assert.deepEqual(deletedRequestIds, ['000000000000000000000025']);
});
test('queue-managed deferred reembed rejects outside-workdir persisted requestPayload.path before discovery begins', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/allowed/workdir');
    const canonicalRoot = '/data/reembed-outside';
    const deletedRequestIds: string[] = [];
    let promotedOnce = false;
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async (requestId: string) => {
            deletedRequestIds.push(requestId);
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
                ...createQueueRequest({
                    requestId: '26',
                    root: canonicalRoot,
                    queueState: 'running',
                    runId,
                }),
                runId,
                requestPayload: {
                    path: '/outside/workdir/reembed',
                    name: 'repo',
                    model: 'embed-1',
                    operation: 'reembed',
                },
            };
        },
    });
    const started = await pumpIngestQueue();
    assert.equal(started.started, true);
    const terminal = await waitForQueueManagedTerminalStatus(started.requestId!, 1000);
    await waitForNextTurn();
    await waitForNextTurn();
    assert.equal(terminal.state, 'error');
    assert.equal(terminal.lastError, 'requestPayload.path must stay within /allowed/workdir');
    assert.deepEqual(deletedRequestIds, ['000000000000000000000026']);
});
