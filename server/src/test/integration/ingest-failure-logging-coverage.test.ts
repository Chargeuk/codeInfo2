import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { resetStore } from '../../logStore.js';
import { createIngestCancelRouter } from '../../routes/ingestCancel.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { createLogsRouter } from '../../routes/logs.js';
function createApp() {
    const app = express();
    app.use(express.json());
    app.use(createIngestStartRouter({
        clientFactory: () => ({}) as never,
        getLockedEmbeddingModel: async () => null,
        enqueueOrReuseIngestRequest: async () => {
            const error = new Error('queue unavailable');
            (error as {
                code?: string;
            }).code = 'QUEUE_UNAVAILABLE';
            throw error;
        },
    }));
    app.use(createIngestReembedRouter({
        clientFactory: () => ({}) as never,
        listIngestedRepositories: async () => ({
            repos: [
                {
                    id: 'repo-1',
                    description: null,
                    containerPath: '/tmp/repo',
                    hostPath: '/host/tmp/repo',
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
    }));
    app.use(createIngestCancelRouter({
        getStatus: () => ({ runId: 'run-1' }) as never,
        isBusy: () => false,
        cancelRun: async () => {
            const error = new Error('not found');
            (error as {
                code?: string;
            }).code = 'NOT_FOUND';
            throw error;
        },
    }));
    app.use(createIngestRootsRouter({
        getLockedModel: async () => null,
        getRootsCollection: async () => {
            throw new Error('db read failed');
        },
    }));
    app.use('/logs', createLogsRouter());
    return app;
}
test('ingest route failure coverage emits structured warn/error entries via /logs and /logs/stream', async () => {
    const originalCodexWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
    clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
    resetStore();
    const app = createApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    assert(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
        await request(app)
            .post('/ingest/start')
            .send({ path: '/tmp/repo', name: 'repo', model: 'nomic-embed' })
            .expect(503);
        await request(app).post('/ingest/reembed/%2Ftmp%2Frepo').expect(409);
        await request(app).post('/ingest/cancel/run-1').expect(404);
        await request(app).get('/ingest/roots').expect(502);
        const logsRes = await request(app)
            .get('/logs')
            .query({ text: 'DEV-0000036:T17:ingest_provider_failure' })
            .expect(200);
        const items = logsRes.body.items as Array<{
            level: string;
            context?: Record<string, unknown>;
        }>;
        assert.ok(items.some((entry) => entry.level === 'warn' &&
            entry.context?.surface === 'ingest/start' &&
            entry.context?.retryable === true &&
            entry.context?.code === 'QUEUE_UNAVAILABLE'));
        assert.ok(items.some((entry) => entry.level === 'error' &&
            entry.context?.surface === 'ingest/reembed' &&
            entry.context?.code === 'OPENAI_MODEL_UNAVAILABLE'));
        const reembedEntry = items.find((entry) => entry.context?.surface === 'ingest/reembed' &&
            entry.context?.code === 'OPENAI_MODEL_UNAVAILABLE');
        assert.equal(reembedEntry?.context?.root, '/tmp/repo');
        assert.equal(reembedEntry?.context?.runId, undefined);
        assert.ok(items.some((entry) => entry.level === 'error' &&
            entry.context?.surface === 'ingest/cancel' &&
            entry.context?.code === 'NOT_FOUND'));
        assert.ok(items.some((entry) => entry.level === 'error' &&
            entry.context?.surface === 'ingest/roots' &&
            entry.context?.code === 'INGEST_ROOTS_LOOKUP_FAILED'));
        const streamBody = await new Promise<string>((resolve, reject) => {
            const req = http.get(`${baseUrl}/logs/stream?text=${encodeURIComponent('DEV-0000036:T17:ingest_provider_failure')}`);
            req.on('response', (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    body += chunk;
                    if (body.includes('"surface":"ingest/start"') &&
                        body.includes('"surface":"ingest/reembed"')) {
                        req.destroy();
                        resolve(body);
                    }
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            setTimeout(() => {
                req.destroy();
                resolve('');
            }, 1000);
        });
        assert.ok(streamBody.includes('DEV-0000036:T17:ingest_provider_failure'));
        assert.ok(streamBody.includes('"surface":"ingest/start"'));
    }
    finally {
        if (originalCodexWorkdir === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", originalCodexWorkdir);
        }
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
