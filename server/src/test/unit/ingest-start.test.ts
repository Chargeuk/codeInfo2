import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach, mock } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import { ChromaClient } from 'chromadb';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { __resetAstParserLogStateForTest, __setParseAstSourceForTest, } from '../../ast/parser.js';
import { resetCollectionsForTests } from '../../ingest/chromaClient.js';
import { __resetIngestJobsForTest, pumpIngestQueue, startIngest, waitForTerminalIngestStatus, } from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import { resolveRequestEmbeddingSelection } from '../../ingest/requestContracts.js';
import { __resetIngestQueueAvailabilityForTest, getCurrentQueueRequestPosition, markIngestQueueUnavailable, enqueueOrReuseIngestRequest, } from '../../ingest/requestQueue.js';
import type { CurrentQueueRequestPositionResult, EnqueueIngestRequestInput, EnqueueIngestRequestResult, } from '../../ingest/requestQueue.js';
import { query, resetStore } from '../../logStore.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_MESSAGE } from '../../startup/ingestQueueStartup.js';
type PumpIngestQueueResult = Awaited<ReturnType<typeof pumpIngestQueue>>;
const ORIGINAL_CODEINFO_CODEX_WORKDIR = process.env.CODEINFO_CODEX_WORKDIR;
function buildQueueResult(overrides: Partial<EnqueueIngestRequestResult> = {}): EnqueueIngestRequestResult {
    return {
        requestId: 'queue-request-123',
        canonicalTargetPath: '/tmp/repo',
        queueState: 'waiting',
        queuePosition: 1,
        runId: null,
        reusedExisting: false,
        updatedExisting: false,
        queueRequest: {} as EnqueueIngestRequestResult['queueRequest'],
        ...overrides,
    };
}
function buildApp(options?: {
    locked?: {
        embeddingProvider: 'lmstudio' | 'openai';
        embeddingModel: string;
        embeddingDimensions: number;
        lockedModelId: string;
        source: 'canonical' | 'legacy';
    } | null;
    enqueueOrReuseIngestRequest?: (input: EnqueueIngestRequestInput) => Promise<EnqueueIngestRequestResult>;
    getCurrentQueueRequestPosition?: (requestId: string) => Promise<CurrentQueueRequestPositionResult>;
    useRealQueueRequest?: boolean;
    pumpIngestQueue?: () => Promise<PumpIngestQueueResult>;
}) {
    const app = express();
    let lastQueueResult: EnqueueIngestRequestResult | null = null;
    app.use(express.json());
    app.use(createIngestStartRouter({
        clientFactory: () => ({}) as never,
        getLockedEmbeddingModel: async () => options?.locked ?? null,
        enqueueOrReuseIngestRequest: async (input) => {
            const result = options?.useRealQueueRequest
                ? await enqueueOrReuseIngestRequest(input)
                : options?.enqueueOrReuseIngestRequest
                    ? await options.enqueueOrReuseIngestRequest(input)
                    : buildQueueResult({
                        canonicalTargetPath: input.canonicalTargetPath,
                    });
            lastQueueResult = result;
            return result;
        },
        getCurrentQueueRequestPosition: async (requestId) => options?.getCurrentQueueRequestPosition
            ? options.getCurrentQueueRequestPosition(requestId)
            : options?.useRealQueueRequest
                ? getCurrentQueueRequestPosition(requestId)
                : {
                    requestId,
                    queueState: lastQueueResult?.queueState ?? null,
                    queuePosition: lastQueueResult?.queuePosition ?? null,
                    runId: lastQueueResult?.runId ?? null,
                },
        pumpIngestQueue: async () => options?.pumpIngestQueue
            ? options.pumpIngestQueue()
            : ({
                started: true,
                blockedByCleanup: false,
                requestId: 'queue-request-123',
                runId: '00000000-0000-0000-0000-000000000001',
            } satisfies PumpIngestQueueResult),
    }));
    return app;
}
beforeEach(() => {
    resetStore();
    clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
});
afterEach(() => {
    mock.restoreAll();
    mock.reset();
    __resetIngestJobsForTest();
    __resetIngestQueueAvailabilityForTest();
    __resetAstParserLogStateForTest();
    __setParseAstSourceForTest();
    resetCollectionsForTests();
    release();
    clearScopedTestEnvValue("CODEINFO_INGEST_TEST_GIT_PATHS");
    clearScopedTestEnvValue("NODE_ENV");
    if (ORIGINAL_CODEINFO_CODEX_WORKDIR === undefined) {
        clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
    }
    else {
        setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", ORIGINAL_CODEINFO_CODEX_WORKDIR);
    }
});
const createTempRepo = async (files: Record<string, string>) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-ingest-'));
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
};
const waitForTerminal = async (runId: string) => {
    const result = await waitForTerminalIngestStatus(runId, {
        timeoutMs: 5000,
        pollMs: 10,
    });
    if (result.reason === 'terminal' && result.status) {
        return result.status;
    }
    throw new Error(`Timed out waiting for ingest ${runId} (reason=${result.reason}, lastKnown=${result.lastKnown?.state ?? 'missing'})`);
};
const setupIngestChromaMocks = () => {
    const vectors = {
        metadata: { lockedModelId: null as string | null },
        add: mock.fn(async () => { }),
        get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
        delete: mock.fn(async () => { }),
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
        count: async () => 0,
    };
    const roots = {
        get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
        add: mock.fn(async () => { }),
        delete: mock.fn(async () => { }),
    };
    mock.method(ChromaClient.prototype, 'getOrCreateCollection', async (opts: {
        name?: string;
    }) => {
        if (opts.name === 'ingest_roots')
            return roots as never;
        return vectors as never;
    });
    mock.method(ChromaClient.prototype, 'deleteCollection', async () => { });
    mock.method(IngestFileModel, 'bulkWrite', mock.fn(async () => ({})));
    mock.method(IngestFileModel, 'deleteMany', mock.fn(() => ({ exec: async () => ({}) })));
    (mongoose.connection as unknown as {
        readyState: number;
    }).readyState = 0;
    setScopedTestEnvValue("NODE_ENV", 'test');
    __setParseAstSourceForTest(async () => ({
        status: 'ok',
        language: 'typescript',
        symbols: [],
        edges: [],
        references: [],
        imports: [],
    }));
    return { vectors, roots };
};
const buildIngestDeps = () => {
    let embedCalls = 0;
    const embeddingModel = {
        embed: async () => {
            embedCalls += 1;
            return { embedding: [0.1, 0.2, 0.3] };
        },
        getContextLength: async () => 256,
        countTokens: async (text: string) => text.split(/\s+/).filter(Boolean).length,
    };
    return {
        baseUrl: 'http://lmstudio.local',
        lmClientFactory: () => ({
            embedding: {
                model: async () => embeddingModel,
            },
        }) as unknown as LMStudioClient,
        getEmbedCalls: () => embedCalls,
    };
};
test('ingest-start canonical fields are authoritative when legacy model is also present', async () => {
    let capturedModel = '';
    let capturedProvider: 'lmstudio' | 'openai' | undefined;
    let capturedEmbeddingModel: string | undefined;
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async (input) => {
            const payload = input.requestPayload as Record<string, unknown>;
            capturedModel = String(payload.model ?? '');
            capturedProvider = payload.embeddingProvider as 'lmstudio' | 'openai' | undefined;
            capturedEmbeddingModel = payload.embeddingModel as string | undefined;
            return {
                ...buildQueueResult(),
                canonicalTargetPath: input.canonicalTargetPath,
            };
        },
        pumpIngestQueue: async () => ({
            started: true,
            blockedByCleanup: false,
            requestId: 'queue-request-123',
            runId: '00000000-0000-0000-0000-000000000123',
        }),
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'legacy-model',
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        dryRun: true,
    });
    assert.equal(response.status, 202);
    assert.equal(response.body.runId, '00000000-0000-0000-0000-000000000123');
    assert.equal(response.body.requestId, 'queue-request-123');
    assert.equal(response.body.queued, false);
    assert.equal(response.body.queueState, 'running');
    assert.equal(capturedModel, 'openai/text-embedding-3-small');
    assert.equal(capturedProvider, 'openai');
    assert.equal(capturedEmbeddingModel, 'text-embedding-3-small');
});
test('ingest-start request contracts keep canonical embedding fields authoritative for the same canonical queue target', () => {
    const resolved = resolveRequestEmbeddingSelection({
        model: 'legacy-model',
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
    });
    assert.ok(!('status' in resolved));
    assert.equal(resolved.selection.providerId, 'openai');
    assert.equal(resolved.selection.modelKey, 'text-embedding-3-small');
});
test('ingest-start rejects bogus canonical provider even when legacy model is also present', async () => {
    let enqueueCalled = false;
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return buildQueueResult();
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'legacy-model',
        embeddingProvider: 'bogus',
        embeddingModel: 'text-embedding-3-small',
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'VALIDATION');
    assert.equal(response.body.message, 'embeddingProvider and embeddingModel are required when canonical fields are present');
    assert.equal(enqueueCalled, false);
});
test('ingest-start rejects blank canonical model even when legacy model is also present', async () => {
    let enqueueCalled = false;
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return buildQueueResult();
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'legacy-model',
        embeddingProvider: 'openai',
        embeddingModel: '',
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'VALIDATION');
    assert.equal(response.body.message, 'embeddingProvider and embeddingModel are required when canonical fields are present');
    assert.equal(enqueueCalled, false);
});
test('ingest-start rejects malformed typed body fields before queue admission or pump scheduling', async () => {
    const cases: Array<{
        title: string;
        body: Record<string, unknown>;
        message: string;
    }> = [
        {
            title: 'non-string name',
            body: {
                path: '/tmp/repo',
                name: 123,
                model: 'nomic-embed',
            },
            message: 'name must be a string',
        },
        {
            title: 'non-string description',
            body: {
                path: '/tmp/repo',
                name: 'repo',
                description: false,
                model: 'nomic-embed',
            },
            message: 'description must be a string',
        },
        {
            title: 'non-boolean dryRun',
            body: {
                path: '/tmp/repo',
                name: 'repo',
                dryRun: 'false',
                model: 'nomic-embed',
            },
            message: 'dryRun must be a boolean',
        },
        {
            title: 'unexpected body field',
            body: {
                path: '/tmp/repo',
                name: 'repo',
                model: 'nomic-embed',
                unexpected: 'value',
            },
            message: 'unexpected body field: unexpected',
        },
    ];
    for (const testCase of cases) {
        let enqueueCalled = false;
        let pumpCalled = false;
        const response = await request(buildApp({
            enqueueOrReuseIngestRequest: async () => {
                enqueueCalled = true;
                return buildQueueResult();
            },
            pumpIngestQueue: async () => {
                pumpCalled = true;
                return {
                    started: true,
                    blockedByCleanup: false,
                    requestId: 'queue-request-123',
                    runId: '00000000-0000-0000-0000-000000000123',
                };
            },
        }))
            .post('/ingest/start')
            .send(testCase.body);
        assert.equal(response.status, 400, testCase.title);
        assert.deepEqual(response.body, {
            status: 'error',
            code: 'VALIDATION',
            message: testCase.message,
        }, testCase.title);
        assert.equal(enqueueCalled, false, testCase.title);
        assert.equal(pumpCalled, false, testCase.title);
    }
});
test('ingest-start has a dedicated missing-name contract before queue admission', async () => {
    let enqueueCalled = false;
    let pumpCalled = false;
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return buildQueueResult();
        },
        pumpIngestQueue: async () => {
            pumpCalled = true;
            return {
                started: true,
                blockedByCleanup: false,
                requestId: 'queue-request-123',
                runId: '00000000-0000-0000-0000-000000000123',
            };
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
        status: 'error',
        code: 'VALIDATION',
        message: 'path and name are required',
    });
    assert.equal(enqueueCalled, false);
    assert.equal(pumpCalled, false);
});
test('ingest-start rejects relative queue roots before queue admission creates any row', async () => {
    let enqueueCalled = false;
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return buildQueueResult();
        },
    }))
        .post('/ingest/start')
        .send({
        path: 'relative/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'VALIDATION');
    assert.equal(response.body.message, 'path must be an absolute normalized repository root path');
    assert.equal(enqueueCalled, false);
});
test('ingest-start rejects out-of-scope absolute queue roots before queue admission creates any row', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/allowed/workdir');
    let enqueueCalled = false;
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return buildQueueResult();
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/outside/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'VALIDATION');
    assert.equal(response.body.message, 'path must stay within /allowed/workdir');
    assert.equal(enqueueCalled, false);
});
test('ingest-start keeps canonical repository-root admission working for allowed queue roots', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/allowed/workdir');
    let capturedCanonicalTargetPath = '';
    let capturedRequestPayloadPath = '';
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async (input) => {
            capturedCanonicalTargetPath = input.canonicalTargetPath;
            capturedRequestPayloadPath = String((input.requestPayload as Record<string, unknown>).path ?? '');
            return buildQueueResult({
                canonicalTargetPath: input.canonicalTargetPath,
            });
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/allowed/workdir/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 202);
    assert.equal(capturedCanonicalTargetPath, '/allowed/workdir/repo');
    assert.equal(capturedRequestPayloadPath, '/allowed/workdir/repo');
});
test('ingest-start rejects malformed non-placeholder CODEINFO_CODEX_WORKDIR values before enqueueing', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/allowed/workdir/');
    let enqueueCalled = false;
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return buildQueueResult();
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'CONFIGURATION');
    assert.equal(response.body.message, 'CODEINFO_CODEX_WORKDIR must be an absolute normalized repository root path or the exact placeholder "$CODEINFO_CODEX_WORKDIR"');
    assert.equal(enqueueCalled, false);
});
test('ingest-start rejects blank CODEINFO_CODEX_WORKDIR explicitly before enqueueing', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '');
    let enqueueCalled = false;
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return buildQueueResult();
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'CONFIGURATION');
    assert.equal(response.body.message, 'CODEINFO_CODEX_WORKDIR must not be blank');
    assert.equal(enqueueCalled, false);
});
test('ingest-start rejects whitespace-only CODEINFO_CODEX_WORKDIR explicitly before enqueueing', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '   ');
    let enqueueCalled = false;
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return buildQueueResult();
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'CONFIGURATION');
    assert.equal(response.body.message, 'CODEINFO_CODEX_WORKDIR must not be blank');
    assert.equal(enqueueCalled, false);
});
test('ingest-start keeps the exact CODEINFO_CODEX_WORKDIR placeholder exception narrow and accepted', async () => {
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '$CODEINFO_CODEX_WORKDIR');
    let capturedCanonicalTargetPath = '';
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async (input) => {
            capturedCanonicalTargetPath = input.canonicalTargetPath;
            return buildQueueResult({
                canonicalTargetPath: input.canonicalTargetPath,
            });
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 202);
    assert.equal(capturedCanonicalTargetPath, '/tmp/repo');
});
test('ingest-start legacy model maps to lmstudio compatibility input', async () => {
    let capturedModel = '';
    let capturedProvider: 'lmstudio' | 'openai' | undefined;
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async (input) => {
            const payload = input.requestPayload as Record<string, unknown>;
            capturedModel = String(payload.model ?? '');
            capturedProvider = payload.embeddingProvider as 'lmstudio' | 'openai' | undefined;
            return {
                ...buildQueueResult({ requestId: 'queue-request-124' }),
                canonicalTargetPath: input.canonicalTargetPath,
            };
        },
        pumpIngestQueue: async () => ({
            started: true,
            blockedByCleanup: false,
            requestId: 'queue-request-124',
            runId: '00000000-0000-0000-0000-000000000124',
        }),
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 202);
    assert.equal(response.body.runId, '00000000-0000-0000-0000-000000000124');
    assert.equal(response.body.requestId, 'queue-request-124');
    assert.equal(response.body.queued, false);
    assert.equal(response.body.queueState, 'running');
    assert.equal(capturedModel, 'nomic-embed');
    assert.equal(capturedProvider, 'lmstudio');
});
test('ingest-start logs QUEUE_REQUEST_ACCEPTED_WITH_REQUEST_ID with shared canonicalTargetPath', async () => {
    const response = await request(buildApp()).post('/ingest/start').send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, {
        queued: false,
        requestId: 'queue-request-123',
        runId: '00000000-0000-0000-0000-000000000001',
        queueState: 'running',
    });
    assert.equal('queuePosition' in response.body, false);
    const entries = query({ text: 'QUEUE_REQUEST_ACCEPTED_WITH_REQUEST_ID' }, 20);
    const acceptanceEntry = entries.find((entry) => entry.context?.endpoint === '/ingest/start' &&
        entry.context?.queueRequestId === 'queue-request-123' &&
        entry.context?.canonicalTargetPath === '/tmp/repo' &&
        entry.context?.runId === '00000000-0000-0000-0000-000000000001');
    assert.ok(acceptanceEntry, 'expected queue acceptance marker with shared canonicalTargetPath');
});
test('ingest-start waiting queue-aware contract returns queued true with requestId and waiting-only queuePosition', async () => {
    const response = await request(buildApp({
        pumpIngestQueue: async () => ({
            started: false,
            blockedByCleanup: false,
            requestId: null,
            runId: 'some-other-run',
        }),
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, {
        queued: true,
        requestId: 'queue-request-123',
        queuePosition: 1,
    });
    assert.equal('runId' in response.body, false);
    assert.equal('deduped' in response.body, false);
});
test('ingest-start post-pump promotion returns the refreshed waiting queuePosition in the response', async () => {
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async (input) => buildQueueResult({
            canonicalTargetPath: input.canonicalTargetPath,
            requestId: 'queue-request-new-start',
            queuePosition: 2,
        }),
        pumpIngestQueue: async () => ({
            started: true,
            blockedByCleanup: false,
            requestId: 'queue-request-older',
            runId: 'run-promoted-older',
        }),
        getCurrentQueueRequestPosition: async (requestId) => {
            assert.equal(requestId, 'queue-request-new-start');
            return {
                requestId,
                queueState: 'waiting',
                queuePosition: 1,
                runId: null,
            };
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, {
        queued: true,
        requestId: 'queue-request-new-start',
        queuePosition: 1,
    });
});
test('ingest-start post-pump promotion logs the refreshed waiting queuePosition in the accepted marker', async () => {
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async (input) => buildQueueResult({
            canonicalTargetPath: input.canonicalTargetPath,
            requestId: 'queue-request-new-start-log',
            queuePosition: 2,
        }),
        pumpIngestQueue: async () => ({
            started: true,
            blockedByCleanup: false,
            requestId: 'queue-request-older',
            runId: 'run-promoted-older',
        }),
        getCurrentQueueRequestPosition: async (requestId) => ({
            requestId,
            queueState: 'waiting',
            queuePosition: 1,
            runId: null,
        }),
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 202);
    const entries = query({ text: 'QUEUE_REQUEST_ACCEPTED_WITH_REQUEST_ID' }, 20);
    const acceptanceEntry = entries.find((entry) => entry.context?.endpoint === '/ingest/start' &&
        entry.context?.queueRequestId === 'queue-request-new-start-log');
    assert.ok(acceptanceEntry, 'expected accepted marker for queued request');
    assert.equal(acceptanceEntry.context?.queuePosition, 1);
});
test('ingest-start promoted duplicate returns immediate running acceptance instead of stale waiting semantics', async () => {
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async () => buildQueueResult({
            queueState: 'running',
            queuePosition: null,
            runId: '00000000-0000-0000-0000-000000000123',
            reusedExisting: true,
            updatedExisting: false,
        }),
        pumpIngestQueue: async () => ({
            started: false,
            blockedByCleanup: false,
            requestId: 'queue-request-other',
            runId: null,
        }),
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, {
        queued: false,
        requestId: 'queue-request-123',
        runId: '00000000-0000-0000-0000-000000000123',
        queueState: 'running',
    });
    assert.equal('queuePosition' in response.body, false);
    assert.equal('deduped' in response.body, false);
});
test('ingest-start immediate-start response includes running queueState and omits waiting queuePosition after the current-position lookup', async () => {
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async (input) => buildQueueResult({
            canonicalTargetPath: input.canonicalTargetPath,
            requestId: 'queue-request-immediate-start',
            queuePosition: 1,
        }),
        pumpIngestQueue: async () => ({
            started: true,
            blockedByCleanup: false,
            requestId: 'queue-request-immediate-start',
            runId: 'run-immediate-start',
        }),
        getCurrentQueueRequestPosition: async (requestId) => ({
            requestId,
            queueState: 'running',
            queuePosition: null,
            runId: 'run-immediate-start',
        }),
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, {
        queued: false,
        requestId: 'queue-request-immediate-start',
        runId: 'run-immediate-start',
        queueState: 'running',
    });
    assert.equal('queuePosition' in response.body, false);
});
test('ingest-start logs QUEUE_REQUEST_UPDATED_IN_PLACE with shared canonicalTargetPath', async () => {
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async (input) => buildQueueResult({
            canonicalTargetPath: input.canonicalTargetPath,
            reusedExisting: true,
            updatedExisting: true,
        }),
        pumpIngestQueue: async () => ({
            started: false,
            blockedByCleanup: false,
            requestId: null,
            runId: 'other-run',
        }),
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, {
        queued: true,
        requestId: 'queue-request-123',
        queuePosition: 1,
    });
    const entries = query({ text: 'QUEUE_REQUEST_UPDATED_IN_PLACE' }, 20);
    const updateEntry = entries.find((entry) => entry.context?.endpoint === '/ingest/start' &&
        entry.context?.queueRequestId === 'queue-request-123' &&
        entry.context?.canonicalTargetPath === '/tmp/repo' &&
        entry.context?.updatedExisting === true &&
        entry.context?.reusedExisting === true);
    assert.ok(updateEntry, 'expected updated-in-place queue marker with shared canonicalTargetPath');
});
test('ingest-start updated-in-place queue response preserves the reused requestId and queuePosition', async () => {
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async (input) => buildQueueResult({
            canonicalTargetPath: input.canonicalTargetPath,
            reusedExisting: true,
            updatedExisting: true,
            requestId: 'queue-request-reused-start',
            queuePosition: 4,
        }),
        pumpIngestQueue: async () => ({
            started: false,
            blockedByCleanup: false,
            requestId: null,
            runId: 'other-run',
        }),
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, {
        queued: true,
        requestId: 'queue-request-reused-start',
        queuePosition: 4,
    });
});
test('ingest-start rejects non-allowlisted OpenAI model ids deterministically', async () => {
    const response = await request(buildApp()).post('/ingest/start').send({
        path: '/tmp/repo',
        name: 'repo',
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-ada-002',
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'OPENAI_MODEL_UNAVAILABLE');
});
test('ingest-start conflict payload includes canonical lock and compatibility alias', async () => {
    const response = await request(buildApp({
        locked: {
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
            embeddingDimensions: 1536,
            lockedModelId: 'text-embedding-3-small',
            source: 'canonical',
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'MODEL_LOCKED');
    assert.equal(response.body.lockedModelId, 'text-embedding-3-small');
    assert.deepEqual(response.body.lock, {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 1536,
    });
});
test('ingest-start rejects lock mismatch before enqueueing', async () => {
    let enqueueCalled = false;
    const response = await request(buildApp({
        locked: {
            embeddingProvider: 'lmstudio',
            embeddingModel: 'embed-locked',
            embeddingDimensions: 768,
            lockedModelId: 'embed-locked',
            source: 'canonical',
        },
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return buildQueueResult();
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'embed-1',
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'MODEL_LOCKED');
    assert.equal(enqueueCalled, false);
    assert.deepEqual(response.body.lock, {
        embeddingProvider: 'lmstudio',
        embeddingModel: 'embed-locked',
        embeddingDimensions: 768,
    });
});
test('ingest-start sanitizes secret-like values in generic 500 messages', async () => {
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async () => {
            throw new Error('Authorization: Bearer sk-secret-token-value');
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 500);
    assert.equal(typeof response.body.message, 'string');
    assert.equal(response.body.message.includes('sk-secret-token-value'), false);
    assert.equal(/authorization:\*\*\*|bearer \*\*\*/i.test(response.body.message), true);
    const entries = query({ text: 'DEV-0000036:T17:ingest_provider_failure' }, 20);
    const errorEntry = entries.find((entry) => entry.level === 'error' &&
        entry.context?.surface === 'ingest/start' &&
        entry.context?.retryable === false);
    assert.ok(errorEntry, 'expected non-retryable error log for generic 500');
});
test('ingest-start maps queue outages to retryable 503 without Retry-After by default', async () => {
    const response = await request(buildApp({
        enqueueOrReuseIngestRequest: async () => {
            const error = new Error('Mongo-backed ingest queue is unavailable while Mongo is disconnected');
            (error as {
                code?: string;
                retryable?: boolean;
                status?: number;
            }).code = 'QUEUE_UNAVAILABLE';
            (error as {
                retryable?: boolean;
            }).retryable = true;
            (error as {
                status?: number;
            }).status = 503;
            throw error;
        },
    }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
        status: 'error',
        code: 'QUEUE_UNAVAILABLE',
        retryable: true,
        message: 'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
    });
    assert.equal(response.headers['retry-after'], undefined);
    const entries = query({ text: 'DEV-0000036:T17:ingest_provider_failure' }, 20);
    const warnEntry = entries.find((entry) => entry.level === 'warn' &&
        entry.context?.surface === 'ingest/start' &&
        entry.context?.code === 'QUEUE_UNAVAILABLE');
    assert.ok(warnEntry, 'expected retryable warn log for queue outage');
});
test('ingest-start initial Mongo outage returns retryable 503 QUEUE_UNAVAILABLE without starting queue work', async () => {
    (mongoose.connection as unknown as {
        readyState: number;
    }).readyState = 1;
    markIngestQueueUnavailable(INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_MESSAGE);
    const response = await request(buildApp({ useRealQueueRequest: true }))
        .post('/ingest/start')
        .send({
        path: '/tmp/repo',
        name: 'repo',
        model: 'nomic-embed',
    });
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
        status: 'error',
        code: 'QUEUE_UNAVAILABLE',
        retryable: true,
        message: INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_MESSAGE,
    });
    const entries = query({ text: 'DEV-0000036:T17:ingest_provider_failure' }, 20);
    const warnEntry = entries.find((entry) => entry.level === 'warn' &&
        entry.context?.surface === 'ingest/start' &&
        entry.context?.code === 'QUEUE_UNAVAILABLE' &&
        entry.context?.message === INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_MESSAGE);
    assert.ok(warnEntry, 'expected retryable warn log for degraded startup queue outage');
});
test('blank-only fresh ingest now fails with the zero-files NO_ELIGIBLE_FILES contract', async () => {
    const { roots, vectors } = setupIngestChromaMocks();
    const deps = buildIngestDeps();
    const { root, cleanup } = await createTempRepo({
        'src/blank.ts': '   \n\t  \n',
    });
    try {
        const runId = await startIngest({ path: root, name: 'blank-repo', model: 'embed-model' }, deps);
        const status = await waitForTerminal(runId);
        assert.equal(status.state, 'error');
        assert.equal(status.error?.error, 'NO_ELIGIBLE_FILES');
        assert.match(String(status.lastError ?? ''), /no eligible files/i);
        assert.equal(deps.getEmbedCalls(), 0);
        assert.equal(vectors.add.mock.calls.length, 0);
        assert.equal(roots.add.mock.calls.length, 0);
    }
    finally {
        await cleanup();
    }
});
test('blank-only fresh ingest leaves no completed root summary or success persistence behind', async () => {
    const { roots, vectors } = setupIngestChromaMocks();
    const ingestFileBulkWrite = IngestFileModel.bulkWrite as unknown as {
        mock: {
            calls: unknown[];
        };
    };
    const { root, cleanup } = await createTempRepo({
        'src/blank.ts': '\n   \n',
    });
    try {
        const runId = await startIngest({ path: root, name: 'blank-repo', model: 'embed-model' }, buildIngestDeps());
        const status = await waitForTerminal(runId);
        assert.equal(status.state, 'error');
        assert.equal(roots.add.mock.calls.length, 0);
        assert.equal(vectors.add.mock.calls.length, 0);
        assert.equal(ingestFileBulkWrite.mock.calls.length, 0);
        const entries = query({
            text: 'DEV-0000046:T5:fresh-ingest-zero-embeddable',
        });
        assert.ok(entries.length > 0, 'expected Task 5 verification log');
    }
    finally {
        await cleanup();
    }
});
test('fresh ingest with valid and blank files succeeds while embedding only valid chunks', async () => {
    const { roots, vectors } = setupIngestChromaMocks();
    const deps = buildIngestDeps();
    const { root, cleanup } = await createTempRepo({
        'src/blank.ts': '   \n\n',
        'src/valid.ts': 'export function keepMe() { return 1; }\n',
    });
    try {
        const runId = await startIngest({ path: root, name: 'mixed-repo', model: 'embed-model' }, deps);
        const status = await waitForTerminal(runId);
        assert.equal(status.state, 'completed');
        assert.equal(status.counts.files, 2);
        assert.ok(status.counts.chunks > 0);
        assert.ok(status.counts.embedded > 0);
        assert.equal(deps.getEmbedCalls(), status.counts.embedded);
        assert.equal(vectors.add.mock.calls.length, 1);
        assert.equal(roots.add.mock.calls.length, 1);
    }
    finally {
        await cleanup();
    }
});
