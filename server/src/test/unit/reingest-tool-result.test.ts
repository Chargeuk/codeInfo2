import assert from 'node:assert/strict';
import test from 'node:test';

import type { ToolEvent } from '../../chat/inflightRegistry.js';
import type { ChatToolResultEvent } from '../../chat/interfaces/ChatInterface.js';
import {
  buildReingestToolResult,
  type ReingestTerminalOutcome,
} from '../../chat/reingestToolResult.js';

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

test('builds the expected nested payload for completed reingest outcomes', () => {
  const result = buildReingestToolResult({
    callId: 'reingest-step-1',
    outcome: buildOutcome(),
  });

  assert.deepEqual(result, {
    type: 'tool-result',
    callId: 'reingest-step-1',
    name: 'reingest_repository',
    stage: 'success',
    result: {
      kind: 'reingest_step_result',
      stepType: 'reingest',
      sourceId: '/data/repo-a',
      status: 'completed',
      operation: 'reembed',
      runId: 'run-123',
      files: 9,
      chunks: 20,
      embedded: 15,
      errorCode: null,
    },
    error: null,
  });
});

test('preserves cancelled outcomes as structured terminal data', () => {
  const result = buildReingestToolResult({
    callId: 'reingest-step-2',
    outcome: buildOutcome({ status: 'cancelled' }),
  });

  assert.equal(result.stage, 'error');
  assert.deepEqual(result.result, {
    kind: 'reingest_step_result',
    stepType: 'reingest',
    sourceId: '/data/repo-a',
    status: 'cancelled',
    operation: 'reembed',
    runId: 'run-123',
    files: 9,
    chunks: 20,
    embedded: 15,
    errorCode: null,
  });
});

test('preserves error outcomes and stage mapping', () => {
  const result = buildReingestToolResult({
    callId: 'reingest-step-3',
    outcome: buildOutcome({ status: 'error', errorCode: 'INGEST_FAIL' }),
  });

  assert.equal(result.stage, 'error');
  assert.deepEqual(result.result, {
    kind: 'reingest_step_result',
    stepType: 'reingest',
    sourceId: '/data/repo-a',
    status: 'error',
    operation: 'reembed',
    runId: 'run-123',
    files: 9,
    chunks: 20,
    embedded: 15,
    errorCode: 'INGEST_FAIL',
  });
});

test('remains compatible with the existing live tool-result event shape', () => {
  const built = buildReingestToolResult({
    callId: 'reingest-step-4',
    outcome: buildOutcome(),
  });

  const liveEvent = toLiveToolEvent(built);
  assert.equal(liveEvent.type, 'tool-result');
  assert.equal(liveEvent.callId, 'reingest-step-4');
  assert.equal(liveEvent.name, 'reingest_repository');
  assert.equal(liveEvent.stage, 'success');
  assert.deepEqual(liveEvent.result, built.result);
  assert.equal(liveEvent.errorTrimmed ?? null, null);
  assert.equal(liveEvent.errorFull ?? null, null);
});

test('remains compatible with the persisted Turn.toolCalls container shape', () => {
  const built = buildReingestToolResult({
    callId: 'reingest-step-5',
    outcome: buildOutcome({ status: 'cancelled' }),
  });

  const persisted = {
    calls: [built],
  };

  assert.deepEqual(persisted, {
    calls: [
      {
        type: 'tool-result',
        callId: 'reingest-step-5',
        name: 'reingest_repository',
        stage: 'error',
        result: {
          kind: 'reingest_step_result',
          stepType: 'reingest',
          sourceId: '/data/repo-a',
          status: 'cancelled',
          operation: 'reembed',
          runId: 'run-123',
          files: 9,
          chunks: 20,
          embedded: 15,
          errorCode: null,
        },
        error: null,
      },
    ],
  });
});

test('preserves distinct callIds for multiple reingest results in one run', () => {
  const first = buildReingestToolResult({
    callId: 'reingest-step-6',
    outcome: buildOutcome(),
  });
  const second = buildReingestToolResult({
    callId: 'reingest-step-7',
    outcome: buildOutcome({ status: 'error', errorCode: 'WAIT_TIMEOUT' }),
  });

  assert.notEqual(first.callId, second.callId);
  assert.deepEqual(
    [first, second].map((event) => event.callId),
    ['reingest-step-6', 'reingest-step-7'],
  );
});
