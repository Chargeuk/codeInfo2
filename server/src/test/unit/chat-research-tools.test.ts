import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import {
  PARENT_CHAT_RESEARCH_PROTOCOL,
  SYSTEM_CONTEXT,
  VECTORSEARCH_PROTOCOL_REMINDER,
} from '@codeinfo2/common';
import type {
  Chat,
  LMStudioClient,
  Tool,
  ToolCallContext,
} from '@lmstudio/sdk';

import type {
  RunAgentInstructionParams,
  RunAgentInstructionResult,
} from '../../agents/service.js';
import { ChatInterfaceLMStudio } from '../../chat/interfaces/ChatInterfaceLMStudio.js';
import { createLmStudioTools } from '../../lmstudio/tools.js';
import { InvalidParamsError } from '../../mcp2/errors.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

const context = (callId: number, signal = new AbortController().signal) =>
  ({
    callId,
    signal,
    status: () => undefined,
    warn: () => undefined,
  }) satisfies ToolCallContext;

const answer = (conversationId: string): RunAgentInstructionResult => ({
  agentName: 'chat_search_agent',
  providerId: 'codex',
  conversationId,
  modelId: 'research-model',
  segments: [
    { type: 'thinking', text: 'private reasoning' },
    { type: 'answer', text: 'verified source finding' },
  ],
});

test('shared parent protocol supplies optional waves and standalone new/follow-up examples', () => {
  assert.ok(SYSTEM_CONTEXT.includes(PARENT_CHAT_RESEARCH_PROTOCOL));
  assert.match(PARENT_CHAT_RESEARCH_PROTOCOL, /Wave 1: up to 4/u);
  assert.match(PARENT_CHAT_RESEARCH_PROTOCOL, /Wave 2, only if needed/u);
  assert.match(
    PARENT_CHAT_RESEARCH_PROTOCOL,
    /Wave 3, only if needed: NO more VectorSearch/u,
  );
  assert.match(
    PARENT_CHAT_RESEARCH_PROTOCOL,
    /at most 8 parent VectorSearch queries and 12 worker assignments/u,
  );
  assert.match(
    PARENT_CHAT_RESEARCH_PROTOCOL,
    /at most 4 additional parent evidence tool calls per lookup/u,
  );
  assert.match(
    PARENT_CHAT_RESEARCH_PROTOCOL,
    /Context7 resolve and query count separately/u,
  );
  assert.match(
    PARENT_CHAT_RESEARCH_PROTOCOL,
    /No broad recursive searches or file dumps/u,
  );
  assert.match(
    VECTORSEARCH_PROTOCOL_REMINDER,
    /<=4 additional parent evidence tool calls/u,
  );
  assert.match(
    VECTORSEARCH_PROTOCOL_REMINDER,
    /no broad recursive searches or file dumps/u,
  );
  const examples = PARENT_CHAT_RESEARCH_PROTOCOL.split('\n')
    .filter((line) =>
      line.trim().startsWith('mcp__codeinfo_agents__run_agent_instruction('),
    )
    .map((line) =>
      JSON.parse(
        line
          .trim()
          .slice('mcp__codeinfo_agents__run_agent_instruction('.length, -1),
      ),
    );
  assert.equal(examples.length, 2);
  assert.equal(Object.hasOwn(examples[0], 'conversationId'), false);
  assert.equal(
    examples[1].conversationId,
    'RETURNED_CONVERSATION_ID_FOR_THIS_ASSIGNMENT',
  );
  for (const example of examples) {
    assert.equal(example.agentName, 'chat_search_agent');
    assert.equal(example.working_folder, '/data/repo');
    assert.match(
      example.instruction,
      /Do not spawn or delegate to further sub-agents/u,
    );
    assert.match(
      example.instruction,
      /Do not use code_info, codebase_question/u,
    );
    assert.match(example.instruction, /at most 4 evidence tool calls/u);
  }
  assert.doesNotMatch(
    SYSTEM_CONTEXT,
    /at least two VectorSearch|require two queries|General chat has no added caps/u,
  );
});

test('LM Studio exposes one agent adapter with distinct calls, answer-only output and scoped follow-ups', async () => {
  const calls: RunAgentInstructionParams[] = [];
  const onToolResult = mock.fn();
  const { tools, runAgentInstructionTool } = createLmStudioTools({
    workingDirectoryOverride: '/data/selected-repo',
    onToolResult,
    runAgentInstruction: async (params) => {
      calls.push(params);
      return answer(params.conversationId ?? `worker-${calls.length}`);
    },
  });
  assert.deepEqual(
    tools.map((entry) => entry.name),
    ['ListIngestedRepositories', 'VectorSearch', 'run_agent_instruction'],
  );
  const first = await runAgentInstructionTool.implementation(
    {
      agentName: 'chat_search_agent',
      instruction: 'Question A',
    },
    context(1),
  );
  const second = await runAgentInstructionTool.implementation(
    {
      agentName: 'chat_search_agent',
      instruction: 'Question B',
      working_folder: '/data/other-repo',
    },
    context(2),
  );
  const firstPayload = JSON.parse(first.content[0].text);
  assert.deepEqual(firstPayload.segments, [
    { type: 'answer', text: 'verified source finding' },
  ]);
  assert.equal(JSON.parse(second.content[0].text).conversationId, 'worker-2');
  await runAgentInstructionTool.implementation(
    {
      agentName: 'chat_search_agent',
      instruction: 'Remaining A gap',
      conversationId: firstPayload.conversationId,
    },
    context(3),
  );
  assert.deepEqual(
    calls.map((call) => ({
      conversationId: call.conversationId,
      working_folder: call.working_folder,
      source: call.source,
    })),
    [
      {
        conversationId: undefined,
        working_folder: '/data/selected-repo',
        source: 'MCP',
      },
      {
        conversationId: undefined,
        working_folder: '/data/other-repo',
        source: 'MCP',
      },
      {
        conversationId: 'worker-1',
        working_folder: '/data/selected-repo',
        source: 'MCP',
      },
    ],
  );
  assert.deepEqual(
    onToolResult.mock.calls.map((call) => call.arguments[0]),
    [1, 2, 3],
  );
});

test(
  'independent LM Studio worker calls reach the handler concurrently without sharing a conversation id',
  {
    timeout: resolveConfiguredTestTimeoutMs(10000),
  },
  async (t) => {
    let release!: () => void;
    let bothEntered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      bothEntered = resolve;
      rejectReady = reject;
    });
    const onTimeout = () => rejectReady(t.signal.reason);
    t.signal.addEventListener('abort', onTimeout, { once: true });
    const calls: RunAgentInstructionParams[] = [];
    const { runAgentInstructionTool } = createLmStudioTools({
      runAgentInstruction: async (params) => {
        calls.push(params);
        const index = calls.length;
        if (index === 2) bothEntered();
        await gate;
        return answer(`independent-worker-${index}`);
      },
    });
    const first = runAgentInstructionTool.implementation(
      {
        agentName: 'chat_search_agent',
        instruction: 'Independent A',
        working_folder: '/data/a',
      },
      context(11),
    );
    const second = runAgentInstructionTool.implementation(
      {
        agentName: 'chat_search_agent',
        instruction: 'Independent B',
        working_folder: '/data/b',
      },
      context(12),
    );
    try {
      await ready;
      assert.equal(calls.length, 2);
      assert.ok(calls.every((call) => call.conversationId === undefined));
      assert.deepEqual(
        calls.map((call) => call.working_folder),
        ['/data/a', '/data/b'],
      );
    } finally {
      release();
      t.signal.removeEventListener('abort', onTimeout);
      await Promise.allSettled([first, second]);
    }
    const results = await Promise.all([first, second]);
    assert.deepEqual(
      results.map(
        (result) => JSON.parse(result.content[0].text).conversationId,
      ),
      ['independent-worker-1', 'independent-worker-2'],
    );
  },
);

for (const abortSource of ['parent', 'tool'] as const) {
  test(
    `LM Studio forwards ${abortSource} cancellation to the running child`,
    {
      timeout: resolveConfiguredTestTimeoutMs(10000),
    },
    async () => {
      const parent = new AbortController();
      const child = new AbortController();
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const onToolResult = mock.fn();
      const { runAgentInstructionTool } = createLmStudioTools({
        signal: parent.signal,
        repositoryContext: {
          selectedRepositoryPath: '/data/repo',
          defaultExecutionRoot: '/data',
          workingDirectoryOverride: '/data/repo',
          fallbackUsed: false,
          workingRepositoryAvailable: true,
        },
        onToolResult,
        runAgentInstruction: async (params) => {
          assert.equal(params.working_folder, '/data/repo');
          const signal = params.signal;
          assert.ok(signal);
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            if (signal.aborted) return done();
            signal.addEventListener('abort', done, { once: true });
            if (signal.aborted) done();
            entered();
          });
          signal.throwIfAborted();
          return answer('cancelled-worker');
        },
      });
      const result = runAgentInstructionTool.implementation(
        {
          agentName: 'chat_search_agent',
          instruction: 'Cancellable question',
        },
        context(21, child.signal),
      );
      const rejected = assert.rejects(
        result,
        (error: unknown) =>
          error instanceof Error && error.name === 'AbortError',
      );
      try {
        await ready;
        (abortSource === 'parent' ? parent : child).abort();
        await rejected;
        assert.equal(onToolResult.mock.calls[0].arguments[1], undefined);
        assert.ok(onToolResult.mock.calls[0].arguments[2] instanceof Error);
      } finally {
        parent.abort();
        child.abort();
        await rejected;
      }
    },
  );
}

test('LM Studio reports mapped agent errors and rejects an already-aborted parent before dispatch', async () => {
  const onToolResult = mock.fn();
  let calls = 0;
  const parent = new AbortController();
  const { runAgentInstructionTool } = createLmStudioTools({
    signal: parent.signal,
    onToolResult,
    runAgentInstruction: async () => {
      calls += 1;
      throw { code: 'AGENT_MISMATCH' };
    },
  });
  await assert.rejects(
    runAgentInstructionTool.implementation(
      {
        agentName: 'chat_search_agent',
        instruction: 'Question',
        conversationId: 'wrong-worker-id',
      },
      context(31),
    ),
    (error: unknown) =>
      error instanceof InvalidParamsError &&
      error.message === 'Conversation belongs to a different agent',
  );
  assert.ok(
    onToolResult.mock.calls[0].arguments[2] instanceof InvalidParamsError,
  );
  parent.abort();
  await assert.rejects(
    runAgentInstructionTool.implementation(
      {
        agentName: 'chat_search_agent',
        instruction: 'Question',
      },
      context(32),
    ),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
  assert.equal(calls, 1);
});

test('LM Studio chat delivers the protocol, parallel tools, execution folder and parent signal', async () => {
  const parent = new AbortController();
  const calls: RunAgentInstructionParams[] = [];
  const errors: unknown[] = [];
  let acted = false;
  const chat = new ChatInterfaceLMStudio(
    () =>
      ({
        llm: {
          model: async () => ({
            act: async (
              history: Chat,
              tools: Tool[],
              options: Record<string, unknown>,
            ) => {
              acted = true;
              const system = history
                .getMessagesArray()
                .find((entry) => entry.getRole() === 'system');
              assert.ok(
                system?.getText().includes(PARENT_CHAT_RESEARCH_PROTOCOL),
              );
              assert.equal(options.allowParallelToolExecution, true);
              assert.equal(options.signal, parent.signal);
              const adapter = tools.find(
                (entry) => entry.name === 'run_agent_instruction',
              );
              assert.ok(adapter);
              await adapter.implementation(
                { agentName: 'chat_search_agent', instruction: 'Verify X' },
                context(41),
              );
            },
          }),
        },
      }) as unknown as LMStudioClient,
    (options) =>
      createLmStudioTools({
        ...options,
        runAgentInstruction: async (params) => {
          calls.push(params);
          return answer('chat-child');
        },
      }),
  );
  chat.on('error', (error) => errors.push(error));
  await chat.execute(
    'Question',
    {
      signal: parent.signal,
      history: [],
      skipPersistence: true,
      baseUrl: 'http://localhost:1234',
      workingDirectoryOverride: '/data/current-checkout',
    },
    'parent-chat',
    'mock-model',
  );
  assert.deepEqual(errors, []);
  assert.equal(acted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].working_folder, '/data/current-checkout');
  assert.equal(calls[0].signal?.aborted, false);
  parent.abort();
  assert.equal(calls[0].signal?.aborted, true);
});
