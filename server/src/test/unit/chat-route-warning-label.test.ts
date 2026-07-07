import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import type { ThreadEvent, ThreadOptions as CodexThreadOptions, } from '@openai/codex-sdk';
import express from 'express';
import request from 'supertest';
import { query, resetStore } from '../../logStore.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
const envSnapshot = new Map<string, string | undefined>();
const tempDirs: string[] = [];
const setEnv = (key: string, value: string | undefined) => {
    if (!envSnapshot.has(key)) {
        envSnapshot.set(key, process.env[key]);
    }
    if (value === undefined) {
        clearScopedTestEnvValue(key);
    }
    else {
        setScopedTestEnvValue(key, value);
    }
};
class MockThread {
    constructor(private readonly id: string) { }
    async runStreamed(): Promise<{
        events: AsyncGenerator<ThreadEvent>;
    }> {
        const threadId = this.id;
        async function* generator(): AsyncGenerator<ThreadEvent> {
            yield { type: 'thread.started', thread_id: threadId } as ThreadEvent;
            yield {
                type: 'item.completed',
                item: { type: 'agent_message', text: 'Hello world' },
            } as ThreadEvent;
            yield { type: 'turn.completed' } as ThreadEvent;
        }
        return { events: generator() };
    }
}
class MockCodex {
    startThread(opts?: CodexThreadOptions) {
        void opts;
        return new MockThread('warning-label-thread');
    }
    resumeThread(threadId: string, opts?: CodexThreadOptions) {
        void opts;
        return new MockThread(threadId);
    }
}
const dummyClientFactory = () => ({
    llm: { model: async () => ({ act: async () => undefined }) },
}) as unknown as LMStudioClient;
afterEach(async () => {
    resetStore();
    setCodexDetection({
        available: false,
        authPresent: false,
        configPresent: false,
        reason: 'not detected',
    });
    for (const [key, value] of envSnapshot.entries()) {
        if (value === undefined) {
            clearScopedTestEnvValue(key);
        }
        else {
            setScopedTestEnvValue(key, value);
        }
    }
    envSnapshot.clear();
    await Promise.all(tempDirs
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
test('POST /chat logs defaults-resolution warnings under the provider-neutral validation label', async () => {
    resetStore();
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
        reason: 'available',
    });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-warning-label-'));
    tempDirs.push(root);
    const codexHome = path.join(root, 'codex');
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), 'model = false\n', 'utf8');
    setEnv('CODEX_HOME', codexHome);
    const app = express();
    app.use(express.json());
    app.use('/chat', createChatRouter({
        clientFactory: dummyClientFactory,
        codexFactory: () => new MockCodex(),
    }));
    const res = await request(app).post('/chat').send({
        provider: 'codex',
        conversationId: 'warning-label-conv',
        message: 'hello',
    });
    assert.equal(res.status, 202);
    const warningEntries = query({ text: 'chat validation warning' }, 20);
    assert.ok(warningEntries.length > 0);
    assert.equal(typeof warningEntries.at(-1)?.context?.warning, 'string');
    assert.notEqual(String(warningEntries.at(-1)?.context?.warning ?? ''), '');
    const staleEntries = query({ text: 'chat flag ignored' }, 20);
    assert.equal(staleEntries.length, 0);
});
test('POST /chat includes runtime config warnings from resolveChatRuntimeConfig', async () => {
    resetStore();
    setCodexDetection({
        available: true,
        authPresent: true,
        configPresent: true,
        reason: 'available',
    });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-runtime-warning-'));
    tempDirs.push(root);
    const codexHome = path.join(root, 'codex');
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), ['model = "gpt-5.3-codex"', 'approval_policy = "on-failure"', ''].join('\n'), 'utf8');
    setEnv('CODEX_HOME', codexHome);
    const app = express();
    app.use(express.json());
    app.use('/chat', createChatRouter({
        clientFactory: dummyClientFactory,
        codexFactory: () => new MockCodex(),
    }));
    const res = await request(app).post('/chat').send({
        provider: 'codex',
        conversationId: 'runtime-warning-conv',
        message: 'hello',
    });
    assert.equal(res.status, 202);
    assert.equal(res.body.warnings.includes('codex/chat/config.toml uses legacy approval_policy "on-failure"; normalized to "on-request".'), true);
});
