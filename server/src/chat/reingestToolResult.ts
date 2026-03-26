import type { ReingestPlanScopeWarning } from '../ingest/planScopeResolver.js';
import type {
  ReingestExecutionBatchResult,
  ReingestExecutionResult,
  ReingestExecutionSingleResult,
  ReingestRepositoryExecutionOutcome,
} from '../ingest/reingestExecution.js';
import type { ReingestSuccess } from '../ingest/reingestService.js';
import { append } from '../logStore.js';

import type { ChatToolResultEvent } from './interfaces/ChatInterface.js';

export type ReingestTerminalOutcome = ReingestSuccess;
export type ReingestUserFacingOutcome = 'reingested' | 'skipped' | 'failed';

export type ReingestStepResultPayload = {
  kind: 'reingest_step_result';
  stepType: 'reingest';
  targetMode: 'sourceId' | 'working';
  requestedSelector: string | null;
  sourceId: string;
  resolvedRepositoryId: string | null;
  outcome: ReingestUserFacingOutcome;
  status: ReingestTerminalOutcome['status'];
  completionMode: ReingestTerminalOutcome['completionMode'];
  operation: ReingestTerminalOutcome['operation'];
  runId: string;
  files: number;
  chunks: number;
  embedded: number;
  errorCode: string | null;
};

export type ReingestStepBatchSummary = {
  reingested: number;
  skipped: number;
  failed: number;
};

export type ReingestStepBatchResultPayload = {
  kind: 'reingest_step_batch_result';
  stepType: 'reingest';
  targetMode: 'plan_scope';
  requestedSelector: null;
  repositories: ReingestRepositoryExecutionOutcome[];
  summary: ReingestStepBatchSummary;
  warnings: ReingestPlanScopeWarning[];
};

export type ReingestToolResultPayload =
  | ReingestStepResultPayload
  | ReingestStepBatchResultPayload;

const REINGEST_TOOL_NAME = 'reingest_repository';

function toUserFacingOutcome(
  outcome: ReingestSuccess,
): ReingestUserFacingOutcome {
  if (outcome.status !== 'completed') return 'failed';
  return outcome.completionMode === 'skipped' ? 'skipped' : 'reingested';
}

function buildSinglePayload(
  execution: ReingestExecutionSingleResult,
): ReingestStepResultPayload {
  return {
    kind: 'reingest_step_result',
    stepType: 'reingest',
    targetMode: execution.targetMode,
    requestedSelector: execution.requestedSelector,
    sourceId: execution.outcome.sourceId,
    resolvedRepositoryId: execution.outcome.resolvedRepositoryId,
    outcome: toUserFacingOutcome(execution.outcome),
    status: execution.outcome.status,
    completionMode: execution.outcome.completionMode,
    operation: execution.outcome.operation,
    runId: execution.outcome.runId,
    files: execution.outcome.files,
    chunks: execution.outcome.chunks,
    embedded: execution.outcome.embedded,
    errorCode: execution.outcome.errorCode,
  };
}

function buildBatchSummary(
  repositories: ReingestExecutionBatchResult['repositories'],
): ReingestStepBatchSummary {
  return repositories.reduce<ReingestStepBatchSummary>(
    (summary, repository) => {
      summary[repository.outcome] += 1;
      return summary;
    },
    { reingested: 0, skipped: 0, failed: 0 },
  );
}

function buildBatchPayload(
  execution: ReingestExecutionBatchResult,
): ReingestStepBatchResultPayload {
  return {
    kind: 'reingest_step_batch_result',
    stepType: 'reingest',
    targetMode: execution.targetMode,
    requestedSelector: null,
    repositories: execution.repositories,
    summary: buildBatchSummary(execution.repositories),
    warnings: execution.warnings,
  };
}

function toPayload(
  execution: ReingestExecutionResult,
): ReingestToolResultPayload {
  return execution.kind === 'single'
    ? buildSinglePayload(execution)
    : buildBatchPayload(execution);
}

function toToolStage(payload: ReingestToolResultPayload): 'success' | 'error' {
  if (payload.kind === 'reingest_step_batch_result') {
    return 'success';
  }
  return payload.status === 'completed' ? 'success' : 'error';
}

export function buildReingestToolResult(params: {
  callId: string;
  execution: ReingestExecutionResult;
}): ChatToolResultEvent {
  const result = toPayload(params.execution);

  append({
    level: 'info',
    message: 'DEV-0000052:T5:reingest-lifecycle',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      callId: params.callId,
      payloadKind: result.kind,
      targetMode: result.targetMode,
      stage: toToolStage(result),
      warningCount:
        result.kind === 'reingest_step_batch_result'
          ? result.warnings.length
          : 0,
      sourceId: result.kind === 'reingest_step_result' ? result.sourceId : null,
      repositoryCount:
        result.kind === 'reingest_step_batch_result'
          ? result.repositories.length
          : 1,
      status: result.kind === 'reingest_step_result' ? result.status : null,
    },
  });

  return {
    type: 'tool-result',
    callId: params.callId,
    name: REINGEST_TOOL_NAME,
    stage: toToolStage(result),
    result,
    error: null,
  };
}
