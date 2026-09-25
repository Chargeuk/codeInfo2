import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { __resetAgentAvailabilityDepsForTests, __setAgentAvailabilityDepsForTests, } from '../../agents/availability.js';
import { discoverAgents } from '../../agents/discovery.js';
import { resolveAgentHomeEnv, resolveAgentHomeForRepository, } from '../../agents/roots.js';
import { getAgentDetails, listAgents } from '../../agents/service.js';
let tmpDir: string;
let prevAgentHome: string | undefined;
let prevLegacyAgentHome: string | undefined;
const writeAgent = async (params: {
    rootDirName: 'codeinfo_agents' | 'codex_agents';
    agentName: string;
    withConfig?: boolean;
}) => {
    const agentHome = path.join(tmpDir, params.rootDirName, params.agentName);
    await fs.mkdir(agentHome, { recursive: true });
    if (params.withConfig !== false) {
        await fs.writeFile(path.join(agentHome, 'config.toml'), '# config');
    }
    return agentHome;
};
beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-'));
    prevAgentHome = process.env.CODEINFO_AGENT_HOME;
    prevLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    setScopedTestEnvValue("CODEINFO_AGENT_HOME", path.join(tmpDir, 'codeinfo_agents'));
    clearScopedTestEnvValue("CODEINFO_CODEX_AGENT_HOME");
});
afterEach(async () => {
    __resetAgentAvailabilityDepsForTests();
    if (prevAgentHome === undefined) {
        clearScopedTestEnvValue("CODEINFO_AGENT_HOME");
    }
    else {
        setScopedTestEnvValue("CODEINFO_AGENT_HOME", prevAgentHome);
    }
    if (prevLegacyAgentHome === undefined) {
        clearScopedTestEnvValue("CODEINFO_CODEX_AGENT_HOME");
    }
    else {
        setScopedTestEnvValue("CODEINFO_CODEX_AGENT_HOME", prevLegacyAgentHome);
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
});
test('discovery includes folders with config.toml from codeinfo_agents', async () => {
    const agentHome = await writeAgent({
        rootDirName: 'codeinfo_agents',
        agentName: 'coding_agent',
    });
    const agents = await discoverAgents();
    assert.equal(agents.length, 1);
    assert.equal(agents[0].name, 'coding_agent');
    assert.equal(agents[0].home, agentHome);
    assert.equal(agents[0].configPath, path.join(agentHome, 'config.toml'));
});
test('discovery ignores folders without config.toml', async () => {
    await writeAgent({
        rootDirName: 'codeinfo_agents',
        agentName: 'invalid_agent',
        withConfig: false,
    });
    const agents = await discoverAgents();
    assert.equal(agents.length, 0);
});
test('discovery reads optional description.md when present', async () => {
    const agentHome = await writeAgent({
        rootDirName: 'codeinfo_agents',
        agentName: 'coding_agent',
    });
    await fs.writeFile(path.join(agentHome, 'description.md'), '# Hello agent');
    const agents = await discoverAgents();
    assert.equal(agents.length, 1);
    assert.equal(agents[0].description, '# Hello agent');
    assert.equal(agents[0].descriptionPath, path.join(agentHome, 'description.md'));
});
test('discovery detects optional system_prompt.txt presence', async () => {
    const agentHome = await writeAgent({
        rootDirName: 'codeinfo_agents',
        agentName: 'coding_agent',
    });
    await fs.writeFile(path.join(agentHome, 'system_prompt.txt'), 'You are a helpful agent.');
    const agents = await discoverAgents();
    assert.equal(agents.length, 1);
    assert.equal(agents[0].systemPromptPath, path.join(agentHome, 'system_prompt.txt'));
});
test('resolveAgentHomeEnv treats a blank CODEINFO_AGENT_HOME input as unset', () => {
    const resolution = resolveAgentHomeEnv({
        CODEINFO_AGENT_HOME: '',
        CODEINFO_CODEX_AGENT_HOME: path.join(tmpDir, 'codex_agents'),
    });
    assert.equal(resolution.activeEnvName, 'CODEINFO_CODEX_AGENT_HOME');
    assert.equal(resolution.activeAgentHome, path.join(tmpDir, 'codex_agents'));
});
test('resolveAgentHomeEnv treats a whitespace-only CODEINFO_AGENT_HOME input as unset', () => {
    const resolution = resolveAgentHomeEnv({
        CODEINFO_AGENT_HOME: '   ',
        CODEINFO_CODEX_AGENT_HOME: path.join(tmpDir, 'codex_agents'),
    });
    assert.equal(resolution.activeEnvName, 'CODEINFO_CODEX_AGENT_HOME');
    assert.equal(resolution.activeAgentHome, path.join(tmpDir, 'codex_agents'));
});
test('resolveAgentHomeEnv treats a blank CODEINFO_CODEX_AGENT_HOME input as unset', () => {
    const resolution = resolveAgentHomeEnv({
        CODEINFO_AGENT_HOME: path.join(tmpDir, 'codeinfo_agents'),
        CODEINFO_CODEX_AGENT_HOME: '',
    });
    assert.equal(resolution.activeEnvName, 'CODEINFO_AGENT_HOME');
    assert.equal(resolution.legacyAgentHome, path.join(tmpDir, 'codex_agents'));
});
test('resolveAgentHomeEnv treats a whitespace-only CODEINFO_CODEX_AGENT_HOME input as unset', () => {
    const resolution = resolveAgentHomeEnv({
        CODEINFO_AGENT_HOME: path.join(tmpDir, 'codeinfo_agents'),
        CODEINFO_CODEX_AGENT_HOME: '   ',
    });
    assert.equal(resolution.activeEnvName, 'CODEINFO_AGENT_HOME');
    assert.equal(resolution.legacyAgentHome, path.join(tmpDir, 'codex_agents'));
});
test('resolveAgentHomeEnv gives CODEINFO_AGENT_HOME precedence when both env vars are present', () => {
    const resolution = resolveAgentHomeEnv({
        CODEINFO_AGENT_HOME: path.join(tmpDir, 'codeinfo_agents'),
        CODEINFO_CODEX_AGENT_HOME: path.join(tmpDir, 'codex_agents'),
    });
    assert.equal(resolution.activeEnvName, 'CODEINFO_AGENT_HOME');
    assert.equal(resolution.activeAgentHome, path.join(tmpDir, 'codeinfo_agents'));
});
test('resolveAgentHomeForRepository prefers codeinfo_agents over codex_agents', async () => {
    const preferredHome = await writeAgent({
        rootDirName: 'codeinfo_agents',
        agentName: 'planning_agent',
    });
    await writeAgent({
        rootDirName: 'codex_agents',
        agentName: 'planning_agent',
    });
    const resolved = await resolveAgentHomeForRepository({
        repositoryRoot: tmpDir,
        agentName: 'planning_agent',
    });
    assert.equal(resolved.home, preferredHome);
    assert.equal(resolved.rootKind, 'codeinfo_agents');
});
test('resolveAgentHomeForRepository emits duplicate-warning metadata and discovery surfaces it', async () => {
    const preferredHome = await writeAgent({
        rootDirName: 'codeinfo_agents',
        agentName: 'planning_agent',
    });
    await writeAgent({
        rootDirName: 'codex_agents',
        agentName: 'planning_agent',
    });
    const resolved = await resolveAgentHomeForRepository({
        repositoryRoot: tmpDir,
        agentName: 'planning_agent',
    });
    assert.equal(resolved.home, preferredHome);
    assert.equal(resolved.warnings.length, 1);
    assert.match(resolved.warnings[0] ?? '', /using codeinfo_agents/u);
    const agents = await discoverAgents();
    assert.equal(agents.length, 1);
    assert.deepEqual(agents[0].warnings, resolved.warnings);
});
test('resolveAgentHomeForRepository rejects traversal-shaped flow agentType values before returning an agent root', async () => {
    await assert.rejects(() => resolveAgentHomeForRepository({
        repositoryRoot: tmpDir,
        agentName: '../planning_agent',
    }), /agentType must be a valid agent root name/u);
});
test('selected-agent details expose invalid-provider warnings and fallback candidates without widening the list entry', async () => {
    const agentHome = await writeAgent({
        rootDirName: 'codeinfo_agents',
        agentName: 'coding_agent',
    });
    await fs.writeFile(path.join(tmpDir, 'codeinfo_agents', 'coding_agent', 'description.md'), '# Hello agent', 'utf8');
    await fs.writeFile(path.join(agentHome, 'config.toml'), 'codeinfo_provider = "not-a-provider"\n', 'utf8');
    setScopedTestEnvValue("CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER", 'copilot,lmstudio');
    __setAgentAvailabilityDepsForTests({
        getCodexDetection: () => ({
            available: false,
            authPresent: false,
            configPresent: false,
            reason: 'codex unavailable',
        }),
        getMcpStatus: async () => ({ available: true }),
        resolveCopilotReadiness: async () => ({
            available: true,
            toolsAvailable: true,
            blockingStage: 'ready',
            models: ['copilot-gpt-5'],
            modelsRaw: [],
            authSource: 'env-token',
        }),
        getLmStudioBaseUrl: () => undefined,
    });
    const list = await listAgents();
    assert.equal(list.agents.length, 1);
    assert.deepEqual(list.agents[0].warnings, undefined);
    assert.equal(list.agents[0].requestedProviderId, 'not-a-provider');
    assert.equal(list.agents[0].executionProviderId, 'copilot');
    const details = await getAgentDetails('coding_agent');
    assert.equal(details.name, 'coding_agent');
    assert.equal(details.warnings.some((warning) => warning.code === 'invalid_provider'), true);
    assert.equal(details.fallbackCandidates.some((candidate) => candidate.providerId === 'copilot' && candidate.available === true), true);
    assert.equal(details.executionProviderId, 'copilot');
});
test('selected-agent details preserve duplicate-root warnings and disabled reasons when no fallback provider is available', async () => {
    await writeAgent({
        rootDirName: 'codeinfo_agents',
        agentName: 'planning_agent',
    });
    await writeAgent({
        rootDirName: 'codex_agents',
        agentName: 'planning_agent',
    });
    await fs.writeFile(path.join(tmpDir, 'codeinfo_agents', 'planning_agent', 'config.toml'), 'codeinfo_provider = "copilot"\n', 'utf8');
    setScopedTestEnvValue("CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER", 'lmstudio');
    __setAgentAvailabilityDepsForTests({
        getCodexDetection: () => ({
            available: false,
            authPresent: false,
            configPresent: false,
            reason: 'codex unavailable',
        }),
        getMcpStatus: async () => ({ available: true }),
        resolveCopilotReadiness: async () => ({
            available: false,
            toolsAvailable: false,
            reason: 'copilot authentication required',
            blockingStage: 'authentication',
            models: [],
            modelsRaw: [],
            authSource: 'unauthenticated',
        }),
        getLmStudioBaseUrl: () => undefined,
    });
    const list = await listAgents();
    assert.equal(list.agents[0]?.disabled, true);
    assert.equal(Array.isArray(list.agents[0]?.warnings), true);
    const details = await getAgentDetails('planning_agent');
    assert.equal(details.warnings.some((warning) => warning.code === 'duplicate_root'), true);
    assert.equal(details.disabledReason?.code, 'provider_unavailable');
});
test('agent availability list closes temporary LM Studio discovery clients after probing models', async () => {
    await writeAgent({
        rootDirName: 'codeinfo_agents',
        agentName: 'planning_agent',
    });
    let closeCalls = 0;
    __setAgentAvailabilityDepsForTests({
        getCodexDetection: () => ({
            available: true,
            authPresent: true,
            configPresent: true,
        }),
        getMcpStatus: async () => ({ available: true }),
        resolveCopilotReadiness: async () => ({
            available: true,
            toolsAvailable: true,
            blockingStage: 'ready',
            models: ['copilot-gpt-5'],
            modelsRaw: [],
            authSource: 'env-token',
        }),
        getLmStudioBaseUrl: () => 'http://127.0.0.1:1234',
        lmstudioClientFactory: () => ({
            system: {
                listDownloadedModels: async () => [{ type: 'llm' }],
            },
            close: async () => {
                closeCalls += 1;
            },
        }) as never,
    });
    const list = await listAgents();
    assert.equal(list.agents.length, 1);
    assert.equal(closeCalls, 1);
});
