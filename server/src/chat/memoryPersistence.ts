import mongoose from 'mongoose';
import { append } from '../logStore.js';
import type { Conversation } from '../mongo/conversation.js';
import { DEV_0000048_T4_WORKING_FOLDER_STATE_STORED } from '../mongo/repo.js';
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
  patch: Partial<
    Pick<Conversation, 'lastMessageAt' | 'model' | 'flags' | 'flowName'>
  >,
): void => {
  const existing = memoryConversations.get(conversationId);
  if (!existing) return;
  memoryConversations.set(conversationId, {
    ...existing,
    ...patch,
    updatedAt: new Date(),
  } as Conversation);
};

export const updateMemoryConversationWorkingFolder = (params: {
  conversationId: string;
  workingFolder?: string | null;
}): void => {
  const existing = memoryConversations.get(params.conversationId);
  if (!existing) return;

  const trimmedWorkingFolder = params.workingFolder?.trim();
  const nextFlags = { ...(existing.flags ?? {}) };
  if (trimmedWorkingFolder) {
    nextFlags.workingFolder = trimmedWorkingFolder;
  } else {
    delete nextFlags.workingFolder;
  }

  updateMemoryConversationMeta(params.conversationId, {
    flags: nextFlags,
  });

  append({
    level: 'info',
    message: DEV_0000048_T4_WORKING_FOLDER_STATE_STORED,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      conversationId: params.conversationId,
      persistenceMode: 'memory',
      action: trimmedWorkingFolder ? 'save' : 'clear',
    },
  });
};
