import assert from 'assert';
import fs from 'node:fs/promises';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chatRequestFixture } from '@codeinfo2/common';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import type WebSocket from 'ws';
import { append as appendLog, query, resetStore } from '../../logStore.js';
import { baseLogger, createRequestLogger } from '../../logger.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
import { attachWs, type WsServerHandle } from '../../ws/server.js';
import { startNamedCopilotScenarioServer, type StartedNamedCopilotScenarioServer, } from '../support/copilotBootPath.js';
import { NAMED_COPILOT_SCENARIOS, type NamedCopilotScenario, } from '../support/copilotScenarioCatalog.js';
import { startExternalOpenAiCompatServer, type ExternalOpenAiCompatServer, } from '../support/externalOpenAiCompatServer.js';
import { createMockCopilotSdkHarness } from '../support/mockCopilotSdk.js';
import { MockLMStudioClient, type MockScenario, getLastChatHistory, startMock, stopMock, } from '../support/mockLmStudioSdk.js';
import { closeWs, connectWs, sendJson, waitForEvent, } from '../support/wsClient.js';
const TASK17_LOG_MARKER = 'story.0000051.task17.cucumber_scenarios_registered';
const ORIGINAL_CODEINFO_CHAT_DEFAULT_PROVIDER = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
const ORIGINAL_CODEINFO_CHAT_DEFAULT_MODEL = process.env.CODEINFO_CHAT_DEFAULT_MODEL;
const ORIGINAL_CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
type ChatStartResponse = {
    status: 'started';
    conversationId: string;
    inflightId: string;
    provider: string;
    model: string;
};
type WsEvent = {
    protocolVersion?: string;
    type?: string;
    conversationId?: string;
    inflightId?: string;
    inflight?: {
        inflightId?: string;
        toolEvents?: unknown[];
    };
    event?: {
        type?: string;
    };
    status?: string;
    error?: {
        message?: string;
    };
    content?: string;
};
let server: Server | null = null;
let wsHandle: WsServerHandle | null = null;
let ws: WebSocket | null = null;
let baseUrl = '';
let statusCode: number | null = null;
let startResponse: ChatStartResponse | null = null;
let errorResponse: {
    code?: string;
    message?: string;
} | null = null;
let received: WsEvent[] = [];
const ORIGINAL_CODEINFO_CODEX_HOME = process.env.CODEINFO_CODEX_HOME;
let tempCodexHomeForScenario: string | null = null;
let namedCopilotScenarioServer: StartedNamedCopilotScenarioServer | null = null;
let externalServers: ExternalOpenAiCompatServer[] = [];
let activeConversationId: string | null = null;
function createConversationId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
async function removeDirectoryWithRetry(targetPath: string, attempts = 8): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await fs.rm(targetPath, { recursive: true, force: true });
            return;
        }
        catch (error) {
            lastError = error;
            if (!(error instanceof Error &&
                'code' in error &&
                (error.code === 'ENOTEMPTY' || error.code === 'EBUSY'))) {
                throw error;
            }
            const remainingEntries = await fs
                .readdir(targetPath)
                .catch(() => [] as string[]);
            if (attempt === attempts) {
                throw new Error([
                    `Failed to remove ${targetPath} after ${attempts} attempts`,
                    `last_code=${String((error as {
                        code?: string;
                    }).code ?? 'unknown')}`,
                    `remaining_entries=${remainingEntries.join(',') || '(none)'}`,
                ].join(' | '), { cause: error });
            }
            await new Promise((resolve) => setTimeout(resolve, Math.min(1000, attempt * 200)));
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error(`Failed to remove ${targetPath}`);
}
async function writeCodexChatConfig(params: {
    model: string;
    endpointId: string;
}) {
    if (!tempCodexHomeForScenario) {
        throw new Error('codex home not initialised');
    }
    await fs.mkdir(path.join(tempCodexHomeForScenario, 'chat'), {
        recursive: true,
    });
    await fs.writeFile(path.join(tempCodexHomeForScenario, 'chat', 'config.toml'), [
        `model = "${params.model}"`,
        `codeinfo_openai_endpoint = "${params.endpointId}|responses"`,
        '',
    ].join('\n'), 'utf8');
}
function createUnavailableCopilotLifecycle() {
    return createMockCopilotSdkHarness({
        name: 'cucumber-chat-stream-copilot-auth-required',
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
function registerTask17Scenario(scenarioName: NamedCopilotScenario) {
    const context = {
        scenario: scenarioName,
        surface: 'cucumber',
        feature: 'chat_stream',
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
async function startLegacyChatStreamServer() {
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
    app.use('/chat', createChatRouter({
        clientFactory: () => new MockLMStudioClient() as unknown as LMStudioClient,
        copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }));
    const httpServer = http.createServer(app);
    server = httpServer;
    wsHandle = attachWs({ httpServer });
    await new Promise<void>((resolve) => {
        httpServer.listen(0, () => {
            const address = httpServer.address();
            if (!address || typeof address === 'string') {
                throw new Error('Unable to start test server');
            }
            baseUrl = `http://localhost:${address.port}`;
            resolve();
        });
    });
}
async function ensureWsSubscribed(conversationId: string) {
    if (!ws) {
        ws = await connectWs({ baseUrl });
    }
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
}
Before(async () => {
    resetStore();
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'ws://localhost:1234');
    externalServers = [];
    activeConversationId = null;
    tempCodexHomeForScenario = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-stream-codex-home-'));
    await writeCodexChatConfig({
        model: 'gpt-5.3-codex',
        endpointId: 'https://alpha.example/v1',
    });
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", tempCodexHomeForScenario);
    baseUrl = '';
});
After(async () => {
    stopMock();
    resetStore();
    if (ws) {
        await closeWs(ws);
        ws = null;
    }
    if (namedCopilotScenarioServer) {
        await namedCopilotScenarioServer.stop();
        namedCopilotScenarioServer = null;
    }
    while (externalServers.length > 0) {
        await externalServers.pop()!.stop();
    }
    if (wsHandle) {
        await wsHandle.close();
        wsHandle = null;
    }
    if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        server = null;
    }
    received = [];
    statusCode = null;
    startResponse = null;
    errorResponse = null;
    activeConversationId = null;
    if (ORIGINAL_CODEINFO_CODEX_HOME === undefined) {
        clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
    }
    else {
        setScopedTestEnvValue("CODEINFO_CODEX_HOME", ORIGINAL_CODEINFO_CODEX_HOME);
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
    if (ORIGINAL_CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS === undefined) {
        clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
    }
    else {
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", ORIGINAL_CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS);
    }
    if (tempCodexHomeForScenario) {
        const codexHomeToRemove = tempCodexHomeForScenario;
        tempCodexHomeForScenario = null;
        await removeDirectoryWithRetry(codexHomeToRemove);
    }
});
Given('chat stream scenario {string}', async (name: string) => {
    if (name === 'external-endpoint-native-fallback') {
        const server = await startExternalOpenAiCompatServer({
            responseMode: 'transport-failure',
            models: ['gpt-5.3-codex'],
        });
        externalServers.push(server);
        await writeCodexChatConfig({
            model: 'gpt-5.3-codex',
            endpointId: `${server.baseUrl}/v1`,
        });
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${server.baseUrl}/v1|responses`);
        await startLegacyChatStreamServer();
        return;
    }
    if (name === 'external-endpoint-native-failure') {
        const server = await startExternalOpenAiCompatServer({
            responseMode: 'transport-failure',
            models: ['gpt-5.3-codex'],
        });
        externalServers.push(server);
        await writeCodexChatConfig({
            model: 'gpt-5.3-codex',
            endpointId: `${server.baseUrl}/v1`,
        });
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${server.baseUrl}/v1|responses`);
        await startLegacyChatStreamServer();
        return;
    }
    if (name === 'external-endpoint-repair') {
        const server = await startExternalOpenAiCompatServer({
            models: ['alpha', 'beta'],
        });
        externalServers.push(server);
        await writeCodexChatConfig({
            model: 'missing-codex-model',
            endpointId: `${server.baseUrl}/v1`,
        });
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${server.baseUrl}/v1|responses`);
        await startLegacyChatStreamServer();
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
    await startLegacyChatStreamServer();
});
Given('later fallback providers are unavailable', () => {
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", '');
});
When('I POST to the chat endpoint with the chat request fixture', async () => {
    activeConversationId = createConversationId('chat-fixture-conv');
    await ensureWsSubscribed(activeConversationId);
    const userMessage = Array.isArray(chatRequestFixture.messages)
        ? String(chatRequestFixture.messages.find((msg) => (msg as {
            role?: string;
        }).role === 'user')?.content ?? 'Hello')
        : 'Hello';
    const res = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            provider: (chatRequestFixture as {
                provider?: string;
            }).provider ?? 'lmstudio',
            model: (chatRequestFixture as {
                model?: string;
            }).model ?? 'model-1',
            conversationId: activeConversationId,
            message: userMessage,
        }),
    });
    statusCode = res.status;
    const body = (await res.json()) as Record<string, unknown>;
    if (statusCode === 202) {
        startResponse = body as unknown as ChatStartResponse;
        errorResponse = null;
    }
    else {
        startResponse = null;
        errorResponse = {
            code: body.code as string | undefined,
            message: body.message as string | undefined,
        };
    }
});
When('I POST to the chat endpoint with the chat request fixture omitting provider and model', async () => {
    activeConversationId = createConversationId('chat-fixture-conv');
    await ensureWsSubscribed(activeConversationId);
    const userMessage = Array.isArray(chatRequestFixture.messages)
        ? String(chatRequestFixture.messages.find((msg) => (msg as {
            role?: string;
        }).role === 'user')?.content ?? 'Hello')
        : 'Hello';
    const res = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            conversationId: activeConversationId,
            message: userMessage,
        }),
    });
    statusCode = res.status;
    const body = (await res.json()) as Record<string, unknown>;
    if (statusCode === 202) {
        startResponse = body as unknown as ChatStartResponse;
        errorResponse = null;
    }
    else {
        startResponse = null;
        errorResponse = {
            code: body.code as string | undefined,
            message: body.message as string | undefined,
        };
    }
});
Then('the chat stream status code is {int}', (status: number) => {
    assert.strictEqual(statusCode, status);
    if (status === 202) {
        assert.ok(startResponse);
        assert.equal(startResponse.status, 'started');
        assert.ok(startResponse.conversationId);
        assert.ok(startResponse.inflightId);
    }
});
When('I wait for the WebSocket inflight snapshot and final event', async () => {
    assert.ok(startResponse);
    await ensureWsSubscribed(startResponse.conversationId);
    const snapshot = await waitForEvent({
        ws: ws as WebSocket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'inflight_snapshot' &&
                e.conversationId === startResponse?.conversationId &&
                e.inflight?.inflightId === startResponse?.inflightId);
        },
    });
    received.push(snapshot);
    const final = await waitForEvent({
        ws: ws as WebSocket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'turn_final' &&
                e.conversationId === startResponse?.conversationId &&
                e.inflightId === startResponse?.inflightId);
        },
        timeoutMs: 4000,
    });
    received.push(final);
});
Then('the WebSocket stream includes an inflight snapshot and a final event', () => {
    const snapshot = received.find((event) => event.type === 'inflight_snapshot');
    const final = received.find((event) => event.type === 'turn_final');
    assert(snapshot, 'expected inflight snapshot event');
    assert(final, 'expected final turn event');
});
When('I wait for the WebSocket failed final event {string}', async (message: string) => {
    assert.ok(startResponse);
    await ensureWsSubscribed(startResponse.conversationId);
    const final = await waitForEvent({
        ws: ws as WebSocket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'turn_final' &&
                e.conversationId === startResponse?.conversationId &&
                e.inflightId === startResponse?.inflightId &&
                e.status === 'failed' &&
                (e.error?.message ?? '').includes(message));
        },
        timeoutMs: 4000,
    });
    received.push(final);
});
Then('the WebSocket stream includes a failed final event {string}', (message: string) => {
    const failedFinal = received.find((event) => event.type === 'turn_final' &&
        event.status === 'failed' &&
        (event.error?.message ?? '').includes(message));
    assert(failedFinal, 'expected failed final event');
});
When('I wait for streamed tool request and result events', async () => {
    assert.ok(startResponse);
    await ensureWsSubscribed(startResponse.conversationId);
    const snapshot = await waitForEvent({
        ws: ws as WebSocket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'inflight_snapshot' &&
                e.conversationId === startResponse?.conversationId &&
                e.inflight?.inflightId === startResponse?.inflightId);
        },
    });
    received.push(snapshot);
    const firstTool = await waitForEvent({
        ws: ws as WebSocket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'tool_event' &&
                e.conversationId === startResponse?.conversationId &&
                e.inflightId === startResponse?.inflightId);
        },
        timeoutMs: 4000,
    });
    received.push(firstTool);
    const seenTypes = () => {
        const seen = new Set<string>();
        for (const event of received) {
            (event.inflight?.toolEvents ?? []).forEach((tool) => {
                const type = (tool as {
                    type?: string;
                }).type;
                if (type)
                    seen.add(type);
            });
            if (event.type === 'tool_event' && event.event?.type) {
                seen.add(event.event.type);
            }
        }
        return seen;
    };
    while (!(seenTypes().has('tool-request') && seenTypes().has('tool-result'))) {
        const next = await waitForEvent({
            ws: ws as WebSocket,
            predicate: (event: unknown): event is WsEvent => {
                const e = event as WsEvent;
                return (e?.type === 'tool_event' &&
                    e.conversationId === startResponse?.conversationId &&
                    e.inflightId === startResponse?.inflightId);
            },
            timeoutMs: 4000,
        });
        received.push(next);
    }
});
Then('the streamed events include tool request and result events', () => {
    const seen = new Set<string>();
    for (const event of received) {
        (event.inflight?.toolEvents ?? []).forEach((tool) => {
            const type = (tool as {
                type?: string;
            }).type;
            if (type)
                seen.add(type);
        });
        if (event.type === 'tool_event' && event.event?.type) {
            seen.add(event.event.type);
        }
    }
    assert(seen.has('tool-request'), 'tool-request missing');
    assert(seen.has('tool-result'), 'tool-result missing');
});
Then('tool events are logged to the log store', () => {
    const toolLogs = query({ text: 'chat.stream.tool_event' });
    assert(toolLogs.length > 0, 'expected tool events in log store');
});
When('I POST to the chat endpoint with a two-message chat history', async () => {
    const conversationId = createConversationId('chat-history-conv');
    activeConversationId = conversationId;
    await ensureWsSubscribed(conversationId);
    const first = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            provider: 'lmstudio',
            model: 'model-1',
            conversationId,
            message: 'First question',
        }),
    });
    const firstBody = (await first.json()) as ChatStartResponse;
    statusCode = first.status;
    await waitForEvent({
        ws: ws as WebSocket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'turn_final' &&
                e.conversationId === conversationId &&
                e.inflightId === firstBody.inflightId);
        },
        timeoutMs: 4000,
    });
    const second = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            provider: 'lmstudio',
            model: 'model-1',
            conversationId,
            message: 'Second question',
        }),
    });
    const secondBody = (await second.json()) as ChatStartResponse;
    statusCode = second.status;
    await waitForEvent({
        ws: ws as WebSocket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'turn_final' &&
                e.conversationId === conversationId &&
                e.inflightId === secondBody.inflightId);
        },
        timeoutMs: 4000,
    });
});
Then('the LM Studio chat history length is {int}', (expected: number) => {
    assert.strictEqual(getLastChatHistory().length, expected);
});
Given('chat default provider is {string}', (provider: string) => {
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", provider);
});
Given('chat default model is {string}', (model: string) => {
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_MODEL", model);
});
Given('codex detection is unavailable', () => {
    setCodexDetection({
        available: false,
        authPresent: false,
        configPresent: false,
        reason: 'codex unavailable in test',
    });
});
Given('codex detection is available', () => {
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
        cliPath: '/usr/bin/codex',
    });
});
When('I POST to the chat endpoint with provider {string} and model {string}', async (provider: string, model: string) => {
    const conversationId = `chat-provider-${provider}-${Date.now()}`;
    await ensureWsSubscribed(conversationId);
    const res = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            provider,
            model,
            conversationId,
            message: 'provider fallback check',
        }),
    });
    statusCode = res.status;
    const body = (await res.json()) as Record<string, unknown>;
    if (statusCode === 202) {
        startResponse = body as unknown as ChatStartResponse;
        errorResponse = null;
    }
    else {
        startResponse = null;
        errorResponse = {
            code: body.code as string | undefined,
            message: body.message as string | undefined,
        };
    }
});
Then('the chat start response provider is {string}', (provider: string) => {
    assert.ok(startResponse);
    assert.equal(startResponse.provider, provider);
});
Then('the chat start response model is {string}', (model: string) => {
    assert.ok(startResponse);
    assert.equal(startResponse.model, model);
});
Then('the chat error code is {string}', (code: string) => {
    assert.ok(errorResponse);
    assert.equal(errorResponse.code, code);
});
Then('the chat error message is {string}', (message: string) => {
    assert.ok(errorResponse);
    assert.equal(errorResponse.message, message);
});
When('I POST to the chat endpoint with raw message {string}', async (message: string) => {
    const conversationId = `chat-raw-${Date.now()}`;
    await ensureWsSubscribed(conversationId);
    const res = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            provider: 'lmstudio',
            model: 'model-1',
            conversationId,
            message,
        }),
    });
    statusCode = res.status;
    const body = (await res.json()) as Record<string, unknown>;
    if (statusCode === 202) {
        startResponse = body as unknown as ChatStartResponse;
        errorResponse = null;
    }
    else {
        startResponse = null;
        errorResponse = {
            code: body.code as string | undefined,
            message: body.message as string | undefined,
        };
    }
});
When('I POST to the chat endpoint with a whitespace-only message', async () => {
    const conversationId = `chat-whitespace-${Date.now()}`;
    await ensureWsSubscribed(conversationId);
    const res = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            provider: 'lmstudio',
            model: 'model-1',
            conversationId,
            message: '   \t  ',
        }),
    });
    statusCode = res.status;
    startResponse = null;
    const body = (await res.json()) as Record<string, unknown>;
    errorResponse = {
        code: body.code as string | undefined,
        message: body.message as string | undefined,
    };
});
When('I POST to the chat endpoint with a newline-only message', async () => {
    const conversationId = `chat-newline-${Date.now()}`;
    await ensureWsSubscribed(conversationId);
    const res = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            provider: 'lmstudio',
            model: 'model-1',
            conversationId,
            message: '\n\n\r\n',
        }),
    });
    statusCode = res.status;
    startResponse = null;
    const body = (await res.json()) as Record<string, unknown>;
    errorResponse = {
        code: body.code as string | undefined,
        message: body.message as string | undefined,
    };
});
Then('the user turn content is {string}', async (expected: string) => {
    assert.ok(startResponse);
    await ensureWsSubscribed(startResponse.conversationId);
    const userTurn = await waitForEvent({
        ws: ws as WebSocket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'user_turn' &&
                e.conversationId === startResponse?.conversationId &&
                e.inflightId === startResponse?.inflightId);
        },
        timeoutMs: 4000,
    });
    assert.equal(userTurn.content, expected);
});
