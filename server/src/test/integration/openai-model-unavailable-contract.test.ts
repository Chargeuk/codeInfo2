import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import express from 'express';
import request from 'supertest';
import { OpenAiEmbeddingError } from '../../ingest/providers/index.js';
import type { EnqueueIngestRequestResult } from '../../ingest/requestQueue.js';
import { createMcpRouter } from '../../mcp/server.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { createToolsVectorSearchRouter } from '../../routes/toolsVectorSearch.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';
const ORIGINAL_CODEINFO_CODEX_WORKDIR = process.env.CODEINFO_CODEX_WORKDIR;
beforeEach(() => {
    mock.restoreAll();
    clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
});
afterEach(() => {
    mock.restoreAll();
    if (ORIGINAL_CODEINFO_CODEX_WORKDIR === undefined) {
        clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
    }
    else {
        setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", ORIGINAL_CODEINFO_CODEX_WORKDIR);
    }
});
test('POST /ingest/start rejects non-allowlisted OpenAI model with OPENAI_MODEL_UNAVAILABLE', async () => {
    await runWithTestEnvOverrides({
        CODEINFO_CODEX_WORKDIR: undefined,
    }, async () => {
        const app = express();
        app.use(express.json());
        app.use(createIngestStartRouter({
            clientFactory: () => ({}) as never,
            getLockedEmbeddingModel: async () => null,
        }));
        const response = await request(app).post('/ingest/start').send({
            path: '/tmp/repo',
            name: 'repo',
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-ada-002',
        });
        assert.equal(response.status, 409);
        assert.equal(response.body.code, 'OPENAI_MODEL_UNAVAILABLE');
    });
});
test('POST /ingest/reembed rejects a lock-derived non-allowlisted OpenAI model at admission time without queueing work', async () => {
    let enqueueCalled = false;
    const app = express();
    app.use(express.json());
    app.use(createIngestReembedRouter({
        clientFactory: () => ({}) as never,
        listIngestedRepositories: async () => ({
            repos: [
                {
                    id: 'repo-openai',
                    description: null,
                    containerPath: '/data/repo-openai',
                    hostPath: '/host/data/repo-openai',
                    lastIngestAt: '2026-01-01T00:00:00.000Z',
                    embeddingProvider: 'openai',
                    embeddingModel: 'text-embedding-ada-002',
                    embeddingDimensions: 1536,
                    model: 'text-embedding-ada-002',
                    modelId: 'text-embedding-ada-002',
                    lock: {
                        embeddingProvider: 'openai',
                        embeddingModel: 'text-embedding-ada-002',
                        embeddingDimensions: 1536,
                        lockedModelId: 'text-embedding-ada-002',
                        modelId: 'text-embedding-ada-002',
                    },
                    counts: { files: 1, chunks: 1, embedded: 1 },
                    lastError: null,
                },
            ],
            lockedModelId: 'text-embedding-ada-002',
        }),
        enqueueOrReuseIngestRequest: async () => {
            enqueueCalled = true;
            return {
                requestId: 'queue-request-123',
                canonicalTargetPath: '/data/repo-openai',
                queueState: 'waiting',
                queuePosition: 1,
                runId: null,
                reusedExisting: false,
                updatedExisting: false,
                queueRequest: {} as EnqueueIngestRequestResult['queueRequest'],
            };
        },
    }));
    const response = await request(app).post('/ingest/reembed/%2Fdata%2Frepo-openai');
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'OPENAI_MODEL_UNAVAILABLE');
    assert.equal(enqueueCalled, false);
});
test('REST and classic MCP vector-search keep deterministic OPENAI_MODEL_UNAVAILABLE mapping with no silent fallback', async () => {
    const restApp = express();
    restApp.use(express.json());
    restApp.use(createToolsVectorSearchRouter({
        getRootsCollection: async () => ({
            get: async () => ({
                ids: ['repo-1'],
                metadatas: [
                    {
                        root: '/data/repo',
                        name: 'repo',
                        model: 'text-embedding-3-small',
                    },
                ],
            }),
        }) as never,
        getLockedEmbeddingModel: async () => ({
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
            embeddingDimensions: 1536,
            lockedModelId: 'text-embedding-3-small',
            source: 'canonical',
        }),
        getLockedModel: async () => 'text-embedding-3-small',
        getVectorsCollection: async () => ({
            query: async () => ({ ids: [[]], metadatas: [[]], documents: [[]] }),
        }) as never,
        generateLockedQueryEmbedding: async () => {
            throw new OpenAiEmbeddingError('OPENAI_MODEL_UNAVAILABLE', 'model unavailable', false, 404);
        },
    }));
    const rest = await request(restApp)
        .post('/tools/vector-search')
        .send({ query: 'hello' });
    assert.equal(rest.status, 404);
    assert.equal(rest.body.error, 'OPENAI_MODEL_UNAVAILABLE');
    const mcpApp = express();
    mcpApp.use(express.json());
    mcpApp.use('/', createMcpRouter({
        vectorSearch: async () => {
            throw new OpenAiEmbeddingError('OPENAI_MODEL_UNAVAILABLE', 'model unavailable', false, 404);
        },
    }));
    const mcp = await request(mcpApp)
        .post('/mcp')
        .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
            name: 'VectorSearch',
            arguments: { query: 'hello' },
        },
    });
    assert.equal(mcp.status, 200);
    assert.equal(mcp.body.error.code, 404);
    assert.equal(mcp.body.error.message, 'OPENAI_MODEL_UNAVAILABLE');
    assert.equal(mcp.body.error.data.error, 'OPENAI_MODEL_UNAVAILABLE');
});
