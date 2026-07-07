import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { loadAgentCommandSummary } from '../../agents/commandsLoader.js';
import { resolveAgentHomeForRepository } from '../../agents/roots.js';
import { listAgentCommands } from '../../agents/service.js';
describe('agent command loader (v1)', () => {
    let tmpDir: string | null = null;
    let previousAgentHome: string | undefined;
    let previousLegacyAgentHome: string | undefined;
    afterEach(async () => {
        if (previousAgentHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_AGENT_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_AGENT_HOME", previousAgentHome);
        }
        if (previousLegacyAgentHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_CODEX_AGENT_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_CODEX_AGENT_HOME", previousLegacyAgentHome);
        }
        previousAgentHome = undefined;
        previousLegacyAgentHome = undefined;
        if (tmpDir) {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
        tmpDir = null;
    });
    test('returns enabled summary for valid command file', async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-loader-'));
        const filePath = path.join(tmpDir, 'good.json');
        await fs.writeFile(filePath, JSON.stringify({
            Description: 'My command',
            items: [{ type: 'message', role: 'user', content: ['x'] }],
        }), 'utf-8');
        const summary = await loadAgentCommandSummary({
            filePath,
            name: 'good',
        });
        assert.deepEqual(summary, {
            name: 'good',
            description: 'My command',
            disabled: false,
            stepCount: 1,
        });
    });
    test('returns disabled summary when schema invalid', async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-loader-'));
        const filePath = path.join(tmpDir, 'bad-schema.json');
        await fs.writeFile(filePath, JSON.stringify({
            Description: 'My command',
            items: [],
        }), 'utf-8');
        const summary = await loadAgentCommandSummary({
            filePath,
            name: 'bad-schema',
        });
        assert.deepEqual(summary, {
            name: 'bad-schema',
            description: 'Invalid command file',
            disabled: true,
            stepCount: 1,
        });
    });
    test('returns disabled summary when file read fails', async () => {
        const summary = await loadAgentCommandSummary({
            filePath: '/does/not/exist.json',
            name: 'missing',
        });
        assert.deepEqual(summary, {
            name: 'missing',
            description: 'Invalid command file',
            disabled: true,
            stepCount: 1,
        });
    });
    test('listAgentCommands resolves ingested command assets from the same winning codeinfo_agents root', async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-loader-'));
        previousAgentHome = process.env.CODEINFO_AGENT_HOME;
        previousLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
        const localRoot = path.join(tmpDir, 'current-repo');
        const ingestedRoot = path.join(tmpDir, 'ingested-repo');
        setScopedTestEnvValue("CODEINFO_AGENT_HOME", path.join(localRoot, 'codeinfo_agents'));
        clearScopedTestEnvValue("CODEINFO_CODEX_AGENT_HOME");
        const localAgentHome = path.join(localRoot, 'codeinfo_agents', 'planning_agent');
        await fs.mkdir(path.join(localAgentHome, 'commands'), { recursive: true });
        await fs.writeFile(path.join(localAgentHome, 'config.toml'), '# config');
        const preferredCommandDir = path.join(ingestedRoot, 'codeinfo_agents', 'planning_agent', 'commands');
        const legacyCommandDir = path.join(ingestedRoot, 'codex_agents', 'planning_agent', 'commands');
        await fs.mkdir(preferredCommandDir, { recursive: true });
        await fs.mkdir(legacyCommandDir, { recursive: true });
        await fs.writeFile(path.join(ingestedRoot, 'codeinfo_agents', 'planning_agent', 'config.toml'), '# config');
        await fs.writeFile(path.join(ingestedRoot, 'codex_agents', 'planning_agent', 'config.toml'), '# config');
        await fs.writeFile(path.join(preferredCommandDir, 'deploy.json'), JSON.stringify({
            Description: 'preferred command',
            items: [{ type: 'message', role: 'user', content: ['preferred'] }],
        }), 'utf8');
        await fs.writeFile(path.join(legacyCommandDir, 'deploy.json'), JSON.stringify({
            Description: 'legacy command',
            items: [{ type: 'message', role: 'user', content: ['legacy'] }],
        }), 'utf8');
        const resolved = await resolveAgentHomeForRepository({
            repositoryRoot: ingestedRoot,
            agentName: 'planning_agent',
        });
        assert.equal(resolved.home, path.join(ingestedRoot, 'codeinfo_agents', 'planning_agent'));
        const result = await listAgentCommands({ agentName: 'planning_agent' }, {
            listIngestedRepositories: async () => ({
                repos: [
                    {
                        id: 'Ingested Repo',
                        description: null,
                        containerPath: ingestedRoot,
                        hostPath: ingestedRoot,
                        lastIngestAt: null,
                        embeddingProvider: 'lmstudio',
                        embeddingModel: 'test-model',
                        embeddingDimensions: 768,
                        modelId: 'test-model',
                        counts: { files: 0, chunks: 0, embedded: 0 },
                        lastError: null,
                    },
                ],
            }) as never,
        });
        const ingestedCommand = result.commands.find((command) => command.name === 'deploy' && command.sourceId === ingestedRoot);
        assert.equal(ingestedCommand?.description, 'preferred command');
    });
});
