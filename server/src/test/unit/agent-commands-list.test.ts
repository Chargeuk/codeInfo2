import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { listAgentCommands } from '../../agents/service.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';

let tmpDir: string;
let prevAgentsHome: string | undefined;

const emptyIngested = async () => ({
  repos: [],
  lockedModelId: null,
});

const validCommand = (description: string) =>
  JSON.stringify({
    Description: description,
    items: [{ type: 'message', role: 'user', content: ['x'] }],
  });

async function createAgent(params: {
  agentsHome: string;
  agentName: string;
}): Promise<{ home: string; name: string }> {
  const home = path.join(params.agentsHome, params.agentName);
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(home, 'config.toml'), '# config', 'utf-8');
  return { home, name: params.agentName };
}

async function ensureCommandsDir(agentHome: string): Promise<string> {
  const dir = path.join(agentHome, 'commands');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function createRepoEntry(params: {
  id: string;
  containerPath: string;
}): RepoEntry {
  return {
    id: params.id,
    description: null,
    containerPath: params.containerPath,
    hostPath: params.containerPath,
    lastIngestAt: null,
    modelId: 'model',
    counts: { files: 0, chunks: 0, embedded: 0 },
    lastError: null,
  };
}

async function listCommands(
  agentName: string,
  deps?: {
    listIngestedRepositories?: () => Promise<{
      repos: RepoEntry[];
      lockedModelId: string | null;
    }>;
  },
) {
  return listAgentCommands(
    { agentName },
    {
      listIngestedRepositories: emptyIngested,
      ...deps,
    },
  );
}

describe('agent commands list (v1)', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-list-'));
    prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    process.env.CODEINFO_CODEX_AGENT_HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('missing commands/ folder returns empty list', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });

    const res = await listCommands(agent.name);
    assert.deepEqual(res, { commands: [] });
  });

  test('valid command JSON appears as enabled entry', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });
    const commandsDir = await ensureCommandsDir(agent.home);
    await fs.writeFile(
      path.join(commandsDir, 'improve_plan.json'),
      validCommand('Improve the plan'),
      'utf-8',
    );

    const res = await listCommands(agent.name);
    assert.deepEqual(res, {
      commands: [
        {
          name: 'improve_plan',
          description: 'Improve the plan',
          disabled: false,
        },
      ],
    });
  });

  test('invalid command JSON (syntax) appears as disabled entry', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });
    const commandsDir = await ensureCommandsDir(agent.home);
    await fs.writeFile(path.join(commandsDir, 'bad.json'), '{', 'utf-8');

    const res = await listCommands(agent.name);
    assert.deepEqual(res, {
      commands: [
        { name: 'bad', description: 'Invalid command file', disabled: true },
      ],
    });
  });

  test('invalid command JSON (schema) appears as disabled entry', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });
    const commandsDir = await ensureCommandsDir(agent.home);
    await fs.writeFile(
      path.join(commandsDir, 'bad-schema.json'),
      JSON.stringify({ Description: 'Bad', items: [] }),
      'utf-8',
    );

    const res = await listCommands(agent.name);
    assert.deepEqual(res, {
      commands: [
        {
          name: 'bad-schema',
          description: 'Invalid command file',
          disabled: true,
        },
      ],
    });
  });

  test('non-JSON files are ignored', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });
    const commandsDir = await ensureCommandsDir(agent.home);
    await fs.writeFile(path.join(commandsDir, 'README.md'), '# notes', 'utf-8');
    await fs.writeFile(path.join(commandsDir, 'notes.txt'), 'hello', 'utf-8');

    const res = await listCommands(agent.name);
    assert.deepEqual(res, { commands: [] });
  });

  test('results are sorted by name', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });
    const commandsDir = await ensureCommandsDir(agent.home);
    await fs.writeFile(
      path.join(commandsDir, 'z.json'),
      validCommand('Z'),
      'utf-8',
    );
    await fs.writeFile(
      path.join(commandsDir, 'a.json'),
      validCommand('A'),
      'utf-8',
    );

    const res = await listCommands(agent.name);
    assert.deepEqual(
      res.commands.map((command) => command.name),
      ['a', 'z'],
    );
  });

  test('no caching: list reflects new files on the next call', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });
    const commandsDir = await ensureCommandsDir(agent.home);
    await fs.writeFile(
      path.join(commandsDir, 'a.json'),
      validCommand('A'),
      'utf-8',
    );

    const first = await listCommands(agent.name);
    assert.deepEqual(
      first.commands.map((command) => command.name),
      ['a'],
    );

    await fs.writeFile(
      path.join(commandsDir, 'b.json'),
      validCommand('B'),
      'utf-8',
    );

    const second = await listCommands(agent.name);
    assert.deepEqual(
      second.commands.map((command) => command.name),
      ['a', 'b'],
    );
  });

  test("unknown agentName throws { code: 'AGENT_NOT_FOUND' }", async () => {
    await assert.rejects(
      async () => listCommands('does-not-exist'),
      (err) => (err as { code?: string }).code === 'AGENT_NOT_FOUND',
    );
  });

  test('ingested commands include source metadata and sort by display label', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });
    const commandsDir = await ensureCommandsDir(agent.home);
    await fs.writeFile(
      path.join(commandsDir, 'alpha.json'),
      validCommand('Local'),
      'utf-8',
    );

    const ingestedRoot = path.join(tmpDir, 'repo-a');
    const ingestedCommandsDir = path.join(
      ingestedRoot,
      'codex_agents',
      agent.name,
      'commands',
    );
    await fs.mkdir(ingestedCommandsDir, { recursive: true });
    await fs.writeFile(
      path.join(ingestedCommandsDir, 'alpha.json'),
      validCommand('Ingested'),
      'utf-8',
    );

    const res = await listCommands(agent.name, {
      listIngestedRepositories: async () => ({
        repos: [
          createRepoEntry({ id: 'My Repo', containerPath: ingestedRoot }),
        ],
        lockedModelId: null,
      }),
    });

    assert.equal(res.commands.length, 2);
    assert.equal(res.commands[0].name, 'alpha');
    assert.ok(!('sourceId' in res.commands[0]));
    assert.equal(res.commands[1].sourceId, ingestedRoot);
    assert.equal(res.commands[1].sourceLabel, 'My Repo');
  });

  test('local commands omit source metadata', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });
    const commandsDir = await ensureCommandsDir(agent.home);
    await fs.writeFile(
      path.join(commandsDir, 'local.json'),
      validCommand('Local'),
      'utf-8',
    );

    const res = await listCommands(agent.name);
    assert.equal(res.commands.length, 1);
    assert.equal('sourceId' in res.commands[0], false);
    assert.equal('sourceLabel' in res.commands[0], false);
  });

  test('ingested sourceLabel falls back to container basename', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });
    const ingestedRoot = path.join(tmpDir, 'repo-folder');
    const ingestedCommandsDir = path.join(
      ingestedRoot,
      'codex_agents',
      agent.name,
      'commands',
    );
    await fs.mkdir(ingestedCommandsDir, { recursive: true });
    await fs.writeFile(
      path.join(ingestedCommandsDir, 'build.json'),
      validCommand('Build'),
      'utf-8',
    );

    const res = await listCommands(agent.name, {
      listIngestedRepositories: async () => ({
        repos: [createRepoEntry({ id: '', containerPath: ingestedRoot })],
        lockedModelId: null,
      }),
    });

    assert.equal(res.commands[0].sourceLabel, 'repo-folder');
  });

  test('ingested commands are skipped when agent is missing locally', async () => {
    const ingestedRoot = path.join(tmpDir, 'repo-a');
    const ingestedCommandsDir = path.join(
      ingestedRoot,
      'codex_agents',
      'missing-agent',
      'commands',
    );
    await fs.mkdir(ingestedCommandsDir, { recursive: true });
    await fs.writeFile(
      path.join(ingestedCommandsDir, 'alpha.json'),
      validCommand('Ingested'),
      'utf-8',
    );

    await assert.rejects(
      async () =>
        listCommands('missing-agent', {
          listIngestedRepositories: async () => ({
            repos: [
              createRepoEntry({ id: 'Repo', containerPath: ingestedRoot }),
            ],
            lockedModelId: null,
          }),
        }),
      (err) => (err as { code?: string }).code === 'AGENT_NOT_FOUND',
    );
  });

  test('duplicate ingested command names are retained and sorted by label', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });
    const repoA = path.join(tmpDir, 'repo-a');
    const repoB = path.join(tmpDir, 'repo-b');
    const repoACommands = path.join(
      repoA,
      'codex_agents',
      agent.name,
      'commands',
    );
    const repoBCommands = path.join(
      repoB,
      'codex_agents',
      agent.name,
      'commands',
    );
    await fs.mkdir(repoACommands, { recursive: true });
    await fs.mkdir(repoBCommands, { recursive: true });
    await fs.writeFile(
      path.join(repoACommands, 'build.json'),
      validCommand('Build A'),
      'utf-8',
    );
    await fs.writeFile(
      path.join(repoBCommands, 'build.json'),
      validCommand('Build B'),
      'utf-8',
    );

    const res = await listCommands(agent.name, {
      listIngestedRepositories: async () => ({
        repos: [
          createRepoEntry({ id: 'A', containerPath: repoA }),
          createRepoEntry({ id: 'B', containerPath: repoB }),
        ],
        lockedModelId: null,
      }),
    });

    assert.deepEqual(
      res.commands.map((command) => command.sourceLabel),
      ['A', 'B'],
    );
  });

  test('missing ingested commands directory does not break local listing', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });
    const commandsDir = await ensureCommandsDir(agent.home);
    await fs.writeFile(
      path.join(commandsDir, 'local.json'),
      validCommand('Local'),
      'utf-8',
    );

    const res = await listCommands(agent.name, {
      listIngestedRepositories: async () => ({
        repos: [
          createRepoEntry({
            id: 'Repo',
            containerPath: path.join(tmpDir, 'missing-repo'),
          }),
        ],
        lockedModelId: null,
      }),
    });

    assert.deepEqual(
      res.commands.map((command) => command.name),
      ['local'],
    );
  });

  test('ingest repository failures return local commands only', async () => {
    const agent = await createAgent({ agentsHome: tmpDir, agentName: 'a1' });
    const commandsDir = await ensureCommandsDir(agent.home);
    await fs.writeFile(
      path.join(commandsDir, 'local.json'),
      validCommand('Local'),
      'utf-8',
    );

    const res = await listCommands(agent.name, {
      listIngestedRepositories: async () => {
        throw new Error('fail');
      },
    });

    assert.equal(res.commands.length, 1);
    assert.equal(res.commands[0].name, 'local');
  });
});
