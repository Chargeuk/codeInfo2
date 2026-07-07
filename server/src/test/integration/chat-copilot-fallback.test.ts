import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import nodeTest from 'node:test';
import type { ModelInfo } from '@github/copilot-sdk';
import express from 'express';
import request from 'supertest';
import { CopilotLifecycle } from '../../chat/copilotLifecycle.js';
import { memoryConversations } from '../../chat/memoryPersistence.js';
import { importCopilotSeedIntoRuntimeHome } from '../../config/copilotSeedBootstrap.js';
import { __resetProviderBootstrapStatusForTests, __setProviderBootstrapStatusForTests, } from '../../config/runtimeConfig.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';
import { createMockCopilotSdkHarness, createSessionIdleEvent, } from '../support/mockCopilotSdk.js';
import {
  beginScopedTestEnvIsolation,
  endScopedTestEnvIsolation,
} from '../support/processEnvIsolation.js';
import { startCopilotChatServer } from './support/copilotChatHarness.js';

const test = (name: string, fn: () => Promise<void> | void) =>
  nodeTest(name, async () => {
    beginScopedTestEnvIsolation();
    try {
      await fn();
    } finally {
      endScopedTestEnvIsolation();
    }
  });
async function writeSeedArtifacts(seedHome: string) {
    await fs.mkdir(path.join(seedHome, 'session-state'), { recursive: true });
    await fs.writeFile(path.join(seedHome, 'config.json'), '{"store_token_plaintext": true}\n', 'utf8');
    await fs.writeFile(path.join(seedHome, 'settings.json'), '{"storeTokenPlaintext": true}\n', 'utf8');
    await fs.writeFile(path.join(seedHome, 'session-state', 'session.json'), '{"chat": true}\n', 'utf8');
}
function currentRuntimeEnv(): NodeJS.ProcessEnv {
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    if (uid === undefined || gid === undefined) {
        throw new Error('current runtime identity unavailable on this platform');
    }
    return {
        CODEINFO_RUNTIME_UID: String(uid),
        CODEINFO_RUNTIME_GID: String(gid),
    };
}
async function lockDownRuntimeArtifacts(runtimeHome: string) {
    await fs.chmod(path.join(runtimeHome, 'config.json'), 0o000);
    await fs.chmod(path.join(runtimeHome, 'settings.json'), 0o000);
    await fs.chmod(path.join(runtimeHome, 'session-state', 'session.json'), 0o000);
    await fs.chmod(path.join(runtimeHome, 'session-state'), 0o000);
}
async function hasBootstrappedRuntime(runtimeHome: string) {
    try {
        await Promise.all([
            fs.access(path.join(runtimeHome, 'config.json')),
            fs.access(path.join(runtimeHome, 'settings.json')),
            fs.access(path.join(runtimeHome, 'session-state')),
        ]);
        return true;
    }
    catch {
        return false;
    }
}
function createMockCodexFactory() {
    const createThread = (threadId: string) => ({
        id: threadId,
        runStreamed: async () => ({
            events: (async function* () {
                yield { type: 'thread.started', thread_id: threadId };
                yield {
                    type: 'item.updated',
                    item: { type: 'agent_message', text: 'Hello from Codex' },
                };
                yield {
                    type: 'item.completed',
                    item: { type: 'agent_message', text: 'Hello from Codex fallback' },
                };
                yield {
                    type: 'turn.completed',
                    usage: {
                        input_tokens: 1,
                        cached_input_tokens: 0,
                        output_tokens: 2,
                    },
                };
            })(),
        }),
    });
    return () => ({
        startThread: () => createThread('codex-fallback-thread'),
        resumeThread: (threadId: string) => createThread(threadId),
    });
}
test('copilot chat fails on the selected explicit provider before unrelated LM Studio fallback probing can run', async () => {
    let lmstudioProbeCount = 0;
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-explicit-provider-failure',
            startError: new Error('copilot unavailable'),
        },
        lmstudioAvailable: true,
        lmstudioClientFactory: () => {
            lmstudioProbeCount += 1;
            throw new Error('lmstudio fallback probe should not run for explicit copilot requests');
        },
    });
    try {
        const conversationId = 'copilot-explicit-provider-failure';
        const response = await request(server.httpServer).post('/chat').send({
            provider: 'copilot',
            model: 'copilot-gpt-5',
            conversationId,
            message: 'Do not silently switch providers',
        });
        assert.equal(response.status, 503);
        assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
        assert.match(String(response.body.message), /copilot connectivity unavailable/i);
        assert.equal(lmstudioProbeCount, 0);
        assert.equal(memoryConversations.get(conversationId), undefined);
        assert.equal(server.harness.getState().lastCreateSessionConfig, undefined);
    }
    finally {
        await server.stop();
    }
});
test('explicit copilot chat requests return PROVIDER_UNAVAILABLE instead of falling back to codex', async () => {
    memoryConversations.clear();
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
        cliPath: '/usr/bin/codex',
    });
    const app = express();
    app.use(express.json());
    app.post('/mcp', (_req, res) => {
        res.json({ result: { ok: true } });
    });
    app.use('/chat', createChatRouter({
        clientFactory: () => ({
            system: {
                listDownloadedModels: async () => [],
            },
        }) as never,
        codexFactory: createMockCodexFactory(),
        copilotLifecycleFactory: () => createMockCopilotSdkHarness({
            name: 'copilot-explicit-no-cross-provider-fallback',
            startError: new Error('copilot unavailable'),
        }).createLifecycle(),
    }));
    const response = await request(app).post('/chat').send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId: 'copilot-explicit-no-cross-provider-fallback',
        message: 'Do not silently switch to Codex',
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(memoryConversations.get('copilot-explicit-no-cross-provider-fallback'), undefined);
});
test('explicit Copilot chat requests start in endpoint-only mode when Copilot auth is missing but the selected endpoint is healthy', async () => {
    const originalCompatEndpoints = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    let externalServer: Awaited<ReturnType<typeof startExternalOpenAiCompatServer>> | undefined;
    let server: Awaited<ReturnType<typeof startCopilotChatServer>> | undefined;
    try {
        externalServer = await startExternalOpenAiCompatServer({
            models: ['endpoint-copilot-model'],
        });
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${externalServer.baseUrl}/v1|completions`);
        server = await startCopilotChatServer({
            scenario: {
                name: 'copilot-chat-endpoint-only',
                authStatus: {
                    isAuthenticated: false,
                    authType: 'user',
                    statusMessage: 'login required',
                },
                models: [],
            },
        });
        const conversationId = 'copilot-endpoint-only';
        const response = await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            model: 'endpoint-copilot-model',
            endpointId: `${externalServer.baseUrl}/v1`,
            conversationId,
            message: 'Use the external endpoint without Copilot auth',
        });
        assert.equal(response.status, 202);
        assert.equal(response.body.provider, 'copilot');
        assert.equal(response.body.model, 'endpoint-copilot-model');
        assert.equal(memoryConversations.get(conversationId)?.provider, 'copilot');
        assert.equal(server.harness.getState().lastCreateSessionConfig?.model, 'endpoint-copilot-model');
        assert.equal(server.harness.getState().lastCreateSessionConfig?.provider?.type, 'openai');
    }
    finally {
        await server?.stop();
        await externalServer?.stop();
        if (originalCompatEndpoints === undefined) {
            clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
        }
        else {
            setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", originalCompatEndpoints);
        }
    }
});
test('explicit Copilot chat requests tolerate endpoint discovery failures during inference', async () => {
    const originalCompatEndpoints = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    const originalCopilotHome = process.env.CODEINFO_COPILOT_HOME;
    let externalServer: Awaited<ReturnType<typeof startExternalOpenAiCompatServer>> | undefined;
    let copilotHome: string | undefined;
    let server: Awaited<ReturnType<typeof startCopilotChatServer>> | undefined;
    try {
        externalServer = await startExternalOpenAiCompatServer({
            models: ['endpoint-copilot-model'],
        });
        copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-chat-discovery-tolerated-'));
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${externalServer.baseUrl}/v1|completions`);
        setScopedTestEnvValue("CODEINFO_COPILOT_HOME", copilotHome);
        await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
        await fs.writeFile(path.join(copilotHome, 'chat', 'config.toml'), [
            'model = "copilot-gpt-5"',
            `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|completions"`,
            '',
        ].join('\n'), 'utf8');
        server = await startCopilotChatServer({
            scenario: {
                name: 'copilot-chat-discovery-failure-tolerated',
                authStatus: {
                    isAuthenticated: false,
                    authType: 'user',
                    statusMessage: 'login required',
                },
                models: [],
            },
            providerDiscoveryResolver: async () => {
                throw new Error('discovery exploded');
            },
        });
        const response = await request(server.httpServer).post('/chat').send({
            provider: 'copilot',
            model: 'endpoint-copilot-model',
            conversationId: 'copilot-discovery-failure-tolerated',
            message: 'Continue even if endpoint discovery throws',
        });
        assert.equal(response.status, 202);
        assert.equal(response.body.provider, 'copilot');
        assert.equal(memoryConversations.get('copilot-discovery-failure-tolerated')?.provider, 'copilot');
    }
    finally {
        await server?.stop();
        await externalServer?.stop();
        if (originalCompatEndpoints === undefined) {
            clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
        }
        else {
            setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", originalCompatEndpoints);
        }
        if (originalCopilotHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_COPILOT_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_COPILOT_HOME", originalCopilotHome);
        }
        if (copilotHome) {
            await fs.rm(copilotHome, { recursive: true, force: true });
        }
    }
});
test('explicit Copilot chat requests honor a pinned external endpoint when the request model matches config', async () => {
    const originalCompatEndpoints = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    const originalCopilotHome = process.env.CODEINFO_COPILOT_HOME;
    let externalServer: Awaited<ReturnType<typeof startExternalOpenAiCompatServer>> | undefined;
    let copilotHome: string | undefined;
    let server: Awaited<ReturnType<typeof startCopilotChatServer>> | undefined;
    try {
        externalServer = await startExternalOpenAiCompatServer({
            models: ['endpoint-copilot-model'],
        });
        copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-chat-pinned-endpoint-'));
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${externalServer.baseUrl}/v1|completions`);
        setScopedTestEnvValue("CODEINFO_COPILOT_HOME", copilotHome);
        await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
        await fs.writeFile(path.join(copilotHome, 'chat', 'config.toml'), [
            'model = "copilot-gpt-5"',
            `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|completions"`,
            '',
        ].join('\n'), 'utf8');
        server = await startCopilotChatServer({
            scenario: {
                name: 'copilot-chat-pinned-endpoint-explicit-model',
                authStatus: {
                    isAuthenticated: false,
                    authType: 'user',
                    statusMessage: 'login required',
                },
                models: [],
            },
        });
        const conversationId = 'copilot-pinned-endpoint-explicit-model';
        const response = await request(server.httpServer).post('/chat').send({
            provider: 'copilot',
            model: 'endpoint-copilot-model',
            conversationId,
            message: 'Use the pinned external endpoint without Copilot auth',
        });
        assert.equal(response.status, 202);
        assert.equal(response.body.provider, 'copilot');
        assert.equal(response.body.model, 'endpoint-copilot-model');
        assert.equal(memoryConversations.get(conversationId)?.provider, 'copilot');
        assert.equal(server.harness.getState().lastCreateSessionConfig?.model, 'endpoint-copilot-model');
        assert.equal(server.harness.getState().lastCreateSessionConfig?.provider?.type, 'openai');
    }
    finally {
        await server?.stop();
        await externalServer?.stop();
        if (copilotHome) {
            await fs.rm(copilotHome, { recursive: true, force: true });
        }
        if (originalCompatEndpoints === undefined) {
            clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
        }
        else {
            setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", originalCompatEndpoints);
        }
        if (originalCopilotHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_COPILOT_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_COPILOT_HOME", originalCopilotHome);
        }
    }
});
test('explicit Copilot chat requests infer the external endpoint from the selected endpoint-only model when auth is missing', async () => {
    const originalCompatEndpoints = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    let externalServer: Awaited<ReturnType<typeof startExternalOpenAiCompatServer>> | undefined;
    let server: Awaited<ReturnType<typeof startCopilotChatServer>> | undefined;
    try {
        externalServer = await startExternalOpenAiCompatServer({
            models: ['endpoint-copilot-model'],
        });
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${externalServer.baseUrl}/v1|completions`);
        server = await startCopilotChatServer({
            scenario: {
                name: 'copilot-chat-endpoint-only-inferred-endpoint',
                authStatus: {
                    isAuthenticated: false,
                    authType: 'user',
                    statusMessage: 'login required',
                },
                models: [],
            },
        });
        const conversationId = 'copilot-endpoint-only-inferred-endpoint';
        const response = await request(server.httpServer).post('/chat').send({
            provider: 'copilot',
            model: 'endpoint-copilot-model',
            conversationId,
            message: 'Infer the external endpoint from the selected model',
        });
        assert.equal(response.status, 202);
        assert.equal(response.body.provider, 'copilot');
        assert.equal(response.body.model, 'endpoint-copilot-model');
        assert.equal(memoryConversations.get(conversationId)?.provider, 'copilot');
        assert.equal(server.harness.getState().lastCreateSessionConfig?.model, 'endpoint-copilot-model');
        assert.equal(server.harness.getState().lastCreateSessionConfig?.provider?.type, 'openai');
    }
    finally {
        await server?.stop();
        await externalServer?.stop();
        if (originalCompatEndpoints === undefined) {
            clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
        }
        else {
            setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", originalCompatEndpoints);
        }
    }
});
test('explicit Copilot chat requests normalize inferred external endpoint ids before selection', async () => {
    const originalCompatEndpoints = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    let externalServer: Awaited<ReturnType<typeof startExternalOpenAiCompatServer>> | undefined;
    let server: Awaited<ReturnType<typeof startCopilotChatServer>> | undefined;
    try {
        externalServer = await startExternalOpenAiCompatServer({
            models: ['endpoint-copilot-model'],
        });
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `  ${externalServer.baseUrl}/v1  |completions`);
        server = await startCopilotChatServer({
            scenario: {
                name: 'copilot-chat-endpoint-only-inferred-endpoint-trimmed',
                authStatus: {
                    isAuthenticated: false,
                    authType: 'user',
                    statusMessage: 'login required',
                },
                models: [],
            },
        });
        const conversationId = 'copilot-endpoint-only-inferred-endpoint-trimmed';
        const response = await request(server.httpServer).post('/chat').send({
            provider: 'copilot',
            model: 'endpoint-copilot-model',
            conversationId,
            message: 'Infer the external endpoint from the selected model',
        });
        assert.equal(response.status, 202);
        assert.equal(response.body.provider, 'copilot');
        assert.equal(response.body.model, 'endpoint-copilot-model');
        assert.equal(server.harness.getState().lastCreateSessionConfig?.provider?.type, 'openai');
    }
    finally {
        await server?.stop();
        await externalServer?.stop();
        if (originalCompatEndpoints === undefined) {
            clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
        }
        else {
            setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", originalCompatEndpoints);
        }
    }
});
test('explicit Copilot chat requests fail closed when connectivity is unavailable even if the selected endpoint is healthy', async () => {
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['endpoint-copilot-model'],
    });
    const originalCompatEndpoints = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${externalServer.baseUrl}/v1|completions`);
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-connectivity-unavailable-with-endpoint',
            startError: new Error('copilot unavailable'),
        },
    });
    try {
        const response = await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            model: 'endpoint-copilot-model',
            endpointId: `${externalServer.baseUrl}/v1`,
            conversationId: 'copilot-explicit-endpoint-connectivity-unavailable',
            message: 'Do not use the endpoint when Copilot runtime is offline',
        });
        assert.equal(response.status, 503);
        assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
        assert.match(String(response.body.message), /copilot connectivity unavailable/i);
        assert.equal(memoryConversations.get('copilot-explicit-endpoint-connectivity-unavailable'), undefined);
    }
    finally {
        await server.stop();
        await externalServer.stop();
        if (originalCompatEndpoints === undefined) {
            clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
        }
        else {
            setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", originalCompatEndpoints);
        }
    }
});
test('copilot chat still falls back automatically when provider resolution is omitted and runtime selection must recover', async () => {
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-default-provider-fallback',
            startError: new Error('copilot unavailable'),
        },
        lmstudioAvailable: true,
    });
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'copilot');
    try {
        const conversationId = 'copilot-default-provider-fallback';
        const response = await request(server.httpServer).post('/chat').send({
            conversationId,
            message: 'Fallback please',
        });
        assert.equal(response.status, 202);
        assert.equal(response.body.provider, 'lmstudio');
        assert.equal(memoryConversations.get(conversationId)?.provider, 'lmstudio');
    }
    finally {
        if (originalDefaultProvider === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalDefaultProvider);
        }
        await server.stop();
    }
});
test('chat started responses keep the requested provider and repair the model there when the provider is healthy but the requested model is missing', async () => {
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-same-provider-model-repair',
            models: [
                {
                    id: 'gpt-5-mini',
                    name: 'GPT-5 Mini',
                } as ModelInfo,
                {
                    id: 'copilot-gpt-5',
                    name: 'Copilot GPT-5',
                } as ModelInfo,
            ],
        },
    });
    try {
        const conversationId = 'copilot-same-provider-model-repair';
        const response = await request(server.httpServer).post('/chat').send({
            provider: 'copilot',
            model: 'missing-copilot-model',
            conversationId,
            message: 'Repair the model on the selected provider',
        });
        assert.equal(response.status, 202);
        assert.equal(response.body.provider, 'copilot');
        assert.equal(response.body.model, 'gpt-5-mini');
        assert.equal(memoryConversations.get(conversationId)?.provider, 'copilot');
        assert.equal(memoryConversations.get(conversationId)?.model, 'gpt-5-mini');
    }
    finally {
        await server.stop();
    }
});
test('chat started responses keep the same requested model first when cross-provider fallback is required', async () => {
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-same-model-first-fallback',
            startError: new Error('copilot unavailable'),
            models: [
                {
                    id: 'copilot-gpt-5',
                    name: 'Copilot GPT-5',
                } as ModelInfo,
            ],
        },
        lmstudioAvailable: true,
        lmstudioClientFactory: () => ({
            system: {
                listDownloadedModels: async () => [
                    {
                        modelKey: 'lmstudio-test-model',
                        displayName: 'LM Studio Test Model',
                        type: 'llm',
                    },
                    {
                        modelKey: 'copilot-gpt-5',
                        displayName: 'Fallback Matches Requested Model',
                        type: 'llm',
                    },
                ],
            },
            llm: {
                model: async () => ({
                    act: async () => undefined,
                }),
            },
        }) as never,
    });
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'copilot');
    try {
        const conversationId = 'copilot-same-model-first-fallback';
        const response = await request(server.httpServer).post('/chat').send({
            conversationId,
            model: 'copilot-gpt-5',
            message: 'Keep the requested model on fallback',
        });
        assert.equal(response.status, 202);
        assert.equal(response.body.provider, 'lmstudio');
        assert.equal(response.body.model, 'copilot-gpt-5');
        assert.equal(memoryConversations.get(conversationId)?.provider, 'lmstudio');
        assert.equal(memoryConversations.get(conversationId)?.model, 'copilot-gpt-5');
    }
    finally {
        if (originalDefaultProvider === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalDefaultProvider);
        }
        await server.stop();
    }
});
test('implicit degraded-bootstrap chat requests fall back at the route and keep warning context', async () => {
    __setProviderBootstrapStatusForTests('copilot', {
        healthy: false,
        reason: 'copilot bootstrap degraded',
        warnings: ['copilot bootstrap degraded warning'],
    });
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-degraded-bootstrap-fallback',
        },
        lmstudioAvailable: true,
    });
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'copilot');
    try {
        const response = await request(server.httpServer).post('/chat').send({
            conversationId: 'copilot-bootstrap-fallback',
            message: 'Fallback from degraded bootstrap',
        });
        assert.equal(response.status, 202);
        assert.equal(response.body.provider, 'lmstudio');
        assert.equal(response.body.warnings.some((warning: string) => warning.includes('copilot bootstrap degraded warning')), true);
        assert.equal(response.body.warnings.some((warning: string) => warning.includes('fell back to provider "lmstudio"')), true);
        assert.equal(response.body.warnings.some((warning: string) => warning.includes('Endpoint "unknown"')), false);
        assert.equal(memoryConversations.get('copilot-bootstrap-fallback')?.provider, 'lmstudio');
    }
    finally {
        __resetProviderBootstrapStatusForTests();
        if (originalDefaultProvider === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalDefaultProvider);
        }
        await server.stop();
    }
});
test('endpoint-unavailable Copilot chat falls back to the same provider native path before cross-provider fallback', async () => {
    const externalServer = await startExternalOpenAiCompatServer({
        responseMode: 'transport-failure',
    });
    const originalCompatEndpoints = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${externalServer.baseUrl}/v1|responses,completions`);
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-endpoint-native-fallback',
        },
        lmstudioAvailable: true,
    });
    try {
        const conversationId = 'copilot-endpoint-native-fallback';
        const response = await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            endpointId: `${externalServer.baseUrl}/v1`,
            model: 'missing-copilot-model',
            conversationId,
            message: 'Use native Copilot before any cross-provider fallback',
        });
        assert.equal(response.status, 202);
        assert.equal(response.body.provider, 'copilot');
        assert.equal(response.body.model, 'copilot-gpt-5');
        assert.equal(response.body.warnings.some((warning: string) => warning.includes(`Endpoint "${externalServer.baseUrl}/v1" was unavailable; falling back to native copilot model "copilot-gpt-5".`)), true);
    }
    finally {
        await server.stop();
        await externalServer.stop();
        if (originalCompatEndpoints === undefined) {
            clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
        }
        else {
            setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", originalCompatEndpoints);
        }
    }
});
test('endpoint-aware Copilot chat repairs to the first selectable model on the same endpoint before broader fallback', async () => {
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['endpoint-copilot-model', 'endpoint-copilot-model-2'],
    });
    const originalCompatEndpoints = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${externalServer.baseUrl}/v1|responses,completions`);
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-endpoint-repair',
        },
        lmstudioAvailable: true,
    });
    try {
        const conversationId = 'copilot-endpoint-repair';
        const response = await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            endpointId: `${externalServer.baseUrl}/v1`,
            model: 'missing-copilot-model',
            conversationId,
            message: 'Repair to the first selectable model on the endpoint',
        });
        assert.equal(response.status, 202);
        assert.equal(response.body.provider, 'copilot');
        assert.equal(response.body.model, 'endpoint-copilot-model');
        assert.equal(response.body.warnings.some((warning: string) => warning.includes(`Requested model "missing-copilot-model" was unavailable on endpoint "${externalServer.baseUrl}/v1"; using "endpoint-copilot-model" instead.`)), true);
    }
    finally {
        await server.stop();
        await externalServer.stop();
        if (originalCompatEndpoints === undefined) {
            clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
        }
        else {
            setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", originalCompatEndpoints);
        }
    }
});
test('resumed chats reject codex-only agentFlags before a saved copilot conversation can return 202 started', async () => {
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-saved-provider-agentflags-repin',
        },
    });
    try {
        setCodexDetection({
            available: true,
            authPresent: true,
            configPresent: true,
            cliPath: '/usr/bin/codex',
        });
        const conversationId = 'copilot-saved-provider-agentflags-repin';
        memoryConversations.set(conversationId, {
            _id: conversationId,
            provider: 'copilot',
            model: 'copilot-gpt-5',
            title: 'Saved copilot execution',
            source: 'REST',
            flags: { agentFlags: { toolAccess: 'full' } },
            lastMessageAt: new Date('2026-05-15T00:00:00.000Z'),
            archivedAt: null,
            createdAt: new Date('2026-05-15T00:00:00.000Z'),
            updatedAt: new Date('2026-05-15T00:00:00.000Z'),
        } as never);
        const response = await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'codex',
            model: 'gpt-5.1-codex-max',
            conversationId,
            message: 'Do not start with stale codex-only flags',
            agentFlags: {
                sandboxMode: 'danger-full-access',
            },
        });
        assert.equal(response.status, 400);
        assert.equal(response.body.code, 'VALIDATION_FAILED');
        assert.match(String(response.body.message), /agentFlags\.sandboxMode is not supported for provider "copilot"/i);
        assert.equal(memoryConversations.get(conversationId)?.provider, 'copilot');
        assert.equal(memoryConversations.get(conversationId)?.model, 'copilot-gpt-5');
        assert.equal(server.harness.getState().lastCreateSessionConfig, undefined);
    }
    finally {
        await server.stop();
    }
});
test('explicit Copilot chat requests recover once startup seed import restores the missing runtime auth artifacts', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-chat-seed-import-'));
    const seedHome = path.join(tempRoot, 'seed-home');
    const runtimeHome = path.join(tempRoot, 'runtime-home');
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-chat-seed-import-success',
    });
    try {
        await writeSeedArtifacts(seedHome);
        const seedResult = await importCopilotSeedIntoRuntimeHome({
            runtimeHome,
            seedHome,
            env: currentRuntimeEnv(),
        });
        assert.equal(seedResult.status, 'seed_applied');
        await lockDownRuntimeArtifacts(runtimeHome);
        const normalizationResult = await importCopilotSeedIntoRuntimeHome({
            runtimeHome,
            seedHome,
            env: currentRuntimeEnv(),
        });
        assert.equal(normalizationResult.status, 'seed_skipped_runtime_already_initialized');
        memoryConversations.clear();
        setCodexDetection({
            available: false,
            authPresent: false,
            configPresent: false,
            reason: 'not detected',
        });
        const app = express();
        app.use(express.json());
        app.post('/mcp', (_req, res) => {
            res.json({ result: { ok: true } });
        });
        app.use('/chat', createChatRouter({
            clientFactory: () => ({
                system: {
                    listDownloadedModels: async () => [],
                },
            }) as never,
            copilotLifecycleFactory: () => {
                const lifecycle = harness.createLifecycle();
                const start = lifecycle.start.bind(lifecycle);
                const getAuthStatus = lifecycle.getAuthStatus.bind(lifecycle);
                lifecycle.start = async () => {
                    if (!(await hasBootstrappedRuntime(runtimeHome))) {
                        throw new Error('copilot unavailable');
                    }
                    await start();
                };
                lifecycle.getAuthStatus = async () => (await hasBootstrappedRuntime(runtimeHome))
                    ? getAuthStatus()
                    : {
                        isAuthenticated: false,
                        authType: 'user',
                    };
                return lifecycle;
            },
        }));
        const response = await request(app).post('/chat').send({
            provider: 'copilot',
            model: 'copilot-gpt-5',
            conversationId: 'copilot-seed-import-success',
            message: 'Prove the seed import restored Copilot startup auth',
        });
        assert.equal(response.status, 202);
        assert.equal(response.body.provider, 'copilot');
    }
    finally {
        memoryConversations.clear();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
test('chat forwards CODEINFO_ROOT into the Copilot runtime environment', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-copilot-codeinfo-root-'));
    const envKeys = [
        'CODEINFO_SERVER_PORT',
        'MCP_URL',
        'CODEINFO_LMSTUDIO_BASE_URL',
        'CODEINFO_COPILOT_HOME',
    ] as const;
    const originalEnv = new Map<string, string | undefined>();
    for (const key of envKeys) {
        originalEnv.set(key, process.env[key]);
    }
    const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-copilot-home-'));
    setScopedTestEnvValue("CODEINFO_COPILOT_HOME", copilotHome);
    const capturedOptions: {
        env?: NodeJS.ProcessEnv;
    }[] = [];
    const harness = createMockCopilotSdkHarness({
        name: 'chat-copilot-env-forwarding',
        models: [
            {
                id: 'copilot-model',
                name: 'Copilot Model',
            } as ModelInfo,
        ],
        createSessionEvents: [createSessionIdleEvent()],
    });
    const app = express();
    app.use(express.json());
    app.post('/mcp', (_req, res) => {
        res.json({ result: { ok: true } });
    });
    app.use('/chat', createChatRouter({
        clientFactory: () => ({
            system: {
                listDownloadedModels: async () => [],
            },
        }) as never,
        listIngestedRepositoriesFn: async () => ({
            repos: [{ containerPath: repoRoot }],
            lockedModelId: null,
        }) as never,
        copilotLifecycleFactory: ({ env } = {}) => new CopilotLifecycle({
            env,
            clientFactory: (options) => {
                capturedOptions.push(options);
                return harness.createClientFactory()(options);
            },
        }),
    }));
    const httpServer = http.createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    assert(address && typeof address === 'object');
    setScopedTestEnvValue("CODEINFO_SERVER_PORT", String(address.port));
    setScopedTestEnvValue("MCP_URL", `http://127.0.0.1:${address.port}/mcp`);
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'http://127.0.0.1:9');
    try {
        await request(httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            model: 'copilot-model',
            conversationId: 'chat-copilot-codeinfo-root',
            message: 'Pass CODEINFO_ROOT through to Copilot.',
            working_folder: repoRoot,
        })
            .expect(202);
        for (let attempt = 0; attempt < 50; attempt += 1) {
            if (capturedOptions.length >= 1)
                break;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(capturedOptions.some((options) => options.env?.CODEINFO_ROOT === repoRoot), true);
        assert.equal(capturedOptions.some((options) => options.env?.COPILOT_HOME === copilotHome), true);
    }
    finally {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        memoryConversations.delete('chat-copilot-codeinfo-root');
        for (const key of envKeys) {
            const value = originalEnv.get(key);
            if (value === undefined) {
                clearScopedTestEnvValue(key);
            }
            else {
                setScopedTestEnvValue(key, value);
            }
        }
        await fs.rm(copilotHome, { recursive: true, force: true });
        await fs.rm(repoRoot, { recursive: true, force: true });
    }
});
