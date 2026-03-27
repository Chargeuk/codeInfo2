import crypto from 'node:crypto';

import type { ReingestPlanScopeWarning } from '../ingest/planScopeResolver.js';
import { append } from '../logStore.js';
import { appendTurn, updateConversationMeta } from '../mongo/repo.js';
import type { Turn, TurnCommandMetadata, TurnSource } from '../mongo/turn.js';
import { publishToolEvent, publishUserTurn } from '../ws/server.js';
import { attachChatStreamBridge } from './chatStreamBridge.js';

import {
  appendToolEvent,
  cleanupInflight,
  createInflight,
  markInflightPersisted,
  type ToolEvent,
} from './inflightRegistry.js';
import {
  ChatInterface,
  type ChatToolResultEvent,
} from './interfaces/ChatInterface.js';
import {
  recordMemoryTurn,
  shouldUseMemoryPersistence,
  updateMemoryConversationMeta,
} from './memoryPersistence.js';
import type {
  ReingestStepBatchResultPayload,
  ReingestStepResultPayload,
  ReingestToolResultPayload,
} from './reingestToolResult.js';

type LegacySingleTargetMode =
  | ReingestStepResultPayload['targetMode']
  | 'current';
type LegacyBatchTargetMode =
  | ReingestStepBatchResultPayload['targetMode']
  | 'all';
type LegacyBatchPayload = Omit<ReingestStepBatchResultPayload, 'targetMode'> & {
  targetMode: LegacyBatchTargetMode;
  warnings?: unknown;
};

type PersistedTurnResult = { turnId?: string };

type LifecycleDeps = {
  createInflight: typeof createInflight;
  appendToolEvent: typeof appendToolEvent;
  publishToolEvent: typeof publishToolEvent;
  publishUserTurn: typeof publishUserTurn;
  attachChatStreamBridge: typeof attachChatStreamBridge;
  markInflightPersisted: typeof markInflightPersisted;
  cleanupInflight: typeof cleanupInflight;
  shouldUseMemoryPersistence: typeof shouldUseMemoryPersistence;
  recordMemoryTurn: typeof recordMemoryTurn;
  updateMemoryConversationMeta: typeof updateMemoryConversationMeta;
  appendTurn: typeof appendTurn;
  updateConversationMeta: typeof updateConversationMeta;
  appendLog: typeof append;
  now: () => Date;
  createInflightId: () => string;
};

const defaultDeps: LifecycleDeps = {
  createInflight,
  appendToolEvent,
  publishToolEvent,
  publishUserTurn,
  attachChatStreamBridge,
  markInflightPersisted,
  cleanupInflight,
  shouldUseMemoryPersistence,
  recordMemoryTurn,
  updateMemoryConversationMeta,
  appendTurn,
  updateConversationMeta,
  appendLog: append,
  now: () => new Date(),
  createInflightId: () => crypto.randomUUID(),
};
const REINGEST_LIFECYCLE_PERSISTED_LOG =
  'DEV-0000052:T5:reingest-lifecycle-persisted';

let lifecycleDeps: LifecycleDeps = defaultDeps;

class NoopChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    _conversationId: string,
    _model: string,
  ): Promise<void> {
    void _message;
    void _flags;
    void _conversationId;
    void _model;
    return undefined;
  }
}

const toPersistedToolCalls = (
  toolResult: ChatToolResultEvent,
): { calls: ChatToolResultEvent[] } => ({
  calls: [toolResult],
});

const toLiveToolEvent = (toolResult: ChatToolResultEvent): ToolEvent => ({
  type: 'tool-result',
  callId: toolResult.callId,
  name: toolResult.name ?? '',
  stage: toolResult.stage,
  parameters: toolResult.params,
  result: toolResult.result,
  errorTrimmed: toolResult.error ?? undefined,
  errorFull: toolResult.error ?? undefined,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const isValidSingleTargetMode = (
  value: unknown,
): value is LegacySingleTargetMode =>
  value === 'sourceId' || value === 'current' || value === 'working';

const isValidBatchTargetMode = (
  value: unknown,
): value is LegacyBatchTargetMode => value === 'all' || value === 'plan_scope';

const normalizeLegacyBatchTargetMode = (
  value: LegacyBatchTargetMode,
): ReingestStepBatchResultPayload['targetMode'] => {
  switch (value) {
    case 'plan_scope':
      return 'plan_scope';
    case 'all':
      return 'plan_scope';
  }
};

const isValidOutcome = (
  value: unknown,
): value is ReingestStepResultPayload['outcome'] =>
  value === 'reingested' || value === 'skipped' || value === 'failed';

const isValidStatus = (
  value: unknown,
): value is ReingestStepResultPayload['status'] =>
  value === 'completed' || value === 'cancelled' || value === 'error';

const isValidCompletionMode = (
  value: unknown,
): value is ReingestStepResultPayload['completionMode'] =>
  value === 'reingested' || value === 'skipped' || value === null;

const isValidWarningCode = (
  value: unknown,
): value is ReingestPlanScopeWarning['code'] =>
  value === 'handoff_missing' ||
  value === 'handoff_invalid' ||
  value === 'repository_skipped' ||
  value === 'repository_failed';

const normalizeBatchWarnings = (
  value: unknown,
): {
  warnings: ReingestStepBatchResultPayload['warnings'];
  droppedCount: number;
} => {
  if (value === undefined) {
    return { warnings: [], droppedCount: 0 };
  }
  if (!Array.isArray(value)) {
    return { warnings: [], droppedCount: 1 };
  }

  const warnings: ReingestStepBatchResultPayload['warnings'] = [];
  let droppedCount = 0;

  for (const warning of value) {
    if (!isRecord(warning) || !isValidWarningCode(warning.code)) {
      droppedCount += 1;
      continue;
    }

    warnings.push({
      code: warning.code,
      message:
        typeof warning.message === 'string'
          ? warning.message
          : 'plan_scope warning recorded',
      repositoryPath:
        warning.repositoryPath === undefined ||
        warning.repositoryPath === null ||
        typeof warning.repositoryPath === 'string'
          ? ((warning.repositoryPath as string | null | undefined) ?? null)
          : null,
      resolvedRepositoryId:
        warning.resolvedRepositoryId === undefined ||
        warning.resolvedRepositoryId === null ||
        typeof warning.resolvedRepositoryId === 'string'
          ? ((warning.resolvedRepositoryId as string | null | undefined) ??
            null)
          : null,
    });
  }

  return { warnings, droppedCount };
};

type ParsedReingestPayload = {
  payload: ReingestToolResultPayload;
  droppedMalformedWarnings: number;
};

const getReingestPayload = (
  toolResult: ChatToolResultEvent,
): ParsedReingestPayload | null => {
  const result = toolResult.result;
  if (!isRecord(result)) return null;
  if (result.stepType !== 'reingest') return null;

  if (result.kind === 'reingest_step_batch_result') {
    if (!isValidBatchTargetMode(result.targetMode)) {
      return null;
    }
    if (result.requestedSelector !== null) return null;
    if (!Array.isArray(result.repositories)) return null;
    if (!isRecord(result.summary)) return null;

    const summary = result.summary;
    if (
      typeof summary.reingested !== 'number' ||
      typeof summary.skipped !== 'number' ||
      typeof summary.failed !== 'number'
    ) {
      return null;
    }

    const normalizedWarnings = normalizeBatchWarnings(
      (result as LegacyBatchPayload).warnings,
    );

    return {
      payload: {
        ...(result as LegacyBatchPayload),
        targetMode: normalizeLegacyBatchTargetMode(result.targetMode),
        warnings: normalizedWarnings.warnings,
      },
      droppedMalformedWarnings: normalizedWarnings.droppedCount,
    };
  }

  if (result.kind !== 'reingest_step_result') return null;
  const payload = result as Partial<ReingestStepResultPayload>;
  if (typeof payload.sourceId !== 'string') return null;
  if (!isValidStatus(payload.status)) return null;
  if (typeof payload.operation !== 'string') return null;
  if (typeof payload.runId !== 'string') return null;
  if (typeof payload.files !== 'number') return null;
  if (typeof payload.chunks !== 'number') return null;
  if (typeof payload.embedded !== 'number') return null;
  if (
    payload.errorCode !== null &&
    payload.errorCode !== undefined &&
    typeof payload.errorCode !== 'string'
  ) {
    return null;
  }

  const normalizedTargetMode = isValidSingleTargetMode(payload.targetMode)
    ? payload.targetMode
    : 'sourceId';
  const normalizedRequestedSelector =
    payload.requestedSelector === undefined ||
    payload.requestedSelector === null
      ? null
      : typeof payload.requestedSelector === 'string'
        ? payload.requestedSelector
        : null;
  const normalizedResolvedRepositoryId =
    payload.resolvedRepositoryId === undefined ||
    payload.resolvedRepositoryId === null
      ? null
      : typeof payload.resolvedRepositoryId === 'string'
        ? payload.resolvedRepositoryId
        : null;
  const normalizedCompletionMode = isValidCompletionMode(payload.completionMode)
    ? payload.completionMode
    : payload.status === 'completed'
      ? 'reingested'
      : null;
  const normalizedOutcome = isValidOutcome(payload.outcome)
    ? payload.outcome
    : payload.status === 'completed'
      ? normalizedCompletionMode === 'skipped'
        ? 'skipped'
        : 'reingested'
      : 'failed';

  return {
    payload: {
      kind: 'reingest_step_result',
      stepType: 'reingest',
      targetMode: normalizedTargetMode,
      requestedSelector: normalizedRequestedSelector,
      sourceId: payload.sourceId,
      resolvedRepositoryId: normalizedResolvedRepositoryId,
      outcome: normalizedOutcome,
      status: payload.status,
      completionMode: normalizedCompletionMode,
      operation: payload.operation,
      runId: payload.runId,
      files: payload.files,
      chunks: payload.chunks,
      embedded: payload.embedded,
      errorCode: payload.errorCode ?? null,
    },
    droppedMalformedWarnings: 0,
  };
};

const buildUserTurnContent = (toolResult: ChatToolResultEvent): string => {
  const parsedPayload = getReingestPayload(toolResult);
  if (!parsedPayload) {
    return 'Record re-ingest step result';
  }
  const { payload } = parsedPayload;
  if (payload.kind === 'reingest_step_batch_result') {
    return payload.warnings.length > 0
      ? 'Record re-ingest result for plan scope with warnings'
      : 'Record re-ingest result for plan scope';
  }
  return `Record re-ingest result for ${payload.sourceId}`;
};

const buildAssistantTurnContent = (toolResult: ChatToolResultEvent): string => {
  const parsedPayload = getReingestPayload(toolResult);
  if (!parsedPayload) return 'Re-ingest step result recorded.';
  const { payload } = parsedPayload;
  if (payload.kind === 'reingest_step_batch_result') {
    const warningSuffix =
      payload.warnings.length > 0
        ? ` Warning count: ${payload.warnings.length}.`
        : '';
    return `Plan-scope re-ingest recorded for ${payload.repositories.length} repositories (${payload.summary.reingested} reingested, ${payload.summary.skipped} skipped, ${payload.summary.failed} failed).${warningSuffix}`;
  }
  switch (payload.status) {
    case 'completed':
      return `Re-ingest completed for ${payload.sourceId}.`;
    case 'cancelled':
      return `Re-ingest cancelled for ${payload.sourceId}.`;
    case 'error':
      return `Re-ingest error recorded for ${payload.sourceId}.`;
  }
};

async function persistSyntheticTurn(params: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  model: string;
  provider: string;
  source: TurnSource;
  status: Turn['status'];
  toolCalls: Record<string, unknown> | null;
  command: TurnCommandMetadata;
  createdAt: Date;
}): Promise<PersistedTurnResult> {
  if (lifecycleDeps.shouldUseMemoryPersistence()) {
    lifecycleDeps.recordMemoryTurn({
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      model: params.model,
      provider: params.provider,
      source: params.source,
      toolCalls: params.toolCalls,
      status: params.status,
      command: params.command,
      createdAt: params.createdAt,
    } as Turn);
    lifecycleDeps.updateMemoryConversationMeta(params.conversationId, {
      lastMessageAt: params.createdAt,
      model: params.model,
    });
    return {};
  }

  const turn = await lifecycleDeps.appendTurn({
    conversationId: params.conversationId,
    role: params.role,
    content: params.content,
    model: params.model,
    provider: params.provider,
    source: params.source,
    toolCalls: params.toolCalls,
    status: params.status,
    command: params.command,
    createdAt: params.createdAt,
  });

  await lifecycleDeps.updateConversationMeta({
    conversationId: params.conversationId,
    lastMessageAt: params.createdAt,
    model: params.model,
  });

  const turnId =
    turn && typeof turn === 'object' && '_id' in (turn as object)
      ? String((turn as { _id?: unknown })._id ?? '')
      : undefined;

  return turnId?.length ? { turnId } : {};
}

export async function runReingestStepLifecycle(params: {
  conversationId: string;
  modelId: string;
  source: TurnSource;
  command: TurnCommandMetadata;
  toolResult: ChatToolResultEvent;
}): Promise<void> {
  const inflightId = lifecycleDeps.createInflightId();
  const createdAt = lifecycleDeps.now();
  const createdAtIso = createdAt.toISOString();
  const provider = 'codex';
  const userContent = buildUserTurnContent(params.toolResult);
  const assistantContent = buildAssistantTurnContent(params.toolResult);
  const liveToolEvent = toLiveToolEvent(params.toolResult);
  const parsedPayload = getReingestPayload(params.toolResult);
  const payload = parsedPayload?.payload ?? null;

  lifecycleDeps.createInflight({
    conversationId: params.conversationId,
    inflightId,
    provider,
    model: params.modelId,
    source: params.source,
    command: params.command,
    userTurn: {
      content: userContent,
      createdAt: createdAtIso,
    },
  });

  let bridge: ReturnType<typeof attachChatStreamBridge> | undefined;

  try {
    lifecycleDeps.publishUserTurn({
      conversationId: params.conversationId,
      inflightId,
      content: userContent,
      createdAt: createdAtIso,
    });

    bridge = lifecycleDeps.attachChatStreamBridge({
      conversationId: params.conversationId,
      inflightId,
      provider,
      model: params.modelId,
      chat: new NoopChat(),
      deferFinal: true,
    });

    const userPersisted = await persistSyntheticTurn({
      conversationId: params.conversationId,
      role: 'user',
      content: userContent,
      model: params.modelId,
      provider,
      source: params.source,
      status: 'ok',
      toolCalls: null,
      command: params.command,
      createdAt,
    });

    lifecycleDeps.markInflightPersisted({
      conversationId: params.conversationId,
      inflightId,
      role: 'user',
      turnId: userPersisted.turnId,
    });

    const appended = lifecycleDeps.appendToolEvent({
      conversationId: params.conversationId,
      inflightId,
      event: liveToolEvent,
    });
    if (!appended.ok) {
      throw new Error(
        'Failed to append re-ingest tool event to inflight state',
      );
    }

    lifecycleDeps.publishToolEvent({
      conversationId: params.conversationId,
      inflightId,
      event: liveToolEvent,
    });

    const assistantPersisted = await persistSyntheticTurn({
      conversationId: params.conversationId,
      role: 'assistant',
      content: assistantContent,
      model: params.modelId,
      provider,
      source: params.source,
      status: 'ok',
      toolCalls: toPersistedToolCalls(params.toolResult),
      command: params.command,
      createdAt: lifecycleDeps.now(),
    });

    lifecycleDeps.markInflightPersisted({
      conversationId: params.conversationId,
      inflightId,
      role: 'assistant',
      turnId: assistantPersisted.turnId,
    });

    bridge.finalize({
      fallback: {
        status: 'ok',
      },
    });

    lifecycleDeps.appendLog({
      level: 'info',
      message: 'DEV-0000045:T8:reingest_lifecycle_published',
      timestamp: lifecycleDeps.now().toISOString(),
      source: 'server',
      context: {
        conversationId: params.conversationId,
        callId: params.toolResult.callId,
        turnId: assistantPersisted.turnId ?? null,
        toolEventCount: appended.toolEventCount,
        finalTurnStatus: 'ok',
      },
    });

    if (payload) {
      if (parsedPayload?.droppedMalformedWarnings) {
        lifecycleDeps.appendLog({
          level: 'warn',
          message: 'DEV-0000052:T10:reingest-lifecycle-warning-dropped',
          timestamp: lifecycleDeps.now().toISOString(),
          source: 'server',
          context: {
            conversationId: params.conversationId,
            callId: params.toolResult.callId,
            targetMode: payload.targetMode,
            droppedMalformedWarnings: parsedPayload.droppedMalformedWarnings,
          },
        });
      }

      lifecycleDeps.appendLog({
        level: 'info',
        message: 'DEV-0000050:T04:reingest_payload_persisted',
        timestamp: lifecycleDeps.now().toISOString(),
        source: 'server',
        context: {
          conversationId: params.conversationId,
          payloadKind: payload.kind,
          targetMode: payload.targetMode,
          repositoryCount:
            payload.kind === 'reingest_step_batch_result'
              ? payload.repositories.length
              : 1,
        },
      });

      lifecycleDeps.appendLog({
        level: 'info',
        message: REINGEST_LIFECYCLE_PERSISTED_LOG,
        timestamp: lifecycleDeps.now().toISOString(),
        source: 'server',
        context: {
          conversationId: params.conversationId,
          callId: params.toolResult.callId,
          stage: params.toolResult.stage ?? null,
          targetMode: payload.targetMode,
          warningCount:
            payload.kind === 'reingest_step_batch_result'
              ? payload.warnings.length
              : 0,
        },
      });
    }
  } finally {
    bridge?.cleanup();
    lifecycleDeps.cleanupInflight({
      conversationId: params.conversationId,
      inflightId,
    });
  }
}

export function __setReingestStepLifecycleDepsForTests(
  overrides: Partial<LifecycleDeps>,
): void {
  lifecycleDeps = {
    ...defaultDeps,
    ...overrides,
  };
}

export function __resetReingestStepLifecycleDepsForTests(): void {
  lifecycleDeps = defaultDeps;
}
