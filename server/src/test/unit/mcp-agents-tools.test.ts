import assert from 'node:assert/strict';
import test from 'node:test';

import { InvalidParamsError, callTool } from '../../mcpAgents/tools.js';

test('callTool run_agent_instruction forwards working_folder to agents service', async () => {
  let received: unknown;

  await callTool(
    'run_agent_instruction',
    {
      agentName: 'coding_agent',
      instruction: 'Say hello',
      working_folder: '/host/base/repo',
    },
    {
      runAgentInstruction: async (params) => {
        received = params;
        return {
          agentName: 'coding_agent',
          conversationId: 'c1',
          modelId: 'm1',
          segments: [{ type: 'answer', text: 'ok' }],
        };
      },
      listAgents: async () => ({ agents: [] }),
    },
  );

  assert.equal(typeof received, 'object');
  assert.equal(
    (received as { working_folder?: unknown }).working_folder,
    '/host/base/repo',
  );
});

test('callTool maps WORKING_FOLDER_* errors to InvalidParamsError', async () => {
  await assert.rejects(
    () =>
      callTool(
        'run_agent_instruction',
        { agentName: 'coding_agent', instruction: 'Say hello' },
        {
          runAgentInstruction: async () => {
            throw { code: 'WORKING_FOLDER_NOT_FOUND' };
          },
          listAgents: async () => ({ agents: [] }),
        },
      ),
    InvalidParamsError,
  );

  await assert.rejects(
    () =>
      callTool(
        'run_agent_instruction',
        { agentName: 'coding_agent', instruction: 'Say hello' },
        {
          runAgentInstruction: async () => {
            throw { code: 'WORKING_FOLDER_INVALID' };
          },
          listAgents: async () => ({ agents: [] }),
        },
      ),
    InvalidParamsError,
  );
});
