import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '../logging/logger';

const API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

const WS_PROTOCOL_VERSION = 'v1' as const;

type WsProtocolVersion = typeof WS_PROTOCOL_VERSION;

type WsServerEventBase = {
  protocolVersion: WsProtocolVersion;
  type: string;
};

type WsSidebarConversationSummary = {
  conversationId: string;
  title: string;
  provider: string;
  model: string;
  source: string;
  lastMessageAt: string;
  archived: boolean;
  agentName?: string;
  flags?: Record<string, unknown>;
};

type WsSidebarConversationUpsertEvent = WsServerEventBase & {
  type: 'conversation_upsert';
  seq: number;
  conversation: WsSidebarConversationSummary;
};

type WsSidebarConversationDeleteEvent = WsServerEventBase & {
  type: 'conversation_delete';
  seq: number;
  conversationId: string;
};

type WsToolEvent =
  | {
      type: 'tool-request';
      callId?: string | number;
      name?: string;
      stage?: string;
      parameters?: unknown;
    }
  | {
      type: 'tool-result';
      callId?: string | number;
      name?: string;
      stage?: string;
      parameters?: unknown;
      result?: unknown;
      errorTrimmed?: unknown;
      errorFull?: unknown;
    };

type WsInflightSnapshotEvent = WsServerEventBase & {
  type: 'inflight_snapshot';
  conversationId: string;
  seq: number;
  inflight: {
    inflightId: string;
    assistantText: string;
    assistantThink: string;
    toolEvents: WsToolEvent[];
    startedAt: string;
  };
};

type WsAssistantDeltaEvent = WsServerEventBase & {
  type: 'assistant_delta';
  conversationId: string;
  seq: number;
  inflightId: string;
  delta: string;
};

type WsAnalysisDeltaEvent = WsServerEventBase & {
  type: 'analysis_delta';
  conversationId: string;
  seq: number;
  inflightId: string;
  delta: string;
};

type WsToolEventEvent = WsServerEventBase & {
  type: 'tool_event';
  conversationId: string;
  seq: number;
  inflightId: string;
  event: WsToolEvent;
};

type WsTurnFinalEvent = WsServerEventBase & {
  type: 'turn_final';
  conversationId: string;
  seq: number;
  inflightId: string;
  status: 'ok' | 'stopped' | 'failed';
  threadId?: string | null;
  error?: { code?: string; message?: string } | null;
};

type WsServerEvent =
  | WsSidebarConversationUpsertEvent
  | WsSidebarConversationDeleteEvent
  | WsInflightSnapshotEvent
  | WsAssistantDeltaEvent
  | WsAnalysisDeltaEvent
  | WsToolEventEvent
  | WsTurnFinalEvent;

export type ChatWsServerEvent = WsServerEvent;
export type ChatWsSidebarEvent =
  | WsSidebarConversationUpsertEvent
  | WsSidebarConversationDeleteEvent;
export type ChatWsTranscriptEvent =
  | WsInflightSnapshotEvent
  | WsAssistantDeltaEvent
  | WsAnalysisDeltaEvent
  | WsToolEventEvent
  | WsTurnFinalEvent;
export type ChatWsToolEvent = WsToolEvent;

export type ChatWsConnectionState = 'connecting' | 'open' | 'closed';

type UseChatWsParams = {
  onEvent?: (event: WsServerEvent) => void;
  onReconnectBeforeResubscribe?: () => Promise<void> | void;
};

type UseChatWsState = {
  connectionState: ChatWsConnectionState;
  subscribeSidebar: () => void;
  unsubscribeSidebar: () => void;
  subscribeConversation: (conversationId: string) => void;
  unsubscribeConversation: (conversationId: string) => void;
  cancelInflight: (conversationId: string, inflightId: string) => void;
};

const makeRequestId = () =>
  crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

function safeJsonParse(payload: unknown): unknown | null {
  if (typeof payload !== 'string') return null;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function useChatWs(params?: UseChatWsParams): UseChatWsState {
  const log = useRef(createLogger('client')).current;
  const [connectionState, setConnectionState] =
    useState<ChatWsConnectionState>('connecting');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const pendingMessagesRef = useRef<string[]>([]);

  const sidebarSubscribedRef = useRef(false);
  const conversationSubscriptionsRef = useRef<Set<string>>(new Set());

  const lastSeqByKeyRef = useRef<Map<string, number>>(new Map());

  const wsUrl = useMemo(() => {
    const wsBase = API_BASE.replace(/^http/, 'ws');
    return new URL('/ws', wsBase).toString();
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const flushPendingMessages = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const batch = pendingMessagesRef.current.splice(0);
    batch.forEach((payload) => {
      try {
        ws.send(payload);
      } catch {
        pendingMessagesRef.current.unshift(payload);
      }
    });
  }, []);

  const sendRaw = useCallback((body: Record<string, unknown>) => {
    const payload = JSON.stringify({
      protocolVersion: WS_PROTOCOL_VERSION,
      requestId: makeRequestId(),
      ...body,
    });

    const ws = wsRef.current;
    if (!ws) {
      pendingMessagesRef.current.push(payload);
      return;
    }

    try {
      ws.send(payload);
      return;
    } catch {
      pendingMessagesRef.current.push(payload);
    }
  }, []);

  const connectNowRef = useRef<() => void>(() => {});

  const connectNow = useCallback(() => {
    clearReconnectTimer();

    const existing = wsRef.current;
    if (existing && existing.readyState !== WebSocket.CLOSED) {
      return;
    }

    intentionalCloseRef.current = false;
    setConnectionState('connecting');

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      const wasReconnect = reconnectAttemptRef.current > 0;
      reconnectAttemptRef.current = 0;

      setConnectionState('open');
      log('info', 'chat.ws.client_connect');
      flushPendingMessages();

      if (wasReconnect) {
        try {
          await params?.onReconnectBeforeResubscribe?.();
        } catch (err) {
          log('warn', 'chat.ws.client_resubscribe_snapshot_failed', {
            error: String(err),
          });
        }
      }

      if (sidebarSubscribedRef.current) {
        sendRaw({ type: 'subscribe_sidebar' });
      }

      for (const conversationId of conversationSubscriptionsRef.current) {
        sendRaw({ type: 'subscribe_conversation', conversationId });
        log('info', 'chat.ws.client_subscribe_conversation', {
          conversationId,
        });
      }
    };

    ws.onmessage = (ev) => {
      const data = safeJsonParse(String(ev.data));
      if (!isRecord(data)) return;
      if (data.protocolVersion !== WS_PROTOCOL_VERSION) return;
      if (typeof data.type !== 'string') return;

      const msg = data as WsServerEvent;

      const seq =
        typeof (msg as { seq?: unknown }).seq === 'number'
          ? (msg as { seq: number }).seq
          : null;

      const key =
        msg.type === 'conversation_upsert' || msg.type === 'conversation_delete'
          ? 'sidebar'
          : typeof (msg as { conversationId?: unknown }).conversationId ===
              'string'
            ? String((msg as { conversationId: string }).conversationId)
            : 'unknown';

      if (seq !== null && key !== 'unknown') {
        const last = lastSeqByKeyRef.current.get(key) ?? 0;
        if (seq <= last) {
          log('info', 'chat.ws.client_stale_event_ignored', {
            ...(key !== 'sidebar' ? { conversationId: key } : {}),
            ...(typeof (msg as { inflightId?: unknown }).inflightId === 'string'
              ? { inflightId: (msg as { inflightId: string }).inflightId }
              : {}),
            seq,
          });
          return;
        }
        lastSeqByKeyRef.current.set(key, seq);
      }

      if (msg.type === 'inflight_snapshot') {
        log('info', 'chat.ws.client_snapshot_received', {
          conversationId: msg.conversationId,
          inflightId: msg.inflight.inflightId,
          seq: msg.seq,
        });
      }

      if (msg.type === 'turn_final') {
        log('info', 'chat.ws.client_final_received', {
          conversationId: msg.conversationId,
          inflightId: msg.inflightId,
          seq: msg.seq,
        });
      }

      params?.onEvent?.(msg);
    };

    ws.onclose = () => {
      wsRef.current = null;
      setConnectionState('closed');
      if (intentionalCloseRef.current) return;

      const attempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = attempt;
      log('info', 'chat.ws.client_reconnect_attempt', { attempt });

      const backoff = [250, 500, 1000, 2000];
      const delay = backoff[Math.min(attempt - 1, backoff.length - 1)];
      reconnectTimerRef.current = setTimeout(() => {
        connectNowRef.current();
      }, delay);
    };

    ws.onerror = () => {
      // connection-level errors are handled by onclose + reconnect.
    };
  }, [clearReconnectTimer, flushPendingMessages, log, params, sendRaw, wsUrl]);

  useEffect(() => {
    connectNowRef.current = connectNow;
  }, [connectNow]);

  useEffect(() => {
    connectNow();
    return () => {
      intentionalCloseRef.current = true;
      clearReconnectTimer();
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
      setConnectionState('closed');
    };
  }, [clearReconnectTimer, connectNow]);

  const subscribeSidebar = useCallback(() => {
    sidebarSubscribedRef.current = true;
    sendRaw({ type: 'subscribe_sidebar' });
  }, [sendRaw]);

  const unsubscribeSidebar = useCallback(() => {
    sidebarSubscribedRef.current = false;
    sendRaw({ type: 'unsubscribe_sidebar' });
  }, [sendRaw]);

  const subscribeConversation = useCallback(
    (conversationId: string) => {
      if (!conversationId) return;
      conversationSubscriptionsRef.current.add(conversationId);
      sendRaw({ type: 'subscribe_conversation', conversationId });
      log('info', 'chat.ws.client_subscribe_conversation', { conversationId });
    },
    [log, sendRaw],
  );

  const unsubscribeConversation = useCallback(
    (conversationId: string) => {
      if (!conversationId) return;
      conversationSubscriptionsRef.current.delete(conversationId);
      sendRaw({ type: 'unsubscribe_conversation', conversationId });
    },
    [sendRaw],
  );

  const cancelInflight = useCallback(
    (conversationId: string, inflightId: string) => {
      if (!conversationId || !inflightId) return;
      sendRaw({ type: 'cancel_inflight', conversationId, inflightId });
      if (connectionState === 'closed') {
        connectNowRef.current();
      }
    },
    [connectionState, sendRaw],
  );

  return useMemo(
    () => ({
      connectionState,
      subscribeSidebar,
      unsubscribeSidebar,
      subscribeConversation,
      unsubscribeConversation,
      cancelInflight,
    }),
    [
      connectionState,
      subscribeSidebar,
      unsubscribeSidebar,
      subscribeConversation,
      unsubscribeConversation,
      cancelInflight,
    ],
  );
}

export default useChatWs;
