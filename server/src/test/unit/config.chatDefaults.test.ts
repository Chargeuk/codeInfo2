import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { ChatDefaultsResolutionError, ORDERED_CHAT_PROVIDERS, buildDefaultsAppliedMarkerPayload, resolveChatDefaults, resolveCodexChatDefaults, resolveRuntimeProviderSelection, } from '../../config/chatDefaults.js';
import { __resetProviderBootstrapStatusForTests, __setProviderBootstrapStatusForTests, ensureChatRuntimeConfigBootstrapped, } from '../../config/runtimeConfig.js';
const ENV_KEYS = [
    'CODEINFO_CHAT_DEFAULT_PROVIDER',
    'Codex_sandbox_mode',
    'Codex_approval_policy',
    'Codex_reasoning_effort',
    'Codex_web_search_enabled',
] as const;
const originalEnv = new Map<string, string | undefined>();
const tempDirs: string[] = [];
beforeEach(() => {
    ENV_KEYS.forEach((key) => {
        originalEnv.set(key, process.env[key]);
        clearScopedTestEnvValue(key);
    });
});
afterEach(async () => {
    ENV_KEYS.forEach((key) => {
        const value = originalEnv.get(key);
        if (value === undefined)
            clearScopedTestEnvValue(key);
        else
            setScopedTestEnvValue(key, value);
    });
    await Promise.all(tempDirs
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })));
    __resetProviderBootstrapStatusForTests();
});
test('explicit values win', () => {
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'lmstudio');
    const result = resolveChatDefaults({
        requestProvider: 'codex',
        requestModel: 'request-model',
    });
    assert.equal(result.provider, 'codex');
    assert.equal(result.model, 'request-model');
    assert.equal(result.providerSource, 'request');
    assert.equal(result.modelSource, 'request');
});
test('shared provider order is codex, copilot, lmstudio', () => {
    assert.deepEqual(ORDERED_CHAT_PROVIDERS, ['codex', 'copilot', 'lmstudio']);
});
test('same-provider model repair keeps the requested provider when that provider is healthy but the requested model is missing there', () => {
    const result = resolveRuntimeProviderSelection({
        requestedProvider: 'codex',
        requestedModel: 'gpt-5.3-codex',
        codex: {
            available: true,
            models: ['gpt-5.1-codex-max', 'gpt-5.3-codex-spark'],
            reason: undefined,
        },
        copilot: {
            available: true,
            models: ['gpt-5'],
            reason: undefined,
        },
        lmstudio: {
            available: true,
            models: ['qwen2.5'],
            reason: undefined,
        },
    });
    assert.equal(result.executionProvider, 'codex');
    assert.equal(result.executionModel, 'gpt-5.1-codex-max');
    assert.equal(result.fallbackApplied, false);
    assert.equal(result.decision, 'selected');
});
test('cross-provider fallback keeps the same requested model first when the fallback provider supports it', () => {
    const result = resolveRuntimeProviderSelection({
        requestedProvider: 'codex',
        requestedModel: 'gpt-5',
        codex: {
            available: false,
            models: [],
            reason: 'codex unavailable',
        },
        copilot: {
            available: false,
            models: [],
            reason: 'copilot unavailable',
        },
        lmstudio: {
            available: true,
            models: ['gpt-5', 'qwen2.5'],
            reason: undefined,
        },
    });
    assert.equal(result.executionProvider, 'lmstudio');
    assert.equal(result.executionModel, 'gpt-5');
    assert.equal(result.fallbackApplied, true);
    assert.equal(result.decision, 'fallback');
});
test('cross-provider fallback drops from the requested model to the fallback provider preferred model when the requested model is unavailable there', () => {
    const result = resolveRuntimeProviderSelection({
        requestedProvider: 'codex',
        requestedModel: 'gpt-5.3-codex',
        codex: {
            available: false,
            models: [],
            reason: 'codex unavailable',
        },
        copilot: {
            available: false,
            models: [],
            reason: 'copilot unavailable',
        },
        lmstudio: {
            available: true,
            models: ['llama-3.3', 'qwen2.5'],
            reason: undefined,
        },
    });
    assert.equal(result.executionProvider, 'lmstudio');
    assert.equal(result.executionModel, 'llama-3.3');
    assert.equal(result.fallbackApplied, true);
    assert.equal(result.decision, 'fallback');
});
test('endpoint-aware selection keeps the configured endpoint when the requested model exists there', () => {
    const result = resolveRuntimeProviderSelection({
        requestedProvider: 'codex',
        requestedModel: 'gpt-5.3-codex',
        endpoint: {
            endpointId: 'https://alpha.example/v1',
            available: true,
            models: ['gpt-5.3-codex', 'gpt-5.1-codex-max'],
            reason: undefined,
        },
        codex: {
            available: true,
            models: ['gpt-5.1-codex-max'],
            reason: undefined,
        },
        copilot: {
            available: true,
            models: ['gpt-5'],
            reason: undefined,
        },
        lmstudio: {
            available: true,
            models: ['qwen2.5'],
            reason: undefined,
        },
    });
    assert.equal(result.executionProvider, 'codex');
    assert.equal(result.executionModel, 'gpt-5.3-codex');
    assert.equal(result.executionPath, 'configured_endpoint');
    assert.equal(result.endpointId, 'https://alpha.example/v1');
    assert.equal(result.decision, 'selected');
    assert.equal(result.fallbackApplied, false);
});
test('endpoint-aware selection fails closed when the provider bootstrap is degraded even if the endpoint is healthy', () => {
    __setProviderBootstrapStatusForTests('codex', {
        healthy: false,
        reason: 'codex bootstrap degraded',
    });
    const result = resolveRuntimeProviderSelection({
        requestedProvider: 'codex',
        requestedModel: 'gpt-5.3-codex',
        endpoint: {
            endpointId: 'https://alpha.example/v1',
            available: true,
            models: ['gpt-5.3-codex', 'gpt-5.1-codex-max'],
            reason: undefined,
        },
        codex: {
            available: false,
            models: ['gpt-5.1-codex-max'],
            reason: 'codex bootstrap degraded',
            unavailableKind: 'bootstrap',
        },
        copilot: {
            available: true,
            models: ['gpt-5'],
            reason: undefined,
        },
        lmstudio: {
            available: true,
            models: ['qwen2.5'],
            reason: undefined,
        },
        allowCrossProviderFallback: false,
    });
    assert.equal(result.executionProvider, 'codex');
    assert.equal(result.executionModel, 'gpt-5.3-codex');
    assert.equal(result.executionPath, 'unavailable');
    assert.equal(result.endpointId, 'https://alpha.example/v1');
    assert.equal(result.decision, 'unavailable');
    assert.equal(result.unavailable, true);
    assert.equal(result.requestedReason, 'codex bootstrap degraded');
});
test('endpoint-aware selection repairs to the first selectable model on the same endpoint before broader fallback', () => {
    const result = resolveRuntimeProviderSelection({
        requestedProvider: 'codex',
        requestedModel: 'gpt-5.3-codex',
        endpoint: {
            endpointId: 'https://alpha.example/v1',
            available: true,
            models: ['gpt-5.1-codex-max', 'gpt-5.3-codex-spark'],
            reason: undefined,
        },
        codex: {
            available: true,
            models: ['gpt-5.1-codex-max'],
            reason: undefined,
        },
        copilot: {
            available: true,
            models: ['gpt-5'],
            reason: undefined,
        },
        lmstudio: {
            available: true,
            models: ['qwen2.5'],
            reason: undefined,
        },
    });
    assert.equal(result.executionProvider, 'codex');
    assert.equal(result.executionModel, 'gpt-5.1-codex-max');
    assert.equal(result.executionPath, 'same_endpoint_repair');
    assert.equal(result.endpointId, 'https://alpha.example/v1');
    assert.equal(result.decision, 'selected');
    assert.equal(result.fallbackApplied, true);
});
test('endpoint-aware selection falls back to the same provider native path before cross-provider fallback when the endpoint is unavailable', () => {
    const result = resolveRuntimeProviderSelection({
        requestedProvider: 'codex',
        requestedModel: 'gpt-5.3-codex',
        endpoint: {
            endpointId: 'https://alpha.example/v1',
            available: false,
            models: [],
            reason: 'endpoint unavailable',
        },
        codex: {
            available: true,
            models: ['gpt-5.1-codex-max', 'gpt-5.3-codex-spark'],
            reason: undefined,
        },
        copilot: {
            available: true,
            models: ['gpt-5'],
            reason: undefined,
        },
        lmstudio: {
            available: true,
            models: ['qwen2.5'],
            reason: undefined,
        },
    });
    assert.equal(result.executionProvider, 'codex');
    assert.equal(result.executionModel, 'gpt-5.1-codex-max');
    assert.equal(result.executionPath, 'same_provider_native_fallback');
    assert.equal(result.endpointId, 'https://alpha.example/v1');
    assert.equal(result.decision, 'fallback');
    assert.equal(result.fallbackApplied, true);
});
test('endpoint-aware selection reaches cross-provider fallback only after the endpoint path and same-provider native path are both unavailable', () => {
    const result = resolveRuntimeProviderSelection({
        requestedProvider: 'codex',
        requestedModel: 'gpt-5.3-codex',
        endpoint: {
            endpointId: 'https://alpha.example/v1',
            available: false,
            models: [],
            reason: 'endpoint unavailable',
        },
        codex: {
            available: false,
            models: [],
            reason: 'native codex unavailable',
        },
        copilot: {
            available: true,
            models: ['copilot-gpt-5'],
            reason: undefined,
        },
        lmstudio: {
            available: true,
            models: ['qwen2.5'],
            reason: undefined,
        },
    });
    assert.equal(result.executionProvider, 'copilot');
    assert.equal(result.executionModel, 'copilot-gpt-5');
    assert.equal(result.executionPath, 'cross_provider_fallback');
    assert.equal(result.endpointId, 'https://alpha.example/v1');
    assert.equal(result.decision, 'fallback');
    assert.equal(result.fallbackApplied, true);
});
test('endpoint-aware selection can fail in place when a pinned endpoint becomes unavailable', () => {
    const result = resolveRuntimeProviderSelection({
        requestedProvider: 'codex',
        requestedModel: 'gpt-5.3-codex',
        endpoint: {
            endpointId: 'https://alpha.example/v1',
            available: false,
            models: [],
            reason: 'endpoint unavailable',
        },
        failInPlaceOnEndpointUnavailable: true,
        codex: {
            available: true,
            models: ['gpt-5.1-codex-max', 'gpt-5.3-codex-spark'],
            reason: undefined,
        },
        copilot: {
            available: true,
            models: ['gpt-5'],
            reason: undefined,
        },
        lmstudio: {
            available: true,
            models: ['qwen2.5'],
            reason: undefined,
        },
    });
    assert.equal(result.executionProvider, 'codex');
    assert.equal(result.executionModel, 'gpt-5.3-codex');
    assert.equal(result.executionPath, 'unavailable');
    assert.equal(result.endpointId, 'https://alpha.example/v1');
    assert.equal(result.decision, 'unavailable');
    assert.equal(result.unavailable, true);
});
test('healthy endpoints still run when the requested provider is unavailable only because auth is missing', () => {
    const result = resolveRuntimeProviderSelection({
        requestedProvider: 'copilot',
        requestedModel: 'local-model',
        endpoint: {
            endpointId: 'https://alpha.example/v1',
            available: true,
            models: ['local-model'],
            reason: undefined,
        },
        allowCrossProviderFallback: false,
        codex: {
            available: true,
            models: ['gpt-5.3-codex'],
            reason: undefined,
        },
        copilot: {
            available: false,
            models: [],
            reason: 'copilot authentication required',
            unavailableKind: 'authentication',
        },
        lmstudio: {
            available: true,
            models: ['qwen2.5'],
            reason: undefined,
        },
    });
    assert.equal(result.executionProvider, 'copilot');
    assert.equal(result.executionModel, 'local-model');
    assert.equal(result.executionPath, 'configured_endpoint');
    assert.equal(result.decision, 'selected');
    assert.equal(result.unavailable, false);
});
test('defaults applied marker payload includes the resolved runtime path', () => {
    const payload = buildDefaultsAppliedMarkerPayload({
        surface: '/chat',
        requestedProvider: 'codex',
        requestedModel: 'gpt-5.3-codex',
        resolvedModel: 'gpt-5.1-codex-max',
        modelSource: 'request',
        runtimePath: 'same_provider_native_fallback',
        warnings: ['endpoint unavailable'],
    });
    assert.equal(payload.runtime_path, 'same_provider_native_fallback');
    assert.equal(payload.warning_count, 1);
    assert.deepEqual(payload.warnings, ['endpoint unavailable']);
});
const createProviderHome = async (provider: 'codex' | 'copilot' | 'lmstudio', chatConfigToml?: string) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `codeinfo2-${provider}-defaults-`));
    tempDirs.push(root);
    const providerHome = path.join(root, provider);
    if (chatConfigToml !== undefined) {
        await fs.mkdir(path.join(providerHome, 'chat'), { recursive: true });
        await fs.writeFile(path.join(providerHome, 'chat', 'config.toml'), chatConfigToml, 'utf8');
    }
    return providerHome;
};
test('provider env selects the matching provider-local default model', async () => {
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'lmstudio');
    const lmstudioHome = await createProviderHome('lmstudio', 'model = "lm-one"\n');
    const result = resolveChatDefaults({ lmstudioHome });
    assert.equal(result.provider, 'lmstudio');
    assert.equal(result.model, 'lm-one');
    assert.equal(result.providerSource, 'env');
    assert.equal(result.modelSource, 'config');
});
test('invalid provider env falls back to the first provider with a valid chat config', async () => {
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'invalid-provider');
    const codexHome = await createProviderHome('codex', 'model = "codex-one"\n');
    const result = resolveChatDefaults({ codexHome });
    assert.equal(result.provider, 'codex');
    assert.equal(result.model, 'codex-one');
    assert.equal(result.providerSource, 'fallback');
    assert.equal(result.modelSource, 'config');
});
test('default-provider fallback skips a broken provider-local config', async () => {
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", 'lmstudio');
    const codexHome = await createProviderHome('codex', 'model = "codex-one"\n');
    const lmstudioHome = await createProviderHome('lmstudio', '[broken');
    const result = resolveChatDefaults({ codexHome, lmstudioHome });
    assert.equal(result.provider, 'codex');
    assert.equal(result.model, 'codex-one');
    assert.equal(result.providerSource, 'fallback');
    assert.equal(result.modelSource, 'config');
});
test('invalid and empty provider env values are ignored without reviving shared env-model fallback', async () => {
    setScopedTestEnvValue("CODEINFO_CHAT_DEFAULT_PROVIDER", '');
    const codexHome = await createProviderHome('codex', 'model = "codex-one"\n');
    const result = resolveChatDefaults({ codexHome });
    assert.equal(result.provider, 'codex');
    assert.equal(result.model, 'codex-one');
    assert.equal(result.providerSource, 'fallback');
    assert.equal(result.modelSource, 'config');
    assert.ok(result.warnings.some((warning) => warning.includes('CODEINFO_CHAT_DEFAULT_PROVIDER is empty')));
});
test('explicit provider selection fails clearly when that provider chat config is broken', async () => {
    const lmstudioHome = await createProviderHome('lmstudio', '[broken');
    assert.throws(() => resolveChatDefaults({ requestProvider: 'lmstudio', lmstudioHome }), (error: unknown) => error instanceof ChatDefaultsResolutionError &&
        error.provider === 'lmstudio');
});
const createCodexHome = async (chatConfigToml?: string) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-chat-defaults-'));
    tempDirs.push(root);
    const codexHome = path.join(root, 'codex');
    if (chatConfigToml !== undefined) {
        await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
        await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), chatConfigToml, 'utf8');
    }
    return codexHome;
};
test('resolver falls back deterministically and warns when codex chat config TOML is invalid', async () => {
    const codexHome = await createCodexHome('[broken');
    const result = await resolveCodexChatDefaults({ codexHome });
    assert.equal(result.values.sandboxMode, 'danger-full-access');
    assert.equal(result.values.approvalPolicy, 'on-request');
    assert.equal(result.values.modelReasoningEffort, 'high');
    assert.equal(result.values.model, 'gpt-5.3-codex');
    assert.equal(result.values.webSearch, 'live');
    assert.ok(result.warnings.some((warning) => warning.includes('invalid') || warning.includes('could not be read')));
});
test('resolver rejects invalid field values from parsed config and falls back by field', async () => {
    setScopedTestEnvValue("Codex_sandbox_mode", 'workspace-write');
    setScopedTestEnvValue("Codex_approval_policy", 'never');
    setScopedTestEnvValue("Codex_reasoning_effort", 'medium');
    setScopedTestEnvValue("Codex_web_search_enabled", 'false');
    const codexHome = await createCodexHome(`
sandbox_mode = "invalid"
approval_policy = ""
model_reasoning_effort = "bad"
model = ""
web_search = "broken"
`);
    const result = await resolveCodexChatDefaults({ codexHome });
    assert.equal(result.values.sandboxMode, 'workspace-write');
    assert.equal(result.values.approvalPolicy, 'never');
    assert.equal(result.values.modelReasoningEffort, 'medium');
    assert.equal(result.values.model, 'gpt-5.3-codex');
    assert.equal(result.values.webSearch, 'disabled');
    assert.ok(result.warnings.some((warning) => warning.includes('invalid value for "sandbox_mode"')));
    assert.ok(result.warnings.some((warning) => warning.includes('invalid value for "approval_policy"')));
    assert.ok(result.warnings.some((warning) => warning.includes('invalid value for "model_reasoning_effort"')));
    assert.ok(result.warnings.some((warning) => warning.includes('invalid value for "model"')));
    assert.ok(result.warnings.some((warning) => warning.includes('invalid value for "web_search"')));
});
test('sandbox_mode precedence is override > config > env > hardcoded', async () => {
    setScopedTestEnvValue("Codex_sandbox_mode", 'workspace-write');
    const codexHome = await createCodexHome('sandbox_mode = "read-only"\n');
    const withOverride = await resolveCodexChatDefaults({
        codexHome,
        overrides: { sandboxMode: 'danger-full-access' },
    });
    assert.equal(withOverride.values.sandboxMode, 'danger-full-access');
    assert.equal(withOverride.sources.sandboxMode, 'override');
    const withConfig = await resolveCodexChatDefaults({ codexHome });
    assert.equal(withConfig.values.sandboxMode, 'read-only');
    assert.equal(withConfig.sources.sandboxMode, 'config');
    const noConfigHome = await createCodexHome();
    const withEnv = await resolveCodexChatDefaults({ codexHome: noConfigHome });
    assert.equal(withEnv.values.sandboxMode, 'workspace-write');
    assert.equal(withEnv.sources.sandboxMode, 'env');
    assert.ok(withEnv.warnings.some((warning) => warning.includes('sandbox_mode') &&
        warning.includes('Codex_sandbox_mode')));
    clearScopedTestEnvValue("Codex_sandbox_mode");
    const withHardcoded = await resolveCodexChatDefaults({
        codexHome: noConfigHome,
    });
    assert.equal(withHardcoded.values.sandboxMode, 'danger-full-access');
    assert.equal(withHardcoded.sources.sandboxMode, 'hardcoded');
});
test('approval_policy precedence is override > config > env > hardcoded', async () => {
    setScopedTestEnvValue("Codex_approval_policy", 'never');
    const codexHome = await createCodexHome('approval_policy = "on-request"\n');
    const withOverride = await resolveCodexChatDefaults({
        codexHome,
        overrides: { approvalPolicy: 'untrusted' },
    });
    assert.equal(withOverride.values.approvalPolicy, 'untrusted');
    assert.equal(withOverride.sources.approvalPolicy, 'override');
    const withConfig = await resolveCodexChatDefaults({ codexHome });
    assert.equal(withConfig.values.approvalPolicy, 'on-request');
    assert.equal(withConfig.sources.approvalPolicy, 'config');
    const noConfigHome = await createCodexHome();
    const withEnv = await resolveCodexChatDefaults({ codexHome: noConfigHome });
    assert.equal(withEnv.values.approvalPolicy, 'never');
    assert.equal(withEnv.sources.approvalPolicy, 'env');
    assert.ok(withEnv.warnings.some((warning) => warning.includes('approval_policy') &&
        warning.includes('Codex_approval_policy')));
    clearScopedTestEnvValue("Codex_approval_policy");
    const withHardcoded = await resolveCodexChatDefaults({
        codexHome: noConfigHome,
    });
    assert.equal(withHardcoded.values.approvalPolicy, 'on-request');
    assert.equal(withHardcoded.sources.approvalPolicy, 'hardcoded');
});
test('model_reasoning_effort precedence is override > config > env > hardcoded', async () => {
    setScopedTestEnvValue("Codex_reasoning_effort", 'low');
    const codexHome = await createCodexHome('model_reasoning_effort = "xhigh"\n');
    const withOverride = await resolveCodexChatDefaults({
        codexHome,
        overrides: { modelReasoningEffort: 'minimal' },
    });
    assert.equal(withOverride.values.modelReasoningEffort, 'minimal');
    assert.equal(withOverride.sources.modelReasoningEffort, 'override');
    const withConfig = await resolveCodexChatDefaults({ codexHome });
    assert.equal(withConfig.values.modelReasoningEffort, 'xhigh');
    assert.equal(withConfig.sources.modelReasoningEffort, 'config');
    const noConfigHome = await createCodexHome();
    const withEnv = await resolveCodexChatDefaults({ codexHome: noConfigHome });
    assert.equal(withEnv.values.modelReasoningEffort, 'low');
    assert.equal(withEnv.sources.modelReasoningEffort, 'env');
    assert.ok(withEnv.warnings.some((warning) => warning.includes('model_reasoning_effort') &&
        warning.includes('Codex_reasoning_effort')));
    clearScopedTestEnvValue("Codex_reasoning_effort");
    const withHardcoded = await resolveCodexChatDefaults({
        codexHome: noConfigHome,
    });
    assert.equal(withHardcoded.values.modelReasoningEffort, 'high');
    assert.equal(withHardcoded.sources.modelReasoningEffort, 'hardcoded');
});
test('model precedence is override > config > hardcoded', async () => {
    const codexHome = await createCodexHome('model = "config-model"\n');
    const withOverride = await resolveCodexChatDefaults({
        codexHome,
        overrides: { model: 'override-model' },
    });
    assert.equal(withOverride.values.model, 'override-model');
    assert.equal(withOverride.sources.model, 'override');
    const withConfig = await resolveCodexChatDefaults({ codexHome });
    assert.equal(withConfig.values.model, 'config-model');
    assert.equal(withConfig.sources.model, 'config');
    const noConfigHome = await createCodexHome();
    const withHardcoded = await resolveCodexChatDefaults({
        codexHome: noConfigHome,
    });
    assert.equal(withHardcoded.values.model, 'gpt-5.3-codex');
    assert.equal(withHardcoded.sources.model, 'hardcoded');
});
test('missing codex chat config falls back without creating the file', async () => {
    const codexHome = await createCodexHome();
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const result = await resolveCodexChatDefaults({ codexHome });
    assert.equal(result.values.model, 'gpt-5.3-codex');
    await assert.rejects(fs.access(chatConfigPath));
});
test('unreadable codex chat config warns and falls back without repair', async () => {
    const codexHome = await createCodexHome('model = "config-model"\n');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    await fs.rm(chatConfigPath);
    await fs.mkdir(chatConfigPath, { recursive: true });
    const result = await resolveCodexChatDefaults({ codexHome });
    assert.equal(result.values.model, 'gpt-5.3-codex');
    assert.ok(result.warnings.some((warning) => warning.includes('could not be read')));
    const stat = await fs.stat(chatConfigPath);
    assert.ok(stat.isDirectory());
});
test('bootstrap leaves invalid existing chat config untouched while defaults still warn and fall back', async () => {
    const codexHome = await createCodexHome('[broken');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const bootstrapResult = await ensureChatRuntimeConfigBootstrapped({
        codexHome,
    });
    const result = await resolveCodexChatDefaults({ codexHome });
    const chatContents = await fs.readFile(chatConfigPath, 'utf8');
    assert.equal(bootstrapResult.branch, 'existing_noop');
    assert.equal(chatContents, '[broken');
    assert.equal(result.values.model, 'gpt-5.3-codex');
    assert.ok(result.warnings.some((warning) => warning.includes('invalid') || warning.includes('could not be read')));
});
test('resolver rereads codex chat config on consecutive calls', async () => {
    const codexHome = await createCodexHome('model = "first-model"\n');
    const chatConfigPath = path.join(codexHome, 'chat', 'config.toml');
    const first = await resolveCodexChatDefaults({ codexHome });
    await fs.writeFile(chatConfigPath, 'model = "second-model"\n', 'utf8');
    const second = await resolveCodexChatDefaults({ codexHome });
    assert.equal(first.values.model, 'first-model');
    assert.equal(second.values.model, 'second-model');
});
test('canonical web_search wins when canonical and alias are both present', async () => {
    const codexHome = await createCodexHome(`
web_search = "cached"
web_search_request = true
`);
    const result = await resolveCodexChatDefaults({ codexHome });
    assert.equal(result.values.webSearch, 'cached');
    assert.equal(result.sources.webSearch, 'config');
});
test('invalid canonical web_search does not fall through to legacy aliases', async () => {
    const codexHome = await createCodexHome(`
web_search = "disable"
web_search_mode = "live"
web_search_request = true
`);
    const result = await resolveCodexChatDefaults({ codexHome });
    assert.equal(result.values.webSearch, 'live');
    assert.equal(result.sources.webSearch, 'hardcoded');
    assert.ok(result.warnings.some((warning) => warning.includes('invalid value for "web_search"')));
});
test('alias web_search=true maps to live when canonical is not set', async () => {
    const codexHome = await createCodexHome('web_search_request = true\n');
    const result = await resolveCodexChatDefaults({ codexHome });
    assert.equal(result.values.webSearch, 'live');
    assert.equal(result.sources.webSearch, 'config');
});
test('alias web_search=false maps to disabled when canonical is not set', async () => {
    const codexHome = await createCodexHome('web_search_request = false\n');
    const result = await resolveCodexChatDefaults({ codexHome });
    assert.equal(result.values.webSearch, 'disabled');
    assert.equal(result.sources.webSearch, 'config');
});
test('web_search canonical precedence is override > config > env > hardcoded with env warnings', async () => {
    setScopedTestEnvValue("Codex_web_search_enabled", 'false');
    const codexHome = await createCodexHome('web_search = "cached"\n');
    const withOverride = await resolveCodexChatDefaults({
        codexHome,
        overrides: { webSearch: 'live' },
    });
    assert.equal(withOverride.values.webSearch, 'live');
    assert.equal(withOverride.sources.webSearch, 'override');
    const withConfig = await resolveCodexChatDefaults({ codexHome });
    assert.equal(withConfig.values.webSearch, 'cached');
    assert.equal(withConfig.sources.webSearch, 'config');
    const noConfigHome = await createCodexHome();
    const withEnv = await resolveCodexChatDefaults({ codexHome: noConfigHome });
    assert.equal(withEnv.values.webSearch, 'disabled');
    assert.equal(withEnv.sources.webSearch, 'env');
    assert.ok(withEnv.warnings.some((warning) => warning.includes('web_search') &&
        warning.includes('Codex_web_search_enabled')));
    clearScopedTestEnvValue("Codex_web_search_enabled");
    const withHardcoded = await resolveCodexChatDefaults({
        codexHome: noConfigHome,
    });
    assert.equal(withHardcoded.values.webSearch, 'live');
    assert.equal(withHardcoded.sources.webSearch, 'hardcoded');
});
