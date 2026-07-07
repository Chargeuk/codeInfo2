import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import type { CodexOptions, ThreadEvent, ThreadOptions as CodexThreadOptions, TurnOptions as CodexTurnOptions, } from '@openai/codex-sdk';
import { resolveCodexCapabilities } from '../../codex/capabilityResolver.js';
import { applyCodexOpenAiCompatEndpointToRuntimeConfig, } from '../../config/codexConfig.js';
import { RuntimeConfigResolutionError } from '../../config/runtimeConfig.js';
import { handleRpc } from '../../mcp2/router.js';
import { runCodebaseQuestion } from '../../mcp2/tools/codebaseQuestion.js';
import { resetToolDeps, setToolDeps } from '../../mcp2/tools.js';
import { getCodexDetection, setCodexDetection, } from '../../providers/codexRegistry.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';
async function withTempCodexHome(chatToml: string): Promise<{
    codexHome: string;
    cleanup: () => Promise<void>;
}> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-mcp-wrapper-'));
    const codexHome = path.join(root, 'codex');
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), chatToml, 'utf8');
    return {
        codexHome,
        cleanup: async () => {
            await fs.rm(root, { recursive: true, force: true });
        },
    };
}
class MockThread {
    id: string;
    private readonly events: ThreadEvent[];
    constructor(id: string, events: ThreadEvent[]) {
        this.id = id;
        this.events = events;
    }
    async runStreamed(input: string, opts?: CodexTurnOptions): Promise<{
        events: AsyncGenerator<ThreadEvent>;
    }> {
        void input;
        void opts;
        const events = this.events;
        async function* generator(): AsyncGenerator<ThreadEvent> {
            for (const ev of events) {
                yield ev;
            }
        }
        return { events: generator() };
    }
}
class MockCodex {
    lastStartOptions: CodexThreadOptions | undefined;
    startThread(opts?: CodexThreadOptions) {
        this.lastStartOptions = opts;
        const events: ThreadEvent[] = [
            {
                type: 'item.updated',
                item: { type: 'reasoning', text: 'Thinking about the repo' },
            } as unknown as ThreadEvent,
            {
                type: 'item.completed',
                item: {
                    type: 'mcp_tool_call',
                    id: 'tool-1',
                    server: 'codeinfo_host',
                    tool: 'VectorSearch',
                    arguments: { query: 'hello', limit: 3 },
                    status: 'completed',
                    name: 'VectorSearch',
                    result: {
                        content: [
                            {
                                type: 'application/json',
                                json: {
                                    results: [
                                        {
                                            repo: 'repo',
                                            relPath: 'src/index.ts',
                                            hostPath: '/host/repo/src/index.ts',
                                            score: 0.9,
                                            chunk: 'line1\nline2',
                                            chunkId: 'c1',
                                            modelId: 'embed-1',
                                        },
                                    ],
                                    files: [
                                        {
                                            hostPath: '/host/repo/src/index.ts',
                                            highestMatch: 0.9,
                                            chunkCount: 1,
                                            lineCount: 2,
                                            repo: 'repo',
                                            modelId: 'embed-1',
                                        },
                                    ],
                                    modelId: 'embed-1',
                                },
                            },
                        ],
                    },
                },
            } as unknown as ThreadEvent,
            {
                type: 'item.completed',
                item: { type: 'agent_message', text: 'Here you go' },
            } as unknown as ThreadEvent,
            {
                type: 'turn.completed',
            } as unknown as ThreadEvent,
        ];
        return new MockThread('thread-wrapper', events);
    }
    resumeThread(threadId: string, opts?: CodexThreadOptions) {
        void threadId;
        void opts;
        return this.startThread();
    }
}
type JsonRpcErrorResponse = {
    jsonrpc: string;
    id: number;
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
};
const makeLmStudioClientFactory = () => () => ({
    system: {
        listDownloadedModels: async () => [],
    },
}) as unknown as import('@lmstudio/sdk').LMStudioClient;
const ENV_KEYS = [
    'CODEINFO_CHAT_DEFAULT_PROVIDER',
    'CODEINFO_CHAT_DEFAULT_MODEL',
    'CODEINFO_CODEX_HOME',
    'CODEX_HOME',
    'MCP_FORCE_CODEX_AVAILABLE',
] as const;
const originalEnv = new Map<string, string | undefined>();
const defaultCodexHome = path.resolve(process.cwd(), '../codex');
beforeEach(() => {
    originalEnv.clear();
    for (const key of ENV_KEYS) {
        originalEnv.set(key, process.env[key]);
        clearScopedTestEnvValue(key);
    }
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", defaultCodexHome);
    setScopedTestEnvValue("CODEX_HOME", defaultCodexHome);
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
});
afterEach(() => {
    for (const key of ENV_KEYS) {
        const value = originalEnv.get(key);
        if (value === undefined) {
            clearScopedTestEnvValue(key);
        }
        else {
            setScopedTestEnvValue(key, value);
        }
    }
    originalEnv.clear();
});
test('MCP responder returns answer-only segments', async () => {
    const prev = getCodexDetection();
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalDefaultModel = process.env.CODEINFO_CHAT_DEFAULT_MODEL;
    clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
    clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL");
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    try {
        const result = await runCodebaseQuestion({ question: 'What is up?' }, {
            codexFactory: () => new MockCodex(),
            clientFactory: makeLmStudioClientFactory(),
        });
        const payload = JSON.parse(result.content[0].text);
        assert.ok(typeof payload.conversationId === 'string');
        assert.ok(payload.conversationId.startsWith('codex-thread-'));
        assert.ok(typeof payload.modelId === 'string');
        assert.ok(payload.modelId.length > 0);
        assert.deepEqual(payload.segments.map((s: {
            type: string;
        }) => s.type), ['answer']);
        assert.equal(payload.segments[0].text, 'Here you go');
    }
    finally {
        if (originalDefaultProvider === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalDefaultProvider);
        }
        if (originalDefaultModel === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL", originalDefaultModel);
        }
        setCodexDetection(prev);
    }
});
test('MCP responder only returns the final answer segment', async () => {
    const prev = getCodexDetection();
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    try {
        const result = await runCodebaseQuestion({ question: 'Second run' }, {
            codexFactory: () => new MockCodex(),
            clientFactory: makeLmStudioClientFactory(),
        });
        const payload = JSON.parse(result.content[0].text);
        const segments = payload.segments as Array<{
            type: string;
            [key: string]: unknown;
        }>;
        assert.deepEqual(segments.map((s) => s.type), ['answer']);
        assert.deepEqual(Object.keys(segments[0]).sort(), ['text', 'type']);
    }
    finally {
        setCodexDetection(prev);
    }
});
test('MCP responder payload reports the chat-config-aware default model when no override is supplied', async () => {
    const prev = getCodexDetection();
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    const tempHome = await withTempCodexHome('model = "config-model"\n');
    setScopedTestEnvValue("CODEX_HOME", tempHome.codexHome);
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", tempHome.codexHome);
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    try {
        const result = await runCodebaseQuestion({ question: 'Use config default please' }, {
            codexFactory: () => new MockCodex(),
            clientFactory: makeLmStudioClientFactory(),
        });
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.modelId, 'config-model');
    }
    finally {
        setCodexDetection(prev);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        if (originalCodeinfoHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeinfoHome);
        }
        await tempHome.cleanup();
    }
});
test('MCP codebase_question uses shared resolver defaults for thread options', async () => {
    const prev = getCodexDetection();
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const mockCodex = new MockCodex();
    try {
        await runCodebaseQuestion({ question: 'Use shared defaults please' }, {
            codexFactory: () => mockCodex,
            clientFactory: makeLmStudioClientFactory(),
        });
        const capabilities = await resolveCodexCapabilities({
            consumer: 'chat_validation',
            codexHome: process.env.CODEX_HOME,
        });
        assert.equal(mockCodex.lastStartOptions?.sandboxMode, capabilities.defaults.sandboxMode);
        assert.equal(mockCodex.lastStartOptions?.networkAccessEnabled, capabilities.defaults.networkAccessEnabled);
        assert.equal(mockCodex.lastStartOptions?.webSearchEnabled, capabilities.defaults.webSearchEnabled);
        assert.equal(mockCodex.lastStartOptions?.approvalPolicy, capabilities.defaults.approvalPolicy);
        assert.equal(mockCodex.lastStartOptions?.modelReasoningEffort, capabilities.defaults.modelReasoningEffort);
    }
    finally {
        setCodexDetection(prev);
    }
});
test('MCP codebase_question passes resolved chat runtime config to Codex', async () => {
    const prev = getCodexDetection();
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const mockCodex = new MockCodex();
    let capturedOptions: CodexOptions | undefined;
    const runtimeConfig = {
        model: 'openai/gpt-oss-20b',
        model_provider: 'vllm',
        model_providers: {
            vllm: {
                name: 'vLLM Local',
                base_url: 'http://localhost:8000/v1',
                wire_api: 'responses',
            },
        },
    };
    try {
        const result = await runCodebaseQuestion({ question: 'Use runtime config please' }, {
            codexFactory: (options?: CodexOptions) => {
                capturedOptions = options;
                return mockCodex;
            },
            clientFactory: makeLmStudioClientFactory(),
            chatRuntimeConfigResolver: async () => ({
                config: runtimeConfig,
                warnings: [],
            }),
        });
        const payload = JSON.parse(result.content[0].text) as {
            modelId: string;
        };
        assert.deepEqual(capturedOptions?.config, {
            ...runtimeConfig,
            model: payload.modelId,
        });
    }
    finally {
        setCodexDetection(prev);
    }
});
async function postJson<T>(port: number, body: unknown): Promise<T> {
    const payload = JSON.stringify(body);
    return await new Promise<T>((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'POST',
            agent: false,
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
                connection: 'close',
            },
        });
        let responseBody = '';
        req.on('response', (response) => {
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                responseBody += chunk;
            });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(responseBody) as T);
                }
                catch (error) {
                    reject(error);
                }
            });
            response.on('error', reject);
        });
        req.on('error', reject);
        req.end(payload);
    });
}
test('MCP JSON-RPC error shape remains stable for invalid params', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const response = await postJson<JsonRpcErrorResponse>(port, {
            jsonrpc: '2.0',
            id: 99,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: { question: '' },
            },
        });
        assert.equal(response.jsonrpc, '2.0');
        assert.equal(response.id, 99);
        assert.equal(response.error.code, -32602);
        assert.equal(response.error.message, 'Invalid params');
    }
    finally {
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('MCP JSON-RPC returns a typed tool error when chat runtime config resolution fails', async () => {
    const prev = getCodexDetection();
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    setToolDeps({
        clientFactory: makeLmStudioClientFactory(),
        chatRuntimeConfigResolver: async () => {
            throw new RuntimeConfigResolutionError({
                code: 'RUNTIME_CONFIG_INVALID',
                configPath: '/tmp/codeinfo-chat-config.toml',
                surface: 'chat',
                message: 'chat runtime config is invalid',
            });
        },
    });
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const response = await postJson<JsonRpcErrorResponse>(port, {
            jsonrpc: '2.0',
            id: 100,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: { question: 'Hello' },
            },
        });
        assert.equal(response.jsonrpc, '2.0');
        assert.equal(response.id, 100);
        assert.equal(response.error.code, -32002);
        assert.equal(response.error.message, 'CODE_INFO_CHAT_CONFIG_INVALID');
        assert.deepEqual(response.error.data, {
            code: 'RUNTIME_CONFIG_INVALID',
            surface: 'chat',
            configPath: '/tmp/codeinfo-chat-config.toml',
        });
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        setCodexDetection(prev);
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('MCP codebase_question preserves generated Codex OpenAI-compatible provider metadata through the wrapper path', async () => {
    const prev = getCodexDetection();
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
    });
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['google/gemma-4-26b-a4b-qat'],
    });
    const tempHome = await withTempCodexHome([
        'model = "google/gemma-4-26b-a4b-qat"',
        `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses"`,
        '',
    ].join('\n'));
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", tempHome.codexHome);
    setScopedTestEnvValue("CODEX_HOME", tempHome.codexHome);
    const mockCodex = new MockCodex();
    let capturedOptions: CodexOptions | undefined;
    const expectedConfig = applyCodexOpenAiCompatEndpointToRuntimeConfig({
        model: 'google/gemma-4-26b-a4b-qat',
    }, {
        endpointId: `${externalServer.baseUrl}/v1`,
        baseUrl: `${externalServer.baseUrl}/v1`,
        capabilities: ['responses'],
    })!;
    try {
        await runCodebaseQuestion({ question: 'Use the pinned endpoint through the wrapper' }, {
            codexFactory: (options?: CodexOptions) => {
                capturedOptions = options;
                return mockCodex;
            },
            clientFactory: makeLmStudioClientFactory(),
        });
        assert.deepEqual(capturedOptions?.config, expectedConfig);
    }
    finally {
        resetToolDeps();
        setCodexDetection(prev);
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined) {
            clearScopedTestEnvValue("CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        }
        if (originalCodeinfoHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeinfoHome);
        }
        await externalServer.stop();
        await tempHome.cleanup();
    }
});
