import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

export type ChatWsStatus = 'disconnected' | 'connecting' | 'connected';

export type ChatWsClientMessage =
  | { type: 'subscribe_sidebar'; requestId: string }
  | { type: 'unsubscribe_sidebar'; requestId: string }
  | {
      type: 'subscribe_conversation';
      requestId: string;
      conversationId: string;
    }
  | {
      type: 'unsubscribe_conversation';
      requestId: string;
      conversationId: string;
    }
  | {
      type: 'cancel_inflight';
      requestId: string;
      conversationId: string;
      inflightId: string;
    };

export type ChatWsServerEvent =
  | { type: 'ack'; requestId: string }
  | {
      type: 'error';
      requestId?: string;
      code?: string;
      message?: string;
      details?: unknown;
    }
  | {
      type: 'conversation_upsert';
      seq: number;
      conversation: {
        conversationId: string;
        title: string;
        provider: string;
        model: string;
        source: string;
        lastMessageAt: string;
        archived: boolean;
        agentName?: string;
      };
    }
  | { type: 'conversation_delete'; seq: number; conversationId: string }
  | {
      type: 'inflight_snapshot';
      conversationId: string;
      seq: number;
      inflight: {
        inflightId: string;
        assistantText: string;
        analysisText: string;
        tools: unknown[];
        startedAt: string;
      };
    }
  | {
      type: 'assistant_delta';
      conversationId: string;
      seq: number;
      inflightId: string;
      delta: string;
    }
  | {
      type: 'analysis_delta';
      conversationId: string;
      seq: number;
      inflightId: string;
      delta: string;
    }
  | {
      type: 'tool_event';
      conversationId: string;
      seq: number;
      inflightId: string;
      event: unknown;
    }
  | {
      type: 'turn_final';
      conversationId: string;
      seq: number;
      inflightId: string;
      status: 'ok' | 'stopped' | 'failed';
    };

const makeRequestId = () =>
  crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function buildWsUrl(path: string): string {
  const httpUrl = new URL(path, serverBase);
  httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return httpUrl.toString();
}

export function useChatWs(params?: {
  enabled?: boolean;
  onEvent?: (event: ChatWsServerEvent) => void;
  onStatusChange?: (status: ChatWsStatus) => void;
}) {
  const enabled = params?.enabled ?? true;
  const onEvent = params?.onEvent;
  const onStatusChange = params?.onStatusChange;

  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ChatWsStatus>('disconnected');
  const [connectionSeq, setConnectionSeq] = useState(0);
  const enabledRef = useRef(enabled);
  const onEventRef = useRef(onEvent);
  const onStatusChangeRef = useRef(onStatusChange);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffIndexRef = useRef(0);
  const connectRef = useRef<(() => void) | null>(null);
  const lastSidebarSeqRef = useRef(0);
  const lastTranscriptSeqRef = useRef<Map<string, number>>(new Map());
  const sidebarSubscribedRef = useRef(false);
  const activeConversationIdRef = useRef<string | null>(null);

  const updateStatus = useCallback((next: ChatWsStatus) => {
    setStatus(next);
    onStatusChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
    onEventRef.current = onEvent;
    onStatusChangeRef.current = onStatusChange;
  }, [enabled, onEvent, onStatusChange]);

  const sendJson = useCallback((message: ChatWsClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!enabledRef.current) return;
    if (reconnectTimerRef.current) return;
    const baseDelay =
      BACKOFF_MS[Math.min(backoffIndexRef.current, BACKOFF_MS.length - 1)];
    backoffIndexRef.current = Math.min(
      backoffIndexRef.current + 1,
      BACKOFF_MS.length - 1,
    );
    const jitter = Math.floor(Math.random() * 250);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (!enabledRef.current) return;
      connectRef.current?.();
    }, baseDelay + jitter);
  }, []);

  const connect = useCallback(() => {
    clearReconnectTimer();
    wsRef.current?.close();
    wsRef.current = null;
    updateStatus('connecting');

    const ws = new WebSocket(buildWsUrl('/ws'));
    wsRef.current = ws;

    ws.onopen = () => {
      backoffIndexRef.current = 0;
      lastSidebarSeqRef.current = 0;
      lastTranscriptSeqRef.current = new Map();
      sidebarSubscribedRef.current = false;
      activeConversationIdRef.current = null;
      updateStatus('connected');
      setConnectionSeq((prev) => prev + 1);
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      sidebarSubscribedRef.current = false;
      activeConversationIdRef.current = null;
      updateStatus('disconnected');
      scheduleReconnect();
    };

    ws.onerror = () => {
      // `onclose` will also fire; keep this handler for observability only.
    };

    ws.onmessage = (evt) => {
      const parsed = safeParseJson(String(evt.data));
      if (!parsed || typeof parsed !== 'object') return;
      const record = parsed as Record<string, unknown>;
      if (typeof record.type !== 'string') return;

      const asEvent = parsed as ChatWsServerEvent;
      if (
        asEvent.type === 'conversation_upsert' ||
        asEvent.type === 'conversation_delete'
      ) {
        const seq = (asEvent as { seq?: unknown }).seq;
        if (typeof seq === 'number') {
          if (seq <= lastSidebarSeqRef.current) return;
          lastSidebarSeqRef.current = seq;
        }
      }

      if (
        asEvent.type === 'inflight_snapshot' ||
        asEvent.type === 'assistant_delta' ||
        asEvent.type === 'analysis_delta' ||
        asEvent.type === 'tool_event' ||
        asEvent.type === 'turn_final'
      ) {
        const seq = (asEvent as { seq?: unknown }).seq;
        const conversationId = (asEvent as { conversationId?: unknown })
          .conversationId;
        if (typeof seq === 'number' && typeof conversationId === 'string') {
          const lastSeen =
            lastTranscriptSeqRef.current.get(conversationId) ?? 0;
          if (seq <= lastSeen) return;
          lastTranscriptSeqRef.current.set(conversationId, seq);
        }
      }

      onEventRef.current?.(asEvent);
    };
  }, [clearReconnectTimer, scheduleReconnect, updateStatus]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (!enabled) {
      clearReconnectTimer();
      wsRef.current?.close();
      wsRef.current = null;
      updateStatus('disconnected');
      return;
    }
    connect();

    return () => {
      enabledRef.current = false;
      clearReconnectTimer();
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        if (sidebarSubscribedRef.current) {
          try {
            ws.send(
              JSON.stringify({
                type: 'unsubscribe_sidebar',
                requestId: makeRequestId(),
              } satisfies ChatWsClientMessage),
            );
          } catch {
            // ignore
          }
        }

        const conversationId = activeConversationIdRef.current;
        if (conversationId) {
          try {
            ws.send(
              JSON.stringify({
                type: 'unsubscribe_conversation',
                requestId: makeRequestId(),
                conversationId,
              } satisfies ChatWsClientMessage),
            );
          } catch {
            // ignore
          }
        }
      }

      sidebarSubscribedRef.current = false;
      activeConversationIdRef.current = null;

      ws?.close();
      wsRef.current = null;
      updateStatus('disconnected');
    };
  }, [clearReconnectTimer, connect, enabled, updateStatus]);

  const subscribeSidebar = useCallback(() => {
    const requestId = makeRequestId();
    const sent = sendJson({ type: 'subscribe_sidebar', requestId });
    if (sent) {
      sidebarSubscribedRef.current = true;
    }
    return requestId;
  }, [sendJson]);

  const unsubscribeSidebar = useCallback(() => {
    const requestId = makeRequestId();
    sidebarSubscribedRef.current = false;
    sendJson({ type: 'unsubscribe_sidebar', requestId });
    return requestId;
  }, [sendJson]);

  const subscribeConversation = useCallback(
    (conversationId: string) => {
      const requestId = makeRequestId();
      const sent = sendJson({
        type: 'subscribe_conversation',
        requestId,
        conversationId,
      });
      if (sent) {
        activeConversationIdRef.current = conversationId;
      }
      return requestId;
    },
    [sendJson],
  );

  const unsubscribeConversation = useCallback(
    (conversationId: string) => {
      const requestId = makeRequestId();
      if (activeConversationIdRef.current === conversationId) {
        activeConversationIdRef.current = null;
      }
      sendJson({
        type: 'unsubscribe_conversation',
        requestId,
        conversationId,
      });
      return requestId;
    },
    [sendJson],
  );

  const cancelInflight = useCallback(
    (params: { conversationId: string; inflightId: string }) => {
      const requestId = makeRequestId();
      return sendJson({
        type: 'cancel_inflight',
        requestId,
        conversationId: params.conversationId,
        inflightId: params.inflightId,
      });
    },
    [sendJson],
  );

  return useMemo(
    () => ({
      status,
      connectionSeq,
      sendJson,
      subscribeSidebar,
      unsubscribeSidebar,
      subscribeConversation,
      unsubscribeConversation,
      cancelInflight,
    }),
    [
      status,
      connectionSeq,
      sendJson,
      subscribeSidebar,
      unsubscribeSidebar,
      subscribeConversation,
      unsubscribeConversation,
      cancelInflight,
    ],
  );
}

export default useChatWs;
