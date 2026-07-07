import assert from 'node:assert/strict';
import test, { beforeEach, mock } from 'node:test';
import { INGEST_ROOTS_SCHEMA_VERSION } from '@codeinfo2/common';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { __resetIngestJobsForTest, __setJobInputForTest, __setStatusForTest, } from '../../ingest/ingestJob.js';
import { baseLogger } from '../../logger.js';
import { createMcpRouter } from '../../mcp/server.js';
import { IngestQueueRequestModel } from '../../mongo/ingestQueueRequest.js';
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DEV_0000038_MARKERS = process.env.DEV_0000038_MARKERS;
const ORIGINAL_HOST = process.env.CODEINFO_HOST_INGEST_DIR;
function createMcpApp({ lockedModelId, roots, }: {
    lockedModelId: string | null;
    roots?: {
        ids: string[];
        metadatas: Record<string, unknown>[];
    };
}) {
    const app = express();
    app.use(express.json());
    app.use(createMcpRouter({
        getRootsCollection: async () => ({
            get: async () => roots ?? {
                ids: ['run-1'],
                metadatas: [
                    {
                        name: 'repo',
                        root: '/data/repo',
                        model: 'embed-model',
                        files: 3,
                        chunks: 12,
                        embedded: 12,
                        lastIngestAt: '2026-01-01T00:00:00.000Z',
                        state: 'completed',
                        description: 'sample',
                        lastError: null,
                    },
                ],
            },
        }) as never,
        getLockedModel: async () => lockedModelId,
    }));
    return app;
}
beforeEach(() => {
    setScopedTestEnvValue("NODE_ENV", 'test');
    setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", '/home/d_a_s/code');
    __resetIngestJobsForTest();
    mock.restoreAll();
});
test.afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) {
        clearScopedTestEnvValue("NODE_ENV");
    }
    else {
        setScopedTestEnvValue("NODE_ENV", ORIGINAL_NODE_ENV);
    }
    if (ORIGINAL_DEV_0000038_MARKERS === undefined) {
        clearScopedTestEnvValue("DEV_0000038_MARKERS");
    }
    else {
        setScopedTestEnvValue("DEV_0000038_MARKERS", ORIGINAL_DEV_0000038_MARKERS);
    }
    if (ORIGINAL_HOST === undefined) {
        clearScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR");
    }
    else {
        setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", ORIGINAL_HOST);
    }
});
test('ListIngestedRepositories returns canonical lock from resolver', async () => {
    const app = createMcpApp({ lockedModelId: 'text-embedding-openai' });
    const response = await request(app)
        .post('/mcp')
        .send({
        jsonrpc: '2.0',
        id: 'lock-parity',
        method: 'tools/call',
        params: {
            name: 'ListIngestedRepositories',
            arguments: {},
        },
    });
    assert.equal(response.status, 200);
    assert.equal(typeof response.body?.result?.content?.[0]?.text, 'string');
    const parsed = JSON.parse(response.body?.result?.content?.[0]?.text ?? '{}') as {
        lock: {
            embeddingProvider: string;
            embeddingModel: string;
            embeddingDimensions: number;
            lockedModelId: string;
            modelId: string;
        } | null;
        schemaVersion: string;
        lockedModelId: string | null;
        repos: Array<{
            id: string;
            name: string;
            status: string;
            phase?: string;
            requestId?: string | null;
            runId?: string | null;
            queuePosition?: number | null;
            queueState?: string | null;
            embeddingProvider: string;
            embeddingModel: string;
            modelId: string;
            model: string;
            lock: {
                embeddingModel: string;
                modelId: string;
            };
            hostPath: string;
        }>;
    };
    assert.equal(parsed.lockedModelId, 'text-embedding-openai');
    assert.equal(parsed.lock?.embeddingModel, 'text-embedding-openai');
    assert.equal(parsed.lock?.modelId, 'text-embedding-openai');
    assert.equal(parsed.schemaVersion, INGEST_ROOTS_SCHEMA_VERSION);
    assert.equal(parsed.repos.length, 1);
    assert.equal(parsed.repos[0].id, '/data/repo');
    assert.equal(parsed.repos[0].name, 'repo');
    assert.equal(parsed.repos[0].embeddingProvider, 'lmstudio');
    assert.equal(parsed.repos[0].embeddingModel, 'embed-model');
    assert.equal(parsed.repos[0].model, 'embed-model');
    assert.equal(parsed.repos[0].modelId, 'embed-model');
    assert.equal(parsed.repos[0].lock.embeddingModel, 'embed-model');
    assert.equal(parsed.repos[0].lock.modelId, 'embed-model');
    assert.equal(parsed.repos[0].status, 'completed');
    assert.equal(parsed.repos[0].phase, undefined);
    assert.deepEqual(response.body?.result?.structuredContent, parsed);
});
test('ListIngestedRepositories preserves structured ingest-origin normalized error fields from the shared repo-list payload', async () => {
    const app = express();
    app.use(express.json());
    app.use(createMcpRouter({
        listIngestedRepositories: async () => ({
            repos: [
                {
                    id: 'repo-error',
                    name: 'repo-error',
                    description: null,
                    containerPath: '/data/repo-error',
                    hostPath: '/home/d_a_s/code/data/repo-error',
                    lastIngestAt: '2026-01-01T00:00:00.000Z',
                    embeddingProvider: 'openai',
                    embeddingModel: 'text-embedding-3-small',
                    embeddingDimensions: 1536,
                    model: 'text-embedding-3-small',
                    modelId: 'openai/text-embedding-3-small',
                    lock: {
                        embeddingProvider: 'openai',
                        embeddingModel: 'text-embedding-3-small',
                        embeddingDimensions: 1536,
                        lockedModelId: 'text-embedding-3-small',
                        modelId: 'openai/text-embedding-3-small',
                    },
                    counts: { files: 0, chunks: 0, embedded: 0 },
                    lastError: 'queue replay validation failed',
                    error: {
                        error: 'INVALID_REEMBED_STATE',
                        message: 'queue replay validation failed',
                        retryable: false,
                        provider: 'ingest',
                    },
                    status: 'error',
                },
            ],
            lock: null,
            lockedModelId: null,
            schemaVersion: INGEST_ROOTS_SCHEMA_VERSION,
        }) as never,
    }));
    const response = await request(app)
        .post('/mcp')
        .send({
        jsonrpc: '2.0',
        id: 'normalized-error-shape',
        method: 'tools/call',
        params: {
            name: 'ListIngestedRepositories',
            arguments: {},
        },
    });
    assert.equal(response.status, 200);
    const parsed = JSON.parse(response.body?.result?.content?.[0]?.text ?? '{}') as {
        repos: Array<{
            error?: {
                error?: string;
                message?: string;
                retryable?: boolean;
                provider?: string;
                upstreamStatus?: number;
                retryAfterMs?: number;
            } | null;
            lastError?: string | null;
        }>;
    };
    assert.equal(parsed.repos[0]?.lastError, 'queue replay validation failed');
    assert.equal(parsed.repos[0]?.error?.error, 'INVALID_REEMBED_STATE');
    assert.equal(parsed.repos[0]?.error?.message, 'queue replay validation failed');
    assert.equal(parsed.repos[0]?.error?.retryable, false);
    assert.equal(parsed.repos[0]?.error?.provider, 'ingest');
});
test('ListIngestedRepositories preserves structured ingest-origin errors through the shared reader path', async () => {
    const app = createMcpApp({
        lockedModelId: 'text-embedding-3-small',
        roots: {
            ids: ['run-ingest-error'],
            metadatas: [
                {
                    name: 'repo',
                    root: '/data/repo',
                    model: 'text-embedding-3-small',
                    embeddingProvider: 'openai',
                    embeddingModel: 'text-embedding-3-small',
                    files: 3,
                    chunks: 12,
                    embedded: 12,
                    lastIngestAt: '2026-01-01T00:00:00.000Z',
                    state: 'error',
                    description: 'sample',
                    lastError: 'queue replay validation failed',
                    error: {
                        error: 'INVALID_REEMBED_STATE',
                        message: 'queue replay validation failed',
                        retryable: false,
                        provider: 'ingest',
                    },
                },
            ],
        },
    });
    const response = await request(app)
        .post('/mcp')
        .send({
        jsonrpc: '2.0',
        id: 'structured-ingest-error',
        method: 'tools/call',
        params: {
            name: 'ListIngestedRepositories',
            arguments: {},
        },
    });
    assert.equal(response.status, 200);
    const parsed = JSON.parse(response.body?.result?.content?.[0]?.text ?? '{}') as {
        repos: Array<{
            error?: {
                error?: string;
                message?: string;
                retryable?: boolean;
                provider?: string;
            } | null;
            lastError?: string | null;
        }>;
    };
    assert.equal(parsed.repos[0]?.lastError, 'queue replay validation failed');
    assert.equal(parsed.repos[0]?.error?.error, 'INVALID_REEMBED_STATE');
    assert.equal(parsed.repos[0]?.error?.message, 'queue replay validation failed');
    assert.equal(parsed.repos[0]?.error?.retryable, false);
    assert.equal(parsed.repos[0]?.error?.provider, 'ingest');
});
test('ListIngestedRepositories default MCP path preserves documented id, name, and queued metadata before execution starts', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000058'),
                    canonicalTargetPath: '/data/queued-repo',
                    operation: 'start',
                    queueState: 'waiting',
                    requestPayload: {
                        path: '/data/queued-repo',
                        name: 'queued-repo',
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
    const app = createMcpApp({ lockedModelId: 'embed-model' });
    const response = await request(app)
        .post('/mcp')
        .send({
        jsonrpc: '2.0',
        id: 'queued-row',
        method: 'tools/call',
        params: { name: 'ListIngestedRepositories', arguments: {} },
    });
    const parsed = JSON.parse(response.body?.result?.content?.[0]?.text ?? '{}') as {
        repos: Array<{
            id?: string;
            name?: string;
            requestId?: string | null;
            runId?: string | null;
            queuePosition?: number | null;
            queueState?: string | null;
            embeddingProvider?: string;
            embeddingModel?: string;
        }>;
    };
    assert.equal(response.status, 200);
    assert.equal(parsed.repos[0]?.id, '/data/queued-repo');
    assert.equal(parsed.repos[0]?.name, 'queued-repo');
    assert.equal(parsed.repos[0]?.requestId, '000000000000000000000058');
    assert.equal(parsed.repos[0]?.runId, null);
    assert.equal(parsed.repos[0]?.queueState, 'waiting');
    assert.equal(parsed.repos[0]?.queuePosition, 1);
    assert.equal(parsed.repos[0]?.embeddingProvider, 'lmstudio');
    assert.equal(parsed.repos[0]?.embeddingModel, 'embed-model');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('ListIngestedRepositories default MCP path surfaces explicit queue-read degradation when waiting queue rows cannot be read', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 0,
    });
    const app = createMcpApp({ lockedModelId: 'embed-model' });
    const response = await request(app)
        .post('/mcp')
        .send({
        jsonrpc: '2.0',
        id: 'queued-read-degraded',
        method: 'tools/call',
        params: { name: 'ListIngestedRepositories', arguments: {} },
    });
    const parsed = JSON.parse(response.body?.result?.content?.[0]?.text ?? '{}') as {
        repos: Array<{
            id?: string;
            name?: string;
            status?: string;
            requestId?: string | null;
            runId?: string | null;
            queuePosition?: number | null;
            queueState?: string | null;
        }>;
        queueReadDegraded?: boolean;
        queueReadError?: {
            error?: string;
            message?: string;
            retryable?: boolean;
            provider?: string;
        } | null;
    };
    assert.equal(response.status, 200);
    assert.equal(parsed.repos.length, 1);
    assert.equal(parsed.repos[0]?.id, '/data/repo');
    assert.equal(parsed.repos[0]?.name, 'repo');
    assert.equal(parsed.repos[0]?.status, 'completed');
    assert.equal(parsed.repos[0]?.requestId, undefined);
    assert.equal(parsed.repos[0]?.runId, undefined);
    assert.equal(parsed.repos[0]?.queuePosition, undefined);
    assert.equal(parsed.repos[0]?.queueState, undefined);
    assert.equal(parsed.queueReadDegraded, true);
    assert.deepEqual(parsed.queueReadError, {
        error: 'QUEUE_READ_DEGRADED',
        message: 'Queue-backed repository visibility may be incomplete because Mongo queue reads are unavailable.',
        retryable: true,
        provider: 'ingest',
    });
    assert.deepEqual(response.body?.result?.structuredContent, parsed);
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('ListIngestedRepositories default MCP path propagates fresh running model metadata without stale payload-path row attachment', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000082'),
                    canonicalTargetPath: '/data/current-repo',
                    operation: 'reembed',
                    queueState: 'running',
                    requestPayload: {
                        path: '/data/stale-payload-repo',
                        name: 'current-repo',
                        model: 'text-embedding-3-large',
                        embeddingProvider: 'openai',
                        embeddingModel: 'text-embedding-3-large',
                        embeddingDimensions: 3072,
                    },
                    sourceSurface: 'mcp:reingest_repository',
                    runId: 'mcp-running-fresh-model-run',
                    createdAt: new Date('2026-04-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                },
            ],
        }),
    }) as never);
    __setStatusForTest('mcp-running-fresh-model-run', {
        runId: 'mcp-running-fresh-model-run',
        state: 'embedding',
        counts: { files: 5, chunks: 10, embedded: 4 },
    });
    try {
        const app = createMcpApp({
            lockedModelId: 'stale-model',
            roots: {
                ids: ['current-run', 'stale-payload-run'],
                metadatas: [
                    {
                        name: 'current-repo',
                        root: '/data/current-repo',
                        model: 'stale-model',
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 'stale-model',
                        embeddingDimensions: 768,
                        state: 'completed',
                    },
                    {
                        name: 'stale-payload-repo',
                        root: '/data/stale-payload-repo',
                        model: 'wrong-row-model',
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 'wrong-row-model',
                        embeddingDimensions: 768,
                        state: 'completed',
                    },
                ],
            },
        });
        const response = await request(app)
            .post('/mcp')
            .send({
            jsonrpc: '2.0',
            id: 'mcp-running-fresh-model',
            method: 'tools/call',
            params: { name: 'ListIngestedRepositories', arguments: {} },
        });
        const parsed = JSON.parse(response.body?.result?.content?.[0]?.text ?? '{}') as {
            repos: Array<{
                id: string;
                requestId?: string | null;
                queueState?: string | null;
                embeddingProvider: string;
                embeddingModel: string;
                lock: {
                    embeddingProvider: string;
                    embeddingModel: string;
                };
            }>;
        };
        const currentRepo = parsed.repos.find((repo) => repo.id === '/data/current-repo');
        const stalePayloadRepo = parsed.repos.find((repo) => repo.id === '/data/stale-payload-repo');
        assert.equal(response.status, 200);
        assert.ok(currentRepo);
        assert.ok(stalePayloadRepo);
        assert.equal(currentRepo.requestId, '000000000000000000000082');
        assert.equal(currentRepo.queueState, 'running');
        assert.equal(currentRepo.embeddingProvider, 'openai');
        assert.equal(currentRepo.embeddingModel, 'text-embedding-3-large');
        assert.equal(currentRepo.lock.embeddingProvider, 'openai');
        assert.equal(currentRepo.lock.embeddingModel, 'text-embedding-3-large');
        assert.equal(stalePayloadRepo.requestId, undefined);
        assert.equal(stalePayloadRepo.embeddingModel, 'wrong-row-model');
    }
    finally {
        Object.defineProperty(mongoose.connection, 'readyState', {
            configurable: true,
            value: originalReadyState,
        });
    }
});
test('ListIngestedRepositories returns one canonical queued row id for duplicate metadata before applying the waiting overlay', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000059'),
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
    const app = createMcpApp({
        lockedModelId: 'embed-model',
        roots: {
            ids: ['older-row', 'newer-row'],
            metadatas: [
                {
                    name: 'repo-old',
                    root: '/data/repo',
                    model: 'embed-model',
                    lastIngestAt: '2026-01-01T00:00:00.000Z',
                    state: 'completed',
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
                    lastIngestAt: '2026-01-02T00:00:00.000Z',
                    state: 'completed',
                },
            ],
        },
    });
    const response = await request(app)
        .post('/mcp')
        .send({
        jsonrpc: '2.0',
        id: 'duplicate-queued-row',
        method: 'tools/call',
        params: { name: 'ListIngestedRepositories', arguments: {} },
    });
    const parsed = JSON.parse(response.body?.result?.content?.[0]?.text ?? '{}') as {
        repos: Array<{
            id?: string;
            containerPath: string;
            requestId?: string | null;
            runId?: string | null;
            queuePosition?: number | null;
            queueState?: string | null;
            counts: {
                files: number;
                chunks: number;
                embedded: number;
            };
            embeddingModel: string;
        }>;
    };
    assert.equal(response.status, 200);
    assert.equal(parsed.repos.filter((repo) => repo.containerPath === '/data/repo').length, 1);
    assert.equal(parsed.repos[0]?.id, '/data/repo');
    assert.equal(parsed.repos[0]?.requestId, '000000000000000000000059');
    assert.equal(parsed.repos[0]?.runId, null);
    assert.equal(parsed.repos[0]?.queueState, 'waiting');
    assert.equal(parsed.repos[0]?.queuePosition, 1);
    assert.deepEqual(parsed.repos[0]?.counts, {
        files: 4,
        chunks: 8,
        embedded: 8,
    });
    assert.equal(parsed.repos[0]?.embeddingModel, 'embed-model');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('ListIngestedRepositories keeps the more complete duplicate metadata row before applying queue overlay', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: 1,
    });
    mock.method(IngestQueueRequestModel, 'find', () => ({
        sort: () => ({
            exec: async () => [
                {
                    _id: new mongoose.Types.ObjectId('000000000000000000000060'),
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
    const app = createMcpApp({
        lockedModelId: 'embed-model',
        roots: {
            ids: ['partial-row', 'complete-row'],
            metadatas: [
                {
                    name: 'repo-stale',
                    root: '/data/repo',
                    lastIngestAt: '2026-01-03T00:00:00.000Z',
                    state: 'completed',
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
                    lastIngestAt: '2026-01-01T00:00:00.000Z',
                    state: 'completed',
                },
            ],
        },
    });
    const response = await request(app)
        .post('/mcp')
        .send({
        jsonrpc: '2.0',
        id: 'partial-duplicate-row',
        method: 'tools/call',
        params: { name: 'ListIngestedRepositories', arguments: {} },
    });
    const parsed = JSON.parse(response.body?.result?.content?.[0]?.text ?? '{}') as {
        repos: Array<{
            containerPath: string;
            name: string;
            counts: {
                files: number;
                chunks: number;
                embedded: number;
            };
            embeddingProvider: string;
            embeddingModel: string;
            queueState?: string | null;
        }>;
    };
    assert.equal(response.status, 200);
    assert.equal(parsed.repos.filter((repo) => repo.containerPath === '/data/repo').length, 1);
    assert.equal(parsed.repos[0]?.name, 'repo');
    assert.deepEqual(parsed.repos[0]?.counts, {
        files: 9,
        chunks: 12,
        embedded: 12,
    });
    assert.equal(parsed.repos[0]?.embeddingProvider, 'lmstudio');
    assert.equal(parsed.repos[0]?.embeddingModel, 'embed-model');
    assert.equal(parsed.repos[0]?.queueState, 'waiting');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('ListIngestedRepositories omits phase for terminal statuses and maps skipped to completed', async () => {
    const app = express();
    app.use(express.json());
    app.use(createMcpRouter({
        getRootsCollection: async () => ({
            get: async () => ({
                ids: ['done', 'cancelled', 'errored', 'skipped'],
                metadatas: [
                    { name: 'done', root: '/data/done', state: 'completed' },
                    {
                        name: 'cancelled',
                        root: '/data/cancelled',
                        state: 'cancelled',
                    },
                    { name: 'errored', root: '/data/errored', state: 'error' },
                    { name: 'skipped', root: '/data/skipped', state: 'skipped' },
                ],
            }),
        }) as never,
        getLockedModel: async () => 'text-embed',
    }));
    const response = await request(app)
        .post('/mcp')
        .send({
        jsonrpc: '2.0',
        id: 'terminals',
        method: 'tools/call',
        params: { name: 'ListIngestedRepositories', arguments: {} },
    });
    const parsed = JSON.parse(response.body?.result?.content?.[0]?.text ?? '{}') as {
        repos: Array<{
            id: string;
            status: string;
            phase?: string;
        }>;
    };
    const byId = new Map(parsed.repos.map((repo) => [repo.id, repo]));
    assert.equal(byId.get('/data/done')?.status, 'completed');
    assert.equal(byId.get('/data/done')?.phase, undefined);
    assert.equal(byId.get('/data/cancelled')?.status, 'cancelled');
    assert.equal(byId.get('/data/cancelled')?.phase, undefined);
    assert.equal(byId.get('/data/errored')?.status, 'error');
    assert.equal(byId.get('/data/errored')?.phase, undefined);
    assert.equal(byId.get('/data/skipped')?.status, 'completed');
    assert.equal(byId.get('/data/skipped')?.phase, undefined);
});
test('ListIngestedRepositories shows active overlay and keeps stable repository ids', async () => {
    __setStatusForTest('active-run', {
        runId: 'active-run',
        state: 'queued',
        counts: { files: 9, chunks: 9, embedded: 0 },
    });
    __setJobInputForTest('active-run', {
        path: '/data/repo',
        root: '/data/repo',
        name: 'repo',
        model: 'text-embed',
    });
    const app = express();
    app.use(express.json());
    app.use(createMcpRouter({
        getRootsCollection: async () => ({
            get: async () => ({
                ids: ['persisted'],
                metadatas: [
                    {
                        name: 'repo',
                        root: '/data/repo',
                        state: 'completed',
                        lastIngestAt: '2026-01-02T00:00:00.000Z',
                    },
                ],
            }),
        }) as never,
        getLockedModel: async () => 'text-embed',
    }));
    const response = await request(app)
        .post('/mcp')
        .send({
        jsonrpc: '2.0',
        id: 'active-overlay',
        method: 'tools/call',
        params: { name: 'ListIngestedRepositories', arguments: {} },
    });
    const parsed = JSON.parse(response.body?.result?.content?.[0]?.text ?? '{}') as {
        repos: Array<{
            id: string;
            containerPath: string;
            runId?: string | null;
            status: string;
            phase?: string;
        }>;
    };
    const overlaid = parsed.repos.find((repo) => repo.containerPath === '/data/repo');
    assert.equal(overlaid?.id, '/data/repo');
    assert.equal(overlaid?.runId, 'active-run');
    assert.equal(overlaid?.status, 'ingesting');
    assert.equal(overlaid?.phase, 'queued');
});
test('ListIngestedRepositories keeps one authoritative row for mixed-path recovered reembed overlays', async () => {
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
                    canonicalTargetPath: '/data/codeInfo2/codeInfo2',
                    operation: 'reembed',
                    queueState: 'running',
                    requestPayload: {
                        path: '/home/d_a_s/code/codeInfo2/codeInfo2',
                        name: 'codeInfo2',
                        model: 'embed-model',
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 'embed-model',
                    },
                    sourceSurface: 'mcp:reingest_repository',
                    runId: 'mixed-path-run',
                    createdAt: new Date('2026-04-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
                },
            ],
        }),
    }) as never);
    __setStatusForTest('mixed-path-run', {
        runId: 'mixed-path-run',
        state: 'embedding',
        counts: { files: 7, chunks: 14, embedded: 5 },
    });
    __setJobInputForTest('mixed-path-run', {
        path: '/data/codeInfo2/codeInfo2',
        root: '/data/codeInfo2/codeInfo2',
        canonicalTargetPath: '/data/codeInfo2/codeInfo2',
        name: 'codeInfo2',
        model: 'embed-model',
        operation: 'reembed',
    });
    const app = createMcpApp({
        lockedModelId: 'embed-model',
        roots: {
            ids: ['partial-row', 'complete-row'],
            metadatas: [
                {
                    name: 'codeInfo2-stale',
                    root: '/home/d_a_s/code/codeInfo2/codeInfo2',
                    lastIngestAt: '2026-01-03T00:00:00.000Z',
                    state: 'completed',
                },
                {
                    name: 'codeInfo2',
                    root: '/home/d_a_s/code/codeInfo2/codeInfo2',
                    embeddingProvider: 'lmstudio',
                    embeddingModel: 'embed-model',
                    embeddingDimensions: 768,
                    model: 'embed-model',
                    files: 11,
                    chunks: 22,
                    embedded: 22,
                    lastIngestAt: '2026-01-01T00:00:00.000Z',
                    state: 'completed',
                },
            ],
        },
    });
    const response = await request(app)
        .post('/mcp')
        .send({
        jsonrpc: '2.0',
        id: 'mixed-path-active',
        method: 'tools/call',
        params: { name: 'ListIngestedRepositories', arguments: {} },
    });
    const parsed = JSON.parse(response.body?.result?.content?.[0]?.text ?? '{}') as {
        repos: Array<{
            containerPath: string;
            name: string;
            requestId?: string | null;
            runId?: string | null;
            counts: {
                files: number;
                chunks: number;
                embedded: number;
            };
            status: string;
            phase?: string;
        }>;
    };
    const matches = parsed.repos.filter((repo) => repo.containerPath === '/home/d_a_s/code/codeInfo2/codeInfo2');
    assert.equal(response.status, 200);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.name, 'codeInfo2');
    assert.equal(matches[0]?.requestId, '000000000000000000000063');
    assert.equal(matches[0]?.runId, 'mixed-path-run');
    assert.deepEqual(matches[0]?.counts, { files: 7, chunks: 14, embedded: 5 });
    assert.equal(matches[0]?.status, 'ingesting');
    assert.equal(matches[0]?.phase, 'embedding');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        value: originalReadyState,
    });
});
test('ListIngestedRepositories synthesizes active-only entries with stable repository ids', async () => {
    __setStatusForTest('active-only-run', {
        runId: 'active-only-run',
        state: 'scanning',
        counts: { files: 1, chunks: 0, embedded: 0 },
    });
    __setJobInputForTest('active-only-run', {
        path: '/data/only-active',
        root: '/data/only-active',
        name: 'only-active',
        model: 'text-embed',
    });
    const app = express();
    app.use(express.json());
    app.use(createMcpRouter({
        getRootsCollection: async () => ({
            get: async () => ({
                ids: [],
                metadatas: [],
            }),
        }) as never,
        getLockedModel: async () => 'text-embed',
    }));
    const response = await request(app)
        .post('/mcp')
        .send({
        jsonrpc: '2.0',
        id: 'active-synth',
        method: 'tools/call',
        params: { name: 'ListIngestedRepositories', arguments: {} },
    });
    const parsed = JSON.parse(response.body?.result?.content?.[0]?.text ?? '{}') as {
        repos: Array<{
            id: string;
            containerPath: string;
            runId?: string | null;
            status: string;
            phase?: string;
        }>;
    };
    const synthesized = parsed.repos.find((repo) => repo.containerPath === '/data/only-active');
    assert.equal(synthesized?.id, '/data/only-active');
    assert.equal(synthesized?.runId, 'active-only-run');
    assert.equal(synthesized?.status, 'ingesting');
    assert.equal(synthesized?.phase, 'scanning');
});
test('ListIngestedRepositories marker logs are gated behind DEV_0000038_MARKERS', async () => {
    const originalInfo = baseLogger.info;
    const loggedMessages: string[] = [];
    baseLogger.info = ((...args: unknown[]) => {
        const message = args.find((arg) => typeof arg === 'string') as string | undefined;
        if (message)
            loggedMessages.push(message);
    }) as typeof baseLogger.info;
    const app = createMcpApp({ lockedModelId: 'text-embedding-openai' });
    const payload = {
        jsonrpc: '2.0',
        id: 'marker-gate',
        method: 'tools/call',
        params: {
            name: 'ListIngestedRepositories',
            arguments: {},
        },
    };
    try {
        clearScopedTestEnvValue("DEV_0000038_MARKERS");
        const defaultResponse = await request(app).post('/mcp').send(payload);
        assert.equal(defaultResponse.status, 200);
        assert.equal(loggedMessages.some((entry) => entry.includes('[DEV-0000038][T5]')), false);
        loggedMessages.length = 0;
        setScopedTestEnvValue("DEV_0000038_MARKERS", 'true');
        const debugResponse = await request(app).post('/mcp').send(payload);
        assert.equal(debugResponse.status, 200);
        assert.equal(loggedMessages.some((entry) => entry.includes('[DEV-0000038][T5] INGEST_LIST_STATUS_MAPPED')), true);
    }
    finally {
        baseLogger.info = originalInfo;
    }
});
