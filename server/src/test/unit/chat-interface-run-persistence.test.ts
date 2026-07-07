import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { buildConversationFlags } from '../../chat/agentFlags.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { memoryConversations, memoryTurns, } from '../../chat/memoryPersistence.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { ConversationModel, type Conversation, type ConversationProvider, } from '../../mongo/conversation.js';
import type { AppendTurnInput } from '../../mongo/repo.js';
import { listConversations, updateConversationMeta, } from '../../mongo/repo.js';
import { TurnModel } from '../../mongo/turn.js';
import type { TurnRuntimeMetadata, TurnSource, TurnTimingMetadata, TurnUsageMetadata, } from '../../mongo/turn.js';
import { createChatRouter } from '../../routes/chat.js';
import { knownRepositoryPathsUnavailable, restoreSavedWorkingFolder, setWorkingFolderStatForTests, } from '../../workingFolders/state.js';
import { withConversationMetaNotFoundFixture } from '../support/conversationMetaNotFoundFixture.js';
const originalLmStudioBaseUrl = process.env.CODEINFO_LMSTUDIO_BASE_URL;
const buildRepoEntry = (containerPath: string): RepoEntry => ({
    id: path.basename(containerPath) || 'repo',
    description: null,
    containerPath,
    hostPath: containerPath,
    lastIngestAt: null,
    embeddingProvider: 'lmstudio',
    embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
    embeddingDimensions: 768,
    modelId: 'text-embedding-nomic-embed-text-v1.5',
    counts: { files: 0, chunks: 0, embedded: 0 },
    lastError: null,
});
const buildConversationDoc = (params: {
    conversationId: string;
    provider: ConversationProvider;
    model: string;
    flags: Record<string, unknown>;
    title?: string;
    lastMessageAt?: Date;
    updatedAt?: Date;
}) => ({
    _id: params.conversationId,
    provider: params.provider,
    model: params.model,
    title: params.title ?? 'conversation-title',
    source: 'REST',
    flags: params.flags,
    lastMessageAt: params.lastMessageAt ?? new Date('2025-01-01T00:00:00.000Z'),
    archivedAt: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: params.updatedAt ?? new Date('2025-01-01T00:00:00.000Z'),
}) as never;
class PersistSpyChat extends ChatInterface {
    public persisted: Array<{
        role: string;
        content: string;
        model: string;
        provider: string;
        source?: string;
        runtime?: TurnRuntimeMetadata;
        usage?: TurnUsageMetadata;
        timing?: TurnTimingMetadata;
    }> = [];
    public executeCalls = 0;
    private readonly completeEvent?: {
        usage?: TurnUsageMetadata;
        timing?: TurnTimingMetadata;
    };
    private readonly beforeComplete?: () => void;
    constructor(params?: {
        completeEvent?: {
            usage?: TurnUsageMetadata;
            timing?: TurnTimingMetadata;
        };
        beforeComplete?: () => void;
    }) {
        super();
        this.completeEvent = params?.completeEvent;
        this.beforeComplete = params?.beforeComplete;
    }
    protected override async persistTurn(input: AppendTurnInput & {
        source?: TurnSource;
    }): Promise<{
        turnId?: string;
    }> {
        this.persisted.push({
            role: input.role,
            content: input.content,
            model: input.model,
            provider: input.provider,
            source: input.source,
            ...(input.runtime !== undefined ? { runtime: input.runtime } : {}),
            ...(input.usage !== undefined ? { usage: input.usage } : {}),
            ...(input.timing !== undefined ? { timing: input.timing } : {}),
        });
        return {};
    }
    async execute(): Promise<void> {
        this.executeCalls += 1;
        this.emitEvent({ type: 'token', content: 'partial' });
        this.emitEvent({ type: 'final', content: 'assistant-reply' });
        if (this.beforeComplete) {
            this.beforeComplete();
        }
        this.emitEvent({
            type: 'complete',
            ...(this.completeEvent ?? {}),
        });
    }
}
class RetryExhaustedChat extends ChatInterface {
    public executeCalls = 0;
    async execute(): Promise<void> {
        this.executeCalls += 1;
    }
}
class RouteChat extends ChatInterface {
    async execute(_message: string, _flags: Record<string, unknown>, conversationId: string, _model: string): Promise<void> {
        void _message;
        void _flags;
        void _model;
        this.emitEvent({ type: 'thread', threadId: conversationId });
        this.emitEvent({ type: 'final', content: 'assistant-reply' });
        this.emitEvent({ type: 'complete' });
    }
}
const withReadyState = async (readyState: number, nodeEnv: string, fn: () => Promise<void>) => {
    const originalEnv = process.env.NODE_ENV;
    const originalReady = mongoose.connection.readyState;
    const previousLmStudioBaseUrl = process.env.CODEINFO_LMSTUDIO_BASE_URL;
    Object.defineProperty(mongoose.connection, 'readyState', {
        value: readyState,
        configurable: true,
    });
    setScopedTestEnvValue("NODE_ENV", nodeEnv);
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'http://127.0.0.1:1234');
    try {
        await fn();
    }
    finally {
        Object.defineProperty(mongoose.connection, 'readyState', {
            value: originalReady,
            configurable: true,
        });
        setScopedTestEnvValue("NODE_ENV", originalEnv);
        if (previousLmStudioBaseUrl === undefined) {
            clearScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL");
        }
        else {
            setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", previousLmStudioBaseUrl);
        }
    }
};
describe('ChatInterface.run persistence', () => {
    afterEach(() => {
        setWorkingFolderStatForTests(undefined);
        memoryConversations.clear();
        memoryTurns.clear();
        if (originalLmStudioBaseUrl === undefined) {
            clearScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL");
        }
        else {
            setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", originalLmStudioBaseUrl);
        }
    });
    test('persists user turn then executes when Mongo is available', async () => {
        const chat = new PersistSpyChat();
        await withReadyState(1, 'development', async () => {
            await chat.run('hello', { provider: 'codex', source: 'REST' }, 'conv-a', 'model-a');
        });
        assert.equal(chat.executeCalls, 1);
        assert.equal(chat.persisted.length, 2);
        assert.deepEqual(chat.persisted[0], {
            role: 'user',
            content: 'hello',
            model: 'model-a',
            provider: 'codex',
            source: 'REST',
        });
        const assistant = chat.persisted[1];
        assert.equal(assistant.role, 'assistant');
        assert.equal(assistant.content, 'assistant-reply');
        assert.equal(assistant.model, 'model-a');
        assert.equal(assistant.provider, 'codex');
        assert.equal(assistant.source, 'REST');
        if (assistant.timing) {
            assert.equal(typeof assistant.timing.totalTimeSec, 'number');
        }
    });
    test('skips Mongo and does not call persistTurn when using memory fallback', async () => {
        const chat = new PersistSpyChat();
        await withReadyState(0, 'test', async () => {
            await chat.run('hello', { provider: 'lmstudio', source: 'MCP' }, 'conv-b', 'model-b');
        });
        assert.equal(chat.executeCalls, 1);
        assert.equal(chat.persisted.length, 0);
    });
    test('persists assistant usage/timing when completion provides metadata', async () => {
        const chat = new PersistSpyChat({
            completeEvent: {
                usage: {
                    inputTokens: 12,
                    outputTokens: 8,
                    totalTokens: 20,
                    cachedInputTokens: 2,
                },
                timing: {
                    totalTimeSec: 1.25,
                    tokensPerSecond: 16,
                },
            },
        });
        await withReadyState(1, 'development', async () => {
            await chat.run('hello', { provider: 'lmstudio', source: 'REST' }, 'conv-c', 'model-c');
        });
        assert.equal(chat.persisted.length, 2);
        assert.deepEqual(chat.persisted[1].usage, {
            inputTokens: 12,
            outputTokens: 8,
            totalTokens: 20,
            cachedInputTokens: 2,
        });
        assert.deepEqual(chat.persisted[1].timing, {
            totalTimeSec: 1.25,
            tokensPerSecond: 16,
        });
    });
    test('assistant persistence omits usage and only persists derived timing when available', async () => {
        const chat = new PersistSpyChat();
        await withReadyState(1, 'development', async () => {
            await chat.run('hello', { provider: 'lmstudio', source: 'REST' }, 'conv-d', 'model-d');
        });
        assert.equal(chat.persisted.length, 2);
        assert.equal(chat.persisted[1].usage, undefined);
        const timing = chat.persisted[1].timing;
        if (timing) {
            assert.equal(typeof timing.totalTimeSec, 'number');
            assert.equal(timing.tokensPerSecond, undefined);
        }
    });
    test('fallback timing uses run start when provider timing missing', async () => {
        let now = 10000;
        const originalNow = Date.now;
        Date.now = () => now;
        const chat = new PersistSpyChat({
            beforeComplete: () => {
                now = 11500;
            },
        });
        try {
            await withReadyState(1, 'development', async () => {
                await chat.run('hello', { provider: 'lmstudio', source: 'REST' }, 'conv-e', 'model-e');
            });
        }
        finally {
            Date.now = originalNow;
        }
        assert.equal(chat.persisted.length, 2);
        const totalTimeSec = chat.persisted[1].timing?.totalTimeSec ?? 0;
        assert.ok(Math.abs(totalTimeSec - 1.5) < 0.001);
    });
    test('persists Turn.runtime in the Mongo-backed path', async () => {
        const chat = new PersistSpyChat();
        await withReadyState(1, 'development', async () => {
            await chat.run('hello', {
                provider: 'lmstudio',
                source: 'REST',
                runtime: {
                    workingFolder: '/repos/working-root',
                    lookupSummary: {
                        selectedRepositoryPath: '/repos/working-root',
                        fallbackUsed: false,
                        workingRepositoryAvailable: true,
                    },
                },
            }, 'conv-runtime-mongo', 'model-runtime');
        });
        assert.equal(chat.persisted.length, 2);
        assert.deepEqual(chat.persisted[0].runtime, {
            workingFolder: '/repos/working-root',
            lookupSummary: {
                selectedRepositoryPath: '/repos/working-root',
                fallbackUsed: false,
                workingRepositoryAvailable: true,
            },
        });
    });
    test('persists Turn.runtime in the memory-backed path', async () => {
        const chat = new PersistSpyChat();
        memoryConversations.set('conv-runtime-memory', {
            _id: 'conv-runtime-memory',
            provider: 'lmstudio',
            model: 'model-runtime',
            title: 'Runtime memory test',
            source: 'REST',
            flags: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            lastMessageAt: new Date(),
            archivedAt: null,
        });
        try {
            await withReadyState(0, 'test', async () => {
                await chat.run('hello', {
                    provider: 'lmstudio',
                    source: 'REST',
                    runtime: {
                        workingFolder: '/repos/working-root',
                        lookupSummary: {
                            selectedRepositoryPath: '/repos/working-root',
                            fallbackUsed: false,
                            workingRepositoryAvailable: true,
                        },
                    },
                }, 'conv-runtime-memory', 'model-runtime');
            });
            const turns = memoryTurns.get('conv-runtime-memory') ?? [];
            assert.equal(turns.length, 2);
            assert.deepEqual(turns[0]?.runtime, {
                workingFolder: '/repos/working-root',
                lookupSummary: {
                    selectedRepositoryPath: '/repos/working-root',
                    fallbackUsed: false,
                    workingRepositoryAvailable: true,
                },
            });
        }
        finally {
            memoryConversations.delete('conv-runtime-memory');
            memoryTurns.delete('conv-runtime-memory');
        }
    });
    test('a successful chat run persists the selected working folder on the owning conversation', async () => {
        const app = express();
        app.use('/chat', createChatRouter({
            clientFactory: () => ({
                system: {
                    listDownloadedModels: async () => [{ modelKey: 'lmstudio-test' }],
                },
            }) as never,
            chatFactory: () => new RouteChat(),
            listIngestedRepositoriesFn: async () => ({
                repos: [buildRepoEntry(process.cwd())],
                lockedModelId: null,
            }),
        }));
        await withReadyState(0, 'test', async () => {
            const res = await request(app).post('/chat').send({
                provider: 'lmstudio',
                model: 'lmstudio-test',
                message: 'hello',
                conversationId: 'chat-working-folder-save',
                working_folder: process.cwd(),
            });
            assert.equal(res.status, 202);
        });
        try {
            assert.equal(memoryConversations.get('chat-working-folder-save')?.flags
                ?.workingFolder, process.cwd());
        }
        finally {
            memoryConversations.delete('chat-working-folder-save');
            memoryTurns.delete('chat-working-folder-save');
        }
    });
    test('a successful chat run persists stable agentFlags keys on the owning conversation', async () => {
        const app = express();
        app.use('/chat', createChatRouter({
            clientFactory: () => ({
                system: {
                    listDownloadedModels: async () => [{ modelKey: 'lmstudio-test' }],
                },
            }) as never,
            chatFactory: () => new RouteChat(),
            listIngestedRepositoriesFn: async () => ({
                repos: [buildRepoEntry(process.cwd())],
                lockedModelId: null,
            }),
        }));
        await withReadyState(0, 'test', async () => {
            const res = await request(app)
                .post('/chat')
                .send({
                provider: 'lmstudio',
                model: 'lmstudio-test',
                message: 'hello',
                conversationId: 'chat-agent-flags-save',
                agentFlags: {
                    temperature: 0.7,
                    maxTokens: 1234,
                    contextOverflowPolicy: 'rollingWindow',
                    toolAccess: 'off',
                },
            });
            assert.equal(res.status, 202);
        });
        try {
            assert.deepEqual(memoryConversations.get('chat-agent-flags-save')?.flags?.agentFlags, {
                temperature: 0.7,
                maxTokens: 1234,
                contextOverflowPolicy: 'rollingWindow',
                toolAccess: 'off',
            });
        }
        finally {
            memoryConversations.delete('chat-agent-flags-save');
            memoryTurns.delete('chat-agent-flags-save');
        }
    });
    test('an invalid saved chat working folder is cleared before the chat restore path uses it', async () => {
        let clearedConversationId: string | undefined;
        const restored = await restoreSavedWorkingFolder({
            conversation: {
                conversationId: 'chat-restore-clear',
                flags: {
                    workingFolder: path.join(process.cwd(), 'definitely-missing'),
                },
            },
            surface: 'chat_run',
            clearPersistedWorkingFolder: async (conversationId): Promise<string | undefined> => {
                clearedConversationId = conversationId;
                return undefined;
            },
        });
        assert.equal(restored, undefined);
        assert.equal(clearedConversationId, 'chat-restore-clear');
    });
    test('an operational saved chat working folder failure is not cleared as stale', async () => {
        let clearedConversationId: string | undefined;
        setWorkingFolderStatForTests(async (targetPath) => {
            if (targetPath.includes('temporarily-unreadable')) {
                const error = new Error('permission denied') as NodeJS.ErrnoException;
                error.code = 'EACCES';
                throw error;
            }
            return {
                isDirectory: () => true,
            } as never;
        });
        await assert.rejects(async () => await restoreSavedWorkingFolder({
            conversation: {
                conversationId: 'chat-restore-unavailable',
                flags: {
                    workingFolder: path.join(process.cwd(), 'temporarily-unreadable-working-folder'),
                },
            },
            surface: 'chat_run',
            clearPersistedWorkingFolder: async (conversationId): Promise<string | undefined> => {
                clearedConversationId = conversationId;
                return undefined;
            },
        }), (error) => (error as {
            code?: string;
            causeCode?: string;
        }).code ===
            'WORKING_FOLDER_UNAVAILABLE' &&
            (error as {
                code?: string;
                causeCode?: string;
            }).causeCode === 'EACCES');
        assert.equal(clearedConversationId, undefined);
    });
    test('repository enumeration failure does not clear a saved chat working folder as stale', async () => {
        let clearedConversationId: string | undefined;
        const missingExternalRepo = path.join(path.parse(process.cwd()).root, 'tmp', 'external-working-folder');
        await assert.rejects(async () => await restoreSavedWorkingFolder({
            conversation: {
                conversationId: 'chat-restore-repo-enumeration-unavailable',
                flags: {
                    workingFolder: missingExternalRepo,
                },
            },
            surface: 'chat_run',
            clearPersistedWorkingFolder: async (conversationId): Promise<string | undefined> => {
                clearedConversationId = conversationId;
                return undefined;
            },
            knownRepositoryPathsState: knownRepositoryPathsUnavailable(new Error('repo list offline')),
        }), (error) => (error as {
            code?: string;
            reason?: string;
        }).code ===
            'WORKING_FOLDER_REPOSITORY_UNAVAILABLE' &&
            (error as {
                code?: string;
                reason?: string;
            }).reason ===
                'repo list offline');
        assert.equal(clearedConversationId, undefined);
    });
    test('an invalid saved chat working folder is cleared before the next chat run reuses it', async () => {
        memoryConversations.set('chat-working-folder-clear', {
            _id: 'chat-working-folder-clear',
            provider: 'lmstudio',
            model: 'lmstudio-test',
            title: 'Chat conversation',
            source: 'REST',
            flags: {
                workingFolder: path.join(process.cwd(), 'definitely-missing-chat-path'),
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            lastMessageAt: new Date(),
            archivedAt: null,
        });
        try {
            const restored = await restoreSavedWorkingFolder({
                conversation: memoryConversations.get('chat-working-folder-clear')!,
                surface: 'chat_run',
                clearPersistedWorkingFolder: async (conversationId): Promise<string | undefined> => {
                    const current = memoryConversations.get(conversationId);
                    if (!current)
                        return undefined;
                    const nextFlags = { ...(current.flags ?? {}) };
                    delete nextFlags.workingFolder;
                    memoryConversations.set(conversationId, {
                        ...current,
                        flags: nextFlags,
                    } as never);
                    return undefined;
                },
            });
            assert.equal(restored, undefined);
            assert.equal(memoryConversations.get('chat-working-folder-clear')?.flags
                ?.workingFolder, undefined);
        }
        finally {
            memoryConversations.delete('chat-working-folder-clear');
            memoryTurns.delete('chat-working-folder-clear');
        }
    });
    test('non-Codex persistence paths clear stale Codex threadId state before the next execution context is saved', async () => {
        memoryConversations.set('chat-threadid-clear', {
            _id: 'chat-threadid-clear',
            provider: 'lmstudio',
            model: 'lmstudio-test',
            title: 'Thread cleanup conversation',
            source: 'REST',
            flags: {
                threadId: 'codex-thread-1',
                agentFlags: {
                    toolAccess: 'off',
                },
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            lastMessageAt: new Date(),
            archivedAt: null,
        });
        const app = express();
        app.use('/chat', createChatRouter({
            clientFactory: () => ({
                system: {
                    listDownloadedModels: async () => [{ modelKey: 'lmstudio-test' }],
                },
            }) as never,
            chatFactory: () => new RouteChat(),
            listIngestedRepositoriesFn: async () => ({
                repos: [buildRepoEntry(process.cwd())],
                lockedModelId: null,
            }),
        }));
        try {
            await withReadyState(0, 'test', async () => {
                const res = await request(app)
                    .post('/chat')
                    .send({
                    provider: 'lmstudio',
                    model: 'lmstudio-test',
                    message: 'hello',
                    conversationId: 'chat-threadid-clear',
                    agentFlags: {
                        toolAccess: 'off',
                    },
                });
                assert.equal(res.status, 202);
            });
            assert.deepEqual(memoryConversations.get('chat-threadid-clear')?.flags, {
                agentFlags: {
                    contextOverflowPolicy: 'truncateMiddle',
                    maxTokens: 4096,
                    temperature: 0.2,
                    toolAccess: 'off',
                },
            });
        }
        finally {
            memoryConversations.delete('chat-threadid-clear');
            memoryTurns.delete('chat-threadid-clear');
        }
    });
    test('chat turn runtime metadata includes the working-folder snapshot when a chat run uses one', async () => {
        const app = express();
        app.use('/chat', createChatRouter({
            clientFactory: () => ({
                system: {
                    listDownloadedModels: async () => [{ modelKey: 'lmstudio-test' }],
                },
            }) as never,
            chatFactory: () => new RouteChat(),
            listIngestedRepositoriesFn: async () => ({
                repos: [buildRepoEntry(process.cwd())],
                lockedModelId: null,
            }),
        }));
        try {
            await withReadyState(0, 'test', async () => {
                await request(app).post('/chat').send({
                    provider: 'lmstudio',
                    model: 'lmstudio-test',
                    message: 'hello',
                    conversationId: 'chat-runtime-working-folder',
                    working_folder: process.cwd(),
                });
            });
            const turns = memoryTurns.get('chat-runtime-working-folder') ?? [];
            assert.equal(turns[0]?.runtime?.workingFolder, process.cwd());
        }
        finally {
            memoryConversations.delete('chat-runtime-working-folder');
            memoryTurns.delete('chat-runtime-working-folder');
        }
    });
    test('updateConversationMeta stores endpointId separately from the raw model id', async () => {
        const originalReady = mongoose.connection.readyState;
        Object.defineProperty(mongoose.connection, 'readyState', {
            value: 1,
            configurable: true,
        });
        const originalFindById = ConversationModel.findById;
        const original = ConversationModel.findOneAndUpdate;
        let capturedUpdate: unknown;
        ConversationModel.findById = (() => ({
            lean: () => ({
                exec: async () => ({
                    _id: 'endpoint-conversation',
                    provider: 'codex',
                    model: 'gpt-5.2',
                    flags: {},
                    updatedAt: new Date('2024-12-31T00:00:00.000Z'),
                }) as never,
            }),
        })) as unknown as typeof ConversationModel.findById;
        ConversationModel.findOneAndUpdate = ((...args: unknown[]) => {
            capturedUpdate = args[1];
            return {
                exec: async () => buildConversationDoc({
                    conversationId: 'endpoint-conversation',
                    provider: 'codex',
                    model: 'gpt-5.2',
                    flags: args[1] as Record<string, unknown>,
                    lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
                    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
                }),
            } as unknown as ReturnType<typeof ConversationModel.findOneAndUpdate>;
        }) as typeof ConversationModel.findOneAndUpdate;
        try {
            await updateConversationMeta({
                conversationId: 'endpoint-conversation',
                provider: 'codex',
                model: 'gpt-5.2',
                flags: {
                    endpointId: 'https://alpha.example/v1',
                    workingFolder: '/repos/working-root',
                },
                lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
            });
        }
        finally {
            ConversationModel.findById = originalFindById;
            ConversationModel.findOneAndUpdate = original;
            Object.defineProperty(mongoose.connection, 'readyState', {
                value: originalReady,
                configurable: true,
            });
        }
        assert.deepEqual(capturedUpdate, {
            provider: 'codex',
            model: 'gpt-5.2',
            flags: {
                endpointId: 'https://alpha.example/v1',
                workingFolder: '/repos/working-root',
            },
            lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
        });
    });
    test('updateConversationMeta preserves fresher endpointId, threadId, workingFolder, and flow flags when a stale snapshot retries after an intervening write', async () => {
        const originalReady = mongoose.connection.readyState;
        Object.defineProperty(mongoose.connection, 'readyState', {
            value: 1,
            configurable: true,
        });
        const originalFindById = ConversationModel.findById;
        const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;
        const capturedCalls: Array<{
            filter: unknown;
            update: unknown;
        }> = [];
        let readCount = 0;
        const staleFlags = {
            endpointId: 'https://stale.example/v1',
            workingFolder: '/repos/stale-root',
            threadId: 'thread-stale',
            flow: { status: 'queued' },
            agentFlags: { modelReasoningEffort: 'low' },
        };
        const freshFlags = {
            endpointId: 'https://fresh.example/v1',
            workingFolder: '/repos/fresh-root',
            threadId: 'thread-fresh',
            flow: { status: 'running' },
            agentFlags: { modelReasoningEffort: 'high' },
        };
        ConversationModel.findById = ((conversationId: unknown) => ({
            lean: () => ({
                exec: async () => {
                    readCount += 1;
                    return readCount === 1
                        ? ({
                            _id: conversationId,
                            provider: 'codex',
                            model: 'gpt-5.2',
                            flags: staleFlags,
                            updatedAt: new Date('2025-02-02T00:00:00.000Z'),
                        } as never)
                        : ({
                            _id: conversationId,
                            provider: 'codex',
                            model: 'gpt-5.2',
                            flags: freshFlags,
                            updatedAt: new Date('2025-03-03T00:00:00.000Z'),
                        } as never);
                },
            }),
        })) as unknown as typeof ConversationModel.findById;
        ConversationModel.findOneAndUpdate = ((filter: unknown, update: unknown) => {
            capturedCalls.push({ filter, update });
            return {
                exec: async () => capturedCalls.length === 1
                    ? null
                    : buildConversationDoc({
                        conversationId: 'stale-snapshot-conversation',
                        provider: 'codex',
                        model: 'gpt-5.2',
                        flags: (update as {
                            flags?: Record<string, unknown>;
                        }).flags ?? {},
                        lastMessageAt: new Date('2025-02-02T00:00:00.000Z'),
                        updatedAt: new Date('2025-03-03T00:00:00.000Z'),
                    }),
            } as unknown as ReturnType<typeof ConversationModel.findOneAndUpdate>;
        }) as typeof ConversationModel.findOneAndUpdate;
        try {
            await updateConversationMeta({
                conversationId: 'stale-snapshot-conversation',
                provider: 'codex',
                model: 'gpt-5.2',
                flags: {
                    endpointId: 'https://stale.example/v1',
                    workingFolder: '/repos/stale-root',
                    threadId: 'thread-stale',
                    flow: { status: 'queued' },
                    agentFlags: {
                        modelReasoningEffort: 'low',
                    },
                },
                lastMessageAt: new Date('2025-02-02T00:00:00.000Z'),
            });
        }
        finally {
            ConversationModel.findById = originalFindById;
            ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
            Object.defineProperty(mongoose.connection, 'readyState', {
                value: originalReady,
                configurable: true,
            });
        }
        assert.equal(capturedCalls.length, 2);
        assert.deepEqual(capturedCalls[0]?.filter, {
            _id: 'stale-snapshot-conversation',
            updatedAt: new Date('2025-02-02T00:00:00.000Z'),
        });
        assert.deepEqual(capturedCalls[0]?.update, {
            provider: 'codex',
            model: 'gpt-5.2',
            flags: {
                endpointId: 'https://stale.example/v1',
                workingFolder: '/repos/stale-root',
                threadId: 'thread-stale',
                flow: { status: 'queued' },
                agentFlags: {
                    modelReasoningEffort: 'low',
                },
            },
            lastMessageAt: new Date('2025-02-02T00:00:00.000Z'),
        });
        assert.deepEqual(capturedCalls[1]?.filter, {
            _id: 'stale-snapshot-conversation',
            updatedAt: new Date('2025-03-03T00:00:00.000Z'),
        });
        assert.deepEqual(capturedCalls[1]?.update, {
            provider: 'codex',
            model: 'gpt-5.2',
            flags: {
                endpointId: 'https://fresh.example/v1',
                workingFolder: '/repos/fresh-root',
                threadId: 'thread-fresh',
                flow: { status: 'running' },
                agentFlags: {
                    modelReasoningEffort: 'high',
                },
            },
            lastMessageAt: new Date('2025-02-02T00:00:00.000Z'),
        });
    });
    test('updateConversationMeta returns retry_exhausted after repeated intervening writers keep advancing updatedAt', async () => {
        const originalReady = mongoose.connection.readyState;
        Object.defineProperty(mongoose.connection, 'readyState', {
            value: 1,
            configurable: true,
        });
        const originalFindById = ConversationModel.findById;
        const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;
        const capturedCalls: Array<{
            filter: unknown;
            update: unknown;
        }> = [];
        const conversationId = 'retry-exhausted-conversation';
        const staleFlags = {
            endpointId: 'https://stale.example/v1',
            workingFolder: '/repos/stale-root',
            threadId: 'thread-stale',
            flow: { status: 'queued' },
            agentFlags: { modelReasoningEffort: 'low' },
        };
        const winnerFlags = [
            {
                endpointId: 'https://winner-1.example/v1',
                workingFolder: '/repos/winner-1-root',
                threadId: 'thread-winner-1',
                flow: { status: 'running' },
                agentFlags: { modelReasoningEffort: 'medium' },
            },
            {
                endpointId: 'https://winner-2.example/v1',
                workingFolder: '/repos/winner-2-root',
                threadId: 'thread-winner-2',
                flow: { status: 'running' },
                agentFlags: { modelReasoningEffort: 'high' },
            },
            {
                endpointId: 'https://winner-3.example/v1',
                workingFolder: '/repos/winner-3-root',
                threadId: 'thread-winner-3',
                flow: { status: 'running' },
                agentFlags: { modelReasoningEffort: 'veryHigh' },
            },
            {
                endpointId: 'https://winner-4.example/v1',
                workingFolder: '/repos/winner-4-root',
                threadId: 'thread-winner-4',
                flow: { status: 'running' },
                agentFlags: { modelReasoningEffort: 'extreme' },
            },
        ] as const;
        const updatedAtValues = [
            new Date('2025-02-02T00:00:00.000Z'),
            new Date('2025-02-03T00:00:00.000Z'),
            new Date('2025-02-04T00:00:00.000Z'),
            new Date('2025-02-05T00:00:00.000Z'),
        ];
        let stateIndex = 0;
        let storedConversation = buildConversationDoc({
            conversationId,
            provider: 'codex',
            model: 'gpt-5.2',
            flags: staleFlags,
            lastMessageAt: updatedAtValues[0],
            updatedAt: updatedAtValues[0],
        }) as Conversation;
        ConversationModel.findById = ((returnedConversationId: unknown) => ({
            lean: () => ({
                exec: async () => ({
                    ...(storedConversation as unknown as Record<string, unknown>),
                    _id: returnedConversationId,
                }) as never,
            }),
        })) as unknown as typeof ConversationModel.findById;
        ConversationModel.findOneAndUpdate = ((filter: unknown, update: unknown) => {
            capturedCalls.push({ filter, update });
            if (stateIndex < winnerFlags.length - 1) {
                stateIndex += 1;
                storedConversation = buildConversationDoc({
                    conversationId,
                    provider: 'codex',
                    model: 'gpt-5.2',
                    flags: winnerFlags[stateIndex],
                    lastMessageAt: updatedAtValues[stateIndex],
                    updatedAt: updatedAtValues[stateIndex],
                }) as Conversation;
            }
            return {
                exec: async () => null,
            } as unknown as ReturnType<typeof ConversationModel.findOneAndUpdate>;
        }) as typeof ConversationModel.findOneAndUpdate;
        try {
            const outcome = await updateConversationMeta({
                conversationId,
                provider: 'codex',
                model: 'gpt-5.2',
                flags: staleFlags,
                lastMessageAt: updatedAtValues[0],
            });
            assert.equal(outcome.outcome, 'retry_exhausted');
            assert.deepEqual(outcome.conversation.flags, winnerFlags[3]);
            assert.deepEqual(outcome.conversation.updatedAt, updatedAtValues[3]);
        }
        finally {
            ConversationModel.findById = originalFindById;
            ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
            Object.defineProperty(mongoose.connection, 'readyState', {
                value: originalReady,
                configurable: true,
            });
        }
        assert.equal(capturedCalls.length, 3);
        assert.deepEqual(capturedCalls[0]?.filter, {
            _id: conversationId,
            updatedAt: updatedAtValues[0],
        });
        assert.deepEqual(capturedCalls[0]?.update, {
            provider: 'codex',
            model: 'gpt-5.2',
            flags: staleFlags,
            lastMessageAt: updatedAtValues[0],
        });
        assert.deepEqual(capturedCalls[1]?.filter, {
            _id: conversationId,
            updatedAt: updatedAtValues[1],
        });
        assert.deepEqual(capturedCalls[1]?.update, {
            provider: 'codex',
            model: 'gpt-5.2',
            flags: winnerFlags[1],
            lastMessageAt: updatedAtValues[0],
        });
        assert.deepEqual(capturedCalls[2]?.filter, {
            _id: conversationId,
            updatedAt: updatedAtValues[2],
        });
        assert.deepEqual(capturedCalls[2]?.update, {
            provider: 'codex',
            model: 'gpt-5.2',
            flags: winnerFlags[2],
            lastMessageAt: updatedAtValues[0],
        });
        assert.deepEqual(storedConversation.flags, winnerFlags[3]);
        assert.deepEqual(storedConversation.updatedAt, updatedAtValues[3]);
    });
    test('ChatInterface.run stops before execute when persisted turn metadata retries exhaust', async () => {
        const originalReady = mongoose.connection.readyState;
        Object.defineProperty(mongoose.connection, 'readyState', {
            value: 1,
            configurable: true,
        });
        const originalFindById = ConversationModel.findById;
        const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;
        const originalTurnCreate = TurnModel.create;
        const conversationId = 'chat-run-retry-exhausted';
        const chat = new RetryExhaustedChat();
        const existingConversation = buildConversationDoc({
            conversationId,
            provider: 'codex',
            model: 'model-a',
            flags: {
                endpointId: 'https://stale.example/v1',
                workingFolder: '/repos/stale-root',
                threadId: 'thread-stale',
            },
            lastMessageAt: new Date('2025-05-05T00:00:00.000Z'),
            updatedAt: new Date('2025-05-05T00:00:00.000Z'),
        }) as Conversation;
        ConversationModel.findById = ((returnedConversationId: unknown) => ({
            lean: () => ({
                exec: async () => ({
                    ...(existingConversation as unknown as Record<string, unknown>),
                    _id: returnedConversationId,
                }) as never,
            }),
            exec: async () => ({
                ...(existingConversation as unknown as Record<string, unknown>),
                _id: returnedConversationId,
            }) as never,
        })) as unknown as typeof ConversationModel.findById;
        ConversationModel.findOneAndUpdate = (() => ({
            exec: async () => null,
        })) as unknown as typeof ConversationModel.findOneAndUpdate;
        TurnModel.create = (async (input: Record<string, unknown>) => ({
            _id: 'turn-retry-exhausted',
            ...structuredClone(input),
        })) as typeof TurnModel.create;
        try {
            await withReadyState(1, 'development', async () => {
                await assert.rejects(chat.run('hello', { provider: 'codex', source: 'REST' }, conversationId, 'model-a'), (error) => error instanceof Error &&
                    error.message === 'chat turn metadata update exhausted');
            });
        }
        finally {
            ConversationModel.findById = originalFindById;
            ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
            TurnModel.create = originalTurnCreate;
            Object.defineProperty(mongoose.connection, 'readyState', {
                value: originalReady,
                configurable: true,
            });
        }
        assert.equal(chat.executeCalls, 0);
    });
    test('updateConversationMeta returns not_found distinctly from retry_exhausted when the conversation is missing', async () => {
        const originalReady = mongoose.connection.readyState;
        Object.defineProperty(mongoose.connection, 'readyState', {
            value: 1,
            configurable: true,
        });
        const originalFindById = ConversationModel.findById;
        ConversationModel.findById = (() => ({
            lean: () => ({
                exec: async () => null,
            }),
        })) as unknown as typeof ConversationModel.findById;
        try {
            const outcome = await updateConversationMeta({
                conversationId: 'missing-conversation',
                provider: 'codex',
                model: 'gpt-5.2',
                flags: {
                    endpointId: 'https://missing.example/v1',
                    workingFolder: '/repos/missing-root',
                },
                lastMessageAt: new Date('2025-02-06T00:00:00.000Z'),
            });
            assert.deepEqual(outcome, { outcome: 'not_found' });
        }
        finally {
            ConversationModel.findById = originalFindById;
            Object.defineProperty(mongoose.connection, 'readyState', {
                value: originalReady,
                configurable: true,
            });
        }
    });
    test('updateConversationMeta returns not_found after a concurrent delete and does not reintroduce stale metadata on refresh', async () => {
        const staleFlags = {
            endpointId: 'https://stale.example/v1',
            requestedProviderId: 'codex',
            workingFolder: '/repos/stale-root',
            threadId: 'thread-stale',
            flow: { status: 'queued' },
        } as const;
        const seedConversation: Conversation = {
            _id: 'missing-after-delete-conversation',
            provider: 'codex',
            model: 'gpt-5.2',
            title: 'missing after delete',
            source: 'REST',
            flags: { ...staleFlags },
            lastMessageAt: new Date('2025-02-05T00:00:00.000Z'),
            archivedAt: null,
            createdAt: new Date('2025-02-01T00:00:00.000Z'),
            updatedAt: new Date('2025-02-05T00:00:00.000Z'),
        } as Conversation;
        await withConversationMetaNotFoundFixture({
            seedConversation,
            run: async ({ conversations, capturedUpdates }) => {
                const outcome = await updateConversationMeta({
                    conversationId: seedConversation._id,
                    provider: 'codex',
                    model: 'gpt-5.3-codex',
                    flags: {
                        endpointId: 'https://fresh.example/v1',
                        requestedProviderId: 'copilot',
                        workingFolder: '/repos/fresh-root',
                        threadId: 'thread-fresh',
                        flow: { status: 'running' },
                    },
                    lastMessageAt: new Date('2025-02-06T00:00:00.000Z'),
                });
                assert.deepEqual(outcome, { outcome: 'not_found' });
                assert.equal(conversations.get(seedConversation._id), undefined);
                assert.equal(capturedUpdates.length, 1);
                assert.deepEqual(capturedUpdates[0]?.filter, {
                    _id: seedConversation._id,
                    updatedAt: seedConversation.updatedAt,
                });
                assert.deepEqual(capturedUpdates[0]?.update, {
                    provider: 'codex',
                    model: 'gpt-5.3-codex',
                    flags: {
                        endpointId: 'https://fresh.example/v1',
                        requestedProviderId: 'copilot',
                        workingFolder: '/repos/fresh-root',
                        threadId: 'thread-fresh',
                        flow: { status: 'running' },
                    },
                    lastMessageAt: new Date('2025-02-06T00:00:00.000Z'),
                });
            },
        });
    });
    test('ChatInterface.run stops before execute when persisted turn metadata reports not_found after a concurrent delete', async () => {
        const originalTurnCreate = TurnModel.create;
        const conversationId = 'chat-run-not-found';
        const chat = new RetryExhaustedChat();
        const seedConversation = buildConversationDoc({
            conversationId,
            provider: 'codex',
            model: 'model-a',
            flags: {
                endpointId: 'https://stale.example/v1',
                workingFolder: '/repos/stale-root',
                threadId: 'thread-stale',
                flow: { status: 'queued' },
            },
            lastMessageAt: new Date('2025-05-05T00:00:00.000Z'),
            updatedAt: new Date('2025-05-05T00:00:00.000Z'),
        }) as Conversation;
        TurnModel.create = (async (input: Record<string, unknown>) => ({
            _id: 'turn-not-found',
            ...structuredClone(input),
        })) as typeof TurnModel.create;
        try {
            await withConversationMetaNotFoundFixture({
                seedConversation,
                run: async ({ conversations, capturedUpdates }) => {
                    await withReadyState(1, 'development', async () => {
                        await assert.rejects(chat.run('hello', { provider: 'codex', source: 'REST' }, conversationId, 'model-a'), (error) => error instanceof Error &&
                            error.message === 'chat turn conversation metadata not found');
                    });
                    assert.equal(chat.executeCalls, 0);
                    assert.equal(conversations.get(conversationId), undefined);
                    assert.equal(capturedUpdates.length, 1);
                    assert.ok((capturedUpdates[0]?.filter as {
                        _id?: string;
                    } | undefined)?._id ===
                        conversationId);
                    assert.equal((capturedUpdates[0]?.update as {
                        lastMessageAt?: unknown;
                    })
                        ?.lastMessageAt instanceof Date, true);
                },
            });
        }
        finally {
            TurnModel.create = originalTurnCreate;
        }
    });
    test('updateConversationMeta drops stale Codex-only flags when provider switches to Copilot', async () => {
        const originalReady = mongoose.connection.readyState;
        Object.defineProperty(mongoose.connection, 'readyState', {
            value: 1,
            configurable: true,
        });
        const originalFindById = ConversationModel.findById;
        const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;
        let capturedUpdate: unknown;
        ConversationModel.findById = ((conversationId: unknown) => ({
            lean: () => ({
                exec: async () => ({
                    _id: conversationId,
                    provider: 'codex',
                    model: 'gpt-5.2',
                    flags: {
                        endpointId: 'https://alpha.example/v1',
                        requestedProviderId: 'codex',
                        workingFolder: '/repos/current-root',
                        threadId: 'codex-thread-stale',
                        flow: { status: 'running' },
                        agentFlags: {
                            sandboxMode: 'read-only',
                            approvalPolicy: 'never',
                            toolAccess: 'off',
                        },
                    },
                }) as never,
            }),
        })) as unknown as typeof ConversationModel.findById;
        ConversationModel.findOneAndUpdate = ((_conversationId: unknown, update: unknown) => {
            capturedUpdate = update;
            return {
                exec: async () => buildConversationDoc({
                    conversationId: 'provider-switch-conversation',
                    provider: 'copilot',
                    model: 'copilot-gpt-5',
                    flags: (update as {
                        flags?: Record<string, unknown>;
                    }).flags ?? {},
                    lastMessageAt: new Date('2025-03-03T00:00:00.000Z'),
                    updatedAt: new Date('2025-03-03T00:00:00.000Z'),
                }),
            } as unknown as ReturnType<typeof ConversationModel.findOneAndUpdate>;
        }) as typeof ConversationModel.findOneAndUpdate;
        try {
            await updateConversationMeta({
                conversationId: 'provider-switch-conversation',
                provider: 'copilot',
                model: 'copilot-gpt-5',
                flags: {
                    requestedProviderId: 'copilot',
                    agentFlags: {
                        modelReasoningEffort: 'medium',
                    },
                },
                lastMessageAt: new Date('2025-03-03T00:00:00.000Z'),
            });
        }
        finally {
            ConversationModel.findById = originalFindById;
            ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
            Object.defineProperty(mongoose.connection, 'readyState', {
                value: originalReady,
                configurable: true,
            });
        }
        assert.deepEqual(capturedUpdate, {
            provider: 'copilot',
            model: 'copilot-gpt-5',
            flags: {
                endpointId: 'https://alpha.example/v1',
                requestedProviderId: 'copilot',
                workingFolder: '/repos/current-root',
                flow: { status: 'running' },
                agentFlags: {
                    modelReasoningEffort: 'medium',
                },
            },
            lastMessageAt: new Date('2025-03-03T00:00:00.000Z'),
        });
    });
    test('updateConversationMeta replaceFlags clears stale endpointId and threadId on Mongo-backed writes', async () => {
        const originalReady = mongoose.connection.readyState;
        Object.defineProperty(mongoose.connection, 'readyState', {
            value: 1,
            configurable: true,
        });
        const originalFindById = ConversationModel.findById;
        const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;
        let capturedUpdate: unknown;
        ConversationModel.findById = ((conversationId: unknown) => ({
            lean: () => ({
                exec: async () => ({
                    _id: conversationId,
                    provider: 'codex',
                    model: 'gpt-5.2',
                    flags: {
                        endpointId: 'https://alpha.example/v1',
                        requestedProviderId: 'codex',
                        workingFolder: '/repos/current-root',
                        threadId: 'codex-thread-stale',
                        flow: { status: 'running' },
                        agentFlags: {
                            sandboxMode: 'read-only',
                            approvalPolicy: 'never',
                        },
                    },
                }) as never,
            }),
        })) as unknown as typeof ConversationModel.findById;
        ConversationModel.findOneAndUpdate = ((_conversationId: unknown, update: unknown) => {
            capturedUpdate = update;
            return {
                exec: async () => buildConversationDoc({
                    conversationId: 'replace-flags-conversation',
                    provider: 'copilot',
                    model: 'copilot-gpt-5',
                    flags: (update as {
                        flags?: Record<string, unknown>;
                    }).flags ?? {},
                    lastMessageAt: new Date('2025-04-04T00:00:00.000Z'),
                    updatedAt: new Date('2025-04-04T00:00:00.000Z'),
                }),
            } as unknown as ReturnType<typeof ConversationModel.findOneAndUpdate>;
        }) as typeof ConversationModel.findOneAndUpdate;
        try {
            await updateConversationMeta({
                conversationId: 'replace-flags-conversation',
                provider: 'copilot',
                model: 'copilot-gpt-5',
                flags: buildConversationFlags({
                    provider: 'copilot',
                    currentFlags: {
                        endpointId: 'https://alpha.example/v1',
                        requestedProviderId: 'codex',
                        workingFolder: '/repos/current-root',
                        threadId: 'codex-thread-stale',
                        flow: { status: 'running' },
                        agentFlags: {
                            sandboxMode: 'read-only',
                            approvalPolicy: 'never',
                        },
                    },
                    agentFlags: {
                        modelReasoningEffort: 'medium',
                    },
                    workingFolder: '/repos/current-root',
                    endpointId: null,
                    threadId: null,
                    preserveFlowState: false,
                }),
                replaceFlags: true,
                lastMessageAt: new Date('2025-04-04T00:00:00.000Z'),
            });
        }
        finally {
            ConversationModel.findById = originalFindById;
            ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
            Object.defineProperty(mongoose.connection, 'readyState', {
                value: originalReady,
                configurable: true,
            });
        }
        assert.deepEqual(capturedUpdate, {
            provider: 'copilot',
            model: 'copilot-gpt-5',
            flags: {
                requestedProviderId: 'codex',
                workingFolder: '/repos/current-root',
                agentFlags: {
                    modelReasoningEffort: 'medium',
                },
            },
            lastMessageAt: new Date('2025-04-04T00:00:00.000Z'),
        });
    });
    test('listConversations reads legacy conversations that do not yet have endpointId', async () => {
        const originalFind = ConversationModel.find;
        (ConversationModel as unknown as Record<string, unknown>).find = () => ({
            sort: () => ({
                limit: () => ({
                    lean: async () => [
                        {
                            _id: 'legacy-endpoint-conversation',
                            provider: 'codex',
                            model: 'gpt-5.2',
                            title: 'Legacy endpoint conversation',
                            source: 'REST',
                            flags: {
                                workingFolder: '/repos/legacy-root',
                            },
                            createdAt: new Date('2025-01-01T00:00:00Z'),
                            updatedAt: new Date('2025-01-01T00:00:00Z'),
                            lastMessageAt: new Date('2025-01-01T00:00:00Z'),
                            archivedAt: null,
                        },
                    ] as unknown[],
                }),
            }),
        });
        try {
            const { items } = await listConversations({
                limit: 10,
                includeArchived: true,
            });
            assert.equal(items.length, 1);
            assert.deepEqual(items[0]?.flags, {
                workingFolder: '/repos/legacy-root',
            });
        }
        finally {
            (ConversationModel as unknown as Record<string, unknown>).find =
                originalFind;
        }
    });
});
