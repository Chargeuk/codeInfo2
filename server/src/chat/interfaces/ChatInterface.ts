import { EventEmitter } from 'node:events';
import {
  appendTurn,
  listTurns,
  updateConversationMeta,
  type AppendTurnInput,
  type TurnSummary,
} from '../../mongo/repo.js';

export interface ChatTokenEvent {
  type: 'token';
  content: string;
}

export interface ChatToolRequestEvent {
  type: 'tool-request';
  name: string;
  callId: string;
  params: unknown;
}

export interface ChatToolResultEvent {
  type: 'tool-result';
  callId: string;
  result: unknown;
}

export interface ChatFinalEvent {
  type: 'final';
  content: string;
}

export interface ChatCompleteEvent {
  type: 'complete';
}

export interface ChatErrorEvent {
  type: 'error';
  message: string;
}

export type ChatEvent =
  | ChatTokenEvent
  | ChatToolRequestEvent
  | ChatToolResultEvent
  | ChatFinalEvent
  | ChatCompleteEvent
  | ChatErrorEvent;

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
  abstract run(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ): Promise<void>;

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

  protected async persistTurn(input: AppendTurnInput): Promise<void> {
    const turn = await appendTurn(input);
    await updateConversationMeta({
      conversationId: input.conversationId,
      lastMessageAt: turn.createdAt,
    });
  }
}
