import { EventEmitter } from 'node:events';

export type ConversationEventSummary = {
  conversationId: string;
  provider: string;
  model: string;
  title: string;
  agentName?: string;
  flowName?: string;
  source: string;
  lastMessageAt: Date;
  archived: boolean;
  flags: Record<string, unknown>;
};

type Events = {
  conversation_upsert: (conversation: ConversationEventSummary) => void;
  conversation_delete: (conversationId: string) => void;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function emitConversationUpsert(conversation: ConversationEventSummary) {
  emitter.emit('conversation_upsert', conversation);
}

export function emitConversationDelete(conversationId: string) {
  emitter.emit('conversation_delete', conversationId);
}

export function onConversationUpsert(handler: Events['conversation_upsert']) {
  emitter.on('conversation_upsert', handler);
  return () => emitter.off('conversation_upsert', handler);
}

export function onConversationDelete(handler: Events['conversation_delete']) {
  emitter.on('conversation_delete', handler);
  return () => emitter.off('conversation_delete', handler);
}
