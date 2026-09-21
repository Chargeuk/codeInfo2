import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ChatMessage, LMStudioClient } from '@lmstudio/sdk';
import { runCodebaseQuestion } from '../../mcp2/tools/codebaseQuestion.js';
class MockModel {
    async act(_chat: unknown, _tools: ReadonlyArray<unknown>, opts: Record<string, unknown>): Promise<void> {
        const onToolCallRequestStart = opts.onToolCallRequestStart as ((roundIndex: number, callId: number) => void) | undefined;
        const onToolCallRequestNameReceived = opts.onToolCallRequestNameReceived as ((roundIndex: number, callId: number, name: string) => void) | undefined;
        const onToolCallRequestEnd = opts.onToolCallRequestEnd as ((roundIndex: number, callId: number, info?: unknown) => void) | undefined;
        const onToolCallResult = opts.onToolCallResult as ((roundIndex: number, callId: number, info: unknown) => void) | undefined;
        const onPredictionFragment = opts.onPredictionFragment as ((fragment: {
            content?: string;
            roundIndex?: number;
        }) => void) | undefined;
        const onMessage = opts.onMessage as ((message: ChatMessage) => void) | undefined;
        onToolCallRequestStart?.(0, 1);
        onToolCallRequestNameReceived?.(0, 1, 'VectorSearch');
        onToolCallRequestEnd?.(0, 1, { parameters: { query: 'hello' } });
        onToolCallResult?.(0, 1, {
            name: 'VectorSearch',
            result: {
                results: [
                    {
                        repo: 'repo',
                        relPath: 'src/index.ts',
                        hostPath: '/host/repo/src/index.ts',
                        score: 0.8,
                        chunk: 'line1\nline2',
                        chunkId: 'c1',
                        modelId: 'embed-1',
                    },
                ],
                files: [
                    {
                        hostPath: '/host/repo/src/index.ts',
                        highestMatch: 0.8,
                        chunkCount: 1,
                        lineCount: 2,
                        repo: 'repo',
                        modelId: 'embed-1',
                    },
                ],
                modelId: 'embed-1',
            },
        });
        onPredictionFragment?.({ content: 'Tok' });
        onMessage?.({
            data: {
                role: 'assistant',
                content: [{ type: 'text', text: 'Here you go' }],
            },
        } as unknown as ChatMessage);
    }
}
const makeMockClientFactory = () => (baseUrl: string) => {
    void baseUrl;
    return {
        system: {
            listDownloadedModels: async () => [
                {
                    modelKey: 'mock-model',
                    displayName: 'mock-model',
                    type: 'gguf',
                },
            ],
        },
        llm: {
            model: (model: string) => {
                void model;
                return new MockModel();
            },
        },
    } as unknown as LMStudioClient;
};
const makeToolFactory = () => () => ({ tools: [] });
const fakeToolFactory = () => () => ({
    tools: [{ name: 'VectorSearch' }],
});
test('MCP LM Studio responder returns answer-only segments', async () => {
    const result = await runCodebaseQuestion({ question: 'What is up?', provider: 'lmstudio', model: 'mock-model' }, {
        clientFactory: makeMockClientFactory(),
        toolFactory: makeToolFactory(),
    });
    const payload = JSON.parse(result.content[0].text);
    assert.ok(typeof payload.conversationId === 'string');
    assert.ok(payload.conversationId.startsWith('lmstudio-thread-'));
    assert.equal(payload.modelId, 'mock-model');
    assert.deepEqual(payload.segments.map((s: {
        type: string;
    }) => s.type), ['answer']);
    assert.equal(payload.segments[0].text, 'Here you go');
});
test('MCP LM Studio responder only returns the final answer segment', async () => {
    const result = await runCodebaseQuestion({ question: 'Second run', provider: 'lmstudio', model: 'mock-model' }, {
        clientFactory: makeMockClientFactory(),
        toolFactory: makeToolFactory(),
    });
    const payload = JSON.parse(result.content[0].text);
    const segments = payload.segments as Array<{
        type: string;
    }>;
    assert.deepEqual(segments.map((s) => s.type), ['answer']);
    const answer = segments[0] as {
        [key: string]: unknown;
    };
    assert.deepEqual(Object.keys(answer).sort(), ['text', 'type']);
});
test('MCP LM Studio keeps the tool-enabled versus tool-disabled split and only accepts exact contextOverflowPolicy values', async () => {
    const captured: Array<{
        tools: ReadonlyArray<unknown>;
        contextOverflowPolicy?: unknown;
    }> = [];
    const clientFactory = () => ({
        system: {
            listDownloadedModels: async () => [
                {
                    modelKey: 'mock-model',
                    displayName: 'mock-model',
                    type: 'gguf',
                },
            ],
        },
        llm: {
            model: () => ({
                act: async (_chat: unknown, tools: ReadonlyArray<unknown>, opts: Record<string, unknown>) => {
                    captured.push({
                        tools,
                        contextOverflowPolicy: opts.contextOverflowPolicy,
                    });
                },
            }),
        },
    }) as unknown as LMStudioClient;
    const originalHome = process.env.CODEINFO_LMSTUDIO_HOME;
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalLmBaseUrl = process.env.CODEINFO_LMSTUDIO_BASE_URL;
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-task4-lmstudio-'));
    try {
        setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'lmstudio');
        setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'http://127.0.0.1:1234');
        setScopedTestEnvValue("CODEINFO_LMSTUDIO_HOME", path.join(tempRoot, 'lmstudio'));
        const lmstudioHome = process.env.CODEINFO_LMSTUDIO_HOME;
        assert.ok(lmstudioHome);
        await fs.mkdir(path.join(lmstudioHome, 'chat'), {
            recursive: true,
        });
        await fs.writeFile(path.join(lmstudioHome, 'chat', 'config.toml'), [
            'model = "mock-model"',
            'context_overflow_policy = "rollingWindow"',
            'tool_access = "on"',
            '',
        ].join('\n'), 'utf8');
        await runCodebaseQuestion({ question: 'Tools on', provider: 'lmstudio', model: 'mock-model' }, {
            clientFactory,
            toolFactory: fakeToolFactory(),
        });
        await fs.writeFile(path.join(lmstudioHome, 'chat', 'config.toml'), [
            'model = "mock-model"',
            'context_overflow_policy = "stopAtLimit"',
            'tool_access = "off"',
            '',
        ].join('\n'), 'utf8');
        await runCodebaseQuestion({ question: 'Tools off', provider: 'lmstudio', model: 'mock-model' }, {
            clientFactory,
            toolFactory: fakeToolFactory(),
        });
        assert.equal(captured[0]?.tools.length, 1);
        assert.equal(captured[0]?.contextOverflowPolicy, 'rollingWindow');
        assert.equal(captured[1]?.tools.length, 0);
        assert.equal(captured[1]?.contextOverflowPolicy, 'stopAtLimit');
    }
    finally {
        if (originalHome === undefined)
            clearScopedTestEnvValue("CODEINFO_LMSTUDIO_HOME");
        else
            setScopedTestEnvValue("CODEINFO_LMSTUDIO_HOME", originalHome);
        if (originalDefaultProvider === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalDefaultProvider);
        }
        if (originalLmBaseUrl === undefined) {
            clearScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL");
        }
        else {
            setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", originalLmBaseUrl);
        }
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
test('MCP LM Studio uses the same bounded defaults contract when provider-local config widens temperature or maxTokens', async () => {
    const captured: Array<{
        temperature?: unknown;
        maxTokens?: unknown;
        contextOverflowPolicy?: unknown;
    }> = [];
    const clientFactory = () => ({
        system: {
            listDownloadedModels: async () => [
                {
                    modelKey: 'mock-model',
                    displayName: 'mock-model',
                    type: 'gguf',
                },
            ],
        },
        llm: {
            model: () => ({
                act: async (_chat: unknown, _tools: ReadonlyArray<unknown>, opts: Record<string, unknown>) => {
                    captured.push({
                        temperature: opts.temperature,
                        maxTokens: opts.maxTokens,
                        contextOverflowPolicy: opts.contextOverflowPolicy,
                    });
                },
            }),
        },
    }) as unknown as LMStudioClient;
    const originalHome = process.env.CODEINFO_LMSTUDIO_HOME;
    const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    const originalLmBaseUrl = process.env.CODEINFO_LMSTUDIO_BASE_URL;
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-task10-mcp-lmstudio-'));
    try {
        setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'lmstudio');
        setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'http://127.0.0.1:1234');
        setScopedTestEnvValue("CODEINFO_LMSTUDIO_HOME", path.join(tempRoot, 'lmstudio'));
        const lmstudioHome = process.env.CODEINFO_LMSTUDIO_HOME;
        assert.ok(lmstudioHome);
        await fs.mkdir(path.join(lmstudioHome, 'chat'), {
            recursive: true,
        });
        await fs.writeFile(path.join(lmstudioHome, 'chat', 'config.toml'), [
            'model = "mock-model"',
            'temperature = 4',
            'max_tokens = 0',
            'context_overflow_policy = "rollingWindow"',
            'tool_access = "off"',
            '',
        ].join('\n'), 'utf8');
        await runCodebaseQuestion({
            question: 'Bounded defaults',
            provider: 'lmstudio',
            model: 'mock-model',
        }, {
            clientFactory,
            toolFactory: fakeToolFactory(),
        });
        assert.equal(captured.length, 1);
        assert.equal(captured[0]?.temperature, 0.2);
        assert.equal(captured[0]?.maxTokens, 4096);
        assert.equal(captured[0]?.contextOverflowPolicy, 'rollingWindow');
    }
    finally {
        if (originalHome === undefined)
            clearScopedTestEnvValue("CODEINFO_LMSTUDIO_HOME");
        else
            setScopedTestEnvValue("CODEINFO_LMSTUDIO_HOME", originalHome);
        if (originalDefaultProvider === undefined) {
            clearScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", originalDefaultProvider);
        }
        if (originalLmBaseUrl === undefined) {
            clearScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL");
        }
        else {
            setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", originalLmBaseUrl);
        }
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
