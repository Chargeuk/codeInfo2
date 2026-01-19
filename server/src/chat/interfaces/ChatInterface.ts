import { EventEmitter } from 'node:events';
import { isTransientReconnect } from '../../agents/transientReconnect.js';
import { append } from '../../logStore.js';
import {
  appendTurn,
  listTurns,
  updateConversationMeta,
  type AppendTurnInput,
  type TurnSummary,
} from '../../mongo/repo.js';
import type {
  Turn,
  TurnCommandMetadata,
  TurnSource,
  TurnStatus,
  TurnTimingMetadata,
  TurnUsageMetadata,
} from '../../mongo/turn.js';
import { cleanupInflight, markInflightPersisted } from '../inflightRegistry.js';
import {
  recordMemoryTurn,
  shouldUseMemoryPersistence,
} from '../memoryPersistence.js';

const parseCommandMetadata = (
  input: unknown,
): TurnCommandMetadata | undefined => {
  if (!input || typeof input !== 'object') return undefined;
  const value = input as Record<string, unknown>;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const stepIndex = value.stepIndex;
  const totalSteps = value.totalSteps;
  if (!name.length) return undefined;
  if (typeof stepIndex !== 'number' || !Number.isFinite(stepIndex))
    return undefined;
  if (typeof totalSteps !== 'number' || !Number.isFinite(totalSteps))
    return undefined;
  if (name === 'flow') {
    const loopDepth =
      typeof value.loopDepth === 'number' ? value.loopDepth : undefined;
    const agentType =
      typeof value.agentType === 'string' ? value.agentType.trim() : '';
    const identifier =
      typeof value.identifier === 'string' ? value.identifier.trim() : '';
    const label = typeof value.label === 'string' ? value.label.trim() : 'flow';
    if (loopDepth === undefined || !Number.isFinite(loopDepth))
      return undefined;
    if (!agentType.length || !identifier.length) return undefined;
    return {
      name: 'flow',
      stepIndex,
      totalSteps,
      loopDepth,
      agentType,
      identifier,
      label: label.length ? label : 'flow',
    };
  }
  return { name, stepIndex, totalSteps };
};

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
  startedAtMs: number;
  finishedAtMs: number;
}): TurnTimingMetadata | undefined => {
  const cleaned = normalizeTiming(params.timing) ?? {};
  const hasTotal = isFiniteNumber(cleaned.totalTimeSec);
  if (!hasTotal) {
    const elapsedSec = (params.finishedAtMs - params.startedAtMs) / 1000;
    if (isFiniteNumber(elapsedSec) && elapsedSec > 0) {
      cleaned.totalTimeSec = elapsedSec;
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

export interface ChatTokenEvent {
  type: 'token';
  content: string;
}

export interface ChatToolRequestEvent {
  type: 'tool-request';
  name: string;
  callId: string;
  params: unknown;
  stage?: 'started';
}

export interface ChatToolResultEvent {
  type: 'tool-result';
  callId: string;
  result: unknown;
  name?: string;
  params?: unknown;
  stage?: 'success' | 'error';
  error?: { code?: string; message: string } | null;
}

export interface ChatFinalEvent {
  type: 'final';
  content: string;
}

export interface ChatCompleteEvent {
  type: 'complete';
  threadId?: string | null;
  usage?: TurnUsageMetadata;
  timing?: TurnTimingMetadata;
}

export interface ChatErrorEvent {
  type: 'error';
  message: string;
}

export interface ChatAnalysisEvent {
  type: 'analysis';
  content: string;
}

export interface ChatThreadEvent {
  type: 'thread';
  threadId: string;
}

export type ChatEvent =
  | ChatTokenEvent
  | ChatToolRequestEvent
  | ChatToolResultEvent
  | ChatFinalEvent
  | ChatCompleteEvent
  | ChatErrorEvent
  | ChatAnalysisEvent
  | ChatThreadEvent;

type EventType = ChatEvent['type'];

type Listener<T extends EventType> = (
  event: Extract<ChatEvent, { type: T }>,
) => void;

/**
 * Base chat interface that normalises streaming events and centralises
 * conversation persistence helpers. Provider-specific subclasses implement
 * the provider call in `run`.
 */
export abstract class ChatInterface extends EventEmitter {
  abstract execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ): Promise<void>;

  async run(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ): Promise<void> {
    const inflightId =
      typeof (flags as { inflightId?: unknown })?.inflightId === 'string'
        ? ((flags as { inflightId?: string }).inflightId as string)
        : undefined;
    const source = ((flags ?? {}) as { source?: TurnSource }).source ?? 'REST';
    const provider =
      ((flags ?? {}) as { provider?: string }).provider ?? 'unknown';
    const requestId =
      typeof (flags as { requestId?: unknown })?.requestId === 'string'
        ? ((flags as { requestId?: string }).requestId as string)
        : undefined;
    const skipPersistence = Boolean(
      (flags ?? {}) && (flags as { skipPersistence?: boolean }).skipPersistence,
    );
    const command = parseCommandMetadata(
      (flags as { command?: unknown })?.command,
    );
    const createdAt = new Date();
    const userStatus: TurnStatus = 'ok';

    let userPersisted = false;
    let assistantPersisted = false;

    const tokenBuffer: string[] = [];
    let finalContent = '';
    const toolResults = new Map<string, ChatToolResultEvent>();
    let status: TurnStatus = 'ok';
    let sawComplete = false;
    const runStartedAtMs = Date.now();
    let latestUsage: TurnUsageMetadata | undefined;
    let latestTiming: TurnTimingMetadata | undefined;
    let loggedPersistUsage = false;
    const externalSignal = (flags as { signal?: AbortSignal })?.signal;
    let executionError: unknown;
    let lastErrorMessage: string | undefined;

    const deriveStatusFromError = (msg: string | undefined) => {
      if (status !== 'ok') return;
      if (isTransientReconnect(msg)) return;
      const text = (msg ?? '').toLowerCase();
      if (text.includes('abort') || text.includes('stop')) {
        status = 'stopped';
        return;
      }
      status = 'failed';
    };

    const onToken: Listener<'token'> = (event) => {
      tokenBuffer.push(event.content);
    };

    const onFinal: Listener<'final'> = (event) => {
      finalContent = event.content;
    };

    const onToolResult: Listener<'tool-result'> = (event) => {
      toolResults.set(event.callId, event);
    };

    const onError: Listener<'error'> = (event) => {
      if (isTransientReconnect(event.message)) {
        return;
      }
      lastErrorMessage = event.message;
      deriveStatusFromError(event.message);
    };

    const onComplete: Listener<'complete'> = (event) => {
      sawComplete = true;
      if (event.usage) {
        latestUsage = normalizeUsage(event.usage);
      }
      if (event.timing) {
        latestTiming = normalizeTiming(event.timing);
      }
      if (status === 'ok') status = 'ok';
    };

    const add = <T extends EventType>(event: T, listener: Listener<T>) => {
      this.on(event, listener);
      return () => this.off(event, listener);
    };

    const disposers = [
      add('token', onToken),
      add('final', onFinal),
      add('tool-result', onToolResult),
      add('error', onError),
      add('complete', onComplete),
    ];

    if (!skipPersistence) {
      if (shouldUseMemoryPersistence()) {
        recordMemoryTurn({
          conversationId,
          role: 'user',
          content: message,
          model,
          provider,
          source,
          command,
          toolCalls: null,
          status: userStatus,
          createdAt,
        } as Turn);
        userPersisted = true;
        if (inflightId) {
          markInflightPersisted({ conversationId, inflightId, role: 'user' });
        }
      } else {
        const persisted = await this.persistTurn({
          conversationId,
          role: 'user',
          content: message,
          model,
          provider,
          source,
          command,
          toolCalls: null,
          status: userStatus,
          createdAt,
        });
        userPersisted = true;
        if (inflightId) {
          markInflightPersisted({
            conversationId,
            inflightId,
            role: 'user',
            turnId: persisted.turnId,
          });
        }
      }
    } else {
      userPersisted = true;
    }

    try {
      await this.execute(message, flags, conversationId, model);
    } catch (err) {
      executionError = err;
      if (err && typeof err === 'object') {
        const maybeMessage = (err as { message?: unknown }).message;
        if (
          typeof maybeMessage === 'string' &&
          maybeMessage.trim().length > 0
        ) {
          lastErrorMessage = maybeMessage;
        }
      }
      deriveStatusFromError((err as Error | undefined)?.message);
    } finally {
      disposers.forEach((dispose) => dispose());

      let content = finalContent || tokenBuffer.join('');
      const toolCalls = Array.from(toolResults.values());
      if (status === 'ok' && externalSignal?.aborted) {
        status = 'stopped';
      }
      if (status === 'ok' && !sawComplete && executionError) {
        deriveStatusFromError((executionError as Error | undefined)?.message);
      }
      if (!content.trim().length && status !== 'ok') {
        content =
          lastErrorMessage?.trim() ||
          (status === 'stopped' ? 'Stopped' : 'Request failed');
      }

      const runFinishedAtMs = Date.now();
      const usage = normalizeUsage(latestUsage);
      const timing = deriveTiming({
        timing: latestTiming,
        startedAtMs: runStartedAtMs,
        finishedAtMs: runFinishedAtMs,
      });

      if (!loggedPersistUsage && (usage || timing)) {
        loggedPersistUsage = true;
        append({
          level: 'info',
          message: 'DEV-0000024:T2:persist_usage_forwarded',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: {
            conversationId,
            hasUsage: Boolean(usage),
            hasTiming: Boolean(timing),
          },
        });
      }

      const persistedAssistantTurnId = await this.persistAssistantTurn({
        conversationId,
        content,
        model,
        provider,
        source,
        command,
        usage,
        timing,
        status,
        toolCalls,
        skipPersistence,
      });

      assistantPersisted = true;
      if (inflightId) {
        markInflightPersisted({
          conversationId,
          inflightId,
          role: 'assistant',
          turnId: persistedAssistantTurnId,
        });
      }

      if (inflightId && userPersisted && assistantPersisted) {
        cleanupInflight({ conversationId, inflightId });
      }
    }

    if (executionError) {
      throw executionError;
    }
  }

  on<T extends EventType>(event: T, listener: Listener<T>): this {
    return super.on(event, listener);
  }

  protected emitEvent(event: ChatEvent): void {
    this.emit(event.type, event);
  }

  protected async loadHistory(conversationId: string): Promise<TurnSummary[]> {
    const { items } = await listTurns({
      conversationId,
      limit: Number.MAX_SAFE_INTEGER,
    });
    return items;
  }

  protected async persistTurn(
    input: AppendTurnInput & { source?: TurnSource },
  ): Promise<{ turnId?: string }> {
    const turn = await appendTurn(input);
    await updateConversationMeta({
      conversationId: input.conversationId,
      lastMessageAt: turn.createdAt,
    });

    const turnId =
      turn && typeof turn === 'object' && '_id' in (turn as object)
        ? String((turn as { _id?: unknown })._id ?? '')
        : undefined;
    return turnId?.length ? { turnId } : {};
  }

  protected async persistAssistantTurn(params: {
    conversationId: string;
    content: string;
    model: string;
    provider: string;
    source: TurnSource;
    command?: TurnCommandMetadata;
    usage?: TurnUsageMetadata;
    timing?: TurnTimingMetadata;
    status: TurnStatus;
    toolCalls: ChatToolResultEvent[];
    skipPersistence: boolean;
  }): Promise<string | undefined> {
    const {
      conversationId,
      content,
      model,
      provider,
      source,
      command,
      usage,
      timing,
      status,
      toolCalls,
      skipPersistence,
    } = params;

    if (skipPersistence) return undefined;

    const turnPayload: AppendTurnInput = {
      conversationId,
      role: 'assistant',
      content,
      model,
      provider,
      source,
      command,
      usage,
      timing,
      toolCalls: toolCalls.length > 0 ? { calls: toolCalls } : null,
      status,
      createdAt: new Date(),
    };

    if (shouldUseMemoryPersistence()) {
      recordMemoryTurn(turnPayload as Turn);
      return undefined;
    }

    const persisted = await this.persistTurn(turnPayload);
    return persisted.turnId;
  }
}
