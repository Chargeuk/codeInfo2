import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InvalidParamsError,
  RunInProgressError,
  callTool,
  listTools,
} from '../../mcpAgents/tools.js';

test('callTool run_command success returns minimal JSON payload', async () => {
  const result = await callTool(
    'run_command',
    { agentName: 'planning_agent', commandName: 'improve_plan' },
    {
      runAgentCommand: async () => ({
        agentName: 'planning_agent',
        commandName: 'improve_plan',
        conversationId: 'c1',
        modelId: 'm1',
      }),
    },
  );

  const text = result.content[0].text as string;
  const parsed = JSON.parse(text) as {
    agentName: string;
    commandName: string;
    conversationId: string;
    modelId: string;
  };

  assert.equal(parsed.agentName, 'planning_agent');
  assert.equal(parsed.commandName, 'improve_plan');
  assert.equal(parsed.conversationId, 'c1');
  assert.equal(parsed.modelId, 'm1');
});

test('callTool run_command maps RUN_IN_PROGRESS to RunInProgressError', async () => {
  await assert.rejects(
    () =>
      callTool(
        'run_command',
        {
          agentName: 'planning_agent',
          commandName: 'improve_plan',
          conversationId: 'c1',
        },
        {
          runAgentCommand: async () => {
            throw { code: 'RUN_IN_PROGRESS' };
          },
        },
      ),
    (err) => {
      assert.ok(err instanceof RunInProgressError);
      assert.equal((err as RunInProgressError).code, 409);
      assert.equal((err as RunInProgressError).message, 'RUN_IN_PROGRESS');
      const data = (err as RunInProgressError).data as
        | { code?: unknown }
        | undefined;
      assert.equal(data?.code, 'RUN_IN_PROGRESS');
      return true;
    },
  );
});

test('callTool run_command trims sourceId and treats whitespace-only as undefined', async () => {
  let captured: { sourceId?: string } | undefined;

  await callTool(
    'run_command',
    {
      agentName: 'planning_agent',
      commandName: 'improve_plan',
      sourceId: '   ',
    },
    {
      runAgentCommand: async (params) => {
        captured = { sourceId: params.sourceId };
        return {
          agentName: 'planning_agent',
          commandName: 'improve_plan',
          conversationId: 'c1',
          modelId: 'm1',
        };
      },
    },
  );

  assert.deepEqual(captured, { sourceId: undefined });
});

test('callTool run_command rejects invalid commandName with InvalidParamsError', async () => {
  await assert.rejects(
    () =>
      callTool('run_command', {
        agentName: 'planning_agent',
        commandName: '../bad',
      }),
    InvalidParamsError,
  );
});

test('callTool run_command maps COMMAND_NOT_FOUND to InvalidParamsError', async () => {
  await assert.rejects(
    () =>
      callTool(
        'run_command',
        { agentName: 'planning_agent', commandName: 'missing' },
        {
          runAgentCommand: async () => {
            throw { code: 'COMMAND_NOT_FOUND' };
          },
        },
      ),
    InvalidParamsError,
  );
});

test('callTool run_command maps COMMAND_INVALID to InvalidParamsError', async () => {
  await assert.rejects(
    () =>
      callTool(
        'run_command',
        { agentName: 'planning_agent', commandName: 'broken' },
        {
          runAgentCommand: async () => {
            throw { code: 'COMMAND_INVALID' };
          },
        },
      ),
    InvalidParamsError,
  );
});

test('callTool run_command maps WORKING_FOLDER_* errors to InvalidParamsError', async () => {
  await assert.rejects(
    () =>
      callTool(
        'run_command',
        { agentName: 'planning_agent', commandName: 'improve_plan' },
        {
          runAgentCommand: async () => {
            throw { code: 'WORKING_FOLDER_INVALID' };
          },
        },
      ),
    InvalidParamsError,
  );

  await assert.rejects(
    () =>
      callTool(
        'run_command',
        { agentName: 'planning_agent', commandName: 'improve_plan' },
        {
          runAgentCommand: async () => {
            throw { code: 'WORKING_FOLDER_NOT_FOUND' };
          },
        },
      ),
    InvalidParamsError,
  );
});

test('callTool run_command maps AGENT_NOT_FOUND to InvalidParamsError', async () => {
  await assert.rejects(
    () =>
      callTool(
        'run_command',
        { agentName: 'missing_agent', commandName: 'improve_plan' },
        {
          runAgentCommand: async () => {
            throw { code: 'AGENT_NOT_FOUND' };
          },
        },
      ),
    InvalidParamsError,
  );
});

test('run_command tool schema does not include startStep input', async () => {
  const tools = await listTools();
  const runCommand = tools.tools.find((tool) => tool.name === 'run_command');
  assert.ok(runCommand);
  const properties = (runCommand?.inputSchema?.properties ?? {}) as Record<
    string,
    unknown
  >;
  assert.equal('startStep' in properties, false);
});

test('callTool run_command rejects unexpected startStep input', async () => {
  await assert.rejects(
    () =>
      callTool('run_command', {
        agentName: 'planning_agent',
        commandName: 'improve_plan',
        startStep: 2,
      }),
    InvalidParamsError,
  );
});
