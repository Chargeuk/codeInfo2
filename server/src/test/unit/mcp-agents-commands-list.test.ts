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
    ['improve_plan'],
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
