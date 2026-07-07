import assert from 'node:assert/strict';
import path from 'node:path';
import { describe } from 'node:test';
import nodeTest from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import mongoose from 'mongoose';
import { ChatInterfaceCodex } from '../../chat/interfaces/ChatInterfaceCodex.js';
import { ChatInterfaceLMStudio } from '../../chat/interfaces/ChatInterfaceLMStudio.js';
import { memoryConversations, memoryTurns, } from '../../chat/memoryPersistence.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import type { Turn } from '../../mongo/turn.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
import {
  beginScopedTestEnvIsolation,
  endScopedTestEnvIsolation,
} from '../support/processEnvIsolation.js';
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
const originalReady = mongoose.connection.readyState;
const originalLmStudioBaseUrl = process.env.CODEINFO_LMSTUDIO_BASE_URL;
class MockCodexThread {
    async runStreamed(): Promise<{
        events: AsyncGenerator<unknown>;
    }> {
        async function* gen(): AsyncGenerator<unknown> {
            yield { type: 'thread.started', thread_id: 't-1' };
            yield {
                type: 'item.started',
                item: {
                    type: 'mcp_tool_call',
                    id: 'call-1',
                    name: 'VectorSearch',
                    arguments: { q: 'hi' },
                },
            };
            yield {
                type: 'item.completed',
                item: {
                    type: 'mcp_tool_call',
                    id: 'call-1',
                    name: 'VectorSearch',
                    arguments: { q: 'hi' },
                    result: { content: { results: [{ chunk: 'c1', hostPath: '/tmp' }] } },
                },
            };
            yield {
                type: 'item.updated',
                item: { type: 'agent_message', text: 'Hi' },
            };
            yield {
                type: 'item.completed',
                item: { type: 'agent_message', text: 'Hi there' },
            };
            yield { type: 'turn.completed' };
        }
        return { events: gen() };
    }
}
class MockCodexClient {
    startThread() {
        return new MockCodexThread();
    }
    resumeThread() {
        return new MockCodexThread();
    }
}
const test = (name: string, fn: () => Promise<void> | void) => nodeTest(name, async () => {
    const originalEnv = process.env.NODE_ENV;
    beginScopedTestEnvIsolation();
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
        cliPath: '/usr/bin/codex',
    });
    Object.defineProperty(mongoose.connection, 'readyState', {
        value: 0,
        configurable: true,
    });
    setScopedTestEnvValue("NODE_ENV", 'test');
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'http://127.0.0.1:1234');
    try {
        await fn();
    }
    finally {
        Object.defineProperty(mongoose.connection, 'readyState', {
            value: originalReady,
            configurable: true,
        });
        if (originalEnv === undefined) {
            clearScopedTestEnvValue("NODE_ENV");
        }
        else {
            setScopedTestEnvValue("NODE_ENV", originalEnv);
        }
        if (originalLmStudioBaseUrl === undefined) {
            clearScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL");
        }
        else {
            setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", originalLmStudioBaseUrl);
        }
        memoryTurns.clear();
        memoryConversations.clear();
        endScopedTestEnvIsolation();
    }
});
describe('assistant persistence via ChatInterface base', () => {
    test('Codex path persists assistant with tool calls once', async () => {
        const chat = new ChatInterfaceCodex(() => new MockCodexClient());
        const conversationId = 'persist-codex-1';
        await chat.run('Hello', { provider: 'codex', source: 'REST' }, conversationId, 'gpt-5.1-codex-max');
        const turns = (memoryTurns.get(conversationId) ?? []) as Turn[];
        assert.equal(turns.length, 2);
        const assistant = turns[1] as Turn;
        assert.equal(assistant.role, 'assistant');
        const calls = (assistant.toolCalls as {
            calls?: Array<{
                callId?: string;
            }>;
        } | null)
            ?.calls ?? [];
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.callId, 'call-1');
    });
    test('LM Studio path persists assistant with tool calls once', async () => {
        class MockModel {
            async act(_chat: unknown, _tools: ReadonlyArray<unknown>, opts: Record<string, unknown>): Promise<void> {
                const callbacks = opts as {
                    onToolCallRequestStart?: (round: number, callId: number) => void;
                    onToolCallRequestNameReceived?: (round: number, callId: number, name: string) => void;
                    onToolCallRequestEnd?: (round: number, callId: number, info?: unknown) => void;
                    onToolCallResult?: (round: number, callId: number, info?: unknown) => void;
                    onPredictionFragment?: (fragment: {
                        content?: string;
                    }) => void;
                    onMessage?: (message: unknown) => void;
                };
                callbacks.onToolCallRequestStart?.(0, 1);
                callbacks.onToolCallRequestNameReceived?.(0, 1, 'VectorSearch');
                callbacks.onToolCallRequestEnd?.(0, 1, { parameters: { q: 'hi' } });
                callbacks.onToolCallResult?.(0, 1, {
                    name: 'VectorSearch',
                    result: { results: [{ chunk: 'c2', hostPath: '/tmp2' }] },
                });
                callbacks.onPredictionFragment?.({ content: 'Hello' });
                callbacks.onMessage?.({
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Hello world' }],
                });
            }
        }
        const model = new MockModel();
        const mockClient: LMStudioClient = {
            llm: {
                model: () => ({
                    act: model.act.bind(model),
                }) as unknown as ReturnType<LMStudioClient['llm']['model']>,
            },
        } as unknown as LMStudioClient;
        const chat = new ChatInterfaceLMStudio(() => mockClient, () => ({
            tools: [],
        }));
        const conversationId = 'persist-lm-1';
        await chat.run('Hello', { provider: 'lmstudio', source: 'REST', baseUrl: 'http://localhost' }, conversationId, 'llama-3');
        const turns = (memoryTurns.get(conversationId) ?? []) as Turn[];
        assert.equal(turns.length, 2);
        const assistant = turns[1] as Turn;
        assert.equal(assistant.role, 'assistant');
        const calls = (assistant.toolCalls as {
            calls?: Array<{
                callId?: string;
            }>;
        } | null)
            ?.calls ?? [];
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.callId, '1');
    });
    test('LM Studio stats persist usage and timing metadata', async () => {
        class MockModel {
            async act(_chat: unknown, _tools: ReadonlyArray<unknown>, opts: Record<string, unknown>): Promise<void> {
                const callbacks = opts as {
                    onPredictionCompleted?: (result: unknown) => void;
                    onPredictionFragment?: (fragment: {
                        content?: string;
                    }) => void;
                    onMessage?: (message: unknown) => void;
                };
                callbacks.onPredictionCompleted?.({
                    stats: {
                        promptTokensCount: 12,
                        predictedTokensCount: 4,
                        totalTokensCount: 16,
                        totalTimeSec: 0.5,
                        tokensPerSecond: 32,
                    },
                });
                callbacks.onPredictionFragment?.({ content: 'Hello' });
                callbacks.onMessage?.({
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Hello world' }],
                });
            }
        }
        const model = new MockModel();
        const mockClient: LMStudioClient = {
            llm: {
                model: () => ({
                    act: model.act.bind(model),
                }) as unknown as ReturnType<LMStudioClient['llm']['model']>,
            },
        } as unknown as LMStudioClient;
        const chat = new ChatInterfaceLMStudio(() => mockClient, () => ({
            tools: [],
        }));
        const conversationId = 'persist-lm-stats';
        await chat.run('Hello', { provider: 'lmstudio', source: 'REST', baseUrl: 'http://localhost' }, conversationId, 'llama-3');
        const turns = (memoryTurns.get(conversationId) ?? []) as Turn[];
        const assistant = turns[1] as Turn;
        assert.deepEqual(assistant.usage, {
            inputTokens: 12,
            outputTokens: 4,
            totalTokens: 16,
        });
        assert.deepEqual(assistant.timing, {
            totalTimeSec: 0.5,
            tokensPerSecond: 32,
        });
    });
    test('LM Studio fallback timing persists when stats missing', async () => {
        let now = 1000;
        const originalNow = Date.now;
        Date.now = () => now;
        class MockModel {
            async act(_chat: unknown, _tools: ReadonlyArray<unknown>, opts: Record<string, unknown>): Promise<void> {
                const callbacks = opts as {
                    onPredictionFragment?: (fragment: {
                        content?: string;
                    }) => void;
                    onMessage?: (message: unknown) => void;
                };
                callbacks.onPredictionFragment?.({ content: 'Hello' });
                now = 2500;
                callbacks.onMessage?.({
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Hello world' }],
                });
            }
        }
        const model = new MockModel();
        const mockClient: LMStudioClient = {
            llm: {
                model: () => ({
                    act: model.act.bind(model),
                }) as unknown as ReturnType<LMStudioClient['llm']['model']>,
            },
        } as unknown as LMStudioClient;
        const chat = new ChatInterfaceLMStudio(() => mockClient, () => ({
            tools: [],
        }));
        const conversationId = 'persist-lm-fallback';
        try {
            await chat.run('Hello', { provider: 'lmstudio', source: 'REST', baseUrl: 'http://localhost' }, conversationId, 'llama-3');
        }
        finally {
            Date.now = originalNow;
        }
        const turns = (memoryTurns.get(conversationId) ?? []) as Turn[];
        const assistant = turns[1] as Turn;
        assert(assistant.timing?.totalTimeSec);
        assert.equal(assistant.timing?.tokensPerSecond, undefined);
        assert.equal(assistant.timing?.totalTimeSec, 1.5);
    });
    test('LM Studio omits tokensPerSecond when absent', async () => {
        class MockModel {
            async act(_chat: unknown, _tools: ReadonlyArray<unknown>, opts: Record<string, unknown>): Promise<void> {
                const callbacks = opts as {
                    onPredictionCompleted?: (result: unknown) => void;
                    onPredictionFragment?: (fragment: {
                        content?: string;
                    }) => void;
                    onMessage?: (message: unknown) => void;
                };
                callbacks.onPredictionCompleted?.({
                    stats: {
                        promptTokensCount: 5,
                        predictedTokensCount: 6,
                        totalTimeSec: 0.75,
                    },
                });
                callbacks.onPredictionFragment?.({ content: 'Hello' });
                callbacks.onMessage?.({
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Hello world' }],
                });
            }
        }
        const model = new MockModel();
        const mockClient: LMStudioClient = {
            llm: {
                model: () => ({
                    act: model.act.bind(model),
                }) as unknown as ReturnType<LMStudioClient['llm']['model']>,
            },
        } as unknown as LMStudioClient;
        const chat = new ChatInterfaceLMStudio(() => mockClient, () => ({
            tools: [],
        }));
        const conversationId = 'persist-lm-no-rate';
        await chat.run('Hello', { provider: 'lmstudio', source: 'REST', baseUrl: 'http://localhost' }, conversationId, 'llama-3');
        const turns = (memoryTurns.get(conversationId) ?? []) as Turn[];
        const assistant = turns[1] as Turn;
        assert.deepEqual(assistant.usage, {
            inputTokens: 5,
            outputTokens: 6,
            totalTokens: 11,
        });
        assert.deepEqual(assistant.timing, {
            totalTimeSec: 0.75,
        });
    });
    test('same-conversation agentFlags edits stay on the current conversation after persistence migration', async () => {
        class RouteChat extends ChatInterfaceLMStudio {
            constructor() {
                const mockClient: LMStudioClient = {
                    llm: {
                        model: () => ({
                            act: async (_chat: unknown, _tools: ReadonlyArray<unknown>, opts: Record<string, unknown>) => {
                                const callbacks = opts as {
                                    onPredictionFragment?: (fragment: {
                                        content?: string;
                                    }) => void;
                                    onMessage?: (message: unknown) => void;
                                };
                                callbacks.onPredictionFragment?.({ content: 'Hello' });
                                callbacks.onMessage?.({
                                    role: 'assistant',
                                    content: [{ type: 'text', text: 'Hello world' }],
                                });
                            },
                        }) as unknown as ReturnType<LMStudioClient['llm']['model']>,
                    },
                } as unknown as LMStudioClient;
                super(() => mockClient, () => ({
                    tools: [],
                }));
            }
        }
        memoryConversations.set('same-conversation-agent-flags', {
            _id: 'same-conversation-agent-flags',
            provider: 'lmstudio',
            model: 'lmstudio-test',
            title: 'Existing conversation',
            source: 'REST',
            flags: {
                agentFlags: {
                    toolAccess: 'on',
                    temperature: 0.2,
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
        const supertest = await import('supertest');
        const originalReadyState = mongoose.connection.readyState;
        Object.defineProperty(mongoose.connection, 'readyState', {
            value: 0,
            configurable: true,
        });
        try {
            const response = await supertest
                .default(app)
                .post('/chat')
                .send({
                provider: 'lmstudio',
                model: 'lmstudio-test',
                conversationId: 'same-conversation-agent-flags',
                message: 'edit flags only',
                agentFlags: {
                    toolAccess: 'off',
                    temperature: 0.7,
                },
            });
            assert.equal(response.status, 202);
            assert.equal(memoryConversations.size, 1);
            assert.deepEqual(memoryConversations.get('same-conversation-agent-flags')?.flags, {
                agentFlags: {
                    contextOverflowPolicy: 'truncateMiddle',
                    maxTokens: 4096,
                    toolAccess: 'off',
                    temperature: 0.7,
                },
            });
        }
        finally {
            Object.defineProperty(mongoose.connection, 'readyState', {
                value: originalReadyState,
                configurable: true,
            });
        }
    });
});
