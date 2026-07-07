import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';
import { __resetCompletedInflightForTests, appendAnalysisDelta, appendAssistantDelta, appendToolEvent, bumpSeq, cleanupInflight, createInflight, getInflight, markInflightPersisted, markInflightFinal, } from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { getMemoryTurns, memoryConversations, memoryTurns, } from '../../chat/memoryPersistence.js';
import { ConversationModel } from '../../mongo/conversation.js';
import type { TurnSummary } from '../../mongo/repo.js';
import { createChatRouter } from '../../routes/chat.js';
import { createConversationsRouter } from '../../routes/conversations.js';
import { withConversationMetaNotFoundFixture } from '../support/conversationMetaNotFoundFixture.js';
import { withMockedMongoConversationPersistence } from '../support/conversationMongoPersistenceStub.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';
const appWith = (overrides: Parameters<typeof createConversationsRouter>[0]) => {
    const app = express();
    app.use(express.json());
    app.use(createConversationsRouter(overrides));
    return app;
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const buildRepoEntry = (containerPath: string) => ({
    id: path.posix.basename(containerPath.replace(/\\/g, '/')) || 'repo',
    description: null,
    containerPath,
    hostPath: containerPath,
    lastIngestAt: null,
    embeddingProvider: 'lmstudio',
    embeddingModel: 'model',
    embeddingDimensions: 768,
    model: 'model',
    modelId: 'model',
    lock: {
        embeddingProvider: 'lmstudio',
        embeddingModel: 'model',
        embeddingDimensions: 768,
        lockedModelId: 'model',
        modelId: 'model',
    },
    counts: { files: 0, chunks: 0, embedded: 0 },
    lastError: null,
}) as const;
class ScriptedChat extends ChatInterface {
    constructor(private readonly script: (chat: ChatInterface, signal?: AbortSignal) => Promise<void>) {
        super();
    }
    async execute(_message: string, flags: Record<string, unknown>, conversationId: string, model: string): Promise<void> {
        void model;
        const signal = (flags as {
            signal?: AbortSignal;
        }).signal;
        if (signal?.aborted) {
            this.emit('error', { type: 'error', message: 'aborted' });
            return;
        }
        this.emit('thread', { type: 'thread', threadId: conversationId });
        await this.script(this, signal);
    }
}
class CountingChat extends ChatInterface {
    public executeCalls = 0;
    async execute(_message: string, _flags: Record<string, unknown>, conversationId: string, _model: string): Promise<void> {
        void _message;
        void _flags;
        void _model;
        this.executeCalls += 1;
        this.emit('thread', { type: 'thread', threadId: conversationId });
        this.emit('final', { type: 'final', content: 'assistant-reply' });
        this.emit('complete', { type: 'complete', threadId: conversationId });
    }
}
async function waitForChatPersistence(conversationId: string, expectedTurnCount: number, timeoutMs = 4000) {
    const deadline = Date.now() + resolveConfiguredTestTimeoutMs(timeoutMs);
    while (Date.now() < deadline) {
        const turns = getMemoryTurns(conversationId);
        if (turns.length === expectedTurnCount &&
            getInflight(conversationId) === undefined) {
            return turns;
        }
        await delay(25);
    }
    throw new Error(`Timed out waiting for persisted chat turns: ${conversationId}`);
}
function createChatApp(chatFactory: () => ChatInterface) {
    const app = express();
    app.use(express.json());
    app.use('/chat', createChatRouter({
        clientFactory: () => ({
            system: {
                listDownloadedModels: async () => [
                    { modelKey: 'model-1', displayName: 'model-1', type: 'llm' },
                ],
            },
        }) as unknown as LMStudioClient,
        chatFactory,
        listIngestedRepositoriesFn: async () => ({
            repos: [buildRepoEntry(process.cwd())],
            lockedModelId: null,
        }),
    }));
    return app;
}
test('returns full turn history newest-first (ignores pagination query)', async () => {
    const turns: TurnSummary[] = [
        {
            turnId: 't2',
            conversationId: 'c1',
            role: 'assistant',
            content: 'hi',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T10:00:00Z'),
        },
        {
            turnId: 't1',
            conversationId: 'c1',
            role: 'user',
            content: 'hello',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T09:00:00Z'),
        },
    ];
    const res = await request(appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        listAllTurns: async () => ({ items: turns }),
    }))
        .get('/conversations/c1/turns?limit=1&cursor=2025-01-01T00:00:00.000Z')
        .expect(200);
    assert.equal(res.body.items[0].content, 'hi');
    assert.equal(typeof res.body.items[0].turnId, 'string');
    assert.equal(res.body.items.length, 2);
    assert.equal('nextCursor' in res.body, false);
});
test('returns not_found when conversation is missing', async () => {
    const res = await request(appWith({ findConversationById: async () => null }))
        .get('/conversations/missing/turns')
        .expect(404);
    assert.equal(res.body.error, 'not_found');
});
test('completed replay requests stay INFLIGHT_ALREADY_COMPLETED after completed-cache loss and before any conversation metadata rewrite', async () => {
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'http://localhost:1234');
    memoryConversations.clear();
    memoryTurns.clear();
    const conversationId = 'c-replay-persisted';
    const inflightId = 'i-replay-persisted';
    const app = createChatApp(() => new ScriptedChat(async (chat) => {
        chat.emit('final', { type: 'final', content: 'done' });
        chat.emit('complete', { type: 'complete', threadId: 'thread-1' });
    }));
    const first = await request(app).post('/chat').send({
        provider: 'lmstudio',
        model: 'model-1',
        conversationId,
        inflightId,
        message: 'hello',
    });
    assert.equal(first.status, 202);
    await waitForChatPersistence(conversationId, 2);
    const persistedConversationBeforeReplay = memoryConversations.get(conversationId);
    assert.ok(persistedConversationBeforeReplay);
    const replay = await request(app).post('/chat').send({
        provider: 'lmstudio',
        model: 'model-1',
        conversationId,
        inflightId,
        message: 'hello',
    });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.code, 'INFLIGHT_ALREADY_COMPLETED');
    __resetCompletedInflightForTests();
    const replayAfterCacheClear = await request(app).post('/chat').send({
        provider: 'lmstudio',
        model: 'model-1',
        conversationId,
        inflightId,
        message: 'hello',
    });
    assert.equal(replayAfterCacheClear.status, 409);
    assert.equal(replayAfterCacheClear.body.code, 'INFLIGHT_ALREADY_COMPLETED');
    const contradictoryReplay = await request(app).post('/chat').send({
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        conversationId,
        inflightId,
        message: 'mutate the stored conversation',
    });
    assert.equal(contradictoryReplay.status, 409);
    assert.equal(contradictoryReplay.body.code, 'INFLIGHT_ALREADY_COMPLETED');
    const persistedTurns = getMemoryTurns(conversationId);
    assert.equal(persistedTurns.length, 2);
    assert.equal(persistedTurns.filter((turn) => turn.role === 'user').length, 1);
    assert.equal(persistedTurns.filter((turn) => turn.role === 'assistant').length, 1);
    assert.equal(persistedTurns[0]?.content, 'hello');
    assert.equal(persistedTurns[1]?.content, 'done');
    const persistedConversationAfterReplay = memoryConversations.get(conversationId);
    assert.ok(persistedConversationAfterReplay);
    assert.equal(persistedConversationAfterReplay?.provider, persistedConversationBeforeReplay?.provider);
    assert.equal(persistedConversationAfterReplay?.model, persistedConversationBeforeReplay?.model);
    assert.deepEqual(persistedConversationAfterReplay?.flags ?? {}, persistedConversationBeforeReplay?.flags ?? {});
    assert.equal(persistedConversationAfterReplay?.lastMessageAt?.toISOString(), persistedConversationBeforeReplay?.lastMessageAt?.toISOString());
});
test('stops the /chat append-turn path when metadata retries exhaust before reload and response return', async () => {
    const conversationId = 'c-retry-exhausted-chat';
    const chat = new CountingChat();
    await withMockedMongoConversationPersistence({
        seedConversations: [
            {
                _id: conversationId,
                provider: 'lmstudio',
                model: 'model-1',
                title: 'retry exhausted chat',
                source: 'REST',
                flags: {
                    endpointId: 'https://stale.example/v1',
                    workingFolder: '/repos/stale-root',
                    threadId: 'thread-stale',
                },
                archivedAt: null,
                createdAt: new Date('2025-01-01T00:00:00.000Z'),
                updatedAt: new Date('2025-01-01T00:00:00.000Z'),
                lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
            } as never,
        ],
        run: async ({ conversations }) => {
            const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;
            ConversationModel.findOneAndUpdate = ((() => ({
                exec: async () => null,
            })) as unknown) as typeof ConversationModel.findOneAndUpdate;
            try {
                const response = await request(createChatApp(() => chat))
                    .post('/chat')
                    .send({
                    provider: 'lmstudio',
                    model: 'model-1',
                    conversationId,
                    message: 'hello',
                });
                assert.equal(response.status, 400);
                assert.equal(chat.executeCalls, 0);
                assert.equal(conversations.get(conversationId)?.updatedAt?.toISOString(), '2025-01-01T00:00:00.000Z');
            }
            finally {
                ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
            }
        },
    });
});
test('stops the /chat append-turn path when metadata write reports not_found after a concurrent delete', async () => {
    const conversationId = 'c-not-found-chat';
    const chat = new CountingChat();
    const expectedWorkingFolder = process.cwd();
    const seedConversation = {
        _id: conversationId,
        provider: 'lmstudio',
        model: 'model-1',
        title: 'missing chat conversation',
        source: 'REST',
        flags: {
            threadId: 'thread-stale',
            flow: { status: 'queued' },
            workingFolder: '/repos/stale-root',
        },
        archivedAt: null,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        lastMessageAt: new Date('2025-01-01T00:00:00.000Z'),
    } as const;
    await withMockedMongoConversationPersistence({
        seedConversations: [seedConversation as never],
        run: async () => {
            await withConversationMetaNotFoundFixture({
                seedConversation: seedConversation as never,
                run: async ({ conversations, capturedUpdates }) => {
                    const response = await request(createChatApp(() => chat))
                        .post('/chat')
                        .send({
                        provider: 'lmstudio',
                        model: 'model-1',
                        conversationId,
                        message: 'hello',
                        working_folder: process.cwd(),
                    });
                    assert.equal(response.status, 410);
                    assert.equal(response.body.status, 'error');
                    assert.equal(response.body.code, 'CONVERSATION_ARCHIVED');
                    assert.equal(response.body.message, 'Conversation is archived and must be restored before use.');
                    assert.equal(chat.executeCalls, 0);
                    assert.equal(conversations.get(conversationId), undefined);
                    assert.equal(capturedUpdates.length, 1);
                    assert.deepEqual(capturedUpdates[0]?.filter, {
                        _id: conversationId,
                        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
                    });
                    assert.deepEqual((capturedUpdates[0]?.update as Record<string, unknown>).flags, {
                        workingFolder: expectedWorkingFolder,
                        agentFlags: {
                            temperature: 0.2,
                            maxTokens: 4096,
                            contextOverflowPolicy: 'truncateMiddle',
                            toolAccess: 'on',
                        },
                    });
                    const capturedFlags = (capturedUpdates[0]?.update as Record<string, unknown>).flags as Record<string, unknown>;
                    assert.equal('threadId' in capturedFlags, false);
                    assert.equal('flow' in capturedFlags, false);
                    assert.equal(typeof (capturedUpdates[0]?.update as Record<string, unknown>)
                        .lastMessageAt, 'object');
                    assert.equal('provider' in response.body, false);
                    assert.equal('model' in response.body, false);
                    assert.equal('error' in response.body, false);
                },
            });
        },
    });
});
test('inflight-only snapshot returns inflight items and inflight payload', async () => {
    createInflight({
        conversationId: 'c1',
        inflightId: 'i1',
        provider: 'lmstudio',
        model: 'llama',
        source: 'REST',
        userTurn: {
            content: 'hello',
            createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
        },
    });
    appendAssistantDelta({ conversationId: 'c1', inflightId: 'i1', delta: 'Hi' });
    bumpSeq('c1');
    appendAnalysisDelta({
        conversationId: 'c1',
        inflightId: 'i1',
        delta: 'thinking...',
    });
    bumpSeq('c1');
    appendToolEvent({
        conversationId: 'c1',
        inflightId: 'i1',
        event: {
            type: 'tool-request',
            callId: 'call-1',
            name: 'VectorSearch',
            parameters: { query: 'hello' },
        },
    });
    bumpSeq('c1');
    try {
        const res = await request(appWith({
            findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
            listAllTurns: async () => ({ items: [] }),
        }))
            .get('/conversations/c1/turns')
            .expect(200);
        assert.equal(Array.isArray(res.body.items), true);
        assert.equal(res.body.items.length, 2);
        assert.equal(res.body.items[0].role, 'assistant');
        assert.equal(res.body.items[0].content, 'Hi');
        assert.equal(res.body.items[1].role, 'user');
        assert.equal(res.body.items[1].content, 'hello');
        assert.equal(typeof res.body.inflight?.inflightId, 'string');
        assert.equal(res.body.inflight.inflightId, 'i1');
        assert.equal(res.body.inflight.assistantText, 'Hi');
        assert.equal(res.body.inflight.assistantThink, 'thinking...');
        assert.equal(Array.isArray(res.body.inflight.toolEvents), true);
        assert.equal(res.body.inflight.toolEvents.length, 1);
        assert.equal(res.body.inflight.toolEvents[0].type, 'tool-request');
        assert.equal(res.body.inflight.toolEvents[0].name, 'VectorSearch');
        assert.equal(typeof res.body.inflight.startedAt, 'string');
        assert.equal(typeof res.body.inflight.seq, 'number');
        assert.ok(res.body.inflight.seq >= 0);
    }
    finally {
        cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
    }
});
test('returns the existing inflight snapshot payload when revisiting a running conversation', async () => {
    const persisted: TurnSummary[] = [
        {
            turnId: 't2',
            conversationId: 'c-running',
            role: 'assistant',
            content: 'Earlier reply',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T00:00:01.000Z'),
        },
        {
            turnId: 't1',
            conversationId: 'c-running',
            role: 'user',
            content: 'Earlier prompt',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
        },
    ];
    createInflight({
        conversationId: 'c-running',
        inflightId: 'i-running',
        provider: 'lmstudio',
        model: 'llama',
        source: 'REST',
        userTurn: {
            content: 'Earlier prompt',
            createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
        },
    });
    appendAssistantDelta({
        conversationId: 'c-running',
        inflightId: 'i-running',
        delta: 'Persisted partial',
    });
    bumpSeq('c-running');
    try {
        const res = await request(appWith({
            findConversationById: async () => ({
                _id: 'c-running',
                archivedAt: null,
            }),
            listAllTurns: async () => ({ items: persisted }),
        }))
            .get('/conversations/c-running/turns')
            .expect(200);
        assert.equal(res.body.items[0].content, 'Earlier reply');
        assert.equal(res.body.inflight?.inflightId, 'i-running');
        assert.equal(res.body.inflight?.assistantText, 'Persisted partial');
        assert.equal(res.body.inflight?.seq, 1);
    }
    finally {
        cleanupInflight({ conversationId: 'c-running', inflightId: 'i-running' });
    }
});
test('inflight snapshot returns command metadata when present', async () => {
    createInflight({
        conversationId: 'c1',
        inflightId: 'i1',
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        source: 'REST',
        command: { name: 'improve_plan', stepIndex: 2, totalSteps: 6 },
        userTurn: {
            content: 'run command',
            createdAt: new Date('2025-01-02T00:00:00.000Z').toISOString(),
        },
    });
    try {
        const res = await request(appWith({
            findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
            listAllTurns: async () => ({ items: [] }),
        }))
            .get('/conversations/c1/turns')
            .expect(200);
        assert.equal(res.body.inflight?.inflightId, 'i1');
        assert.deepEqual(res.body.inflight.command, {
            name: 'improve_plan',
            stepIndex: 2,
            totalSteps: 6,
        });
    }
    finally {
        cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
    }
});
test('persisted turns preserve absolute command metadata for startStep-offset runs', async () => {
    const turns: TurnSummary[] = [
        {
            turnId: 't-offset-assistant',
            conversationId: 'c-offset',
            role: 'assistant',
            content: 'offset result',
            model: 'gpt-5.1-codex-max',
            provider: 'codex',
            source: 'REST',
            toolCalls: null,
            command: { name: 'offset', stepIndex: 3, totalSteps: 5 },
            status: 'ok',
            createdAt: new Date('2025-01-06T10:00:00Z'),
        },
        {
            turnId: 't-offset-user',
            conversationId: 'c-offset',
            role: 'user',
            content: 'offset input',
            model: 'gpt-5.1-codex-max',
            provider: 'codex',
            source: 'REST',
            toolCalls: null,
            command: { name: 'offset', stepIndex: 3, totalSteps: 5 },
            status: 'ok',
            createdAt: new Date('2025-01-06T09:59:00Z'),
        },
    ];
    const res = await request(appWith({
        findConversationById: async () => ({ _id: 'c-offset', archivedAt: null }),
        listAllTurns: async () => ({ items: turns }),
    }))
        .get('/conversations/c-offset/turns')
        .expect(200);
    assert.equal(res.body.items[0].turnId, 't-offset-assistant');
    assert.deepEqual(res.body.items[0].command, {
        name: 'offset',
        stepIndex: 3,
        totalSteps: 5,
    });
    assert.deepEqual(res.body.items[1].command, {
        name: 'offset',
        stepIndex: 3,
        totalSteps: 5,
    });
});
test('inflight snapshot omits command metadata when absent', async () => {
    createInflight({
        conversationId: 'c1',
        inflightId: 'i1',
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        source: 'REST',
        userTurn: {
            content: 'run command',
            createdAt: new Date('2025-01-03T00:00:00.000Z').toISOString(),
        },
    });
    try {
        const res = await request(appWith({
            findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
            listAllTurns: async () => ({ items: [] }),
        }))
            .get('/conversations/c1/turns')
            .expect(200);
        assert.equal(res.body.inflight?.inflightId, 'i1');
        assert.equal('command' in res.body.inflight, false);
    }
    finally {
        cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
    }
});
test('inflight final status yields assistant turn even with empty assistantText', async () => {
    createInflight({
        conversationId: 'c1',
        inflightId: 'i1',
        provider: 'lmstudio',
        model: 'llama',
        source: 'REST',
        userTurn: {
            content: 'hello',
            createdAt: new Date('2025-01-04T00:00:00.000Z').toISOString(),
        },
    });
    markInflightFinal({
        conversationId: 'c1',
        inflightId: 'i1',
        status: 'ok',
        finalizedAt: new Date('2025-01-04T00:00:01.000Z').toISOString(),
    });
    try {
        const res = await request(appWith({
            findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
            listAllTurns: async () => ({ items: [] }),
        }))
            .get('/conversations/c1/turns')
            .expect(200);
        const assistant = res.body.items.find((turn: {
            role?: string;
        }) => turn.role === 'assistant');
        assert.equal(assistant?.content, '');
        assert.equal(assistant?.status, 'ok');
    }
    finally {
        cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
    }
});
test('returns full history when no inflight exists', async () => {
    const turns: TurnSummary[] = [
        {
            turnId: 't4',
            conversationId: 'c1',
            role: 'assistant',
            content: 'second assistant',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T10:01:00Z'),
        },
        {
            turnId: 't3',
            conversationId: 'c1',
            role: 'user',
            content: 'second user',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T10:00:00Z'),
        },
        {
            turnId: 't2',
            conversationId: 'c1',
            role: 'assistant',
            content: 'first assistant',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T09:01:00Z'),
        },
        {
            turnId: 't1',
            conversationId: 'c1',
            role: 'user',
            content: 'first user',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T09:00:00Z'),
        },
    ];
    const res = await request(appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        listAllTurns: async () => ({ items: turns }),
    }))
        .get('/conversations/c1/turns')
        .expect(200);
    assert.equal(res.body.items.length, 4);
    assert.equal(res.body.items[0].content, 'second assistant');
    assert.equal(res.body.items[3].content, 'first user');
    assert.equal(res.body.inflight, undefined);
});
test('omits the inflight payload when revisiting a completed conversation', async () => {
    const turns: TurnSummary[] = [
        {
            turnId: 't2',
            conversationId: 'c-complete',
            role: 'assistant',
            content: 'Final reply',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T00:00:01.000Z'),
        },
        {
            turnId: 't1',
            conversationId: 'c-complete',
            role: 'user',
            content: 'Earlier prompt',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
        },
    ];
    const res = await request(appWith({
        findConversationById: async () => ({
            _id: 'c-complete',
            archivedAt: null,
        }),
        listAllTurns: async () => ({ items: turns }),
    }))
        .get('/conversations/c-complete/turns')
        .expect(200);
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.items[0].content, 'Final reply');
    assert.equal('inflight' in res.body, false);
    assert.equal(res.body.inflight, undefined);
});
test('dedupes inflight merge by turnId and preserves newest-first ordering', async () => {
    const userCreatedAt = new Date('2025-01-01T00:00:00.000Z').toISOString();
    createInflight({
        conversationId: 'c1',
        inflightId: 'i1',
        provider: 'lmstudio',
        model: 'llama',
        source: 'REST',
        userTurn: { content: 'inflight user', createdAt: userCreatedAt },
    });
    markInflightPersisted({
        conversationId: 'c1',
        inflightId: 'i1',
        role: 'user',
        turnId: 't-user',
    });
    appendAssistantDelta({
        conversationId: 'c1',
        inflightId: 'i1',
        delta: 'inflight assistant',
    });
    markInflightPersisted({
        conversationId: 'c1',
        inflightId: 'i1',
        role: 'assistant',
        turnId: 't-assistant',
    });
    const persisted: TurnSummary[] = [
        {
            turnId: 't-assistant',
            conversationId: 'c1',
            role: 'assistant',
            content: 'persisted assistant',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T00:00:00.500Z'),
        },
        {
            turnId: 't-user',
            conversationId: 'c1',
            role: 'user',
            content: 'persisted user',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date(userCreatedAt),
        },
    ];
    try {
        const res = await request(appWith({
            findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
            listAllTurns: async () => ({ items: persisted }),
        }))
            .get('/conversations/c1/turns')
            .expect(200);
        assert.equal(res.body.items.length, 2);
        assert.equal(res.body.items[0].turnId, 't-assistant');
        assert.equal(res.body.items[0].role, 'assistant');
        assert.equal(res.body.items[1].turnId, 't-user');
        assert.equal(res.body.items[1].role, 'user');
    }
    finally {
        cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
    }
});
test('keeps inflight merged after final until persistence completes, then stops after cleanup', async () => {
    const userCreatedAt = new Date('2025-01-01T00:00:00.000Z').toISOString();
    createInflight({
        conversationId: 'c1',
        inflightId: 'i1',
        provider: 'lmstudio',
        model: 'llama',
        source: 'REST',
        userTurn: { content: 'hello', createdAt: userCreatedAt },
    });
    appendAssistantDelta({ conversationId: 'c1', inflightId: 'i1', delta: 'Hi' });
    markInflightFinal({ conversationId: 'c1', inflightId: 'i1', status: 'ok' });
    const persistedUserOnly: TurnSummary[] = [
        {
            turnId: 't1',
            conversationId: 'c1',
            role: 'user',
            content: 'hello',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date(userCreatedAt),
        },
    ];
    try {
        const resBefore = await request(appWith({
            findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
            listAllTurns: async () => ({ items: persistedUserOnly }),
        }))
            .get('/conversations/c1/turns')
            .expect(200);
        assert.equal(resBefore.body.items.length, 2);
        assert.equal(resBefore.body.items[0].role, 'assistant');
        assert.equal(resBefore.body.items[0].content, 'Hi');
        cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
        const persistedBoth: TurnSummary[] = [
            {
                turnId: 't2',
                conversationId: 'c1',
                role: 'assistant',
                content: 'Hi',
                model: 'llama',
                provider: 'lmstudio',
                source: 'REST',
                toolCalls: null,
                status: 'ok',
                createdAt: new Date('2025-01-01T00:00:00.500Z'),
            },
            persistedUserOnly[0],
        ];
        const resAfter = await request(appWith({
            findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
            listAllTurns: async () => ({ items: persistedBoth }),
        }))
            .get('/conversations/c1/turns?includeInflight=true')
            .expect(200);
        assert.equal(resAfter.body.items.length, 2);
        assert.equal(resAfter.body.inflight, undefined);
    }
    finally {
        cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
    }
});
test('orders same-timestamp turns deterministically (assistant before user)', async () => {
    const shared = new Date('2025-01-01T12:00:00.000Z');
    const turns: TurnSummary[] = [
        {
            turnId: 'ta',
            conversationId: 'c1',
            role: 'assistant',
            content: 'assistant',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: shared,
        },
        {
            turnId: 'tu',
            conversationId: 'c1',
            role: 'user',
            content: 'user',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: shared,
        },
    ];
    const res = await request(appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        listAllTurns: async () => ({ items: turns }),
    }))
        .get('/conversations/c1/turns')
        .expect(200);
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.items[0].role, 'assistant');
    assert.equal(res.body.items[1].role, 'user');
});
test('dedupes inflight merge by turnId even when createdAt differs', async () => {
    createInflight({
        conversationId: 'c1',
        inflightId: 'i1',
        provider: 'lmstudio',
        model: 'llama',
        source: 'REST',
        userTurn: {
            content: 'inflight version',
            createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
        },
    });
    markInflightPersisted({
        conversationId: 'c1',
        inflightId: 'i1',
        role: 'user',
        turnId: 't-user',
    });
    appendAssistantDelta({
        conversationId: 'c1',
        inflightId: 'i1',
        delta: 'assistant',
    });
    const persisted: TurnSummary[] = [
        {
            turnId: 't-user',
            conversationId: 'c1',
            role: 'user',
            content: 'persisted version',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T02:00:00.000Z'),
        },
    ];
    try {
        const res = await request(appWith({
            findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
            listAllTurns: async () => ({ items: persisted }),
        }))
            .get('/conversations/c1/turns')
            .expect(200);
        assert.equal(res.body.items.length, 2);
        const userTurn = res.body.items.find((item: {
            role: string;
        }) => item.role === 'user');
        const assistantTurn = res.body.items.find((item: {
            role: string;
        }) => item.role === 'assistant');
        assert.equal(Boolean(userTurn), true);
        assert.equal(Boolean(assistantTurn), true);
        assert.equal((userTurn as {
            turnId?: string;
        }).turnId, 't-user');
        assert.equal((userTurn as {
            content?: string;
        }).content, 'persisted version');
    }
    finally {
        cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
    }
});
test('fallback dedupe does not drop distinct turns when turnId is missing', async () => {
    const createdAt = new Date('2025-01-01T00:00:00.000Z');
    createInflight({
        conversationId: 'c1',
        inflightId: 'i1',
        provider: 'lmstudio',
        model: 'llama',
        source: 'REST',
        userTurn: {
            content: 'inflight',
            createdAt: createdAt.toISOString(),
        },
    });
    const persisted: TurnSummary[] = [
        {
            turnId: 't-user',
            conversationId: 'c1',
            role: 'user',
            content: 'persisted',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt,
        },
    ];
    try {
        const res = await request(appWith({
            findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
            listAllTurns: async () => ({ items: persisted }),
        }))
            .get('/conversations/c1/turns')
            .expect(200);
        assert.equal(res.body.items.length, 2);
        const contents = res.body.items.map((item: {
            content: string;
        }) => item.content);
        assert.equal(contents.includes('persisted'), true);
        assert.equal(contents.includes('inflight'), true);
    }
    finally {
        cleanupInflight({ conversationId: 'c1', inflightId: 'i1' });
    }
});
test('rejects appending to archived conversation', async () => {
    const res = await request(appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: new Date() }),
    }))
        .post('/conversations/c1/turns')
        .send({
        role: 'user',
        content: 'hello',
        model: 'llama',
        provider: 'lmstudio',
        status: 'ok',
    })
        .expect(410);
    assert.equal(res.body.error, 'archived');
});
test('appends turn when conversation active', async () => {
    const calls: unknown[] = [];
    await request(appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        appendTurn: async (payload) => {
            calls.push(payload);
            return payload as never;
        },
    }))
        .post('/conversations/c1/turns')
        .send({
        role: 'assistant',
        content: 'hi there',
        model: 'llama',
        provider: 'lmstudio',
        toolCalls: { foo: 'bar' },
        status: 'ok',
    })
        .expect(201);
    const payload = calls[0] as Record<string, unknown>;
    assert.equal(payload.conversationId, 'c1');
    assert.equal(payload.role, 'assistant');
    assert.equal(payload.content, 'hi there');
    assert.equal((payload as {
        source?: string;
    }).source, 'REST');
});
test('appends warning-status turn when conversation active', async () => {
    const calls: unknown[] = [];
    await request(appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        appendTurn: async (payload) => {
            calls.push(payload);
            return payload as never;
        },
    }))
        .post('/conversations/c1/turns')
        .send({
        role: 'assistant',
        content: 'warning reply',
        model: 'llama',
        provider: 'lmstudio',
        status: 'warning',
    })
        .expect(201);
    const payload = calls[0] as Record<string, unknown>;
    assert.equal(payload.conversationId, 'c1');
    assert.equal(payload.role, 'assistant');
    assert.equal(payload.status, 'warning');
    assert.equal((payload as {
        source?: string;
    }).source, 'REST');
});
test('accepts assistant usage/timing metadata on append', async () => {
    const calls: unknown[] = [];
    await request(appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        appendTurn: async (payload) => {
            calls.push(payload);
            return payload as never;
        },
    }))
        .post('/conversations/c1/turns')
        .send({
        role: 'assistant',
        content: 'hi there',
        model: 'llama',
        provider: 'lmstudio',
        status: 'ok',
        usage: {
            inputTokens: 12,
            outputTokens: 6,
            totalTokens: 18,
            cachedInputTokens: 4,
        },
        timing: {
            totalTimeSec: 1.5,
            tokensPerSecond: 12.5,
        },
    })
        .expect(201);
    const payload = calls[0] as Record<string, unknown>;
    assert.deepEqual(payload.usage, {
        inputTokens: 12,
        outputTokens: 6,
        totalTokens: 18,
        cachedInputTokens: 4,
    });
    assert.deepEqual(payload.timing, {
        totalTimeSec: 1.5,
        tokensPerSecond: 12.5,
    });
});
test('rejects user usage/timing metadata on append', async () => {
    const res = await request(appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
    }))
        .post('/conversations/c1/turns')
        .send({
        role: 'user',
        content: 'hello',
        model: 'llama',
        provider: 'lmstudio',
        status: 'ok',
        usage: { inputTokens: 2 },
        timing: { totalTimeSec: 0.5 },
    })
        .expect(400);
    assert.equal(res.body.error, 'validation_error');
});
test('returns usage/timing fields for assistant turns', async () => {
    const turns: TurnSummary[] = [
        {
            turnId: 't2',
            conversationId: 'c1',
            role: 'assistant',
            content: 'hi',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            usage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
            },
            timing: { totalTimeSec: 0.4 },
            createdAt: new Date('2025-01-01T10:00:00Z'),
        },
    ];
    const res = await request(appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        listAllTurns: async () => ({ items: turns }),
    }))
        .get('/conversations/c1/turns')
        .expect(200);
    assert.deepEqual(res.body.items[0].usage, {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
    });
    assert.deepEqual(res.body.items[0].timing, { totalTimeSec: 0.4 });
});
test('omits usage/timing when assistant turn has no metadata', async () => {
    const turns: TurnSummary[] = [
        {
            turnId: 't2',
            conversationId: 'c1',
            role: 'assistant',
            content: 'hi',
            model: 'llama',
            provider: 'lmstudio',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date('2025-01-01T10:00:00Z'),
        },
    ];
    const res = await request(appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
        listAllTurns: async () => ({ items: turns }),
    }))
        .get('/conversations/c1/turns')
        .expect(200);
    assert.equal('usage' in res.body.items[0], false);
    assert.equal('timing' in res.body.items[0], false);
});
test('returns validation_error on bad body', async () => {
    const res = await request(appWith({
        findConversationById: async () => ({ _id: 'c1', archivedAt: null }),
    }))
        .post('/conversations/c1/turns')
        .send({})
        .expect(400);
    assert.equal(res.body.error, 'validation_error');
});
