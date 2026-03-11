import crypto from 'node:crypto';

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
import type { ReingestStepResultPayload } from './reingestToolResult.js';

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

const getReingestPayload = (
  toolResult: ChatToolResultEvent,
): ReingestStepResultPayload | null => {
  const result = toolResult.result;
  if (!result || typeof result !== 'object') return null;
  const payload = result as Partial<ReingestStepResultPayload>;
  if (payload.kind !== 'reingest_step_result') return null;
  if (payload.stepType !== 'reingest') return null;
  if (typeof payload.sourceId !== 'string') return null;
  if (
    payload.status !== 'completed' &&
    payload.status !== 'cancelled' &&
    payload.status !== 'error'
  ) {
    return null;
  }
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

  return {
    kind: 'reingest_step_result',
    stepType: 'reingest',
    sourceId: payload.sourceId,
    status: payload.status,
    operation: payload.operation,
    runId: payload.runId,
    files: payload.files,
    chunks: payload.chunks,
    embedded: payload.embedded,
    errorCode: payload.errorCode ?? null,
  };
};

const buildUserTurnContent = (toolResult: ChatToolResultEvent): string => {
  const payload = getReingestPayload(toolResult);
  if (!payload) return 'Record re-ingest step result';
  return `Record re-ingest result for ${payload.sourceId}`;
};

const buildAssistantTurnContent = (toolResult: ChatToolResultEvent): string => {
  const payload = getReingestPayload(toolResult);
  if (!payload) return 'Re-ingest step result recorded.';
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
