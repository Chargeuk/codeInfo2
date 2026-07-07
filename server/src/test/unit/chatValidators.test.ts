import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { STORY_47_TASK_1_LOG_MARKER } from '../../config/chatDefaults.js';
import { __resetProviderBootstrapStatusForTests, __setProviderBootstrapStatusForTests, } from '../../config/runtimeConfig.js';
import { ChatValidationError, modelReasoningEfforts, validateChatRequest, } from '../../routes/chatValidators.js';
import { knownRepositoryPathsAvailable, knownRepositoryPathsUnavailable, } from '../../workingFolders/state.js';
const ENV_KEYS = [
    'Codex_sandbox_mode',
    'Codex_approval_policy',
    'Codex_reasoning_effort',
    'Codex_network_access_enabled',
    'Codex_web_search_enabled',
    'CODEINFO_CHAT_DEFAULT_PROVIDER',
    'CODEINFO_CHAT_DEFAULT_MODEL',
    'CODEINFO_CODEX_HOME',
    'CODEX_HOME',
] as const;
const originalEnv = new Map<string, string | undefined>();
const tempDirs: string[] = [];
const setEnv = (values: Record<string, string | undefined>) => {
    ENV_KEYS.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(values, key))
            return;
        const value = values[key];
        if (value === undefined) {
            clearScopedTestEnvValue(key);
            return;
        }
        setScopedTestEnvValue(key, value);
    });
};
const setChatConfig = async (chatToml: string) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-task7-'));
    tempDirs.push(root);
    const codexHome = path.join(root, 'codex');
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), chatToml, 'utf8');
    setScopedTestEnvValue("CODEX_HOME", codexHome);
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", codexHome);
};
beforeEach(() => {
    ENV_KEYS.forEach((key) => {
        originalEnv.set(key, process.env[key]);
        clearScopedTestEnvValue(key);
    });
    __resetProviderBootstrapStatusForTests();
});
afterEach(async () => {
    ENV_KEYS.forEach((key) => {
        const value = originalEnv.get(key);
        if (value === undefined) {
            clearScopedTestEnvValue(key);
            return;
        }
        setScopedTestEnvValue(key, value);
    });
    await Promise.all(tempDirs
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })));
    __resetProviderBootstrapStatusForTests();
});
test('resolver defaults apply when agentFlags are omitted', async () => {
    await setChatConfig(`
sandbox_mode = "workspace-write"
approval_policy = "on-request"
model_reasoning_effort = "medium"
web_search = "disabled"
`);
    setEnv({
        Codex_network_access_enabled: 'false',
    });
    const result = await validateChatRequest({
        model: 'gpt-5.1-codex-max',
        message: 'hello',
        conversationId: 'c1',
        provider: 'codex',
    });
    assert.deepEqual(result.agentFlags, {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        modelReasoningEffort: 'medium',
        modelReasoningSummary: 'auto',
        modelVerbosity: 'medium',
        networkAccessEnabled: false,
        webSearchMode: 'disabled',
    });
    assert.equal(result.warnings.length, 0);
});
test('chat request resolves provider and model from provider-local defaults after env provider selection', async () => {
    await setChatConfig('model = "gpt-5.3-codex"\n');
    setEnv({
        CODEINFO_CHAT_DEFAULT_PROVIDER: 'codex',
    });
    const result = await validateChatRequest({
        message: 'hello',
        conversationId: 'shared-defaults-1',
    });
    assert.equal(result.provider, 'codex');
    assert.equal(result.model, 'gpt-5.3-codex');
    assert.equal(result.defaultsResolution.providerSource, 'env');
    assert.equal(result.defaultsResolution.modelSource, 'config');
});
test('invalid shared env defaults fallback without leaking invalid state', async () => {
    await setChatConfig('');
    setEnv({
        CODEINFO_CHAT_DEFAULT_PROVIDER: 'not-a-provider',
    });
    const result = await validateChatRequest({
        message: 'hello',
        conversationId: 'shared-defaults-2',
    });
    assert.equal(result.provider, 'codex');
    assert.equal(result.model, 'gpt-5.3-codex');
    assert.equal(result.defaultsResolution.providerSource, 'fallback');
    assert.equal(result.defaultsResolution.modelSource, 'fallback');
    assert.ok(result.warnings.some((warning) => warning.includes('CODEINFO_CHAT_DEFAULT_PROVIDER must be one of')));
});
test('omitted codex provider and model resolve through the chat-config-aware default path', async () => {
    await setChatConfig('model = "config-model"\n');
    const result = await validateChatRequest({
        message: 'hello',
        conversationId: 'shared-defaults-config',
    });
    assert.equal(result.provider, 'codex');
    assert.equal(result.model, 'config-model');
    assert.equal(result.defaultsResolution.providerSource, 'fallback');
    assert.equal(result.defaultsResolution.modelSource, 'config');
});
test('implicit degraded-bootstrap requests keep fallback-eligible threadId, provider, and warnings for route-level selection', async () => {
    __setProviderBootstrapStatusForTests('copilot', {
        healthy: false,
        reason: 'copilot bootstrap degraded',
        warnings: ['copilot bootstrap degraded warning'],
    });
    setEnv({
        CODEINFO_CHAT_DEFAULT_PROVIDER: 'copilot',
    });
    const result = await validateChatRequest({
        message: 'hello',
        conversationId: 'degraded-bootstrap-implicit',
        threadId: 'thread-fallback-eligible',
    });
    assert.equal(result.provider, 'copilot');
    assert.equal(result.threadId, 'thread-fallback-eligible');
    assert.equal(result.defaultsResolution.providerSource, 'env');
    assert.equal(result.warnings.includes('copilot bootstrap degraded warning'), true);
});
test('explicit degraded-bootstrap provider requests fail with provider-unavailable validation code', async () => {
    __setProviderBootstrapStatusForTests('copilot', {
        healthy: false,
        reason: 'copilot bootstrap degraded',
        warnings: ['copilot bootstrap degraded warning'],
    });
    await assert.rejects(() => validateChatRequest({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        message: 'hello',
        conversationId: 'degraded-bootstrap-explicit',
    }), (error: unknown) => {
        assert(error instanceof ChatValidationError);
        assert.equal(error.code, 'PROVIDER_UNAVAILABLE');
        assert.match(error.message, /copilot bootstrap degraded/i);
        return true;
    });
});
test('chat validation marker emits the shared warning_count and warnings fields alongside normalized model-source details', async () => {
    await setChatConfig('model = 7\n');
    const markerPayloads: Array<Record<string, unknown>> = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
        if (args[0] === STORY_47_TASK_1_LOG_MARKER && args[1]) {
            markerPayloads.push(args[1] as Record<string, unknown>);
        }
    };
    try {
        await validateChatRequest({
            model: 'override-model',
            message: 'hello',
            conversationId: 'marker-contract',
            provider: 'codex',
        });
        const marker = markerPayloads.at(-1);
        assert.ok(marker);
        assert.equal(marker.surface, 'chat_validation');
        assert.equal(marker.model_source, 'request');
        assert.equal(marker.codex_model_source, 'override');
        assert.equal(marker.warning_count, 1);
        assert.deepEqual(marker.warnings, [
            'codex/chat/config.toml has invalid value for "model", falling back to env/hardcoded defaults.',
        ]);
    }
    finally {
        console.info = originalInfo;
    }
});
test('explicit agentFlags override resolver defaults', async () => {
    await setChatConfig(`
sandbox_mode = "read-only"
approval_policy = "never"
model_reasoning_effort = "low"
web_search_mode = "disabled"
`);
    setEnv({
        Codex_network_access_enabled: 'false',
    });
    const result = await validateChatRequest({
        model: 'gpt-5.1-codex-max',
        message: 'hello',
        conversationId: 'c2',
        provider: 'codex',
        agentFlags: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            modelReasoningEffort: 'high',
            modelReasoningSummary: 'detailed',
            modelVerbosity: 'high',
            networkAccessEnabled: true,
            webSearchMode: 'live',
        },
    });
    assert.deepEqual(result.agentFlags, {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        modelReasoningEffort: 'high',
        modelReasoningSummary: 'detailed',
        modelVerbosity: 'high',
        networkAccessEnabled: true,
        webSearchMode: 'live',
    });
});
test('accepts every SDK-native reasoning effort value for Codex requests', async () => {
    for (const reasoningEffort of modelReasoningEfforts) {
        const result = await validateChatRequest({
            model: 'gpt-5.2-codex',
            message: 'hello',
            conversationId: `reasoning-${reasoningEffort}`,
            provider: 'codex',
            agentFlags: {
                modelReasoningEffort: reasoningEffort,
            },
        });
        assert.equal(result.agentFlags.modelReasoningEffort, reasoningEffort);
    }
});
test('rejects legacy top-level chat flags instead of silently remapping them', async () => {
    await assert.rejects(async () => await validateChatRequest({
        model: 'gpt-5.2-codex',
        message: 'hello',
        conversationId: 'legacy-top-level',
        provider: 'codex',
        sandboxMode: 'workspace-write',
    }), /legacy top-level chat flag "sandboxMode" is no longer supported/);
});
test('rejects contradictory provider-model-agentFlags combinations instead of coercing them', async () => {
    await assert.rejects(async () => await validateChatRequest({
        model: 'gpt-4o-mini',
        message: 'hello',
        conversationId: 'contradictory-provider-model-flags',
        provider: 'copilot',
        agentFlags: {
            sandboxMode: 'workspace-write',
        },
    }), /agentFlags\.sandboxMode is not supported for provider "copilot"/);
});
test('stale hidden provider-specific flags fail validation after a provider switch or restored mixed draft', async () => {
    await assert.rejects(async () => await validateChatRequest({
        model: 'model-1',
        message: 'hello',
        conversationId: 'stale-hidden-agent-flags',
        provider: 'lmstudio',
        agentFlags: {
            modelVerbosity: 'high',
            toolAccess: 'on',
        },
    }), /agentFlags\.modelVerbosity is not supported for provider "lmstudio"/);
});
test('chat request rejects endpointId for non-endpoint-backed LM Studio provider paths', async () => {
    await assert.rejects(async () => await validateChatRequest({
        model: 'model-1',
        message: 'hello',
        conversationId: 'lmstudio-endpoint-id',
        provider: 'lmstudio',
        endpointId: 'https://alpha.example/v1',
    }), /endpointId is not supported for provider "lmstudio"/);
});
test('chat request rejects a stale endpointId when defaults resolve to LM Studio after a create-mode transition', async () => {
    setEnv({
        CODEINFO_CHAT_DEFAULT_PROVIDER: 'lmstudio',
    });
    await assert.rejects(async () => await validateChatRequest({
        message: 'hello',
        conversationId: 'lmstudio-endpoint-id-default',
        endpointId: 'https://alpha.example/v1',
    }), /endpointId is not supported for provider "lmstudio"/);
});
test('chat request normalizes endpointId before later runtime selection uses it', async () => {
    const result = await validateChatRequest({
        model: 'gpt-5.1-codex-max',
        message: 'hello',
        conversationId: 'normalized-endpoint-id',
        provider: 'codex',
        endpointId: ' https://EXAMPLE.com/v1/ ',
    });
    assert.equal(result.endpointId, 'https://example.com/v1');
});
test('blank or whitespace-only LM Studio flag values fail validation instead of being trimmed into valid input', async () => {
    await assert.rejects(async () => await validateChatRequest({
        model: 'model-1',
        message: 'hello',
        conversationId: 'lmstudio-blank-values',
        provider: 'lmstudio',
        agentFlags: {
            contextOverflowPolicy: '   ',
        },
    }), /agentFlags\.contextOverflowPolicy must be one of: stopAtLimit, truncateMiddle, rollingWindow/);
    await assert.rejects(async () => await validateChatRequest({
        model: 'model-1',
        message: 'hello',
        conversationId: 'lmstudio-blank-tool-access',
        provider: 'lmstudio',
        agentFlags: {
            toolAccess: '',
        },
    }), /agentFlags\.toolAccess must be one of: on, off/);
});
test('out-of-range, non-numeric, or non-integer LM Studio flag values fail validation instead of being coerced', async () => {
    await assert.rejects(async () => await validateChatRequest({
        model: 'model-1',
        message: 'hello',
        conversationId: 'lmstudio-temperature-out-of-range',
        provider: 'lmstudio',
        agentFlags: {
            temperature: 3,
        },
    }), /agentFlags\.temperature must be at most 2/);
    await assert.rejects(async () => await validateChatRequest({
        model: 'model-1',
        message: 'hello',
        conversationId: 'lmstudio-max-tokens-non-numeric',
        provider: 'lmstudio',
        agentFlags: {
            maxTokens: '4096',
        },
    }), /agentFlags\.maxTokens must be a number/);
    await assert.rejects(async () => await validateChatRequest({
        model: 'model-1',
        message: 'hello',
        conversationId: 'lmstudio-max-tokens-non-integer',
        provider: 'lmstudio',
        agentFlags: {
            maxTokens: 1.5,
        },
    }), /agentFlags\.maxTokens must be an integer/);
    await assert.rejects(async () => await validateChatRequest({
        model: 'model-1',
        message: 'hello',
        conversationId: 'lmstudio-max-tokens-out-of-range',
        provider: 'lmstudio',
        agentFlags: {
            maxTokens: 0,
        },
    }), /agentFlags\.maxTokens must be at least 1/);
});
test('chat validation accepts a valid working_folder', async () => {
    const workingFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-working-folder-valid-'));
    tempDirs.push(workingFolder);
    const originalError = console.error;
    const errorLogs: string[] = [];
    console.error = (...args: unknown[]) => {
        errorLogs.push(args.map(String).join(' '));
    };
    try {
        const result = await validateChatRequest({
            model: 'gpt-5.2-codex',
            message: 'hello',
            conversationId: 'chat-working-folder-valid',
            provider: 'codex',
            working_folder: workingFolder,
        }, {
            knownRepositoryPathsState: knownRepositoryPathsAvailable([
                workingFolder,
            ]),
        });
        assert.equal(result.working_folder, workingFolder);
        assert.equal(errorLogs.length, 0, 'did not expect raw stderr debug logging on valid working_folder validation');
    }
    finally {
        console.error = originalError;
    }
});
test('chat validation rejects existing absolute working_folder when it is not ingested', async () => {
    const ingestedWorkingFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-working-folder-ingested-'));
    const nonIngestedWorkingFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-working-folder-non-ingested-'));
    tempDirs.push(ingestedWorkingFolder, nonIngestedWorkingFolder);
    await assert.rejects(async () => await validateChatRequest({
        model: 'gpt-5.2-codex',
        message: 'hello',
        conversationId: 'chat-working-folder-non-ingested',
        provider: 'codex',
        working_folder: nonIngestedWorkingFolder,
    }, {
        knownRepositoryPathsState: knownRepositoryPathsAvailable([
            ingestedWorkingFolder,
        ]),
    }), /working_folder not found/);
});
test('chat validation rejects a mounted local execution-root child working_folder when it is not ingested', async () => {
    const snapshot = {
        CODEINFO_HOST_INGEST_DIR: process.env.CODEINFO_HOST_INGEST_DIR,
        CODEINFO_CODEX_WORKDIR: process.env.CODEINFO_CODEX_WORKDIR,
        CODEX_WORKDIR: process.env.CODEX_WORKDIR,
    };
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-working-folder-execution-root-'));
    const hostIngestDir = path.join(tmp, 'host', 'base');
    const codexWorkdir = path.join(tmp, 'data');
    const workingFolder = path.join(hostIngestDir, 'codeinfo2', 'codeinfo2');
    const mappedWorkingFolder = path.join(codexWorkdir, 'codeinfo2', 'codeinfo2');
    try {
        setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", hostIngestDir);
        setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", codexWorkdir);
        clearScopedTestEnvValue("CODEX_WORKDIR");
        await fs.mkdir(mappedWorkingFolder, { recursive: true });
        await assert.rejects(async () => await validateChatRequest({
            model: 'gpt-5.2-codex',
            message: 'hello',
            conversationId: 'chat-working-folder-execution-root',
            provider: 'codex',
            working_folder: workingFolder,
        }, {
            knownRepositoryPathsState: knownRepositoryPathsAvailable([]),
        }), /working_folder not found/);
    }
    finally {
        setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", snapshot.CODEINFO_HOST_INGEST_DIR);
        setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", snapshot.CODEINFO_CODEX_WORKDIR);
        setScopedTestEnvValue("CODEX_WORKDIR", snapshot.CODEX_WORKDIR);
        await fs.rm(tmp, { recursive: true, force: true });
    }
});
test('chat validation accepts an ingested absolute working_folder', async () => {
    const workingFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-working-folder-ingested-valid-'));
    tempDirs.push(workingFolder);
    const result = await validateChatRequest({
        model: 'gpt-5.2-codex',
        message: 'hello',
        conversationId: 'chat-working-folder-ingested-valid',
        provider: 'codex',
        working_folder: workingFolder,
    }, {
        knownRepositoryPathsState: knownRepositoryPathsAvailable([workingFolder]),
    });
    assert.equal(result.working_folder, workingFolder);
});
test('chat validation surfaces repository-enumeration failure instead of accepting a non-ingested directory', async () => {
    const nonIngestedWorkingFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-working-folder-enum-unavailable-'));
    tempDirs.push(nonIngestedWorkingFolder);
    await assert.rejects(async () => await validateChatRequest({
        model: 'gpt-5.2-codex',
        message: 'hello',
        conversationId: 'chat-working-folder-enum-unavailable',
        provider: 'codex',
        working_folder: nonIngestedWorkingFolder,
    }, {
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
});
test('chat validation rejects invalid absolute-path working_folder with shared message', async () => {
    await assert.rejects(async () => await validateChatRequest({
        model: 'gpt-5.2-codex',
        message: 'hello',
        conversationId: 'chat-working-folder-invalid',
        provider: 'codex',
        working_folder: 'relative/path',
    }), /working_folder must be an absolute path/);
});
test('chat validation rejects missing-on-disk working_folder with shared message', async () => {
    const missingPath = path.join(os.tmpdir(), `chat-working-folder-missing-${Date.now()}`);
    await assert.rejects(async () => await validateChatRequest({
        model: 'gpt-5.2-codex',
        message: 'hello',
        conversationId: 'chat-working-folder-missing',
        provider: 'codex',
        working_folder: missingPath,
    }), /working_folder not found/);
});
test('chat request validation accepts copilot as a legal provider with provider-neutral defaults', async () => {
    const result = await validateChatRequest({
        model: 'gpt-4o-mini',
        message: 'hello from copilot',
        conversationId: 'copilot-valid',
        provider: 'copilot',
    });
    assert.equal(result.provider, 'copilot');
    assert.equal(result.model, 'gpt-4o-mini');
    assert.deepEqual(result.agentFlags, {
        modelReasoningEffort: 'medium',
        toolAccess: 'on',
    });
});
test('whitespace-only message is rejected with exact contract message', async () => {
    await assert.rejects(async () => await validateChatRequest({
        message: '   \t  ',
        conversationId: 'c-whitespace',
    }), /message must contain at least one non-whitespace character/);
});
test('newline-only message is rejected with exact contract message', async () => {
    await assert.rejects(async () => await validateChatRequest({
        message: '\n\n\r\n',
        conversationId: 'c-newline',
    }), /message must contain at least one non-whitespace character/);
});
test('message with surrounding whitespace is accepted and preserved', async () => {
    const result = await validateChatRequest({
        message: '  hello with spaces  \n',
        conversationId: 'c-surrounding',
    });
    assert.equal(result.message, '  hello with spaces  \n');
});
test('chat validation parity fixture mirrors resolver-backed defaults and warnings with provider-neutral flags', async () => {
    await setChatConfig(`
sandbox_mode = "workspace-write"
approval_policy = "on-request"
model_reasoning_effort = "medium"
web_search_mode = "disabled"
`);
    setEnv({
        Codex_network_access_enabled: 'false',
    });
    const result = await validateChatRequest({
        model: 'gpt-5.2-codex',
        message: 'hello parity',
        conversationId: 'c-parity',
        provider: 'codex',
    });
    assert.equal(result.agentFlags.sandboxMode, 'workspace-write');
    assert.equal(result.agentFlags.approvalPolicy, 'on-request');
    assert.equal(result.agentFlags.modelReasoningEffort, 'medium');
    assert.equal(result.agentFlags.webSearchMode, 'disabled');
});
