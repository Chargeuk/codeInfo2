import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { resolveAgentHomeEnv } from '../../agents/roots.js';
import { __resetCompletedInflightForTests, getCompletedInflightByReplayId, getInflight, } from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { getMemoryTurns, memoryConversations, memoryTurns, recordMemoryTurn, } from '../../chat/memoryPersistence.js';
import { importCopilotSeedIntoRuntimeHome } from '../../config/copilotSeedBootstrap.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { createLmStudioTools } from '../../lmstudio/tools.js';
import { resetStore } from '../../logStore.js';
import { handleRpc } from '../../mcp2/router.js';
import { __deleteCodebaseQuestionMemoryConversationForTests as deleteMemoryConversation, __setCodebaseQuestionMemoryConversationForTests as setMemoryConversation, } from '../../mcp2/tools/codebaseQuestion.js';
import { resetToolDeps, setToolDeps } from '../../mcp2/tools.js';
import { createConversationsRouter } from '../../routes/conversations.js';
import { setWorkingFolderStatForTests } from '../../workingFolders/state.js';
import { socketsSubscribedToConversation } from '../../ws/registry.js';
import { attachWs } from '../../ws/server.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';
import { closeWs, connectWs, sendJson, waitForEvent, } from '../support/wsClient.js';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForCondition(predicate: () => boolean, timeoutMs = 5000, pollMs = 10) {
    const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
    const startedAt = Date.now();
    while (Date.now() - startedAt < resolvedTimeoutMs) {
        if (predicate())
            return;
        await delay(pollMs);
    }
    throw new Error('condition not met before timeout');
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
async function writeSeedArtifacts(seedHome: string) {
    await fs.mkdir(path.join(seedHome, 'session-state'), { recursive: true });
    await fs.writeFile(path.join(seedHome, 'config.json'), '{"store_token_plaintext": true}\n', 'utf8');
    await fs.writeFile(path.join(seedHome, 'settings.json'), '{"storeTokenPlaintext": true}\n', 'utf8');
    await fs.writeFile(path.join(seedHome, 'session-state', 'session.json'), '{"mcp": true}\n', 'utf8');
}
async function lockDownRuntimeArtifacts(runtimeHome: string) {
    await fs.chmod(path.join(runtimeHome, 'config.json'), 0o000);
    await fs.chmod(path.join(runtimeHome, 'settings.json'), 0o000);
    await fs.chmod(path.join(runtimeHome, 'session-state', 'session.json'), 0o000);
    await fs.chmod(path.join(runtimeHome, 'session-state'), 0o000);
}
async function hasReadableBootstrappedRuntime(runtimeHome: string) {
    try {
        await Promise.all([
            fs.access(path.join(runtimeHome, 'config.json')),
            fs.access(path.join(runtimeHome, 'settings.json')),
            fs.access(path.join(runtimeHome, 'session-state')),
            fs.access(path.join(runtimeHome, 'session-state', 'session.json')),
        ]);
        return true;
    }
    catch {
        return false;
    }
}
async function withTempCodexHome() {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-codex-home-'));
    const codexHome = path.join(tempRoot, 'codex-home');
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
    await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), ['model = "gpt-5.3-codex"', 'sandbox_mode = "danger-full-access"'].join('\n') + '\n', 'utf8');
    return {
        codexHome,
        async cleanup() {
            await fs.rm(tempRoot, { recursive: true, force: true });
        },
    };
}
const makeLmStudioClientFactory = () => () => ({
    system: {
        listDownloadedModels: async () => [
            {
                modelKey: 'm',
                displayName: 'm',
                type: 'gguf',
            },
        ],
    },
    llm: {
        model: () => ({
            complete: async () => {
                throw new Error('unused');
            },
        }),
    },
}) as never;
class StreamingChat extends ChatInterface {
    async execute(_message: string, flags: Record<string, unknown>, conversationId: string, _model: string) {
        void _model;
        const signal = (flags as {
            signal?: AbortSignal;
        }).signal;
        const abortIfNeeded = () => {
            if (!signal?.aborted)
                return false;
            this.emit('error', { type: 'error', message: 'aborted' });
            return true;
        };
        if (abortIfNeeded())
            return;
        this.emit('thread', { type: 'thread', threadId: conversationId });
        this.emit('analysis', { type: 'analysis', content: 'thinking...' });
        await delay(30);
        if (abortIfNeeded())
            return;
        this.emit('token', { type: 'token', content: 'Hel' });
        await delay(30);
        if (abortIfNeeded())
            return;
        this.emit('token', { type: 'token', content: 'lo' });
        await delay(30);
        if (abortIfNeeded())
            return;
        this.emit('final', { type: 'final', content: 'Hello world' });
        this.emit('complete', { type: 'complete', threadId: conversationId });
    }
}
class CapturingRuntimeChat extends ChatInterface {
    constructor(private readonly calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
    }>) {
        super();
    }
    async execute(_message: string, flags: Record<string, unknown>, conversationId: string, _model: string) {
        void _message;
        void _model;
        this.calls.push({ flags, conversationId });
        this.emit('thread', { type: 'thread', threadId: conversationId });
        this.emit('final', { type: 'final', content: 'Captured runtime context' });
        this.emit('complete', { type: 'complete', threadId: conversationId });
    }
}
class CapturingCodexMcpChat extends ChatInterface {
    constructor(private readonly calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
    }>, private readonly providerThreadId: string, private readonly finalContent: string) {
        super();
    }
    async execute(_message: string, flags: Record<string, unknown>, conversationId: string, _model: string) {
        void _message;
        void _model;
        this.calls.push({ flags, conversationId });
        this.emit('thread', {
            type: 'thread',
            threadId: this.providerThreadId,
        });
        this.emit('final', {
            type: 'final',
            content: this.finalContent,
        });
        this.emit('complete', {
            type: 'complete',
            threadId: this.providerThreadId,
        });
    }
}
class CapturingPinnedConversationChat extends ChatInterface {
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
const normalizeModelIdForComparison = (model: string) => model.trim().toLowerCase();
class RepositoryScopedLmStudioChat extends ChatInterface {
    constructor(private readonly repositorySelector: string, private readonly listedRepos: Array<{
        id: string;
        containerPath: string;
        hostPath: string;
        modelId: string;
    }>, private readonly options?: {
        expectedModel?: string;
        calls?: Array<{
            flags: Record<string, unknown>;
            conversationId: string;
            model: string;
        }>;
    }) {
        super();
    }
    async execute(_message: string, flags: Record<string, unknown>, conversationId: string, model: string) {
        this.options?.calls?.push({ flags, conversationId, model });
        if (this.options?.expectedModel && model !== this.options.expectedModel) {
            throw new Error(`Cannot find a model with path "${model}"`);
        }
        const { tools } = createLmStudioTools({
            repositoryContext: (flags as {
                repositoryContext?: unknown;
            })
                .repositoryContext as never,
            listIngestedRepositoriesFn: async () => ({
                repos: this.listedRepos.map((repo) => ({
                    id: repo.id,
                    name: path.basename(repo.id),
                    description: null,
                    containerPath: repo.containerPath,
                    hostPath: repo.hostPath,
                    lastIngestAt: null,
                    embeddingProvider: 'lmstudio',
                    embeddingModel: repo.modelId,
                    embeddingDimensions: 768,
                    model: repo.modelId,
                    modelId: repo.modelId,
                    counts: { files: 1, chunks: 1, embedded: 1 },
                    lastError: null,
                    status: 'completed',
                })),
                lockedModelId: this.listedRepos[0]?.modelId ?? null,
            }),
            deps: {
                getRootsCollection: async () => ({
                    get: async () => ({
                        metadatas: this.listedRepos.map((repo) => ({
                            root: repo.id,
                            model: repo.modelId,
                        })),
                    }),
                }) as never,
                getVectorsCollection: async () => ({
                    query: async ({ where }: {
                        where?: {
                            root?: string;
                        };
                    }) => {
                        const repoRoot = where?.root ?? this.listedRepos[0]?.id ?? '';
                        return {
                            ids: [['chunk-1']],
                            distances: [[0.01]],
                            documents: [['export const manualProof = "queued-proof";']],
                            metadatas: [
                                [
                                    {
                                        root: repoRoot,
                                        relPath: 'src/index.ts',
                                        model: this.listedRepos[0]?.modelId ?? 'embed-test',
                                    },
                                ],
                            ],
                        };
                    },
                }) as never,
                getLockedModel: async () => this.listedRepos[0]?.modelId ?? 'embed-test',
            },
        });
        const vectorSearchTool = tools.find((entry) => (entry as {
            name?: string;
        }).name === 'VectorSearch') as {
            implementation: (params: {
                query: string;
                repository: string;
                limit: number;
            }, ctx: Record<string, unknown>) => Promise<{
                results?: Array<{
                    repo?: string;
                }>;
            }>;
        } | undefined;
        if (!vectorSearchTool) {
            throw new Error('VectorSearch tool unavailable');
        }
        this.emit('thread', { type: 'thread', threadId: conversationId });
        const params = {
            query: 'manualProof',
            repository: this.repositorySelector,
            limit: 5,
        };
        try {
            const result = await vectorSearchTool.implementation(params, {});
            this.emit('tool-result', {
                type: 'tool-result',
                callId: 'vector-search-1',
                name: 'VectorSearch',
                params,
                result,
                stage: 'success',
            });
            this.emit('final', {
                type: 'final',
                content: result.results?.[0]?.repo ?? '',
            });
            this.emit('complete', {
                type: 'complete',
                threadId: conversationId,
            });
        }
        catch (error) {
            this.emit('tool-result', {
                type: 'tool-result',
                callId: 'vector-search-1',
                name: 'VectorSearch',
                params,
                result: null,
                stage: 'error',
                error: error instanceof Error
                    ? { message: error.message }
                    : { message: String(error) },
            });
            throw error;
        }
    }
}
class BlockingReplayClaimStreamingChat extends ChatInterface {
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
        this.releaseCurrentRun?.();
    }
    async execute(message: string, flags: Record<string, unknown>, conversationId: string, _model: string) {
        void flags;
        void _model;
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
        this.emit('thread', { type: 'thread', threadId: conversationId });
        this.emit('analysis', { type: 'analysis', content: 'replay-check...' });
        this.resolveStarted?.();
        await releasePromise;
        this.emit('final', {
            type: 'final',
            content: `Replay-protected answer for ${message}`,
        });
        this.emit('complete', { type: 'complete', threadId: conversationId });
    }
}
async function postJson(port: number, body: unknown) {
    const response = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return response.json();
}
const buildRepoEntry = (hostPath: string): RepoEntry => ({
    id: hostPath,
    name: path.basename(hostPath),
    description: null,
    containerPath: hostPath === '/home/d_a_s/code/story55-manual-proof/queued-repo'
        ? '/data/story55-manual-proof/queued-repo'
        : hostPath,
    hostPath,
    lastIngestAt: null,
    embeddingProvider: 'lmstudio',
    embeddingModel: 'text-embedding-test',
    embeddingDimensions: 768,
    modelId: 'text-embedding-test',
    counts: { files: 1, chunks: 1, embedded: 1 },
    lastError: null,
    status: 'completed',
});
test('MCP codebase_question publishes WS transcript events while in progress', async () => {
    resetStore();
    const originalForce = process.env.MCP_FORCE_CODEX_AVAILABLE;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setToolDeps({
        chatFactory: () => new StreamingChat(),
        clientFactory: makeLmStudioClientFactory(),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const conversationId = 'mcp-ws-conv-1';
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        await delay(25);
        const toolCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'What is up?',
                    conversationId,
                    provider: 'lmstudio',
                    model: 'm',
                },
            },
        });
        await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                };
                return (e.type === 'inflight_snapshot' && e.conversationId === conversationId);
            },
            timeoutMs: 5000,
        });
        await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                };
                return (e.type === 'assistant_delta' && e.conversationId === conversationId);
            },
            timeoutMs: 5000,
        });
        const final = await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
                status: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                    status?: string;
                };
                return e.type === 'turn_final' && e.conversationId === conversationId;
            },
            timeoutMs: 15000,
        });
        assert.equal(final.status, 'ok');
        const response = await toolCallPromise;
        assert.ok((response as {
            result?: unknown;
        }).result);
    }
    finally {
        await closeWs(ws);
        await wsHandle.close();
        await new Promise<void>((resolve) => wsHttp.close(() => resolve()));
        await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
        resetToolDeps();
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", originalForce);
    }
});
test('explicit-provider MCP codebase_question websocket runs receive the shared execution context', async () => {
    resetStore();
    const calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
    }> = [];
    const originalWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
    const originalAgentHome = process.env.CODEINFO_AGENT_HOME;
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-ws-explicit-current-repo-'));
    const agentHome = path.join(repoRoot, 'codeinfo_agents');
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/mounted/ws-default-root');
    setScopedTestEnvValue("CODEINFO_AGENT_HOME", agentHome);
    await fs.mkdir(agentHome, { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'AGENTS.md'), '# temp repo\n', 'utf8');
    setToolDeps({
        chatFactory: () => new CapturingRuntimeChat(calls),
        clientFactory: makeLmStudioClientFactory(),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const conversationId = 'mcp-ws-runtime-explicit';
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        await waitForCondition(() => socketsSubscribedToConversation(conversationId).length > 0, 15000);
        const toolCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 101,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'What is up?',
                    conversationId,
                    provider: 'lmstudio',
                    model: 'm',
                },
            },
        });
        await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                };
                return e.type === 'turn_final' && e.conversationId === conversationId;
            },
            timeoutMs: 15000,
        });
        await toolCallPromise;
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0]?.flags.runtime, {
            lookupSummary: {
                selectedRepositoryPath: repoRoot,
                fallbackUsed: true,
                workingRepositoryAvailable: false,
            },
        });
        assert.deepEqual(calls[0]?.flags.repositoryContext, {
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
        await closeWs(ws);
        await wsHandle.close();
        resetToolDeps();
        mcpServer.close();
        wsHttp.close();
    }
});
test('explicit-provider MCP codebase_question restores a saved host-path working folder through the mounted repository bridge', async () => {
    resetStore();
    const calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
    }> = [];
    const originalWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
    const originalHostIngestDir = process.env.CODEINFO_HOST_INGEST_DIR;
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/mounted/ws-default-root');
    setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", '/home/d_a_s/code');
    const advertisedHostPath = '/home/d_a_s/code/story55-manual-proof/queued-repo';
    const resolvedSelectedPath = advertisedHostPath;
    setToolDeps({
        chatFactory: () => new CapturingRuntimeChat(calls),
        clientFactory: makeLmStudioClientFactory(),
        listIngestedRepositoriesFn: async () => ({
            repos: [
                {
                    id: 'repo-host-bridge',
                    description: null,
                    containerPath: advertisedHostPath,
                    hostPath: advertisedHostPath,
                    lastIngestAt: null,
                    embeddingProvider: 'lmstudio',
                    embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
                    embeddingDimensions: 768,
                    modelId: 'text-embedding-nomic-embed-text-v1.5',
                    counts: { files: 0, chunks: 0, embedded: 0 },
                    lastError: null,
                },
            ],
            lockedModelId: null,
        }),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const conversationId = 'mcp-ws-runtime-host-bridge';
    setMemoryConversation({
        _id: conversationId,
        provider: 'lmstudio',
        model: 'm',
        title: 'Host bridge conversation',
        source: 'MCP',
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        archivedAt: null,
        flags: { workingFolder: advertisedHostPath },
    } as never);
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        const toolCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 103,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'What is up?',
                    conversationId,
                    provider: 'lmstudio',
                    model: 'm',
                },
            },
        });
        await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                };
                return e.type === 'turn_final' && e.conversationId === conversationId;
            },
            timeoutMs: 15000,
        });
        await toolCallPromise;
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0]?.flags.runtime, {
            workingFolder: resolvedSelectedPath,
            lookupSummary: {
                selectedRepositoryPath: resolvedSelectedPath,
                fallbackUsed: false,
                workingRepositoryAvailable: true,
            },
        });
        assert.deepEqual(calls[0]?.flags.repositoryContext, {
            selectedRepositoryPath: resolvedSelectedPath,
            defaultExecutionRoot: resolveAgentHomeEnv().codeInfoRoot,
            workingDirectoryOverride: resolvedSelectedPath,
            fallbackUsed: false,
            workingRepositoryAvailable: true,
        });
    }
    finally {
        deleteMemoryConversation(conversationId);
        if (originalWorkdir === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", originalWorkdir);
        }
        if (originalHostIngestDir === undefined) {
            clearScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", originalHostIngestDir);
        }
        await closeWs(ws);
        await wsHandle.close();
        resetToolDeps();
        mcpServer.close();
        wsHttp.close();
    }
});
test('explicit-provider MCP codebase_question accepts a mounted selected-repository selector on the LM Studio websocket path', async () => {
    resetStore();
    const originalWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
    const originalHostIngestDir = process.env.CODEINFO_HOST_INGEST_DIR;
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/mounted/ws-default-root');
    setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", '/home/d_a_s/code');
    const advertisedHostPath = '/home/d_a_s/code/story55-manual-proof/queued-repo';
    const mountedPath = '/data/story55-manual-proof/queued-repo';
    const repoId = advertisedHostPath;
    setToolDeps({
        chatFactory: () => new RepositoryScopedLmStudioChat(mountedPath, [
            {
                id: repoId,
                containerPath: mountedPath,
                hostPath: advertisedHostPath,
                modelId: 'text-embedding-nomic-embed-text-v1.5',
            },
        ]),
        clientFactory: makeLmStudioClientFactory(),
        listIngestedRepositoriesFn: async () => ({
            repos: [
                {
                    id: repoId,
                    description: null,
                    containerPath: mountedPath,
                    hostPath: advertisedHostPath,
                    lastIngestAt: null,
                    embeddingProvider: 'lmstudio',
                    embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
                    embeddingDimensions: 768,
                    modelId: 'text-embedding-nomic-embed-text-v1.5',
                    counts: { files: 0, chunks: 0, embedded: 0 },
                    lastError: null,
                },
            ],
            lockedModelId: null,
        }),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const conversationId = 'mcp-ws-runtime-mounted-selector';
    setMemoryConversation({
        _id: conversationId,
        provider: 'lmstudio',
        model: 'm',
        title: 'Mounted selector conversation',
        source: 'MCP',
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        archivedAt: null,
        flags: { workingFolder: mountedPath },
    } as never);
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        const toolCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 106,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'Using only the selected repository, what is the exact string assigned to manualProof in src/index.ts?',
                    conversationId,
                    provider: 'lmstudio',
                    model: 'm',
                },
            },
        });
        const response = await toolCallPromise;
        assert.ok((response as {
            result?: unknown;
        }).result, JSON.stringify(response, null, 2));
        const payload = JSON.parse((response as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result
            .content[0].text);
        const final = await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
                conversationId?: string;
                status?: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                    status?: string;
                };
                return e.type === 'turn_final' && e.conversationId === conversationId;
            },
            timeoutMs: 15000,
        });
        assert.equal(final.status, 'ok');
        assert.equal(payload.conversationId, conversationId);
        assert.equal(payload.segments[0]?.text, repoId);
    }
    finally {
        deleteMemoryConversation(conversationId);
        if (originalWorkdir === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", originalWorkdir);
        }
        if (originalHostIngestDir === undefined) {
            clearScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", originalHostIngestDir);
        }
        await closeWs(ws);
        await wsHandle.close();
        resetToolDeps();
        mcpServer.close();
        wsHttp.close();
    }
});
test('story57 explicit-provider LM Studio MCP codebase_question keeps the saved provider and repairs the omitted model on that provider when needed', async () => {
    resetStore();
    const originalWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
    const originalHostIngestDir = process.env.CODEINFO_HOST_INGEST_DIR;
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/mounted/ws-default-root');
    setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", '/home/d_a_s/code');
    const calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
        model: string;
    }> = [];
    const advertisedHostPath = '/home/d_a_s/code/story55-manual-proof/queued-repo';
    const mountedPath = '/data/story55-manual-proof/queued-repo';
    const repoId = advertisedHostPath;
    const savedModel = 'huihui-qwen3.5-9b-abliterated';
    setToolDeps({
        chatFactory: () => new RepositoryScopedLmStudioChat(mountedPath, [
            {
                id: repoId,
                containerPath: mountedPath,
                hostPath: advertisedHostPath,
                modelId: 'text-embedding-nomic-embed-text-v1.5',
            },
        ], {
            calls,
        }),
        clientFactory: makeLmStudioClientFactory(),
        listIngestedRepositoriesFn: async () => ({
            repos: [
                {
                    id: repoId,
                    description: null,
                    containerPath: mountedPath,
                    hostPath: advertisedHostPath,
                    lastIngestAt: null,
                    embeddingProvider: 'lmstudio',
                    embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
                    embeddingDimensions: 768,
                    modelId: 'text-embedding-nomic-embed-text-v1.5',
                    counts: { files: 0, chunks: 0, embedded: 0 },
                    lastError: null,
                },
            ],
            lockedModelId: null,
        }),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const conversationId = 'mcp-ws-runtime-mounted-selector-saved-model';
    setMemoryConversation({
        _id: conversationId,
        provider: 'lmstudio',
        model: savedModel,
        title: 'Mounted selector saved-model conversation',
        source: 'MCP',
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        archivedAt: null,
        flags: { workingFolder: mountedPath },
    } as never);
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        const toolCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 107,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'Using only the selected repository, what is the exact string assigned to manualProof in src/index.ts?',
                    conversationId,
                    provider: 'lmstudio',
                },
            },
        });
        const response = await toolCallPromise;
        assert.equal(calls.length, 1, JSON.stringify({ response, calls }, null, 2));
        assert.equal(calls[0]?.model, 'm', JSON.stringify({ response, calls }, null, 2));
        assert.ok((response as {
            result?: unknown;
        }).result, JSON.stringify({ response, calls }, null, 2));
        const payload = JSON.parse((response as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result
            .content[0].text);
        assert.equal(calls[0]?.conversationId, conversationId);
        assert.equal(payload.conversationId, conversationId);
        assert.equal(payload.modelId, 'm');
        assert.equal(payload.segments[0]?.text, repoId);
        assert.equal(memoryConversations.get(conversationId)?.model, 'm');
        const persistedTurns = getMemoryTurns(conversationId);
        const assistantTurn = persistedTurns.find((turn) => turn.role === 'assistant');
        assert.ok(assistantTurn);
        assert.equal(assistantTurn?.status, 'ok');
        assert.equal(assistantTurn?.model, 'm');
    }
    finally {
        deleteMemoryConversation(conversationId);
        if (originalWorkdir === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", originalWorkdir);
        }
        if (originalHostIngestDir === undefined) {
            clearScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", originalHostIngestDir);
        }
        await closeWs(ws);
        await wsHandle.close();
        resetToolDeps();
        mcpServer.close();
        wsHttp.close();
    }
});
test('omitted-provider MCP codebase_question websocket runs receive the same shared execution context', async () => {
    resetStore();
    const calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
    }> = [];
    const expectedRepoRoot = resolveAgentHomeEnv().codeInfoRoot;
    const originalWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalDefaultModel = process.env.CODEINFO_CHAT_DEFAULT_MODEL;
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/mounted/ws-default-root');
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'lmstudio');
    clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL");
    setToolDeps({
        chatFactory: () => new CapturingRuntimeChat(calls),
        clientFactory: makeLmStudioClientFactory(),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const conversationId = 'mcp-ws-runtime-omitted';
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        await waitForCondition(() => socketsSubscribedToConversation(conversationId).length > 0);
        const toolCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 102,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'What is up?',
                    conversationId,
                },
            },
        });
        const response = await toolCallPromise;
        assert.ok((response as {
            result?: unknown;
        }).result, JSON.stringify(response, null, 2));
        await waitForCondition(() => calls.length === 1);
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0]?.flags.runtime, {
            lookupSummary: {
                selectedRepositoryPath: expectedRepoRoot,
                fallbackUsed: true,
                workingRepositoryAvailable: false,
            },
        });
        assert.deepEqual(calls[0]?.flags.repositoryContext, {
            selectedRepositoryPath: expectedRepoRoot,
            defaultExecutionRoot: expectedRepoRoot,
            workingDirectoryOverride: expectedRepoRoot,
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
        await closeWs(ws);
        await wsHandle.close();
        resetToolDeps();
        mcpServer.close();
        wsHttp.close();
    }
});
test('omitted-provider MCP codebase_question reuses the saved Codex thread identity on follow-up runs', async () => {
    resetStore();
    const calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
    }> = [];
    const conversationId = 'mcp-ws-codex-saved-follow-up';
    const savedThreadId = 'codex-thread-saved-123';
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalForceAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeInfoCodeHome = process.env.CODEINFO_CODEX_HOME;
    const tempCodexHome = await withTempCodexHome();
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'codex');
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setScopedTestEnvValue("CODEX_HOME", tempCodexHome.codexHome);
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", tempCodexHome.codexHome);
    setMemoryConversation({
        _id: conversationId,
        provider: 'codex',
        model: 'gpt-5.3-codex',
        title: 'Saved Codex follow-up conversation',
        source: 'MCP',
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        archivedAt: null,
        flags: {
            workingFolder: resolveAgentHomeEnv().codeInfoRoot,
            threadId: savedThreadId,
        },
    } as never);
    setToolDeps({
        chatFactory: () => new CapturingCodexMcpChat(calls, savedThreadId, 'Saved Codex follow-up answer'),
        clientFactory: makeLmStudioClientFactory(),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        const toolCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 104,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'Use the saved Codex follow-up thread',
                    conversationId,
                },
            },
        });
        const final = await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
                status: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                    status?: string;
                };
                return e.type === 'turn_final' && e.conversationId === conversationId;
            },
            timeoutMs: 15000,
        });
        assert.equal(final.status, 'ok');
        const response = await toolCallPromise;
        assert.ok((response as {
            result?: unknown;
        }).result);
        const payload = JSON.parse((response as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result
            .content[0].text);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.conversationId, conversationId);
        assert.equal(calls[0]?.flags.threadId, savedThreadId);
        assert.equal(payload.conversationId, conversationId);
        assert.equal(payload.segments[0]?.text, 'Saved Codex follow-up answer');
        assert.equal(memoryConversations.get(conversationId)?.flags?.threadId, savedThreadId);
        const persistedTurns = getMemoryTurns(conversationId);
        const assistantTurn = persistedTurns.find((turn) => turn.role === 'assistant');
        assert.ok(assistantTurn);
        assert.equal(assistantTurn?.status, 'ok');
        assert.equal(assistantTurn?.content, 'Saved Codex follow-up answer');
    }
    finally {
        deleteMemoryConversation(conversationId);
        memoryTurns.delete(conversationId);
        if (originalDefaultProvider === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalDefaultProvider);
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
        await tempCodexHome.cleanup();
        await closeWs(ws);
        await wsHandle.close();
        resetToolDeps();
        mcpServer.close();
        wsHttp.close();
    }
});
test('omitted-provider MCP codebase_question fresh runs persist a successful assistant turn on the saved conversation id', async () => {
    resetStore();
    const calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
    }> = [];
    const conversationId = 'mcp-ws-codex-fresh-run';
    const providerThreadId = 'codex-thread-fresh-456';
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalForceAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeInfoCodeHome = process.env.CODEINFO_CODEX_HOME;
    const tempCodexHome = await withTempCodexHome();
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'codex');
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setScopedTestEnvValue("CODEX_HOME", tempCodexHome.codexHome);
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", tempCodexHome.codexHome);
    setToolDeps({
        chatFactory: () => new CapturingCodexMcpChat(calls, providerThreadId, 'Fresh Codex omitted-provider answer'),
        clientFactory: makeLmStudioClientFactory(),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        const toolCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 105,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'Start a fresh omitted-provider Codex run',
                    conversationId,
                },
            },
        });
        const final = await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
                status: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                    status?: string;
                };
                return e.type === 'turn_final' && e.conversationId === conversationId;
            },
            timeoutMs: 15000,
        });
        assert.equal(final.status, 'ok');
        const response = await toolCallPromise;
        assert.ok((response as {
            result?: unknown;
        }).result);
        const payload = JSON.parse((response as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result
            .content[0].text);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.conversationId, conversationId);
        assert.equal(calls[0]?.flags.threadId, undefined);
        assert.equal(payload.conversationId, conversationId);
        assert.equal(payload.segments[0]?.text, 'Fresh Codex omitted-provider answer');
        assert.equal(memoryConversations.get(conversationId)?.flags?.threadId, providerThreadId);
        const persistedTurns = getMemoryTurns(conversationId);
        const assistantTurn = persistedTurns.find((turn) => turn.role === 'assistant');
        assert.ok(assistantTurn);
        assert.equal(assistantTurn?.status, 'ok');
        assert.equal(assistantTurn?.content, 'Fresh Codex omitted-provider answer');
    }
    finally {
        deleteMemoryConversation(conversationId);
        memoryTurns.delete(conversationId);
        if (originalDefaultProvider === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalDefaultProvider);
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
        await tempCodexHome.cleanup();
        await closeWs(ws);
        await wsHandle.close();
        resetToolDeps();
        mcpServer.close();
        wsHttp.close();
    }
});
test('omitted-provider MCP codebase_question keeps the saved Codex model on fresh selected-repository conversations', async () => {
    resetStore();
    const calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
    }> = [];
    const conversationId = 'mcp-ws-codex-fresh-saved-selected-repo';
    const providerThreadId = 'codex-thread-fresh-saved-789';
    const savedModel = 'gpt-5.3-codex';
    const selectedRepo = '/data/story55-manual-proof/queued-repo';
    const advertisedHostPath = '/home/d_a_s/code/story55-manual-proof/queued-repo';
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalDefaultModel = process.env.CODEINFO_CHAT_DEFAULT_MODEL;
    const originalForceAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeInfoCodeHome = process.env.CODEINFO_CODEX_HOME;
    const originalCodeWorkdir = process.env.CODEX_WORKDIR;
    const originalCodeInfoCodeWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
    const tempCodexHome = await withTempCodexHome();
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'codex');
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL", 'gpt-5.1-codex-max');
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setScopedTestEnvValue("CODEX_HOME", tempCodexHome.codexHome);
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", tempCodexHome.codexHome);
    setScopedTestEnvValue("CODEX_WORKDIR", '/data');
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/data');
    setMemoryConversation({
        _id: conversationId,
        provider: 'codex',
        model: savedModel,
        title: 'Saved selected repository Codex conversation',
        source: 'MCP',
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        archivedAt: null,
        flags: {
            workingFolder: selectedRepo,
        },
    } as never);
    setToolDeps({
        chatFactory: () => new CapturingCodexMcpChat(calls, providerThreadId, 'Fresh saved selected-repository Codex answer'),
        clientFactory: makeLmStudioClientFactory(),
        listIngestedRepositoriesFn: async () => ({
            repos: [buildRepoEntry(advertisedHostPath)],
            lockedModelId: null,
        }),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        await waitForCondition(() => socketsSubscribedToConversation(conversationId).length > 0);
        const toolCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 106,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'Start a fresh omitted-provider Codex run on the saved selected repository',
                    conversationId,
                },
            },
        });
        const final = await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
                status: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                    status?: string;
                };
                return e.type === 'turn_final' && e.conversationId === conversationId;
            },
            timeoutMs: 5000,
        });
        assert.equal(final.status, 'ok');
        const response = await toolCallPromise;
        assert.ok((response as {
            result?: unknown;
        }).result);
        const payload = JSON.parse((response as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result
            .content[0].text);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.conversationId, conversationId);
        assert.equal(calls[0]?.flags.threadId, undefined);
        assert.equal(payload.conversationId, conversationId);
        assert.equal(payload.modelId, savedModel);
        assert.equal(payload.segments[0]?.text, 'Fresh saved selected-repository Codex answer');
        assert.equal(memoryConversations.get(conversationId)?.model, savedModel);
        assert.equal(memoryConversations.get(conversationId)?.flags?.threadId, providerThreadId);
        const persistedTurns = getMemoryTurns(conversationId);
        const assistantTurn = persistedTurns.find((turn) => turn.role === 'assistant');
        assert.ok(assistantTurn);
        assert.equal(assistantTurn?.status, 'ok');
        assert.equal(assistantTurn?.content, 'Fresh saved selected-repository Codex answer');
        assert.equal(assistantTurn?.model, savedModel);
    }
    finally {
        deleteMemoryConversation(conversationId);
        memoryTurns.delete(conversationId);
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
        if (originalCodeWorkdir === undefined) {
            clearScopedTestEnvValue("CODEX_WORKDIR");
        }
        else {
            setScopedTestEnvValue("CODEX_WORKDIR", originalCodeWorkdir);
        }
        if (originalCodeInfoCodeWorkdir === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", originalCodeInfoCodeWorkdir);
        }
        await tempCodexHome.cleanup();
        await closeWs(ws);
        await wsHandle.close();
        resetToolDeps();
        mcpServer.close();
        wsHttp.close();
    }
});
test('omitted-provider MCP codebase_question records the first Codex thread after the working-folder edit route saves a mounted selected repository', async () => {
    resetStore();
    const calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
    }> = [];
    const conversationId = 'mcp-ws-codex-route-selected-repo';
    const providerThreadId = 'codex-thread-route-selected-901';
    const savedModel = 'gpt-5.3-codex';
    const advertisedHostPath = '/home/d_a_s/code/story55-manual-proof/queued-repo';
    const mountedPath = '/data/story55-manual-proof/queued-repo';
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalDefaultModel = process.env.CODEINFO_CHAT_DEFAULT_MODEL;
    const originalHostIngestDir = process.env.CODEINFO_HOST_INGEST_DIR;
    const originalCodexWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
    const originalForceAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
    const originalCodeHome = process.env.CODEX_HOME;
    const originalCodeInfoCodeHome = process.env.CODEINFO_CODEX_HOME;
    const tempCodexHome = await withTempCodexHome();
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'codex');
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL", 'gpt-5.1-codex-max');
    setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", '/home/d_a_s/code');
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/data');
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    setScopedTestEnvValue("CODEX_HOME", tempCodexHome.codexHome);
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", tempCodexHome.codexHome);
    setMemoryConversation({
        _id: conversationId,
        provider: 'codex',
        model: savedModel,
        title: 'Saved selected repository route-edited conversation',
        source: 'MCP',
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        archivedAt: null,
        flags: {},
    } as never);
    setWorkingFolderStatForTests(async (targetPath) => {
        if (targetPath === mountedPath) {
            return {
                isDirectory: () => true,
            } as never;
        }
        const error = new Error('missing') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
    });
    setToolDeps({
        chatFactory: () => new CapturingCodexMcpChat(calls, providerThreadId, 'Fresh route-selected-repository Codex answer'),
        clientFactory: makeLmStudioClientFactory(),
        listIngestedRepositoriesFn: async () => ({
            repos: [buildRepoEntry(advertisedHostPath)],
            lockedModelId: null,
        }),
    });
    const conversationsApp = express();
    conversationsApp.use(express.json());
    conversationsApp.use(createConversationsRouter({
        listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(advertisedHostPath)],
            lockedModelId: null,
        }),
    }));
    const conversationsHttp = http.createServer(conversationsApp);
    await new Promise<void>((resolve) => conversationsHttp.listen(0, resolve));
    const conversationsAddr = conversationsHttp.address() as AddressInfo;
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const ws = await connectWs({ baseUrl });
    try {
        const workingFolderResponse = await fetch(`http://127.0.0.1:${conversationsAddr.port}/conversations/${conversationId}/working-folder`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workingFolder: advertisedHostPath }),
        });
        assert.equal(workingFolderResponse.status, 200);
        assert.equal(memoryConversations.get(conversationId)?.flags?.workingFolder, mountedPath);
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        await waitForCondition(() => socketsSubscribedToConversation(conversationId).length > 0, 15000);
        const toolCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 107,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'Start a fresh omitted-provider Codex run after the working-folder edit route saves the mounted repository',
                    conversationId,
                },
            },
        });
        const final = await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
                status: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                    status?: string;
                };
                return e.type === 'turn_final' && e.conversationId === conversationId;
            },
            timeoutMs: 15000,
        });
        assert.equal(final.status, 'ok');
        const response = await toolCallPromise;
        assert.ok((response as {
            result?: unknown;
        }).result);
        const payload = JSON.parse((response as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result
            .content[0].text);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.conversationId, conversationId);
        assert.equal(calls[0]?.flags.threadId, undefined);
        assert.deepEqual(calls[0]?.flags.repositoryContext, {
            selectedRepositoryPath: mountedPath,
            defaultExecutionRoot: resolveAgentHomeEnv().codeInfoRoot,
            workingDirectoryOverride: mountedPath,
            fallbackUsed: false,
            workingRepositoryAvailable: true,
        });
        assert.equal(payload.conversationId, conversationId);
        assert.equal(payload.modelId, savedModel);
        assert.equal(memoryConversations.get(conversationId)?.flags?.threadId, providerThreadId);
        const persistedTurns = getMemoryTurns(conversationId);
        const assistantTurn = persistedTurns.find((turn) => turn.role === 'assistant');
        assert.ok(assistantTurn);
        assert.equal(assistantTurn?.status, 'ok');
        assert.equal(assistantTurn?.content, 'Fresh route-selected-repository Codex answer');
        assert.equal(assistantTurn?.model, savedModel);
    }
    finally {
        deleteMemoryConversation(conversationId);
        memoryTurns.delete(conversationId);
        setWorkingFolderStatForTests(undefined);
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
        if (originalHostIngestDir === undefined) {
            clearScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", originalHostIngestDir);
        }
        if (originalCodexWorkdir === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", originalCodexWorkdir);
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
        await tempCodexHome.cleanup();
        await closeWs(ws);
        await wsHandle.close();
        resetToolDeps();
        mcpServer.close();
        conversationsHttp.close();
        wsHttp.close();
    }
});
test('MCP codebase_question keeps Copilot provider parity on the streamed websocket path', async () => {
    resetStore();
    setToolDeps({
        chatFactory: () => new StreamingChat(),
        copilotReadinessResolver: async () => ({
            available: true,
            toolsAvailable: true,
            blockingStage: 'ready',
            models: ['copilot-gpt-5'],
            modelsRaw: [],
            authSource: 'env-token',
        }),
        clientFactory: makeLmStudioClientFactory(),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const conversationId = 'mcp-ws-copilot-conv-1';
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        const toolCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'What is up with Copilot?',
                    conversationId,
                    provider: 'copilot',
                    model: 'copilot-gpt-5',
                },
            },
        });
        const final = await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
                status: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                    status?: string;
                };
                return e.type === 'turn_final' && e.conversationId === conversationId;
            },
            timeoutMs: 5000,
        });
        assert.equal(final.status, 'ok');
        const response = await toolCallPromise;
        assert.ok((response as {
            result?: unknown;
        }).result);
    }
    finally {
        await closeWs(ws);
        await wsHandle.close();
        await new Promise<void>((resolve) => wsHttp.close(() => resolve()));
        await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
        resetToolDeps();
    }
});
test('MCP codebase_question keeps Copilot provider parity after startup re-normalizes an existing seeded runtime home', async () => {
    resetStore();
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-copilot-seed-'));
    const seedHome = path.join(tempRoot, 'seed-home');
    const runtimeHome = path.join(tempRoot, 'runtime-home');
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
    setToolDeps({
        chatFactory: () => new StreamingChat(),
        copilotReadinessResolver: async () => ({
            available: await hasReadableBootstrappedRuntime(runtimeHome),
            toolsAvailable: await hasReadableBootstrappedRuntime(runtimeHome),
            blockingStage: (await hasReadableBootstrappedRuntime(runtimeHome))
                ? 'ready'
                : 'authentication',
            models: (await hasReadableBootstrappedRuntime(runtimeHome))
                ? ['copilot-gpt-5']
                : [],
            modelsRaw: [],
            authSource: (await hasReadableBootstrappedRuntime(runtimeHome))
                ? 'sdk-status'
                : 'unauthenticated',
            reason: (await hasReadableBootstrappedRuntime(runtimeHome))
                ? undefined
                : 'copilot authentication required',
        }),
        clientFactory: makeLmStudioClientFactory(),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const conversationId = 'mcp-ws-copilot-repaired-seed';
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        const toolCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'Can Copilot still stream after startup ownership repair?',
                    conversationId,
                    provider: 'copilot',
                    model: 'copilot-gpt-5',
                },
            },
        });
        const final = await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
                status: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                    status?: string;
                };
                return e.type === 'turn_final' && e.conversationId === conversationId;
            },
            timeoutMs: 5000,
        });
        assert.equal(final.status, 'ok');
        const response = await toolCallPromise;
        assert.ok((response as {
            result?: unknown;
        }).result);
    }
    finally {
        await closeWs(ws);
        await wsHandle.close();
        await new Promise<void>((resolve) => wsHttp.close(() => resolve()));
        await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
        resetToolDeps();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
test('saved Copilot and LM Studio conversations keep the stored provider and repair omitted-model follow-up calls on the streamed websocket path', async () => {
    resetStore();
    const advertisedHostPath = '/home/d_a_s/code/story55-manual-proof/queued-repo';
    const cases = [
        {
            conversationId: 'mcp-ws-saved-copilot-follow-up',
            provider: 'copilot' as const,
            model: 'copilot-gpt-5',
            expectedExecutionModel: 'copilot-gpt-5',
            finalContent: 'Saved Copilot follow-up answer',
            deps: {
                copilotReadinessResolver: async () => ({
                    available: true,
                    toolsAvailable: true,
                    blockingStage: 'ready' as const,
                    models: ['copilot-gpt-5'],
                    modelsRaw: [],
                    authSource: 'env-token' as const,
                }),
            },
        },
        {
            conversationId: 'mcp-ws-saved-lmstudio-follow-up',
            provider: 'lmstudio' as const,
            model: 'huihui-qwen3.5-9b-abliterated',
            expectedExecutionModel: 'm',
            finalContent: 'Saved LM Studio follow-up answer',
            deps: {},
        },
    ];
    const originalCodeWorkdir = process.env.CODEX_WORKDIR;
    const originalCodeInfoCodeWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
    setScopedTestEnvValue("CODEX_WORKDIR", '/data');
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/data');
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    try {
        for (const testCase of cases) {
            const calls: Array<{
                flags: Record<string, unknown>;
                conversationId: string;
                model: string;
            }> = [];
            setMemoryConversation({
                _id: testCase.conversationId,
                provider: testCase.provider,
                model: testCase.model,
                title: `Saved ${testCase.provider} follow-up conversation`,
                source: 'MCP',
                lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
                createdAt: new Date('2025-01-01T00:00:00.000Z'),
                updatedAt: new Date('2025-01-01T00:00:00.000Z'),
                archivedAt: null,
                flags: {
                    workingFolder: '/data/story55-manual-proof/queued-repo',
                },
            } as never);
            setToolDeps({
                chatFactory: () => new CapturingPinnedConversationChat(calls, testCase.finalContent),
                clientFactory: makeLmStudioClientFactory(),
                listIngestedRepositoriesFn: async () => ({
                    repos: [buildRepoEntry(advertisedHostPath)],
                    lockedModelId: null,
                }),
                ...testCase.deps,
            });
            const ws = await connectWs({ baseUrl });
            try {
                sendJson(ws, {
                    type: 'subscribe_conversation',
                    conversationId: testCase.conversationId,
                });
                await waitForCondition(() => socketsSubscribedToConversation(testCase.conversationId).length > 0);
                const toolCallPromise = postJson(mcpAddr.port, {
                    jsonrpc: '2.0',
                    id: testCase.conversationId,
                    method: 'tools/call',
                    params: {
                        name: 'codebase_question',
                        arguments: {
                            question: `Reuse the saved ${testCase.provider} execution identity`,
                            conversationId: testCase.conversationId,
                        },
                    },
                });
                const final = await waitForEvent({
                    ws,
                    predicate: (event: unknown): event is {
                        type: string;
                        status: string;
                    } => {
                        const e = event as {
                            type?: string;
                            conversationId?: string;
                            status?: string;
                        };
                        return (e.type === 'turn_final' &&
                            e.conversationId === testCase.conversationId);
                    },
                    timeoutMs: 5000,
                });
                assert.equal(final.status, 'ok');
                const response = await toolCallPromise;
                assert.ok((response as {
                    result?: unknown;
                }).result, JSON.stringify({ response, calls }, null, 2));
                assert.equal(calls.length, 1);
                assert.equal(calls[0]?.conversationId, testCase.conversationId);
                assert.equal(calls[0]?.flags.provider, testCase.provider);
                assert.equal(normalizeModelIdForComparison(calls[0]?.model ?? ''), normalizeModelIdForComparison(testCase.expectedExecutionModel));
                const payload = JSON.parse((response as {
                    result: {
                        content: Array<{
                            text: string;
                        }>;
                    };
                }).result
                    .content[0].text);
                assert.equal(payload.conversationId, testCase.conversationId);
                assert.equal(normalizeModelIdForComparison(payload.modelId), normalizeModelIdForComparison(testCase.expectedExecutionModel));
                assert.equal(memoryConversations.get(testCase.conversationId)?.provider, testCase.provider);
                assert.equal(normalizeModelIdForComparison(memoryConversations.get(testCase.conversationId)?.model ?? ''), normalizeModelIdForComparison(testCase.expectedExecutionModel));
                const persistedTurns = getMemoryTurns(testCase.conversationId);
                const assistantTurn = persistedTurns.find((turn) => turn.role === 'assistant');
                assert.ok(assistantTurn);
                assert.equal(assistantTurn?.status, 'ok');
                assert.equal(normalizeModelIdForComparison(assistantTurn?.model ?? ''), normalizeModelIdForComparison(testCase.expectedExecutionModel));
            }
            finally {
                deleteMemoryConversation(testCase.conversationId);
                memoryTurns.delete(testCase.conversationId);
                await closeWs(ws);
                resetToolDeps();
            }
        }
    }
    finally {
        if (originalCodeWorkdir === undefined) {
            clearScopedTestEnvValue("CODEX_WORKDIR");
        }
        else {
            setScopedTestEnvValue("CODEX_WORKDIR", originalCodeWorkdir);
        }
        if (originalCodeInfoCodeWorkdir === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", originalCodeInfoCodeWorkdir);
        }
        await wsHandle.close();
        await new Promise<void>((resolve) => wsHttp.close(() => resolve()));
        await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
        resetToolDeps();
    }
});
test('MCP codebase_question exposes one deterministic in-progress replay claimant before provider completion and replays the completed result after cleanup', async () => {
    resetStore();
    const chat = new BlockingReplayClaimStreamingChat();
    setToolDeps({
        chatFactory: () => chat,
        clientFactory: makeLmStudioClientFactory(),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const conversationId = 'mcp-ws-replay-barrier-1';
    const replayId = 'logical-retry-1';
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        const firstCallPromise = postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 41,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'first logical follow-up',
                    conversationId,
                    replayId,
                    provider: 'lmstudio',
                    model: 'm',
                },
            },
        });
        await chat.waitForRunStart();
        assert.ok(getInflight(conversationId));
        const immediateReplay = await postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 42,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'contradictory stale retry',
                    conversationId,
                    replayId,
                    provider: 'lmstudio',
                    model: 'm',
                },
            },
        });
        assert.ok((immediateReplay as {
            result?: unknown;
        }).result);
        const immediateReplayPayload = JSON.parse((immediateReplay as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        })
            .result.content[0].text);
        assert.equal(chat.runs, 1);
        assert.equal(immediateReplayPayload.conversationId, conversationId);
        assert.equal(immediateReplayPayload.replay?.replayId, replayId);
        assert.equal(immediateReplayPayload.replay?.status, 'in_progress');
        assert.deepEqual(immediateReplayPayload.segments, []);
        chat.releaseRun();
        const firstResponse = await firstCallPromise;
        assert.ok((firstResponse as {
            result?: unknown;
        }).result);
        const firstPayload = JSON.parse((firstResponse as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result
            .content[0].text);
        assert.equal(firstPayload.replay?.status, 'completed');
        const firstFinal = await waitForEvent({
            ws,
            predicate: (event: unknown): event is {
                type: string;
                status: string;
            } => {
                const e = event as {
                    type?: string;
                    conversationId?: string;
                    status?: string;
                };
                return e.type === 'turn_final' && e.conversationId === conversationId;
            },
            timeoutMs: 5000,
        });
        assert.equal(firstFinal.status, 'ok');
        await waitForCondition(() => getCompletedInflightByReplayId({ conversationId, replayId }) !== null);
        await waitForCondition(() => getInflight(conversationId) === undefined);
        const cleanupReplay = await postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 43,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'retry after cleanup already ran',
                    conversationId,
                    replayId,
                    provider: 'lmstudio',
                    model: 'm',
                },
            },
        });
        assert.ok((cleanupReplay as {
            result?: unknown;
        }).result);
        const cleanupReplayPayload = JSON.parse((cleanupReplay as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result
            .content[0].text);
        assert.equal(chat.runs, 1);
        assert.deepEqual(cleanupReplayPayload, firstPayload);
    }
    finally {
        chat.releaseRun();
        await closeWs(ws);
        await wsHandle.close();
        await new Promise<void>((resolve) => wsHttp.close(() => resolve()));
        await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
        resetToolDeps();
    }
});
test('MCP codebase_question completed replay survives a completed-cache clear while incomplete persisted replay state stays reader-visible instead of rebuilding websocket provider work', async () => {
    resetStore();
    const calls: Array<{
        flags: Record<string, unknown>;
        conversationId: string;
        model: string;
    }> = [];
    setToolDeps({
        chatFactory: () => new CapturingPinnedConversationChat(calls, 'Durable websocket replay answer'),
        clientFactory: makeLmStudioClientFactory(),
    });
    const wsApp = express();
    const wsHttp = http.createServer(wsApp);
    const wsHandle = attachWs({ httpServer: wsHttp });
    await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
    const wsAddr = wsHttp.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${wsAddr.port}`;
    const mcpServer = http.createServer(handleRpc);
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddr = mcpServer.address() as AddressInfo;
    const conversationId = 'mcp-ws-durable-replay-1';
    const replayId = 'durable-replay-1';
    const ws = await connectWs({ baseUrl });
    try {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        const firstResponse = await postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 51,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'first durable websocket replay follow-up',
                    conversationId,
                    replayId,
                    provider: 'lmstudio',
                    model: 'm',
                },
            },
        });
        assert.ok((firstResponse as {
            result?: unknown;
        }).result);
        const firstPayload = JSON.parse((firstResponse as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result
            .content[0].text);
        const persistedTurns = getMemoryTurns(conversationId);
        const persistedUserTurn = persistedTurns.find((turn) => turn.role === 'user');
        const persistedAssistantTurn = persistedTurns.find((turn) => turn.role === 'assistant');
        assert.equal(persistedUserTurn?.runtime?.replay?.completed, false, JSON.stringify(persistedTurns, null, 2));
        assert.equal(persistedAssistantTurn?.runtime?.replay?.completed, true, JSON.stringify(persistedTurns, null, 2));
        __resetCompletedInflightForTests();
        setToolDeps({
            chatFactory: () => {
                throw new Error('replay should not rebuild websocket chat dependencies');
            },
            clientFactory: (() => {
                throw new Error('replay should not rebuild websocket provider deps');
            }) as never,
        });
        const replayAfterCacheClear = await postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 52,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'contradictory retry after websocket replay cache clear',
                    conversationId,
                    replayId,
                    provider: 'lmstudio',
                    model: 'm',
                },
            },
        });
        assert.ok((replayAfterCacheClear as {
            result?: unknown;
        }).result);
        const replayAfterCacheClearPayload = JSON.parse((replayAfterCacheClear as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result.content[0].text);
        assert.equal(calls.length, 1);
        assert.equal(replayAfterCacheClearPayload.conversationId, firstPayload.conversationId);
        assert.equal(replayAfterCacheClearPayload.modelId, firstPayload.modelId);
        assert.deepEqual(replayAfterCacheClearPayload.segments, firstPayload.segments);
        assert.equal(replayAfterCacheClearPayload.replay?.replayId, replayId);
        assert.equal(replayAfterCacheClearPayload.replay?.status, 'completed');
        setToolDeps({
            chatFactory: () => new CapturingPinnedConversationChat(calls, 'Durable websocket replay answer'),
            clientFactory: makeLmStudioClientFactory(),
        });
        const incompleteConversationId = 'mcp-ws-durable-replay-incomplete-1';
        memoryConversations.set(incompleteConversationId, {
            _id: incompleteConversationId,
            provider: 'lmstudio',
            model: 'm',
            title: 'Incomplete durable replay conversation',
            source: 'MCP',
            lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
            updatedAt: new Date('2025-01-01T00:00:00.000Z'),
            archivedAt: null,
            flags: {},
        } as never);
        recordMemoryTurn({
            conversationId: incompleteConversationId,
            role: 'user',
            content: 'persisted incomplete websocket replay request',
            model: 'm',
            provider: 'lmstudio',
            source: 'MCP',
            toolCalls: null,
            status: 'ok',
            runtime: {
                replay: {
                    replayId: 'incomplete-replay-1',
                    inflightId: 'persisted-incomplete',
                    completed: false,
                },
            },
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
        } as never);
        __resetCompletedInflightForTests();
        const freshAfterIncompletePersistedState = await postJson(mcpAddr.port, {
            jsonrpc: '2.0',
            id: 53,
            method: 'tools/call',
            params: {
                name: 'codebase_question',
                arguments: {
                    question: 'retry after incomplete persisted replay state',
                    conversationId: incompleteConversationId,
                    replayId: 'incomplete-replay-1',
                    provider: 'lmstudio',
                    model: 'm',
                },
            },
        });
        assert.ok((freshAfterIncompletePersistedState as {
            result?: unknown;
        }).result);
        const freshAfterIncompletePayload = JSON.parse((freshAfterIncompletePersistedState as {
            result: {
                content: Array<{
                    text: string;
                }>;
            };
        }).result.content[0].text);
        assert.equal(calls.length, 1);
        assert.equal(freshAfterIncompletePayload.conversationId, incompleteConversationId);
        assert.equal(freshAfterIncompletePayload.replay?.replayId, 'incomplete-replay-1');
        assert.equal(freshAfterIncompletePayload.replay?.status, 'in_progress');
        assert.deepEqual(freshAfterIncompletePayload.segments, []);
    }
    finally {
        memoryConversations.delete(conversationId);
        memoryTurns.delete(conversationId);
        memoryConversations.delete('mcp-ws-durable-replay-incomplete-1');
        memoryTurns.delete('mcp-ws-durable-replay-incomplete-1');
        __resetCompletedInflightForTests();
        await closeWs(ws);
        await wsHandle.close();
        await new Promise<void>((resolve) => wsHttp.close(() => resolve()));
        await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
        resetToolDeps();
    }
});
