import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach, mock } from 'node:test';
import type { ModelInfo } from '@github/copilot-sdk';
import type { CodexOptions } from '@openai/codex-sdk';
import { ChromaClient } from 'chromadb';
import { resolveAgentHomeEnv } from '../../../agents/roots.js';
import { getChatInterface } from '../../../chat/factory.js';
import { __resetCompletedInflightForTests } from '../../../chat/inflightRegistry.js';
import { ChatInterface } from '../../../chat/interfaces/ChatInterface.js';
import { ChatInterfaceCopilot } from '../../../chat/interfaces/ChatInterfaceCopilot.js';
import { getMemoryTurns, memoryConversations, memoryTurns, recordMemoryTurn, } from '../../../chat/memoryPersistence.js';
import { McpResponder } from '../../../chat/responders/McpResponder.js';
import { resolveChatDefaults } from '../../../config/chatDefaults.js';
import { applyCodexOpenAiCompatEndpointToRuntimeConfig } from '../../../config/codexConfig.js';
import { resetCollectionsForTests } from '../../../ingest/chromaClient.js';
import type { RepoEntry } from '../../../lmstudio/toolService.js';
import { query, resetStore } from '../../../logStore.js';
import { handleRpc } from '../../../mcp2/router.js';
import { __deleteCodebaseQuestionMemoryConversationForTests, __setCodebaseQuestionMemoryConversationForTests, } from '../../../mcp2/tools/codebaseQuestion.js';
import { resetToolDeps, setToolDeps } from '../../../mcp2/tools.js';
import type { Conversation } from '../../../mongo/conversation.js';
import { ConversationModel } from '../../../mongo/conversation.js';
import { withConversationMetaNotFoundFixture } from '../../support/conversationMetaNotFoundFixture.js';
import { withMockedMongoConversationPersistence } from '../../support/conversationMongoPersistenceStub.js';
import { startExternalOpenAiCompatServer } from '../../support/externalOpenAiCompatServer.js';
import { createMockCopilotSdkHarness, createSessionIdleEvent, } from '../../support/mockCopilotSdk.js';
const ENV_KEYS = [
    'CODEINFO_CHAT_DEFAULT_PROVIDER',
    'CODEINFO_CHAT_DEFAULT_MODEL',
    'CODEINFO_COPILOT_HOME',
    'CODEINFO_CODEX_HOME',
    'CODEX_HOME',
    'CODEINFO_CODEX_WORKDIR',
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    'MCP_FORCE_CODEX_AVAILABLE',
] as const;
const originalEnv = new Map<string, string | undefined>();
const defaultCodexHome = path.resolve(process.cwd(), '../codex');
const setCodexHomes = (codexHome: string) => {
    setScopedTestEnvValue("CODEX_HOME", codexHome);
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", codexHome);
};
beforeEach(() => {
    mock.restoreAll();
    resetCollectionsForTests();
    originalEnv.clear();
    for (const key of ENV_KEYS) {
        originalEnv.set(key, process.env[key]);
        clearScopedTestEnvValue(key);
    }
    setCodexHomes(defaultCodexHome);
});
afterEach(() => {
    mock.restoreAll();
    resetCollectionsForTests();
    resetToolDeps();
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
    __resetCompletedInflightForTests();
    memoryConversations.clear();
    memoryTurns.clear();
});
type ThreadEvent = {
    type: string;
    item?: Record<string, unknown>;
    thread_id?: string;
};
class MockThread {
    id: string;
    constructor(id: string) {
        this.id = id;
    }
    async runStreamed() {
        const threadId = this.id;
        async function* generator(): AsyncGenerator<ThreadEvent> {
            yield { type: 'thread.started', thread_id: threadId };
            yield {
                type: 'item.updated',
                item: { type: 'reasoning', text: 'Thinking about the repo' },
            };
            yield {
                type: 'item.completed',
                item: {
                    type: 'mcp_tool_call',
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
            };
            yield {
                type: 'item.completed',
                item: { type: 'agent_message', text: 'Here you go' },
            };
            yield { type: 'turn.completed', thread_id: threadId };
        }
        return { events: generator() };
    }
}
class MockCodex {
    lastStartOptions?: unknown;
    lastResumeOptions?: unknown;
    lastResumeId?: string;
    threadId: string;
    constructor(id = 'thread-abc') {
        this.threadId = id;
    }
    startThread(opts?: unknown) {
        this.lastStartOptions = opts;
        return new MockThread(this.threadId);
    }
    resumeThread(threadId: string, opts?: unknown) {
        this.lastResumeId = threadId;
        this.lastResumeOptions = opts;
        return new MockThread(threadId);
    }
}
class ThrowingBannerOnlyThread {
    async runStreamed(): Promise<{
        events: AsyncGenerator<unknown>;
    }> {
        throw new Error('Codex Exec exited with code 1: Reading prompt from stdin...');
    }
}
class ThrowingBannerOnlyCodex {
    startThread() {
        return new ThrowingBannerOnlyThread();
    }
    resumeThread() {
        return new ThrowingBannerOnlyThread();
    }
}
class EmitsSpecificErrorThenThrowsBannerChat extends ChatInterface {
    async execute() {
        this.emit('thread', { type: 'thread', threadId: 'thread-specific-error' });
        this.emit('error', {
            type: 'error',
            message: 'stream disconnected before completion: stream closed before response.completed',
        });
        throw new Error('Codex Exec exited with code 1: Reading prompt from stdin...');
    }
}
class CapturingSelectionChat extends ChatInterface {
    constructor(private readonly calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
        model: string;
    }>, private readonly finalContent: string) {
        super();
    }
    async execute(_message: string, flags: Record<string, unknown>, conversationId: string, model: string) {
        void _message;
        this.calls.push({ flags, conversationId, model });
        this.emit('thread', { type: 'thread', threadId: conversationId });
        this.emit('final', { type: 'final', content: this.finalContent });
        this.emit('complete', { type: 'complete', threadId: conversationId });
    }
}
class BlockingReplayThread {
    id: string;
    private answerText: string;
    private onStarted: () => void;
    private releasePromise: Promise<void>;
    constructor(params: {
        id: string;
        answerText: string;
        onStarted: () => void;
        releasePromise: Promise<void>;
    }) {
        this.id = params.id;
        this.answerText = params.answerText;
        this.onStarted = params.onStarted;
        this.releasePromise = params.releasePromise;
    }
    async runStreamed() {
        const threadId = this.id;
        const answerText = this.answerText;
        const onStarted = this.onStarted;
        const releasePromise = this.releasePromise;
        async function* generator(): AsyncGenerator<ThreadEvent> {
            yield { type: 'thread.started', thread_id: threadId };
            onStarted();
            yield {
                type: 'item.completed',
                item: { type: 'agent_message', text: answerText },
            };
            await releasePromise;
            yield { type: 'turn.completed', thread_id: threadId };
        }
        return { events: generator() };
    }
}
class DivergentReplayCodex extends MockCodex {
    runs = 0;
    private readonly providerThreadId: string;
    private waitForStartPromise: Promise<void> | null = null;
    private resolveStarted: (() => void) | null = null;
    private releaseCurrentRun: (() => void) | null = null;
    constructor(providerThreadId = 'provider-thread-xyz') {
        super(providerThreadId);
        this.providerThreadId = providerThreadId;
    }
    override startThread(opts?: unknown) {
        this.lastStartOptions = opts;
        this.runs += 1;
        return this.createThread();
    }
    override resumeThread(threadId: string, opts?: unknown) {
        this.lastResumeId = threadId;
        this.lastResumeOptions = opts;
        this.runs += 1;
        return this.createThread();
    }
    async waitForRunStart() {
        while (!this.waitForStartPromise) {
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
        await this.waitForStartPromise;
    }
    releaseRun() {
        if (!this.releaseCurrentRun) {
            throw new Error('releaseRun called before a run started');
        }
        this.releaseCurrentRun();
    }
    private createThread() {
        const shouldBlock = this.runs === 1;
        let releasePromise = Promise.resolve();
        this.waitForStartPromise = new Promise<void>((resolve) => {
            this.resolveStarted = resolve;
        });
        if (shouldBlock) {
            let resolveRelease: (() => void) | null = null;
            releasePromise = new Promise<void>((resolve) => {
                resolveRelease = resolve;
            });
            this.releaseCurrentRun = resolveRelease;
        }
        else {
            this.releaseCurrentRun = () => { };
        }
        return new BlockingReplayThread({
            id: this.providerThreadId,
            answerText: `Codex replay answer ${this.runs}`,
            onStarted: () => {
                this.resolveStarted?.();
            },
            releasePromise,
        });
    }
}
type JsonRpcHttpResponse = {
    id?: number | string | null;
    result?: {
        content: Array<{
            type: string;
            text: string;
        }>;
    };
    error?: {
        code: number;
        message: string;
    };
};
const makeLmStudioClientFactory = () => () => ({
    system: {
        listDownloadedModels: async () => [],
    },
}) as never;
async function withTempCodexHome(params: {
    chatToml: string;
    baseToml?: string;
}): Promise<{
    codexHome: string;
    cleanup: () => Promise<void>;
}> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-task8-happy-'));
    const codexHome = path.join(root, 'codex');
    if (params.baseToml !== undefined) {
        await fs.mkdir(codexHome, { recursive: true });
        await fs.writeFile(path.join(codexHome, 'config.toml'), params.baseToml, 'utf8');
    }
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), params.chatToml, 'utf8');
    return {
        codexHome,
        cleanup: async () => {
            await fs.rm(root, { recursive: true, force: true });
        },
    };
}
async function withTempCopilotHome(chatToml: string): Promise<{
    copilotHome: string;
    cleanup: () => Promise<void>;
}> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-task8-copilot-'));
    const copilotHome = path.join(root, 'copilot');
    await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(copilotHome, 'chat', 'config.toml'), chatToml, 'utf8');
    return {
        copilotHome,
        cleanup: async () => {
            await fs.rm(root, { recursive: true, force: true });
        },
    };
}
const toComparableJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
class CapturingChat extends ChatInterface {
    lastFlags?: Record<string, unknown>;
    async execute(_message: string, flags: Record<string, unknown>, conversationId: string, model: string): Promise<void> {
        void conversationId;
        void model;
        this.lastFlags = flags;
        this.emit('thread', { type: 'thread', threadId: 'captured-thread' });
        this.emit('final', { type: 'final', content: 'Captured answer' });
        this.emit('complete', { type: 'complete', threadId: 'captured-thread' });
    }
}
const buildRepoEntry = (containerPath: string): RepoEntry => ({
    id: path.basename(containerPath) || 'repo',
    description: null,
    containerPath,
    hostPath: containerPath,
    lastIngestAt: '2025-01-01T00:00:00.000Z',
    embeddingProvider: 'lmstudio',
    embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
    embeddingDimensions: 768,
    modelId: 'text-embedding-nomic-embed-text-v1.5',
    counts: { files: 0, chunks: 0, embedded: 0 },
    lastError: null,
});
class BlockingReplayClaimChat extends ChatInterface {
    runs = 0;
    private waitForStartPromise: Promise<void> | null = null;
    private resolveStarted: (() => void) | null = null;
    private releaseCurrentRun: (() => void) | null = null;
    async waitForRunStart() {
        while (!this.waitForStartPromise) {
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
        await this.waitForStartPromise;
    }
    releaseRun() {
        if (!this.releaseCurrentRun) {
            throw new Error('releaseRun called before a run started');
        }
        this.releaseCurrentRun();
    }
    async execute(message: string, flags: Record<string, unknown>, conversationId: string, model: string): Promise<void> {
        void flags;
        void model;
        this.runs += 1;
        this.waitForStartPromise = new Promise<void>((resolve) => {
            this.resolveStarted = resolve;
        });
        const shouldBlock = this.runs === 1;
        const releasePromise = shouldBlock
            ? new Promise<void>((resolve) => {
                this.releaseCurrentRun = resolve;
            })
            : Promise.resolve();
        if (!shouldBlock) {
            this.releaseCurrentRun = () => { };
        }
        this.emit('thread', {
            type: 'thread',
            threadId: conversationId,
        });
        this.resolveStarted?.();
        await releasePromise;
        this.emit('final', {
            type: 'final',
            content: `Replay answer ${this.runs}: ${message}`,
        });
        this.emit('complete', {
            type: 'complete',
            threadId: conversationId,
        });
    }
}
async function postJson(port: number, body: unknown) {
    const payload = JSON.stringify(body);
    return await new Promise<JsonRpcHttpResponse>((resolve, reject) => {
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
                    resolve(JSON.parse(responseBody));
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
async function runCodebaseQuestion(args: Record<string, unknown>, deps?: Parameters<typeof setToolDeps>[0]) {
    if (deps) {
        setToolDeps({
            clientFactory: makeLmStudioClientFactory(),
            ...deps,
        });
    }
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const response = await postJson(port, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: args,
            },
        });
        assert.ok(response.result);
        return response.result;
    }
    finally {
        resetToolDeps();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
}
test('codebase_question returns answer-only payloads and preserves conversationId', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    resetStore();
    const mockCodex = new MockCodex('thread-abc');
    setToolDeps({
        codexFactory: () => mockCodex,
        clientFactory: makeLmStudioClientFactory(),
    });
    const tempHome = await withTempCodexHome({
        chatToml: [
            'model = "gpt-5.3-codex-spark"',
            'sandbox_mode = "workspace-write"',
            'approval_policy = "on-request"',
            'model_reasoning_effort = "minimal"',
            'web_search_mode = "disabled"',
            '',
        ].join('\n'),
    });
    setCodexHomes(tempHome.codexHome);
    setScopedTestEnvValue("Codex_network_access_enabled", 'false');
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const firstCall = await postJson(port, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: { question: 'What is up?' },
            },
        });
        assert.ok(firstCall.result);
        assert.equal(firstCall.result.content[0].type, 'text');
        const firstPayload = JSON.parse(firstCall.result.content[0].text);
        const defaults = resolveChatDefaults({ requestProvider: 'codex' });
        assert.ok(firstPayload.conversationId.startsWith('codex-thread-'));
        assert.equal(firstPayload.modelId, defaults.model);
        assert.deepEqual(firstPayload.segments.map((s: {
            type: string;
        }) => s.type), ['answer']);
        assert.equal(memoryConversations.get(firstPayload.conversationId)?.flags?.threadId, 'thread-abc');
        assert.equal(firstPayload.segments[0].text, 'Here you go');
        const secondCall = await postJson(port, {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'And next?',
                    conversationId: firstPayload.conversationId,
                },
            },
        });
        assert.ok(secondCall.result);
        const secondPayload = JSON.parse(secondCall.result.content[0].text);
        assert.equal(secondPayload.conversationId, firstPayload.conversationId);
        assert.equal(mockCodex.lastResumeId, 'thread-abc');
        assert.equal((mockCodex.lastStartOptions as {
            sandboxMode?: string;
        }).sandboxMode, 'workspace-write');
        assert.equal((mockCodex.lastStartOptions as {
            approvalPolicy?: string;
        })
            .approvalPolicy, 'on-request');
        assert.equal((mockCodex.lastStartOptions as {
            modelReasoningEffort?: string;
        })
            .modelReasoningEffort, 'minimal');
        assert.equal((mockCodex.lastStartOptions as {
            webSearchEnabled?: boolean;
        })
            .webSearchEnabled, false);
        const markerLogs = query({
            source: ['server'],
            text: 'DEV_0000040_T08_MCP_DEFAULTS_APPLIED',
        });
        assert.ok(markerLogs.length > 0);
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        clearScopedTestEnvValue("Codex_network_access_enabled");
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('codebase_question reuses saved selected-repository metadata when provider is omitted', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-question-working-folder-'));
    const chat = new CapturingChat();
    const conversationId = 'mcp-working-folder-selected';
    const expectedRepoRoot = resolveAgentHomeEnv().codeInfoRoot;
    const originalForceAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeInfoCodeHome = process.env.CODEINFO_CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'codex');
    const tempHome = await withTempCodexHome({
        chatToml: 'model = "gpt-5.3-codex"\n',
    });
    setCodexHomes(tempHome.codexHome);
    __setCodebaseQuestionMemoryConversationForTests({
        _id: conversationId,
        provider: 'codex',
        model: 'gpt-5.3-codex',
        title: 'Saved MCP conversation',
        source: 'MCP',
        flags: { workingFolder: repoRoot },
        lastMessageAt: new Date(),
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    } as Conversation);
    try {
        await runCodebaseQuestion({
            question: 'Use the saved repo context',
            conversationId,
        }, {
            chatFactory: () => chat,
            clientFactory: makeLmStudioClientFactory(),
            listIngestedRepositoriesFn: async () => ({
                repos: [buildRepoEntry(repoRoot)],
                lockedModelId: null,
            }),
        });
        assert.deepEqual(chat.lastFlags?.runtime, {
            workingFolder: repoRoot,
            lookupSummary: {
                selectedRepositoryPath: repoRoot,
                fallbackUsed: false,
                workingRepositoryAvailable: true,
            },
        });
        assert.deepEqual(chat.lastFlags?.repositoryContext, {
            selectedRepositoryPath: repoRoot,
            defaultExecutionRoot: expectedRepoRoot,
            workingDirectoryOverride: repoRoot,
            fallbackUsed: false,
            workingRepositoryAvailable: true,
        });
    }
    finally {
        __deleteCodebaseQuestionMemoryConversationForTests(conversationId);
        if (originalForceAvailable === undefined) {
            clearScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE");
        }
        else {
            setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", originalForceAvailable);
        }
        if (originalCodeHome === undefined) {
            clearScopedTestEnvValue("CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        }
        if (originalCodeInfoCodeHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeInfoCodeHome);
        }
        await tempHome.cleanup();
        await fs.rm(repoRoot, { recursive: true, force: true });
    }
});
test('codebase_question restores a saved host path before local mount lookup when using default repository discovery', async () => {
    const missingHostPath = path.join(os.tmpdir(), `codebase-question-host-only-${Date.now()}`, 'repo-root');
    const chat = new CapturingChat();
    const conversationId = 'mcp-working-folder-default-discovery';
    const originalForceAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeInfoCodeHome = process.env.CODEINFO_CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'codex');
    const tempHome = await withTempCodexHome({
        chatToml: 'model = "gpt-5.3-codex"\n',
    });
    setCodexHomes(tempHome.codexHome);
    __setCodebaseQuestionMemoryConversationForTests({
        _id: conversationId,
        provider: 'codex',
        model: 'gpt-5.3-codex',
        title: 'Saved host-path conversation',
        source: 'MCP',
        flags: { workingFolder: missingHostPath },
        lastMessageAt: new Date(),
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    } as Conversation);
    mock.method(ChromaClient.prototype, 'getOrCreateCollection', async (opts: {
        name?: string;
    }) => {
        if (opts.name === 'ingest_roots') {
            return {
                get: async () => ({
                    ids: ['repo-1'],
                    metadatas: [
                        {
                            root: missingHostPath,
                            lastIngestAt: '2025-01-01T00:00:00.000Z',
                        },
                    ],
                }),
            } as never;
        }
        return {
            metadata: {},
            count: async () => 0,
            modify: async () => { },
        } as never;
    });
    try {
        await runCodebaseQuestion({
            question: 'Use the saved host path repo context',
            conversationId,
        }, {
            chatFactory: () => chat,
            clientFactory: makeLmStudioClientFactory(),
        });
        assert.deepEqual(chat.lastFlags?.runtime, {
            workingFolder: path.resolve(missingHostPath),
            lookupSummary: {
                selectedRepositoryPath: path.resolve(missingHostPath),
                fallbackUsed: false,
                workingRepositoryAvailable: true,
            },
        });
        assert.equal(memoryConversations.get(conversationId)?.flags?.workingFolder, missingHostPath);
    }
    finally {
        __deleteCodebaseQuestionMemoryConversationForTests(conversationId);
        if (originalForceAvailable === undefined) {
            clearScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE");
        }
        else {
            setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", originalForceAvailable);
        }
        if (originalCodeHome === undefined) {
            clearScopedTestEnvValue("CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        }
        if (originalCodeInfoCodeHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeInfoCodeHome);
        }
        await tempHome.cleanup();
    }
});
test('codebase_question uses the shared default execution root when no working_folder is selected', async () => {
    const chat = new CapturingChat();
    const expectedRepoRoot = resolveAgentHomeEnv().codeInfoRoot;
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'lmstudio');
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/mounted/default-root');
    try {
        await runCodebaseQuestion({
            question: 'Use the default repo context',
        }, {
            chatFactory: () => chat,
            clientFactory: makeLmStudioClientFactory(),
        });
        assert.deepEqual(chat.lastFlags?.runtime, {
            lookupSummary: {
                selectedRepositoryPath: expectedRepoRoot,
                fallbackUsed: true,
                workingRepositoryAvailable: false,
            },
        });
        assert.deepEqual(chat.lastFlags?.repositoryContext, {
            selectedRepositoryPath: expectedRepoRoot,
            defaultExecutionRoot: expectedRepoRoot,
            workingDirectoryOverride: expectedRepoRoot,
            fallbackUsed: true,
            workingRepositoryAvailable: false,
        });
    }
    finally {
        clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
    }
});
test('codebase_question forwards CODEINFO_ROOT into the Codex runtime environment', async () => {
    const originalForceAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeInfoCodeHome = process.env.CODEINFO_CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    const expectedRepoRoot = resolveAgentHomeEnv().codeInfoRoot;
    const tempHome = await withTempCodexHome({
        chatToml: 'model = "gpt-5.3-codex"\n',
    });
    setCodexHomes(tempHome.codexHome);
    let capturedOptions: CodexOptions | undefined;
    try {
        await runCodebaseQuestion({
            question: 'Forward CODEINFO_ROOT for Codex.',
            provider: 'codex',
        }, {
            codexFactory: (options?: CodexOptions) => {
                capturedOptions = options;
                return new MockCodex('thread-codeinfo-root');
            },
            clientFactory: makeLmStudioClientFactory(),
        });
        assert.equal(capturedOptions?.env?.CODEINFO_ROOT, expectedRepoRoot);
    }
    finally {
        if (originalForceAvailable === undefined) {
            clearScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE");
        }
        else {
            setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", originalForceAvailable);
        }
        if (originalCodeHome === undefined) {
            clearScopedTestEnvValue("CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        }
        if (originalCodeInfoCodeHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeInfoCodeHome);
        }
        await tempHome.cleanup();
    }
});
test('codebase_question uses the configured repository root for omitted-provider current-repo file questions', async () => {
    class CurrentRepoChat extends ChatInterface {
        lastFlags?: Record<string, unknown>;
        async execute(_message: string, flags: Record<string, unknown>, conversationId: string, _model: string) {
            void _model;
            this.lastFlags = flags;
            const repositoryContext = flags.repositoryContext as {
                selectedRepositoryPath?: string;
            } | undefined;
            const selectedRepositoryPath = repositoryContext?.selectedRepositoryPath ?? '';
            const agentsPath = path.join(selectedRepositoryPath, 'AGENTS.md');
            const exists = await fs
                .access(agentsPath)
                .then(() => true)
                .catch(() => false);
            this.emit('thread', { type: 'thread', threadId: conversationId });
            this.emit('final', {
                type: 'final',
                content: exists ? `Found ${agentsPath}` : 'AGENTS missing',
            });
            this.emit('complete', { type: 'complete', threadId: conversationId });
        }
    }
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
    const originalAgentHome = process.env.CODEINFO_AGENT_HOME;
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-question-current-repo-'));
    const agentHome = path.join(repoRoot, 'codeinfo_agents');
    const chat = new CurrentRepoChat();
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'lmstudio');
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/mounted/default-root');
    setScopedTestEnvValue("CODEINFO_AGENT_HOME", agentHome);
    await fs.mkdir(agentHome, { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'AGENTS.md'), '# temp repo\n', 'utf8');
    const originalError = console.error;
    const errorLogs: string[] = [];
    console.error = (...args: unknown[]) => {
        errorLogs.push(args.map(String).join(' '));
    };
    try {
        const result = await runCodebaseQuestion({
            question: 'What does AGENTS.md say in the current repository?',
        }, {
            chatFactory: () => chat,
            clientFactory: makeLmStudioClientFactory(),
        });
        assert.match(result.content[0].text, /Found .*AGENTS\.md/);
        assert.deepEqual(chat.lastFlags?.runtime, {
            lookupSummary: {
                selectedRepositoryPath: repoRoot,
                fallbackUsed: true,
                workingRepositoryAvailable: false,
            },
        });
        assert.deepEqual(chat.lastFlags?.repositoryContext, {
            selectedRepositoryPath: repoRoot,
            defaultExecutionRoot: repoRoot,
            workingDirectoryOverride: repoRoot,
            fallbackUsed: true,
            workingRepositoryAvailable: false,
        });
        assert.equal(errorLogs.length, 0, 'did not expect raw stderr debug logging on successful codebase_question repository resolution');
    }
    finally {
        console.error = originalError;
        if (originalDefaultProvider === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalDefaultProvider);
        }
        if (originalWorkdir === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", originalWorkdir);
        }
        if (originalAgentHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_AGENT_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_AGENT_HOME", originalAgentHome);
        }
        await fs.rm(repoRoot, { recursive: true, force: true });
    }
});
test('codebase_question uses the configured repository root for explicit-provider current-repo file questions', async () => {
    class CurrentRepoChat extends ChatInterface {
        lastFlags?: Record<string, unknown>;
        async execute(_message: string, flags: Record<string, unknown>, conversationId: string, _model: string) {
            void _model;
            this.lastFlags = flags;
            const repositoryContext = flags.repositoryContext as {
                selectedRepositoryPath?: string;
            } | undefined;
            const selectedRepositoryPath = repositoryContext?.selectedRepositoryPath ?? '';
            const agentsPath = path.join(selectedRepositoryPath, 'AGENTS.md');
            const exists = await fs
                .access(agentsPath)
                .then(() => true)
                .catch(() => false);
            this.emit('thread', { type: 'thread', threadId: conversationId });
            this.emit('final', {
                type: 'final',
                content: exists ? `Found ${agentsPath}` : 'AGENTS missing',
            });
            this.emit('complete', { type: 'complete', threadId: conversationId });
        }
    }
    const originalWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
    const originalAgentHome = process.env.CODEINFO_AGENT_HOME;
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-question-current-repo-explicit-'));
    const agentHome = path.join(repoRoot, 'codeinfo_agents');
    const chat = new CurrentRepoChat();
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/mounted/default-root');
    setScopedTestEnvValue("CODEINFO_AGENT_HOME", agentHome);
    await fs.mkdir(agentHome, { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'AGENTS.md'), '# temp repo\n', 'utf8');
    try {
        const result = await runCodebaseQuestion({
            question: 'What does AGENTS.md say in the current repository?',
            provider: 'codex',
        }, {
            chatFactory: () => chat,
            clientFactory: makeLmStudioClientFactory(),
        });
        assert.match(result.content[0].text, /Found .*AGENTS\.md/);
        assert.deepEqual(chat.lastFlags?.runtime, {
            lookupSummary: {
                selectedRepositoryPath: repoRoot,
                fallbackUsed: true,
                workingRepositoryAvailable: false,
            },
        });
        assert.deepEqual(chat.lastFlags?.repositoryContext, {
            selectedRepositoryPath: repoRoot,
            defaultExecutionRoot: repoRoot,
            workingDirectoryOverride: repoRoot,
            fallbackUsed: true,
            workingRepositoryAvailable: false,
        });
    }
    finally {
        if (originalWorkdir === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", originalWorkdir);
        }
        if (originalAgentHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_AGENT_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_AGENT_HOME", originalAgentHome);
        }
        await fs.rm(repoRoot, { recursive: true, force: true });
    }
});
test('codebase_question current-repo fallback does not claim repo-root files when the configured repository root lacks AGENTS.md', async () => {
    class CurrentRepoChat extends ChatInterface {
        lastFlags?: Record<string, unknown>;
        async execute(_message: string, flags: Record<string, unknown>, conversationId: string, _model: string) {
            void _model;
            this.lastFlags = flags;
            const repositoryContext = flags.repositoryContext as {
                selectedRepositoryPath?: string;
            } | undefined;
            const selectedRepositoryPath = repositoryContext?.selectedRepositoryPath ?? '';
            const agentsPath = path.join(selectedRepositoryPath, 'AGENTS.md');
            const exists = await fs
                .access(agentsPath)
                .then(() => true)
                .catch(() => false);
            this.emit('thread', { type: 'thread', threadId: conversationId });
            this.emit('final', {
                type: 'final',
                content: exists ? `Found ${agentsPath}` : `Missing ${agentsPath}`,
            });
            this.emit('complete', { type: 'complete', threadId: conversationId });
        }
    }
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
    const originalAgentHome = process.env.CODEINFO_AGENT_HOME;
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-question-current-repo-missing-'));
    const agentHome = path.join(repoRoot, 'codeinfo_agents');
    const chat = new CurrentRepoChat();
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'lmstudio');
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/mounted/default-root');
    setScopedTestEnvValue("CODEINFO_AGENT_HOME", agentHome);
    await fs.mkdir(agentHome, { recursive: true });
    try {
        const result = await runCodebaseQuestion({
            question: 'What does AGENTS.md say in the current repository?',
        }, {
            chatFactory: () => chat,
            clientFactory: makeLmStudioClientFactory(),
        });
        assert.match(result.content[0].text, /Missing .*AGENTS\.md/);
        assert.deepEqual(chat.lastFlags?.runtime, {
            lookupSummary: {
                selectedRepositoryPath: repoRoot,
                fallbackUsed: true,
                workingRepositoryAvailable: false,
            },
        });
        assert.deepEqual(chat.lastFlags?.repositoryContext, {
            selectedRepositoryPath: repoRoot,
            defaultExecutionRoot: repoRoot,
            workingDirectoryOverride: repoRoot,
            fallbackUsed: true,
            workingRepositoryAvailable: false,
        });
    }
    finally {
        if (originalDefaultProvider === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalDefaultProvider);
        }
        if (originalWorkdir === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", originalWorkdir);
        }
        if (originalAgentHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_AGENT_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_AGENT_HOME", originalAgentHome);
        }
        await fs.rm(repoRoot, { recursive: true, force: true });
    }
});
test('codebase_question reuses shared provider defaults when provider copilot is selected', async () => {
    const originalHome = process.env.CODEINFO_COPILOT_HOME;
    const tempHome = await withTempCopilotHome(['model = "copilot-default-model"', 'tool_access = "off"', ''].join('\n'));
    setScopedTestEnvValue("CODEINFO_COPILOT_HOME", tempHome.copilotHome);
    const chat = new CapturingChat();
    try {
        const result = await runCodebaseQuestion({ question: 'copilot defaults?', provider: 'copilot' }, {
            chatFactory: () => chat,
            copilotReadinessResolver: async () => ({
                available: true,
                toolsAvailable: true,
                blockingStage: 'ready',
                models: ['copilot-default-model'],
                modelsRaw: [],
                authSource: 'env-token',
            }),
        });
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.modelId, 'copilot-default-model');
    }
    finally {
        resetToolDeps();
        if (originalHome === undefined)
            clearScopedTestEnvValue("CODEINFO_COPILOT_HOME");
        else
            setScopedTestEnvValue("CODEINFO_COPILOT_HOME", originalHome);
        await tempHome.cleanup();
    }
});
test('codebase_question forwards external endpoint metadata on the Copilot MCP path and persists the endpoint identity', async () => {
    const originalHome = process.env.CODEINFO_COPILOT_HOME;
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['google/gemma-4-26b-a4b-qat'],
    });
    const tempHome = await withTempCopilotHome([
        'model = "google/gemma-4-26b-a4b-qat"',
        'tool_access = "off"',
        `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses,completions"`,
        '',
    ].join('\n'));
    setScopedTestEnvValue("CODEINFO_COPILOT_HOME", tempHome.copilotHome);
    const chat = new CapturingChat();
    const conversationId = 'mcp-copilot-endpoint-persisted';
    try {
        const result = await runCodebaseQuestion({
            question: 'Use the endpoint-backed Copilot path.',
            conversationId,
            provider: 'copilot',
        }, {
            chatFactory: () => chat,
            copilotReadinessResolver: async () => ({
                available: true,
                toolsAvailable: true,
                blockingStage: 'ready',
                models: ['copilot-gpt-5'],
                modelsRaw: [],
                authSource: 'env-token',
            }),
        });
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.modelId, 'google/gemma-4-26b-a4b-qat');
        assert.deepEqual(chat.lastFlags?.codeinfoOpenAiEndpoint, {
            endpointId: `${externalServer.baseUrl}/v1`,
            baseUrl: `${externalServer.baseUrl}/v1`,
            capabilities: ['responses', 'completions'],
        });
        assert.equal(memoryConversations.get(conversationId)?.flags?.endpointId, `${externalServer.baseUrl}/v1`);
    }
    finally {
        resetToolDeps();
        if (originalHome === undefined)
            clearScopedTestEnvValue("CODEINFO_COPILOT_HOME");
        else
            setScopedTestEnvValue("CODEINFO_COPILOT_HOME", originalHome);
        memoryConversations.delete(conversationId);
        memoryTurns.delete(conversationId);
        await externalServer.stop();
        await tempHome.cleanup();
    }
});
test('codebase_question reuses one durable Copilot replay claim before completion and keeps a fresh replayId on the fresh path', async () => {
    const chat = new BlockingReplayClaimChat();
    const deps = {
        chatFactory: () => chat,
        copilotReadinessResolver: async () => ({
            available: true,
            toolsAvailable: true,
            blockingStage: 'ready' as const,
            models: ['copilot-gpt-5'],
            modelsRaw: [],
            authSource: 'env-token' as const,
        }),
    };
    const firstResultPromise = runCodebaseQuestion({
        question: 'first logical follow-up',
        conversationId: 'mcp-replay-happy-1',
        replayId: 'replay-1',
        provider: 'copilot',
        model: 'copilot-gpt-5',
    }, deps);
    await chat.waitForRunStart();
    const sameReplayResult = await runCodebaseQuestion({
        question: 'contradictory stale retry',
        conversationId: 'mcp-replay-happy-1',
        replayId: 'replay-1',
        provider: 'copilot',
        model: 'copilot-gpt-5',
    }, deps);
    const sameReplayPayload = JSON.parse(sameReplayResult.content[0].text);
    assert.equal(chat.runs, 1);
    assert.equal(sameReplayPayload.conversationId, 'mcp-replay-happy-1');
    assert.equal(sameReplayPayload.replay?.replayId, 'replay-1');
    assert.equal(sameReplayPayload.replay?.status, 'in_progress');
    assert.equal(sameReplayPayload.modelId, 'copilot-gpt-5');
    chat.releaseRun();
    const firstResult = await firstResultPromise;
    const firstPayload = JSON.parse(firstResult.content[0].text);
    assert.equal(firstPayload.replay?.status, 'completed');
    const freshReplayResult = await runCodebaseQuestion({
        question: 'fresh logical follow-up',
        conversationId: 'mcp-replay-happy-1',
        replayId: 'replay-2',
        provider: 'copilot',
        model: 'copilot-gpt-5',
    }, deps);
    const freshReplayPayload = JSON.parse(freshReplayResult.content[0].text);
    assert.equal(chat.runs, 2);
    assert.equal(freshReplayPayload.conversationId, 'mcp-replay-happy-1');
    assert.equal(freshReplayPayload.segments[0].text, 'Replay answer 2: fresh logical follow-up');
    assert.equal(freshReplayPayload.replay?.status, 'completed');
    const completedReplayResult = await runCodebaseQuestion({
        question: 'late stale retry',
        conversationId: 'mcp-replay-happy-1',
        replayId: 'replay-1',
        provider: 'copilot',
        model: 'copilot-gpt-5',
    }, deps);
    const completedReplayPayload = JSON.parse(completedReplayResult.content[0].text);
    assert.deepEqual(completedReplayPayload, firstPayload);
});
test('codebase_question keeps the same caller-visible replay result after the completed cache is cleared while incomplete persisted replay state stays reader-visible instead of rebuilding provider work', async () => {
    resetStore();
    const conversationId = 'mcp-replay-durable-1';
    const replayId = 'replay-durable-1';
    const chatCalls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
        model: string;
    }> = [];
    const chat = new CapturingSelectionChat(chatCalls, 'Durable replay answer from persisted assistant turn');
    const deps = {
        chatFactory: () => chat,
        copilotReadinessResolver: async () => ({
            available: true,
            toolsAvailable: true,
            blockingStage: 'ready' as const,
            models: ['copilot-gpt-5'],
            modelsRaw: [],
            authSource: 'env-token' as const,
        }),
    };
    const firstResult = await runCodebaseQuestion({
        question: 'first durable replay follow-up',
        conversationId,
        replayId,
        provider: 'copilot',
        model: 'copilot-gpt-5',
    }, deps);
    const firstPayload = JSON.parse(firstResult.content[0].text);
    const persistedTurns = getMemoryTurns(conversationId);
    const persistedUserTurn = persistedTurns.find((turn) => turn.role === 'user');
    const persistedAssistantTurn = persistedTurns.find((turn) => turn.role === 'assistant');
    assert.equal(persistedUserTurn?.runtime?.replay?.completed, false, JSON.stringify(persistedTurns, null, 2));
    assert.equal(persistedAssistantTurn?.runtime?.replay?.completed, true, JSON.stringify(persistedTurns, null, 2));
    __resetCompletedInflightForTests();
    const replayAfterCacheClear = await runCodebaseQuestion({
        question: 'contradictory retry after completed cache clear',
        conversationId,
        replayId,
        provider: 'copilot',
        model: 'copilot-gpt-5',
    }, {
        chatFactory: () => {
            throw new Error('replay should not rebuild chat dependencies');
        },
        copilotReadinessResolver: async () => {
            throw new Error('replay should not probe provider readiness');
        },
    });
    const replayAfterCacheClearPayload = JSON.parse(replayAfterCacheClear.content[0].text);
    assert.equal(chatCalls.length, 1);
    assert.equal(replayAfterCacheClearPayload.conversationId, firstPayload.conversationId);
    assert.equal(replayAfterCacheClearPayload.modelId, firstPayload.modelId);
    assert.deepEqual(replayAfterCacheClearPayload.segments, firstPayload.segments);
    assert.equal(replayAfterCacheClearPayload.replay?.replayId, replayId);
    assert.equal(replayAfterCacheClearPayload.replay?.status, 'completed');
    const incompleteConversationId = 'mcp-replay-durable-incomplete-1';
    memoryConversations.set(incompleteConversationId, {
        _id: incompleteConversationId,
        provider: 'copilot',
        model: 'copilot-gpt-5',
        title: 'Incomplete persisted replay conversation',
        source: 'MCP',
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        archivedAt: null,
        flags: {},
    } as Conversation);
    recordMemoryTurn({
        conversationId: incompleteConversationId,
        role: 'user',
        content: 'persisted incomplete replay request',
        model: 'copilot-gpt-5',
        provider: 'copilot',
        source: 'MCP',
        toolCalls: null,
        status: 'ok',
        runtime: {
            replay: {
                replayId: 'replay-incomplete-1',
                inflightId: 'persisted-incomplete',
                completed: false,
            },
        },
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
    } as never);
    __resetCompletedInflightForTests();
    const freshAfterIncompletePersistedState = await runCodebaseQuestion({
        question: 'retry after incomplete persisted replay state',
        conversationId: incompleteConversationId,
        replayId: 'replay-incomplete-1',
        provider: 'copilot',
        model: 'copilot-gpt-5',
    }, deps);
    const freshAfterIncompletePayload = JSON.parse(freshAfterIncompletePersistedState.content[0].text);
    assert.equal(chatCalls.length, 1);
    assert.equal(freshAfterIncompletePayload.conversationId, incompleteConversationId);
    assert.equal(freshAfterIncompletePayload.replay?.replayId, 'replay-incomplete-1');
    assert.equal(freshAfterIncompletePayload.replay?.status, 'in_progress');
    assert.deepEqual(freshAfterIncompletePayload.segments, []);
});
test('codebase_question replays a completed retry before later setup can fail after the replay becomes visible', async () => {
    const originalForceAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeInfoCodeHome = process.env.CODEINFO_CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    const conversationId = 'mcp-replay-late-fastpath-1';
    const replayId = 'late-fastpath-1';
    const tempHome = await withTempCodexHome({
        chatToml: 'model = "gpt-5.3-codex-spark"\n',
    });
    setCodexHomes(tempHome.codexHome);
    __setCodebaseQuestionMemoryConversationForTests({
        _id: conversationId,
        provider: 'codex',
        model: 'gpt-5.3-codex-spark',
        title: 'Late replay winner',
        source: 'MCP',
        flags: {},
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        archivedAt: null,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    } as Conversation);
    let persistedReplay = false;
    try {
        const replayResult = await runCodebaseQuestion({
            question: 'retry after replay winner appears during setup',
            conversationId,
            replayId,
            provider: 'codex',
            model: 'gpt-5.3-codex-spark',
        }, {
            listIngestedRepositoriesFn: async () => {
                if (!persistedReplay) {
                    persistedReplay = true;
                    recordMemoryTurn({
                        conversationId,
                        role: 'user',
                        content: 'persisted replay request',
                        model: 'gpt-5.3-codex-spark',
                        provider: 'codex',
                        source: 'MCP',
                        toolCalls: null,
                        status: 'ok',
                        runtime: {
                            replay: {
                                replayId,
                                inflightId: 'persisted-late-fastpath',
                                completed: false,
                            },
                        },
                        createdAt: new Date('2025-01-01T00:00:01.000Z'),
                    } as never);
                    recordMemoryTurn({
                        conversationId,
                        role: 'assistant',
                        content: 'Persisted late replay answer',
                        model: 'gpt-5.3-codex-spark',
                        provider: 'codex',
                        source: 'MCP',
                        toolCalls: null,
                        status: 'ok',
                        runtime: {
                            replay: {
                                replayId,
                                inflightId: 'persisted-late-fastpath',
                                completed: true,
                            },
                        },
                        createdAt: new Date('2025-01-01T00:00:02.000Z'),
                    } as never);
                }
                return { repos: [], lockedModelId: null };
            },
            chatRuntimeConfigResolver: async () => {
                throw new Error('replay should return before rebuilding Codex runtime config');
            },
            chatFactory: () => {
                throw new Error('replay should return before rebuilding chat deps');
            },
        });
        const replayPayload = JSON.parse(replayResult.content[0].text);
        assert.equal(replayPayload.conversationId, conversationId);
        assert.equal(replayPayload.modelId, 'gpt-5.3-codex-spark');
        assert.deepEqual(replayPayload.segments, [
            {
                type: 'answer',
                text: 'Persisted late replay answer',
            },
        ]);
        assert.equal(replayPayload.replay?.replayId, replayId);
        assert.equal(replayPayload.replay?.status, 'completed');
    }
    finally {
        __deleteCodebaseQuestionMemoryConversationForTests(conversationId);
        if (originalForceAvailable === undefined) {
            clearScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE");
        }
        else {
            setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", originalForceAvailable);
        }
        if (originalCodeHome === undefined) {
            clearScopedTestEnvValue("CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        }
        if (originalCodeInfoCodeHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeInfoCodeHome);
        }
        await tempHome.cleanup();
    }
});
test('codebase_question stops before chat construction when persisted metadata retries exhaust', async () => {
    const originalForceAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeInfoCodeHome = process.env.CODEINFO_CODEX_HOME;
    const conversationId = 'mcp-metadata-retry-exhausted';
    const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    const tempHome = await withTempCodexHome({
        chatToml: 'model = "gpt-5.3-codex-spark"\n',
    });
    setCodexHomes(tempHome.codexHome);
    try {
        await withMockedMongoConversationPersistence({
            seedConversations: [
                {
                    _id: conversationId,
                    provider: 'codex',
                    model: 'gpt-5.3-codex-spark',
                    title: 'Saved MCP conversation',
                    source: 'MCP',
                    flags: {},
                    lastMessageAt: new Date(),
                    archivedAt: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                } as Conversation,
            ],
            run: async ({ conversations }) => {
                setToolDeps({
                    clientFactory: makeLmStudioClientFactory(),
                    chatFactory: () => {
                        throw new Error('codebase question should not build chat after metadata exhaustion');
                    },
                    listIngestedRepositoriesFn: async () => ({
                        repos: [],
                        lockedModelId: null,
                    }),
                });
                ConversationModel.findOneAndUpdate = (() => ({
                    exec: async () => null,
                })) as unknown as typeof ConversationModel.findOneAndUpdate;
                try {
                    await assert.rejects(runCodebaseQuestion({
                        question: 'Retry exhausted codebase question',
                        conversationId,
                        provider: 'codex',
                        model: 'gpt-5.3-codex-spark',
                    }, {
                        chatFactory: () => {
                            throw new Error('codebase question should not build chat after metadata exhaustion');
                        },
                        listIngestedRepositoriesFn: async () => ({
                            repos: [],
                            lockedModelId: null,
                        }),
                    }), (error: unknown) => error instanceof assert.AssertionError &&
                        /response\.result/.test(error.message));
                    assert.equal(conversations.get(conversationId)?.provider, 'codex');
                    assert.equal(conversations.get(conversationId)?.model, 'gpt-5.3-codex-spark');
                }
                finally {
                    resetToolDeps();
                }
            },
        });
    }
    finally {
        ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
        if (originalForceAvailable === undefined) {
            clearScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE");
        }
        else {
            setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", originalForceAvailable);
        }
        if (originalCodeHome === undefined) {
            clearScopedTestEnvValue("CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        }
        if (originalCodeInfoCodeHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeInfoCodeHome);
        }
        await tempHome.cleanup();
    }
});
test('codebase_question stops before chat construction when persisted metadata reports not_found after a concurrent delete', async () => {
    const originalForceAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeInfoCodeHome = process.env.CODEINFO_CODEX_HOME;
    const conversationId = 'mcp-metadata-not-found';
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    const tempHome = await withTempCodexHome({
        chatToml: 'model = "gpt-5.3-codex-spark"\n',
    });
    setCodexHomes(tempHome.codexHome);
    try {
        await withConversationMetaNotFoundFixture({
            seedConversation: {
                _id: conversationId,
                provider: 'codex',
                model: 'gpt-5.3-codex-spark',
                title: 'Saved MCP conversation',
                source: 'MCP',
                flags: {},
                lastMessageAt: new Date(),
                archivedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            } as Conversation,
            run: async ({ conversations, capturedUpdates }) => {
                const server = http.createServer(handleRpc);
                server.listen(0);
                const { port } = server.address() as AddressInfo;
                try {
                    setToolDeps({
                        clientFactory: makeLmStudioClientFactory(),
                        chatFactory: () => {
                            throw new Error('codebase question should not build chat after metadata not_found');
                        },
                        listIngestedRepositoriesFn: async () => ({
                            repos: [],
                            lockedModelId: null,
                        }),
                    });
                    const response = await postJson(port, {
                        jsonrpc: '2.0',
                        id: 133,
                        method: 'tools/call',
                        params: {
                            name: 'codebase_question',
                            arguments: {
                                question: 'Missing conversation codebase question',
                                conversationId,
                                provider: 'codex',
                                model: 'gpt-5.3-codex-spark',
                            },
                        },
                    });
                    assert.ok(response.error);
                    assert.equal(response.error.code, 410);
                    assert.equal(response.error.message, 'Conversation is archived and must be restored before use');
                    assert.equal(conversations.get(conversationId), undefined);
                    assert.equal(capturedUpdates.length, 1);
                }
                finally {
                    resetToolDeps();
                    server.closeAllConnections();
                    await new Promise<void>((resolve) => {
                        server.close(() => resolve());
                    });
                }
            },
        });
    }
    finally {
        if (originalForceAvailable === undefined) {
            clearScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE");
        }
        else {
            setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", originalForceAvailable);
        }
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        if (originalCodeInfoCodeHome === undefined)
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        else
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeInfoCodeHome);
        await tempHome.cleanup();
    }
});
test('codebase_question keeps caller conversationId stable across Codex replay windows even when provider thread ids differ', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    resetStore();
    const divergentCodex = new DivergentReplayCodex('provider-thread-xyz');
    setToolDeps({
        codexFactory: () => divergentCodex,
        clientFactory: makeLmStudioClientFactory(),
    });
    const tempHome = await withTempCodexHome({
        chatToml: [
            'model = "gpt-5.3-codex-spark"',
            'sandbox_mode = "workspace-write"',
            'approval_policy = "on-request"',
            'model_reasoning_effort = "minimal"',
            'web_search_mode = "disabled"',
            '',
        ].join('\n'),
    });
    setCodexHomes(tempHome.codexHome);
    setScopedTestEnvValue("Codex_network_access_enabled", 'false');
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const firstCallPromise = postJson(port, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'first logical follow-up',
                    conversationId: 'caller-follow-up-1',
                    replayId: 'replay-1',
                    provider: 'codex',
                },
            },
        });
        await divergentCodex.waitForRunStart();
        const sameReplayPromise = postJson(port, {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'stale retry should not win',
                    conversationId: 'caller-follow-up-1',
                    replayId: 'replay-1',
                    provider: 'codex',
                },
            },
        });
        assert.equal(divergentCodex.runs, 1);
        divergentCodex.releaseRun();
        const firstCall = await firstCallPromise;
        const sameReplayCall = await sameReplayPromise;
        assert.ok(firstCall.result);
        assert.ok(sameReplayCall.result);
        const firstPayload = JSON.parse(firstCall.result.content[0].text);
        const sameReplayPayload = JSON.parse(sameReplayCall.result.content[0].text);
        assert.equal(firstPayload.conversationId, 'caller-follow-up-1');
        assert.equal(sameReplayPayload.conversationId, 'caller-follow-up-1');
        assert.deepEqual(sameReplayPayload, firstPayload);
        assert.equal(divergentCodex.lastResumeId, undefined);
        const afterCleanupCall = await postJson(port, {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'late stale retry should still replay',
                    conversationId: 'caller-follow-up-1',
                    replayId: 'replay-1',
                    provider: 'codex',
                },
            },
        });
        assert.ok(afterCleanupCall.result);
        const afterCleanupPayload = JSON.parse(afterCleanupCall.result.content[0].text);
        assert.equal(afterCleanupPayload.conversationId, 'caller-follow-up-1');
        assert.deepEqual(afterCleanupPayload, firstPayload);
        const freshReplayCall = await postJson(port, {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'fresh logical follow-up',
                    conversationId: 'caller-follow-up-1',
                    replayId: 'replay-2',
                    provider: 'codex',
                },
            },
        });
        assert.ok(freshReplayCall.result);
        const freshReplayPayload = JSON.parse(freshReplayCall.result.content[0].text);
        assert.equal(divergentCodex.runs, 2);
        assert.equal(divergentCodex.lastResumeId, 'provider-thread-xyz');
        assert.equal(freshReplayPayload.conversationId, 'caller-follow-up-1');
        assert.equal(freshReplayPayload.segments[0].text, 'Codex replay answer 2');
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        clearScopedTestEnvValue("Codex_network_access_enabled");
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('codebase_question fresh Codex runs keep one canonical conversation and persist the provider thread in flags only', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    resetStore();
    const tempHome = await withTempCodexHome({
        chatToml: 'web_search_request = false\n',
    });
    setCodexHomes(tempHome.codexHome);
    setToolDeps({
        codexFactory: () => new MockCodex('provider-thread-fresh-only'),
        clientFactory: makeLmStudioClientFactory(),
    });
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const response = await postJson(port, {
            jsonrpc: '2.0',
            id: 11,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: { question: 'Keep one conversation please' },
            },
        });
        assert.ok(response.result);
        const payload = JSON.parse(response.result.content[0].text);
        assert.equal(typeof payload.conversationId, 'string');
        assert.ok(payload.conversationId.startsWith('codex-thread-'));
        assert.equal(memoryConversations.size, 1);
        assert.ok(memoryConversations.has(payload.conversationId));
        assert.equal(memoryConversations.has('provider-thread-fresh-only'), false);
        assert.equal(memoryConversations.get(payload.conversationId)?.flags?.threadId, 'provider-thread-fresh-only');
        const persistedTurns = getMemoryTurns(payload.conversationId);
        assert.equal(persistedTurns.length, 2);
        assert.equal(persistedTurns[0]?.role, 'user');
        assert.equal(persistedTurns[1]?.role, 'assistant');
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('codebase_question normalizes implicit Copilot defaults and omits reasoning for models that do not support it', async () => {
    const originalHome = process.env.CODEINFO_COPILOT_HOME;
    const tempHome = await withTempCopilotHome([
        'model = "copilot-gpt-5"',
        'reasoning_effort = "high"',
        'tool_access = "off"',
        '',
        '[mcp_servers.code_info]',
        'command = "npx"',
        'args = ["-y", "mcp-remote", "http://localhost:5010/mcp"]',
        '',
    ].join('\n'));
    setScopedTestEnvValue("CODEINFO_COPILOT_HOME", tempHome.copilotHome);
    const harness = createMockCopilotSdkHarness({
        name: 'mcp-copilot-normalized-default',
        models: [
            {
                id: 'gpt-5-mini',
                name: 'GPT-5 Mini',
            } as ModelInfo,
        ],
    });
    try {
        const result = await runCodebaseQuestion({ question: 'copilot normalized default?', provider: 'copilot' }, {
            chatFactory: (provider) => {
                assert.equal(provider, 'copilot');
                return new ChatInterfaceCopilot(harness.createLifecycle());
            },
            copilotReadinessResolver: async () => ({
                available: true,
                toolsAvailable: true,
                blockingStage: 'ready',
                models: ['gpt-5-mini'],
                modelsRaw: [
                    {
                        id: 'gpt-5-mini',
                        name: 'GPT-5 Mini',
                    } as ModelInfo,
                ],
                authSource: 'env-token',
            }),
        });
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.modelId, 'gpt-5-mini');
        assert.equal(harness.getState().lastCreateSessionConfig?.model, 'gpt-5-mini');
        assert.equal(harness.getState().lastCreateSessionConfig?.reasoningEffort, undefined);
        assert.deepEqual(harness.getState().lastCreateSessionConfig?.availableTools, []);
        assert.deepEqual(toComparableJson(harness.getState().lastCreateSessionConfig?.mcpServers), {
            code_info: {
                type: 'stdio',
                command: 'npx',
                args: ['-y', 'mcp-remote', 'http://localhost:5010/mcp'],
                tools: [],
            },
        });
    }
    finally {
        if (originalHome === undefined)
            clearScopedTestEnvValue("CODEINFO_COPILOT_HOME");
        else
            setScopedTestEnvValue("CODEINFO_COPILOT_HOME", originalHome);
        await tempHome.cleanup();
    }
});
test('codebase_question forwards CODEINFO_ROOT into the Copilot runtime environment', async () => {
    const expectedRepoRoot = resolveAgentHomeEnv().codeInfoRoot;
    const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-copilot-home-'));
    setScopedTestEnvValue("CODEINFO_COPILOT_HOME", copilotHome);
    const capturedOptions: {
        env?: NodeJS.ProcessEnv;
    }[] = [];
    const harness = createMockCopilotSdkHarness({
        name: 'mcp-copilot-env-forwarding',
        models: [
            {
                id: 'copilot-model',
                name: 'Copilot Model',
            } as ModelInfo,
        ],
        createSessionEvents: [createSessionIdleEvent()],
    });
    try {
        const result = await runCodebaseQuestion({
            question: 'Forward CODEINFO_ROOT for Copilot.',
            provider: 'copilot',
            model: 'copilot-model',
        }, {
            chatFactory: (provider, deps) => getChatInterface(provider, {
                ...deps,
                copilotClientFactory: (options) => {
                    capturedOptions.push(options);
                    return harness.createClientFactory()(options);
                },
            }),
            copilotReadinessResolver: async () => ({
                available: true,
                toolsAvailable: true,
                blockingStage: 'ready',
                models: ['copilot-model'],
                modelsRaw: [
                    {
                        id: 'copilot-model',
                        name: 'Copilot Model',
                    } as ModelInfo,
                ],
                authSource: 'env-token',
            }),
        });
        assert.ok(result.content[0]?.text);
        assert.equal(capturedOptions.length, 1);
        assert.equal(capturedOptions[0]?.env?.CODEINFO_ROOT, expectedRepoRoot);
        assert.equal(capturedOptions[0]?.env?.COPILOT_HOME, copilotHome);
    }
    finally {
        await fs.rm(copilotHome, { recursive: true, force: true });
    }
});
test('codebase_question keeps the requested provider and repairs the model there when that provider is healthy but the requested model is missing', async () => {
    const originalHome = process.env.CODEINFO_COPILOT_HOME;
    const tempHome = await withTempCopilotHome('');
    setScopedTestEnvValue("CODEINFO_COPILOT_HOME", tempHome.copilotHome);
    const calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
        model: string;
    }> = [];
    const chat = new CapturingSelectionChat(calls, 'Same-provider repair answer');
    try {
        const result = await runCodebaseQuestion({
            question: 'repair the model on copilot',
            provider: 'copilot',
            model: 'missing-copilot-model',
        }, {
            chatFactory: (provider) => {
                assert.equal(provider, 'copilot');
                return chat;
            },
            copilotReadinessResolver: async () => ({
                available: true,
                toolsAvailable: true,
                blockingStage: 'ready',
                models: ['gpt-5-mini', 'copilot-gpt-5'],
                modelsRaw: [
                    {
                        id: 'gpt-5-mini',
                        name: 'GPT-5 Mini',
                    } as ModelInfo,
                    {
                        id: 'copilot-gpt-5',
                        name: 'Copilot GPT-5',
                    } as ModelInfo,
                ],
                authSource: 'env-token',
            }),
        });
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.modelId, 'copilot-gpt-5');
        assert.equal(calls[0]?.model, 'copilot-gpt-5');
        assert.equal(memoryConversations.get(payload.conversationId)?.provider, 'copilot');
        assert.equal(memoryConversations.get(payload.conversationId)?.model, 'copilot-gpt-5');
    }
    finally {
        if (originalHome === undefined)
            clearScopedTestEnvValue("CODEINFO_COPILOT_HOME");
        else
            setScopedTestEnvValue("CODEINFO_COPILOT_HOME", originalHome);
        await tempHome.cleanup();
    }
});
test('codebase_question keeps the same requested model first when cross-provider fallback is required', async () => {
    const calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
        model: string;
    }> = [];
    const chat = new CapturingSelectionChat(calls, 'Cross-provider same-model answer');
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalForceCodexAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'copilot');
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'false');
    try {
        const result = await runCodebaseQuestion({
            question: 'fallback with same requested model first',
            model: 'copilot-gpt-5',
        }, {
            chatFactory: (provider) => {
                assert.equal(provider, 'lmstudio');
                return chat;
            },
            copilotReadinessResolver: async () => ({
                available: false,
                toolsAvailable: true,
                blockingStage: 'connectivity',
                models: ['copilot-gpt-5'],
                modelsRaw: [
                    {
                        id: 'copilot-gpt-5',
                        name: 'Copilot GPT-5',
                    } as ModelInfo,
                ],
                authSource: 'env-token',
                reason: 'copilot unavailable',
            }),
            clientFactory: () => ({
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
            }) as never,
        });
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.modelId, 'copilot-gpt-5');
        assert.equal(calls[0]?.model, 'copilot-gpt-5');
        assert.equal(memoryConversations.get(payload.conversationId)?.provider, 'lmstudio');
        assert.equal(memoryConversations.get(payload.conversationId)?.model, 'copilot-gpt-5');
    }
    finally {
        if (originalDefaultProvider === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalDefaultProvider);
        }
        if (originalForceCodexAvailable === undefined) {
            clearScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE");
        }
        else {
            setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", originalForceCodexAvailable);
        }
    }
});
class MockThreadNoAnswer {
    id: string;
    constructor(id: string) {
        this.id = id;
    }
    async runStreamed() {
        const threadId = this.id;
        async function* generator(): AsyncGenerator<ThreadEvent> {
            yield { type: 'thread.started', thread_id: threadId };
            yield {
                type: 'item.updated',
                item: { type: 'reasoning', text: 'Thinking about the repo' },
            };
            yield { type: 'turn.completed', thread_id: threadId };
        }
        return { events: generator() };
    }
}
class MockCodexNoAnswer {
    threadId: string;
    constructor(id = 'thread-empty') {
        this.threadId = id;
    }
    startThread() {
        return new MockThreadNoAnswer(this.threadId);
    }
    resumeThread(threadId: string) {
        return new MockThreadNoAnswer(threadId);
    }
}
test('codebase_question returns an empty answer segment when no answer emitted', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setToolDeps({
        codexFactory: () => new MockCodexNoAnswer(),
        clientFactory: makeLmStudioClientFactory(),
    });
    resetStore();
    const tempHome = await withTempCodexHome({
        chatToml: 'web_search_request = false\n',
    });
    setCodexHomes(tempHome.codexHome);
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const response = await postJson(port, {
            jsonrpc: '2.0',
            id: 10,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: { question: 'What is up?' },
            },
        });
        assert.ok(response.result);
        const payload = JSON.parse(response.result.content[0].text);
        assert.deepEqual(payload.segments.map((s: {
            type: string;
        }) => s.type), ['answer']);
        assert.equal(payload.segments[0].text, '');
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('codebase_question logs structured MCP and Codex diagnostics when startup fails with only the stdin banner', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    resetStore();
    const tempHome = await withTempCodexHome({
        chatToml: 'web_search_request = false\n',
    });
    setCodexHomes(tempHome.codexHome);
    setToolDeps({
        codexFactory: () => new ThrowingBannerOnlyCodex(),
        clientFactory: makeLmStudioClientFactory(),
    });
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const response = await postJson(port, {
            jsonrpc: '2.0',
            id: 12,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: { question: 'Why did startup fail?' },
            },
        });
        assert.equal(response.error?.code, -32002);
        assert.match(response.error?.message ?? '', /Codex Exec exited with code 1: Reading prompt from stdin/);
        const codexFailureLog = query({
            source: ['server'],
            text: 'DEV-0000053:T2:codex_generic_startup_failure',
        }).at(-1);
        const codexFailureContext = codexFailureLog?.context as {
            conversationId?: string;
            resumeRequested?: boolean;
            codexHome?: string | null;
        } | undefined;
        assert.ok(codexFailureContext);
        assert.equal(codexFailureContext?.resumeRequested, false);
        assert.equal(typeof codexFailureContext?.conversationId, 'string');
        assert.equal(codexFailureContext?.codexHome, tempHome.codexHome);
        const mcpFailureLog = query({
            source: ['server'],
            text: 'DEV-0000053:T1:mcp_codebase_question_execution_failed',
        }).at(-1);
        const mcpFailureContext = mcpFailureLog?.context as {
            genericCodexBannerOnly?: boolean;
            resolvedConversationId?: string;
        } | undefined;
        assert.ok(mcpFailureContext);
        assert.equal(mcpFailureContext?.genericCodexBannerOnly, true);
        assert.equal(typeof mcpFailureContext?.resolvedConversationId, 'string');
        const routerFailureLog = query({
            source: ['server'],
            text: 'DEV-0000053:T3:mcp2_codebase_question_tool_error',
        }).at(-1);
        const routerFailureContext = routerFailureLog?.context as {
            errorCode?: number | null;
            errorMessage?: string;
        } | undefined;
        assert.ok(routerFailureContext);
        assert.equal(routerFailureContext?.errorCode, -32002);
        assert.match(routerFailureContext?.errorMessage ?? '', /Codex Exec exited with code 1: Reading prompt from stdin/);
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('codebase_question preserves a concrete streamed provider error over a later generic Codex banner', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    resetStore();
    const tempHome = await withTempCodexHome({
        chatToml: 'web_search_request = false\n',
    });
    setCodexHomes(tempHome.codexHome);
    setToolDeps({
        chatFactory: () => new EmitsSpecificErrorThenThrowsBannerChat(),
    });
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const response = await postJson(port, {
            jsonrpc: '2.0',
            id: 13,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: { question: 'Why did streaming fail?' },
            },
        });
        assert.equal(response.error?.code, -32002);
        assert.match(response.error?.message ?? '', /stream disconnected before completion: stream closed before response\.completed/);
        assert.doesNotMatch(response.error?.message ?? '', /Codex Exec exited with code 1: Reading prompt from stdin/);
        const mcpFailureLog = query({
            source: ['server'],
            text: 'DEV-0000053:T1:mcp_codebase_question_execution_failed',
        }).at(-1);
        const mcpFailureContext = mcpFailureLog?.context as {
            genericCodexBannerOnly?: boolean;
            message?: string;
        } | undefined;
        assert.ok(mcpFailureContext);
        assert.equal(mcpFailureContext?.genericCodexBannerOnly, false);
        assert.match(mcpFailureContext?.message ?? '', /stream disconnected before completion: stream closed before response\.completed/);
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('vector summary match uses the lowest distance', () => {
    const responder = new McpResponder();
    responder.handle({
        type: 'tool-result',
        callId: 'tool-1',
        result: {
            results: [
                {
                    repo: 'repo',
                    relPath: 'src/index.ts',
                    hostPath: '/host/repo/src/index.ts',
                    score: 0.33,
                    chunk: 'line1',
                    chunkId: 'c1',
                    embeddingProvider: 'openai',
                    embeddingModel: 'text-embedding-3-small',
                },
                {
                    repo: 'repo',
                    relPath: 'src/index.ts',
                    hostPath: '/host/repo/src/index.ts',
                    score: 0.12,
                    chunk: 'line2',
                    chunkId: 'c2',
                    modelId: 'embed-1',
                },
            ],
            files: [],
            modelId: 'embed-1',
        },
    });
    const summaries = responder.getVectorSummaries();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].files[0].match, 0.12);
    assert.equal(summaries[0].files[0].modelId, 'text-embedding-3-small');
    assert.equal(summaries[0].files[0].embeddingProvider, 'openai');
    assert.equal(summaries[0].files[0].embeddingModel, 'text-embedding-3-small');
});
test('codebase_question marker emits the shared warning_count and warnings fields while matching the REST defaults vocabulary', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalChatDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalChatDefaultModel = process.env.CODEINFO_CHAT_DEFAULT_MODEL;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
    clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL");
    resetStore();
    const tempHome = await withTempCodexHome({
        chatToml: [
            'sandbox_mode = "danger-full-access"',
            'approval_policy = "on-failure"',
            'model_reasoning_effort = "high"',
            'web_search = "cached"',
            '',
        ].join('\n'),
    });
    setCodexHomes(tempHome.codexHome);
    const mockCodex = new MockCodex('thread-parity');
    setToolDeps({
        codexFactory: () => mockCodex,
        clientFactory: makeLmStudioClientFactory(),
    });
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const result = await postJson(port, {
            jsonrpc: '2.0',
            id: 120,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: { question: 'Parity?' },
            },
        });
        assert.ok(result.result);
        assert.equal(result.result.content[0].type, 'text');
        const markerLogs = query({
            source: ['server'],
            text: 'DEV_0000040_T08_MCP_DEFAULTS_APPLIED',
        });
        const latest = markerLogs.at(-1);
        const context = latest?.context as {
            defaults?: {
                webSearchEnabled?: boolean;
            };
            warningCount?: number;
        } | undefined;
        assert.ok(context?.defaults);
        assert.equal(context.defaults?.webSearchEnabled, true);
        const story47MarkerLogs = query({
            source: ['server'],
            text: 'DEV_0000047_T01_CODEX_DEFAULTS_APPLIED',
        });
        const latestStory47Marker = story47MarkerLogs.at(-1);
        const story47Context = latestStory47Marker?.context as {
            model_source?: string;
            codex_model_source?: string;
            warning_count?: number;
            warnings?: string[];
        } | undefined;
        assert.ok(story47Context);
        assert.equal(story47Context?.model_source, 'fallback');
        assert.equal(story47Context?.codex_model_source, 'hardcoded');
        assert.equal(story47Context?.warning_count, context.warningCount);
        assert.deepEqual(story47Context?.warnings, [
            'codex/chat/config.toml uses legacy approval_policy "on-failure"; normalized to "on-request".',
        ]);
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        if (originalChatDefaultProvider === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalChatDefaultProvider);
        }
        if (originalChatDefaultModel === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL", originalChatDefaultModel);
        }
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('codebase_question keeps an explicit request model override over the chat-config default', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    resetStore();
    const tempHome = await withTempCodexHome({
        chatToml: 'model = "config-model"\n',
    });
    setCodexHomes(tempHome.codexHome);
    const mockCodex = new MockCodex('thread-override');
    setToolDeps({
        codexFactory: () => mockCodex,
        clientFactory: makeLmStudioClientFactory(),
    });
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const result = await postJson(port, {
            jsonrpc: '2.0',
            id: 130,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'Override please',
                    model: 'request-model',
                },
            },
        });
        assert.ok(result.result);
        const payload = JSON.parse(result.result.content[0].text);
        assert.equal(payload.modelId, 'request-model');
        assert.equal((mockCodex.lastStartOptions as {
            model?: string;
        }).model, 'request-model');
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('codebase_question keeps inherited base runtime settings in the resolved Codex runtime config', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    resetStore();
    const capturingChat = new CapturingChat();
    const tempHome = await withTempCodexHome({
        baseToml: [
            'personality = "base-personality"',
            'model_provider = "base-provider"',
            '[tools]',
            'view_image = true',
            '[mcp_servers.context7]',
            'command = "npx"',
            '[model_providers.base-provider]',
            'name = "Base Provider"',
            'base_url = "http://localhost:4100/v1"',
            '',
        ].join('\n'),
        chatToml: 'model = "chat-model"\n',
    });
    setCodexHomes(tempHome.codexHome);
    setToolDeps({
        clientFactory: makeLmStudioClientFactory(),
        chatFactory: () => capturingChat,
    });
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const response = await postJson(port, {
            jsonrpc: '2.0',
            id: 131,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: { question: 'Keep inherited runtime settings' },
            },
        });
        assert.ok(response.result);
        const runtimeConfig = capturingChat.lastFlags?.runtimeConfig as Record<string, unknown> | undefined;
        assert.ok(runtimeConfig);
        assert.equal(runtimeConfig?.model, 'chat-model');
        assert.equal(runtimeConfig?.personality, 'base-personality');
        assert.equal(runtimeConfig?.model_provider, 'base-provider');
        assert.deepEqual(runtimeConfig?.tools, {
            view_image: true,
        });
        assert.deepEqual(runtimeConfig?.mcp_servers, {
            context7: {
                command: 'npx',
            },
        });
        assert.deepEqual(runtimeConfig?.model_providers, {
            'base-provider': {
                name: 'Base Provider',
                base_url: 'http://localhost:4100/v1',
            },
        });
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        if (originalCodeinfoHome === undefined)
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        else
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeinfoHome);
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('codebase_question pins omitted-provider Codex runs to the saved conversation model', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalDefaultModel = process.env.CODEINFO_CHAT_DEFAULT_MODEL;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'codex');
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL", 'gpt-5.1-codex-max');
    resetStore();
    const capturingChat = new CapturingChat();
    const tempHome = await withTempCodexHome({
        chatToml: 'model = "gpt-5.1-codex-max"\n',
    });
    setCodexHomes(tempHome.codexHome);
    const conversationId = 'saved-codex-model-pin';
    __setCodebaseQuestionMemoryConversationForTests({
        _id: conversationId,
        provider: 'codex',
        model: 'gpt-5.3-codex',
        title: 'Saved Codex model pin conversation',
        source: 'MCP',
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        archivedAt: null,
        flags: {
            workingFolder: '/data/story55-manual-proof/queued-repo',
        },
    } as Conversation);
    setToolDeps({
        clientFactory: makeLmStudioClientFactory(),
        chatFactory: () => capturingChat,
    });
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const response = await postJson(port, {
            jsonrpc: '2.0',
            id: 132,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'Keep the saved Codex model pinned',
                    conversationId,
                },
            },
        });
        assert.ok(response.result);
        const payload = JSON.parse((response as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result
            .content[0].text);
        const runtimeConfig = capturingChat.lastFlags?.runtimeConfig as Record<string, unknown> | undefined;
        assert.equal(payload.modelId, 'gpt-5.3-codex');
        assert.equal(runtimeConfig?.model, 'gpt-5.3-codex');
        assert.equal((capturingChat.lastFlags as {
            provider?: string;
            threadId?: unknown;
        })
            ?.provider, 'codex');
        assert.equal((capturingChat.lastFlags as {
            provider?: string;
            threadId?: unknown;
        })
            ?.threadId, undefined);
    }
    finally {
        __deleteCodebaseQuestionMemoryConversationForTests(conversationId);
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        if (originalCodeinfoHome === undefined)
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        else
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeinfoHome);
        if (originalDefaultProvider === undefined)
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        else
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalDefaultProvider);
        if (originalDefaultModel === undefined)
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL");
        else
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL", originalDefaultModel);
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('codebase_question does not resume a saved Codex thread when endpoint-backed execution lacks a matching saved endpoint id', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    resetStore();
    const mockCodex = new MockCodex('fresh-thread-after-endpoint-change');
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['google/gemma-4-26b-a4b-qat'],
    });
    const tempHome = await withTempCodexHome({
        chatToml: [
            'model = "google/gemma-4-26b-a4b-qat"',
            `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses"`,
            '',
        ].join('\n'),
    });
    setCodexHomes(tempHome.codexHome);
    const conversationId = 'saved-codex-endpoint-mismatch';
    __setCodebaseQuestionMemoryConversationForTests({
        _id: conversationId,
        provider: 'codex',
        model: 'google/gemma-4-26b-a4b-qat',
        title: 'Saved Codex endpointless conversation',
        source: 'MCP',
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        archivedAt: null,
        flags: {
            threadId: 'stale-thread-before-endpoint-change',
        },
    } as Conversation);
    try {
        const result = await runCodebaseQuestion({
            question: 'Use the current endpoint-backed Codex config',
            conversationId,
        }, {
            codexFactory: () => mockCodex,
            clientFactory: makeLmStudioClientFactory(),
        });
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.modelId, 'google/gemma-4-26b-a4b-qat');
        assert.equal(mockCodex.lastResumeId, undefined);
        assert.equal(memoryConversations.get(conversationId)?.flags?.threadId, 'fresh-thread-after-endpoint-change');
        assert.equal(memoryConversations.get(conversationId)?.flags?.endpointId, `${externalServer.baseUrl}/v1`);
    }
    finally {
        __deleteCodebaseQuestionMemoryConversationForTests(conversationId);
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        if (originalCodeinfoHome === undefined)
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        else
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeinfoHome);
        await externalServer.stop();
        await tempHome.cleanup();
    }
});
test('codebase_question keeps the saved execution identity authoritative over contradictory follow-up provider-model input', async () => {
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalDefaultModel = process.env.CODEINFO_CHAT_DEFAULT_MODEL;
    const originalForceAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeInfoCodeHome = process.env.CODEINFO_CODEX_HOME;
    resetStore();
    const calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
        model: string;
    }> = [];
    const conversationId = 'saved-codex-identity-pin';
    const savedModel = 'gpt-5.3-codex';
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'codex');
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL", 'gpt-5.1-codex-max');
    const tempHome = await withTempCodexHome({
        chatToml: `model = "${savedModel}"\n`,
    });
    setCodexHomes(tempHome.codexHome);
    __setCodebaseQuestionMemoryConversationForTests({
        _id: conversationId,
        provider: 'codex',
        model: savedModel,
        title: 'Saved Codex identity pin conversation',
        source: 'MCP',
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        archivedAt: null,
        flags: {
            workingFolder: '/data/story55-manual-proof/queued-repo',
        },
    } as Conversation);
    setToolDeps({
        chatFactory: () => new CapturingSelectionChat(calls, 'Saved Codex identity stayed authoritative'),
        copilotReadinessResolver: async () => ({
            available: false,
            toolsAvailable: true,
            blockingStage: 'connectivity',
            models: [],
            modelsRaw: [],
            authSource: 'unauthenticated',
            reason: 'copilot unavailable for contradictory request',
        }),
    });
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const response = await postJson(port, {
            jsonrpc: '2.0',
            id: 133,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'Ignore the contradictory follow-up identity',
                    conversationId,
                    provider: 'copilot',
                    model: 'copilot-contradictory-model',
                },
            },
        });
        assert.ok((response as {
            result?: unknown;
        }).result);
        assert.equal(calls.length, 1, JSON.stringify({ response, calls }, null, 2));
        assert.equal(calls[0]?.conversationId, conversationId);
        assert.equal(calls[0]?.model, savedModel);
        assert.equal(calls[0]?.flags.provider, 'codex');
        const payload = JSON.parse((response as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result
            .content[0].text);
        assert.equal(payload.conversationId, conversationId);
        assert.equal(payload.modelId, savedModel);
        assert.equal(memoryConversations.get(conversationId)?.provider, 'codex');
        assert.equal(memoryConversations.get(conversationId)?.model, savedModel);
    }
    finally {
        __deleteCodebaseQuestionMemoryConversationForTests(conversationId);
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
        if (originalForceAvailable === undefined) {
            clearScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE");
        }
        else {
            setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", originalForceAvailable);
        }
        if (originalCodeHome === undefined) {
            clearScopedTestEnvValue("CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        }
        if (originalCodeInfoCodeHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeInfoCodeHome);
        }
        resetToolDeps();
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('codebase_question receives the same inherited overlaid Context7 definition', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    const originalContext7ApiKey = process.env.CODEINFO_CONTEXT7_API_KEY;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setScopedTestEnvValue("CODEINFO_CONTEXT7_API_KEY", 'ctx7sk-real');
    resetStore();
    const capturingChat = new CapturingChat();
    const tempHome = await withTempCodexHome({
        baseToml: [
            '[mcp_servers.context7]',
            'command = "npx"',
            'args = ["-y", "@upstash/context7-mcp", "--api-key", "REPLACE_WITH_CONTEXT7_API_KEY"]',
            '',
        ].join('\n'),
        chatToml: 'model = "chat-model"\n',
    });
    setCodexHomes(tempHome.codexHome);
    setToolDeps({
        clientFactory: makeLmStudioClientFactory(),
        chatFactory: () => capturingChat,
    });
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const response = await postJson(port, {
            jsonrpc: '2.0',
            id: 132,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: { question: 'Overlay the inherited Context7 key' },
            },
        });
        assert.ok(response.result);
        const runtimeConfig = capturingChat.lastFlags?.runtimeConfig as Record<string, unknown> | undefined;
        assert.deepEqual(runtimeConfig?.mcp_servers, {
            context7: {
                command: 'npx',
                args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real'],
            },
        });
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        if (originalCodeinfoHome === undefined)
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        else
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeinfoHome);
        if (originalContext7ApiKey === undefined)
            clearScopedTestEnvValue("CODEINFO_CONTEXT7_API_KEY");
        else
            setScopedTestEnvValue("CODEINFO_CONTEXT7_API_KEY", originalContext7ApiKey);
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('codebase_question overlays CODEINFO_CONTEXT7_API_KEY onto inherited no-key Context7 args', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    const originalContext7ApiKey = process.env.CODEINFO_CONTEXT7_API_KEY;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setScopedTestEnvValue("CODEINFO_CONTEXT7_API_KEY", 'ctx7sk-real');
    resetStore();
    const capturingChat = new CapturingChat();
    const tempHome = await withTempCodexHome({
        baseToml: [
            '[mcp_servers.context7]',
            'command = "npx"',
            'args = ["-y", "@upstash/context7-mcp"]',
            '',
        ].join('\n'),
        chatToml: 'model = "chat-model"\n',
    });
    setCodexHomes(tempHome.codexHome);
    setToolDeps({
        clientFactory: makeLmStudioClientFactory(),
        chatFactory: () => capturingChat,
    });
    const server = http.createServer(handleRpc);
    server.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
        const response = await postJson(port, {
            jsonrpc: '2.0',
            id: 133,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: { question: 'Overlay the inherited no-key Context7 args' },
            },
        });
        assert.ok(response.result);
        const runtimeConfig = capturingChat.lastFlags?.runtimeConfig as Record<string, unknown> | undefined;
        assert.deepEqual(runtimeConfig?.mcp_servers, {
            context7: {
                command: 'npx',
                args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real'],
            },
        });
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        if (originalCodeinfoHome === undefined)
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        else
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeinfoHome);
        if (originalContext7ApiKey === undefined)
            clearScopedTestEnvValue("CODEINFO_CONTEXT7_API_KEY");
        else
            setScopedTestEnvValue("CODEINFO_CONTEXT7_API_KEY", originalContext7ApiKey);
        await tempHome.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
});
test('codebase_question translates codeinfo_openai_endpoint into Codex provider metadata', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    resetStore();
    const mockCodex = new MockCodex();
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['google/gemma-4-26b-a4b-qat'],
    });
    const tempHome = await withTempCodexHome({
        chatToml: [
            'model = "google/gemma-4-26b-a4b-qat"',
            `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses"`,
            '',
        ].join('\n'),
    });
    setCodexHomes(tempHome.codexHome);
    const expectedConfig = applyCodexOpenAiCompatEndpointToRuntimeConfig({
        model: 'google/gemma-4-26b-a4b-qat',
    }, {
        endpointId: `${externalServer.baseUrl}/v1`,
        baseUrl: `${externalServer.baseUrl}/v1`,
        capabilities: ['responses'],
    })!;
    let capturedOptions: CodexOptions | undefined;
    try {
        const result = await runCodebaseQuestion({ question: 'Use the pinned OpenAI-compatible endpoint' }, {
            codexFactory: (options?: CodexOptions) => {
                capturedOptions = options;
                return mockCodex;
            },
            clientFactory: makeLmStudioClientFactory(),
        });
        assert.ok(result.content[0].text);
        assert.deepEqual(capturedOptions?.config, expectedConfig);
    }
    finally {
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        if (originalCodeinfoHome === undefined)
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        else
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeinfoHome);
        await externalServer.stop();
        await tempHome.cleanup();
    }
});
test('codebase_question resolves saved env-backed endpoint ids through the shared provider execution helper', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    const originalExternalEndpoints = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    resetStore();
    const mockCodex = new MockCodex();
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['google/gemma-4-26b-a4b-qat'],
    });
    setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${externalServer.baseUrl}/v1|responses`);
    const tempHome = await withTempCodexHome({
        chatToml: 'model = "google/gemma-4-26b-a4b-qat"\n',
    });
    setCodexHomes(tempHome.codexHome);
    const conversationId = 'mcp-codex-env-endpoint-follow-up';
    __setCodebaseQuestionMemoryConversationForTests({
        _id: conversationId,
        provider: 'codex',
        model: 'google/gemma-4-26b-a4b-qat',
        title: 'Saved env endpoint follow-up',
        source: 'MCP',
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        archivedAt: null,
        flags: {
            endpointId: `${externalServer.baseUrl}/v1`,
        },
    } as Conversation);
    const expectedConfig = applyCodexOpenAiCompatEndpointToRuntimeConfig({
        model: 'google/gemma-4-26b-a4b-qat',
    }, {
        endpointId: `${externalServer.baseUrl}/v1`,
        baseUrl: `${externalServer.baseUrl}/v1`,
        capabilities: ['responses'],
    })!;
    let capturedOptions: CodexOptions | undefined;
    try {
        const result = await runCodebaseQuestion({
            question: 'Reuse the saved env-backed endpoint id.',
            conversationId,
        }, {
            codexFactory: (options?: CodexOptions) => {
                capturedOptions = options;
                return mockCodex;
            },
            clientFactory: makeLmStudioClientFactory(),
        });
        assert.ok(result.content[0].text);
        assert.deepEqual(capturedOptions?.config, expectedConfig);
        assert.equal(memoryConversations.get(conversationId)?.flags?.endpointId, `${externalServer.baseUrl}/v1`);
    }
    finally {
        __deleteCodebaseQuestionMemoryConversationForTests(conversationId);
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        if (originalCodeHome === undefined)
            clearScopedTestEnvValue("CODEX_HOME");
        else
            setScopedTestEnvValue("CODEX_HOME", originalCodeHome);
        if (originalCodeinfoHome === undefined)
            clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
        else
            setScopedTestEnvValue("CODEINFO_CODEX_HOME", originalCodeinfoHome);
        if (originalExternalEndpoints === undefined)
            clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
        else
            setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", originalExternalEndpoints);
        await externalServer.stop();
        await tempHome.cleanup();
    }
});
