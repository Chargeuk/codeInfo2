import {
  isTransientReconnect,
  getErrorMessage,
} from '../agents/transientReconnect.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import type { TurnTimingMetadata, TurnUsageMetadata } from '../mongo/turn.js';
import {
  publishAnalysisDelta,
  publishAssistantDelta,
  publishInflightSnapshot,
  publishStreamWarning,
  publishToolEvent,
  publishTurnFinal,
} from '../ws/server.js';
import {
  appendAnalysisDelta,
  appendAssistantDelta,
  appendToolEvent,
  getInflight,
  markInflightFinal,
  setAssistantText,
  type ToolEvent,
} from './inflightRegistry.js';
import type {
  ChatAnalysisEvent,
  ChatCompleteEvent,
  ChatErrorEvent,
  ChatFinalEvent,
  ChatInterface,
  ChatThreadEvent,
  ChatTokenEvent,
  ChatToolRequestEvent,
  ChatToolResultEvent,
} from './interfaces/ChatInterface.js';

function deriveStatusFromError(message: string): 'stopped' | 'failed' {
  const text = message.toLowerCase();
  if (text.includes('abort') || text.includes('stop')) return 'stopped';
  return 'failed';
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizeUsage = (
  usage: TurnUsageMetadata | undefined,
): TurnUsageMetadata | undefined => {
  if (!usage) return undefined;
  const cleaned: TurnUsageMetadata = {};
  if (isFiniteNumber(usage.inputTokens) && usage.inputTokens >= 0) {
    cleaned.inputTokens = usage.inputTokens;
  }
  if (isFiniteNumber(usage.outputTokens) && usage.outputTokens >= 0) {
    cleaned.outputTokens = usage.outputTokens;
  }
  if (isFiniteNumber(usage.totalTokens) && usage.totalTokens >= 0) {
    cleaned.totalTokens = usage.totalTokens;
  }
  if (isFiniteNumber(usage.cachedInputTokens) && usage.cachedInputTokens >= 0) {
    cleaned.cachedInputTokens = usage.cachedInputTokens;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

const normalizeTiming = (
  timing: TurnTimingMetadata | undefined,
): TurnTimingMetadata | undefined => {
  if (!timing) return undefined;
  const cleaned: TurnTimingMetadata = {};
  if (isFiniteNumber(timing.totalTimeSec) && timing.totalTimeSec > 0) {
    cleaned.totalTimeSec = timing.totalTimeSec;
  }
  if (isFiniteNumber(timing.tokensPerSecond) && timing.tokensPerSecond > 0) {
    cleaned.tokensPerSecond = timing.tokensPerSecond;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

const deriveTiming = (params: {
  timing?: TurnTimingMetadata;
  startedAt?: string;
  finishedAtMs: number;
}): TurnTimingMetadata | undefined => {
  const cleaned = normalizeTiming(params.timing) ?? {};
  const hasTotal = isFiniteNumber(cleaned.totalTimeSec);
  if (!hasTotal && params.startedAt) {
    const startedMs = Date.parse(params.startedAt);
    if (isFiniteNumber(startedMs)) {
      const elapsedSec = (params.finishedAtMs - startedMs) / 1000;
      if (isFiniteNumber(elapsedSec) && elapsedSec > 0) {
        cleaned.totalTimeSec = elapsedSec;
      }
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

export function attachChatStreamBridge(params: {
  conversationId: string;
  inflightId: string;
  provider: string;
  model: string;
  requestId?: string;
  chat: ChatInterface;
}) {
  const { conversationId, inflightId, provider, model, requestId, chat } =
    params;

  let activeThreadId: string | null = null;
  let finalPublished = false;
  let deltaCount = 0;
  let toolEventCount = 0;

  const log = (
    level: 'info' | 'warn' | 'error',
    message: string,
    context: unknown,
  ) => {
    const mergedContext = {
      conversationId,
      inflightId,
      provider,
      model,
      ...(typeof context === 'object' && context !== null
        ? (context as Record<string, unknown>)
        : {}),
    };

    append({
      level,
      message,
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId,
      context: mergedContext,
    });

    if (level === 'error') {
      baseLogger.error({ requestId, ...mergedContext }, message);
      return;
    }

    if (level === 'warn') {
      baseLogger.warn({ requestId, ...mergedContext }, message);
      return;
    }

    baseLogger.info({ requestId, ...mergedContext }, message);
  };

  const publishFinalOnce = (params: {
    status: 'ok' | 'stopped' | 'failed';
    threadId?: string | null;
    error?: { code?: string; message?: string } | null;
    usage?: TurnUsageMetadata;
    timing?: TurnTimingMetadata;
  }) => {
    if (finalPublished) return;
    finalPublished = true;

    publishTurnFinal({
      conversationId,
      inflightId,
      status: params.status,
      ...(params.threadId !== undefined ? { threadId: params.threadId } : {}),
      ...(params.error !== undefined ? { error: params.error } : {}),
      ...(params.usage !== undefined ? { usage: params.usage } : {}),
      ...(params.timing !== undefined ? { timing: params.timing } : {}),
    });

    const level = params.status === 'failed' ? 'error' : 'info';
    log(level, 'chat.stream.final', {
      status: params.status,
      threadId: params.threadId ?? null,
      deltaCount,
      toolEventCount,
      seq: getInflight(conversationId)?.seq ?? null,
      ...(params.error ? { error: params.error } : {}),
    });

    markInflightFinal({
      conversationId,
      inflightId,
      status: params.status,
    });
  };

  // Initial snapshot for any already-subscribed viewers.
  publishInflightSnapshot(conversationId);
  log('info', 'chat.stream.snapshot', {
    provider,
    model,
    seq: getInflight(conversationId)?.seq ?? null,
  });

  const onToken = (ev: ChatTokenEvent) => {
    if (finalPublished) return;
    const delta = ev.content ?? '';
    if (!delta) return;

    const updated = appendAssistantDelta({ conversationId, inflightId, delta });
    if (!updated.ok) return;

    deltaCount += 1;
    publishAssistantDelta({ conversationId, inflightId, delta });

    if (deltaCount === 1 || deltaCount % 25 === 0) {
      log('info', 'chat.stream.delta', {
        deltaCount,
        deltaLength: delta.length,
      });
    }
  };

  const onAnalysis = (ev: ChatAnalysisEvent) => {
    if (finalPublished) return;
    const delta = ev.content ?? '';
    if (!delta) return;

    const updated = appendAnalysisDelta({ conversationId, inflightId, delta });
    if (!updated.ok) return;

    publishAnalysisDelta({ conversationId, inflightId, delta });
  };

  const onToolRequest = (ev: ChatToolRequestEvent) => {
    if (finalPublished) return;

    const event: ToolEvent = {
      type: 'tool-request',
      callId: ev.callId,
      name: ev.name,
      stage: ev.stage,
      parameters: ev.params,
    };

    const updated = appendToolEvent({
      conversationId,
      inflightId,
      event,
    });
    if (!updated.ok) return;

    toolEventCount = updated.toolEventCount;
    publishToolEvent({ conversationId, inflightId, event });
    log('info', 'chat.stream.tool_event', {
      toolEventCount,
      toolType: 'tool-request',
      name: ev.name,
      callId: ev.callId,
      stage: ev.stage,
    });
  };

  const onToolResult = (ev: ChatToolResultEvent) => {
    if (finalPublished) return;

    const event: ToolEvent = {
      type: 'tool-result',
      callId: ev.callId,
      name: ev.name ?? '',
      stage: ev.stage,
      parameters: ev.params,
      result: ev.result,
      errorTrimmed: ev.error ?? undefined,
      errorFull: ev.error ?? undefined,
    };

    const updated = appendToolEvent({
      conversationId,
      inflightId,
      event,
    });
    if (!updated.ok) return;

    toolEventCount = updated.toolEventCount;
    publishToolEvent({ conversationId, inflightId, event });
    log('info', 'chat.stream.tool_event', {
      toolEventCount,
      toolType: 'tool-result',
      name: event.name,
      callId: ev.callId,
      stage: ev.stage,
      hasError: Boolean(ev.error),
    });
  };

  const onFinal = (ev: ChatFinalEvent) => {
    if (finalPublished) return;

    const updated = setAssistantText({
      conversationId,
      inflightId,
      text: ev.content ?? '',
    });

    if (!updated.ok) return;

    if (updated.delta) {
      deltaCount += 1;
      publishAssistantDelta({
        conversationId,
        inflightId,
        delta: updated.delta,
      });

      if (deltaCount === 1 || deltaCount % 25 === 0) {
        log('info', 'chat.stream.delta', {
          deltaCount,
          deltaLength: updated.delta.length,
        });
      }
    }
  };

  const onThread = (ev: ChatThreadEvent) => {
    activeThreadId = ev.threadId;
  };

  const onComplete = (ev: ChatCompleteEvent) => {
    if (finalPublished) return;

    const inflightState = getInflight(conversationId);
    const cancelled = Boolean(inflightState?.abortController.signal.aborted);
    const threadId = ev.threadId ?? activeThreadId;
    const usage = normalizeUsage(ev.usage);
    const timing = deriveTiming({
      timing: ev.timing,
      startedAt: inflightState?.startedAt,
      finishedAtMs: Date.now(),
    });

    if (usage || timing) {
      log('info', 'DEV-0000024:T2:complete_usage_received', {
        hasUsage: Boolean(usage),
        hasTiming: Boolean(timing),
      });
    }

    publishFinalOnce({
      status: cancelled ? 'stopped' : 'ok',
      threadId: threadId ?? null,
      usage,
      timing,
    });
  };

  const onError = (ev: ChatErrorEvent) => {
    if (finalPublished) return;

    const transient = isTransientReconnect(getErrorMessage(ev.message));
    if (transient) {
      publishStreamWarning({
        conversationId,
        inflightId,
        message: ev.message,
      });
      log('warn', 'chat.stream.warning', {
        message: ev.message,
        warningType: 'transient_reconnect',
      });
      return;
    }

    const inflightState = getInflight(conversationId);
    const cancelled = Boolean(inflightState?.abortController.signal.aborted);
    const status = cancelled
      ? 'stopped'
      : deriveStatusFromError(ev.message ?? '');

    publishFinalOnce({
      status,
      threadId: activeThreadId,
      error: {
        code: status === 'stopped' ? 'CANCELLED' : 'PROVIDER_ERROR',
        message: ev.message,
      },
    });
  };

  chat.on('token', onToken);
  chat.on('analysis', onAnalysis);
  chat.on('tool-request', onToolRequest);
  chat.on('tool-result', onToolResult);
  chat.on('final', onFinal);
  chat.on('thread', onThread);
  chat.on('complete', onComplete);
  chat.on('error', onError);

  return {
    cleanup: () => {
      chat.off('token', onToken);
      chat.off('analysis', onAnalysis);
      chat.off('tool-request', onToolRequest);
      chat.off('tool-result', onToolResult);
      chat.off('final', onFinal);
      chat.off('thread', onThread);
      chat.off('complete', onComplete);
      chat.off('error', onError);
    },
  };
}
