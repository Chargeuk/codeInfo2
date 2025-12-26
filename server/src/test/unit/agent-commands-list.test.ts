import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { listAgentCommands } from '../../agents/service.js';

let tmpDir: string;
let prevAgentsHome: string | undefined;

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

    const res = await listAgentCommands({ agentName: agent.name });
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

    const res = await listAgentCommands({ agentName: agent.name });
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

    const res = await listAgentCommands({ agentName: agent.name });
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

    const res = await listAgentCommands({ agentName: agent.name });
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

    const res = await listAgentCommands({ agentName: agent.name });
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

    const res = await listAgentCommands({ agentName: agent.name });
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

    const first = await listAgentCommands({ agentName: agent.name });
    assert.deepEqual(
      first.commands.map((command) => command.name),
      ['a'],
    );

    await fs.writeFile(
      path.join(commandsDir, 'b.json'),
      validCommand('B'),
      'utf-8',
    );

    const second = await listAgentCommands({ agentName: agent.name });
    assert.deepEqual(
      second.commands.map((command) => command.name),
      ['a', 'b'],
    );
  });

  test("unknown agentName throws { code: 'AGENT_NOT_FOUND' }", async () => {
    await assert.rejects(
      async () => listAgentCommands({ agentName: 'does-not-exist' }),
      (err) => (err as { code?: string }).code === 'AGENT_NOT_FOUND',
    );
  });
});
