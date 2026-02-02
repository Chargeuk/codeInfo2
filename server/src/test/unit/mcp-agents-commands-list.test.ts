import assert from 'node:assert/strict';
import test from 'node:test';

import { InvalidParamsError, callTool } from '../../mcpAgents/tools.js';

test('callTool list_commands without agentName returns all agents and excludes disabled commands', async () => {
  const response = await callTool(
    'list_commands',
    {},
    {
      listAgents: async () => ({
        agents: [
          {
            name: 'planning_agent',
            description: '',
            disabled: false,
            warnings: [],
          },
          {
            name: 'coding_agent',
            description: '',
            disabled: false,
            warnings: [],
          },
        ],
      }),
      listAgentCommands: async ({ agentName }) => {
        if (agentName === 'planning_agent') {
          return {
            commands: [
              {
                name: 'build',
                description: 'Builds',
                disabled: false,
                sourceId: '/data/repo',
                sourceLabel: 'My Repo',
              },
              {
                name: 'improve_plan',
                description: 'Improves a plan',
                disabled: false,
              },
              {
                name: 'broken',
                description: 'Invalid command file',
                disabled: true,
              },
            ],
          };
        }
        return {
          commands: [
            { name: 'broken_only', description: 'Invalid', disabled: true },
          ],
        };
      },
      runAgentInstruction: async () => {
        throw new Error('not used');
      },
    },
  );

  const text = response.content[0].text;
  assert.equal(typeof text, 'string');

  const parsed = JSON.parse(text) as {
    agents: Array<{ agentName: string; commands: Array<{ name: string }> }>;
  };

  assert.equal(parsed.agents.length, 2);

  const planning = parsed.agents.find(
    (agent) => agent.agentName === 'planning_agent',
  );
  assert.ok(planning);
  assert.deepEqual(
    planning.commands.map((command) => command.name),
    ['build', 'improve_plan'],
  );
  assert.equal(
    (planning.commands[0] as { sourceId?: string }).sourceId,
    '/data/repo',
  );

  const coding = parsed.agents.find(
    (agent) => agent.agentName === 'coding_agent',
  );
  assert.ok(coding);
  assert.deepEqual(coding.commands, []);
});

test('callTool list_commands with unknown agentName returns InvalidParamsError', async () => {
  await assert.rejects(
    () =>
      callTool(
        'list_commands',
        { agentName: 'does-not-exist' },
        {
          listAgents: async () => ({ agents: [] }),
          listAgentCommands: async () => {
            throw { code: 'AGENT_NOT_FOUND' };
          },
          runAgentInstruction: async () => {
            throw new Error('not used');
          },
        },
      ),
    (err) => {
      assert.ok(err instanceof InvalidParamsError);
      assert.equal((err as InvalidParamsError).message, 'Agent not found');
      return true;
    },
  );
});

test('callTool list_commands for an existing agent with zero commands returns commands: []', async () => {
  const response = await callTool(
    'list_commands',
    { agentName: 'planning_agent' },
    {
      listAgents: async () => ({ agents: [] }),
      listAgentCommands: async () => ({ commands: [] }),
      runAgentInstruction: async () => {
        throw new Error('not used');
      },
    },
  );

  const parsed = JSON.parse(response.content[0].text) as {
    agentName: string;
    commands: unknown[];
  };

  assert.equal(parsed.agentName, 'planning_agent');
  assert.deepEqual(parsed.commands, []);
});

test('callTool list_commands rejects invalid params (empty agentName)', async () => {
  await assert.rejects(
    () =>
      callTool(
        'list_commands',
        { agentName: '' },
        {
          listAgents: async () => ({ agents: [] }),
          listAgentCommands: async () => ({ commands: [] }),
          runAgentInstruction: async () => {
            throw new Error('not used');
          },
        },
      ),
    InvalidParamsError,
  );
});

test('callTool list_commands local entries omit source metadata', async () => {
  const response = await callTool(
    'list_commands',
    { agentName: 'planning_agent' },
    {
      listAgents: async () => ({ agents: [] }),
      listAgentCommands: async () => ({
        commands: [{ name: 'local', description: 'Local', disabled: false }],
      }),
      runAgentInstruction: async () => {
        throw new Error('not used');
      },
    },
  );

  const parsed = JSON.parse(response.content[0].text) as {
    commands: Array<{ name: string; sourceId?: string }>;
  };

  assert.equal(parsed.commands.length, 1);
  assert.equal('sourceId' in parsed.commands[0], false);
});

test('callTool list_commands returns fallback sourceLabel metadata', async () => {
  const response = await callTool(
    'list_commands',
    { agentName: 'planning_agent' },
    {
      listAgents: async () => ({ agents: [] }),
      listAgentCommands: async () => ({
        commands: [
          {
            name: 'build',
            description: 'Build',
            disabled: false,
            sourceId: '/data/repo-folder',
            sourceLabel: 'repo-folder',
          },
        ],
      }),
      runAgentInstruction: async () => {
        throw new Error('not used');
      },
    },
  );

  const parsed = JSON.parse(response.content[0].text) as {
    commands: Array<{ name: string; sourceLabel?: string }>;
  };

  assert.equal(parsed.commands[0].sourceLabel, 'repo-folder');
});

test('callTool list_commands omits agents missing locally', async () => {
  const response = await callTool(
    'list_commands',
    {},
    {
      listAgents: async () => ({
        agents: [
          {
            name: 'planning_agent',
            description: '',
            disabled: false,
            warnings: [],
          },
        ],
      }),
      listAgentCommands: async () => ({
        commands: [{ name: 'local', description: 'Local', disabled: false }],
      }),
      runAgentInstruction: async () => {
        throw new Error('not used');
      },
    },
  );

  const parsed = JSON.parse(response.content[0].text) as {
    agents: Array<{ agentName: string }>;
  };

  assert.deepEqual(
    parsed.agents.map((agent) => agent.agentName),
    ['planning_agent'],
  );
});

test('callTool list_commands preserves duplicate ingested labels order', async () => {
  const response = await callTool(
    'list_commands',
    { agentName: 'planning_agent' },
    {
      listAgents: async () => ({ agents: [] }),
      listAgentCommands: async () => ({
        commands: [
          {
            name: 'build',
            description: 'Build A',
            disabled: false,
            sourceId: '/data/a',
            sourceLabel: 'A',
          },
          {
            name: 'build',
            description: 'Build B',
            disabled: false,
            sourceId: '/data/b',
            sourceLabel: 'B',
          },
        ],
      }),
      runAgentInstruction: async () => {
        throw new Error('not used');
      },
    },
  );

  const parsed = JSON.parse(response.content[0].text) as {
    commands: Array<{ sourceLabel?: string }>;
  };

  assert.deepEqual(
    parsed.commands.map((command) => command.sourceLabel),
    ['A', 'B'],
  );
});

test('callTool list_commands returns local commands when ingest roots missing', async () => {
  const response = await callTool(
    'list_commands',
    { agentName: 'planning_agent' },
    {
      listAgents: async () => ({ agents: [] }),
      listAgentCommands: async () => ({
        commands: [{ name: 'local', description: 'Local', disabled: false }],
      }),
      runAgentInstruction: async () => {
        throw new Error('not used');
      },
    },
  );

  const parsed = JSON.parse(response.content[0].text) as {
    commands: Array<{ name: string }>;
  };

  assert.deepEqual(
    parsed.commands.map((command) => command.name),
    ['local'],
  );
});
