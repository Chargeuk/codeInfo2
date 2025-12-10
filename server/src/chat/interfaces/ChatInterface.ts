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

    await this.execute(message, flags, conversationId, model);
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
}
