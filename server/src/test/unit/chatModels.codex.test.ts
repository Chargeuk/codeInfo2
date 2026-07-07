import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';
import { resolveCodexCapabilities, type CodexCapabilityResolution, } from '../../codex/capabilityResolver.js';
import { STORY_47_TASK_1_LOG_MARKER } from '../../config/chatDefaults.js';
import { resolveCodeinfoMcpEndpointContract } from '../../config/mcpEndpoints.js';
import { __resetProviderBootstrapStatusForTests, __setProviderBootstrapStatusForTests, } from '../../config/runtimeConfig.js';
import { baseLogger } from '../../logger.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { resetMcpStatusCache } from '../../providers/mcpStatus.js';
import { createChatModelsRouter } from '../../routes/chatModels.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';
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
const defaultDetection = {
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'not detected',
};
const tempDirs: string[] = [];
const tempExternalServers: Array<{
    stop: () => Promise<void>;
}> = [];
function createClient(models: {
    modelKey: string;
    displayName: string;
    type?: string;
}[]): LMStudioClient {
    return {
        system: {
            listDownloadedModels: async () => models,
        },
    } as LMStudioClient;
}
async function startServer(params: {
    mcpAvailable: boolean;
    clientFactory?: () => LMStudioClient;
    codexCapabilityResolver?: (options: {
        consumer: 'chat_models' | 'chat_validation';
    }) => Promise<CodexCapabilityResolution>;
}) {
    const app = express();
    app.use(express.json());
    app.post('/mcp', (_req, res) => {
        if (params.mcpAvailable) {
            res.json({ result: { ok: true } });
        }
        else {
            res.status(200).json({ error: { message: 'unavailable' } });
        }
    });
    app.use('/chat', createChatModelsRouter({
        clientFactory: params.clientFactory ??
            (() => createClient([{ modelKey: 'm', displayName: 'm' }])),
        codexCapabilityResolver: params.codexCapabilityResolver,
    }));
    const httpServer = http.createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    assert(address && typeof address === 'object');
    env.set('CODEINFO_SERVER_PORT', String(address.port));
    return {
        httpServer,
        baseUrl: `http://127.0.0.1:${address.port}`,
    };
}
async function stopServer(server: {
    httpServer: http.Server;
}) {
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}
async function setCodexHome(chatToml?: string) {
    env.set('CODEINFO_CHAT_DEFAULT_MODEL', undefined);
    env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', undefined);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-chat-models-codex-'));
    tempDirs.push(root);
    const codexHome = path.join(root, 'codex');
    if (chatToml !== undefined) {
        await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
        await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), chatToml, 'utf8');
    }
    env.set('CODEX_HOME', codexHome);
    env.set('CODEINFO_CODEX_HOME', codexHome);
    return {
        codexHome,
        chatConfigPath: path.join(codexHome, 'chat', 'config.toml'),
    };
}
beforeEach(() => {
    resetMcpStatusCache();
    setCodexDetection(defaultDetection);
    __resetProviderBootstrapStatusForTests();
    env.set('CODEX_HOME', undefined);
    env.set('CODEINFO_CODEX_HOME', undefined);
    env.set('CODEINFO_COPILOT_HOME', undefined);
    env.set('CODEINFO_LMSTUDIO_HOME', undefined);
    env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', undefined);
    env.set('CODEINFO_CHAT_DEFAULT_MODEL', undefined);
    env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', undefined);
    env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS', undefined);
});
afterEach(async () => {
    env.restore();
    resetMcpStatusCache();
    setCodexDetection(defaultDetection);
    __resetProviderBootstrapStatusForTests();
    while (tempExternalServers.length > 0) {
        await tempExternalServers.pop()!.stop();
    }
    await Promise.all(tempDirs
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
test('codex env model list parsing surfaces defaults and warnings', async () => {
    await setCodexHome('model = "gamma"\n');
    env.set('Codex_model_list', 'alpha,beta');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.equal(res.body.provider, 'codex');
        assert.equal(res.body.models.length, 3);
        assert.ok(res.body.codexDefaults);
        assert.ok(Array.isArray(res.body.codexWarnings));
    }
    finally {
        await stopServer(server);
    }
});
test('chat models marker emits the shared warning_count and warnings fields with the same values as the REST defaults surface', async () => {
    await setCodexHome();
    env.set('Codex_model_list', 'alpha,beta');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const markerPayloads: Array<Record<string, unknown>> = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
        if (args[0] === STORY_47_TASK_1_LOG_MARKER && args[1]) {
            markerPayloads.push(args[1] as Record<string, unknown>);
        }
    };
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        const marker = markerPayloads.at(-1);
        assert.ok(marker);
        assert.equal(marker.surface, '/chat/models');
        assert.equal(marker.model_source, 'fallback');
        assert.equal(marker.codex_model_source, 'hardcoded');
        assert.equal(marker.warning_count, res.body.codexWarnings.length);
        assert.deepEqual(marker.warnings, res.body.codexWarnings);
    }
    finally {
        console.info = originalInfo;
        await stopServer(server);
    }
});
test('codex models include non-empty supportedReasoningEfforts arrays', async () => {
    env.set('Codex_model_list', 'alpha,beta');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        for (const model of res.body.models as Array<Record<string, unknown>>) {
            assert.equal(model.type, 'codex');
            assert.ok(Array.isArray(model.supportedReasoningEfforts));
            assert.ok(model.supportedReasoningEfforts.length > 0);
            for (const effort of model.supportedReasoningEfforts) {
                assert.equal(typeof effort, 'string');
                assert.ok(effort.length > 0);
            }
        }
    }
    finally {
        await stopServer(server);
    }
});
test('chat models status probes use the shared endpoint contract instead of legacy MCP_URL', async () => {
    env.set('Codex_model_list', 'alpha');
    env.set('MCP_URL', 'http://127.0.0.1:9/legacy-bypass');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    try {
        const endpoints = resolveCodeinfoMcpEndpointContract();
        assert.match(endpoints.classicMcpUrl, /\/mcp$/u);
        assert.notEqual(endpoints.classicMcpUrl, 'http://127.0.0.1:9/legacy-bypass');
        await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
    }
    finally {
        await stopServer(server);
    }
});
test('codex models include defaultReasoningEffort present in supportedReasoningEfforts', async () => {
    env.set('Codex_model_list', 'alpha,beta');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        for (const model of res.body.models as Array<Record<string, unknown>>) {
            const supported = model.supportedReasoningEfforts as string[];
            const defaultEffort = model.defaultReasoningEffort as string;
            assert.equal(typeof defaultEffort, 'string');
            assert.ok(defaultEffort.length > 0);
            assert.ok(supported.includes(defaultEffort));
        }
    }
    finally {
        await stopServer(server);
    }
});
test('chat models payload is derived from the shared capability resolver fixture while normalizing the provider default model to the live list', async () => {
    await setCodexHome('model = "fixture-home-model"\n');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const fixture: CodexCapabilityResolution = {
        defaults: {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'on-failure',
            modelReasoningEffort: 'minimal',
            networkAccessEnabled: true,
            webSearchEnabled: true,
            webSearchMode: 'live',
        },
        models: [
            {
                model: 'fixture-model',
                supportedReasoningEfforts: ['minimal', 'high'],
                defaultReasoningEffort: 'minimal',
            },
        ],
        byModel: new Map([
            [
                'fixture-model',
                {
                    model: 'fixture-model',
                    supportedReasoningEfforts: ['minimal', 'high'],
                    defaultReasoningEffort: 'minimal',
                },
            ],
        ]),
        warnings: ['fixture warning'],
        fallbackUsed: false,
    };
    const server = await startServer({
        mcpAvailable: true,
        codexCapabilityResolver: async () => fixture,
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.deepEqual(res.body.models, [
            {
                key: 'fixture-model',
                displayName: 'fixture-model',
                type: 'codex',
                supportedReasoningEfforts: ['minimal', 'high'],
                defaultReasoningEffort: 'minimal',
                flagOverrides: [
                    {
                        key: 'modelReasoningEffort',
                        resolvedDefault: 'minimal',
                        supportedValues: [
                            { value: 'minimal', label: 'Minimal' },
                            { value: 'high', label: 'High' },
                        ],
                    },
                ],
            },
        ]);
        assert.equal(res.body.providerInfo.id, 'codex');
        assert.equal(res.body.defaultModel, 'fixture-model');
        assert.equal(res.body.defaultModelSource, 'config');
        assert.equal(res.body.compatibility.codexDefaults.webSearchMode, 'live');
    }
    finally {
        await stopServer(server);
    }
});
test('codex response includes defaults and warnings when unavailable', async () => {
    setCodexDetection({
        available: false,
        authPresent: false,
        configPresent: false,
        reason: 'missing-cli',
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.equal(res.body.available, false);
        assert.deepEqual(res.body.models, []);
        assert.ok(res.body.codexDefaults);
        assert.ok(Array.isArray(res.body.codexWarnings));
    }
    finally {
        await stopServer(server);
    }
});
test('codex capability resolver fallback is deterministic when metadata resolution fails', async () => {
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({
        mcpAvailable: true,
        codexCapabilityResolver: async (options) => await resolveCodexCapabilities({
            ...options,
            resolveReasoningEffortsMetadata: () => {
                throw new Error('injected metadata failure');
            },
        }),
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.ok(res.body.models.length > 0);
        for (const model of res.body.models as Array<Record<string, unknown>>) {
            assert.ok(Array.isArray(model.supportedReasoningEfforts));
            assert.ok((model.supportedReasoningEfforts as string[]).length > 0);
            assert.equal(typeof model.defaultReasoningEffort, 'string');
        }
        assert.ok(res.body.codexWarnings.some((warning: string) => warning.includes('fallback capabilities')));
    }
    finally {
        await stopServer(server);
    }
});
test('chat models codexDefaults and warnings come from shared resolver precedence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-task7-models-'));
    const codexHome = path.join(root, 'codex');
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), [
        'sandbox_mode = "workspace-write"',
        'approval_policy = "on-request"',
        'model_reasoning_effort = "medium"',
        'web_search_request = false',
        '',
    ].join('\n'), 'utf8');
    env.set('CODEX_HOME', codexHome);
    env.set('CODEINFO_CODEX_HOME', codexHome);
    env.set('Codex_network_access_enabled', 'false');
    env.set('Codex_model_list', 'alpha');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.equal(res.body.codexDefaults.sandboxMode, 'workspace-write');
        assert.equal(res.body.codexDefaults.approvalPolicy, 'on-request');
        assert.equal(res.body.codexDefaults.modelReasoningEffort, 'medium');
        assert.equal(res.body.codexDefaults.networkAccessEnabled, false);
        assert.equal(res.body.codexDefaults.webSearchEnabled, false);
        assert.equal(res.body.codexDefaults.webSearchMode, 'disabled');
        assert.ok(Array.isArray(res.body.codexWarnings));
    }
    finally {
        await stopServer(server);
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('chat models parity fixture remains deterministic across resolver-backed defaults', async () => {
    const fixture: CodexCapabilityResolution = {
        defaults: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            modelReasoningEffort: 'medium',
            modelReasoningSummary: 'auto',
            modelVerbosity: 'medium',
            networkAccessEnabled: false,
            webSearchEnabled: false,
            webSearchMode: 'live',
        },
        models: [
            {
                model: 'fixture-model',
                supportedReasoningEfforts: ['minimal', 'medium'],
                defaultReasoningEffort: 'medium',
            },
        ],
        byModel: new Map([
            [
                'fixture-model',
                {
                    model: 'fixture-model',
                    supportedReasoningEfforts: ['minimal', 'medium'],
                    defaultReasoningEffort: 'medium',
                },
            ],
        ]),
        warnings: ['fixture warning'],
        fallbackUsed: false,
    };
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({
        mcpAvailable: true,
        codexCapabilityResolver: async () => fixture,
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.deepEqual(res.body.codexDefaults, fixture.defaults);
        assert.ok((res.body.codexWarnings as string[]).includes('fixture warning'));
        assert.equal(res.body.providerInfo.compatibility.codexDefaults.webSearchMode, 'live');
    }
    finally {
        await stopServer(server);
    }
});
test('codex models expose the Story 56 provider-neutral Agent Flags and workspace-write-scoped compatibility details', async () => {
    await setCodexHome([
        'model = "gpt-5.3-codex"',
        'model_reasoning_effort = "high"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        'model_reasoning_summary = "detailed"',
        'model_verbosity = "low"',
        'web_search_mode = "cached"',
        '',
    ].join('\n'));
    env.set('Codex_model_list', 'alpha');
    env.set('Codex_network_access_enabled', 'false');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        const flags = res.body.agentFlags as Array<Record<string, unknown>>;
        const network = flags.find((entry) => entry.key === 'networkAccessEnabled');
        const summary = flags.find((entry) => entry.key === 'modelReasoningSummary');
        const verbosity = flags.find((entry) => entry.key === 'modelVerbosity');
        const webSearch = flags.find((entry) => entry.key === 'webSearchMode');
        assert.equal(res.body.providerInfo.defaultModel, 'gpt-5.3-codex');
        assert.equal(res.body.providerInfo.defaultModelSource, 'config');
        assert.equal(res.body.codexDefaults.sandboxMode, 'workspace-write');
        assert.equal(res.body.codexDefaults.networkAccessEnabled, false);
        assert.equal(res.body.codexDefaults.webSearchMode, 'cached');
        assert.ok(network);
        assert.equal(network.resolvedDefault, false);
        assert.ok(summary);
        assert.equal(summary.resolvedDefault, 'detailed');
        assert.ok(verbosity);
        assert.equal(verbosity.resolvedDefault, 'low');
        assert.ok(webSearch);
        assert.equal(webSearch.resolvedDefault, 'cached');
    }
    finally {
        await stopServer(server);
    }
});
test('codex resolver warnings propagate into codexWarnings', async () => {
    env.set('Codex_network_access_enabled', 'invalid');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.ok(res.body.codexWarnings.some((warning: string) => warning.includes('Codex_network_access_enabled')));
    }
    finally {
        await stopServer(server);
    }
});
test('codex model list CSV trims, drops empties, and de-duplicates', async () => {
    await setCodexHome();
    env.set('Codex_model_list', ' gpt-5.1-codex-max , , gpt-5.1, gpt-5.1 , gpt-5.2 ');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        const modelKeys = res.body.models.map((model: {
            key: string;
        }) => model.key);
        assert.deepEqual(modelKeys, [
            'gpt-5.3-codex',
            'gpt-5.1-codex-max',
            'gpt-5.1',
            'gpt-5.2',
        ]);
    }
    finally {
        await stopServer(server);
    }
});
test('codex model list empty CSV falls back with warning', async () => {
    await setCodexHome();
    env.set('Codex_model_list', ' , , ');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        const modelKeys = res.body.models.map((model: {
            key: string;
        }) => model.key);
        assert.ok(modelKeys.includes('gpt-5.2-codex'));
        assert.ok(res.body.codexWarnings.some((warning: string) => warning.includes('Codex_model_list is empty')));
    }
    finally {
        await stopServer(server);
    }
});
test('codex model list whitespace-only CSV falls back with warning', async () => {
    await setCodexHome();
    env.set('Codex_model_list', '   ');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        const modelKeys = res.body.models.map((model: {
            key: string;
        }) => model.key);
        assert.ok(modelKeys.includes('gpt-5.2-codex'));
        assert.ok(res.body.codexWarnings.some((warning: string) => warning.includes('Codex_model_list is empty')));
    }
    finally {
        await stopServer(server);
    }
});
test('codex runtime warning when web search enabled but tools unavailable', async () => {
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: false });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.ok(res.body.codexWarnings.some((warning: string) => warning.includes('web search is enabled')));
    }
    finally {
        await stopServer(server);
    }
});
test('codex defaults include SDK-native minimal reasoning effort when configured', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-task7-minimal-'));
    const codexHome = path.join(root, 'codex');
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), [
        'sandbox_mode = "workspace-write"',
        'approval_policy = "on-request"',
        '',
    ].join('\n'), 'utf8');
    env.set('CODEX_HOME', codexHome);
    env.set('CODEINFO_CODEX_HOME', codexHome);
    env.set('Codex_reasoning_effort', 'minimal');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.equal(res.body.codexDefaults?.modelReasoningEffort, 'minimal');
    }
    finally {
        await stopServer(server);
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('non-codex provider omits codex defaults fields', async () => {
    env.set('CODEINFO_LMSTUDIO_BASE_URL', 'http://localhost:1234');
    const server = await startServer({
        mcpAvailable: true,
        clientFactory: () => createClient([
            {
                modelKey: 'openai/gpt-oss-20b',
                displayName: 'OpenAI gpt-oss 20B',
                type: 'llm',
            },
        ]),
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=lmstudio')
            .expect(200);
        assert.equal(res.body.provider, 'lmstudio');
        assert.equal(res.body.models.length, 1);
        assert.equal('codexDefaults' in res.body, false);
        assert.equal('codexWarnings' in res.body, false);
        assert.equal('supportedReasoningEfforts' in
            (res.body.models[0] as Record<string, unknown>), false);
        assert.equal('defaultReasoningEffort' in
            (res.body.models[0] as Record<string, unknown>), false);
    }
    finally {
        await stopServer(server);
    }
});
test('lmstudio models prioritize the configured default model from CODEINFO_LMSTUDIO_HOME', async () => {
    env.set('CODEINFO_LMSTUDIO_BASE_URL', 'http://localhost:1234');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-chat-models-lmstudio-'));
    tempDirs.push(root);
    const lmstudioHome = path.join(root, 'lmstudio');
    await fs.mkdir(path.join(lmstudioHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(lmstudioHome, 'chat', 'config.toml'), 'model = "model-b"\n', 'utf8');
    env.set('CODEINFO_LMSTUDIO_HOME', lmstudioHome);
    const server = await startServer({
        mcpAvailable: true,
        clientFactory: () => createClient([
            {
                modelKey: 'model-a',
                displayName: 'Model A',
                type: 'llm',
            },
            {
                modelKey: 'model-b',
                displayName: 'Model B',
                type: 'llm',
            },
        ]),
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=lmstudio')
            .expect(200);
        const modelKeys = res.body.models.map((model: {
            key: string;
        }) => model.key);
        assert.deepEqual(modelKeys, ['model-b', 'model-a']);
    }
    finally {
        await stopServer(server);
    }
});
test('lmstudio discovery normalizes a stale configured default to a live model entry', async () => {
    env.set('CODEINFO_LMSTUDIO_BASE_URL', 'http://localhost:1234');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-chat-models-lmstudio-stale-default-'));
    tempDirs.push(root);
    const lmstudioHome = path.join(root, 'lmstudio');
    await fs.mkdir(path.join(lmstudioHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(lmstudioHome, 'chat', 'config.toml'), 'model = "model-1"\n', 'utf8');
    env.set('CODEINFO_LMSTUDIO_HOME', lmstudioHome);
    const server = await startServer({
        mcpAvailable: true,
        clientFactory: () => createClient([
            {
                modelKey: 'model-a',
                displayName: 'Model A',
                type: 'llm',
            },
            {
                modelKey: 'model-b',
                displayName: 'Model B',
                type: 'llm',
            },
        ]),
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=lmstudio')
            .expect(200);
        const modelKeys = res.body.models.map((model: {
            key: string;
        }) => model.key);
        assert.deepEqual(modelKeys, ['model-a', 'model-b']);
        assert.equal(res.body.defaultModel, 'model-a');
        assert.equal(res.body.providerInfo.defaultModel, 'model-a');
        assert.notEqual(res.body.defaultModel, 'model-1');
    }
    finally {
        await stopServer(server);
    }
});
test('lmstudio discovery surfaces only bounded resolved defaults from provider-local config', async () => {
    env.set('CODEINFO_LMSTUDIO_BASE_URL', 'http://localhost:1234');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-chat-models-lmstudio-bounded-'));
    tempDirs.push(root);
    const lmstudioHome = path.join(root, 'lmstudio');
    await fs.mkdir(path.join(lmstudioHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(lmstudioHome, 'chat', 'config.toml'), [
        'model = "model-a"',
        'temperature = 4',
        'max_tokens = 0',
        'context_overflow_policy = "rollingWindow"',
        'tool_access = "off"',
        '',
    ].join('\n'), 'utf8');
    env.set('CODEINFO_LMSTUDIO_HOME', lmstudioHome);
    const server = await startServer({
        mcpAvailable: true,
        clientFactory: () => createClient([
            {
                modelKey: 'model-a',
                displayName: 'Model A',
                type: 'llm',
            },
        ]),
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=lmstudio')
            .expect(200);
        const agentFlags = res.body.agentFlags as Array<Record<string, unknown>>;
        const temperature = agentFlags.find((entry) => entry.key === 'temperature');
        const maxTokens = agentFlags.find((entry) => entry.key === 'maxTokens');
        const contextOverflowPolicy = agentFlags.find((entry) => entry.key === 'contextOverflowPolicy');
        const toolAccess = agentFlags.find((entry) => entry.key === 'toolAccess');
        assert.equal(temperature?.resolvedDefault, 0.2);
        assert.equal(maxTokens?.resolvedDefault, 4096);
        assert.equal(contextOverflowPolicy?.resolvedDefault, 'rollingWindow');
        assert.equal(toolAccess?.resolvedDefault, 'off');
    }
    finally {
        await stopServer(server);
    }
});
test('lmstudio models route degrades malformed chat defaults to warnings instead of failing discovery', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-chat-models-lmstudio-malformed-'));
    tempDirs.push(root);
    const lmstudioHome = path.join(root, 'lmstudio');
    await fs.mkdir(path.join(lmstudioHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(lmstudioHome, 'chat', 'config.toml'), 'tool_access = [\n', 'utf8');
    env.set('CODEINFO_LMSTUDIO_HOME', lmstudioHome);
    env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
    const server = await startServer({
        mcpAvailable: true,
        clientFactory: () => createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=lmstudio')
            .expect(200);
        assert.equal(res.body.provider, 'lmstudio');
        assert.equal(res.body.available, true);
        assert.equal(res.body.defaultModel, 'model-1');
        assert.equal(res.body.defaultModelSource, 'hardcoded');
        assert.deepEqual(res.body.agentFlags.map((entry: {
            key: string;
            resolvedDefault: unknown;
        }) => ({
            key: entry.key,
            resolvedDefault: entry.resolvedDefault,
        })), [
            { key: 'temperature', resolvedDefault: 0.2 },
            { key: 'maxTokens', resolvedDefault: 4096 },
            { key: 'contextOverflowPolicy', resolvedDefault: 'truncateMiddle' },
            { key: 'toolAccess', resolvedDefault: 'on' },
        ]);
        assert.match((res.body.warnings ?? []).join('\n'), /agentFlags resolution/i);
    }
    finally {
        await stopServer(server);
    }
});
test('codex models route includes external responses endpoints and filters out unsupported capability endpoints', async () => {
    const responsesServer = await startExternalOpenAiCompatServer({
        models: ['external-alpha'],
    });
    const completionsServer = await startExternalOpenAiCompatServer({
        models: ['external-beta'],
    });
    tempExternalServers.push(responsesServer, completionsServer);
    env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', [
        `${responsesServer.baseUrl}/v1|responses`,
        `${completionsServer.baseUrl}/v1|completions`,
        '',
    ].join(';'));
    env.set('Codex_model_list', 'builtin-a,builtin-b');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        const modelKeys = res.body.models.map((model: {
            key: string;
        }) => model.key);
        assert.ok(modelKeys.includes('external-alpha'));
        assert.equal(modelKeys.includes('external-beta'), false);
        assert.equal((res.body.models as Array<Record<string, unknown>>).find((model) => model.key === 'external-alpha')?.type, 'codex');
    }
    finally {
        await stopServer(server);
    }
});
test('codex models route preserves duplicate raw model ids and the selected endpoint identity', async () => {
    const firstServer = await startExternalOpenAiCompatServer({
        models: ['shared-model'],
    });
    const secondServer = await startExternalOpenAiCompatServer({
        models: ['shared-model'],
    });
    tempExternalServers.push(firstServer, secondServer);
    env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', [
        `${firstServer.baseUrl}/v1|responses`,
        `${secondServer.baseUrl}/v1|responses`,
    ].join(';'));
    await setCodexHome([
        'model = "shared-model"',
        `codeinfo_openai_endpoint = "${secondServer.baseUrl}/v1|responses"`,
        '',
    ].join('\n'));
    env.set('Codex_model_list', 'builtin-a');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        const sharedModels = (res.body.models as Array<Record<string, unknown>>).filter((model) => model.key === 'shared-model');
        const sharedEndpointIds = sharedModels
            .map((model) => String(model.endpointId ?? ''))
            .filter((endpointId) => endpointId.length > 0);
        assert.ok(sharedModels.length >= 2);
        assert.equal(res.body.defaultModel, 'shared-model');
        assert.equal(res.body.defaultModelSource, 'config');
        assert.equal(res.body.selectedEndpointId, `${secondServer.baseUrl}/v1`);
        assert.equal(sharedModels[0]?.endpointId, `${secondServer.baseUrl}/v1`);
        assert.ok(sharedEndpointIds.includes(`${firstServer.baseUrl}/v1`));
        assert.ok(sharedEndpointIds.includes(`${secondServer.baseUrl}/v1`));
        assert.equal(sharedModels[0]?.type, 'codex');
        assert.ok(sharedModels.some((model) => model.type === 'codex'));
    }
    finally {
        await stopServer(server);
    }
});
test('codex models route serves endpoint-only models when Codex auth is missing', async () => {
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['endpoint-codex-model'],
    });
    tempExternalServers.push(externalServer);
    env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', `${externalServer.baseUrl}/v1|responses`);
    setCodexDetection({
        available: false,
        authPresent: false,
        configPresent: true,
        cliPath: '/usr/bin/codex',
        reason: 'Missing auth.json in /tmp/codex',
    });
    const server = await startServer({ mcpAvailable: true });
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.equal(res.body.provider, 'codex');
        assert.equal(res.body.available, true);
        assert.equal(res.body.toolsAvailable, true);
        assert.equal(res.body.reason, undefined);
        assert.equal(res.body.providerInfo.endpointOnly, true);
        assert.deepEqual(res.body.models, [
            {
                key: 'endpoint-codex-model',
                displayName: 'endpoint-codex-model',
                type: 'codex',
                endpointId: `${externalServer.baseUrl}/v1`,
            },
        ]);
        assert.equal(res.body.providerInfo.defaultModel, 'endpoint-codex-model');
        assert.match((res.body.warnings ?? []).join('\n'), /Codex authentication is unavailable; showing external OpenAI-compatible endpoint models only\./u);
    }
    finally {
        await stopServer(server);
    }
});
test('codex models route keeps degraded bootstrap unavailable even when authless endpoint models exist', async () => {
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['endpoint-codex-model'],
    });
    tempExternalServers.push(externalServer);
    env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', `${externalServer.baseUrl}/v1|responses`);
    setCodexDetection({
        available: false,
        authPresent: false,
        configPresent: true,
        cliPath: '/usr/bin/codex',
        reason: 'Missing auth.json in /tmp/codex',
    });
    __setProviderBootstrapStatusForTests('codex', {
        healthy: false,
        reason: 'codex bootstrap degraded',
        warnings: ['codex bootstrap degraded warning'],
    });
    const server = await startServer({ mcpAvailable: true });
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.equal(res.body.available, false);
        assert.equal(res.body.toolsAvailable, false);
        assert.equal(res.body.reason, 'codex bootstrap degraded');
        assert.equal(res.body.providerInfo.endpointOnly, false);
        assert.deepEqual(res.body.models, []);
        assert.equal((res.body.warnings ?? []).some((warning: string) => warning.includes('authentication is unavailable')), false);
    }
    finally {
        await stopServer(server);
    }
});
test('codex models route clears stale endpoint identity when the default normalizes back to native', async () => {
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['shared-model'],
    });
    tempExternalServers.push(externalServer);
    await setCodexHome([
        'model = "builtin-a"',
        `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses"`,
        '',
    ].join('\n'));
    env.set('Codex_model_list', 'builtin-a,builtin-b');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.equal(res.body.defaultModel, 'builtin-a');
        assert.equal(res.body.defaultModelSource, 'config');
        assert.equal(res.body.selectedEndpointId, undefined);
        const nativeModel = (res.body.models as Array<Record<string, unknown>>).find((model) => model.key === 'builtin-a');
        assert.ok(nativeModel);
        assert.equal(nativeModel?.endpointId, undefined);
        assert.equal(nativeModel?.type, 'codex');
    }
    finally {
        await stopServer(server);
    }
});
test('codex models route promotes a pinned endpoint-backed default once and removes the plain duplicate', async () => {
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['unsloth/gemma-4-26B-A4B-it-qat-GGUF'],
    });
    tempExternalServers.push(externalServer);
    await setCodexHome([
        'model = "unsloth/gemma-4-26b-A4b-it-qat-GGUF"',
        `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses"`,
        '',
    ].join('\n'));
    env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', `SparkUnsloth,${externalServer.baseUrl}/v1|responses`);
    env.set('Codex_model_list', 'unsloth/gemma-4-26b-A4b-it-qat-GGUF,builtin-a');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        const matchingModels = (res.body.models as Array<Record<string, unknown>>).filter((model) => String(model.key ?? '').trim().toLowerCase() ===
            'unsloth/gemma-4-26b-a4b-it-qat-gguf');
        assert.equal(res.body.defaultModel, 'unsloth/gemma-4-26B-A4B-it-qat-GGUF');
        assert.equal(res.body.defaultModelSource, 'config');
        assert.equal(res.body.selectedEndpointId, `${externalServer.baseUrl}/v1`);
        assert.equal(matchingModels.length, 1);
        assert.equal(matchingModels[0]?.key, 'unsloth/gemma-4-26B-A4B-it-qat-GGUF');
        assert.equal(matchingModels[0]?.endpointId, `${externalServer.baseUrl}/v1`);
        assert.equal(res.body.models[0]?.key, 'unsloth/gemma-4-26B-A4B-it-qat-GGUF');
        assert.equal(res.body.models[0]?.endpointId, `${externalServer.baseUrl}/v1`);
    }
    finally {
        await stopServer(server);
    }
});
test('codex models route keeps normalized duplicate endpoint warnings out of the response while preserving them in logs', async (t) => {
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['alpha'],
    });
    tempExternalServers.push(externalServer);
    await setCodexHome([
        'model = "alpha"',
        `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses"`,
        '',
    ].join('\n'));
    env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', `SparkUnsloth,${externalServer.baseUrl}/v1|responses`);
    env.set('Codex_model_list', 'alpha,builtin-a');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const markerPayloads: Array<Record<string, unknown>> = [];
    let server: Awaited<ReturnType<typeof startServer>> | null = null;
    try {
        server = await startServer({ mcpAvailable: true });
        env.set('MCP_URL', `${server.baseUrl}/mcp`);
        t.mock.method(console, 'info', (...args: unknown[]) => {
            if (args[0] === STORY_47_TASK_1_LOG_MARKER && args[1]) {
                markerPayloads.push(args[1] as Record<string, unknown>);
            }
        });
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.equal((res.body.codexWarnings as string[]).some((warning) => warning.includes('Skipping config-pinned endpoint')), false);
        assert.equal((res.body.warnings as string[]).some((warning) => warning.includes('Skipping config-pinned endpoint')), false);
        const marker = markerPayloads.at(-1);
        assert.ok(marker);
        assert.equal((marker.warnings as string[]).some((warning) => warning.includes('Skipping config-pinned endpoint')), true);
    }
    finally {
        if (server) {
            await stopServer(server);
        }
    }
});
test('codex models route uses the configured endpoint label in endpoint-backed display names', async () => {
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['shared-model'],
    });
    tempExternalServers.push(externalServer);
    env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', `OpenRouter,${externalServer.baseUrl}/v1|responses`);
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        const endpointBackedModel = (res.body.models as Array<Record<string, unknown>>).find((model) => model.key === 'shared-model' &&
            model.endpointId === `${externalServer.baseUrl}/v1`);
        assert.ok(endpointBackedModel);
        assert.equal(endpointBackedModel?.displayName, 'OpenRouter / shared-model');
    }
    finally {
        await stopServer(server);
    }
});
test('emits deterministic T12 success log when codex capabilities are returned', async (t) => {
    env.set('Codex_model_list', 'alpha,beta');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const infoLines: string[] = [];
    const errorLines: string[] = [];
    t.mock.method(baseLogger, 'info', (...args: unknown[]) => {
        const message = args.find((arg) => typeof arg === 'string') as string | undefined;
        if (message)
            infoLines.push(message);
    });
    t.mock.method(baseLogger, 'error', (...args: unknown[]) => {
        const message = args.find((arg) => typeof arg === 'string') as string | undefined;
        if (message)
            errorLines.push(message);
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.ok(infoLines.some((line) => line.includes('[DEV-0000037][T12] event=chat_models_codex_capabilities_returned result=success')));
        assert.equal(errorLines.some((line) => line.includes('[DEV-0000037][T12] event=chat_models_codex_capabilities_returned result=error')), false);
    }
    finally {
        await stopServer(server);
    }
});
test('emits deterministic T13 success log when shared resolver is consumed by /chat/models', async (t) => {
    env.set('Codex_model_list', 'alpha,beta');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const infoLines: string[] = [];
    t.mock.method(baseLogger, 'info', (...args: unknown[]) => {
        const message = args.find((arg) => typeof arg === 'string') as string | undefined;
        if (message)
            infoLines.push(message);
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.ok(infoLines.some((line) => line.includes('[DEV-0000037][T13] event=shared_capability_resolver_parity_enforced result=success')));
    }
    finally {
        await stopServer(server);
    }
});
test('emits deterministic T12 error log when codex is unavailable', async (t) => {
    setCodexDetection({
        available: false,
        authPresent: false,
        configPresent: false,
        reason: 'missing-cli',
    });
    const errorLines: string[] = [];
    t.mock.method(baseLogger, 'error', (...args: unknown[]) => {
        const message = args.find((arg) => typeof arg === 'string') as string | undefined;
        if (message)
            errorLines.push(message);
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.ok(errorLines.some((line) => line.includes('[DEV-0000037][T12] event=chat_models_codex_capabilities_returned result=error')));
    }
    finally {
        await stopServer(server);
    }
});
test('emits deterministic T13 error log when shared resolver metadata path fails intentionally', async (t) => {
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const errorLines: string[] = [];
    t.mock.method(baseLogger, 'error', (...args: unknown[]) => {
        const message = args.find((arg) => typeof arg === 'string') as string | undefined;
        if (message)
            errorLines.push(message);
    });
    const server = await startServer({
        mcpAvailable: true,
        codexCapabilityResolver: (options) => resolveCodexCapabilities({
            ...options,
            resolveReasoningEffortsMetadata: () => {
                throw new Error('injected metadata failure');
            },
        }),
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.ok(errorLines.some((line) => line.includes('[DEV-0000037][T13] event=shared_capability_resolver_parity_enforced result=error')));
    }
    finally {
        await stopServer(server);
    }
});
test('codex payload includes non-standard reasoning effort values from shared capability resolver', async () => {
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const fixture: CodexCapabilityResolution = {
        defaults: {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'on-failure',
            modelReasoningEffort: 'high',
            networkAccessEnabled: true,
            webSearchEnabled: true,
            webSearchMode: 'live',
        },
        models: [
            {
                model: 'future-model',
                supportedReasoningEfforts: ['minimal', 'turbo'],
                defaultReasoningEffort: 'turbo',
            },
        ],
        byModel: new Map([
            [
                'future-model',
                {
                    model: 'future-model',
                    supportedReasoningEfforts: ['minimal', 'turbo'],
                    defaultReasoningEffort: 'turbo',
                },
            ],
        ]),
        warnings: [],
        fallbackUsed: false,
    };
    const server = await startServer({
        mcpAvailable: true,
        codexCapabilityResolver: async () => fixture,
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.deepEqual(res.body.models[0].supportedReasoningEfforts, [
            'minimal',
            'turbo',
        ]);
        assert.equal(res.body.models[0].defaultReasoningEffort, 'turbo');
    }
    finally {
        await stopServer(server);
    }
});
test('codex models prioritize CODEINFO_CHAT_DEFAULT_MODEL when codex is default provider', async () => {
    await setCodexHome('model = "config-model"\n');
    env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'codex');
    env.set('CODEINFO_CHAT_DEFAULT_MODEL', 'gpt-5.1');
    env.set('Codex_model_list', 'config-model,gpt-5.1,gpt-5.2');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        const modelKeys = res.body.models.map((model: {
            key: string;
        }) => model.key);
        assert.equal(modelKeys[0], 'config-model');
    }
    finally {
        await stopServer(server);
    }
});
test('chat models route returns the merged codex model list while keeping the existing payload shape', async () => {
    await setCodexHome('model = "gamma"\n');
    env.set('Codex_model_list', 'alpha,beta');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.equal(res.body.provider, 'codex');
        assert.equal(typeof res.body.available, 'boolean');
        assert.equal(typeof res.body.toolsAvailable, 'boolean');
        assert.ok(Array.isArray(res.body.models));
        assert.deepEqual(res.body.models.map((model: {
            key: string;
        }) => model.key), ['gamma', 'alpha', 'beta']);
    }
    finally {
        await stopServer(server);
    }
});
test('chat models route rereads codex chat config between requests', async () => {
    const { chatConfigPath } = await setCodexHome('model = "first-model"\n');
    env.set('Codex_model_list', 'alpha,beta');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const server = await startServer({ mcpAvailable: true });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const first = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        await fs.writeFile(chatConfigPath, 'model = "second-model"\n', 'utf8');
        const second = await request(server.httpServer)
            .get('/chat/models?provider=codex')
            .expect(200);
        assert.equal(first.body.models[0].key, 'first-model');
        assert.equal(second.body.models[0].key, 'second-model');
    }
    finally {
        await stopServer(server);
    }
});
test('lmstudio models mark provider unavailable when no chat-capable model is returned', async () => {
    env.set('CODEINFO_LMSTUDIO_BASE_URL', 'http://localhost:1234');
    const server = await startServer({
        mcpAvailable: true,
        clientFactory: () => createClient([
            {
                modelKey: 'embed-1',
                displayName: 'Embedding Model',
                type: 'embedding',
            },
        ]),
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    try {
        const res = await request(server.httpServer)
            .get('/chat/models?provider=lmstudio')
            .expect(503);
        assert.equal(res.body.provider, 'lmstudio');
        assert.equal(res.body.available, false);
        assert.equal(res.body.toolsAvailable, false);
        assert.equal(res.body.reason, 'lmstudio unavailable');
        assert.equal(res.body.models.length, 0);
    }
    finally {
        await stopServer(server);
    }
});
