import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import { ChatInterfaceLMStudio } from '../../chat/interfaces/ChatInterfaceLMStudio.js';
import { createLmStudioEmbeddingProvider, LmStudioEmbeddingError, type LmClientResolver, } from '../../ingest/providers/index.js';
import { query, resetStore } from '../../logStore.js';
test.beforeEach(() => {
    resetStore();
});
function createResolverDouble() {
    let modelProviderCalls = 0;
    let embedCalls = 0;
    const resolver: LmClientResolver = () => ({
        embedding: {
            model: async () => {
                modelProviderCalls += 1;
                return {
                    embed: async () => {
                        embedCalls += 1;
                        return { embedding: [0.1, 0.2, 0.3] };
                    },
                    countTokens: async () => 10,
                    getContextLength: async () => 4096,
                };
            },
        },
    });
    return {
        resolver,
        getModelProviderCalls: () => modelProviderCalls,
        getEmbedCalls: () => embedCalls,
    };
}
test('LM Studio ingest retries log warn on retry and error on terminal exhaustion', async () => {
    let calls = 0;
    const resolver: LmClientResolver = () => ({
        embedding: {
            model: async () => ({
                embed: async () => {
                    calls += 1;
                    throw new Error('connect ECONNREFUSED 127.0.0.1:1234');
                },
                countTokens: async () => 10,
                getContextLength: async () => 4096,
            }),
        },
    });
    const provider = createLmStudioEmbeddingProvider({
        lmClientResolver: resolver,
        baseUrl: 'ws://host.docker.internal:1234',
        ingestFailureContext: () => ({
            runId: 'run-lm-retry',
            path: '/tmp/repo',
            root: '/tmp/repo',
            currentFile: 'src/main.ts',
        }),
    });
    const model = await provider.getModel('text-embedding-nomic-embed-text-v1.5');
    const controller = new AbortController();
    await assert.rejects(() => model.embedText('hello world', { signal: controller.signal }));
    assert.equal(calls, 3);
    const entries = query({ text: 'DEV-0000036:T17:ingest_provider_failure' }, 30);
    const retryWarns = entries.filter((entry) => entry.level === 'warn' &&
        entry.context?.provider === 'lmstudio' &&
        entry.context?.stage === 'retry');
    const terminalErrors = entries.filter((entry) => entry.level === 'error' &&
        entry.context?.provider === 'lmstudio' &&
        entry.context?.stage === 'terminal');
    assert.equal(retryWarns.length, 2);
    assert.equal(terminalErrors.length, 1);
    assert.equal(terminalErrors[0]?.context?.code, 'LMSTUDIO_UNAVAILABLE');
    assert.equal(terminalErrors[0]?.context?.retryable, true);
});
test('rejects empty LM Studio input before retry or model calls', async () => {
    const double = createResolverDouble();
    const provider = createLmStudioEmbeddingProvider({
        lmClientResolver: double.resolver,
        baseUrl: 'ws://host.docker.internal:1234',
    });
    const model = await provider.getModel('text-embedding-nomic-embed-text-v1.5');
    const modelProviderCallsBeforeEmbed = double.getModelProviderCalls();
    await assert.rejects(() => model.embedText(''), (error: unknown) => {
        assert.ok(error instanceof LmStudioEmbeddingError);
        assert.equal(error.code, 'LMSTUDIO_BAD_REQUEST');
        assert.match(error.message, /cannot be blank/i);
        assert.equal(error.retryable, false);
        return true;
    });
    assert.equal(double.getModelProviderCalls(), modelProviderCallsBeforeEmbed);
    assert.equal(double.getEmbedCalls(), 0);
    const logs = query({
        source: ['server'],
        text: 'DEV-0000046:T4:lmstudio-blank-input-guard-hit',
    });
    assert.equal(logs.length, 1);
    const providerFailureLogs = query({
        source: ['server'],
        text: 'DEV-0000036:T17:ingest_provider_failure',
    });
    assert.equal(providerFailureLogs.length, 0);
    assert.equal(logs[0]?.context?.provider, 'lmstudio');
    assert.equal(logs[0]?.context?.model, 'text-embedding-nomic-embed-text-v1.5');
    assert.equal(logs[0]?.context?.rawInputClassification, 'empty');
    assert.equal(logs[0]?.context?.skippedRetryAndModelCall, true);
});
test('rejects whitespace-only LM Studio input with the same bad-request error', async () => {
    const double = createResolverDouble();
    const provider = createLmStudioEmbeddingProvider({
        lmClientResolver: double.resolver,
        baseUrl: 'ws://host.docker.internal:1234',
    });
    const model = await provider.getModel('text-embedding-nomic-embed-text-v1.5');
    const modelProviderCallsBeforeEmbed = double.getModelProviderCalls();
    await assert.rejects(() => model.embedText(' \n\t  '), (error: unknown) => {
        assert.ok(error instanceof LmStudioEmbeddingError);
        assert.equal(error.code, 'LMSTUDIO_BAD_REQUEST');
        assert.match(error.message, /cannot be blank/i);
        assert.equal(error.retryable, false);
        return true;
    });
    assert.equal(double.getModelProviderCalls(), modelProviderCallsBeforeEmbed);
    assert.equal(double.getEmbedCalls(), 0);
    const logs = query({
        source: ['server'],
        text: 'DEV-0000046:T4:lmstudio-blank-input-guard-hit',
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.context?.rawInputClassification, 'whitespace_only');
});
test('LM Studio chat runtime labels real invalid runtime flag input with the bounded invalid-flags marker', async () => {
    const runInvalidFlags = async (agentFlags: Record<string, unknown>) => {
        resetStore();
        const chat = new ChatInterfaceLMStudio(() => {
            throw new Error('client should not be created');
        }, () => ({ tools: [] }));
        const errors: string[] = [];
        chat.on('error', (event) => errors.push(event.message));
        await chat.execute('hello', {
            requestId: 'lmstudio-runtime-invalid',
            baseUrl: 'http://127.0.0.1:1234',
            agentFlags,
        }, 'lmstudio-runtime-invalid-conversation', 'lmstudio-model');
        const logs = query({
            text: 'story.0000056.task04.lmstudio_runtime_flags_invalid',
        });
        return {
            error: errors.at(-1) ?? '',
            log: logs.at(-1),
        };
    };
    const unlimited = await runInvalidFlags({ maxTokens: false });
    assert.match(unlimited.error, /agentFlags\.maxTokens must be a number/u);
    assert.match(String(unlimited.log?.context?.error ?? ''), /agentFlags\.maxTokens must be a number/u);
    const outOfRange = await runInvalidFlags({ temperature: 3 });
    assert.match(outOfRange.error, /agentFlags\.temperature must be at most 2/u);
    assert.match(String(outOfRange.log?.context?.error ?? ''), /agentFlags\.temperature must be at most 2/u);
});
test('LM Studio chat runtime does not reuse the invalid-flags marker for a post-parse execution failure', async () => {
    resetStore();
    const chat = new ChatInterfaceLMStudio(() => ({
        llm: {
            model: async () => ({
                act: async () => {
                    throw new Error('lmstudio execution failed after flags parsed');
                },
            }),
        },
    }) as unknown as LMStudioClient, () => ({ tools: [] }));
    const errors: string[] = [];
    chat.on('error', (event) => errors.push(event.message));
    await chat.execute('hello', {
        requestId: 'lmstudio-runtime-post-parse-failure',
        baseUrl: 'http://127.0.0.1:1234',
        agentFlags: {
            temperature: 0.7,
            maxTokens: 128,
        },
        history: [],
    }, 'lmstudio-runtime-post-parse-conversation', 'lmstudio-model');
    assert.match(errors.at(-1) ?? '', /lmstudio execution failed after flags parsed/u);
    const invalidLogs = query({
        text: 'story.0000056.task04.lmstudio_runtime_flags_invalid',
    });
    assert.equal(invalidLogs.length, 0);
});
test('LM Studio chat runtime falls back to the bounded defaults when provider-local config widens temperature or maxTokens', async () => {
    const originalHome = process.env.CODEINFO_LMSTUDIO_HOME;
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-task10-lmstudio-runtime-'));
    const lmstudioHome = path.join(tempRoot, 'lmstudio');
    await fs.mkdir(path.join(lmstudioHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(lmstudioHome, 'chat', 'config.toml'), [
        'temperature = 4',
        'max_tokens = 0',
        'context_overflow_policy = "rollingWindow"',
        'tool_access = "off"',
        '',
    ].join('\n'), 'utf8');
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_HOME", lmstudioHome);
    const captured: Record<string, unknown>[] = [];
    try {
        const chat = new ChatInterfaceLMStudio(() => ({
            llm: {
                model: async () => ({
                    act: async (_chat: unknown, tools: ReadonlyArray<unknown>, opts: Record<string, unknown>) => {
                        captured.push({
                            tools,
                            temperature: opts.temperature,
                            maxTokens: opts.maxTokens,
                            contextOverflowPolicy: opts.contextOverflowPolicy,
                        });
                    },
                }),
            },
        }) as unknown as LMStudioClient, () => ({ tools: [{ name: 'VectorSearch' }] }));
        await chat.execute('hello', {
            requestId: 'lmstudio-runtime-bounded-defaults',
            baseUrl: 'http://127.0.0.1:1234',
            history: [],
        }, 'lmstudio-runtime-bounded-defaults-conversation', 'lmstudio-model');
        assert.equal(captured.length, 1);
        assert.equal(captured[0]?.temperature, 0.2);
        assert.equal(captured[0]?.maxTokens, 4096);
        assert.equal(captured[0]?.contextOverflowPolicy, 'rollingWindow');
        assert.equal((captured[0]?.tools as ReadonlyArray<unknown> | undefined)?.length, 0);
    }
    finally {
        if (originalHome === undefined)
            clearScopedTestEnvValue("CODEINFO_LMSTUDIO_HOME");
        else
            setScopedTestEnvValue("CODEINFO_LMSTUDIO_HOME", originalHome);
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
