import assert from 'node:assert/strict';
import test from 'node:test';
import { __setQueueRuntimeOpsForTest, __setQueueRequestIdForRunForTest, __setRunSchedulerForTest, startIngest, waitForTerminalIngestStatus, } from '../../ingest/ingestJob.js';
import { disposeOpenAiTokenizer, setOpenAiTokenizerFactoryForTests, type OpenAiClientLike, } from '../../ingest/providers/index.js';
import { createQueueRequest, createTempRepo, installQueueRuntimeTestHooks, setupIngestChromaMocks, waitForNextTurn, } from './ingest-queue-runtime.helpers.js';
installQueueRuntimeTestHooks();
test('queued ingest OpenAI 429 failure becomes terminal status without unhandled rejection', async () => {
    const { vectors } = setupIngestChromaMocks();
    await vectors.modify({
        metadata: {
            lockedModelId: null,
            embeddingProvider: null,
            embeddingModel: null,
            embeddingDimensions: null,
        },
    });
    setOpenAiTokenizerFactoryForTests(() => ({
        encode: (value: string) => new Uint32Array(Math.max(1, value.split(/\s+/).filter(Boolean).length)).fill(1),
        free() { },
    }));
    const previousKey = process.env.CODEINFO_OPENAI_EMBEDDING_KEY;
    const previousRetries = process.env.CODEINFO_OPENAI_INGEST_MAX_RETRIES;
    setScopedTestEnvValue("CODEINFO_OPENAI_EMBEDDING_KEY", 'sk-test-key');
    setScopedTestEnvValue("CODEINFO_OPENAI_INGEST_MAX_RETRIES", '1');
    const scheduledTasks: Array<() => void> = [];
    __setRunSchedulerForTest((task) => {
        scheduledTasks.push(task);
    });
    const { root, cleanup } = await createTempRepo({
        'src/openai.ts': 'export const value = "openai queued failure proof";\n',
    });
    __setQueueRuntimeOpsForTest({
        deleteQueueRequestById: async (requestId) => createQueueRequest({
            requestId,
            root,
            queueState: 'running',
        }),
        markQueueRequestNonReplayable: async ({ requestId, runId }) => createQueueRequest({
            requestId,
            root,
            queueState: 'running',
            runId,
        }),
        markQueueRequestTerminalPublished: async ({ requestId, runId }) => createQueueRequest({
            requestId,
            root,
            queueState: 'running',
            runId,
        }),
        findOldestCleanupBlockedQueueRequest: async () => null,
        findOldestRunningQueueRequest: async () => null,
        promoteOldestWaitingQueueRequest: async () => null,
    });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
        unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    let sdkCalls = 0;
    try {
        const runId = await startIngest({
            path: root,
            name: 'openai-provider-failure',
            model: 'openai/text-embedding-3-small',
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
            operation: 'start',
        }, {
            baseUrl: 'http://lmstudio.local',
            lmClientFactory: () => ({}) as never,
            openAiRetrySleep: async () => { },
            openAiClientFactory: () => ({
                embeddings: {
                    create: async () => {
                        sdkCalls += 1;
                        throw {
                            status: 429,
                            headers: { 'retry-after-ms': '1234' },
                            message: 'Rate limit reached for text-embedding-3-small in organization org-b0ryOxiEjneU4p7xMv88rMQr with sk-test-key',
                        };
                    },
                },
                models: {
                    list: async () => ({ data: [{ id: 'text-embedding-3-small' }] }),
                },
            }) satisfies OpenAiClientLike,
        });
        __setQueueRequestIdForRunForTest(runId, 'queue-openai-provider-failure');
        assert.equal(scheduledTasks.length, 1);
        scheduledTasks[0]!();
        const result = await waitForTerminalIngestStatus(runId, {
            timeoutMs: 5000,
            pollMs: 1,
        });
        assert.equal(result.reason, 'terminal');
        assert.equal(result.status?.state, 'error');
        assert.equal(result.status?.error?.provider, 'openai');
        assert.equal(result.status?.error?.error, 'OPENAI_RATE_LIMITED');
        assert.equal(result.status?.error?.retryable, true);
        assert.equal(result.status?.error?.upstreamStatus, 429);
        assert.equal(result.status?.error?.retryAfterMs, 1234);
        assert.equal(result.status?.lastError?.includes('org-b0ry'), false);
        assert.equal(result.status?.lastError?.includes('sk-test-key'), false);
        assert.equal(sdkCalls, 2);
        await waitForNextTurn();
        await waitForNextTurn();
        assert.deepEqual(unhandledRejections, []);
    }
    finally {
        process.off('unhandledRejection', onUnhandledRejection);
        await cleanup();
        disposeOpenAiTokenizer();
        setOpenAiTokenizerFactoryForTests();
        if (previousKey === undefined) {
            clearScopedTestEnvValue("CODEINFO_OPENAI_EMBEDDING_KEY");
        }
        else {
            setScopedTestEnvValue("CODEINFO_OPENAI_EMBEDDING_KEY", previousKey);
        }
        if (previousRetries === undefined) {
            clearScopedTestEnvValue("CODEINFO_OPENAI_INGEST_MAX_RETRIES");
        }
        else {
            setScopedTestEnvValue("CODEINFO_OPENAI_INGEST_MAX_RETRIES", previousRetries);
        }
    }
});
