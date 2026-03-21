import assert from 'node:assert/strict';
import test from 'node:test';

import type { ToolEvent } from '../../chat/inflightRegistry.js';
import type { ChatToolResultEvent } from '../../chat/interfaces/ChatInterface.js';
import {
  buildReingestToolResult,
  type ReingestTerminalOutcome,
} from '../../chat/reingestToolResult.js';
import type {
  ReingestExecutionBatchResult,
  ReingestExecutionSingleResult,
} from '../../ingest/reingestExecution.js';

const buildOutcome = (
  overrides: Partial<ReingestTerminalOutcome> = {},
): ReingestTerminalOutcome => ({
  status: 'completed',
  operation: 'reembed',
  runId: 'run-123',
  sourceId: '/data/repo-a',
  resolvedRepositoryId: 'repo-a',
  completionMode: 'reingested',
  durationMs: 321,
  files: 9,
  chunks: 20,
  embedded: 15,
  errorCode: null,
  ...overrides,
});

const buildSingleExecution = (
  overrides: Partial<ReingestExecutionSingleResult> = {},
): ReingestExecutionSingleResult => ({
  kind: 'single',
  targetMode: 'sourceId',
  requestedSelector: 'Repo A',
  resolvedSourceId: '/data/repo-a',
  outcome: buildOutcome(),
  ...overrides,
});

const buildBatchExecution = (
  overrides: Partial<ReingestExecutionBatchResult> = {},
): ReingestExecutionBatchResult => ({
  kind: 'batch',
  targetMode: 'all',
  requestedSelector: null,
  repositories: [
    {
      sourceId: '/data/repo-a',
      resolvedRepositoryId: 'repo-a',
      outcome: 'reingested',
      status: 'completed',
      completionMode: 'reingested',
      runId: 'run-a',
      files: 3,
      chunks: 10,
      embedded: 10,
      errorCode: null,
      errorMessage: null,
    },
    {
      sourceId: '/data/repo-b',
      resolvedRepositoryId: 'repo-b',
      outcome: 'skipped',
      status: 'completed',
      completionMode: 'skipped',
      runId: 'run-b',
      files: 0,
      chunks: 0,
      embedded: 0,
      errorCode: null,
      errorMessage: null,
    },
    {
      sourceId: '/data/repo-c',
      resolvedRepositoryId: 'repo-c',
      outcome: 'failed',
      status: 'error',
      completionMode: null,
      runId: null,
      files: 0,
      chunks: 0,
      embedded: 0,
      errorCode: 'BUSY',
      errorMessage: 'Another ingest is already running.',
    },
  ],
  ...overrides,
});

const toLiveToolEvent = (event: ChatToolResultEvent): ToolEvent => ({
  type: 'tool-result',
  callId: event.callId,
  name: event.name ?? '',
  stage: event.stage,
  parameters: event.params,
  result: event.result,
  errorTrimmed: event.error ?? undefined,
  errorFull: event.error ?? undefined,
});

test('builds the extended single-result payload for completed reingest outcomes', () => {
  const result = buildReingestToolResult({
    callId: 'reingest-step-1',
    execution: buildSingleExecution(),
  });

  assert.deepEqual(result.result, {
    kind: 'reingest_step_result',
    stepType: 'reingest',
    targetMode: 'sourceId',
    requestedSelector: 'Repo A',
    sourceId: '/data/repo-a',
    resolvedRepositoryId: 'repo-a',
    outcome: 'reingested',
    status: 'completed',
    completionMode: 'reingested',
    operation: 'reembed',
    runId: 'run-123',
    files: 9,
    chunks: 20,
    embedded: 15,
    errorCode: null,
  });
});

test('preserves selector metadata in single-result payloads', () => {
  const result = buildReingestToolResult({
    callId: 'reingest-step-2',
    execution: buildSingleExecution({
      requestedSelector: 'Repo Alias',
      outcome: buildOutcome({
        sourceId: '/data/repo-b',
        resolvedRepositoryId: 'repo-b',
      }),
    }),
  });

  assert.equal(result.stage, 'success');
  assert.deepEqual(result.result, {
    kind: 'reingest_step_result',
    stepType: 'reingest',
    targetMode: 'sourceId',
    requestedSelector: 'Repo Alias',
    sourceId: '/data/repo-b',
    resolvedRepositoryId: 'repo-b',
    outcome: 'reingested',
    status: 'completed',
    completionMode: 'reingested',
    operation: 'reembed',
    runId: 'run-123',
    files: 9,
    chunks: 20,
    embedded: 15,
    errorCode: null,
  });
});

test('preserves current-target metadata in single-result payloads', () => {
  const result = buildReingestToolResult({
    callId: 'reingest-step-3',
    execution: buildSingleExecution({
      targetMode: 'current',
      requestedSelector: null,
      outcome: buildOutcome({
        sourceId: '/data/current-repo',
        resolvedRepositoryId: 'repo-current',
      }),
    }),
  });

  assert.equal(result.stage, 'success');
  assert.deepEqual(result.result, {
    kind: 'reingest_step_result',
    stepType: 'reingest',
    targetMode: 'current',
    requestedSelector: null,
    sourceId: '/data/current-repo',
    resolvedRepositoryId: 'repo-current',
    outcome: 'reingested',
    status: 'completed',
    completionMode: 'reingested',
    operation: 'reembed',
    runId: 'run-123',
    files: 9,
    chunks: 20,
    embedded: 15,
    errorCode: null,
  });
});

test('builds one batch payload and preserves repository ordering', () => {
  const result = buildReingestToolResult({
    callId: 'reingest-step-4',
    execution: buildBatchExecution(),
  });

  assert.equal(result.stage, 'error');
  assert.equal(
    (result.result as { kind: string }).kind,
    'reingest_step_batch_result',
  );
  assert.deepEqual(
    (
      result.result as { repositories: Array<{ sourceId: string }> }
    ).repositories.map((repository) => repository.sourceId),
    ['/data/repo-a', '/data/repo-b', '/data/repo-c'],
  );
});

test('batch payload entries preserve repository identity and canonical path fields', () => {
  const result = buildReingestToolResult({
    callId: 'reingest-step-5',
    execution: buildBatchExecution(),
  });

  assert.deepEqual(
    (
      result.result as {
        repositories: Array<{
          sourceId: string;
          resolvedRepositoryId: string | null;
        }>;
      }
    ).repositories.map((repository) => ({
      sourceId: repository.sourceId,
      resolvedRepositoryId: repository.resolvedRepositoryId,
    })),
    [
      {
        sourceId: '/data/repo-a',
        resolvedRepositoryId: 'repo-a',
      },
      {
        sourceId: '/data/repo-b',
        resolvedRepositoryId: 'repo-b',
      },
      {
        sourceId: '/data/repo-c',
        resolvedRepositoryId: 'repo-c',
      },
    ],
  );
});

test('batch payload summary counts mixed outcomes without recomputation', () => {
  const result = buildReingestToolResult({
    callId: 'reingest-step-6',
    execution: buildBatchExecution(),
  });

  assert.deepEqual(
    (result.result as { summary: Record<string, number> }).summary,
    {
      reingested: 1,
      skipped: 1,
      failed: 1,
    },
  );
});

test('batch payload preserves failure text for failed repositories', () => {
  const result = buildReingestToolResult({
    callId: 'reingest-step-7',
    execution: buildBatchExecution(),
  });

  assert.equal(
    (
      result.result as {
        repositories: Array<{ sourceId: string; errorMessage: string | null }>;
      }
    ).repositories[2].errorMessage,
    'Another ingest is already running.',
  );
});

test('remains compatible with the existing live tool-result event shape', () => {
  const built = buildReingestToolResult({
    callId: 'reingest-step-8',
    execution: buildSingleExecution(),
  });

  const liveEvent = toLiveToolEvent(built);
  assert.equal(liveEvent.type, 'tool-result');
  assert.equal(liveEvent.callId, 'reingest-step-8');
  assert.equal(liveEvent.name, 'reingest_repository');
  assert.equal(liveEvent.stage, 'success');
  assert.deepEqual(liveEvent.result, built.result);
  assert.equal(liveEvent.errorTrimmed ?? null, null);
  assert.equal(liveEvent.errorFull ?? null, null);
});

test('remains compatible with the persisted Turn.toolCalls container shape for batch payloads', () => {
  const built = buildReingestToolResult({
    callId: 'reingest-step-9',
    execution: buildBatchExecution({
      repositories: [],
    }),
  });

  assert.deepEqual(
    {
      calls: [built],
    },
    {
      calls: [
        {
          type: 'tool-result',
          callId: 'reingest-step-9',
          name: 'reingest_repository',
          stage: 'success',
          result: {
            kind: 'reingest_step_batch_result',
            stepType: 'reingest',
            targetMode: 'all',
            requestedSelector: null,
            repositories: [],
            summary: {
              reingested: 0,
              skipped: 0,
              failed: 0,
            },
          },
          error: null,
        },
      ],
    },
  );
});
