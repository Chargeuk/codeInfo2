import type { LogLevel } from '@codeinfo2/common';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';
import { createLogger } from '../logging/logger';
import type { ChatWsToolEvent, ChatWsTranscriptEvent } from './useChatWs';
import type { InflightSnapshot } from './useConversationTurns';

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

export type TurnUsageMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
};

export type TurnTimingMetadata = {
  totalTimeSec?: number;
  tokensPerSecond?: number;
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
  warnings?: string[];
  command?: { name: string; stepIndex: number; totalSteps: number };
  kind?: 'error' | 'status';
  think?: string;
  thinkStreaming?: boolean;
  usage?: TurnUsageMetadata;
  timing?: TurnTimingMetadata;
  citations?: ToolCitation[];
  tools?: ToolCall[];
  segments?: ChatSegment[];
  streamStatus?: 'processing' | 'complete' | 'failed';
  thinking?: boolean;
  createdAt?: string;
};

type Status = 'idle' | 'sending';

const API_BASE = getApiBaseUrl();

const DEFAULT_SANDBOX_MODE: SandboxMode = 'workspace-write';
const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = 'on-failure';
const DEFAULT_NETWORK_ACCESS_ENABLED = true;
const DEFAULT_WEB_SEARCH_ENABLED = true;
const DEFAULT_MODEL_REASONING_EFFORT: ModelReasoningEffort = 'high';
const HYDRATION_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

const normalizeMessageContent = (value: string) =>
  value.trim().replace(/\s+/g, ' ');

const parseTimestamp = (value?: string) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizeUsage = (
  usage: TurnUsageMetadata | undefined,
): TurnUsageMetadata | undefined => {
  if (!usage) return undefined;
  const cleaned: TurnUsageMetadata = {};
  if (isFiniteNumber(usage.inputTokens) && usage.inputTokens >= 0) {
    cleaned.inputTokens = usage.inputTokens;
  }
  if (isFiniteNumber(usage.outputTokens) && usage.outputTokens >= 0) {
    cleaned.outputTokens = usage.outputTokens;
  }
  if (isFiniteNumber(usage.totalTokens) && usage.totalTokens >= 0) {
    cleaned.totalTokens = usage.totalTokens;
  }
  if (isFiniteNumber(usage.cachedInputTokens) && usage.cachedInputTokens >= 0) {
    cleaned.cachedInputTokens = usage.cachedInputTokens;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

const normalizeTiming = (
  timing: TurnTimingMetadata | undefined,
): TurnTimingMetadata | undefined => {
  if (!timing) return undefined;
  const cleaned: TurnTimingMetadata = {};
  if (isFiniteNumber(timing.totalTimeSec) && timing.totalTimeSec >= 0) {
    cleaned.totalTimeSec = timing.totalTimeSec;
  }
  if (isFiniteNumber(timing.tokensPerSecond) && timing.tokensPerSecond >= 0) {
    cleaned.tokensPerSecond = timing.tokensPerSecond;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

const normalizeCommand = (
  command:
    | { name?: string; stepIndex?: number; totalSteps?: number }
    | undefined,
): ChatMessage['command'] | undefined => {
  if (!command) return undefined;
  if (typeof command.name !== 'string' || command.name.trim().length === 0) {
    return undefined;
  }
  if (!isFiniteNumber(command.stepIndex) || command.stepIndex < 0) {
    return undefined;
  }
  if (!isFiniteNumber(command.totalSteps) || command.totalSteps < 0) {
    return undefined;
  }
  return {
    name: command.name,
    stepIndex: command.stepIndex,
    totalSteps: command.totalSteps,
  };
};

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
  const inflightSeqRef = useRef<number>(0);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const assistantMessageIdByInflightIdRef = useRef<Map<string, string>>(
    new Map(),
  );
  const toolCallsRef = useRef<Map<string, ToolCall>>(new Map());
  const segmentsRef = useRef<ChatSegment[]>([]);
  const assistantTextRef = useRef('');
  const assistantThinkRef = useRef('');
  const assistantCitationsRef = useRef<ToolCitation[]>([]);
  const assistantWarningsRef = useRef<string[]>([]);

  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    assistantMessageIdByInflightIdRef.current.clear();
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

  const ensureAssistantMessage = useCallback(
    (options?: { forceNew?: boolean; inflightId?: string | null }) => {
      const inflightKey = options?.inflightId ?? null;
      let assistantId: string | null = inflightKey
        ? (assistantMessageIdByInflightIdRef.current.get(inflightKey) ?? null)
        : null;

      if (options?.forceNew) {
        assistantId = null;
      }

      if (!assistantId && !inflightKey) {
        assistantId = activeAssistantMessageIdRef.current;
      }

      // Only reuse the most recent processing assistant bubble when we are not
      // explicitly targeting an inflightId (prevents inflight cross-talk).
      if (!assistantId && !inflightKey) {
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
        assistantWarningsRef.current = [];
        if (inflightKey) {
          assistantMessageIdByInflightIdRef.current.set(
            inflightKey,
            assistantId,
          );
        }
        updateMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: '',
            warnings: undefined,
            segments: segmentsRef.current,
            streamStatus: 'processing',
            thinking: false,
            createdAt: new Date().toISOString(),
          },
        ]);
      } else {
        activeAssistantMessageIdRef.current = assistantId;
        if (
          inflightKey &&
          !assistantMessageIdByInflightIdRef.current.has(inflightKey)
        ) {
          assistantMessageIdByInflightIdRef.current.set(
            inflightKey,
            assistantId,
          );
        }
      }

      return assistantId;
    },
    [updateMessages],
  );

  const syncAssistantMessage = useCallback(
    (
      updates?: Partial<ChatMessage>,
      options?: { assistantId?: string | null; useRefs?: boolean },
    ) => {
      const assistantId =
        options?.assistantId ?? activeAssistantMessageIdRef.current;
      if (!assistantId) return;

      if (options?.useRefs === false) {
        updateMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, ...(updates ?? {}) } : msg,
          ),
        );
        return;
      }

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
            warnings:
              assistantWarningsRef.current.length > 0
                ? assistantWarningsRef.current
                : undefined,
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
    const resultsPayload =
      result && typeof result === 'object' && 'results' in result
        ? (result as { results?: unknown }).results
        : undefined;

    if (Array.isArray(resultsPayload)) {
      const citationsFromResults = resultsPayload
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

      if (citationsFromResults.length > 0) {
        return citationsFromResults;
      }
    }

    const segmentsPayload =
      result && typeof result === 'object' && 'segments' in result
        ? (result as { segments?: unknown }).segments
        : undefined;

    if (!Array.isArray(segmentsPayload)) return [];

    const vectorSummaryCitations = segmentsPayload.flatMap((segment) => {
      if (!segment || typeof segment !== 'object') return [];
      const record = segment as Record<string, unknown>;
      if (record.type !== 'vector_summary') return [];
      const files = Array.isArray(record.files)
        ? (record.files as unknown[])
        : [];
      return files
        .map((file) => {
          if (!file || typeof file !== 'object') return null;
          const f = file as Record<string, unknown>;
          const repo = typeof f.repo === 'string' ? f.repo : undefined;
          const relPath =
            typeof f.relPath === 'string'
              ? f.relPath
              : typeof f.path === 'string'
                ? f.path
                : undefined;
          if (!repo || !relPath) return null;

          const match = typeof f.match === 'number' ? f.match : null;
          const chunks = typeof f.chunks === 'number' ? f.chunks : null;
          const lines = typeof f.lines === 'number' ? f.lines : null;
          const summaryParts = [
            match === null ? null : `match ${match.toFixed(3)}`,
            chunks === null ? null : `chunks ${chunks}`,
            lines === null ? null : `lines ${lines}`,
          ].filter(Boolean);

          return {
            repo,
            relPath,
            hostPath: typeof f.path === 'string' ? f.path : undefined,
            score: match,
            chunk:
              summaryParts.length > 0
                ? summaryParts.join(' · ')
                : 'vector search match',
            chunkId:
              typeof f.path === 'string'
                ? `${repo}:${f.path}`
                : `${repo}:${relPath}`,
            modelId: typeof f.modelId === 'string' ? f.modelId : undefined,
          } satisfies ToolCitation;
        })
        .filter(Boolean) as ToolCitation[];
    });

    return vectorSummaryCitations;
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
    inflightSeqRef.current = 0;
    activeAssistantMessageIdRef.current = null;
    toolCallsRef.current = new Map();
    segmentsRef.current = [];
    assistantTextRef.current = '';
    assistantThinkRef.current = '';
    assistantCitationsRef.current = [];
    assistantWarningsRef.current = [];
    clearThinkingTimer();
    setIsStreaming(false);
    setStatus('idle');
  }, [clearThinkingTimer]);

  const resetAssistantPointer = useCallback(() => {
    activeAssistantMessageIdRef.current = null;
    toolCallsRef.current = new Map();
    segmentsRef.current = [];
    assistantTextRef.current = '';
    assistantThinkRef.current = '';
    assistantCitationsRef.current = [];
    assistantWarningsRef.current = [];
    clearThinkingTimer();
  }, [clearThinkingTimer]);

  const stop = useCallback(
    (options?: { showStatusBubble?: boolean }) => {
      clearThinkingTimer();
      setIsStreaming(false);
      setStatus('idle');
      markAssistantThinking(false);
      syncAssistantMessage(
        { thinkStreaming: false, thinking: false },
        { useRefs: false },
      );

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
    [
      clearThinkingTimer,
      markAssistantThinking,
      syncAssistantMessage,
      updateMessages,
    ],
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

      let shouldResetInflight = false;
      updateMessages((prev) => {
        const hasInFlight =
          isStreaming ||
          status === 'sending' ||
          inflightIdRef.current !== null ||
          prev.some((message) => message.streamStatus === 'processing');
        let filteredHistory = history;
        let nextPrev = prev;
        if (hasInFlight && history.length > 0 && prev.length > 0) {
          const candidates = prev.slice(-6);
          const replacements = new Map<string, ChatMessage>();
          filteredHistory = history.filter((entry) => {
            const match = candidates.find((existing) => {
              if (existing.role !== entry.role) return false;
              const entryContent = normalizeMessageContent(entry.content ?? '');
              const existingContent = normalizeMessageContent(
                existing.content ?? '',
              );
              if (!entryContent && !existingContent) return false;
              const entryTime = parseTimestamp(entry.createdAt);
              const existingTime = parseTimestamp(existing.createdAt);
              const withinWindow =
                entryTime !== null &&
                existingTime !== null &&
                Math.abs(entryTime - existingTime) <=
                  HYDRATION_DEDUPE_WINDOW_MS;
              if (entryContent === existingContent) {
                return withinWindow || existing.streamStatus === 'processing';
              }
              if (
                existing.streamStatus === 'processing' &&
                entryContent.startsWith(existingContent)
              ) {
                return true;
              }
              return false;
            });
            if (!match) return true;
            if (match.streamStatus === 'processing') {
              replacements.set(match.id, {
                ...match,
                ...entry,
                id: match.id,
                segments: entry.segments,
              });
              if (entry.streamStatus && entry.streamStatus !== 'processing') {
                shouldResetInflight = true;
              }
              return false;
            }
            replacements.set(match.id, {
              ...match,
              ...entry,
              id: match.id,
              segments: entry.segments,
            });
            return false;
          });
          if (replacements.size > 0) {
            nextPrev = prev.map((message) => {
              const replacement = replacements.get(message.id);
              return replacement ?? message;
            });
          }
        }
        const next =
          mode === 'prepend' || hasInFlight
            ? [...filteredHistory, ...nextPrev]
            : [...filteredHistory];
        const seen = new Set<string>();
        return next.filter((msg) => {
          const key = msg.id;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });

      if (shouldResetInflight) {
        resetInflightState();
      }
    },
    [isStreaming, resetInflightState, status, updateMessages],
  );

  const hydrateInflightSnapshot = useCallback(
    (historyConversationId: string, inflight: InflightSnapshot | null) => {
      if (!inflight) return;

      if (inflight.seq < inflightSeqRef.current) {
        return;
      }

      inflightSeqRef.current = inflight.seq;
      conversationIdRef.current = historyConversationId;
      setConversationId(historyConversationId);

      const assistantId = ensureAssistantMessage({
        inflightId: inflight.inflightId,
      });

      const startedAt =
        parseTimestamp(inflight.startedAt) !== null
          ? inflight.startedAt
          : undefined;
      const normalizedCommand = normalizeCommand(inflight.command);

      inflightIdRef.current = inflight.inflightId;
      setInflightId(inflight.inflightId);
      assistantTextRef.current = inflight.assistantText;
      assistantThinkRef.current = inflight.assistantThink;
      toolCallsRef.current = new Map();
      segmentsRef.current = [
        { id: makeId(), kind: 'text', content: assistantTextRef.current },
      ];
      assistantCitationsRef.current = [];
      assistantWarningsRef.current = [];

      inflight.toolEvents.forEach((toolEvent) => applyToolEvent(toolEvent));

      if (segmentsRef.current.length === 0) {
        segmentsRef.current = [{ id: makeId(), kind: 'text', content: '' }];
      }

      setIsStreaming(true);
      syncAssistantMessage(
        {
          streamStatus: 'processing',
          ...(startedAt ? { createdAt: startedAt } : {}),
          ...(normalizedCommand ? { command: normalizedCommand } : {}),
        },
        { assistantId },
      );
    },
    [applyToolEvent, ensureAssistantMessage, syncAssistantMessage],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === 'sending' || !model || !provider) {
        return;
      }

      const prevAssistantMessageId = activeAssistantMessageIdRef.current;

      stop();

      const lastMessage = messagesRef.current[messagesRef.current.length - 1];
      logWithChannel('info', 'chat.client_send_begin', {
        status,
        isStreaming,
        inflightId: inflightIdRef.current,
        activeAssistantMessageId: prevAssistantMessageId,
        lastMessageStreamStatus: lastMessage?.streamStatus ?? null,
        lastMessageContentLen: (lastMessage?.content ?? '').length,
      });

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

      const nextAssistantMessageId = ensureAssistantMessage({
        inflightId: nextInflightId,
        forceNew: true,
      });
      logWithChannel('info', 'chat.client_send_after_reset', {
        prevAssistantMessageId,
        nextAssistantMessageId,
        createdNewAssistant: nextAssistantMessageId !== prevAssistantMessageId,
      });
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
      isStreaming,
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
        logWithChannel('info', 'chat.ws.client_event_ignored', {
          reason: 'conversation_mismatch',
          eventConversationId: event.conversationId,
          activeConversationId: activeConversation,
          eventType: event.type,
        });
        return;
      }

      inflightSeqRef.current = Math.max(inflightSeqRef.current, event.seq);

      if (event.type === 'user_turn') {
        const nextInflightId =
          typeof event.inflightId === 'string' && event.inflightId
            ? event.inflightId
            : null;

        const prevInflightId = inflightIdRef.current;
        const assistantMessageIdBefore = activeAssistantMessageIdRef.current;

        const shouldResetAssistantPointer =
          nextInflightId !== null &&
          prevInflightId !== null &&
          nextInflightId !== prevInflightId &&
          status !== 'sending';

        if (shouldResetAssistantPointer) {
          resetAssistantPointer();
          logWithChannel('info', 'chat.ws.client_reset_assistant', {
            conversationId: event.conversationId,
            prevInflightId,
            inflightId: nextInflightId,
            assistantMessageIdBefore,
          });
        }

        if (nextInflightId) {
          inflightIdRef.current = nextInflightId;
          setInflightId(nextInflightId);
        }

        inflightSeqRef.current = Math.max(inflightSeqRef.current, event.seq);

        const assistantMessageIdAfter = ensureAssistantMessage({
          inflightId: nextInflightId,
        });
        logWithChannel('info', 'chat.ws.client_user_turn', {
          conversationId: event.conversationId,
          inflightId: nextInflightId,
          prevInflightId,
          assistantMessageIdBefore,
          assistantMessageIdAfter,
          resetAssistantPointer: shouldResetAssistantPointer,
        });

        const normalizedIncoming = normalizeMessageContent(event.content ?? '');
        const nowTimestamp = new Date().getTime();
        const incomingTimestamp = parseTimestamp(event.createdAt);
        const assistantId = activeAssistantMessageIdRef.current;

        updateMessages((prev) => {
          if (!normalizedIncoming) return prev;

          for (
            let i = prev.length - 1;
            i >= 0 && i >= prev.length - 8;
            i -= 1
          ) {
            const existing = prev[i];
            if (existing?.role !== 'user') continue;
            if (
              normalizeMessageContent(existing.content ?? '') !==
              normalizedIncoming
            ) {
              continue;
            }

            const existingTimestamp = parseTimestamp(existing.createdAt);

            const withinHydrationWindow =
              existingTimestamp !== null && incomingTimestamp !== null
                ? Math.abs(existingTimestamp - incomingTimestamp) <=
                  HYDRATION_DEDUPE_WINDOW_MS
                : false;

            const existingIsRecent =
              existingTimestamp !== null
                ? nowTimestamp - existingTimestamp <= 60_000
                : false;

            if (!withinHydrationWindow && !existingIsRecent) continue;

            if (existing.createdAt === event.createdAt) return prev;
            const next = [...prev];
            next[i] = { ...existing, createdAt: event.createdAt };
            return next;
          }

          const userMessage: ChatMessage = {
            id: makeId(),
            role: 'user',
            content: event.content,
            createdAt: event.createdAt,
          };

          const last = prev[prev.length - 1];
          if (
            assistantId &&
            last?.id === assistantId &&
            last.role === 'assistant' &&
            last.streamStatus === 'processing'
          ) {
            return [...prev.slice(0, -1), userMessage, last];
          }

          return [...prev, userMessage];
        });

        setIsStreaming(true);
        return;
      }

      const currentInflightId = inflightIdRef.current;

      if (event.type === 'inflight_snapshot') {
        const eventInflightId = event.inflight.inflightId;
        const assistantId = ensureAssistantMessage({
          inflightId: eventInflightId,
        });

        const normalizedCommand = normalizeCommand(event.inflight.command);
        const startedAt =
          parseTimestamp(event.inflight.startedAt) !== null
            ? event.inflight.startedAt
            : undefined;
        const inflightUpdates: Partial<ChatMessage> = {
          streamStatus: 'processing',
          ...(startedAt ? { createdAt: startedAt } : {}),
          ...(normalizedCommand ? { command: normalizedCommand } : {}),
        };

        if (normalizedCommand) {
          logWithChannel('info', 'DEV-0000024:T8:ws_inflight_command', {
            conversationId: event.conversationId,
            inflightId: eventInflightId,
            command: normalizedCommand,
          });
        }

        const inflightMismatch =
          currentInflightId !== null && eventInflightId !== currentInflightId;

        if (inflightMismatch && status === 'sending') {
          syncAssistantMessage(inflightUpdates, {
            assistantId,
            useRefs: false,
          });
          return;
        }

        inflightIdRef.current = eventInflightId;
        setInflightId(eventInflightId);
        inflightSeqRef.current = Math.max(inflightSeqRef.current, event.seq);
        assistantTextRef.current = event.inflight.assistantText;
        assistantThinkRef.current = event.inflight.assistantThink;
        toolCallsRef.current = new Map();
        segmentsRef.current = [
          { id: makeId(), kind: 'text', content: assistantTextRef.current },
        ];
        assistantCitationsRef.current = [];
        assistantWarningsRef.current = [];
        event.inflight.toolEvents.forEach((toolEvent) =>
          applyToolEvent(toolEvent),
        );
        if (segmentsRef.current.length === 0) {
          segmentsRef.current = [{ id: makeId(), kind: 'text', content: '' }];
        }
        setIsStreaming(true);
        syncAssistantMessage(inflightUpdates, { assistantId });
        return;
      }

      const eventInflightId = event.inflightId;
      const preMappedAssistantId =
        assistantMessageIdByInflightIdRef.current.get(eventInflightId) ?? null;
      const assistantId = ensureAssistantMessage({
        inflightId: eventInflightId,
      });
      const inflightMismatch =
        currentInflightId !== null && eventInflightId !== currentInflightId;

      if (event.type === 'assistant_delta') {
        if (inflightMismatch && status === 'sending') {
          updateMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: (msg.content ?? '') + event.delta }
                : msg,
            ),
          );
          return;
        }

        inflightIdRef.current = eventInflightId;
        setInflightId(eventInflightId);
        inflightSeqRef.current = Math.max(inflightSeqRef.current, event.seq);
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
        syncAssistantMessage({ streamStatus: 'processing' }, { assistantId });
        return;
      }

      if (event.type === 'stream_warning') {
        if (inflightMismatch && status === 'sending') {
          return;
        }

        inflightIdRef.current = eventInflightId;
        setInflightId(eventInflightId);
        inflightSeqRef.current = Math.max(inflightSeqRef.current, event.seq);
        if (
          event.message &&
          !assistantWarningsRef.current.includes(event.message)
        ) {
          assistantWarningsRef.current = [
            ...assistantWarningsRef.current,
            event.message,
          ];
        }
        setIsStreaming(true);
        syncAssistantMessage({ streamStatus: 'processing' }, { assistantId });
        return;
      }

      if (event.type === 'analysis_delta') {
        if (inflightMismatch && status === 'sending') {
          return;
        }

        inflightIdRef.current = eventInflightId;
        setInflightId(eventInflightId);
        inflightSeqRef.current = Math.max(inflightSeqRef.current, event.seq);
        assistantThinkRef.current += event.delta;
        setIsStreaming(true);
        syncAssistantMessage({ streamStatus: 'processing' }, { assistantId });
        return;
      }

      if (event.type === 'tool_event') {
        if (inflightMismatch && status === 'sending') {
          return;
        }

        inflightIdRef.current = eventInflightId;
        setInflightId(eventInflightId);
        inflightSeqRef.current = Math.max(inflightSeqRef.current, event.seq);
        applyToolEvent(event.event);
        setIsStreaming(true);
        syncAssistantMessage({ streamStatus: 'processing' }, { assistantId });
        return;
      }

      if (event.type === 'turn_final') {
        inflightSeqRef.current = Math.max(inflightSeqRef.current, event.seq);
        if (event.threadId !== undefined) {
          setThreadId(event.threadId ?? null);
          threadIdRef.current = event.threadId ?? null;
        }

        const usage = normalizeUsage(event.usage);
        const timing = normalizeTiming(event.timing);
        const metadataUpdates: Partial<ChatMessage> = {
          ...(usage ? { usage } : {}),
          ...(timing ? { timing } : {}),
        };

        if (usage || timing) {
          logWithChannel('info', 'DEV-0000024:T8:ws_usage_applied', {
            conversationId: event.conversationId,
            inflightId: event.inflightId,
            hasUsage: Boolean(usage),
            hasTiming: Boolean(timing),
          });
        }

        const streamStatus: ChatMessage['streamStatus'] =
          event.status === 'failed' ? 'failed' : 'complete';

        logWithChannel('info', 'chat.client_turn_final_sync', {
          inflightId: event.inflightId,
          assistantMessageId: assistantId,
          assistantTextLen: assistantTextRef.current.length,
          streamStatus,
          inflightMismatch,
        });

        assistantMessageIdByInflightIdRef.current.delete(event.inflightId);

        const isOutOfBandFinal =
          preMappedAssistantId !== null &&
          currentInflightId !== eventInflightId;

        if (inflightMismatch || isOutOfBandFinal) {
          syncAssistantMessage(
            {
              streamStatus,
              thinking: false,
              thinkStreaming: false,
              ...(event.status === 'failed' ? { kind: 'error' as const } : {}),
              ...metadataUpdates,
            },
            { assistantId, useRefs: false },
          );
          return;
        }

        inflightIdRef.current = eventInflightId;
        setInflightId(eventInflightId);

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

        syncAssistantMessage(
          {
            streamStatus,
            thinking: false,
            thinkStreaming: false,
            ...(event.status === 'failed' ? { kind: 'error' as const } : {}),
            ...metadataUpdates,
          },
          { assistantId },
        );
      }
    },
    [
      applyToolEvent,
      clearThinkingTimer,
      ensureAssistantMessage,
      logWithChannel,
      resetAssistantPointer,
      status,
      syncAssistantMessage,
      updateMessages,
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
      hydrateInflightSnapshot,
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
      hydrateInflightSnapshot,
      inflightId,
      getInflightId,
      handleWsEvent,
    ],
  );
}

export default useChatStream;
