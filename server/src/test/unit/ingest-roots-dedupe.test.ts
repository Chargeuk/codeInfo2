import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { INGEST_ROOTS_SCHEMA_VERSION } from '@codeinfo2/common';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { __resetIngestJobsForTest, __setJobInputForTest, __setStatusForTest, } from '../../ingest/ingestJob.js';
import { query, resetStore } from '../../logStore.js';
import { IngestQueueRequestModel } from '../../mongo/ingestQueueRequest.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
import { dedupeRootsByPath } from '../../routes/ingestRoots.js';
const ORIGINAL_HOST = process.env.CODEINFO_HOST_INGEST_DIR;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_READY_STATE = mongoose.connection.readyState;
function createRootsApp(roots: {
    ids: string[];
    metadatas: Record<string, unknown>[];
}, lockedModelId: string | null) {
    const app = express();
    app.use(express.json());
    app.use(createIngestRootsRouter({
        getLockedModel: async () => lockedModelId,
        getRootsCollection: async () => ({
            get: async () => roots,
        }) as never,
    }));
    return app;
}
beforeEach(() => {
    setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", '/host/base');
    setScopedTestEnvValue("NODE_ENV", 'test');
    resetStore();
    __resetIngestJobsForTest();
    mock.restoreAll();
});
afterEach(() => {
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: ORIGINAL_READY_STATE,
    });
    if (ORIGINAL_HOST === undefined) {
        clearScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR");
    }
    else {
        setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", ORIGINAL_HOST);
    }
    if (ORIGINAL_NODE_ENV === undefined) {
        clearScopedTestEnvValue("NODE_ENV");
    }
    else {
        setScopedTestEnvValue("NODE_ENV", ORIGINAL_NODE_ENV);
    }
});
test('dedupeRootsByPath: keeps newest by lastIngestAt when path duplicates', () => {
    const lock = {
        embeddingProvider: 'lmstudio' as const,
        embeddingModel: 'embed-1',
        embeddingDimensions: 0,
        lockedModelId: 'embed-1',
        modelId: 'embed-1',
    };
    const roots = [
        {
            id: 'old',
            runId: 'r1',
            name: 'old',
            description: null,
            path: '/data/repo',
            embeddingProvider: 'lmstudio' as const,
            embeddingModel: 'embed-1',
            embeddingDimensions: 0,
            model: 'embed-1',
            modelId: 'embed-1',
            lock,
            status: 'completed',
            lastIngestAt: '2026-01-01T00:00:00Z',
            counts: { files: 1, chunks: 1, embedded: 1 },
            lastError: null,
        },
        {
            id: 'new',
            runId: 'r2',
            name: 'new',
            description: null,
            path: '/data/repo',
            embeddingProvider: 'lmstudio' as const,
            embeddingModel: 'embed-1',
            embeddingDimensions: 0,
            model: 'embed-1',
            modelId: 'embed-1',
            lock,
            status: 'completed',
            lastIngestAt: '2026-01-02T00:00:00Z',
            counts: { files: 1, chunks: 1, embedded: 1 },
            lastError: null,
        },
    ];
    const deduped = dedupeRootsByPath(roots);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0]?.runId, 'r2');
    assert.equal(deduped[0]?.name, 'new');
});
test('dedupeRootsByPath: keeps canonical id and waiting metadata ahead of runtime-only runId when timestamps tie', () => {
    const lock = {
        embeddingProvider: 'lmstudio' as const,
        embeddingModel: 'embed-1',
        embeddingDimensions: 0,
        lockedModelId: 'embed-1',
        modelId: 'embed-1',
    };
    const roots = [
        {
            id: '/data/repo',
            requestId: 'queue-request-1',
            runId: null,
            queueState: 'waiting' as const,
            queuePosition: 1,
            name: 'stable',
            description: null,
            path: '/data/repo',
            embeddingProvider: 'lmstudio' as const,
            embeddingModel: 'embed-1',
            embeddingDimensions: 0,
            model: 'embed-1',
            modelId: 'embed-1',
            lock,
            status: 'completed',
            lastIngestAt: null,
            counts: { files: 1, chunks: 1, embedded: 1 },
            lastError: null,
        },
        {
            id: 'runtime-row',
            runId: 'r9',
            name: 'runtime-row',
            description: null,
            path: '/data/repo',
            embeddingProvider: 'lmstudio' as const,
            embeddingModel: 'embed-1',
            embeddingDimensions: 0,
            model: 'embed-1',
            modelId: 'embed-1',
            lock,
            status: 'completed',
            lastIngestAt: null,
            counts: { files: 1, chunks: 1, embedded: 1 },
            lastError: null,
        },
    ];
    const deduped = dedupeRootsByPath(roots);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0]?.id, '/data/repo');
    assert.equal(deduped[0]?.requestId, 'queue-request-1');
    assert.equal(deduped[0]?.runId, null);
    assert.equal(deduped[0]?.queueState, 'waiting');
    assert.equal(deduped[0]?.queuePosition, 1);
    assert.equal(deduped[0]?.name, 'stable');
});
test('dedupeRootsByPath: preserves waiting-row metadata when duplicate roots share one path', () => {
    const lock = {
        embeddingProvider: 'lmstudio' as const,
        embeddingModel: 'embed-1',
        embeddingDimensions: 0,
        lockedModelId: 'embed-1',
        modelId: 'embed-1',
    };
    const roots = [
        {
            id: '/data/repo',
            requestId: 'queue-request-2',
            runId: null,
            queueState: 'waiting' as const,
            queuePosition: 2,
            name: 'queued',
            description: 'queue overlay',
            path: '/data/repo',
            embeddingProvider: 'openai' as const,
            embeddingModel: 'text-embedding-3-small',
            embeddingDimensions: 1536,
            model: 'text-embedding-3-small',
            modelId: 'text-embedding-3-small',
            lock,
            status: 'ingesting',
            phase: 'queued',
            lastIngestAt: null,
            counts: { files: 0, chunks: 0, embedded: 0 },
            lastError: null,
        },
        {
            id: 'stale-runtime-row',
            runId: 'run-queued-2',
            name: 'stale-runtime-row',
            description: null,
            path: '/data/repo',
            embeddingProvider: 'lmstudio' as const,
            embeddingModel: 'embed-1',
            embeddingDimensions: 0,
            model: 'embed-1',
            modelId: 'embed-1',
            lock,
            status: 'ingesting',
            phase: 'scanning',
            lastIngestAt: null,
            counts: { files: 1, chunks: 2, embedded: 1 },
            lastError: null,
        },
    ];
    const deduped = dedupeRootsByPath(roots);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0]?.id, '/data/repo');
    assert.equal(deduped[0]?.requestId, 'queue-request-2');
    assert.equal(deduped[0]?.queueState, 'waiting');
    assert.equal(deduped[0]?.queuePosition, 2);
    assert.equal(deduped[0]?.runId, null);
    assert.equal(deduped[0]?.embeddingProvider, 'openai');
    assert.equal(deduped[0]?.embeddingModel, 'text-embedding-3-small');
});
test('GET /ingest/roots returns canonical lock value from the unified resolver', async () => {
    const response = await request(createRootsApp({
        ids: ['run-1'],
        metadatas: [
            {
                name: 'repo',
                root: '/data/repo',
                model: 'embed-model',
            },
        ],
    }, 'text-embedding-openai')).get('/ingest/roots');
    assert.equal(response.status, 200);
    assert.equal(response.body.lockedModelId, 'text-embedding-openai');
    assert.equal(response.body.lock.embeddingModel, 'text-embedding-openai');
    assert.equal(response.body.lock.modelId, 'text-embedding-openai');
    assert.equal(response.body.roots.length, 1);
    assert.equal(response.body.roots[0].runId, null);
    assert.equal(response.body.roots[0].embeddingModel, 'embed-model');
    assert.equal(response.body.roots[0].model, 'embed-model');
    assert.equal(response.body.roots[0].modelId, 'embed-model');
    assert.equal(response.body.roots[0].lock.embeddingModel, 'embed-model');
    assert.equal(response.body.schemaVersion, INGEST_ROOTS_SCHEMA_VERSION);
});
test('GET /ingest/roots keeps genuine current structured error diagnostics visible while serializing the normalized error payload', async () => {
    const response = await request(createRootsApp({
        ids: ['run-2'],
        metadatas: [
            {
                name: 'repo',
                root: '/data/repo',
                model: 'text-embedding-3-small',
                lastError: 'rate limited',
                error: {
                    error: 'OPENAI_RATE_LIMITED',
                    message: 'rate limited',
                    retryable: true,
                    provider: 'openai',
                    upstreamStatus: 429,
                    retryAfterMs: 1000,
                },
            },
        ],
    }, 'text-embedding-3-small')).get('/ingest/roots');
    assert.equal(response.status, 200);
    assert.equal(response.body.roots[0].lastError, 'rate limited');
    assert.equal(response.body.roots[0].error.error, 'OPENAI_RATE_LIMITED');
    assert.equal(response.body.roots[0].error.message, 'rate limited');
    assert.equal(response.body.roots[0].error.retryable, true);
    assert.equal(response.body.roots[0].error.provider, 'openai');
    assert.equal(response.body.roots[0].error.upstreamStatus, 429);
    assert.equal(response.body.roots[0].error.retryAfterMs, 1000);
});
test('GET /ingest/roots normalizes legacy provider-qualified waiting model ids the same way admission does', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    try {
        mock.method(IngestQueueRequestModel, 'find', () => ({
            sort: () => ({
                exec: async () => [
                    {
                        _id: new mongoose.Types.ObjectId('000000000000000000000059'),
                        canonicalTargetPath: '/data/queued-root',
                        operation: 'reembed',
                        queueState: 'waiting',
                        requestPayload: {
                            path: '/data/queued-root',
                            name: 'legacy-repo',
                            model: 'openai/text-embedding-3-small',
                        },
                        sourceSurface: 'rest:ingest/reembed',
                        runId: null,
                        createdAt: new Date('2026-04-02T00:00:00.000Z'),
                        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                    },
                ],
            }),
        }) as never);
        const response = await request(createRootsApp({
            ids: ['persisted-run'],
            metadatas: [
                {
                    name: 'legacy-repo',
                    root: '/data/queued-root',
                    model: 'legacy-lmstudio-model',
                    embeddingProvider: 'lmstudio',
                    embeddingModel: 'legacy-lmstudio-model',
                    state: 'completed',
                    lastIngestAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        }, 'legacy-lmstudio-model')).get('/ingest/roots');
        assert.equal(response.status, 200);
        assert.equal(response.body.roots.length, 1);
        const root = response.body.roots[0];
        assert.equal(root.queueState, 'waiting');
        assert.equal(root.embeddingProvider, 'openai');
        assert.equal(root.embeddingModel, 'text-embedding-3-small');
        assert.equal(root.model, 'text-embedding-3-small');
        assert.equal(root.modelId, 'text-embedding-3-small');
    }
    finally {
        Object.defineProperty(mongoose.connection, 'readyState', {
            configurable: true,
            value: originalReadyState,
        });
    }
});
test('GET /ingest/roots keeps the current canonical waiting row contract unchanged while landing legacy compatibility', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    try {
        mock.method(IngestQueueRequestModel, 'find', () => ({
            sort: () => ({
                exec: async () => [
                    {
                        _id: new mongoose.Types.ObjectId('000000000000000000000060'),
                        canonicalTargetPath: '/data/queued-root',
                        operation: 'reembed',
                        queueState: 'waiting',
                        requestPayload: {
                            path: '/data/queued-root',
                            name: 'legacy-repo',
                            model: 'legacy-lmstudio-model',
                            embeddingProvider: 'openai',
                            embeddingModel: 'text-embedding-3-small',
                        },
                        sourceSurface: 'rest:ingest/reembed',
                        runId: null,
                        createdAt: new Date('2026-04-02T00:00:00.000Z'),
                        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                    },
                ],
            }),
        }) as never);
        const response = await request(createRootsApp({
            ids: ['persisted-run'],
            metadatas: [
                {
                    name: 'legacy-repo',
                    root: '/data/queued-root',
                    model: 'legacy-lmstudio-model',
                    embeddingProvider: 'lmstudio',
                    embeddingModel: 'legacy-lmstudio-model',
                    state: 'completed',
                    lastIngestAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        }, 'legacy-lmstudio-model')).get('/ingest/roots');
        assert.equal(response.status, 200);
        assert.equal(response.body.roots.length, 1);
        const root = response.body.roots[0];
        assert.equal(root.queueState, 'waiting');
        assert.equal(root.embeddingProvider, 'openai');
        assert.equal(root.embeddingModel, 'text-embedding-3-small');
        assert.equal(root.model, 'text-embedding-3-small');
        assert.equal(root.modelId, 'text-embedding-3-small');
    }
    finally {
        Object.defineProperty(mongoose.connection, 'readyState', {
            configurable: true,
            value: originalReadyState,
        });
    }
});
test('GET /ingest/roots keeps provider-qualified identity when model ids collide across providers', async () => {
    const response = await request(createRootsApp({
        ids: ['openai-run', 'lmstudio-run'],
        metadatas: [
            {
                name: 'repo-openai',
                root: '/data/openai',
                model: 'shared-id',
                embeddingProvider: 'openai',
                embeddingModel: 'shared-id',
                embeddingDimensions: 1536,
            },
            {
                name: 'repo-lmstudio',
                root: '/data/lmstudio',
                model: 'shared-id',
                embeddingProvider: 'lmstudio',
                embeddingModel: 'shared-id',
                embeddingDimensions: 768,
            },
        ],
    }, 'shared-id')).get('/ingest/roots');
    assert.equal(response.status, 200);
    assert.equal(response.body.roots.length, 2);
    const openaiRoot = response.body.roots.find((root: {
        embeddingProvider?: string;
        path?: string;
    }) => root.path === '/data/openai');
    const lmstudioRoot = response.body.roots.find((root: {
        embeddingProvider?: string;
        path?: string;
    }) => root.path === '/data/lmstudio');
    assert.equal(openaiRoot?.embeddingProvider, 'openai');
    assert.equal(openaiRoot?.embeddingModel, 'shared-id');
    assert.equal(openaiRoot?.modelId, 'shared-id');
    assert.equal(lmstudioRoot?.embeddingProvider, 'lmstudio');
    assert.equal(lmstudioRoot?.embeddingModel, 'shared-id');
    assert.equal(lmstudioRoot?.modelId, 'shared-id');
});
test('GET /ingest/roots preserves canonical queued repository identity alongside waiting queue metadata on the standard REST mirror', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000055'),
                    canonicalTargetPath: '/data/queued-repo',
                    operation: 'start',
                    queueState: 'waiting',
                    requestPayload: {
                        path: '/data/queued-repo',
                        name: 'queued-repo',
                        description: 'queued from test',
                        model: 'embed-model',
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 'embed-model',
                    },
                    sourceSurface: 'rest:ingest/start',
                    runId: null,
                    createdAt: new Date('2026-04-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                },
            ],
        }),
    }) as never);
    const response = await request(createRootsApp({ ids: [], metadatas: [] }, 'embed-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    assert.equal(response.body.roots.length, 1);
    const root = response.body.roots[0];
    assert.equal(root.id, '/data/queued-repo');
    assert.equal(root.requestId, '000000000000000000000055');
    assert.equal(root.runId, null);
    assert.equal(root.queueState, 'waiting');
    assert.equal(root.queuePosition, 1);
    assert.equal(root.status, 'ingesting');
    assert.equal(root.phase, 'queued');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots keeps a partial-canonical waiting overlay on one canonical provider/model pair', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000101'),
                    canonicalTargetPath: '/data/repo',
                    operation: 'reembed',
                    queueState: 'waiting',
                    requestPayload: {
                        path: '/data/repo',
                        name: 'repo',
                        model: 'legacy-lmstudio-model',
                    },
                    sourceSurface: 'rest:ingest/reembed',
                    runId: null,
                    createdAt: new Date('2026-04-15T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-15T00:00:00.000Z'),
                },
            ],
        }),
    }) as never);
    const response = await request(createRootsApp({
        ids: ['persisted-run'],
        metadatas: [
            {
                name: 'repo',
                root: '/data/repo',
                embeddingProvider: 'openai',
                embeddingModel: 'text-embedding-3-small',
                embeddingDimensions: 1536,
                model: 'legacy-lmstudio-model',
                modelId: 'legacy-lmstudio-model',
                state: 'completed',
                lastIngestAt: '2026-04-14T00:00:00.000Z',
            },
        ],
    }, 'text-embedding-3-small')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const root = response.body.roots[0];
    assert.equal(root.queueState, 'waiting');
    assert.equal(root.embeddingProvider, 'openai');
    assert.equal(root.embeddingModel, 'text-embedding-3-small');
    assert.equal(root.model, 'text-embedding-3-small');
    assert.equal(root.modelId, 'text-embedding-3-small');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots keeps a mixed-shape canonical OpenAI waiting row distinct by blanking the incompatible legacy fallback model', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000102'),
                    canonicalTargetPath: '/data/repo',
                    operation: 'reembed',
                    queueState: 'waiting',
                    requestPayload: {
                        path: '/data/repo',
                        name: 'repo',
                        model: 'legacy-lmstudio-model',
                        embeddingProvider: 'openai',
                    },
                    sourceSurface: 'rest:ingest/reembed',
                    runId: null,
                    createdAt: new Date('2026-04-15T00:01:00.000Z'),
                    updatedAt: new Date('2026-04-15T00:01:00.000Z'),
                },
            ],
        }),
    }) as never);
    const response = await request(createRootsApp({
        ids: ['persisted-run'],
        metadatas: [
            {
                name: 'repo',
                root: '/data/repo',
                model: 'legacy-lmstudio-model',
                state: 'completed',
                lastIngestAt: '2026-04-14T00:00:00.000Z',
            },
        ],
    }, 'legacy-lmstudio-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const root = response.body.roots[0];
    assert.equal(root.queueState, 'waiting');
    assert.equal(root.embeddingProvider, 'openai');
    assert.equal(root.embeddingModel, '');
    assert.equal(root.model, '');
    assert.equal(root.modelId, '');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots keeps a bridge-style completed mixed-shape OpenAI row invalid while preserving populated fallback lock metadata', async () => {
    const response = await request(createRootsApp({
        ids: ['persisted-run'],
        metadatas: [
            {
                name: 'repo',
                root: '/data/repo',
                model: '',
                embeddingProvider: 'openai',
                embeddingModel: '',
                embeddingDimensions: 0,
                state: 'completed',
                lastIngestAt: '2026-04-27T00:00:00.000Z',
            },
        ],
    }, 'legacy-lmstudio-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const root = response.body.roots[0];
    assert.equal(root.embeddingProvider, 'openai');
    assert.equal(root.embeddingModel, '');
    assert.equal(root.model, '');
    assert.equal(root.modelId, '');
    assert.equal(root.lock.embeddingProvider, 'openai');
    assert.equal(root.lock.embeddingModel, 'legacy-lmstudio-model');
    assert.equal(root.lock.lockedModelId, 'legacy-lmstudio-model');
    assert.equal(root.lock.modelId, 'legacy-lmstudio-model');
});
test('GET /ingest/roots keeps a fully canonical waiting overlay unchanged', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000103'),
                    canonicalTargetPath: '/data/repo',
                    operation: 'reembed',
                    queueState: 'waiting',
                    requestPayload: {
                        path: '/data/repo',
                        name: 'repo',
                        model: 'legacy-lmstudio-model',
                        embeddingProvider: 'openai',
                        embeddingModel: 'text-embedding-3-small',
                        embeddingDimensions: 1536,
                    },
                    sourceSurface: 'rest:ingest/reembed',
                    runId: null,
                    createdAt: new Date('2026-04-15T00:02:00.000Z'),
                    updatedAt: new Date('2026-04-15T00:02:00.000Z'),
                },
            ],
        }),
    }) as never);
    const response = await request(createRootsApp({
        ids: ['persisted-run'],
        metadatas: [
            {
                name: 'repo',
                root: '/data/repo',
                embeddingProvider: 'openai',
                embeddingModel: 'text-embedding-3-small',
                embeddingDimensions: 1536,
                model: 'legacy-lmstudio-model',
                state: 'completed',
                lastIngestAt: '2026-04-14T00:00:00.000Z',
            },
        ],
    }, 'text-embedding-3-small')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const root = response.body.roots[0];
    assert.equal(root.embeddingProvider, 'openai');
    assert.equal(root.embeddingModel, 'text-embedding-3-small');
    assert.equal(root.model, 'text-embedding-3-small');
    assert.equal(root.modelId, 'text-embedding-3-small');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots keeps a fully legacy waiting overlay on its legacy-compatible identity', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000104'),
                    canonicalTargetPath: '/data/repo',
                    operation: 'reembed',
                    queueState: 'waiting',
                    requestPayload: {
                        path: '/data/repo',
                        name: 'repo',
                        model: 'legacy-lmstudio-model',
                    },
                    sourceSurface: 'rest:ingest/reembed',
                    runId: null,
                    createdAt: new Date('2026-04-15T00:03:00.000Z'),
                    updatedAt: new Date('2026-04-15T00:03:00.000Z'),
                },
            ],
        }),
    }) as never);
    const response = await request(createRootsApp({
        ids: ['persisted-run'],
        metadatas: [
            {
                name: 'repo',
                root: '/data/repo',
                model: 'legacy-lmstudio-model',
                state: 'completed',
                lastIngestAt: '2026-04-14T00:00:00.000Z',
            },
        ],
    }, 'legacy-lmstudio-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const root = response.body.roots[0];
    assert.equal(root.embeddingProvider, 'lmstudio');
    assert.equal(root.embeddingModel, 'legacy-lmstudio-model');
    assert.equal(root.model, 'legacy-lmstudio-model');
    assert.equal(root.modelId, 'legacy-lmstudio-model');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots keeps cleanup-blocked diagnostics visible when queue document fields stay authoritative over persisted metadata', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000056'),
                    canonicalTargetPath: '/data/repo',
                    operation: 'start',
                    queueState: 'cleanup-blocked',
                    requestPayload: {
                        path: '/data/repo',
                        name: 'repo',
                        description: 'queued override',
                        model: 'embed-model',
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 'embed-model',
                    },
                    sourceSurface: 'rest:ingest/start',
                    runId: 'run-blocked',
                    createdAt: new Date('2026-04-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                },
            ],
        }),
    }) as never);
    __setStatusForTest('run-blocked', {
        runId: 'run-blocked',
        state: 'cleanup-blocked',
        counts: { files: 11, chunks: 22, embedded: 33 },
        lastError: 'Queue cleanup blocked',
    });
    const response = await request(createRootsApp({
        ids: ['persisted-run'],
        metadatas: [
            {
                name: 'repo',
                root: '/data/repo',
                model: 'embed-model',
                state: 'completed',
                lastIngestAt: '2026-01-01T00:00:00.000Z',
                files: 1,
                chunks: 2,
                embedded: 3,
            },
        ],
    }, 'embed-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    assert.equal(response.body.roots.length, 1);
    const root = response.body.roots[0];
    assert.equal(root.requestId, '000000000000000000000056');
    assert.equal(root.runId, 'run-blocked');
    assert.equal(root.queueState, 'cleanup-blocked');
    assert.equal(root.status, 'error');
    assert.equal(root.lastError, 'Queue cleanup blocked');
    assert.deepEqual(root.counts, { files: 11, chunks: 22, embedded: 33 });
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots applies cleanup-blocked diagnostic precedence over stale persisted diagnostics without runtime status', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    try {
        mock.method(IngestQueueRequestModel, 'find', () => ({
            sort: () => ({
                exec: async () => [
                    {
                        _id: new mongoose.Types.ObjectId('000000000000000000000057'),
                        canonicalTargetPath: '/data/repo-stale-error',
                        operation: 'start',
                        queueState: 'cleanup-blocked',
                        requestPayload: {
                            path: '/data/repo-stale-error',
                            name: 'repo-stale-error',
                            model: 'embed-model',
                            embeddingProvider: 'lmstudio',
                            embeddingModel: 'embed-model',
                        },
                        sourceSurface: 'rest:ingest/start',
                        runId: 'run-blocked-stale-error',
                        createdAt: new Date('2026-04-02T00:00:00.000Z'),
                        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                    },
                ],
            }),
        }) as never);
        const response = await request(createRootsApp({
            ids: ['persisted-stale-error-run'],
            metadatas: [
                {
                    name: 'repo-stale-error',
                    root: '/data/repo-stale-error',
                    model: 'embed-model',
                    state: 'error',
                    lastError: 'stale persisted provider failure',
                    lastIngestAt: '2026-01-01T00:00:00.000Z',
                    files: 1,
                    chunks: 2,
                    embedded: 0,
                },
            ],
        }, 'embed-model')).get('/ingest/roots');
        assert.equal(response.status, 200);
        assert.equal(response.body.roots.length, 1);
        const root = response.body.roots[0];
        assert.equal(root.requestId, '000000000000000000000057');
        assert.equal(root.runId, 'run-blocked-stale-error');
        assert.equal(root.queueState, 'cleanup-blocked');
        assert.equal(root.status, 'error');
        assert.equal(root.lastError, 'Queue cleanup blocked');
    }
    finally {
        Object.defineProperty(mongoose.connection, 'readyState', {
            configurable: true,
            value: originalReadyState,
        });
    }
});
test('GET /ingest/roots keeps cleanup-blocked diagnostics visible when a later waiting request targets the same root', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000079'),
                    canonicalTargetPath: '/data/repo',
                    operation: 'start',
                    queueState: 'cleanup-blocked',
                    requestPayload: {
                        path: '/data/repo',
                        name: 'repo',
                        description: 'blocked owner',
                        model: 'embed-model',
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 'embed-model',
                    },
                    sourceSurface: 'rest:ingest/start',
                    runId: 'run-blocked-later-waiting',
                    createdAt: new Date('2026-04-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                },
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000080'),
                    canonicalTargetPath: '/data/repo',
                    operation: 'reembed',
                    queueState: 'waiting',
                    requestPayload: {
                        path: '/data/repo',
                        name: 'repo',
                        description: 'later waiting row',
                        model: 'waiting-model',
                        embeddingProvider: 'openai',
                        embeddingModel: 'waiting-model',
                    },
                    sourceSurface: 'rest:ingest/reembed',
                    runId: null,
                    createdAt: new Date('2026-04-02T00:01:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:01:00.000Z'),
                },
            ],
        }),
    }) as never);
    __setStatusForTest('run-blocked-later-waiting', {
        runId: 'run-blocked-later-waiting',
        state: 'cleanup-blocked',
        counts: { files: 11, chunks: 22, embedded: 33 },
        lastError: 'Queue cleanup blocked',
    });
    const response = await request(createRootsApp({
        ids: ['persisted-run'],
        metadatas: [
            {
                name: 'repo',
                root: '/data/repo',
                model: 'embed-model',
                state: 'completed',
                lastIngestAt: '2026-01-01T00:00:00.000Z',
                files: 1,
                chunks: 2,
                embedded: 3,
            },
        ],
    }, 'embed-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    assert.equal(response.body.roots.length, 1);
    const root = response.body.roots[0];
    assert.equal(root.requestId, '000000000000000000000079');
    assert.equal(root.runId, 'run-blocked-later-waiting');
    assert.equal(root.queueState, 'cleanup-blocked');
    assert.equal(root.queuePosition, null);
    assert.equal(root.status, 'error');
    assert.equal(root.lastError, 'Queue cleanup blocked');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots serializes one authoritative queued row id when duplicate metadata and queue overlay target the same path', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000061'),
                    canonicalTargetPath: '/data/repo',
                    operation: 'start',
                    queueState: 'waiting',
                    requestPayload: {
                        path: '/data/repo',
                        name: 'repo',
                        description: 'queued from test',
                        model: 'embed-model',
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 'embed-model',
                    },
                    sourceSurface: 'rest:ingest/start',
                    runId: null,
                    createdAt: new Date('2026-04-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                },
            ],
        }),
    }) as never);
    const response = await request(createRootsApp({
        ids: ['older-row', 'newer-row'],
        metadatas: [
            {
                name: 'repo-old',
                root: '/data/repo',
                model: 'embed-model',
                state: 'completed',
                lastIngestAt: '2026-01-01T00:00:00.000Z',
            },
            {
                name: 'repo',
                root: '/data/repo',
                embeddingProvider: 'lmstudio',
                embeddingModel: 'embed-model',
                embeddingDimensions: 768,
                model: 'embed-model',
                files: 4,
                chunks: 8,
                embedded: 8,
                state: 'completed',
                lastIngestAt: '2026-01-02T00:00:00.000Z',
            },
        ],
    }, 'embed-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const matches = response.body.roots.filter((root: {
        path: string;
    }) => root.path === '/data/repo');
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.id, '/data/repo');
    assert.equal(matches[0]?.requestId, '000000000000000000000061');
    assert.equal(matches[0]?.queueState, 'waiting');
    assert.equal(matches[0]?.queuePosition, 1);
    assert.deepEqual(matches[0]?.counts, { files: 4, chunks: 8, embedded: 8 });
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots keeps the more complete duplicate metadata row before applying queue overlay', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000062'),
                    canonicalTargetPath: '/data/repo',
                    operation: 'start',
                    queueState: 'waiting',
                    requestPayload: {
                        path: '/data/repo',
                        name: 'repo',
                        model: 'embed-model',
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 'embed-model',
                    },
                    sourceSurface: 'rest:ingest/start',
                    runId: null,
                    createdAt: new Date('2026-04-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                },
            ],
        }),
    }) as never);
    const response = await request(createRootsApp({
        ids: ['partial-row', 'complete-row'],
        metadatas: [
            {
                name: 'repo-stale',
                root: '/data/repo',
                state: 'completed',
                lastIngestAt: '2026-01-03T00:00:00.000Z',
            },
            {
                name: 'repo',
                root: '/data/repo',
                embeddingProvider: 'lmstudio',
                embeddingModel: 'embed-model',
                embeddingDimensions: 768,
                model: 'embed-model',
                files: 9,
                chunks: 12,
                embedded: 12,
                state: 'completed',
                lastIngestAt: '2026-01-01T00:00:00.000Z',
            },
        ],
    }, 'embed-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const matches = response.body.roots.filter((root: {
        path: string;
    }) => root.path === '/data/repo');
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.name, 'repo');
    assert.deepEqual(matches[0]?.counts, { files: 9, chunks: 12, embedded: 12 });
    assert.equal(matches[0]?.embeddingModel, 'embed-model');
    assert.equal(matches[0]?.queueState, 'waiting');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots clears stale persisted description when a waiting duplicate update removes it from the queued payload', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000063'),
                    canonicalTargetPath: '/data/repo',
                    operation: 'start',
                    queueState: 'waiting',
                    requestPayload: {
                        path: '/data/repo',
                        name: 'repo',
                        model: 'embed-model',
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 'embed-model',
                    },
                    sourceSurface: 'rest:ingest/start',
                    runId: null,
                    createdAt: new Date('2026-04-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                },
            ],
        }),
    }) as never);
    const response = await request(createRootsApp({
        ids: ['persisted-row'],
        metadatas: [
            {
                name: 'repo',
                description: 'stale persisted description',
                root: '/data/repo',
                embeddingProvider: 'lmstudio',
                embeddingModel: 'embed-model',
                embeddingDimensions: 768,
                model: 'embed-model',
                files: 4,
                chunks: 8,
                embedded: 8,
                state: 'completed',
                lastIngestAt: '2026-01-02T00:00:00.000Z',
            },
        ],
    }, 'embed-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    assert.equal(response.body.roots.length, 1);
    const root = response.body.roots[0];
    assert.equal(root.requestId, '000000000000000000000063');
    assert.equal(root.queueState, 'waiting');
    assert.equal(root.queuePosition, 1);
    assert.equal(root.description, null);
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots clears stale persisted diagnostics when a healthy waiting queue overlay replaces the old failure state', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000091'),
                    canonicalTargetPath: '/data/repo',
                    operation: 'reembed',
                    queueState: 'waiting',
                    requestPayload: {
                        path: '/data/repo',
                        name: 'repo',
                        description: 'queued recovery',
                        model: 'fresh-model',
                        embeddingProvider: 'openai',
                        embeddingModel: 'fresh-model',
                    },
                    sourceSurface: 'rest:ingest/reembed',
                    runId: null,
                    createdAt: new Date('2026-04-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                },
            ],
        }),
    }) as never);
    const response = await request(createRootsApp({
        ids: ['persisted-run'],
        metadatas: [
            {
                name: 'repo',
                root: '/data/repo',
                model: 'stale-model',
                state: 'error',
                lastError: 'stale persisted failure',
                error: {
                    error: 'OPENAI_TIMEOUT',
                    message: 'stale persisted failure',
                    retryable: true,
                    provider: 'openai',
                },
            },
        ],
    }, 'stale-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const root = response.body.roots[0];
    assert.equal(root.queueState, 'waiting');
    assert.equal(root.status, 'ingesting');
    assert.equal(root.phase, 'queued');
    assert.equal(root.lastError, null);
    assert.equal(root.error, null);
    assert.equal(root.embeddingProvider, 'openai');
    assert.equal(root.embeddingModel, 'fresh-model');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots clears stale persisted diagnostics when a healthy running queue overlay replaces the old failure state', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000092'),
                    canonicalTargetPath: '/data/repo',
                    operation: 'reembed',
                    queueState: 'running',
                    requestPayload: {
                        path: '/data/repo',
                        name: 'repo',
                        model: 'fresh-model',
                        embeddingProvider: 'openai',
                        embeddingModel: 'fresh-model',
                    },
                    sourceSurface: 'rest:ingest/reembed',
                    runId: 'run-recovered',
                    createdAt: new Date('2026-04-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                },
            ],
        }),
    }) as never);
    __setStatusForTest('run-recovered', {
        runId: 'run-recovered',
        state: 'embedding',
        counts: { files: 6, chunks: 12, embedded: 4 },
        lastError: null,
    });
    const response = await request(createRootsApp({
        ids: ['persisted-run'],
        metadatas: [
            {
                name: 'repo',
                root: '/data/repo',
                model: 'stale-model',
                state: 'error',
                lastError: 'stale persisted failure',
                error: {
                    error: 'OPENAI_TIMEOUT',
                    message: 'stale persisted failure',
                    retryable: true,
                    provider: 'openai',
                },
            },
        ],
    }, 'stale-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const root = response.body.roots[0];
    assert.equal(root.queueState, 'running');
    assert.equal(root.status, 'ingesting');
    assert.equal(root.phase, 'embedding');
    assert.equal(root.lastError, null);
    assert.equal(root.error, null);
    assert.deepEqual(root.counts, { files: 6, chunks: 12, embedded: 4 });
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots running overlay mirrors fresh queue model metadata and rejects stale payload-path identity', async () => {
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000093'),
                    canonicalTargetPath: '/data/current-repo',
                    operation: 'reembed',
                    queueState: 'running',
                    requestPayload: {
                        path: '/data/stale-payload-repo',
                        name: 'current-repo',
                        description: 'fresh running description',
                        model: 'text-embedding-3-large',
                        embeddingProvider: 'openai',
                        embeddingModel: 'text-embedding-3-large',
                        embeddingDimensions: 3072,
                    },
                    sourceSurface: 'rest:ingest/reembed',
                    runId: 'roots-running-fresh-model-run',
                    createdAt: new Date('2026-04-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                },
            ],
        }),
    }) as never);
    __setStatusForTest('roots-running-fresh-model-run', {
        runId: 'roots-running-fresh-model-run',
        state: 'embedding',
        counts: { files: 6, chunks: 12, embedded: 5 },
    });
    const response = await request(createRootsApp({
        ids: ['current-run', 'stale-payload-run'],
        metadatas: [
            {
                root: '/data/current-repo',
                name: 'current-repo',
                description: 'stale persisted description',
                model: 'stale-model',
                embeddingProvider: 'lmstudio',
                embeddingModel: 'stale-model',
                embeddingDimensions: 768,
                state: 'completed',
                lastIngestAt: '2026-01-01T00:00:00.000Z',
                files: 1,
                chunks: 2,
                embedded: 3,
            },
            {
                root: '/data/stale-payload-repo',
                name: 'stale-payload-repo',
                model: 'wrong-row-model',
                embeddingProvider: 'lmstudio',
                embeddingModel: 'wrong-row-model',
                embeddingDimensions: 768,
                state: 'completed',
                lastIngestAt: '2026-01-02T00:00:00.000Z',
                files: 8,
                chunks: 9,
                embedded: 9,
            },
        ],
    }, 'stale-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    assert.equal(response.body.roots.length, 2);
    const currentRoot = response.body.roots.find((root: {
        id: string;
    }) => root.id === '/data/current-repo');
    const stalePayloadRoot = response.body.roots.find((root: {
        id: string;
    }) => root.id === '/data/stale-payload-repo');
    assert.ok(currentRoot);
    assert.ok(stalePayloadRoot);
    assert.equal(currentRoot.requestId, '000000000000000000000093');
    assert.equal(currentRoot.runId, 'roots-running-fresh-model-run');
    assert.equal(currentRoot.queueState, 'running');
    assert.equal(currentRoot.status, 'ingesting');
    assert.equal(currentRoot.phase, 'embedding');
    assert.equal(currentRoot.description, 'fresh running description');
    assert.equal(currentRoot.embeddingProvider, 'openai');
    assert.equal(currentRoot.embeddingModel, 'text-embedding-3-large');
    assert.equal(currentRoot.embeddingDimensions, 3072);
    assert.equal(currentRoot.model, 'text-embedding-3-large');
    assert.equal(currentRoot.modelId, 'text-embedding-3-large');
    assert.equal(currentRoot.lock.embeddingProvider, 'openai');
    assert.equal(currentRoot.lock.embeddingModel, 'text-embedding-3-large');
    assert.equal(stalePayloadRoot.requestId, null);
    assert.equal(stalePayloadRoot.queueState, null);
    assert.equal(stalePayloadRoot.embeddingModel, 'wrong-row-model');
});
test('GET /ingest/roots preserves the fresh structured runtime error when a running queue overlay reports a current failure', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    try {
        mock.method(IngestQueueRequestModel, 'find', () => ({
            sort: () => ({
                exec: async () => [
                    {
                        _id: new mongoose.Types.ObjectId('000000000000000000000093'),
                        canonicalTargetPath: '/data/runtime-error',
                        operation: 'reembed',
                        queueState: 'running',
                        requestPayload: {
                            path: '/data/runtime-error',
                            name: 'runtime-error',
                            model: 'fresh-model',
                            embeddingProvider: 'openai',
                            embeddingModel: 'fresh-model',
                        },
                        sourceSurface: 'rest:ingest/reembed',
                        runId: 'run-runtime-error',
                        createdAt: new Date('2026-04-02T00:00:00.000Z'),
                        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                    },
                ],
            }),
        }) as never);
        __setStatusForTest('run-runtime-error', {
            runId: 'run-runtime-error',
            state: 'error',
            counts: { files: 6, chunks: 12, embedded: 4 },
            lastError: 'fresh runtime failure',
            error: {
                error: 'OPENAI_TIMEOUT',
                message: 'fresh runtime failure',
                retryable: true,
                provider: 'openai',
            },
        });
        const response = await request(createRootsApp({
            ids: ['persisted-run'],
            metadatas: [
                {
                    name: 'runtime-error',
                    root: '/data/runtime-error',
                    model: 'stale-model',
                    state: 'error',
                    lastError: 'stale persisted failure',
                    error: {
                        error: 'OPENAI_TIMEOUT',
                        message: 'stale persisted failure',
                        retryable: true,
                        provider: 'openai',
                    },
                },
            ],
        }, 'stale-model')).get('/ingest/roots');
        assert.equal(response.status, 200);
        const root = response.body.roots[0];
        assert.equal(root.queueState, 'running');
        assert.equal(root.status, 'error');
        assert.equal(root.lastError, 'fresh runtime failure');
        assert.deepEqual(root.error, {
            error: 'OPENAI_TIMEOUT',
            message: 'fresh runtime failure',
            retryable: true,
            provider: 'openai',
        });
    }
    finally {
        Object.defineProperty(mongoose.connection, 'readyState', {
            configurable: true,
            value: originalReadyState,
        });
    }
});
test('GET /ingest/roots preserves the fresh structured ingest-origin runtime error when a running queue overlay reports a validation failure', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    try {
        mock.method(IngestQueueRequestModel, 'find', () => ({
            sort: () => ({
                exec: async () => [
                    {
                        _id: new mongoose.Types.ObjectId('000000000000000000000093'),
                        canonicalTargetPath: '/data/runtime-error',
                        operation: 'reembed',
                        queueState: 'running',
                        requestPayload: {
                            path: '/data/runtime-error',
                            name: 'runtime-error',
                            model: 'openai/text-embedding-3-small',
                        },
                        sourceSurface: 'rest:ingest/reembed',
                        runId: 'run-runtime-ingest-error',
                        createdAt: new Date('2026-04-02T00:00:00.000Z'),
                        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                    },
                ],
            }),
        }) as never);
        __setStatusForTest('run-runtime-ingest-error', {
            runId: 'run-runtime-ingest-error',
            state: 'error',
            counts: { files: 6, chunks: 12, embedded: 4 },
            lastError: 'fresh runtime validation failure',
            error: {
                error: 'INVALID_REEMBED_STATE',
                message: 'fresh runtime validation failure',
                retryable: false,
                provider: 'ingest',
            },
        });
        const response = await request(createRootsApp({
            ids: ['persisted-run'],
            metadatas: [
                {
                    name: 'runtime-error',
                    root: '/data/runtime-error',
                    model: 'stale-model',
                    state: 'error',
                    lastError: 'stale persisted failure',
                    error: {
                        error: 'OPENAI_TIMEOUT',
                        message: 'stale persisted failure',
                        retryable: true,
                        provider: 'openai',
                    },
                },
            ],
        }, 'stale-model')).get('/ingest/roots');
        assert.equal(response.status, 200);
        const root = response.body.roots[0];
        assert.equal(root.queueState, 'running');
        assert.equal(root.status, 'error');
        assert.equal(root.lastError, 'fresh runtime validation failure');
        assert.deepEqual(root.error, {
            error: 'INVALID_REEMBED_STATE',
            message: 'fresh runtime validation failure',
            retryable: false,
            provider: 'ingest',
        });
    }
    finally {
        Object.defineProperty(mongoose.connection, 'readyState', {
            configurable: true,
            value: originalReadyState,
        });
    }
});
test('GET /ingest/roots derives lastError from the fresh runtime error when the running overlay omits a separate string summary', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    try {
        mock.method(IngestQueueRequestModel, 'find', () => ({
            sort: () => ({
                exec: async () => [
                    {
                        _id: new mongoose.Types.ObjectId('000000000000000000000094'),
                        canonicalTargetPath: '/data/runtime-error',
                        operation: 'reembed',
                        queueState: 'running',
                        requestPayload: {
                            path: '/data/runtime-error',
                            name: 'runtime-error',
                            model: 'fresh-model',
                            embeddingProvider: 'openai',
                            embeddingModel: 'fresh-model',
                        },
                        sourceSurface: 'rest:ingest/reembed',
                        runId: 'run-runtime-error-derived',
                        createdAt: new Date('2026-04-02T00:00:00.000Z'),
                        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                    },
                ],
            }),
        }) as never);
        __setStatusForTest('run-runtime-error-derived', {
            runId: 'run-runtime-error-derived',
            state: 'error',
            counts: { files: 6, chunks: 12, embedded: 4 },
            lastError: null,
            error: {
                error: 'OPENAI_TIMEOUT',
                message: 'fresh runtime failure from error payload',
                retryable: true,
                provider: 'openai',
            },
        });
        const response = await request(createRootsApp({
            ids: ['persisted-run'],
            metadatas: [
                {
                    name: 'runtime-error',
                    root: '/data/runtime-error',
                    model: 'stale-model',
                    state: 'error',
                    lastError: 'stale persisted failure',
                    error: {
                        error: 'OPENAI_TIMEOUT',
                        message: 'stale persisted failure',
                        retryable: true,
                        provider: 'openai',
                    },
                },
            ],
        }, 'stale-model')).get('/ingest/roots');
        assert.equal(response.status, 200);
        const root = response.body.roots[0];
        assert.equal(root.queueState, 'running');
        assert.equal(root.status, 'error');
        assert.equal(root.lastError, 'fresh runtime failure from error payload');
    }
    finally {
        Object.defineProperty(mongoose.connection, 'readyState', {
            configurable: true,
            value: originalReadyState,
        });
    }
});
test('GET /ingest/roots replaces stale persisted diagnostics when a fresher running queue error wins', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    try {
        mock.method(IngestQueueRequestModel, 'find', () => ({
            sort: () => ({
                exec: async () => [
                    {
                        _id: new mongoose.Types.ObjectId('000000000000000000000095'),
                        canonicalTargetPath: '/data/runtime-error',
                        operation: 'reembed',
                        queueState: 'running',
                        requestPayload: {
                            path: '/data/runtime-error',
                            name: 'runtime-error',
                            model: 'fresh-model',
                            embeddingProvider: 'openai',
                            embeddingModel: 'fresh-model',
                        },
                        sourceSurface: 'rest:ingest/reembed',
                        runId: 'run-runtime-error-replaced',
                        createdAt: new Date('2026-04-02T00:00:00.000Z'),
                        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                    },
                ],
            }),
        }) as never);
        __setStatusForTest('run-runtime-error-replaced', {
            runId: 'run-runtime-error-replaced',
            state: 'error',
            counts: { files: 6, chunks: 12, embedded: 4 },
            lastError: null,
            error: null,
        });
        const response = await request(createRootsApp({
            ids: ['persisted-run'],
            metadatas: [
                {
                    name: 'runtime-error',
                    root: '/data/runtime-error',
                    model: 'stale-model',
                    state: 'error',
                    lastError: 'stale persisted failure',
                    error: {
                        error: 'OPENAI_TIMEOUT',
                        message: 'stale persisted failure',
                        retryable: true,
                        provider: 'openai',
                    },
                },
            ],
        }, 'stale-model')).get('/ingest/roots');
        assert.equal(response.status, 200);
        const root = response.body.roots[0];
        assert.equal(root.queueState, 'running');
        assert.equal(root.status, 'error');
        assert.equal(root.lastError, null);
        assert.equal(root.error, null);
    }
    finally {
        Object.defineProperty(mongoose.connection, 'readyState', {
            configurable: true,
            value: originalReadyState,
        });
    }
});
test('GET /ingest/roots maps ingesting phase states and omits phase for terminal statuses', async () => {
    const response = await request(createRootsApp({
        ids: ['queued', 'done', 'cancelled', 'errored', 'skipped'],
        metadatas: [
            { root: '/data/queued', name: 'queued', state: 'queued' },
            { root: '/data/done', name: 'done', state: 'completed' },
            { root: '/data/cancelled', name: 'cancelled', state: 'cancelled' },
            { root: '/data/errored', name: 'errored', state: 'error' },
            { root: '/data/skipped', name: 'skipped', state: 'skipped' },
        ],
    }, 'text-embed')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const roots = response.body.roots as Array<{
        path: string;
        status: string;
        phase?: string;
    }>;
    const byPath = new Map(roots.map((root) => [root.path, root]));
    const queued = byPath.get('/data/queued');
    const done = byPath.get('/data/done');
    const cancelled = byPath.get('/data/cancelled');
    const errored = byPath.get('/data/errored');
    const skipped = byPath.get('/data/skipped');
    assert.ok(queued);
    assert.ok(done);
    assert.ok(cancelled);
    assert.ok(errored);
    assert.ok(skipped);
    assert.deepEqual({ status: queued.status, phase: queued.phase }, { status: 'ingesting', phase: 'queued' });
    assert.equal(done.status, 'completed');
    assert.equal(done.phase, undefined);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.phase, undefined);
    assert.equal(errored.status, 'error');
    assert.equal(errored.phase, undefined);
    assert.equal(skipped.status, 'completed');
    assert.equal(skipped.phase, undefined);
});
test('GET /ingest/roots applies active overlay and synthesizes missing active roots', async () => {
    __setStatusForTest('active-root-run', {
        runId: 'active-root-run',
        state: 'embedding',
        counts: { files: 4, chunks: 8, embedded: 2 },
    });
    __setJobInputForTest('active-root-run', {
        path: '/data/repo',
        root: '/data/repo',
        name: 'repo',
        model: 'text-embed',
    });
    const response = await request(createRootsApp({
        ids: ['persisted-run'],
        metadatas: [
            {
                root: '/data/repo',
                name: 'repo',
                state: 'completed',
                lastIngestAt: '2026-01-02T00:00:00.000Z',
                files: 1,
                chunks: 2,
                embedded: 3,
            },
        ],
    }, 'text-embed')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const overlaid = response.body.roots.find((root: {
        path: string;
    }) => root.path === '/data/repo');
    assert.equal(overlaid.status, 'ingesting');
    assert.equal(overlaid.phase, 'embedding');
    assert.deepEqual(overlaid.counts, { files: 4, chunks: 8, embedded: 2 });
    assert.equal(overlaid.lastIngestAt, '2026-01-02T00:00:00.000Z');
});
test('GET /ingest/roots serializes one authoritative row when duplicate metadata and active overlay target the same path', async () => {
    __setStatusForTest('active-deduped-run', {
        runId: 'active-deduped-run',
        state: 'embedding',
        counts: { files: 5, chunks: 10, embedded: 3 },
    });
    __setJobInputForTest('active-deduped-run', {
        path: '/data/repo',
        root: '/data/repo',
        name: 'repo',
        model: 'text-embed',
    });
    const response = await request(createRootsApp({
        ids: ['stale-row', 'complete-row'],
        metadatas: [
            {
                root: '/data/repo',
                name: 'repo-stale',
                state: 'completed',
                lastIngestAt: '2026-01-03T00:00:00.000Z',
            },
            {
                root: '/data/repo',
                name: 'repo',
                embeddingProvider: 'lmstudio',
                embeddingModel: 'text-embed',
                embeddingDimensions: 768,
                model: 'text-embed',
                files: 1,
                chunks: 2,
                embedded: 3,
                state: 'completed',
                lastIngestAt: '2026-01-02T00:00:00.000Z',
            },
        ],
    }, 'text-embed')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const matches = response.body.roots.filter((root: {
        path: string;
    }) => root.path === '/data/repo');
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.status, 'ingesting');
    assert.equal(matches[0]?.phase, 'embedding');
    assert.equal(matches[0]?.runId, 'active-deduped-run');
    assert.deepEqual(matches[0]?.counts, { files: 5, chunks: 10, embedded: 3 });
});
test('GET /ingest/roots keeps one authoritative row for mixed-path recovered reembed overlays', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000064'),
                    canonicalTargetPath: '/data/codeInfo2/codeInfo2',
                    operation: 'reembed',
                    queueState: 'running',
                    requestPayload: {
                        path: '/host/base/codeInfo2/codeInfo2',
                        name: 'codeInfo2',
                        model: 'embed-model',
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 'embed-model',
                    },
                    sourceSurface: 'rest:ingest/reembed',
                    runId: 'mixed-path-route-run',
                    createdAt: new Date('2026-04-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                },
            ],
        }),
    }) as never);
    __setStatusForTest('mixed-path-route-run', {
        runId: 'mixed-path-route-run',
        state: 'embedding',
        counts: { files: 6, chunks: 12, embedded: 4 },
    });
    __setJobInputForTest('mixed-path-route-run', {
        path: '/data/codeInfo2/codeInfo2',
        root: '/data/codeInfo2/codeInfo2',
        canonicalTargetPath: '/data/codeInfo2/codeInfo2',
        name: 'codeInfo2',
        model: 'embed-model',
        operation: 'reembed',
    });
    const response = await request(createRootsApp({
        ids: ['partial-row', 'complete-row'],
        metadatas: [
            {
                root: '/host/base/codeInfo2/codeInfo2',
                name: 'codeInfo2-stale',
                state: 'completed',
                lastIngestAt: '2026-01-03T00:00:00.000Z',
            },
            {
                root: '/host/base/codeInfo2/codeInfo2',
                name: 'codeInfo2',
                embeddingProvider: 'lmstudio',
                embeddingModel: 'embed-model',
                embeddingDimensions: 768,
                model: 'embed-model',
                files: 10,
                chunks: 20,
                embedded: 20,
                state: 'completed',
                lastIngestAt: '2026-01-01T00:00:00.000Z',
            },
        ],
    }, 'embed-model')).get('/ingest/roots');
    assert.equal(response.status, 200);
    const matches = response.body.roots.filter((root: {
        path: string;
    }) => root.path === '/host/base/codeInfo2/codeInfo2');
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.name, 'codeInfo2');
    assert.equal(matches[0]?.requestId, '000000000000000000000064');
    assert.equal(matches[0]?.runId, 'mixed-path-route-run');
    assert.equal(matches[0]?.status, 'ingesting');
    assert.equal(matches[0]?.phase, 'embedding');
    assert.deepEqual(matches[0]?.counts, { files: 6, chunks: 12, embedded: 4 });
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('GET /ingest/roots synthesizes active root with canonical repository identity when persisted metadata is missing', async () => {
    __setStatusForTest('active-synth-run', {
        runId: 'active-synth-run',
        state: 'scanning',
        counts: { files: 1, chunks: 1, embedded: 0 },
    });
    __setJobInputForTest('active-synth-run', {
        path: '/data/only-active',
        root: '/data/only-active',
        name: 'only-active',
        model: 'text-embed',
    });
    const response = await request(createRootsApp({
        ids: [],
        metadatas: [],
    }, 'text-embed')).get('/ingest/roots');
    assert.equal(response.status, 200);
    assert.equal(response.body.roots.length, 1);
    assert.equal(response.body.roots[0].status, 'ingesting');
    assert.equal(response.body.roots[0].phase, 'scanning');
    assert.equal(response.body.roots[0].runId, 'active-synth-run');
    assert.equal(response.body.roots[0].id, '/data/only-active');
    assert.equal(response.body.roots[0].path, '/data/only-active');
});
test('GET /ingest/roots catch path emits structured failure log entry', async () => {
    const app = express();
    app.use(express.json());
    app.use(createIngestRootsRouter({
        getLockedModel: async () => null,
        getRootsCollection: async () => {
            throw new Error('db read failed');
        },
    }));
    const response = await request(app).get('/ingest/roots');
    assert.equal(response.status, 502);
    assert.equal(response.body.code, 'INGEST_ROOTS_LOOKUP_FAILED');
    const entries = query({ text: 'DEV-0000036:T17:ingest_provider_failure' }, 20);
    const errorEntry = entries.find((entry) => entry.level === 'error' &&
        entry.context?.surface === 'ingest/roots' &&
        entry.context?.code === 'INGEST_ROOTS_LOOKUP_FAILED');
    assert.ok(errorEntry, 'expected roots lookup failure log entry');
});
