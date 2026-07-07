import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ThreadOptions as CodexThreadOptions } from '@openai/codex-sdk';
import { ChatInterfaceCodex } from '../../chat/interfaces/ChatInterfaceCodex.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
describe('ChatInterfaceCodex workingDirectoryOverride', () => {
    it('uses workingDirectoryOverride when provided', async () => {
        setCodexDetection({
            available: true,
            authPresent: true,
            configPresent: true,
        });
        const originalWorkdir = process.env.CODEX_WORKDIR;
        setScopedTestEnvValue("CODEX_WORKDIR", '/tmp/default-workdir');
        const captured: {
            start?: CodexThreadOptions;
        } = {};
        const events = async function* () {
            yield { type: 'thread.started', thread_id: 'tid-override' };
            yield {
                type: 'item.completed',
                item: { type: 'agent_message', text: 'ok' },
            };
            yield { type: 'turn.completed' };
        };
        const thread = {
            id: 'tid-override',
            runStreamed: async () => ({ events: events() }),
        };
        const chat = new ChatInterfaceCodex(() => ({
            startThread: (opts?: CodexThreadOptions) => {
                captured.start = opts;
                return thread;
            },
            resumeThread: () => thread,
        }));
        try {
            await chat.run('Hello', {
                threadId: null,
                useConfigDefaults: true,
                workingDirectoryOverride: '/tmp/override',
                skipPersistence: true,
            }, 'conv-override', 'gpt-5.1-codex-max');
        }
        finally {
            setScopedTestEnvValue("CODEX_WORKDIR", originalWorkdir);
        }
        assert(captured.start);
        assert.equal(captured.start.workingDirectory, '/tmp/override');
    });
    it('merges envOverrides into the codex environment', async () => {
        setCodexDetection({
            available: true,
            authPresent: true,
            configPresent: true,
        });
        const captured: {
            options?: unknown;
        } = {};
        const events = async function* () {
            yield { type: 'thread.started', thread_id: 'tid-env' };
            yield {
                type: 'item.completed',
                item: { type: 'agent_message', text: 'ok' },
            };
            yield { type: 'turn.completed' };
        };
        const thread = {
            id: 'tid-env',
            runStreamed: async () => ({ events: events() }),
        };
        const chat = new ChatInterfaceCodex((options) => {
            captured.options = options ?? {};
            return {
                startThread: () => thread,
                resumeThread: () => thread,
            };
        });
        await chat.run('Hello', {
            threadId: null,
            useConfigDefaults: true,
            envOverrides: { CODEINFO_ROOT: '/tmp/codeinfo-root' },
            skipPersistence: true,
        }, 'conv-env', 'gpt-5.1-codex-max');
        assert(captured.options);
        assert.equal((captured.options as {
            env?: NodeJS.ProcessEnv;
        }).env?.CODEINFO_ROOT, '/tmp/codeinfo-root');
    });
});
