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
          providerId: 'copilot',
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

test('callTool run_agent_instruction preserves delegated worker continuation handoffs', async () => {
  const received: Array<{
    agentName: string;
    instruction: string;
    conversationId?: string;
    working_folder?: string;
  }> = [];
  const workingFolder = '/host/base/repo';
  const responses = [
    {
      agentName: 'coding_agent',
      conversationId: 'coding-c1',
      providerId: 'copilot' as const,
      modelId: 'gpt-5.6-terra',
      segments: [{ type: 'answer', text: 'stuck: formatter needs a revision' }],
    },
    {
      agentName: 'coding_agent',
      conversationId: 'coding-c1',
      providerId: 'copilot' as const,
      modelId: 'gpt-5.6-terra',
      segments: [{ type: 'answer', text: 'revised repair is ready' }],
    },
    {
      agentName: 'automated_testing_agent',
      conversationId: 'testing-c1',
      providerId: 'copilot' as const,
      modelId: 'gpt-5-mini',
      segments: [{ type: 'answer', text: 'proof passed' }],
    },
  ];
  let responseIndex = 0;
  const deps = {
    runAgentInstruction: async (params: (typeof received)[number]) => {
      received.push({
        agentName: params.agentName,
        instruction: params.instruction,
        conversationId: params.conversationId,
        working_folder: params.working_folder,
      });
      return responses[responseIndex++]!;
    },
    listAgents: async () => ({ agents: [] }),
  };
  const call = async (params: {
    agentName: string;
    instruction: string;
    conversationId?: string;
  }) => {
    const response = await callTool(
      'run_agent_instruction',
      { ...params, working_folder: workingFolder },
      deps,
    );
    return JSON.parse(response.content[0].text) as {
      agentName: string;
      conversationId: string;
      modelId: string;
      segments: Array<{ type: string; text: string }>;
    };
  };

  const stuckCoding = await call({
    agentName: 'coding_agent',
    instruction: 'Implement the repair and report blockers.',
  });
  const revisedCoding = await call({
    agentName: 'coding_agent',
    instruction: 'Revise the repair using the formatter blocker.',
    conversationId: stuckCoding.conversationId,
  });
  const testing = await call({
    agentName: 'automated_testing_agent',
    instruction: 'Run proof only and report the result.',
  });

  assert.deepEqual(received, [
    {
      agentName: 'coding_agent',
      instruction: 'Implement the repair and report blockers.',
      conversationId: undefined,
      working_folder: workingFolder,
    },
    {
      agentName: 'coding_agent',
      instruction: 'Revise the repair using the formatter blocker.',
      conversationId: 'coding-c1',
      working_folder: workingFolder,
    },
    {
      agentName: 'automated_testing_agent',
      instruction: 'Run proof only and report the result.',
      conversationId: undefined,
      working_folder: workingFolder,
    },
  ]);
  assert.deepEqual(
    [stuckCoding, revisedCoding, testing].map((result) => ({
      agentName: result.agentName,
      conversationId: result.conversationId,
      modelId: result.modelId,
      answer: result.segments[0]?.text,
    })),
    [
      {
        agentName: 'coding_agent',
        conversationId: 'coding-c1',
        modelId: 'gpt-5.6-terra',
        answer: 'stuck: formatter needs a revision',
      },
      {
        agentName: 'coding_agent',
        conversationId: 'coding-c1',
        modelId: 'gpt-5.6-terra',
        answer: 'revised repair is ready',
      },
      {
        agentName: 'automated_testing_agent',
        conversationId: 'testing-c1',
        modelId: 'gpt-5-mini',
        answer: 'proof passed',
      },
    ],
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
          providerId: 'copilot',
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
