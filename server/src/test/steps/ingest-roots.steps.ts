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
import { clearLockedModel, clearRootsCollection, } from '../../ingest/chromaClient.js';
import { setIngestDeps } from '../../ingest/ingestJob.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { MockLMStudioClient, type MockScenario, startMock, stopMock, } from '../support/mockLmStudioSdk.js';
import { createTempRepoRoot } from '../support/tempRepoRoot.js';
let server: Server | null = null;
let baseUrl = '';
let response: {
    status: number;
    body: unknown;
} | null = null;
let tempDir: string | null = null;
let lastRunId: string | null = null;
type IngestStatusBody = {
    state?: string;
    message?: string;
    lastError?: string;
    [key: string]: unknown;
};
async function waitForIngestRootsStatus(expectedState: string) {
    assert(lastRunId, 'runId missing');
    let lastObserved: IngestStatusBody | null = null;
    for (let i = 0; i < 60; i += 1) {
        const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
        const body = (await res.json()) as IngestStatusBody;
        lastObserved = body;
        console.log(`[ingest-roots] poll ${i} runId=${lastRunId} state=${body.state} message=${body.message ?? ''}`);
        if (body.state === expectedState)
            return;
        if (body.state === 'error' && expectedState !== 'error') {
            assert.fail(`Expected ingest roots run ${lastRunId} to reach state "${expectedState}" but actual state was "error". Payload: ${JSON.stringify(body)}`);
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`Did not reach state "${expectedState}". Last observed payload: ${JSON.stringify(lastObserved)}`);
}
Before(async () => {
    setDefaultTimeout(30000);
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'ws://localhost:1234');
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
    }));
    app.use('/', createIngestRootsRouter());
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
    response = null;
    lastRunId = null;
    await clearRootsCollection();
    await clearLockedModel();
});
Given('ingest roots chroma stub is empty', async () => {
    await clearRootsCollection();
    await clearLockedModel();
});
Given('ingest roots models scenario {string}', (name: string) => {
    startMock({ scenario: name as MockScenario });
});
Given('ingest roots temp repo with file {string} containing {string}', async (rel: string, content: string) => {
    tempDir = await createTempRepoRoot('ingest-roots-');
    const filePath = path.join(tempDir, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
});
When('I POST ingest roots start with model {string}', async (model: string) => {
    if (!tempDir) {
        tempDir = await createTempRepoRoot('ingest-roots-');
    }
    const res = await fetch(`${baseUrl}/ingest/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: tempDir, name: 'tmp', model }),
    });
    response = { status: res.status, body: await res.json() };
    if (response.status === 202) {
        lastRunId = (response.body as {
            runId?: string;
        }).runId ?? null;
    }
});
When('I GET ingest roots', async () => {
    const res = await fetch(`${baseUrl}/ingest/roots`);
    response = { status: res.status, body: await res.json() };
});
Then('ingest roots status for the last run becomes {string}', async (state: string) => {
    await waitForIngestRootsStatus(state);
});
Then('ingest roots status assertion for the last run expecting {string} fails with mismatch mentioning {string}', async (expectedState: string, actualState: string) => {
    await assert.rejects(async () => waitForIngestRootsStatus(expectedState), (error: unknown) => {
        assert(error instanceof Error, 'expected an Error mismatch');
        assert(error.message.includes(`state "${expectedState}"`), `expected mismatch to mention requested state ${expectedState}, got: ${error.message}`);
        assert(error.message.includes(`actual state was "${actualState}"`), `expected mismatch to mention actual state ${actualState}, got: ${error.message}`);
        return true;
    });
});
Then('ingest roots response status is {int}', (status: number) => {
    assert(response, 'expected response');
    assert.equal(response.status, status);
});
Then('ingest roots response has {int} root', (count: number) => {
    assert(response, 'expected response');
    const roots = (response.body as {
        roots?: unknown[];
    }).roots ?? [];
    assert.equal(roots.length, count);
});
Then('ingest roots response has {int} roots', (count: number) => {
    assert(response, 'expected response');
    const roots = (response.body as {
        roots?: unknown[];
    }).roots ?? [];
    assert.equal(roots.length, count);
});
Then('ingest roots first item path is the temp repo', () => {
    assert(response, 'expected response');
    const roots = (response.body as {
        roots?: unknown[];
    }).roots ?? [];
    assert(roots.length > 0, 'no roots returned');
    assert(tempDir, 'temp dir missing');
    assert.equal((roots[0] as {
        path?: string;
    }).path, tempDir);
});
Then('ingest roots first item status is {string}', (status: string) => {
    assert(response, 'expected response');
    const roots = (response.body as {
        roots?: unknown[];
    }).roots ?? [];
    assert(roots.length > 0, 'no roots returned');
    assert.equal((roots[0] as {
        status?: string;
    }).status, status);
});
