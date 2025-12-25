import type WebSocket from 'ws';

import { getInflightRegistry } from './inflightRegistry.js';
import type {
  ServerAckEvent,
  ServerErrorEvent,
  SidebarEvent,
  ToolState,
  TranscriptEvent,
} from './types.js';

export type WsSocketContext = {
  id: string;
  ws: WebSocket;
  subscribedSidebar: boolean;
  subscribedConversations: Set<string>;
  sidebarSeq: number;
};

type WithoutSeq<T> = T extends { seq: number } ? Omit<T, 'seq'> : never;
type SidebarEventWithoutSeq = WithoutSeq<SidebarEvent>;
type TranscriptEventWithoutSeq = WithoutSeq<TranscriptEvent>;

const safeJsonSend = (socket: WsSocketContext, payload: unknown) => {
  if (socket.ws.readyState !== socket.ws.OPEN) return;
  try {
    socket.ws.send(JSON.stringify(payload));
  } catch {
    // best-effort: never let a single broken socket crash the process
  }
};

export class WsHub {
  private inflight = getInflightRegistry();
  private sidebarSubscribers = new Set<WsSocketContext>();
  private conversationSubscribers = new Map<string, Set<WsSocketContext>>();
  private transcriptSeq = new Map<string, number>();

  private nextTranscriptSeq(conversationId: string) {
    const current = this.transcriptSeq.get(conversationId) ?? 0;
    const next = current + 1;
    this.transcriptSeq.set(conversationId, next);
    return next;
  }

  private sendSidebar(
    socket: WsSocketContext,
    event: SidebarEventWithoutSeq,
  ) {
    socket.sidebarSeq += 1;
    safeJsonSend(socket, {
      ...event,
      seq: socket.sidebarSeq,
    } as SidebarEvent);
  }

  private sendTranscript(
    socket: WsSocketContext,
    event: TranscriptEventWithoutSeq,
  ) {
    const seq = this.nextTranscriptSeq(event.conversationId);
    safeJsonSend(socket, { ...event, seq } as TranscriptEvent);
  }

  private broadcastTranscript(
    conversationId: string,
    event: TranscriptEventWithoutSeq,
  ) {
    const subscribers = this.conversationSubscribers.get(conversationId);
    if (!subscribers || subscribers.size === 0) return;
    const seq = this.nextTranscriptSeq(conversationId);
    subscribers.forEach((socket) => {
      safeJsonSend(socket, { ...event, seq } as TranscriptEvent);
    });
  }

  subscribeSidebar(socket: WsSocketContext, requestId: string) {
    socket.subscribedSidebar = true;
    this.sidebarSubscribers.add(socket);
    safeJsonSend(socket, { type: 'ack', requestId } satisfies ServerAckEvent);
  }

  unsubscribeSidebar(socket: WsSocketContext, requestId: string) {
    socket.subscribedSidebar = false;
    this.sidebarSubscribers.delete(socket);
    safeJsonSend(socket, { type: 'ack', requestId } satisfies ServerAckEvent);
  }

  subscribeConversation(
    socket: WsSocketContext,
    requestId: string,
    conversationId: string,
  ) {
    socket.subscribedConversations.add(conversationId);
    const set = this.conversationSubscribers.get(conversationId) ?? new Set();
    set.add(socket);
    this.conversationSubscribers.set(conversationId, set);
    safeJsonSend(socket, { type: 'ack', requestId } satisfies ServerAckEvent);

    const active = this.inflight.getActive(conversationId);
    if (active) {
      this.sendTranscript(socket, {
        type: 'inflight_snapshot',
        conversationId,
        inflight: {
          inflightId: active.inflightId,
          assistantText: active.assistantText,
          analysisText: active.analysisText,
          tools: active.tools,
          startedAt: active.startedAt.toISOString(),
        },
      });
    }
  }

  unsubscribeConversation(
    socket: WsSocketContext,
    requestId: string,
    conversationId: string,
  ) {
    socket.subscribedConversations.delete(conversationId);
    const set = this.conversationSubscribers.get(conversationId);
    if (set) {
      set.delete(socket);
      if (set.size === 0) this.conversationSubscribers.delete(conversationId);
    }
    safeJsonSend(socket, { type: 'ack', requestId } satisfies ServerAckEvent);
  }

  onSocketClose(socket: WsSocketContext) {
    this.sidebarSubscribers.delete(socket);
    socket.subscribedConversations.forEach((conversationId) => {
      const set = this.conversationSubscribers.get(conversationId);
      if (!set) return;
      set.delete(socket);
      if (set.size === 0) this.conversationSubscribers.delete(conversationId);
    });
    socket.subscribedConversations.clear();
  }

  cancelInflight(params: {
    socket: WsSocketContext;
    requestId: string;
    conversationId: string;
    inflightId: string;
  }) {
    const result = this.inflight.cancel(
      params.conversationId,
      params.inflightId,
    );
    if (!result.ok) {
      safeJsonSend(params.socket, {
        type: 'error',
        requestId: params.requestId,
        code: 'not_found',
        message: 'Inflight not found',
      } satisfies ServerErrorEvent);
      return;
    }

    safeJsonSend(params.socket, {
      type: 'ack',
      requestId: params.requestId,
    } satisfies ServerAckEvent);

    if (result.finalizedNow) {
      this.broadcastTranscript(params.conversationId, {
        type: 'turn_final',
        conversationId: params.conversationId,
        inflightId: params.inflightId,
        status: 'stopped',
      });
    }
  }

  emitConversationUpsert(conversation: {
    conversationId: string;
    title: string;
    provider: string;
    model: string;
    source: string;
    lastMessageAt: Date;
    archived: boolean;
    agentName?: string;
  }) {
    this.sidebarSubscribers.forEach((socket) => {
      if (!socket.subscribedSidebar) return;
      this.sendSidebar(socket, {
        type: 'conversation_upsert',
        conversation: {
          conversationId: conversation.conversationId,
          title: conversation.title,
          provider: conversation.provider,
          model: conversation.model,
          source: conversation.source,
          lastMessageAt: conversation.lastMessageAt.toISOString(),
          archived: conversation.archived,
          ...(conversation.agentName
            ? { agentName: conversation.agentName }
            : {}),
        },
      });
    });
  }

  emitConversationDelete(conversationId: string) {
    this.sidebarSubscribers.forEach((socket) => {
      if (!socket.subscribedSidebar) return;
      this.sendSidebar(socket, { type: 'conversation_delete', conversationId });
    });
  }

  beginInflight(params: {
    conversationId: string;
    inflightId: string;
    startedAt: Date;
    assistantText: string;
    analysisText: string;
    tools: ToolState[];
  }) {
    this.broadcastTranscript(params.conversationId, {
      type: 'inflight_snapshot',
      conversationId: params.conversationId,
      inflight: {
        inflightId: params.inflightId,
        assistantText: params.assistantText,
        analysisText: params.analysisText,
        tools: params.tools,
        startedAt: params.startedAt.toISOString(),
      },
    });
  }

  assistantDelta(params: {
    conversationId: string;
    inflightId: string;
    delta: string;
  }) {
    this.broadcastTranscript(params.conversationId, {
      type: 'assistant_delta',
      conversationId: params.conversationId,
      inflightId: params.inflightId,
      delta: params.delta,
    });
  }

  analysisDelta(params: {
    conversationId: string;
    inflightId: string;
    delta: string;
  }) {
    this.broadcastTranscript(params.conversationId, {
      type: 'analysis_delta',
      conversationId: params.conversationId,
      inflightId: params.inflightId,
      delta: params.delta,
    });
  }

  toolEvent(params: {
    conversationId: string;
    inflightId: string;
    event: unknown;
  }) {
    this.broadcastTranscript(params.conversationId, {
      type: 'tool_event',
      conversationId: params.conversationId,
      inflightId: params.inflightId,
      event: params.event,
    });
  }

  turnFinal(params: {
    conversationId: string;
    inflightId: string;
    status: 'ok' | 'stopped' | 'failed';
  }) {
    this.broadcastTranscript(params.conversationId, {
      type: 'turn_final',
      conversationId: params.conversationId,
      inflightId: params.inflightId,
      status: params.status,
    });
  }

  // Tests
  __debugCounts() {
    let conversationSubscriptions = 0;
    for (const set of this.conversationSubscribers.values()) {
      conversationSubscriptions += set.size;
    }
    return {
      sidebarSubscribers: this.sidebarSubscribers.size,
      conversationTopics: this.conversationSubscribers.size,
      conversationSubscriptions,
    };
  }
}

let singleton: WsHub | null = null;
export function getWsHub(): WsHub {
  if (!singleton) singleton = new WsHub();
  return singleton;
}

export function resetWsHubForTest() {
  singleton = new WsHub();
}
