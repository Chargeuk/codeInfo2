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
import { getActiveRunOwnership } from '../../agents/runLock.js';
import { getPendingConversationCancel, snapshotInflight, } from '../../chat/inflightRegistry.js';
import { createRequestLogger } from '../../logger.js';
import { createChatRouter } from '../../routes/chat.js';
import { attachWs, type WsServerHandle } from '../../ws/server.js';
import { MockLMStudioClient, type MockScenario, getLastPredictionState, startMock, stopMock, } from '../support/mockLmStudioSdk.js';
import { closeWs, connectWs, sendJson, waitForEvent, } from '../support/wsClient.js';
type ChatStartResponse = {
    status: 'started';
    conversationId: string;
    inflightId: string;
    provider: string;
    model: string;
};
type WsEvent = {
    type?: string;
    conversationId?: string;
    inflightId?: string;
    inflight?: {
        inflightId?: string;
    };
    status?: string;
    requestId?: string;
    result?: string;
};
let server: Server | null = null;
let wsHandle: WsServerHandle | null = null;
let ws: WebSocket | null = null;
let baseUrl = '';
let startResponse: ChatStartResponse | null = null;
const ORIGINAL_CODEINFO_CODEX_HOME = process.env.CODEINFO_CODEX_HOME;
const RUN_SETTLE_TIMEOUT_MS = 15000;
let tempCodexHomeForScenario: string | null = null;
async function ensureWs() {
    if (!ws) {
        ws = await connectWs({ baseUrl });
    }
    return ws;
}
async function startChatRunAndSubscribe() {
    const userMessage = Array.isArray(chatRequestFixture.messages)
        ? String(chatRequestFixture.messages.find((msg) => (msg as {
            role?: string;
        }).role === 'user')?.content ?? 'Hello')
        : 'Hello';
    const conversationId = `chat-cancel-fixture-${crypto.randomUUID()}`;
    const socket = await ensureWs();
    sendJson(socket, {
        type: 'subscribe_conversation',
        conversationId,
    });
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
            conversationId,
            message: userMessage,
        }),
    });
    startResponse = (await res.json()) as ChatStartResponse;
    assert.equal(res.status, 202);
    assert.ok(startResponse.inflightId);
    await waitForEvent({
        ws: socket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'inflight_snapshot' &&
                e.conversationId === startResponse?.conversationId &&
                e.inflight?.inflightId === startResponse?.inflightId);
        },
    });
}
async function waitForServerRunToSettle(conversationId: string) {
    const deadline = Date.now() + RUN_SETTLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const inflight = snapshotInflight(conversationId);
        const ownership = getActiveRunOwnership(conversationId);
        const pendingCancel = getPendingConversationCancel(conversationId);
        if (!inflight && !ownership && !pendingCancel) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Timed out waiting for chat run cleanup to settle');
}
async function waitForActiveChatRunToStartStreaming() {
    assert.ok(startResponse);
    const socket = await ensureWs();
    await waitForEvent({
        ws: socket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'assistant_delta' &&
                e.conversationId === startResponse?.conversationId &&
                e.inflightId === startResponse?.inflightId);
        },
        timeoutMs: 15000,
    });
}
Before(async () => {
    setScopedTestEnvValue("CODEINFO_LMSTUDIO_BASE_URL", 'ws://localhost:1234');
    tempCodexHomeForScenario = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-cancel-codex-home-'));
    await fs.mkdir(path.join(tempCodexHomeForScenario, 'chat'), {
        recursive: true,
    });
    await fs.writeFile(path.join(tempCodexHomeForScenario, 'chat', 'config.toml'), 'model = "gpt-5.3-codex"\n', 'utf8');
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", tempCodexHomeForScenario);
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
});
After(async () => {
    stopMock();
    if (ws) {
        await closeWs(ws);
        ws = null;
    }
    if (wsHandle) {
        await wsHandle.close();
        wsHandle = null;
    }
    if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        server = null;
    }
    startResponse = null;
    if (ORIGINAL_CODEINFO_CODEX_HOME === undefined) {
        clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
    }
    else {
        setScopedTestEnvValue("CODEINFO_CODEX_HOME", ORIGINAL_CODEINFO_CODEX_HOME);
    }
    if (tempCodexHomeForScenario) {
        await fs.rm(tempCodexHomeForScenario, { recursive: true, force: true });
        tempCodexHomeForScenario = null;
    }
});
Given('chat cancellation scenario {string}', (name: string) => {
    startMock({ scenario: name as MockScenario });
});
When('I start a chat run and unsubscribe from the conversation stream', async () => {
    await startChatRunAndSubscribe();
    assert.ok(startResponse);
    await waitForActiveChatRunToStartStreaming();
    const socket = await ensureWs();
    sendJson(socket, {
        type: 'unsubscribe_conversation',
        conversationId: startResponse.conversationId,
    });
});
When('I start a chat run and stay subscribed to the conversation stream', async () => {
    await startChatRunAndSubscribe();
});
When('the active chat run starts streaming', async () => {
    await waitForActiveChatRunToStartStreaming();
});
Then('the chat prediction is not cancelled server side', async () => {
    const state = getLastPredictionState();
    assert(state, 'prediction state missing');
    assert.strictEqual(state.cancelled, false);
});
When('I send cancel_inflight for the active run', async () => {
    assert.ok(startResponse);
    const socket = await ensureWs();
    sendJson(socket, {
        type: 'cancel_inflight',
        conversationId: startResponse.conversationId,
        inflightId: startResponse.inflightId,
    });
});
When('I send conversation-only cancel_inflight for the active run', async () => {
    assert.ok(startResponse);
    const socket = await ensureWs();
    sendJson(socket, {
        type: 'cancel_inflight',
        conversationId: startResponse.conversationId,
    });
});
When('I wait for the active run to complete normally', async () => {
    assert.ok(startResponse);
    const socket = await ensureWs();
    const final = await waitForEvent({
        ws: socket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'turn_final' &&
                e.conversationId === startResponse?.conversationId &&
                e.inflightId === startResponse?.inflightId);
        },
        timeoutMs: 4000,
    });
    assert.equal(final.status, 'ok');
});
When('I send late cancel_inflight for the completed run', async () => {
    assert.ok(startResponse);
    await waitForServerRunToSettle(startResponse.conversationId);
    const socket = await ensureWs();
    sendJson(socket, {
        type: 'cancel_inflight',
        conversationId: startResponse.conversationId,
    });
});
Then('the WebSocket stream final status is {string}', async (status: string) => {
    assert.ok(startResponse);
    const socket = await ensureWs();
    const final = await waitForEvent({
        ws: socket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'turn_final' &&
                e.conversationId === startResponse?.conversationId &&
                e.inflightId === startResponse?.inflightId);
        },
        timeoutMs: 4000,
    });
    assert.equal(final.status, status);
    const state = getLastPredictionState();
    assert(state, 'prediction state missing');
    assert.strictEqual(state.cancelled, true);
});
Then('the late cancel returns cancel_ack and no second terminal event', async () => {
    assert.ok(startResponse);
    const socket = await ensureWs();
    const ack = await waitForEvent({
        ws: socket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'cancel_ack' &&
                e.conversationId === startResponse?.conversationId &&
                e.result === 'noop');
        },
        timeoutMs: 4000,
    });
    assert.equal(ack.conversationId, startResponse.conversationId);
    assert.equal(ack.result, 'noop');
    await assert.rejects(waitForEvent({
        ws: socket,
        predicate: (event: unknown): event is WsEvent => {
            const e = event as WsEvent;
            return (e?.type === 'turn_final' &&
                e.conversationId === startResponse?.conversationId);
        },
        timeoutMs: 300,
    }));
});
Then('the websocket session remains open', async () => {
    const socket = await ensureWs();
    assert.equal(socket.readyState, socket.OPEN);
});
