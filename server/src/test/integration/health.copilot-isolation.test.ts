import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import type { CopilotReadinessRuntime } from '../../providers/copilotReadiness.js';
import { resetMcpStatusCache } from '../../providers/mcpStatus.js';
import { createChatProvidersRouter } from '../../routes/chatProviders.js';
import { createMockCopilotSdkHarness } from '../support/mockCopilotSdk.js';
const defaultDetection = {
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'not detected',
};
const envSnapshot = new Map<string, string | undefined>();
const setEnv = (key: string, value: string | undefined) => {
    if (!envSnapshot.has(key)) {
        envSnapshot.set(key, process.env[key]);
    }
    if (value === undefined) {
        clearScopedTestEnvValue(key);
        return;
    }
    setScopedTestEnvValue(key, value);
};
const restoreEnv = () => {
    for (const [key, value] of envSnapshot.entries()) {
        if (value === undefined) {
            clearScopedTestEnvValue(key);
        }
        else {
            setScopedTestEnvValue(key, value);
        }
    }
    envSnapshot.clear();
};
const emptyClientFactory = (): LMStudioClient => ({
    system: {
        listDownloadedModels: async () => [],
    },
}) as unknown as LMStudioClient;
const buildApp = (copilotRuntimeFactory: () => CopilotReadinessRuntime) => {
    const app = express();
    app.use(express.json());
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            timestamp: Date.now(),
            mongoConnected: false,
        });
    });
    app.use('/chat', createChatProvidersRouter({
        clientFactory: emptyClientFactory,
        copilotRuntimeFactory,
    }));
    return app;
};
beforeEach(() => {
    resetMcpStatusCache();
    setCodexDetection(defaultDetection);
    setEnv('CODEX_HOME', undefined);
    setEnv('CODEINFO_CODEX_HOME', undefined);
    setEnv('CODEINFO_COPILOT_HOME', undefined);
    setEnv('CODEINFO_LMSTUDIO_HOME', undefined);
    setEnv('CODEINFO_CHAT_DEFAULT_PROVIDER', undefined);
    setEnv('CODEINFO_CHAT_DEFAULT_MODEL', undefined);
    setEnv('CODEINFO_SERVER_PORT', '5010');
    setEnv('COPILOT_GITHUB_TOKEN', undefined);
    setEnv('GH_TOKEN', undefined);
    setEnv('GITHUB_TOKEN', undefined);
    setEnv('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', undefined);
    setEnv('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS', undefined);
});
afterEach(() => {
    restoreEnv();
});
test('health stays process-level when Copilot connectivity is unavailable', async () => {
    const harness = createMockCopilotSdkHarness({
        name: 'health-connectivity-unavailable',
        startError: new Error('copilot cli missing'),
    });
    const app = buildApp(() => harness.createLifecycle());
    const health = await request(app).get('/health');
    const providers = await request(app).get('/chat/providers');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(providers.body.providers.find((entry: {
        id: string;
    }) => entry.id === 'copilot')?.reason, 'copilot connectivity unavailable');
});
test('health stays process-level when Copilot authentication is unavailable', async () => {
    const harness = createMockCopilotSdkHarness({
        name: 'health-auth-unavailable',
        authStatus: {
            isAuthenticated: false,
            authType: 'user',
            statusMessage: 'not authenticated',
        },
    });
    const app = buildApp(() => harness.createLifecycle());
    const health = await request(app).get('/health');
    const providers = await request(app).get('/chat/providers');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(providers.body.providers.find((entry: {
        id: string;
    }) => entry.id === 'copilot')?.reason, 'copilot authentication required');
});
test('health stays process-level when Copilot models are unavailable', async () => {
    const harness = createMockCopilotSdkHarness({
        name: 'health-models-unavailable',
        authStatus: {
            isAuthenticated: true,
            authType: 'user',
            statusMessage: 'authenticated',
        },
        models: [],
    });
    const app = buildApp(() => harness.createLifecycle());
    const health = await request(app).get('/health');
    const providers = await request(app).get('/chat/providers');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(providers.body.providers.find((entry: {
        id: string;
    }) => entry.id === 'copilot')?.reason, 'copilot models unavailable');
});
