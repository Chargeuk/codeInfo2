import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import type { ToolEvent } from '../../chat/inflightRegistry.js';
import type { ChatToolResultEvent } from '../../chat/interfaces/ChatInterface.js';
import {
  __resetReingestStepLifecycleDepsForTests,
  __setReingestStepLifecycleDepsForTests,
  runReingestStepLifecycle,
} from '../../chat/reingestStepLifecycle.js';
import {
  buildReingestToolResult,
  type ReingestTerminalOutcome,
} from '../../chat/reingestToolResult.js';
import type { Conversation } from '../../mongo/conversation.js';
import type { TurnCommandMetadata, TurnSource } from '../../mongo/turn.js';

type PersistedTurnCall = {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  model: string;
  provider: string;
  source: TurnSource;
  toolCalls: Record<string, unknown> | null;
  status: 'ok' | 'stopped' | 'failed';
  command: TurnCommandMetadata;
};

const baseCommand: TurnCommandMetadata = {
  name: 'flow',
  stepIndex: 3,
  totalSteps: 7,
  loopDepth: 1,
  agentType: 'researcher',
  identifier: 'repo-a',
  label: 'reingest-step',
};

const buildOutcome = (
  overrides: Partial<ReingestTerminalOutcome> = {},
): ReingestTerminalOutcome => ({
  status: 'completed',
  operation: 'reembed',
  runId: 'run-123',
  sourceId: '/repo/source-a',
  resolvedRepositoryId: 'repo-a',
  completionMode: 'reingested',
  durationMs: 245,
  files: 4,
  chunks: 12,
  embedded: 12,
  errorCode: null,
  ...overrides,
});

const buildConversation = (): Conversation =>
  ({
    _id: 'conversation-1',
    provider: 'codex',
    model: 'gpt-5.3-codex',
    title: 'reingest conversation',
    source: 'MCP',
    flags: {},
    lastMessageAt: new Date('2026-03-11T00:00:00.000Z'),
    archivedAt: null,
    createdAt: new Date('2026-03-11T00:00:00.000Z'),
    updatedAt: new Date('2026-03-11T00:00:00.000Z'),
  }) as Conversation;

const buildHarness = (params?: {
  toolOutcome?: Partial<ReingestTerminalOutcome>;
  toolResult?: ChatToolResultEvent;
  useMemoryPersistence?: boolean;
  command?: TurnCommandMetadata;
  modelId?: string;
  source?: TurnSource;
    updateConversationMetaOutcome?:
    | { outcome: 'applied'; conversation: Conversation }
    | { outcome: 'not_found' }
    | { outcome: 'retry_exhausted'; conversation: Conversation };
}) => {
  const toolResult =
    params?.toolResult ??
    buildReingestToolResult({
      callId: 'reingest-step-1',
      execution: {
        kind: 'single',
        targetMode: 'sourceId',
        requestedSelector: '/repo/source-a',
        resolvedSourceId: '/repo/source-a',
        outcome: buildOutcome(params?.toolOutcome),
      },
    });
  const order: string[] = [];
  const publishedUserTurns: Array<Record<string, unknown>> = [];
  const publishedToolEvents: Array<Record<string, unknown>> = [];
  const inflights: Array<Record<string, unknown>> = [];
  const persistedTurns: PersistedTurnCall[] = [];
  const memoryTurns: PersistedTurnCall[] = [];
  const updateMetaCalls: Array<Record<string, unknown>> = [];
  const inflightPersistedCalls: Array<Record<string, unknown>> = [];
  const appendLogs: Array<Record<string, unknown>> = [];
  const finalizations: Array<Record<string, unknown>> = [];
  const cleanups: Array<Record<string, unknown>> = [];

  __setReingestStepLifecycleDepsForTests({
    createInflight: (input) => {
      order.push('createInflight');
      inflights.push(input as unknown as Record<string, unknown>);
      return {} as never;
    },
    publishUserTurn: (input) => {
      order.push('publishUserTurn');
      publishedUserTurns.push(input as unknown as Record<string, unknown>);
    },
    attachChatStreamBridge: (input) => {
      void input;
      order.push('attachChatStreamBridge');
      return {
        finalize: (input?: {
          override?: Record<string, unknown>;
          fallback?: Record<string, unknown>;
        }) => {
          order.push('bridge.finalize');
          finalizations.push((input ?? {}) as Record<string, unknown>);
        },
        cleanup: () => {
          order.push('bridge.cleanup');
        },
      };
    },
    appendToolEvent: (input) => {
      order.push('appendToolEvent');
      publishedToolEvents.push({
        phase: 'append',
        ...(input as unknown as Record<string, unknown>),
      });
      return { ok: true, toolEventCount: 1 };
    },
    publishToolEvent: (input) => {
      order.push('publishToolEvent');
      publishedToolEvents.push({
        phase: 'publish',
        ...(input as unknown as Record<string, unknown>),
      });
    },
    shouldUseMemoryPersistence: () => params?.useMemoryPersistence ?? false,
    recordMemoryTurn: (turn) => {
      order.push(`recordMemoryTurn:${turn.role}`);
      memoryTurns.push(turn as PersistedTurnCall);
    },
    updateMemoryConversationMeta: (conversationId, patch) => {
      order.push('updateMemoryConversationMeta');
      updateMetaCalls.push({
        storage: 'memory',
        conversationId,
        patch,
      });
    },
    appendTurn: async (input) => {
      order.push(`appendTurn:${input.role}`);
      persistedTurns.push(input as PersistedTurnCall);
      return {
        _id: `${input.role}-turn-id`,
      } as never;
    },
    updateConversationMeta: async (input) => {
      order.push('updateConversationMeta');
      updateMetaCalls.push({
        storage: 'mongo',
        ...(input as unknown as Record<string, unknown>),
      });
      return (
        params?.updateConversationMetaOutcome ?? {
          outcome: 'applied',
          conversation: buildConversation(),
        }
      ) as
        | { outcome: 'applied'; conversation: Conversation }
        | { outcome: 'not_found' }
        | { outcome: 'retry_exhausted'; conversation: Conversation };
    },
    markInflightPersisted: (input) => {
      order.push(`markInflightPersisted:${input.role}`);
      inflightPersistedCalls.push(input as unknown as Record<string, unknown>);
      return { ok: true };
    },
    cleanupInflight: (input) => {
      order.push('cleanupInflight');
      cleanups.push(input as unknown as Record<string, unknown>);
    },
    appendLog: (entry) => {
      order.push('appendLog');
      appendLogs.push(entry as unknown as Record<string, unknown>);
      return entry;
    },
    now: (() => {
      let tick = 0;
      const baseMs = Date.parse('2026-03-11T00:00:00.000Z');
      return () => new Date(baseMs + tick++ * 1000);
    })(),
    createInflightId: () => 'inflight-reingest-1',
  });

  const run = async () => {
    await runReingestStepLifecycle({
      conversationId: 'conversation-1',
      modelId: params?.modelId ?? 'gpt-5.3-codex',
      source: params?.source ?? 'MCP',
      command: params?.command ?? baseCommand,
      toolResult,
    });
  };

  return {
    toolResult,
    order,
    run,
    publishedUserTurns,
    publishedToolEvents,
    inflights,
    persistedTurns,
    memoryTurns,
    updateMetaCalls,
    inflightPersistedCalls,
    appendLogs,
    finalizations,
    cleanups,
  };
};

afterEach(() => {
  __resetReingestStepLifecycleDepsForTests();
});

test('creates inflight state before tool event publication and final persistence', async () => {
  const harness = buildHarness();

  await harness.run();

  assert.ok(harness.order.indexOf('createInflight') > -1);
  assert.ok(
    harness.order.indexOf('createInflight') <
      harness.order.indexOf('appendToolEvent'),
  );
  assert.ok(
    harness.order.indexOf('appendToolEvent') <
      harness.order.indexOf('appendTurn:assistant'),
  );
  assert.ok(
    harness.order.indexOf('appendTurn:assistant') <
      harness.order.indexOf('bridge.finalize'),
  );
});

test('runReingestStepLifecycle stops before inflight bookkeeping continues when turn metadata retries exhaust', async () => {
  const harness = buildHarness({
    updateConversationMetaOutcome: {
      outcome: 'retry_exhausted',
      conversation: {
        _id: 'conversation-1',
        provider: 'codex',
        model: 'gpt-5.3-codex',
        title: 'retry-exhausted conversation',
        source: 'MCP',
        flags: {},
        lastMessageAt: new Date('2026-03-11T00:00:00.000Z'),
        archivedAt: null,
        createdAt: new Date('2026-03-11T00:00:00.000Z'),
        updatedAt: new Date('2026-03-11T00:00:00.000Z'),
      },
    },
  });

  await assert.rejects(
    harness.run(),
    (error) =>
      error instanceof Error &&
      error.message === 'reingest turn metadata update exhausted',
  );

  assert.deepEqual(harness.order, [
    'createInflight',
    'publishUserTurn',
    'attachChatStreamBridge',
    'appendTurn:user',
    'updateConversationMeta',
  ]);
  assert.equal(harness.inflightPersistedCalls.length, 0);
  assert.equal(harness.finalizations.length, 0);
});

test('runReingestStepLifecycle stops before inflight bookkeeping continues when turn metadata reports not_found', async () => {
  const harness = buildHarness({
    updateConversationMetaOutcome: { outcome: 'not_found' },
  });

  await assert.rejects(
    harness.run(),
    (error) =>
      error instanceof Error &&
      error.message === 'reingest turn conversation metadata not found',
  );

  assert.deepEqual(harness.order.slice(0, 5), [
    'createInflight',
    'publishUserTurn',
    'attachChatStreamBridge',
    'appendTurn:user',
    'updateConversationMeta',
  ]);
  assert.ok(harness.order.includes('bridge.cleanup'));
  assert.ok(harness.order.includes('cleanupInflight'));
  assert.equal(harness.inflightPersistedCalls.length, 0);
  assert.equal(harness.finalizations.length, 0);
});

test('publishes the expected synthetic user turn event', async () => {
  const harness = buildHarness();

  await harness.run();

  assert.equal(harness.publishedUserTurns.length, 1);
  assert.deepEqual(harness.publishedUserTurns[0], {
    conversationId: 'conversation-1',
    inflightId: 'inflight-reingest-1',
    content: 'Record re-ingest result for /repo/source-a',
    createdAt: '2026-03-11T00:00:00.000Z',
  });
});

test('finalizes the assistant turn on the normal outer ok path', async () => {
  const harness = buildHarness({
    toolOutcome: { status: 'error', errorCode: 'WAIT_TIMEOUT' },
  });

  await harness.run();

  assert.equal(harness.finalizations.length, 1);
  assert.deepEqual(harness.finalizations[0], {
    fallback: {
      status: 'ok',
    },
  });
});

test('persists the task 7 structured tool result inside Turn.toolCalls', async () => {
  const harness = buildHarness();

  await harness.run();

  const assistantTurn = harness.persistedTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.deepEqual(assistantTurn.toolCalls, {
    calls: [harness.toolResult],
  });
});

test('keeps outer persisted Turn.status distinct from nested reingest status', async () => {
  const harness = buildHarness({
    toolOutcome: { status: 'cancelled' },
  });

  await harness.run();

  const assistantTurn = harness.persistedTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.equal(assistantTurn.status, 'ok');
  assert.equal(
    (
      harness.toolResult.result as {
        status: 'completed' | 'cancelled' | 'error';
      }
    ).status,
    'cancelled',
  );
});

test('keeps outer turn_final status distinct from nested reingest status', async () => {
  const harness = buildHarness({
    toolOutcome: { status: 'error', errorCode: 'INGEST_FAIL' },
  });

  await harness.run();

  assert.equal(
    (
      harness.toolResult.result as {
        status: 'completed' | 'cancelled' | 'error';
      }
    ).status,
    'error',
  );
  assert.equal(
    (
      harness.finalizations[0].fallback as {
        status: 'ok' | 'stopped' | 'failed';
      }
    ).status,
    'ok',
  );
});

test('retains structured toolCalls in the memory-backed persistence path', async () => {
  const harness = buildHarness({
    useMemoryPersistence: true,
  });

  await harness.run();

  assert.equal(harness.persistedTurns.length, 0);
  const assistantTurn = harness.memoryTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.deepEqual(assistantTurn.toolCalls, {
    calls: [harness.toolResult],
  });
});

test('retains structured toolCalls in the mongo-backed persistence path', async () => {
  const harness = buildHarness({
    useMemoryPersistence: false,
  });

  await harness.run();

  assert.equal(harness.memoryTurns.length, 0);
  const assistantTurn = harness.persistedTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.deepEqual(assistantTurn.toolCalls, {
    calls: [harness.toolResult],
  });
  assert.deepEqual(harness.inflightPersistedCalls[1], {
    conversationId: 'conversation-1',
    inflightId: 'inflight-reingest-1',
    role: 'assistant',
    turnId: 'assistant-turn-id',
  });
});

test('publishes tool_event before final assistant-turn completion', async () => {
  const harness = buildHarness();

  await harness.run();

  assert.ok(
    harness.order.indexOf('publishToolEvent') <
      harness.order.indexOf('bridge.finalize'),
  );
  assert.deepEqual(
    harness.publishedToolEvents.map((entry) => entry.phase),
    ['append', 'publish'],
  );
  assert.equal(
    (harness.publishedToolEvents[1].event as ToolEvent).type,
    'tool-result',
  );
});

test('persists one explicit batch payload for an empty plan_scope run', async () => {
  const harness = buildHarness({
    toolResult: buildReingestToolResult({
      callId: 'reingest-batch-empty',
      execution: {
        kind: 'batch',
        targetMode: 'plan_scope',
        requestedSelector: null,
        repositories: [],
        summary: { reingested: 0, skipped: 0, failed: 0 },
        warnings: [],
      },
    }),
  });

  await harness.run();

  const assistantTurn = harness.persistedTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.deepEqual(assistantTurn.toolCalls, {
    calls: [harness.toolResult],
  });
  assert.deepEqual(
    (
      assistantTurn.toolCalls as {
        calls: Array<{ result: { repositories: Array<unknown> } }>;
      }
    ).calls[0].result.repositories,
    [],
  );
});

test('empty batch payload keeps a zeroed summary object', async () => {
  const harness = buildHarness({
    toolResult: buildReingestToolResult({
      callId: 'reingest-batch-empty-summary',
      execution: {
        kind: 'batch',
        targetMode: 'plan_scope',
        requestedSelector: null,
        repositories: [],
        summary: { reingested: 0, skipped: 0, failed: 0 },
        warnings: [],
      },
    }),
  });

  await harness.run();

  const assistantTurn = harness.persistedTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.deepEqual(
    (
      assistantTurn.toolCalls as {
        calls: Array<{ result: { summary: Record<string, number> } }>;
      }
    ).calls[0].result.summary,
    {
      reingested: 0,
      skipped: 0,
      failed: 0,
    },
  );
});

test('batch reingest persistence stays on Turn.toolCalls instead of a second channel', async () => {
  const harness = buildHarness({
    toolResult: buildReingestToolResult({
      callId: 'reingest-batch-toolcalls',
      execution: {
        kind: 'batch',
        targetMode: 'plan_scope',
        requestedSelector: null,
        repositories: [
          {
            sourceId: '/repo/a',
            resolvedRepositoryId: 'repo-a',
            outcome: 'reingested',
            status: 'completed',
            completionMode: 'reingested',
            runId: 'run-a',
            files: 4,
            chunks: 12,
            embedded: 12,
            errorCode: null,
            errorMessage: null,
          },
        ],
        summary: { reingested: 1, skipped: 0, failed: 0 },
        warnings: [],
      },
    }),
  });

  await harness.run();

  assert.equal(harness.persistedTurns.length, 2);
  assert.equal(harness.persistedTurns[0].toolCalls, null);
  assert.deepEqual(harness.persistedTurns[1].toolCalls, {
    calls: [harness.toolResult],
  });
});

test('batch synthetic turn content summarizes the run instead of naming one sourceId', async () => {
  const harness = buildHarness({
    toolResult: buildReingestToolResult({
      callId: 'reingest-batch-summary-content',
      execution: {
        kind: 'batch',
        targetMode: 'plan_scope',
        requestedSelector: null,
        repositories: [
          {
            sourceId: '/repo/a',
            resolvedRepositoryId: 'repo-a',
            outcome: 'reingested',
            status: 'completed',
            completionMode: 'reingested',
            runId: 'run-a',
            files: 4,
            chunks: 12,
            embedded: 12,
            errorCode: null,
            errorMessage: null,
          },
          {
            sourceId: '/repo/b',
            resolvedRepositoryId: 'repo-b',
            outcome: 'failed',
            status: 'error',
            completionMode: null,
            runId: null,
            files: 0,
            chunks: 0,
            embedded: 0,
            errorCode: 'WAIT_TIMEOUT',
            errorMessage: 'Timed out waiting for lock.',
          },
        ],
        summary: { reingested: 1, skipped: 0, failed: 1 },
        warnings: [
          {
            code: 'repository_failed',
            message: 'repo-b failed',
            repositoryPath: '/repo/b',
            resolvedRepositoryId: 'repo-b',
          },
        ],
      },
    }),
  });

  await harness.run();

  assert.equal(
    harness.publishedUserTurns[0].content,
    'Record re-ingest result for plan scope with warnings',
  );
  const assistantTurn = harness.persistedTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.equal(
    assistantTurn.content,
    'Plan-scope re-ingest recorded for 2 repositories (1 reingested, 0 skipped, 1 failed). Warning count: 1.',
  );
});

test('older single-result payloads still parse and persist correctly', async () => {
  const legacyToolResult: ChatToolResultEvent = {
    type: 'tool-result',
    callId: 'legacy-reingest-step',
    name: 'reingest_repository',
    stage: 'success',
    result: {
      kind: 'reingest_step_result',
      stepType: 'reingest',
      sourceId: '/repo/legacy',
      status: 'completed',
      operation: 'reembed',
      runId: 'legacy-run',
      files: 2,
      chunks: 8,
      embedded: 8,
      errorCode: null,
    },
    error: null,
  };
  const harness = buildHarness({
    toolResult: legacyToolResult,
  });

  await harness.run();

  assert.equal(
    harness.publishedUserTurns[0].content,
    'Record re-ingest result for /repo/legacy',
  );
  const assistantTurn = harness.persistedTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.deepEqual(assistantTurn.toolCalls, {
    calls: [legacyToolResult],
  });
});

test('legacy current single-result payloads still normalize explicitly to sourceId behavior', async () => {
  const legacyToolResult: ChatToolResultEvent = {
    type: 'tool-result',
    callId: 'legacy-reingest-current',
    name: 'reingest_repository',
    stage: 'success',
    result: {
      kind: 'reingest_step_result',
      stepType: 'reingest',
      targetMode: 'current',
      requestedSelector: null,
      sourceId: '/repo/current',
      status: 'completed',
      operation: 'reembed',
      runId: 'legacy-current-run',
      files: 2,
      chunks: 8,
      embedded: 8,
      errorCode: null,
    },
    error: null,
  };
  const harness = buildHarness({
    toolResult: legacyToolResult,
  });

  await harness.run();

  assert.equal(
    harness.publishedUserTurns[0].content,
    'Record re-ingest result for /repo/current',
  );
  const assistantTurn = harness.persistedTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.deepEqual(assistantTurn.toolCalls, {
    calls: [legacyToolResult],
  });
  assert.deepEqual(harness.appendLogs[2]?.context, {
    conversationId: 'conversation-1',
    callId: 'legacy-reingest-current',
    stage: 'success',
    targetMode: 'sourceId',
    warningCount: 0,
  });
});

test('malformed single-result targetMode no longer normalizes into a false sourceId payload', async () => {
  const malformedToolResult: ChatToolResultEvent = {
    type: 'tool-result',
    callId: 'legacy-reingest-malformed-target-mode',
    name: 'reingest_repository',
    stage: 'success',
    result: {
      kind: 'reingest_step_result',
      stepType: 'reingest',
      targetMode: 'future_mode',
      requestedSelector: '/repo/future',
      sourceId: '/repo/future',
      status: 'completed',
      operation: 'reembed',
      runId: 'legacy-future-run',
      files: 2,
      chunks: 8,
      embedded: 8,
      errorCode: null,
    },
    error: null,
  };
  const harness = buildHarness({
    toolResult: malformedToolResult,
  });

  await harness.run();

  assert.equal(
    harness.publishedUserTurns[0].content,
    'Record re-ingest step result',
  );
  const assistantTurn = harness.persistedTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.equal(assistantTurn.content, 'Re-ingest step result recorded.');
  assert.deepEqual(assistantTurn.toolCalls, {
    calls: [malformedToolResult],
  });
  assert.equal(
    harness.appendLogs.some(
      (entry) => entry.message === 'DEV-0000050:T04:reingest_payload_persisted',
    ),
    false,
  );
  assert.equal(
    harness.appendLogs.some(
      (entry) =>
        entry.message === 'DEV-0000052:T5:reingest-lifecycle-persisted',
    ),
    false,
  );
});

test('older batch payloads with targetMode all still normalize explicitly to plan_scope behavior', async () => {
  const legacyToolResult: ChatToolResultEvent = {
    type: 'tool-result',
    callId: 'legacy-reingest-batch',
    name: 'reingest_repository',
    stage: 'error',
    result: {
      kind: 'reingest_step_batch_result',
      stepType: 'reingest',
      targetMode: 'all',
      requestedSelector: null,
      repositories: [
        {
          sourceId: '/repo/a',
          resolvedRepositoryId: 'repo-a',
          outcome: 'reingested',
          status: 'completed',
          completionMode: 'reingested',
          runId: 'run-a',
          files: 4,
          chunks: 8,
          embedded: 8,
          errorCode: null,
          errorMessage: null,
        },
      ],
      summary: { reingested: 1, skipped: 0, failed: 0 },
    },
    error: null,
  };
  const harness = buildHarness({
    toolResult: legacyToolResult,
  });

  await harness.run();

  assert.equal(
    harness.publishedUserTurns[0].content,
    'Record re-ingest result for plan scope',
  );
  const assistantTurn = harness.persistedTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.equal(
    assistantTurn.content,
    'Plan-scope re-ingest recorded for 1 repositories (1 reingested, 0 skipped, 0 failed).',
  );
  assert.deepEqual(assistantTurn.toolCalls, {
    calls: [legacyToolResult],
  });
});

test('drops malformed persisted batch warnings instead of relabeling them', async () => {
  const legacyToolResult: ChatToolResultEvent = {
    type: 'tool-result',
    callId: 'legacy-reingest-batch-unknown-warning',
    name: 'reingest_repository',
    stage: 'success',
    result: {
      kind: 'reingest_step_batch_result',
      stepType: 'reingest',
      targetMode: 'plan_scope',
      requestedSelector: null,
      repositories: [
        {
          sourceId: '/repo/a',
          resolvedRepositoryId: 'repo-a',
          outcome: 'reingested',
          status: 'completed',
          completionMode: 'reingested',
          runId: 'run-a',
          files: 4,
          chunks: 8,
          embedded: 8,
          errorCode: null,
          errorMessage: null,
        },
      ],
      summary: { reingested: 1, skipped: 0, failed: 0 },
      warnings: [
        {
          code: 'future_warning_code',
          message: 'unknown warning from newer writer',
          repositoryPath: '/repo/a',
        },
      ],
    },
    error: null,
  };
  const harness = buildHarness({
    toolResult: legacyToolResult,
  });

  await harness.run();

  assert.equal(
    harness.publishedUserTurns[0].content,
    'Record re-ingest result for plan scope',
  );
  const assistantTurn = harness.persistedTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.equal(
    assistantTurn.content,
    'Plan-scope re-ingest recorded for 1 repositories (1 reingested, 0 skipped, 0 failed).',
  );
  assert.deepEqual(
    (
      assistantTurn.toolCalls as {
        calls: Array<{ result: { warnings: Array<unknown> } }>;
      }
    ).calls[0].result.warnings,
    [
      (
        legacyToolResult.result as {
          warnings: Array<unknown>;
        }
      ).warnings[0],
    ],
  );
  assert.equal(
    harness.appendLogs.some(
      (entry) =>
        entry.message === 'DEV-0000052:T10:reingest-lifecycle-warning-dropped',
    ),
    true,
  );
  assert.deepEqual(
    harness.appendLogs.find(
      (entry) =>
        entry.message === 'DEV-0000052:T10:reingest-lifecycle-warning-dropped',
    )?.context,
    {
      conversationId: 'conversation-1',
      callId: 'legacy-reingest-batch-unknown-warning',
      targetMode: 'plan_scope',
      droppedMalformedWarnings: 1,
    },
  );
  assert.equal(
    (
      harness.appendLogs.find(
        (entry) =>
          entry.message === 'DEV-0000052:T5:reingest-lifecycle-persisted',
      )?.context as
        | {
            warningCount?: number;
          }
        | undefined
    )?.warningCount,
    0,
  );
});

test('drops a malformed persisted batch warnings container instead of treating it as clean', async () => {
  const legacyToolResult: ChatToolResultEvent = {
    type: 'tool-result',
    callId: 'legacy-reingest-batch-warning-container',
    name: 'reingest_repository',
    stage: 'success',
    result: {
      kind: 'reingest_step_batch_result',
      stepType: 'reingest',
      targetMode: 'plan_scope',
      requestedSelector: null,
      repositories: [
        {
          sourceId: '/repo/a',
          resolvedRepositoryId: 'repo-a',
          outcome: 'reingested',
          status: 'completed',
          completionMode: 'reingested',
          runId: 'run-a',
          files: 4,
          chunks: 8,
          embedded: 8,
          errorCode: null,
          errorMessage: null,
        },
      ],
      summary: { reingested: 1, skipped: 0, failed: 0 },
      warnings: {
        code: 'repository_failed',
        message: 'not-an-array',
      },
    },
    error: null,
  };
  const harness = buildHarness({
    toolResult: legacyToolResult,
  });

  await harness.run();

  const assistantTurn = harness.persistedTurns.find(
    (turn) => turn.role === 'assistant',
  );
  assert.ok(assistantTurn);
  assert.equal(
    assistantTurn.content,
    'Plan-scope re-ingest recorded for 1 repositories (1 reingested, 0 skipped, 0 failed).',
  );
  assert.equal(
    harness.appendLogs.some(
      (entry) =>
        entry.message === 'DEV-0000052:T10:reingest-lifecycle-warning-dropped',
    ),
    true,
  );
  assert.deepEqual(
    harness.appendLogs.find(
      (entry) =>
        entry.message === 'DEV-0000052:T10:reingest-lifecycle-warning-dropped',
    )?.context,
    {
      conversationId: 'conversation-1',
      callId: 'legacy-reingest-batch-warning-container',
      targetMode: 'plan_scope',
      droppedMalformedWarnings: 1,
    },
  );
  assert.equal(
    (
      harness.appendLogs.find(
        (entry) =>
          entry.message === 'DEV-0000052:T5:reingest-lifecycle-persisted',
      )?.context as
        | {
            warningCount?: number;
          }
        | undefined
    )?.warningCount,
    0,
  );
});

test('passes through caller-supplied model, source, and command metadata', async () => {
  const command: TurnCommandMetadata = {
    name: 'flow',
    stepIndex: 5,
    totalSteps: 9,
    loopDepth: 0,
    agentType: 'planner',
    identifier: 'repo-b',
    label: 'dedicated-reingest',
  };
  const harness = buildHarness({
    command,
    modelId: 'fallback-flow-model',
    source: 'REST',
  });

  await harness.run();

  assert.deepEqual(harness.inflights[0], {
    conversationId: 'conversation-1',
    inflightId: 'inflight-reingest-1',
    provider: 'codex',
    model: 'fallback-flow-model',
    source: 'REST',
    command,
    userTurn: {
      content: 'Record re-ingest result for /repo/source-a',
      createdAt: '2026-03-11T00:00:00.000Z',
    },
  });
  assert.equal(harness.persistedTurns[0].model, 'fallback-flow-model');
  assert.equal(harness.persistedTurns[0].source, 'REST');
  assert.deepEqual(harness.persistedTurns[0].command, command);
  assert.equal(
    harness.appendLogs[0]?.message,
    'DEV-0000045:T8:reingest_lifecycle_published',
  );
  assert.equal(
    harness.appendLogs[1]?.message,
    'DEV-0000050:T04:reingest_payload_persisted',
  );
  assert.equal(
    harness.appendLogs[2]?.message,
    'DEV-0000052:T5:reingest-lifecycle-persisted',
  );
  assert.deepEqual(harness.appendLogs[2]?.context, {
    conversationId: 'conversation-1',
    callId: 'reingest-step-1',
    stage: 'success',
    targetMode: 'sourceId',
    warningCount: 0,
  });
});
