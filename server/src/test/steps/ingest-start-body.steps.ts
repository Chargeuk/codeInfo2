import '../support/chromaContainer.js';
import '../support/mockLmStudioSdk.js';
import assert from 'assert';
import fs from 'fs/promises';
import type { Server } from 'http';
import path from 'path';
import { After, Before, Given, Then, When, setDefaultTimeout, } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import { clearLockedModel, clearRootsCollection, clearVectorsCollection, } from '../../ingest/chromaClient.js';
import { setIngestDeps } from '../../ingest/ingestJob.js';
import type { CurrentQueueRequestPositionResult, EnqueueIngestRequestInput, } from '../../ingest/requestQueue.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { MockLMStudioClient, startMock, stopMock, } from '../support/mockLmStudioSdk.js';
import { createTempRepoRoot } from '../support/tempRepoRoot.js';
setDefaultTimeout(30000);
let server: Server | null = null;
let baseUrl = '';
let response: {
    status: number;
    body: unknown;
} | null = null;
let tempDir: string | null = null;
let lastStartInput: {
    embeddingProvider?: 'lmstudio' | 'openai';
    embeddingModel?: string;
    model: string;
} | null = null;
let queueAdmissionCount = 0;
Before(async () => {
    response = null;
    lastStartInput = null;
    queueAdmissionCount = 0;
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'ws://localhost:1234');
    startMock({ scenario: 'many' });
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(createRequestLogger());
    app.use((req, res, next) => {
        const requestId = (req as unknown as {
            id?: string;
        }).id;
        if (requestId)
            res.locals.requestId = requestId;
        next();
    });
    setIngestDeps({
        lmClientFactory: () => new MockLMStudioClient() as unknown as LMStudioClient,
        baseUrl: process.env.CODEINFO_LMSTUDIO_BASE_URL ?? '',
    });
    app.use('/', createIngestStartRouter({
        clientFactory: () => new MockLMStudioClient() as unknown as LMStudioClient,
        enqueueOrReuseIngestRequest: async (input: EnqueueIngestRequestInput) => {
            queueAdmissionCount += 1;
            lastStartInput = {
                embeddingProvider: input.requestPayload.embeddingProvider as 'lmstudio' | 'openai' | undefined,
                embeddingModel: input.requestPayload.embeddingModel as string | undefined,
                model: String(input.requestPayload.model),
            };
            return {
                requestId: 'queue-request-123',
                canonicalTargetPath: input.canonicalTargetPath,
                queueState: 'waiting',
                queuePosition: 1,
                runId: null,
                reusedExisting: false,
                updatedExisting: false,
                queueRequest: {} as never,
            };
        },
        pumpIngestQueue: async () => ({
            started: true,
            blockedByCleanup: false,
            requestId: 'queue-request-123',
            runId: '00000000-0000-0000-0000-000000000001',
        }),
        getCurrentQueueRequestPosition: async (requestId: string): Promise<CurrentQueueRequestPositionResult> => ({
            requestId,
            queueState: 'running',
            queuePosition: null,
            runId: '00000000-0000-0000-0000-000000000001',
        }),
    }));
    await new Promise<void>((resolve) => {
        const listener = app.listen(0, () => {
            server = listener;
            const address = listener.address();
            if (!address || typeof address === 'string') {
                throw new Error('Unable to start test server');
            }
            baseUrl = `http://localhost:${address.port}`;
            resolve();
        });
    });
});
After(async () => {
    stopMock();
    if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        server = null;
    }
    if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
        tempDir = null;
    }
    await clearLockedModel();
    await clearRootsCollection();
    await clearVectorsCollection();
    response = null;
    lastStartInput = null;
    queueAdmissionCount = 0;
});
Given('the ingest start test server is running with mock chroma and lmstudio', () => {
    assert.ok(server, 'server should be running');
});
Given('ingest chroma stores are empty', async () => {
    await clearLockedModel();
    await clearRootsCollection();
    await clearVectorsCollection();
});
When('I POST the ingest start endpoint with JSON body', async () => {
    tempDir = await createTempRepoRoot('ingest-body-');
    const filePath = path.join(tempDir, 'readme.md');
    await fs.writeFile(filePath, '# sample');
    const res = await fetch(`${baseUrl}/ingest/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            path: tempDir,
            name: 'tmp',
            model: 'embed-1',
            dryRun: true,
        }),
    });
    response = { status: res.status, body: await res.json() };
});
When('I POST ingest start with canonical and legacy model fields', async () => {
    tempDir = await createTempRepoRoot('ingest-body-');
    const filePath = path.join(tempDir, 'readme.md');
    await fs.writeFile(filePath, '# sample');
    const res = await fetch(`${baseUrl}/ingest/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            path: tempDir,
            name: 'tmp',
            model: 'legacy-embed-1',
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
        }),
    });
    response = { status: res.status, body: await res.json() };
});
When('I POST ingest start with malformed {string} body field', async (field: string) => {
    tempDir = await createTempRepoRoot('ingest-body-');
    const filePath = path.join(tempDir, 'readme.md');
    await fs.writeFile(filePath, '# sample');
    const body: Record<string, unknown> = {
        path: tempDir,
        name: 'tmp',
        model: 'embed-1',
    };
    if (field === 'name') {
        body.name = 123;
    }
    else if (field === 'description') {
        body.description = false;
    }
    else if (field === 'dryRun') {
        body.dryRun = 'false';
    }
    else if (field === 'unexpected') {
        body.unexpected = 'value';
    }
    else {
        throw new Error(`Unsupported malformed ingest-start field: ${field}`);
    }
    const res = await fetch(`${baseUrl}/ingest/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    response = { status: res.status, body: await res.json() };
});
Then('the response status should be 202', () => {
    assert.ok(response, 'response should be present');
    assert.equal(response?.status, 202);
});
Then('the response status should be 400', () => {
    assert.ok(response, 'response should be present');
    assert.equal(response?.status, 400);
});
Then('the response body should contain a runId', () => {
    const body = response?.body as {
        runId?: string;
    } | undefined;
    assert.ok(body?.runId, 'runId should be defined');
    assert.equal(typeof body?.runId, 'string');
});
Then('the response body should contain an immediate queue acceptance', () => {
    const body = response?.body as {
        queued?: boolean;
        requestId?: string;
        runId?: string;
    } | undefined;
    assert.equal(body?.queued, false);
    assert.equal(body?.requestId, 'queue-request-123');
    assert.equal(body?.runId, '00000000-0000-0000-0000-000000000001');
});
Then('the validation response message should be {string}', (message: string) => {
    const body = response?.body as {
        status?: string;
        code?: string;
        message?: string;
    } | undefined;
    assert.equal(body?.status, 'error');
    assert.equal(body?.code, 'VALIDATION');
    assert.equal(body?.message, message);
});
Then('no ingest start queue request should be admitted', () => {
    assert.equal(queueAdmissionCount, 0);
    assert.equal(lastStartInput, null);
});
Then('the ingest start request uses provider {string} and model {string}', (provider: string, model: string) => {
    assert.ok(lastStartInput, 'expected captured start input');
    assert.equal(lastStartInput?.embeddingProvider, provider);
    assert.equal(lastStartInput?.embeddingModel, model);
    assert.equal(lastStartInput?.model, `${provider}/${model}`);
});
