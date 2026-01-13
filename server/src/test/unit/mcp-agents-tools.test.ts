import assert from 'node:assert/strict';
import test from 'node:test';

import {
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../../agents/runLock.js';
import {
  InvalidParamsError,
  RunInProgressError,
  callTool,
} from '../../mcpAgents/tools.js';

test('callTool run_agent_instruction forwards working_folder to agents service', async () => {
  let received: unknown;

  let segments: Array<{ type: string }> = [];

  const response = await callTool(
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
          segments: [
            { type: 'thinking', text: 't' },
            { type: 'answer', text: 'ok' },
          ],
        };
      },
      listAgents: async () => ({ agents: [] }),
    },
  );

  const payload = JSON.parse(response.content[0].text) as {
    segments: Array<{ type: string }>;
  };
  segments = payload.segments;

  assert.equal(typeof received, 'object');
  assert.equal(
    (received as { working_folder?: unknown }).working_folder,
    '/host/base/repo',
  );
  assert.deepEqual(
    segments.map((segment) => segment.type),
    ['answer'],
  );
});

test('callTool run_agent_instruction returns empty answer segment when missing', async () => {
  const response = await callTool(
    'run_agent_instruction',
    {
      agentName: 'coding_agent',
      instruction: 'Say hello',
    },
    {
      runAgentInstruction: async () => {
        return {
          agentName: 'coding_agent',
          conversationId: 'c1',
          modelId: 'm1',
          segments: [{ type: 'thinking', text: 't' }],
        };
      },
      listAgents: async () => ({ agents: [] }),
    },
  );

  const payload = JSON.parse(response.content[0].text) as {
    segments: Array<{ type: string; text?: string }>;
  };
  assert.deepEqual(
    payload.segments.map((segment) => segment.type),
    ['answer'],
  );
  assert.equal(payload.segments[0].text, '');
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

test('callTool run_agent_instruction maps RUN_IN_PROGRESS to RunInProgressError', async () => {
  assert.equal(tryAcquireConversationLock('c1'), true);
  try {
    await assert.rejects(
      () =>
        callTool('run_agent_instruction', {
          agentName: '__nonexistent__',
          instruction: 'Say hello',
          conversationId: 'c1',
        }),
      (err) => {
        assert.ok(err instanceof RunInProgressError);
        assert.equal((err as RunInProgressError).code, 409);
        assert.equal((err as RunInProgressError).message, 'RUN_IN_PROGRESS');
        return true;
      },
    );
  } finally {
    releaseConversationLock('c1');
  }
});
