import assert from 'assert';
import type { Server } from 'http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mockModelsResponse } from '@codeinfo2/common';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import { append as appendLog, query } from '../../logStore.js';
import { baseLogger, createRequestLogger } from '../../logger.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatModelsRouter } from '../../routes/chatModels.js';
import { createChatProvidersRouter } from '../../routes/chatProviders.js';
import { createLogsRouter } from '../../routes/logs.js';
import { startNamedCopilotScenarioServer, type StartedNamedCopilotScenarioServer, } from '../support/copilotBootPath.js';
import { NAMED_COPILOT_SCENARIOS, type NamedCopilotScenario, } from '../support/copilotScenarioCatalog.js';
import { startExternalOpenAiCompatServer, type ExternalOpenAiCompatServer, } from '../support/externalOpenAiCompatServer.js';
import { createMockCopilotSdkHarness } from '../support/mockCopilotSdk.js';
import { MockLMStudioClient, type MockScenario, startMock, stopMock, } from '../support/mockLmStudioSdk.js';
const TASK17_LOG_MARKER = 'story.0000051.task17.cucumber_scenarios_registered';
const ORIGINAL_CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
const ORIGINAL_CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
const ORIGINAL_CODEINFO_CODEX_HOME = process.env.CODEINFO_CODEX_HOME;
const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME;
const ORIGINAL_CODEINFO_COPILOT_HOME = process.env.CODEINFO_COPILOT_HOME;
const ORIGINAL_CODEINFO_LMSTUDIO_HOME = process.env.CODEINFO_LMSTUDIO_HOME;
const ORIGINAL_CODEINFO_CHAT_DEFAULT_PROVIDER = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
const ORIGINAL_CODEINFO_CHAT_DEFAULT_MODEL = process.env.CODEINFO_CHAT_DEFAULT_MODEL;
const ORIGINAL_CODEX_MODEL_LIST = process.env.Codex_model_list;
let server: Server | null = null;
let baseUrl = '';
let response: {
    status: number;
    body: unknown | null;
} | null = null;
let namedCopilotScenarioServer: StartedNamedCopilotScenarioServer | null = null;
let externalServers: ExternalOpenAiCompatServer[] = [];
let tempCodexHomeForScenario: string | null = null;
let discoveredEndpointId: string | null = null;
let pinnedEndpointId: string | null = null;
async function writeCodexChatConfig(params: {
    home: string;
    model: string;
    endpointId: string;
}) {
    await fs.mkdir(path.join(params.home, 'chat'), { recursive: true });
    await fs.writeFile(path.join(params.home, 'chat', 'config.toml'), [
        `model = "${params.model}"`,
        `codeinfo_openai_endpoint = "${params.endpointId}|responses"`,
        '',
    ].join('\n'), 'utf8');
}
function createUnavailableCopilotLifecycle() {
    return createMockCopilotSdkHarness({
        name: 'cucumber-chat-models-copilot-auth-required',
        authStatus: {
            isAuthenticated: false,
            authType: 'user',
            statusMessage: 'login required',
        },
    }).createLifecycle();
}
function isNamedCopilotScenario(name: string): name is NamedCopilotScenario {
    return (NAMED_COPILOT_SCENARIOS as readonly string[]).includes(name);
}
async function startLegacyModelsServer() {
    const app = express();
    app.use(cors());
    app.use(createRequestLogger());
    app.use((req, res, next) => {
        const requestId = (req as unknown as {
            id?: string;
        }).id;
        if (requestId)
            res.locals.requestId = requestId;
        next();
    });
    app.use('/chat', createChatModelsRouter({
        clientFactory: () => new MockLMStudioClient() as unknown as LMStudioClient,
        copilotRuntimeFactory: createUnavailableCopilotLifecycle,
    }));
    app.use('/chat', createChatProvidersRouter({
        clientFactory: () => new MockLMStudioClient() as unknown as LMStudioClient,
        copilotRuntimeFactory: createUnavailableCopilotLifecycle,
    }));
    app.use('/logs', createLogsRouter());
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
}
async function startExternalEndpointModelsScenario(params: {
    discoveredModels: string[];
    pinnedModels?: string[];
    pinnedEndpointAbsentFromEnv?: boolean;
    codexConfigModel?: string;
}) {
    const discoveredServer = await startExternalOpenAiCompatServer({
        models: params.discoveredModels,
    });
    externalServers.push(discoveredServer);
    discoveredEndpointId = `${discoveredServer.baseUrl}/v1`;
    setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${discoveredEndpointId}|responses,completions`);
    if (params.pinnedModels) {
        const pinnedServer = await startExternalOpenAiCompatServer({
            models: params.pinnedModels,
        });
        externalServers.push(pinnedServer);
        pinnedEndpointId = `${pinnedServer.baseUrl}/v1`;
        if (params.pinnedEndpointAbsentFromEnv) {
            setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${discoveredEndpointId}|responses,completions`);
        }
        else {
            setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${discoveredEndpointId}|responses,completions,${pinnedEndpointId}|responses`);
        }
        tempCodexHomeForScenario = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-models-codex-home-'));
        await writeCodexChatConfig({
            home: tempCodexHomeForScenario,
            model: params.codexConfigModel ?? params.pinnedModels[0] ?? 'gpt-5.1-codex-max',
            endpointId: pinnedEndpointId,
        });
        setScopedTestEnvValue("CODEINFO_CODEX_HOME", tempCodexHomeForScenario);
        return;
    }
    tempCodexHomeForScenario = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-models-codex-home-'));
    await writeCodexChatConfig({
        home: tempCodexHomeForScenario,
        model: params.codexConfigModel ?? params.discoveredModels[0] ?? 'gpt-5.1-codex-max',
        endpointId: discoveredEndpointId,
    });
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", tempCodexHomeForScenario);
}
function registerTask17Scenario(scenarioName: NamedCopilotScenario) {
    const context = {
        scenario: scenarioName,
        surface: 'cucumber',
        feature: 'chat_models',
    };
    appendLog({
        level: 'info',
        message: TASK17_LOG_MARKER,
        timestamp: new Date().toISOString(),
        source: 'server',
        context,
    });
    baseLogger.info(context, TASK17_LOG_MARKER);
}
Before(async () => {
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'ws://localhost:1234');
    clearScopedTestEnvValue("CODEX_HOME");
    clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
    clearScopedTestEnvValue("CODEINFO_COPILOT_HOME");
    clearScopedTestEnvValue("CODEINFO_LMSTUDIO_HOME");
    clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
    clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL");
    clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
    clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS");
    setCodexDetection({
        available: false,
        authPresent: false,
        configPresent: false,
        reason: 'not detected',
    });
    response = null;
    baseUrl = '';
    discoveredEndpointId = null;
    pinnedEndpointId = null;
    externalServers = [];
    tempCodexHomeForScenario = null;
});
After(async () => {
    stopMock();
    if (namedCopilotScenarioServer) {
        await namedCopilotScenarioServer.stop();
        namedCopilotScenarioServer = null;
    }
    while (externalServers.length > 0) {
        await externalServers.pop()!.stop();
    }
    if (tempCodexHomeForScenario) {
        await fs.rm(tempCodexHomeForScenario, { recursive: true, force: true });
        tempCodexHomeForScenario = null;
    }
    setCodexDetection({
        available: false,
        authPresent: false,
        configPresent: false,
        reason: 'not detected',
    });
    if (ORIGINAL_CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS === undefined) {
        clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
    }
    else {
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", ORIGINAL_CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS);
    }
    if (ORIGINAL_CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS === undefined) {
        clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS");
    }
    else {
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS", ORIGINAL_CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS);
    }
    if (ORIGINAL_CODEINFO_CODEX_HOME === undefined) {
        clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
    }
    else {
        setScopedTestEnvValue("CODEINFO_CODEX_HOME", ORIGINAL_CODEINFO_CODEX_HOME);
    }
    if (ORIGINAL_CODEX_HOME === undefined) {
        clearScopedTestEnvValue("CODEX_HOME");
    }
    else {
        setScopedTestEnvValue("CODEX_HOME", ORIGINAL_CODEX_HOME);
    }
    if (ORIGINAL_CODEINFO_COPILOT_HOME === undefined) {
        clearScopedTestEnvValue("CODEINFO_COPILOT_HOME");
    }
    else {
        setScopedTestEnvValue("CODEINFO_COPILOT_HOME", ORIGINAL_CODEINFO_COPILOT_HOME);
    }
    if (ORIGINAL_CODEINFO_LMSTUDIO_HOME === undefined) {
        clearScopedTestEnvValue("CODEINFO_LMSTUDIO_HOME");
    }
    else {
        setScopedTestEnvValue("CODEINFO_LMSTUDIO_HOME", ORIGINAL_CODEINFO_LMSTUDIO_HOME);
    }
    if (ORIGINAL_CODEINFO_CHAT_DEFAULT_PROVIDER === undefined) {
        clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
    }
    else {
        setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", ORIGINAL_CODEINFO_CHAT_DEFAULT_PROVIDER);
    }
    if (ORIGINAL_CODEINFO_CHAT_DEFAULT_MODEL === undefined) {
        clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL");
    }
    else {
        setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL", ORIGINAL_CODEINFO_CHAT_DEFAULT_MODEL);
    }
    if (ORIGINAL_CODEX_MODEL_LIST === undefined) {
        clearScopedTestEnvValue("Codex_model_list");
    }
    else {
        setScopedTestEnvValue("Codex_model_list", ORIGINAL_CODEX_MODEL_LIST);
    }
    if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        server = null;
    }
});
Given('chat models scenario {string}', async (name: string) => {
    if (name === 'external-endpoint-discovery') {
        setCodexDetection({
            available: true,
            authPresent: true,
            configPresent: true,
            cliPath: '/usr/bin/codex',
        });
        await startExternalEndpointModelsScenario({
            discoveredModels: ['gpt-5.1-codex-max', 'gpt-5.2'],
        });
        await startLegacyModelsServer();
        return;
    }
    if (name === 'external-endpoint-native-default-clears-stale-endpoint') {
        setCodexDetection({
            available: true,
            authPresent: true,
            configPresent: true,
            cliPath: '/usr/bin/codex',
        });
        setScopedTestEnvValue("Codex_model_list", 'builtin-a,builtin-b');
        await startExternalEndpointModelsScenario({
            discoveredModels: ['external-alpha'],
            pinnedModels: ['external-beta'],
            pinnedEndpointAbsentFromEnv: true,
            codexConfigModel: 'builtin-a',
        });
        await startLegacyModelsServer();
        return;
    }
    if (name === 'external-endpoint-picker-bootstrap') {
        setCodexDetection({
            available: true,
            authPresent: true,
            configPresent: true,
            cliPath: '/usr/bin/codex',
        });
        await startExternalEndpointModelsScenario({
            discoveredModels: ['gpt-5.1-codex-max'],
            pinnedModels: ['gpt-5.2'],
            pinnedEndpointAbsentFromEnv: true,
        });
        await startLegacyModelsServer();
        return;
    }
    if (name === 'external-endpoint-picker-bootstrap-duplicate-ids') {
        setCodexDetection({
            available: true,
            authPresent: true,
            configPresent: true,
            cliPath: '/usr/bin/codex',
        });
        await startExternalEndpointModelsScenario({
            discoveredModels: ['shared-model'],
            pinnedModels: ['shared-model'],
            pinnedEndpointAbsentFromEnv: true,
        });
        await startLegacyModelsServer();
        return;
    }
    if (isNamedCopilotScenario(name)) {
        namedCopilotScenarioServer = await startNamedCopilotScenarioServer({
            scenarioName: name,
        });
        baseUrl = namedCopilotScenarioServer.baseUrl;
        registerTask17Scenario(name);
        return;
    }
    startMock({ scenario: name as MockScenario });
    await startLegacyModelsServer();
});
When('I request chat models', async () => {
    const res = await fetch(`${baseUrl}/chat/models`);
    response = { status: res.status, body: await res.json() };
});
When('I request chat models for provider {string}', async (provider: string) => {
    const res = await fetch(`${baseUrl}/chat/models?provider=${provider}`);
    response = { status: res.status, body: await res.json() };
});
When('I request chat providers', async () => {
    const res = await fetch(`${baseUrl}/chat/providers`);
    response = { status: res.status, body: await res.json() };
});
Then('the chat models response status code is {int}', (status: number) => {
    assert(response, 'expected response');
    assert.equal(response.status, status);
});
Then('the chat providers response status code is {int}', (status: number) => {
    assert(response, 'expected response');
    assert.equal(response.status, status);
});
Then('the chat providers response selected provider is {string}', (provider: string) => {
    assert(response?.body, 'expected response body');
    assert.equal(String((response.body as Record<string, unknown>).selectedProvider), provider);
});
Then('the chat providers response selected endpoint is {string}', (endpoint: string) => {
    assert(response?.body, 'expected response body');
    const selectedEndpointId = String((response.body as Record<string, unknown>).selectedEndpointId ?? '');
    if (endpoint === 'none' || endpoint === 'absent') {
        assert.equal(selectedEndpointId, '');
        return;
    }
    if (endpoint === 'discovered endpoint') {
        assert.equal(selectedEndpointId, discoveredEndpointId);
        return;
    }
    if (endpoint === 'pinned endpoint') {
        assert.equal(selectedEndpointId, pinnedEndpointId);
        return;
    }
    assert.equal(selectedEndpointId, endpoint);
});
Then('the chat models response selected endpoint is {string}', (endpoint: string) => {
    assert(response?.body, 'expected response body');
    const selectedEndpointId = String((response.body as Record<string, unknown>).selectedEndpointId ?? '');
    if (endpoint === 'none' || endpoint === 'absent') {
        assert.equal(selectedEndpointId, '');
        return;
    }
    if (endpoint === 'discovered endpoint') {
        assert.equal(selectedEndpointId, discoveredEndpointId);
        return;
    }
    if (endpoint === 'pinned endpoint') {
        assert.equal(selectedEndpointId, pinnedEndpointId);
        return;
    }
    assert.equal(selectedEndpointId, endpoint);
});
Then('the chat models body matches the mock models fixture ignoring provider metadata', () => {
    assert(response, 'expected response');
    const body = response.body as Record<string, unknown>;
    const normalizeModels = (models: unknown) => Array.isArray(models)
        ? models.map((model) => ({
            key: String((model as Record<string, unknown>).key ?? ''),
            displayName: String((model as Record<string, unknown>).displayName ?? ''),
            type: String((model as Record<string, unknown>).type ?? ''),
            endpointId: (model as Record<string, unknown>).endpointId === undefined
                ? undefined
                : String((model as Record<string, unknown>).endpointId ?? ''),
        }))
        : [];
    const normalizeAgentFlagKeys = (flags: unknown) => Array.isArray(flags)
        ? flags.map((flag) => String((flag as Record<string, unknown>).key ?? ''))
        : [];
    const normalized = {
        provider: String(body.provider ?? ''),
        available: Boolean(body.available),
        toolsAvailable: Boolean(body.toolsAvailable),
        models: normalizeModels(body.models),
        defaultModel: String(body.defaultModel ?? ''),
        defaultModelSource: String(body.defaultModelSource ?? ''),
        agentFlagKeys: normalizeAgentFlagKeys(body.agentFlags),
    };
    const expected = {
        provider: mockModelsResponse.provider,
        available: mockModelsResponse.available,
        toolsAvailable: mockModelsResponse.toolsAvailable,
        models: normalizeModels(mockModelsResponse.models),
        defaultModel: mockModelsResponse.defaultModel,
        defaultModelSource: mockModelsResponse.defaultModelSource,
        agentFlagKeys: normalizeAgentFlagKeys(mockModelsResponse.agentFlags),
    };
    assert.deepStrictEqual(normalized, expected);
});
Then('the chat models response includes provider-neutral providers metadata', () => {
    assert(response?.body, 'expected response body');
    const providers = (response.body as {
        providers?: unknown;
    }).providers;
    assert(Array.isArray(providers), 'expected providers array');
    assert(providers.length > 0, 'expected provider metadata entries');
    for (const provider of providers as Array<Record<string, unknown>>) {
        assert.equal(typeof provider.id, 'string');
        assert.equal(typeof provider.label, 'string');
        assert.equal(typeof provider.available, 'boolean');
        assert.equal(typeof provider.toolsAvailable, 'boolean');
        assert.equal(typeof provider.defaultModel, 'string');
        assert.equal(typeof provider.defaultModelSource, 'string');
    }
});
Then('the LM Studio Agent Flags expose only the first-wave option keys', () => {
    assert(response?.body, 'expected response body');
    const flags = (response.body as {
        agentFlags?: Array<Record<string, unknown>>;
    }).agentFlags;
    assert(Array.isArray(flags), 'expected agentFlags array');
    assert.deepStrictEqual(flags.map((entry) => entry.key), ['temperature', 'maxTokens', 'contextOverflowPolicy', 'toolAccess']);
});
Then('the chat models field {string} equals {string}', (field: string, expected: string) => {
    assert(response?.body, 'expected response body');
    const value = (response.body as Record<string, unknown>)[field];
    assert.equal(String(value), expected);
});
Then('the chat provider {string} is visible with availability {string} and reason {string}', (providerId: string, availability: string, reason: string) => {
    assert(response?.body, 'expected response body');
    const providers = (response.body as {
        providers?: Array<Record<string, unknown>>;
    }).providers;
    assert(Array.isArray(providers), 'expected providers array');
    const provider = providers.find((entry) => entry.id === providerId);
    assert(provider, `expected provider ${providerId}`);
    assert.equal(String(provider.available), availability);
    if (reason === 'none' || reason === 'absent') {
        assert.equal(provider.reason, undefined);
        return;
    }
    assert.equal(String(provider.reason), reason);
});
Then('the chat models response provider is {string}', (provider: string) => {
    assert(response?.body, 'expected response body');
    assert.equal(String((response.body as Record<string, unknown>).provider), provider);
});
Then('the chat models list includes model {string}', (modelKey: string) => {
    assert(response?.body, 'expected response body');
    const models = (response.body as {
        models?: Array<Record<string, unknown>>;
    })
        .models;
    assert(Array.isArray(models), 'expected models array');
    const model = models.find((entry) => entry.key === modelKey);
    assert(model, `expected model ${modelKey}`);
});
Then('the chat models response includes model {string} on endpoint {string}', (modelKey: string, endpoint: string) => {
    assert(response?.body, 'expected response body');
    const models = (response.body as {
        models?: Array<Record<string, unknown>>;
    })
        .models;
    assert(Array.isArray(models), 'expected models array');
    const expectedEndpointId = endpoint === 'discovered endpoint'
        ? discoveredEndpointId
        : endpoint === 'pinned endpoint'
            ? pinnedEndpointId
            : endpoint;
    const model = models.find((entry) => entry.key === modelKey &&
        String((entry as Record<string, unknown>).endpointId ?? '') ===
            String(expectedEndpointId ?? ''));
    assert(model, `expected model ${modelKey}`);
    assert.equal(String((model as Record<string, unknown>).endpointId ?? ''), String(expectedEndpointId ?? ''));
});
Then('the Copilot Cucumber registration log records scenario {string}', (scenarioName: string) => {
    const entries = query({ text: TASK17_LOG_MARKER });
    assert(entries.length > 0, 'expected Task 17 registration log entry');
    const match = entries.find((entry) => entry.context?.scenario === scenarioName);
    assert(match, `expected registration log for ${scenarioName}`);
});
