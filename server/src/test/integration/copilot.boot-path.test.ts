import assert from 'node:assert/strict';
import nodeFs from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import type { ModelInfo } from '@github/copilot-sdk';
import express from 'express';
import request from 'supertest';
import { __resetCopilotSeedBootstrapHooksForTests, __setCopilotSeedBootstrapHooksForTests, importCopilotSeedIntoRuntimeHome, } from '../../config/copilotSeedBootstrap.js';
import { createChatRouter } from '../../routes/chat.js';
import { createChatModelsRouter } from '../../routes/chatModels.js';
import { createChatProvidersRouter } from '../../routes/chatProviders.js';
import { queryTask16BootLogs, startNamedCopilotScenarioServer, } from '../support/copilotBootPath.js';
import { createMockCopilotSdkHarness } from '../support/mockCopilotSdk.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';
import { closeWs, connectWs, sendJson, waitForEvent, } from '../support/wsClient.js';
const envSnapshot = new Map<string, string | undefined>();
const setEnv = (key: string, value: string | undefined) => {
    if (!envSnapshot.has(key)) {
        envSnapshot.set(key, process.env[key]);
    }
    if (value === undefined) {
        clearScopedTestEnvValue(key);
        return;
    }
    setScopedTestEnvValue(key, value);
};
const restoreEnv = () => {
    for (const [key, value] of envSnapshot.entries()) {
        if (value === undefined) {
            clearScopedTestEnvValue(key);
        }
        else {
            setScopedTestEnvValue(key, value);
        }
    }
    envSnapshot.clear();
};
const runWithIsolatedCopilotHome = async <T>(copilotHome: string, fn: () => Promise<T>): Promise<T> => await runWithTestEnvOverrides({
    CODEX_HOME: undefined,
    CODEINFO_CODEX_HOME: undefined,
    CODEINFO_COPILOT_HOME: copilotHome,
    CODEINFO_LMSTUDIO_HOME: undefined,
    CODEINFO_CHAT_DEFAULT_PROVIDER: undefined,
    CODEINFO_CHAT_DEFAULT_MODEL: undefined,
    CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS: undefined,
    CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS: undefined,
}, fn);
beforeEach(() => {
    setEnv('CODEX_HOME', undefined);
    setEnv('CODEINFO_CODEX_HOME', undefined);
    setEnv('CODEINFO_COPILOT_HOME', undefined);
    setEnv('CODEINFO_LMSTUDIO_HOME', undefined);
    setEnv('CODEINFO_CHAT_DEFAULT_PROVIDER', undefined);
    setEnv('CODEINFO_CHAT_DEFAULT_MODEL', undefined);
    setEnv('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', undefined);
    setEnv('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS', undefined);
});
afterEach(() => {
    restoreEnv();
});
async function writeSeedArtifacts(seedHome: string) {
    await fs.mkdir(path.join(seedHome, 'session-state'), { recursive: true });
    await fs.writeFile(path.join(seedHome, 'config.json'), '{"store_token_plaintext": true}\n', 'utf8');
    await fs.writeFile(path.join(seedHome, 'settings.json'), '{"storeTokenPlaintext": true}\n', 'utf8');
    await fs.writeFile(path.join(seedHome, 'session-state', 'session.json'), '{"bootstrapped": true}\n', 'utf8');
}
async function writeRuntimeArtifacts(params: {
    runtimeHome: string;
    includeConfig?: boolean;
    includeSettings?: boolean;
    includeSessionState?: boolean;
}) {
    await fs.mkdir(params.runtimeHome, { recursive: true });
    if (params.includeSessionState) {
        await fs.mkdir(path.join(params.runtimeHome, 'session-state'), {
            recursive: true,
        });
        await fs.writeFile(path.join(params.runtimeHome, 'session-state', 'session.json'), '{"bootstrapped": false, "runtimeWins": true}\n', 'utf8');
    }
    if (params.includeConfig) {
        await fs.writeFile(path.join(params.runtimeHome, 'config.json'), '{"runtime":"wins"}\n', 'utf8');
    }
    if (params.includeSettings) {
        await fs.writeFile(path.join(params.runtimeHome, 'settings.json'), '{"runtimeSettings":"wins"}\n', 'utf8');
    }
}
async function writeCopilotChatConfig(seedHome: string, contents: string) {
    await fs.mkdir(path.join(seedHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(seedHome, 'chat', 'config.toml'), contents, 'utf8');
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
async function lockDownRuntimeArtifacts(runtimeHome: string) {
    await fs.chmod(path.join(runtimeHome, 'config.json'), 0o000);
    await fs.chmod(path.join(runtimeHome, 'settings.json'), 0o000);
    await fs.chmod(path.join(runtimeHome, 'session-state', 'session.json'), 0o000);
    await fs.chmod(path.join(runtimeHome, 'session-state'), 0o000);
}
async function hasBootstrappedRuntime(runtimeHome: string) {
    try {
        await Promise.all([
            fs.access(path.join(runtimeHome, 'config.json')),
            fs.access(path.join(runtimeHome, 'settings.json')),
            fs.access(path.join(runtimeHome, 'session-state')),
        ]);
        return true;
    }
    catch {
        return false;
    }
}
async function listBootstrapStageRoots(parentDir: string) {
    const entries = await fs.readdir(parentDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('.copilot-seed-stage-'))
        .map((entry) => entry.name);
}
async function withForcedSessionStateRenameExdev<T>(callback: () => Promise<T>): Promise<T> {
    const originalRename = nodeFs.promises.rename;
    nodeFs.promises.rename = async (oldPath: nodeFs.PathLike, newPath: nodeFs.PathLike) => {
        if (typeof oldPath === 'string' &&
            typeof newPath === 'string' &&
            oldPath.includes(`${path.sep}session-state`) &&
            newPath.endsWith(`${path.sep}session-state`)) {
            const error = new Error('cross-device link not permitted') as NodeJS.ErrnoException;
            error.code = 'EXDEV';
            throw error;
        }
        return originalRename.call(nodeFs.promises, oldPath, newPath);
    };
    try {
        return await callback();
    }
    finally {
        nodeFs.promises.rename = originalRename;
    }
}
const createReadyPingResponse = () => ({
    message: 'ready',
    timestamp: Date.now(),
});
const createReadyModels = (): ModelInfo[] => [
    {
        id: 'copilot-gpt-5',
        name: 'Copilot GPT-5',
        capabilities: {
            supports: {
                vision: false,
                reasoningEffort: true,
            },
            limits: {
                max_context_window_tokens: 200000,
            },
        },
        supportedReasoningEfforts: ['medium'],
        defaultReasoningEffort: 'medium',
    },
];
test('named happy-path fake Copilot scenario boots the higher-level stack end to end', async () => {
    const server = await startNamedCopilotScenarioServer({
        scenarioName: 'copilot-happy-path',
    });
    try {
        const providers = await request(server.httpServer).get('/chat/providers');
        assert.equal(providers.status, 200);
        const copilotProvider = providers.body.providers.find((provider: {
            id?: string;
        }) => provider.id === 'copilot');
        assert.ok(copilotProvider);
        assert.equal(copilotProvider.available, true);
        const models = await request(server.httpServer).get('/chat/models?provider=copilot');
        assert.equal(models.status, 200);
        assert.equal(models.body.provider, 'copilot');
        assert.equal(models.body.available, true);
        assert.equal(models.body.models[0]?.key, 'copilot-gpt-5');
        const ws = await connectWs({ baseUrl: server.baseUrl });
        try {
            const conversationId = 'task16-boot-happy-path';
            sendJson(ws, {
                type: 'subscribe_conversation',
                conversationId,
            });
            const start = await request(server.httpServer).post('/chat').send({
                provider: 'copilot',
                model: 'copilot-gpt-5',
                conversationId,
                message: 'Hello from task 16',
            });
            assert.equal(start.status, 202);
            assert.equal(start.body.provider, 'copilot');
            const final = await waitForEvent({
                ws,
                predicate: (event: unknown): event is {
                    type?: string;
                    status?: string;
                    conversationId?: string;
                } => {
                    const candidate = event as {
                        type?: string;
                        status?: string;
                        conversationId?: string;
                    };
                    return (candidate.type === 'turn_final' &&
                        candidate.status === 'ok' &&
                        candidate.conversationId === conversationId);
                },
                timeoutMs: 4000,
            });
            assert.equal(final.status, 'ok');
        }
        finally {
            await closeWs(ws);
        }
        const task16Logs = queryTask16BootLogs();
        assert.ok(task16Logs.length > 0);
        assert.equal(task16Logs.at(-1)?.context?.scenario, 'copilot-happy-path');
    }
    finally {
        await server.stop();
    }
});
test('named auth-required fake Copilot scenario surfaces the negative path cleanly', async () => {
    const server = await startNamedCopilotScenarioServer({
        scenarioName: 'copilot-auth-required',
    });
    try {
        const providers = await request(server.httpServer).get('/chat/providers');
        assert.equal(providers.status, 200);
        const copilotProvider = providers.body.providers.find((provider: {
            id?: string;
        }) => provider.id === 'copilot');
        assert.ok(copilotProvider);
        assert.equal(copilotProvider.available, false);
        assert.equal(copilotProvider.reason, 'copilot authentication required');
        const auth = await request(server.httpServer)
            .post('/copilot/device-auth')
            .send({});
        assert.equal(auth.status, 200);
        assert.equal(auth.body.provider, 'copilot');
        assert.equal(auth.body.state, 'verification_ready');
        assert.equal(auth.body.userCode, 'TASK16-ABCD');
        const task16Logs = queryTask16BootLogs();
        assert.ok(task16Logs.length > 0);
        assert.equal(task16Logs.at(-1)?.context?.scenario, 'copilot-auth-required');
    }
    finally {
        await server.stop();
    }
});
test('boot-path seeding repairs partial runtime homes and still skips a complete runtime on the next startup pass', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-boot-path-'));
    const seedHome = path.join(tempRoot, 'seed-home');
    const runtimeHome = path.join(tempRoot, 'runtime-home');
    const clientFactory = () => ({
        system: {
            listDownloadedModels: async () => [],
        },
    }) as never;
    try {
        await writeSeedArtifacts(seedHome);
        await writeRuntimeArtifacts({
            runtimeHome,
            includeConfig: true,
        });
        const seedResult = await importCopilotSeedIntoRuntimeHome({
            runtimeHome,
            seedHome,
            env: currentRuntimeEnv(),
        });
        assert.equal(seedResult.status, 'seed_applied');
        assert.deepEqual(seedResult.copiedArtifacts.sort(), [
            'session-state',
            'settings.json',
        ]);
        await lockDownRuntimeArtifacts(runtimeHome);
        const normalizationResult = await importCopilotSeedIntoRuntimeHome({
            runtimeHome,
            seedHome,
            env: currentRuntimeEnv(),
        });
        assert.equal(normalizationResult.status, 'seed_skipped_runtime_already_initialized');
        assert.deepEqual(normalizationResult.copiedArtifacts, []);
        await runWithIsolatedCopilotHome(runtimeHome, async () => {
            const app = express();
            app.use('/chat', createChatProvidersRouter({
                clientFactory,
                copilotRuntimeFactory: () => ({
                    start: async () => { },
                    stop: async () => [],
                    ping: async () => createReadyPingResponse(),
                    getAuthStatus: async () => ({
                        isAuthenticated: await hasBootstrappedRuntime(runtimeHome),
                        authType: 'user',
                    }),
                    listModels: async () => (await hasBootstrappedRuntime(runtimeHome))
                        ? createReadyModels()
                        : [],
                }),
            }));
            app.use('/chat', createChatModelsRouter({
                clientFactory,
                copilotRuntimeFactory: () => ({
                    start: async () => { },
                    stop: async () => [],
                    ping: async () => createReadyPingResponse(),
                    getAuthStatus: async () => ({
                        isAuthenticated: await hasBootstrappedRuntime(runtimeHome),
                        authType: 'user',
                    }),
                    listModels: async () => (await hasBootstrappedRuntime(runtimeHome))
                        ? createReadyModels()
                        : [],
                }),
            }));
            const providers = await request(app).get('/chat/providers');
            assert.equal(providers.status, 200);
            const copilotProvider = providers.body.providers.find((provider: {
                id?: string;
            }) => provider.id === 'copilot');
            assert.ok(copilotProvider);
            assert.equal(copilotProvider.available, true);
            const models = await request(app).get('/chat/models?provider=copilot');
            assert.equal(models.status, 200);
            assert.equal(models.body.provider, 'copilot');
            assert.equal(models.body.available, true);
            assert.equal(models.body.models[0]?.key, 'copilot-gpt-5');
        });
    }
    finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
test('boot-path seeding repairs the supported /seed/copilot to /app/copilot session-state seam when directory rename crosses devices', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-boot-exdev-'));
    const seedHome = path.join(tempRoot, 'seed', 'copilot');
    const runtimeHome = path.join(tempRoot, 'app', 'copilot');
    const clientFactory = () => ({
        system: {
            listDownloadedModels: async () => [],
        },
    }) as never;
    try {
        await writeSeedArtifacts(seedHome);
        await writeRuntimeArtifacts({
            runtimeHome,
            includeConfig: true,
            includeSettings: true,
        });
        const seedResult = await withForcedSessionStateRenameExdev(() => importCopilotSeedIntoRuntimeHome({
            runtimeHome,
            seedHome,
            env: currentRuntimeEnv(),
        }));
        assert.equal(seedResult.status, 'seed_applied');
        assert.deepEqual(seedResult.copiedArtifacts, ['session-state']);
        assert.match(JSON.stringify(seedResult), /seed_applied/u);
        assert.equal(await fs.readFile(path.join(runtimeHome, 'session-state', 'session.json'), 'utf8'), '{"bootstrapped": true}\n');
        await runWithIsolatedCopilotHome(runtimeHome, async () => {
            const app = express();
            app.use('/chat', createChatProvidersRouter({
                clientFactory,
                copilotRuntimeFactory: () => ({
                    start: async () => { },
                    stop: async () => [],
                    ping: async () => createReadyPingResponse(),
                    getAuthStatus: async () => ({
                        isAuthenticated: await hasBootstrappedRuntime(runtimeHome),
                        authType: 'user',
                    }),
                    listModels: async () => (await hasBootstrappedRuntime(runtimeHome))
                        ? createReadyModels()
                        : [],
                }),
            }));
            const providers = await request(app).get('/chat/providers');
            assert.equal(providers.status, 200);
            const copilotProvider = providers.body.providers.find((provider: {
                id?: string;
            }) => provider.id === 'copilot');
            assert.ok(copilotProvider);
            assert.equal(copilotProvider.available, true);
            assert.equal(seedResult.status, 'seed_applied');
            assert.doesNotMatch(seedResult.error ?? '', /seed_copy_failed|EXDEV/u);
        });
    }
    finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
test('boot-path seeding rejects symlinked /seed/copilot runtime artifacts before they become trusted in /app/copilot', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-boot-symlink-'));
    const seedHome = path.join(tempRoot, 'seed', 'copilot');
    const runtimeHome = path.join(tempRoot, 'app', 'copilot');
    const realSessionState = path.join(tempRoot, 'linked-session-state');
    const clientFactory = () => ({
        system: {
            listDownloadedModels: async () => [],
        },
    }) as never;
    try {
        await writeSeedArtifacts(seedHome);
        await fs.mkdir(realSessionState, { recursive: true });
        await fs.writeFile(path.join(realSessionState, 'session.json'), '{"linked":true}\n', 'utf8');
        await fs.rm(path.join(seedHome, 'session-state'), {
            recursive: true,
            force: true,
        });
        await fs.symlink(realSessionState, path.join(seedHome, 'session-state'));
        const seedResult = await importCopilotSeedIntoRuntimeHome({
            runtimeHome,
            seedHome,
            env: currentRuntimeEnv(),
        });
        assert.equal(seedResult.status, 'seed_copy_failed');
        assert.match(seedResult.error ?? '', /symlink/u);
        assert.match(seedResult.error ?? '', /session-state/u);
        assert.equal(await hasBootstrappedRuntime(runtimeHome), false);
        await runWithIsolatedCopilotHome(runtimeHome, async () => {
            const app = express();
            app.use('/chat', createChatProvidersRouter({
                clientFactory,
                copilotRuntimeFactory: () => ({
                    start: async () => { },
                    stop: async () => [],
                    ping: async () => createReadyPingResponse(),
                    getAuthStatus: async () => ({
                        isAuthenticated: await hasBootstrappedRuntime(runtimeHome),
                        authType: 'user',
                    }),
                    listModels: async () => (await hasBootstrappedRuntime(runtimeHome))
                        ? createReadyModels()
                        : [],
                }),
            }));
            const providers = await request(app).get('/chat/providers');
            assert.equal(providers.status, 200);
            const copilotProvider = providers.body.providers.find((provider: {
                id?: string;
            }) => provider.id === 'copilot');
            assert.ok(copilotProvider);
            assert.equal(copilotProvider.available, false);
        });
    }
    finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
test('boot-path seeding preserves a runtime that initializes after preflight instead of surfacing a mixed seed/runtime state', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-boot-replay-safe-'));
    const seedHome = path.join(tempRoot, 'seed-home');
    const runtimeHome = path.join(tempRoot, 'runtime-home');
    const clientFactory = () => ({
        system: {
            listDownloadedModels: async () => [],
        },
    }) as never;
    let injectedRuntime = false;
    try {
        await writeSeedArtifacts(seedHome);
        __setCopilotSeedBootstrapHooksForTests({
            beforePublishArtifact: async ({ artifact }) => {
                if (artifact !== 'settings.json' || injectedRuntime)
                    return;
                injectedRuntime = true;
                await fs.mkdir(path.join(runtimeHome, 'session-state'), {
                    recursive: true,
                });
                await fs.writeFile(path.join(runtimeHome, 'config.json'), '{"runtime":"wins-after-preflight"}\n', 'utf8');
                await fs.writeFile(path.join(runtimeHome, 'settings.json'), '{"runtimeSettings":"wins-after-preflight"}\n', 'utf8');
                await fs.writeFile(path.join(runtimeHome, 'session-state', 'session.json'), '{"bootstrapped": false, "runtimeWins": true}\n', 'utf8');
            },
        });
        const seedResult = await importCopilotSeedIntoRuntimeHome({
            runtimeHome,
            seedHome,
            env: currentRuntimeEnv(),
        });
        assert.equal(seedResult.status, 'seed_skipped_runtime_already_initialized');
        assert.deepEqual(seedResult.copiedArtifacts, []);
        assert.equal(await fs.readFile(path.join(runtimeHome, 'config.json'), 'utf8'), '{"runtime":"wins-after-preflight"}\n');
        assert.deepEqual(await listBootstrapStageRoots(tempRoot), []);
        await runWithIsolatedCopilotHome(runtimeHome, async () => {
            const app = express();
            app.use('/chat', createChatProvidersRouter({
                clientFactory,
                copilotRuntimeFactory: () => ({
                    start: async () => { },
                    stop: async () => [],
                    ping: async () => createReadyPingResponse(),
                    getAuthStatus: async () => ({
                        isAuthenticated: await hasBootstrappedRuntime(runtimeHome),
                        authType: 'user',
                    }),
                    listModels: async () => (await hasBootstrappedRuntime(runtimeHome))
                        ? createReadyModels()
                        : [],
                }),
            }));
            app.use('/chat', createChatModelsRouter({
                clientFactory,
                copilotRuntimeFactory: () => ({
                    start: async () => { },
                    stop: async () => [],
                    ping: async () => createReadyPingResponse(),
                    getAuthStatus: async () => ({
                        isAuthenticated: await hasBootstrappedRuntime(runtimeHome),
                        authType: 'user',
                    }),
                    listModels: async () => (await hasBootstrappedRuntime(runtimeHome))
                        ? createReadyModels()
                        : [],
                }),
            }));
            const providers = await request(app).get('/chat/providers');
            assert.equal(providers.status, 200);
            const copilotProvider = providers.body.providers.find((provider: {
                id?: string;
            }) => provider.id === 'copilot');
            assert.ok(copilotProvider);
            assert.equal(copilotProvider.available, true);
            const models = await request(app).get('/chat/models?provider=copilot');
            assert.equal(models.status, 200);
            assert.equal(models.body.provider, 'copilot');
            assert.equal(models.body.available, true);
            assert.equal(models.body.models[0]?.key, 'copilot-gpt-5');
        });
    }
    finally {
        __resetCopilotSeedBootstrapHooksForTests();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
test('seeded runtime boot normalizes the surfaced Copilot default model and lets chat start without forwarding unsupported reasoning', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-boot-normalized-default-'));
    const seedHome = path.join(tempRoot, 'seed-home');
    const runtimeHome = path.join(tempRoot, 'runtime-home');
    const clientFactory = () => ({
        system: {
            listDownloadedModels: async () => [],
        },
    }) as never;
    const sdkHarness = createMockCopilotSdkHarness({
        name: 'copilot-normalized-default-model',
        models: [
            {
                id: 'gpt-5-mini',
                name: 'GPT-5 Mini',
            } as ModelInfo,
        ],
    });
    try {
        await writeSeedArtifacts(seedHome);
        await writeCopilotChatConfig(seedHome, ['model = "copilot-gpt-5"', 'reasoning_effort = "high"', ''].join('\n'));
        await runWithIsolatedCopilotHome(seedHome, async () => {
            const seedResult = await importCopilotSeedIntoRuntimeHome({
                runtimeHome,
                seedHome,
                env: currentRuntimeEnv(),
            });
            assert.equal(seedResult.status, 'seed_applied');
            const app = express();
            app.use(express.json());
            app.use('/chat', createChatProvidersRouter({
                clientFactory,
                copilotRuntimeFactory: () => sdkHarness.createLifecycle(),
            }));
            app.use('/chat', createChatModelsRouter({
                clientFactory,
                copilotRuntimeFactory: () => sdkHarness.createLifecycle(),
            }));
            app.use('/chat', createChatRouter({
                clientFactory,
                copilotLifecycleFactory: () => sdkHarness.createLifecycle(),
            }));
            const providers = await request(app).get('/chat/providers').expect(200);
            const copilotProvider = providers.body.providers.find((provider: {
                id?: string;
            }) => provider.id === 'copilot');
            assert.ok(copilotProvider);
            assert.equal(copilotProvider.defaultModel, 'gpt-5-mini');
            const models = await request(app)
                .get('/chat/models?provider=copilot')
                .expect(200);
            assert.equal(models.body.defaultModel, 'gpt-5-mini');
            assert.equal(models.body.models[0]?.key, 'gpt-5-mini');
            const chat = await request(app).post('/chat').send({
                provider: 'copilot',
                conversationId: 'boot-normalized-default',
                message: 'Hello from the normalized default path',
            });
            assert.equal(chat.status, 202);
            assert.equal(chat.body.provider, 'copilot');
            assert.equal(chat.body.model, 'gpt-5-mini');
            const createdSessionConfig = await sdkHarness.waitForCreateSessionConfig();
            assert.equal(createdSessionConfig.model, 'gpt-5-mini');
            assert.equal(createdSessionConfig.reasoningEffort, undefined);
        });
    }
    finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
