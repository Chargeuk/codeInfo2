import WebSocket from 'ws';

import {
  onConversationDelete,
  onConversationUpsert,
  type ConversationEventSummary,
} from '../mongo/events.js';
import { socketsSubscribedToSidebar } from './registry.js';
import {
  WS_PROTOCOL_VERSION,
  type WsSidebarConversationDeleteEvent,
  type WsSidebarConversationUpsertEvent,
} from './types.js';

function broadcast(event: unknown) {
  const data = JSON.stringify(event);
  for (const ws of socketsSubscribedToSidebar()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try {
      ws.send(data);
    } catch {
      // Ignore send failures; the connection will be cleaned up on close/error.
    }
  }
}

function toWsConversationSummary(conversation: ConversationEventSummary) {
  return {
    conversationId: conversation.conversationId,
    title: conversation.title,
    provider: conversation.provider,
    model: conversation.model,
    source: conversation.source,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    archived: conversation.archived,
    ...(conversation.agentName ? { agentName: conversation.agentName } : {}),
    flags: conversation.flags,
  };
}

export type SidebarPublisher = {
  close: () => void;
};

export function startSidebarPublisher(): SidebarPublisher {
  let seq = 0;

  const unsubscribeUpsert = onConversationUpsert((conversation) => {
    const event: WsSidebarConversationUpsertEvent = {
      protocolVersion: WS_PROTOCOL_VERSION,
      type: 'conversation_upsert',
      seq: ++seq,
      conversation: toWsConversationSummary(conversation),
    };
    broadcast(event);
  });

  const unsubscribeDelete = onConversationDelete((conversationId) => {
    const event: WsSidebarConversationDeleteEvent = {
      protocolVersion: WS_PROTOCOL_VERSION,
      type: 'conversation_delete',
      seq: ++seq,
      conversationId,
    };
    broadcast(event);
  });

  return {
    close: () => {
      unsubscribeUpsert();
      unsubscribeDelete();
    },
  };
}
