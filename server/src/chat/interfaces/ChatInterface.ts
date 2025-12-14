import { EventEmitter } from 'node:events';
import {
  appendTurn,
  listTurns,
  updateConversationMeta,
  type AppendTurnInput,
  type TurnSummary,
} from '../../mongo/repo.js';
import type { Turn, TurnSource, TurnStatus } from '../../mongo/turn.js';
import {
  recordMemoryTurn,
  shouldUseMemoryPersistence,
} from '../memoryPersistence.js';

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
    const source = ((flags ?? {}) as { source?: TurnSource }).source ?? 'REST';
    const provider =
      ((flags ?? {}) as { provider?: string }).provider ?? 'unknown';
    const skipPersistence = Boolean(
      (flags ?? {}) && (flags as { skipPersistence?: boolean }).skipPersistence,
    );
    const createdAt = new Date();
    const userStatus: TurnStatus = 'ok';

    const tokenBuffer: string[] = [];
    let finalContent = '';
    const toolResults = new Map<string, ChatToolResultEvent>();
    let status: TurnStatus = 'ok';
    let sawComplete = false;
    const externalSignal = (flags as { signal?: AbortSignal })?.signal;
    let executionError: unknown;
    let lastErrorMessage: string | undefined;

    const deriveStatusFromError = (msg: string | undefined) => {
      if (status !== 'ok') return;
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
      lastErrorMessage = event.message;
      deriveStatusFromError(event.message);
    };

    const onComplete: Listener<'complete'> = () => {
      sawComplete = true;
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
          toolCalls: null,
          status: userStatus,
          createdAt,
        } as Turn);
      } else {
        await this.persistTurn({
          conversationId,
          role: 'user',
          content: message,
          model,
          provider,
          source,
          toolCalls: null,
          status: userStatus,
          createdAt,
        });
      }
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

      await this.persistAssistantTurn({
        conversationId,
        content,
        model,
        provider,
        source,
        status,
        toolCalls,
        skipPersistence,
      });
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
  ): Promise<void> {
    const turn = await appendTurn(input);
    await updateConversationMeta({
      conversationId: input.conversationId,
      lastMessageAt: turn.createdAt,
    });
  }

  protected async persistAssistantTurn(params: {
    conversationId: string;
    content: string;
    model: string;
    provider: string;
    source: TurnSource;
    status: TurnStatus;
    toolCalls: ChatToolResultEvent[];
    skipPersistence: boolean;
  }): Promise<void> {
    const {
      conversationId,
      content,
      model,
      provider,
      source,
      status,
      toolCalls,
      skipPersistence,
    } = params;

    if (skipPersistence) return;

    const turnPayload: AppendTurnInput = {
      conversationId,
      role: 'assistant',
      content,
      model,
      provider,
      source,
      toolCalls: toolCalls.length > 0 ? { calls: toolCalls } : null,
      status,
      createdAt: new Date(),
    };

    if (shouldUseMemoryPersistence()) {
      recordMemoryTurn(turnPayload as Turn);
      return;
    }

    await this.persistTurn(turnPayload);
  }
}
