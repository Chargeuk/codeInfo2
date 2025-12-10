import mongoose from 'mongoose';
import type { Conversation } from '../mongo/conversation.js';
import type { Turn } from '../mongo/turn.js';

export const memoryConversations = new Map<string, Conversation>();
export const memoryTurns = new Map<string, Turn[]>();

export const shouldUseMemoryPersistence = (): boolean =>
  process.env.NODE_ENV === 'test' || mongoose.connection.readyState !== 1;

export const recordMemoryTurn = (turn: Turn): void => {
  const turns = memoryTurns.get(turn.conversationId) ?? [];
  turns.push(turn);
  memoryTurns.set(turn.conversationId, turns);
  const convo = memoryConversations.get(turn.conversationId);
  if (convo) {
    memoryConversations.set(turn.conversationId, {
      ...convo,
      lastMessageAt: turn.createdAt ?? new Date(),
      updatedAt: new Date(),
    } as Conversation);
  }
};

export const getMemoryTurns = (conversationId: string): Turn[] => [
  ...(memoryTurns.get(conversationId) ?? []),
];

export const updateMemoryConversationMeta = (
  conversationId: string,
  patch: Partial<Pick<Conversation, 'lastMessageAt' | 'model' | 'flags'>>,
): void => {
  const existing = memoryConversations.get(conversationId);
  if (!existing) return;
  memoryConversations.set(conversationId, {
    ...existing,
    ...patch,
    updatedAt: new Date(),
  } as Conversation);
};
