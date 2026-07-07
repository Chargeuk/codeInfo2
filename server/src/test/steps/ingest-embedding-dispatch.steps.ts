import '../support/chromaContainer.js';
import '../support/mockLmStudioSdk.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';
import { After, Before, Given, Then, When, setDefaultTimeout, } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import { clearLockedModel, clearRootsCollection, clearVectorsCollection, } from '../../ingest/chromaClient.js';
import { __resetIngestJobsForTest, setIngestDeps, } from '../../ingest/ingestJob.js';
import { query, resetStore } from '../../logStore.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { MockLMStudioClient, type MockScenario, releaseAllControlledEmbeddingCalls, releaseControlledEmbeddingCall, startMock, stopMock, waitForControlledEmbeddingCalls, } from '../support/mockLmStudioSdk.js';
import { createTempRepoRoot } from '../support/tempRepoRoot.js';
let server: Server | null = null;
let baseUrl = '';
let tempDir: string | null = null;
let lastRunId: string | null = null;
Before({ tags: '@embedding-dispatch' }, async () => {
    setDefaultTimeout(30000);
    setScopedTestEnvValue("NODE_ENV", 'test');
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'ws://localhost:1234');
    setScopedTestEnvValue("CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT", '2');
    setScopedTestEnvValue("CODEINFO_INGEST_MAX_QUEUE_SIZE", '1');
    __resetIngestJobsForTest();
    resetStore();
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(createRequestLogger());
    setIngestDeps({
        lmClientFactory: () => new MockLMStudioClient() as unknown as LMStudioClient,
        baseUrl: process.env.CODEINFO_LMSTUDIO_BASE_URL ?? '',
    });
    app.use('/', createIngestStartRouter({
        clientFactory: () => new MockLMStudioClient() as unknown as LMStudioClient,
    }));
    await new Promise<void>((resolve) => {
        const listener = app.listen(0, () => {
            server = listener;
            const address = listener.address();
            if (!address || typeof address === 'string') {
                throw new Error('Unable to start embedding dispatch test server');
            }
            baseUrl = `http://localhost:${address.port}`;
            resolve();
        });
    });
});
After({ tags: '@embedding-dispatch' }, async () => {
    stopMock();
    if (server) {
        await new Promise<void>((resolve, reject) => {
            server!.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
        server = null;
    }
    if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
        tempDir = null;
    }
    lastRunId = null;
    __resetIngestJobsForTest();
    resetStore();
    await clearRootsCollection();
    await clearVectorsCollection();
    await clearLockedModel();
    clearScopedTestEnvValue("CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT");
    clearScopedTestEnvValue("CODEINFO_INGEST_MAX_QUEUE_SIZE");
});
Given('ingest embedding dispatch chroma stub is empty', async () => {
    await clearRootsCollection();
    await clearVectorsCollection();
    await clearLockedModel();
});
Given('ingest embedding dispatch models scenario {string}', (name: string) => {
    setScopedTestEnvValue("CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT", '2');
    setScopedTestEnvValue("CODEINFO_INGEST_MAX_QUEUE_SIZE", '1');
    startMock({ scenario: name as MockScenario });
});
Given('ingest embedding dispatch temp repo has files:', async (table) => {
    tempDir = await createTempRepoRoot('ingest-dispatch-');
    const rows = table.hashes() as Array<{
        relPath: string;
        content: string;
    }>;
    for (const row of rows) {
        const fullPath = path.join(tempDir, row.relPath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, row.content);
    }
});
When('I POST ingest embedding dispatch start with model {string}', async (model: string) => {
    assert(tempDir, 'temp dir missing');
    const res = await fetch(`${baseUrl}/ingest/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: tempDir, name: 'dispatch', model }),
    });
    const body = await res.json();
    assert.equal(res.status, 202, `Unexpected status ${res.status}`);
    lastRunId = body.runId as string;
});
Then('ingest embedding dispatch waits for {int} controlled embedding calls', async (count: number) => {
    await waitForControlledEmbeddingCalls(count);
});
When('ingest embedding dispatch releases controlled embedding call {int}', (index: number) => {
    releaseControlledEmbeddingCall(index);
});
When('ingest embedding dispatch releases all controlled embedding calls', () => {
    releaseAllControlledEmbeddingCalls();
});
Then('ingest embedding dispatch status for the last run becomes {string}', { timeout: 75000 }, async (state: string) => {
    assert(lastRunId, 'runId missing');
    let lastSeenState: string | undefined;
    for (let i = 0; i < 600; i += 1) {
        const res: Response = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
        const body = (await res.json()) as {
            state?: string;
            message?: string;
            lastError?: string;
        };
        const currentState = body.state as string | undefined;
        if (currentState !== lastSeenState) {
            lastSeenState = currentState;
            console.log(`[ingest-embedding-dispatch] poll ${i} runId=${lastRunId} state=${currentState ?? 'missing'} message=${body.message ?? ''}`);
        }
        if (body.state === state)
            return;
        if (body.state === 'error') {
            assert.fail(`run reached error state before ${state}: ${body.lastError ?? body.message ?? 'unknown error'}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`did not reach state ${state}`);
});
Then('ingest embedding dispatch logs include {string}', (marker: string) => {
    const matches = query({ text: marker }, 50);
    assert.ok(matches.length > 0, `expected log marker ${marker}`);
});
