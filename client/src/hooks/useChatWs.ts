import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';
import { createLogger } from '../logging/logger';

const API_BASE = getApiBaseUrl();

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
  flowName?: string;
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

type WsUserTurnEvent = WsServerEventBase & {
  type: 'user_turn';
  conversationId: string;
  seq: number;
  inflightId: string;
  content: string;
  createdAt: string;
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

type WsIngestCounts = {
  files?: number;
  chunks?: number;
  embedded?: number;
};

type WsAstCounts = {
  supportedFileCount: number;
  skippedFileCount: number;
  failedFileCount: number;
  lastIndexedAt: string | null;
};

export type ChatWsIngestStatus = {
  runId: string;
  state:
    | 'queued'
    | 'scanning'
    | 'embedding'
    | 'completed'
    | 'cancelled'
    | 'error'
    | 'skipped';
  counts?: WsIngestCounts;
  ast?: WsAstCounts;
  currentFile?: string;
  fileIndex?: number;
  fileTotal?: number;
  percent?: number;
  etaMs?: number;
  message?: string;
  lastError?: string | null;
};

type WsIngestSnapshotEvent = WsServerEventBase & {
  type: 'ingest_snapshot';
  seq: number;
  status: ChatWsIngestStatus | null;
};

type WsIngestUpdateEvent = WsServerEventBase & {
  type: 'ingest_update';
  seq: number;
  status: ChatWsIngestStatus;
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
    command?: TurnCommandMetadata;
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

type WsStreamWarningEvent = WsServerEventBase & {
  type: 'stream_warning';
  conversationId: string;
  seq: number;
  inflightId: string;
  message: string;
};

type TurnCommandMetadata = {
  name: string;
  stepIndex: number;
  totalSteps: number;
  loopDepth?: number;
  label?: string;
  agentType?: string;
  identifier?: string;
};

type TurnUsageMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
};

type TurnTimingMetadata = {
  totalTimeSec?: number;
  tokensPerSecond?: number;
};

type WsTurnFinalEvent = WsServerEventBase & {
  type: 'turn_final';
  conversationId: string;
  seq: number;
  inflightId: string;
  status: 'ok' | 'stopped' | 'failed';
  threadId?: string | null;
  error?: { code?: string; message?: string } | null;
  usage?: TurnUsageMetadata;
  timing?: TurnTimingMetadata;
};

type WsServerEvent =
  | WsSidebarConversationUpsertEvent
  | WsSidebarConversationDeleteEvent
  | WsUserTurnEvent
  | WsInflightSnapshotEvent
  | WsAssistantDeltaEvent
  | WsAnalysisDeltaEvent
  | WsToolEventEvent
  | WsStreamWarningEvent
  | WsTurnFinalEvent
  | WsIngestSnapshotEvent
  | WsIngestUpdateEvent;

export type ChatWsServerEvent = WsServerEvent;
export type ChatWsSidebarEvent =
  | WsSidebarConversationUpsertEvent
  | WsSidebarConversationDeleteEvent;
export type ChatWsTranscriptEvent =
  | WsUserTurnEvent
  | WsInflightSnapshotEvent
  | WsAssistantDeltaEvent
  | WsAnalysisDeltaEvent
  | WsToolEventEvent
  | WsStreamWarningEvent
  | WsTurnFinalEvent;
export type ChatWsToolEvent = WsToolEvent;
export type ChatWsIngestEvent = WsIngestSnapshotEvent | WsIngestUpdateEvent;

export type ChatWsConnectionState = 'connecting' | 'open' | 'closed';

type UseChatWsParams = {
  onEvent?: (event: WsServerEvent) => void;
  onReconnectBeforeResubscribe?: () => Promise<void> | void;
  realtimeEnabled?: boolean;
  modelId?: string;
};

type UseChatWsState = {
  connectionState: ChatWsConnectionState;
  subscribeSidebar: () => void;
  unsubscribeSidebar: () => void;
  subscribeConversation: (conversationId: string) => void;
  unsubscribeConversation: (conversationId: string) => void;
  subscribeIngest: () => void;
  unsubscribeIngest: () => void;
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

function inflightKey(conversationId: string, inflightId: string) {
  return `${conversationId}:${inflightId}`;
}

export function useChatWs(params?: UseChatWsParams): UseChatWsState {
  const log = useMemo(() => createLogger('client'), []);
  const onEventRef = useRef<UseChatWsParams['onEvent']>(params?.onEvent);
  const onReconnectBeforeResubscribeRef = useRef<
    UseChatWsParams['onReconnectBeforeResubscribe']
  >(params?.onReconnectBeforeResubscribe);
  const modelIdRef = useRef<string | undefined>(params?.modelId);
  const realtimeEnabled = params?.realtimeEnabled !== false;
  const [connectionState, setConnectionState] =
    useState<ChatWsConnectionState>('connecting');

  useEffect(() => {
    onEventRef.current = params?.onEvent;
  }, [params?.onEvent]);

  useEffect(() => {
    modelIdRef.current = params?.modelId;
  }, [params?.modelId]);

  useEffect(() => {
    onReconnectBeforeResubscribeRef.current =
      params?.onReconnectBeforeResubscribe;
  }, [params?.onReconnectBeforeResubscribe]);

  useEffect(() => {
    if (realtimeEnabled) return;
    log('info', 'chat.ws.client_realtime_disabled', {
      reason: 'realtimeEnabled=false',
    });
  }, [log, realtimeEnabled]);

  const deltaCountsByInflightRef = useRef<Map<string, number>>(new Map());
  const toolEventCountsByInflightRef = useRef<Map<string, number>>(new Map());

  const wsRef = useRef<WebSocket | null>(null);
  const activeSocketIdRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const pendingMessagesRef = useRef<string[]>([]);

  const sidebarSubscribedRef = useRef(false);
  const ingestSubscribedRef = useRef(false);
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

    const socketId = activeSocketIdRef.current + 1;
    activeSocketIdRef.current = socketId;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      if (socketId !== activeSocketIdRef.current) return;
      const wasReconnect = reconnectAttemptRef.current > 0;
      reconnectAttemptRef.current = 0;

      setConnectionState('open');
      log('info', 'chat.ws.client_connect');
      flushPendingMessages();

      if (wasReconnect && realtimeEnabled) {
        try {
          await onReconnectBeforeResubscribeRef.current?.();
        } catch (err) {
          log('warn', 'chat.ws.client_resubscribe_snapshot_failed', {
            error: String(err),
          });
        }
      }

      if (!realtimeEnabled) {
        return;
      }

      if (sidebarSubscribedRef.current) {
        sendRaw({ type: 'subscribe_sidebar' });
      }

      if (ingestSubscribedRef.current) {
        sendRaw({ type: 'subscribe_ingest' });
      }

      for (const conversationId of conversationSubscriptionsRef.current) {
        sendRaw({ type: 'subscribe_conversation', conversationId });
        log('info', 'chat.ws.client_subscribe_conversation', {
          conversationId,
        });
      }
    };

    ws.onmessage = (ev) => {
      if (socketId !== activeSocketIdRef.current) return;
      if (!realtimeEnabled) return;
      const data = safeJsonParse(String(ev.data));
      if (!isRecord(data)) return;
      if (data.protocolVersion !== WS_PROTOCOL_VERSION) return;
      if (typeof data.type !== 'string') return;

      const msg = data as WsServerEvent;

      const seq =
        typeof (msg as { seq?: unknown }).seq === 'number'
          ? (msg as { seq: number }).seq
          : null;

      const conversationId =
        typeof (msg as { conversationId?: unknown }).conversationId === 'string'
          ? String((msg as { conversationId: string }).conversationId)
          : null;
      const inflightId =
        msg.type === 'inflight_snapshot'
          ? msg.inflight.inflightId
          : typeof (msg as { inflightId?: unknown }).inflightId === 'string'
            ? String((msg as { inflightId: string }).inflightId)
            : null;

      const key =
        msg.type === 'conversation_upsert' || msg.type === 'conversation_delete'
          ? 'sidebar'
          : conversationId && inflightId
            ? inflightKey(conversationId, inflightId)
            : (conversationId ?? 'unknown');

      if (seq !== null && key !== 'unknown') {
        const last = lastSeqByKeyRef.current.get(key) ?? 0;
        if (seq <= last) {
          log('info', 'chat.ws.client_stale_event_ignored', {
            ...(conversationId ? { conversationId } : {}),
            ...(inflightId ? { inflightId } : {}),
            seq,
            lastSeq: last,
          });
          return;
        }
        lastSeqByKeyRef.current.set(key, seq);
      }

      if (msg.type === 'inflight_snapshot') {
        const key = inflightKey(msg.conversationId, msg.inflight.inflightId);
        deltaCountsByInflightRef.current.set(key, 0);
        toolEventCountsByInflightRef.current.set(
          key,
          msg.inflight.toolEvents.length,
        );

        const snapshotLength =
          msg.inflight.assistantText.length +
          msg.inflight.assistantThink.length;
        if (snapshotLength > 0) {
          // Treat a non-empty snapshot as the first meaningful content receipt for
          // logging purposes so catch-up flows still emit a delta marker.
          deltaCountsByInflightRef.current.set(key, 1);
          log('info', 'chat.ws.client_delta_received', {
            conversationId: msg.conversationId,
            inflightId: msg.inflight.inflightId,
            seq: msg.seq,
            deltaCount: 1,
            deltaType: 'inflight_snapshot',
            deltaLength: snapshotLength,
          });
        }

        log('info', 'chat.ws.client_snapshot_received', {
          conversationId: msg.conversationId,
          inflightId: msg.inflight.inflightId,
          seq: msg.seq,
        });
      }

      if (msg.type === 'assistant_delta' || msg.type === 'analysis_delta') {
        const key = inflightKey(msg.conversationId, msg.inflightId);
        const deltaCount = (deltaCountsByInflightRef.current.get(key) ?? 0) + 1;
        deltaCountsByInflightRef.current.set(key, deltaCount);

        if (deltaCount === 1 || deltaCount % 25 === 0) {
          log('info', 'chat.ws.client_delta_received', {
            conversationId: msg.conversationId,
            inflightId: msg.inflightId,
            seq: msg.seq,
            deltaCount,
            deltaType: msg.type,
            deltaLength: msg.delta.length,
          });
        }
      }

      if (msg.type === 'tool_event') {
        const key = inflightKey(msg.conversationId, msg.inflightId);
        const toolEventCount =
          (toolEventCountsByInflightRef.current.get(key) ?? 0) + 1;
        toolEventCountsByInflightRef.current.set(key, toolEventCount);

        log('info', 'chat.ws.client_tool_event_received', {
          conversationId: msg.conversationId,
          inflightId: msg.inflightId,
          seq: msg.seq,
          toolEventCount,
          toolEventType: msg.event.type,
        });
      }

      if (msg.type === 'stream_warning') {
        log('warn', 'chat.ws.client_stream_warning', {
          conversationId: msg.conversationId,
          inflightId: msg.inflightId,
          seq: msg.seq,
          message: msg.message,
        });
      }

      if (msg.type === 'turn_final') {
        log('info', 'chat.ws.client_final_received', {
          conversationId: msg.conversationId,
          inflightId: msg.inflightId,
          seq: msg.seq,
        });

        const route =
          typeof window !== 'undefined' ? window.location.pathname : '';
        if (route.startsWith('/agents')) {
          log('info', 'DEV-0000021[T4] agents.ws event turn_final', {
            conversationId: msg.conversationId,
            inflightId: msg.inflightId,
            modelId: modelIdRef.current ?? 'unknown',
            status: msg.status,
          });
        }
      }

      log('info', '0000022 ws event forwarded', {
        eventType: msg.type,
        ...(conversationId ? { conversationId } : {}),
      });

      onEventRef.current?.(msg);
    };

    ws.onclose = (ev) => {
      if (socketId !== activeSocketIdRef.current) return;
      if (wsRef.current === ws) wsRef.current = null;
      setConnectionState('closed');

      log('info', 'chat.ws.client_disconnect', {
        code: ev.code,
        reason: ev.reason,
        wasClean: ev.wasClean,
      });

      if (intentionalCloseRef.current) return;
      if (!realtimeEnabled) return;

      // Ensure only one reconnect timer is active even if multiple sockets
      // close in quick succession.
      clearReconnectTimer();

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
  }, [
    clearReconnectTimer,
    flushPendingMessages,
    log,
    realtimeEnabled,
    sendRaw,
    wsUrl,
  ]);

  useEffect(() => {
    connectNowRef.current = connectNow;
  }, [connectNow]);

  useEffect(() => {
    connectNow();
    return () => {
      if (realtimeEnabled && ingestSubscribedRef.current) {
        ingestSubscribedRef.current = false;
        sendRaw({ type: 'unsubscribe_ingest' });
      }
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
  }, [clearReconnectTimer, connectNow, realtimeEnabled, sendRaw]);

  const subscribeSidebar = useCallback(() => {
    if (!realtimeEnabled) return;
    sidebarSubscribedRef.current = true;
    sendRaw({ type: 'subscribe_sidebar' });
  }, [realtimeEnabled, sendRaw]);

  const unsubscribeSidebar = useCallback(() => {
    if (!realtimeEnabled) return;
    sidebarSubscribedRef.current = false;
    sendRaw({ type: 'unsubscribe_sidebar' });
  }, [realtimeEnabled, sendRaw]);

  const subscribeConversation = useCallback(
    (conversationId: string) => {
      if (!realtimeEnabled) return;
      if (!conversationId) return;
      conversationSubscriptionsRef.current.add(conversationId);
      sendRaw({ type: 'subscribe_conversation', conversationId });
      log('info', 'chat.ws.client_subscribe_conversation', { conversationId });
    },
    [log, realtimeEnabled, sendRaw],
  );

  const unsubscribeConversation = useCallback(
    (conversationId: string) => {
      if (!realtimeEnabled) return;
      if (!conversationId) return;
      conversationSubscriptionsRef.current.delete(conversationId);
      sendRaw({ type: 'unsubscribe_conversation', conversationId });
    },
    [realtimeEnabled, sendRaw],
  );

  const subscribeIngest = useCallback(() => {
    if (!realtimeEnabled) return;
    ingestSubscribedRef.current = true;
    sendRaw({ type: 'subscribe_ingest' });
  }, [realtimeEnabled, sendRaw]);

  const unsubscribeIngest = useCallback(() => {
    if (!realtimeEnabled) return;
    ingestSubscribedRef.current = false;
    sendRaw({ type: 'unsubscribe_ingest' });
  }, [realtimeEnabled, sendRaw]);

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
      subscribeIngest,
      unsubscribeIngest,
      cancelInflight,
    }),
    [
      connectionState,
      subscribeSidebar,
      unsubscribeSidebar,
      subscribeConversation,
      unsubscribeConversation,
      subscribeIngest,
      unsubscribeIngest,
      cancelInflight,
    ],
  );
}

export default useChatWs;
