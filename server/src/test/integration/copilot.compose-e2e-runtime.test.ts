import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';
import { memoryConversations, memoryTurns, } from '../../chat/memoryPersistence.js';
import { createFakeCopilotRuntimeSeamFromEnv } from '../../copilot/fake/runtimeSeam.js';
import { query as queryLogs, resetStore } from '../../logStore.js';
import { createChatRouter } from '../../routes/chat.js';
import { createChatModelsRouter } from '../../routes/chatModels.js';
import { createChatProvidersRouter } from '../../routes/chatProviders.js';
import { createCopilotDeviceAuthRouter } from '../../routes/copilotDeviceAuth.js';
import { attachWs } from '../../ws/server.js';
import { closeWs, connectWs, sendJson, waitForEvent, } from '../support/wsClient.js';
type EnvSnapshot = Map<string, string | undefined>;
const env = {
    snapshot: new Map() as EnvSnapshot,
    set(key: string, value: string | undefined) {
        if (!this.snapshot.has(key)) {
            this.snapshot.set(key, process.env[key]);
        }
        if (value === undefined) {
            clearScopedTestEnvValue(key);
        }
        else {
            setScopedTestEnvValue(key, value);
        }
    },
    restore() {
        for (const [key, value] of this.snapshot.entries()) {
            if (value === undefined) {
                clearScopedTestEnvValue(key);
            }
            else {
                setScopedTestEnvValue(key, value);
            }
        }
        this.snapshot.clear();
    },
};
const createDummyClientFactory = () => () => ({
    system: {
        listDownloadedModels: async () => [],
    },
}) as unknown as LMStudioClient;
async function startServerForScenario(scenarioName: string) {
    let httpServer: http.Server | null = null;
    let wsHandle: ReturnType<typeof attachWs> | null = null;
    const cleanup = async () => {
        let firstError: unknown;
        try {
            await wsHandle?.close();
        }
        catch (error) {
            firstError = error;
        }
        try {
            if (httpServer?.listening) {
                await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
            }
        }
        catch (error) {
            if (firstError === undefined) {
                firstError = error;
            }
        }
        finally {
            memoryConversations.clear();
            memoryTurns.clear();
            env.restore();
        }
        if (firstError !== undefined) {
            throw firstError;
        }
    };
    try {
        env.set('CODEINFO_FAKE_COPILOT_SCENARIO', scenarioName);
        env.set('CODEX_HOME', undefined);
        env.set('CODEINFO_CODEX_HOME', undefined);
        env.set('CODEINFO_COPILOT_HOME', undefined);
        env.set('CODEINFO_LMSTUDIO_HOME', undefined);
        env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', undefined);
        env.set('CODEINFO_CHAT_DEFAULT_MODEL', undefined);
        env.set('CODEINFO_LMSTUDIO_BASE_URL', 'http://127.0.0.1:9');
        env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', undefined);
        env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS', undefined);
        resetStore();
        memoryConversations.clear();
        memoryTurns.clear();
        const seam = createFakeCopilotRuntimeSeamFromEnv(process.env);
        assert.ok(seam, 'expected fake Copilot runtime seam');
        const app = express();
        app.use(express.json());
        const clientFactory = createDummyClientFactory();
        app.use('/chat', createChatRouter({
            clientFactory,
            copilotLifecycleFactory: seam.createCopilotLifecycle,
        }));
        app.use('/chat', createChatProvidersRouter({
            clientFactory,
            copilotRuntimeFactory: seam.createCopilotReadinessRuntime,
        }));
        app.use('/chat', createChatModelsRouter({
            clientFactory,
            copilotRuntimeFactory: seam.createCopilotReadinessRuntime,
        }));
        app.use('/copilot', createCopilotDeviceAuthRouter(seam.createDeviceAuthRouterDeps()));
        httpServer = http.createServer(app);
        wsHandle = attachWs({ httpServer });
        await new Promise<void>((resolve) => httpServer?.listen(0, resolve));
        const address = httpServer.address();
        assert(address && typeof address === 'object');
        return {
            baseUrl: `http://127.0.0.1:${address.port}`,
            httpServer,
            wsHandle,
            stop: cleanup,
        };
    }
    catch (error) {
        try {
            await cleanup();
        }
        catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'startServerForScenario setup and cleanup both failed');
        }
        throw error;
    }
}
test('compose-style env seam activates the fake Copilot happy path through normal routers', async () => {
    const server = await startServerForScenario('copilot-happy-path');
    try {
        const providers = await request(server.httpServer).get('/chat/providers');
        assert.equal(providers.status, 200);
        const copilotProvider = providers.body.providers.find((provider: {
            id?: string;
        }) => provider.id === 'copilot');
        assert.ok(copilotProvider);
        assert.equal(copilotProvider.available, true);
        const models = await request(server.httpServer).get('/chat/models?provider=copilot');
        assert.equal(models.status, 200);
        assert.equal(models.body.provider, 'copilot');
        assert.equal(models.body.available, true);
        assert.equal(models.body.models[0]?.key, 'copilot-gpt-5');
        const auth = await request(server.httpServer)
            .post('/copilot/device-auth')
            .send({});
        assert.equal(auth.status, 200);
        assert.equal(auth.body.state, 'already_authenticated');
        const ws = await connectWs({ baseUrl: server.baseUrl });
        try {
            const conversationId = 'compose-e2e-runtime-happy-path';
            sendJson(ws, {
                type: 'subscribe_conversation',
                conversationId,
            });
            const start = await request(server.httpServer).post('/chat').send({
                provider: 'copilot',
                model: 'copilot-gpt-5',
                conversationId,
                message: 'Hello from compose runtime seam',
            });
            assert.equal(start.status, 202);
            assert.equal(start.body.provider, 'copilot');
            const final = await waitForEvent({
                ws,
                predicate: (event: unknown): event is {
                    type?: string;
                    status?: string;
                    conversationId?: string;
                } => {
                    const candidate = event as {
                        type?: string;
                        status?: string;
                        conversationId?: string;
                    };
                    return (candidate.type === 'turn_final' &&
                        candidate.status === 'ok' &&
                        candidate.conversationId === conversationId);
                },
                timeoutMs: 4000,
            });
            assert.equal(final.status, 'ok');
        }
        finally {
            await closeWs(ws);
        }
        const bootLogs = queryLogs({
            text: 'story.0000051.task16.fake_scenario_booted',
        });
        assert.ok(bootLogs.length > 0);
        assert.equal(bootLogs.at(-1)?.context?.scenario, 'copilot-happy-path');
        assert.equal(bootLogs.at(-1)?.context?.surface, 'compose-e2e');
    }
    finally {
        await server.stop();
    }
});
test('compose-style env seam activates auth-required device-flow state through normal routers', async () => {
    const server = await startServerForScenario('copilot-auth-required');
    try {
        const providers = await request(server.httpServer).get('/chat/providers');
        assert.equal(providers.status, 200);
        const copilotProvider = providers.body.providers.find((provider: {
            id?: string;
        }) => provider.id === 'copilot');
        assert.ok(copilotProvider);
        assert.equal(copilotProvider.available, false);
        assert.equal(copilotProvider.reason, 'copilot authentication required');
        const auth = await request(server.httpServer)
            .post('/copilot/device-auth')
            .send({});
        assert.equal(auth.status, 200);
        assert.equal(auth.body.state, 'verification_ready');
        assert.equal(auth.body.userCode, 'TASK16-ABCD');
        const bootLogs = queryLogs({
            text: 'story.0000051.task16.fake_scenario_booted',
        });
        assert.ok(bootLogs.length > 0);
        assert.equal(bootLogs.at(-1)?.context?.scenario, 'copilot-auth-required');
        assert.equal(bootLogs.at(-1)?.context?.surface, 'compose-e2e');
    }
    finally {
        await server.stop();
    }
});
