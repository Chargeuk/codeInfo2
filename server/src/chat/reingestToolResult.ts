import type { ReingestSuccess } from '../ingest/reingestService.js';
import { append } from '../logStore.js';

import type { ChatToolResultEvent } from './interfaces/ChatInterface.js';

export type ReingestTerminalOutcome = ReingestSuccess;

export type ReingestStepResultPayload = {
  kind: 'reingest_step_result';
  stepType: 'reingest';
  sourceId: string;
  status: ReingestTerminalOutcome['status'];
  operation: ReingestTerminalOutcome['operation'];
  runId: string;
  files: number;
  chunks: number;
  embedded: number;
  errorCode: string | null;
};

const REINGEST_TOOL_NAME = 'reingest_repository';

export function buildReingestToolResult(params: {
  callId: string;
  outcome: ReingestTerminalOutcome;
}): ChatToolResultEvent {
  const result: ReingestStepResultPayload = {
    kind: 'reingest_step_result',
    stepType: 'reingest',
    sourceId: params.outcome.sourceId,
    status: params.outcome.status,
    operation: params.outcome.operation,
    runId: params.outcome.runId,
    files: params.outcome.files,
    chunks: params.outcome.chunks,
    embedded: params.outcome.embedded,
    errorCode: params.outcome.errorCode,
  };

  append({
    level: 'info',
    message: 'DEV-0000045:T7:reingest_tool_result_built',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      callId: params.callId,
      sourceId: result.sourceId,
      status: result.status,
      operation: result.operation,
      runId: result.runId,
    },
  });

  return {
    type: 'tool-result',
    callId: params.callId,
    name: REINGEST_TOOL_NAME,
    stage: result.status === 'completed' ? 'success' : 'error',
    result,
    error: null,
  };
}
