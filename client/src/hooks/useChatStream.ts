import type { LogLevel } from '@codeinfo2/common';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '../logging/logger';
import type { ChatWsToolEvent, ChatWsTranscriptEvent } from './useChatWs';

export type SandboxMode =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access';

export type ApprovalPolicy =
  | 'never'
  | 'on-request'
  | 'on-failure'
  | 'untrusted';

export type ModelReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export type CodexFlagState = {
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalPolicy;
  networkAccessEnabled?: boolean;
  webSearchEnabled?: boolean;
  modelReasoningEffort?: ModelReasoningEffort;
};

export type ToolCitation = {
  repo: string;
  relPath: string;
  hostPath?: string;
  containerPath?: string;
  score?: number | null;
  chunk: string;
  chunkId?: string;
  modelId?: string;
};

export type ToolCall = {
  id: string;
  name?: string;
  status: 'requesting' | 'done' | 'error';
  payload?: unknown;
  parameters?: unknown;
  stage?: string;
  errorTrimmed?: { code?: string; message?: string } | null;
  errorFull?: unknown;
};

export type ChatSegment =
  | { id: string; kind: 'text'; content: string }
  | { id: string; kind: 'tool'; tool: ToolCall };

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  command?: { name: string; stepIndex: number; totalSteps: number };
  kind?: 'error' | 'status';
  think?: string;
  thinkStreaming?: boolean;
  citations?: ToolCitation[];
  tools?: ToolCall[];
  segments?: ChatSegment[];
  streamStatus?: 'processing' | 'complete' | 'failed';
  thinking?: boolean;
  createdAt?: string;
};

type Status = 'idle' | 'sending';

const API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

const DEFAULT_SANDBOX_MODE: SandboxMode = 'workspace-write';
const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = 'on-failure';
const DEFAULT_NETWORK_ACCESS_ENABLED = true;
const DEFAULT_WEB_SEARCH_ENABLED = true;
const DEFAULT_MODEL_REASONING_EFFORT: ModelReasoningEffort = 'high';

const makeId = () =>
  crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

const isVectorPayloadString = (content: string) => {
  try {
    const parsed = JSON.parse(content) as unknown;
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.some((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const obj = entry as Record<string, unknown>;
      const results = Array.isArray(obj.results) ? obj.results : [];
      const files = Array.isArray(obj.files) ? obj.files : [];
      const hasVectorLike = (items: unknown[]) =>
        items.some((item) => {
          if (!item || typeof item !== 'object') return false;
          const it = item as Record<string, unknown>;
          return (
            typeof it.hostPath === 'string' &&
            (typeof it.chunk === 'string' ||
              typeof it.score === 'number' ||
              typeof it.lineCount === 'number')
          );
        });
      return hasVectorLike(results) || hasVectorLike(files);
    });
  } catch {
    return false;
  }
};

function normalizeToolCallId(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return makeId();
}

export function useChatStream(
  model?: string,
  provider?: string,
  codexFlags?: CodexFlagState,
) {
  const log = useRef(createLogger('client')).current;
  const logWithChannel = useCallback(
    (level: LogLevel, message: string, context: Record<string, unknown> = {}) =>
      log(level, message, {
        channel: 'client-chat',
        provider,
        model,
        ...context,
      }),
    [log, model, provider],
  );

  const [status, setStatus] = useState<Status>('idle');
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);

  const [conversationId, setConversationId] = useState<string>(() => makeId());
  const conversationIdRef = useRef(conversationId);

  const [threadId, setThreadId] = useState<string | null>(null);
  const threadIdRef = useRef<string | null>(null);

  const inflightIdRef = useRef<string | null>(null);
  const [inflightId, setInflightId] = useState<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const toolCallsRef = useRef<Map<string, ToolCall>>(new Map());
  const segmentsRef = useRef<ChatSegment[]>([]);
  const assistantTextRef = useRef('');
  const assistantThinkRef = useRef('');
  const assistantCitationsRef = useRef<ToolCitation[]>([]);

  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  const updateMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setMessages((prev) => {
        const next = updater(prev);
        messagesRef.current = next;
        return next;
      });
    },
    [],
  );

  const clearThinkingTimer = useCallback(() => {
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
  }, []);

  const markAssistantThinking = useCallback(
    (thinking: boolean) => {
      const assistantId = activeAssistantMessageIdRef.current;
      if (!assistantId) return;
      updateMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId ? { ...msg, thinking } : msg,
        ),
      );
    },
    [updateMessages],
  );

  const scheduleThinkingTimer = useCallback(() => {
    clearThinkingTimer();
    thinkingTimerRef.current = setTimeout(() => {
      const hasVisibleText = assistantTextRef.current.trim().length > 0;
      markAssistantThinking(!hasVisibleText);
      if (isStreaming) {
        scheduleThinkingTimer();
      }
    }, 1000);
  }, [clearThinkingTimer, isStreaming, markAssistantThinking]);

  const ensureAssistantMessage = useCallback(() => {
    let assistantId = activeAssistantMessageIdRef.current;

    if (!assistantId) {
      const last = messagesRef.current[messagesRef.current.length - 1];
      if (last?.role === 'assistant' && last.streamStatus === 'processing') {
        assistantId = last.id;
      }
    }

    if (!assistantId) {
      assistantId = makeId();
      activeAssistantMessageIdRef.current = assistantId;
      segmentsRef.current = [{ id: makeId(), kind: 'text', content: '' }];
      toolCallsRef.current = new Map();
      assistantTextRef.current = '';
      assistantThinkRef.current = '';
      assistantCitationsRef.current = [];
      updateMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          segments: segmentsRef.current,
          streamStatus: 'processing',
          thinking: false,
          createdAt: new Date().toISOString(),
        },
      ]);
    } else {
      activeAssistantMessageIdRef.current = assistantId;
    }

    return assistantId;
  }, [updateMessages]);

  const syncAssistantMessage = useCallback(
    (updates?: Partial<ChatMessage>) => {
      const assistantId = activeAssistantMessageIdRef.current;
      if (!assistantId) return;

      const tools = Array.from(toolCallsRef.current.values());
      updateMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantId) return msg;
          return {
            ...msg,
            content: assistantTextRef.current,
            think: assistantThinkRef.current || undefined,
            thinkStreaming: isStreaming && assistantThinkRef.current.length > 0,
            segments: segmentsRef.current,
            tools,
            citations:
              assistantCitationsRef.current.length > 0
                ? assistantCitationsRef.current
                : undefined,
            ...(updates ?? {}),
          };
        }),
      );
    },
    [isStreaming, updateMessages],
  );

  const handleErrorBubble = useCallback(
    (message: string) => {
      updateMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          content: message,
          kind: 'error',
        },
      ]);
    },
    [updateMessages],
  );

  const extractCitations = useCallback((result: unknown): ToolCitation[] => {
    const payload =
      result && typeof result === 'object' && 'results' in result
        ? (result as { results?: unknown }).results
        : undefined;

    if (!Array.isArray(payload)) return [];

    return payload
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const i = item as Record<string, unknown>;
        const repo = typeof i.repo === 'string' ? i.repo : undefined;
        const relPath = typeof i.relPath === 'string' ? i.relPath : undefined;
        const chunk = typeof i.chunk === 'string' ? i.chunk : undefined;
        if (!repo || !relPath || !chunk) return null;
        return {
          repo,
          relPath,
          hostPath: typeof i.hostPath === 'string' ? i.hostPath : undefined,
          containerPath:
            typeof i.containerPath === 'string' ? i.containerPath : undefined,
          score: typeof i.score === 'number' ? i.score : null,
          chunk,
          chunkId: typeof i.chunkId === 'string' ? i.chunkId : undefined,
          modelId: typeof i.modelId === 'string' ? i.modelId : undefined,
        } satisfies ToolCitation;
      })
      .filter(Boolean) as ToolCitation[];
  }, []);

  const applyToolEvent = useCallback(
    (event: ChatWsToolEvent) => {
      const callId = normalizeToolCallId(event.callId);
      const existing = toolCallsRef.current.get(callId);

      if (event.type === 'tool-request') {
        const tool: ToolCall = {
          id: callId,
          name: event.name,
          status: 'requesting',
          parameters: event.parameters,
          stage: event.stage,
        };

        toolCallsRef.current.set(callId, {
          ...(existing ?? tool),
          ...tool,
        });

        if (
          !segmentsRef.current.some(
            (segment) => segment.kind === 'tool' && segment.tool.id === callId,
          )
        ) {
          segmentsRef.current = [
            ...segmentsRef.current,
            { id: makeId(), kind: 'tool', tool },
            { id: makeId(), kind: 'text', content: '' },
          ];
        }
        return;
      }

      const status: ToolCall['status'] =
        event.stage === 'error' || event.errorTrimmed || event.errorFull
          ? 'error'
          : 'done';

      let payload = event.result;
      if (typeof payload === 'string' && isVectorPayloadString(payload)) {
        try {
          payload = JSON.parse(payload);
        } catch {
          // ignore parse failure
        }
      }

      const errorTrimmed =
        event.errorTrimmed && typeof event.errorTrimmed === 'object'
          ? (event.errorTrimmed as { code?: string; message?: string })
          : undefined;

      const tool: ToolCall = {
        id: callId,
        name: event.name ?? existing?.name,
        status,
        payload,
        parameters: event.parameters,
        stage: event.stage,
        errorTrimmed: errorTrimmed ?? null,
        errorFull: event.errorFull,
      };

      toolCallsRef.current.set(callId, { ...(existing ?? tool), ...tool });

      let replaced = false;
      segmentsRef.current = segmentsRef.current.map((segment) => {
        if (segment.kind !== 'tool') return segment;
        if (segment.tool.id !== callId) return segment;
        replaced = true;
        return { ...segment, tool };
      });

      if (!replaced) {
        segmentsRef.current = [
          ...segmentsRef.current,
          { id: makeId(), kind: 'tool', tool },
          { id: makeId(), kind: 'text', content: '' },
        ];
      }

      const citations = payload ? extractCitations(payload) : [];
      if (citations.length > 0) {
        assistantCitationsRef.current = citations;
      }
    },
    [extractCitations],
  );

  const resetInflightState = useCallback(() => {
    inflightIdRef.current = null;
    setInflightId(null);
    activeAssistantMessageIdRef.current = null;
    toolCallsRef.current = new Map();
    segmentsRef.current = [];
    assistantTextRef.current = '';
    assistantThinkRef.current = '';
    assistantCitationsRef.current = [];
    clearThinkingTimer();
    setIsStreaming(false);
    setStatus('idle');
  }, [clearThinkingTimer]);

  const stop = useCallback(
    (options?: { showStatusBubble?: boolean }) => {
      clearThinkingTimer();
      setIsStreaming(false);
      setStatus('idle');
      markAssistantThinking(false);
      syncAssistantMessage({ thinkStreaming: false, thinking: false });

      if (options?.showStatusBubble) {
        updateMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: 'assistant',
            content: 'Generation stopped',
            kind: 'status',
          },
        ]);
      }
    },
    [clearThinkingTimer, markAssistantThinking, syncAssistantMessage, updateMessages],
  );

  const reset = useCallback(() => {
    updateMessages(() => []);
    resetInflightState();
    setThreadId(null);
    threadIdRef.current = null;
    const nextConversationId = makeId();
    setConversationId(nextConversationId);
    conversationIdRef.current = nextConversationId;
    return nextConversationId;
  }, [resetInflightState, updateMessages]);

  const setConversation = useCallback(
    (nextConversationId: string, options?: { clearMessages?: boolean }) => {
      stop();
      resetInflightState();
      if (options?.clearMessages) {
        updateMessages(() => []);
      }
      setThreadId(null);
      threadIdRef.current = null;
      setConversationId(nextConversationId);
      conversationIdRef.current = nextConversationId;
    },
    [resetInflightState, stop, updateMessages],
  );

  const hydrateHistory = useCallback(
    (
      historyConversationId: string,
      history: ChatMessage[],
      mode: 'replace' | 'prepend' = 'replace',
    ) => {
      conversationIdRef.current = historyConversationId;
      setConversationId(historyConversationId);
      updateMessages((prev) => {
        const next = mode === 'prepend' ? [...history, ...prev] : [...history];
        const seen = new Set<string>();
        return next.filter((msg) => {
          const key = msg.id;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
    },
    [updateMessages],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === 'sending' || !model || !provider) {
        return;
      }

      stop();
      resetInflightState();

      const nextInflightId = makeId();
      inflightIdRef.current = nextInflightId;
      setInflightId(nextInflightId);

      setStatus('sending');
      setIsStreaming(true);

      const userMessage: ChatMessage = {
        id: makeId(),
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };

      updateMessages((prev) => [...prev, userMessage]);

      const currentConversationId = conversationIdRef.current || makeId();
      conversationIdRef.current = currentConversationId;
      setConversationId(currentConversationId);

      ensureAssistantMessage();
      assistantTextRef.current = '';
      assistantThinkRef.current = '';
      segmentsRef.current = [{ id: makeId(), kind: 'text', content: '' }];
      syncAssistantMessage({ streamStatus: 'processing' });
      scheduleThinkingTimer();

      try {
        const sandboxMode =
          provider === 'codex'
            ? (codexFlags?.sandboxMode ?? DEFAULT_SANDBOX_MODE)
            : undefined;
        const approvalPolicy =
          provider === 'codex'
            ? (codexFlags?.approvalPolicy ?? DEFAULT_APPROVAL_POLICY)
            : undefined;
        const modelReasoningEffort =
          provider === 'codex'
            ? (codexFlags?.modelReasoningEffort ??
              DEFAULT_MODEL_REASONING_EFFORT)
            : undefined;
        const networkAccessEnabled =
          provider === 'codex'
            ? (codexFlags?.networkAccessEnabled ??
              DEFAULT_NETWORK_ACCESS_ENABLED)
            : undefined;
        const webSearchEnabled =
          provider === 'codex'
            ? (codexFlags?.webSearchEnabled ?? DEFAULT_WEB_SEARCH_ENABLED)
            : undefined;

        const codexPayload =
          provider === 'codex'
            ? {
                ...(threadIdRef.current
                  ? { threadId: threadIdRef.current }
                  : {}),
                sandboxMode,
                approvalPolicy,
                modelReasoningEffort,
                networkAccessEnabled,
                webSearchEnabled,
              }
            : {};

        const res = await fetch(new URL('/chat', API_BASE).toString(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            provider,
            model,
            conversationId: currentConversationId,
            inflightId: nextInflightId,
            message: trimmed,
            ...codexPayload,
          }),
        });

        const payload = (await res.json().catch(() => null)) as {
          status?: string;
          code?: string;
          message?: string;
          conversationId?: string;
          inflightId?: string;
          provider?: string;
          model?: string;
        } | null;

        if (res.status === 409 && payload?.code === 'RUN_IN_PROGRESS') {
          handleErrorBubble(
            payload?.message ?? 'A run is already in progress for this thread.',
          );
          inflightIdRef.current = null;
          setInflightId(null);
          setIsStreaming(false);
          setStatus('idle');
          syncAssistantMessage({
            streamStatus: 'failed',
            thinking: false,
            thinkStreaming: false,
          });
          return;
        }

        if (res.status !== 202 || !payload || payload.status !== 'started') {
          throw new Error(
            payload?.message || `Chat request failed (${res.status})`,
          );
        }

        if (payload.inflightId) {
          inflightIdRef.current = payload.inflightId;
          setInflightId(payload.inflightId);
        }

        if (
          payload.conversationId &&
          payload.conversationId !== conversationId
        ) {
          setConversationId(payload.conversationId);
          conversationIdRef.current = payload.conversationId;
        }

        logWithChannel('info', 'chat run started', {
          conversationId: payload.conversationId ?? currentConversationId,
          inflightId: payload.inflightId,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        handleErrorBubble((err as Error).message);
        setIsStreaming(false);
        setStatus('idle');
        setInflightId(null);
        syncAssistantMessage({
          streamStatus: 'failed',
          thinking: false,
          thinkStreaming: false,
        });
      }
    },
    [
      codexFlags,
      ensureAssistantMessage,
      handleErrorBubble,
      logWithChannel,
      model,
      provider,
      resetInflightState,
      scheduleThinkingTimer,
      status,
      stop,
      syncAssistantMessage,
      updateMessages,
      conversationId,
    ],
  );

  const handleWsEvent = useCallback(
    (event: ChatWsTranscriptEvent) => {
      const activeConversation = conversationIdRef.current;
      if (event.conversationId !== activeConversation) {
        return;
      }

      ensureAssistantMessage();

      if (event.type === 'inflight_snapshot') {
        inflightIdRef.current = event.inflight.inflightId;
        setInflightId(event.inflight.inflightId);
        assistantTextRef.current = event.inflight.assistantText;
        assistantThinkRef.current = event.inflight.assistantThink;
        toolCallsRef.current = new Map();
        segmentsRef.current = [
          { id: makeId(), kind: 'text', content: assistantTextRef.current },
        ];
        assistantCitationsRef.current = [];
        event.inflight.toolEvents.forEach((toolEvent) =>
          applyToolEvent(toolEvent),
        );
        if (segmentsRef.current.length === 0) {
          segmentsRef.current = [{ id: makeId(), kind: 'text', content: '' }];
        }
        setIsStreaming(true);
        syncAssistantMessage({ streamStatus: 'processing' });
        return;
      }

      if (event.type === 'assistant_delta') {
        inflightIdRef.current = event.inflightId;
        setInflightId(event.inflightId);
        assistantTextRef.current += event.delta;
        const last = segmentsRef.current[segmentsRef.current.length - 1];
        if (last?.kind === 'text') {
          segmentsRef.current = [
            ...segmentsRef.current.slice(0, -1),
            { ...last, content: last.content + event.delta },
          ];
        } else {
          segmentsRef.current = [
            ...segmentsRef.current,
            { id: makeId(), kind: 'text', content: event.delta },
          ];
        }
        setIsStreaming(true);
        syncAssistantMessage({ streamStatus: 'processing' });
        return;
      }

      if (event.type === 'analysis_delta') {
        inflightIdRef.current = event.inflightId;
        setInflightId(event.inflightId);
        assistantThinkRef.current += event.delta;
        setIsStreaming(true);
        syncAssistantMessage({ streamStatus: 'processing' });
        return;
      }

      if (event.type === 'tool_event') {
        inflightIdRef.current = event.inflightId;
        setInflightId(event.inflightId);
        applyToolEvent(event.event);
        setIsStreaming(true);
        syncAssistantMessage({ streamStatus: 'processing' });
        return;
      }

      if (event.type === 'turn_final') {
        inflightIdRef.current = event.inflightId;
        setInflightId(event.inflightId);
        if (event.threadId !== undefined) {
          setThreadId(event.threadId ?? null);
          threadIdRef.current = event.threadId ?? null;
        }

        clearThinkingTimer();
        setIsStreaming(false);
        setStatus('idle');

        if (
          event.status === 'failed' &&
          event.error?.message &&
          assistantTextRef.current.trim().length === 0
        ) {
          assistantTextRef.current = event.error.message;
          segmentsRef.current = [
            { id: makeId(), kind: 'text', content: assistantTextRef.current },
          ];
        }

        const streamStatus: ChatMessage['streamStatus'] =
          event.status === 'failed' ? 'failed' : 'complete';

        syncAssistantMessage({
          streamStatus,
          thinking: false,
          thinkStreaming: false,
          ...(event.status === 'failed' ? { kind: 'error' as const } : {}),
        });
      }
    },
    [
      applyToolEvent,
      clearThinkingTimer,
      ensureAssistantMessage,
      syncAssistantMessage,
    ],
  );

  const getInflightId = useCallback(() => inflightIdRef.current, []);

  return useMemo(
    () => ({
      messages,
      status,
      isStreaming,
      send,
      stop,
      reset,
      conversationId,
      setConversation,
      hydrateHistory,
      inflightId,
      getInflightId,
      handleWsEvent,
    }),
    [
      messages,
      status,
      isStreaming,
      send,
      stop,
      reset,
      conversationId,
      setConversation,
      hydrateHistory,
      inflightId,
      getInflightId,
      handleWsEvent,
    ],
  );
}

export default useChatStream;
