import { type CodexDefaults, type LogLevel } from '@codeinfo2/common';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';
import { createLogger } from '../logging/logger';
import { normalizeReasoningCapabilityStrings } from '../utils/reasoningCapabilities';
import type {
  ChatWsCancelAckEvent,
  ChatWsToolEvent,
  ChatWsTranscriptEvent,
} from './useChatWs';
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

export type ModelReasoningEffort = string;

export type CodexFlagState = {
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalPolicy;
  networkAccessEnabled?: boolean;
  webSearchEnabled?: boolean;
  modelReasoningEffort?: ModelReasoningEffort;
};

// Fallbacks used only when codexDefaults are unavailable; keep in sync with server defaults.
const DEFAULT_CODEX_FLAGS: Required<CodexFlagState> = {
  sandboxMode: 'danger-full-access',
  approvalPolicy: 'on-failure',
  modelReasoningEffort: 'high',
  networkAccessEnabled: true,
  webSearchEnabled: true,
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
  command?: {
    name: string;
    stepIndex: number;
    totalSteps: number;
    loopDepth?: number;
    label?: string;
    agentType?: string;
    identifier?: string;
  };
  kind?: 'error' | 'status';
  think?: string;
  thinkStreaming?: boolean;
  usage?: TurnUsageMetadata;
  timing?: TurnTimingMetadata;
  citations?: ToolCitation[];
  tools?: ToolCall[];
  segments?: ChatSegment[];
  streamStatus?: 'processing' | 'complete' | 'failed' | 'stopped';
  thinking?: boolean;
  createdAt?: string;
};

type Status = 'idle' | 'sending' | 'stopping';

const API_BASE = getApiBaseUrl();

const HYDRATION_DEDUPE_WINDOW_MS = 30 * 60 * 1000;
const DEV_0000037_T02_PREFIX = '[DEV-0000037][T02]';
const DEV_0000037_T17_PREFIX = '[DEV-0000037][T17]';

type SelectedModelReasoningCapabilities = {
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
};

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
    | {
        name?: string;
        stepIndex?: number;
        totalSteps?: number;
        loopDepth?: number;
        label?: string;
        agentType?: string;
        identifier?: string;
      }
    | undefined,
): ChatMessage['command'] | undefined => {
  if (!command) return undefined;
  const name = typeof command.name === 'string' ? command.name.trim() : '';
  if (!name) {
    return undefined;
  }
  if (!isFiniteNumber(command.stepIndex) || command.stepIndex < 0) {
    return undefined;
  }
  if (!isFiniteNumber(command.totalSteps) || command.totalSteps < 0) {
    return undefined;
  }
  const normalized: ChatMessage['command'] = {
    name,
    stepIndex: command.stepIndex,
    totalSteps: command.totalSteps,
  };
  if (isFiniteNumber(command.loopDepth) && command.loopDepth >= 0) {
    normalized.loopDepth = command.loopDepth;
  }
  const label = typeof command.label === 'string' ? command.label.trim() : '';
  if (label) {
    normalized.label = label;
  }
  const agentType =
    typeof command.agentType === 'string' ? command.agentType.trim() : '';
  if (agentType) {
    normalized.agentType = agentType;
  }
  const identifier =
    typeof command.identifier === 'string' ? command.identifier.trim() : '';
  if (identifier) {
    normalized.identifier = identifier;
  }
  return normalized;
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
  codexDefaults?: CodexDefaults,
  selectedModelCapabilities?: SelectedModelReasoningCapabilities,
) {
  const log = useRef(createLogger('client')).current;
  const flowLog = useRef(createLogger('client-flows')).current;
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
  const statusRef = useRef<Status>('idle');
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
  const historicalAssistantMessageIdByInflightIdRef = useRef<
    Map<string, string>
  >(new Map());
  const seenInflightIdsRef = useRef<Set<string>>(new Set());
  const confirmedInflightIdsRef = useRef<Set<string>>(new Set());
  const finalizedInflightIdsRef = useRef<Set<string>>(new Set());
  const stopRequestIdRef = useRef<string | null>(null);
  const stopInflightIdRef = useRef<string | null>(null);
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
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    assistantMessageIdByInflightIdRef.current.clear();
    historicalAssistantMessageIdByInflightIdRef.current.clear();
    seenInflightIdsRef.current.clear();
    confirmedInflightIdsRef.current.clear();
    finalizedInflightIdsRef.current.clear();
    stopRequestIdRef.current = null;
    stopInflightIdRef.current = null;
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

  const rememberSeenInflightId = useCallback((inflightId: string | null) => {
    if (!inflightId) return;
    seenInflightIdsRef.current.add(inflightId);
  }, []);

  const rememberConfirmedInflightId = useCallback(
    (nextInflightId: string | null) => {
      if (!nextInflightId) return;
      confirmedInflightIdsRef.current.add(nextInflightId);
    },
    [],
  );

  const getExistingAssistantMessageIdForInflight = useCallback(
    (targetInflightId: string | null) => {
      if (!targetInflightId) return null;
      const assistantId =
        assistantMessageIdByInflightIdRef.current.get(targetInflightId) ??
        historicalAssistantMessageIdByInflightIdRef.current.get(
          targetInflightId,
        ) ??
        null;
      if (!assistantId) return null;
      const stillVisible = messagesRef.current.some(
        (message) => message.id === assistantId && message.role === 'assistant',
      );
      return stillVisible ? assistantId : null;
    },
    [],
  );

  const clearPendingStop = useCallback(() => {
    stopRequestIdRef.current = null;
    stopInflightIdRef.current = null;
  }, []);

  const logHiddenRunEventIgnored = useCallback(
    (
      eventType: string,
      hiddenConversationId: string,
      visibleConversationId: string | null,
      reason: string,
    ) => {
      console.info('DEV-0000046:T11:hidden-run-event-ignored', {
        eventType,
        hiddenConversationId,
        visibleConversationId,
        reason,
      });
    },
    [],
  );

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

  const removePendingAssistantIfOptimistic = useCallback(
    (targetInflightId: string | null) => {
      const assistantId =
        targetInflightId === null
          ? activeAssistantMessageIdRef.current
          : (assistantMessageIdByInflightIdRef.current.get(targetInflightId) ??
            activeAssistantMessageIdRef.current);
      if (!assistantId) return;

      updateMessages((prev) => {
        const assistantMessage = prev.find(
          (message) => message.id === assistantId,
        );
        if (!assistantMessage || assistantMessage.role !== 'assistant') {
          return prev;
        }

        const hasVisibleContent =
          assistantMessage.content.trim().length > 0 ||
          Boolean(assistantMessage.tools?.length) ||
          Boolean(assistantMessage.warnings?.length) ||
          Boolean(assistantMessage.command) ||
          Boolean(assistantMessage.think?.trim().length);

        if (hasVisibleContent) {
          return prev;
        }

        return prev.filter((message) => message.id !== assistantId);
      });

      if (targetInflightId) {
        assistantMessageIdByInflightIdRef.current.delete(targetInflightId);
      }
      if (activeAssistantMessageIdRef.current === assistantId) {
        activeAssistantMessageIdRef.current = null;
      }
    },
    [updateMessages],
  );

  const enterStoppingState = useCallback(
    (options?: { requestId?: string | null }) => {
      if (options?.requestId) {
        stopRequestIdRef.current = options.requestId;
      }
      stopInflightIdRef.current = inflightIdRef.current;
      if (statusRef.current === 'stopping') return;
      statusRef.current = 'stopping';
      setStatus('stopping');
      console.info('[stop-debug][stream-state] stopping', {
        conversationId: conversationIdRef.current,
        inflightId: inflightIdRef.current,
      });
    },
    [],
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
        const resolvedAssistantId = makeId();
        assistantId = resolvedAssistantId;
        activeAssistantMessageIdRef.current = resolvedAssistantId;
        segmentsRef.current = [{ id: makeId(), kind: 'text', content: '' }];
        toolCallsRef.current = new Map();
        assistantTextRef.current = '';
        assistantThinkRef.current = '';
        assistantCitationsRef.current = [];
        assistantWarningsRef.current = [];
        if (inflightKey) {
          assistantMessageIdByInflightIdRef.current.set(
            inflightKey,
            resolvedAssistantId,
          );
          historicalAssistantMessageIdByInflightIdRef.current.set(
            inflightKey,
            resolvedAssistantId,
          );
        }
        updateMessages((prev) => [
          ...prev,
          {
            id: resolvedAssistantId,
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
        if (inflightKey) {
          historicalAssistantMessageIdByInflightIdRef.current.set(
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
    statusRef.current = 'idle';
    setStatus('idle');
    clearPendingStop();
  }, [clearPendingStop, clearThinkingTimer]);

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
    (options?: { requestId?: string | null; showStatusBubble?: boolean }) => {
      clearThinkingTimer();
      markAssistantThinking(false);
      syncAssistantMessage(
        { thinkStreaming: false, thinking: false },
        { useRefs: false },
      );
      enterStoppingState({ requestId: options?.requestId ?? null });
    },
    [
      clearThinkingTimer,
      enterStoppingState,
      markAssistantThinking,
      syncAssistantMessage,
    ],
  );

  const clearLocalStreamingIndicators = useCallback(() => {
    clearThinkingTimer();
    markAssistantThinking(false);
    syncAssistantMessage(
      { thinkStreaming: false, thinking: false },
      { useRefs: false },
    );
  }, [clearThinkingTimer, markAssistantThinking, syncAssistantMessage]);

  const reset = useCallback(() => {
    updateMessages(() => []);
    resetInflightState();
    setThreadId(null);
    threadIdRef.current = null;
    assistantMessageIdByInflightIdRef.current.clear();
    historicalAssistantMessageIdByInflightIdRef.current.clear();
    seenInflightIdsRef.current.clear();
    confirmedInflightIdsRef.current.clear();
    finalizedInflightIdsRef.current.clear();
    const nextConversationId = makeId();
    setConversationId(nextConversationId);
    conversationIdRef.current = nextConversationId;
    return nextConversationId;
  }, [resetInflightState, updateMessages]);

  const setConversation = useCallback(
    (nextConversationId: string, options?: { clearMessages?: boolean }) => {
      clearLocalStreamingIndicators();
      resetInflightState();
      if (options?.clearMessages) {
        updateMessages(() => []);
      }
      setThreadId(null);
      threadIdRef.current = null;
      assistantMessageIdByInflightIdRef.current.clear();
      historicalAssistantMessageIdByInflightIdRef.current.clear();
      seenInflightIdsRef.current.clear();
      confirmedInflightIdsRef.current.clear();
      finalizedInflightIdsRef.current.clear();
      setConversationId(nextConversationId);
      conversationIdRef.current = nextConversationId;
    },
    [clearLocalStreamingIndicators, resetInflightState, updateMessages],
  );

  const hydrateHistory = useCallback(
    (
      historyConversationId: string,
      history: ChatMessage[],
      mode: 'replace' | 'prepend' = 'replace',
    ) => {
      const sameConversation =
        conversationIdRef.current === historyConversationId;
      const hasActiveInflight =
        inflightIdRef.current !== null ||
        isStreaming ||
        status === 'sending' ||
        messagesRef.current.some(
          (message) => message.streamStatus === 'processing',
        );

      if (!sameConversation) {
        assistantMessageIdByInflightIdRef.current.clear();
        historicalAssistantMessageIdByInflightIdRef.current.clear();
        seenInflightIdsRef.current.clear();
        finalizedInflightIdsRef.current.clear();
      } else if (!hasActiveInflight) {
        assistantMessageIdByInflightIdRef.current.clear();
      }
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
              const entryContent = entry.content ?? '';
              const existingContent = existing.content ?? '';
              const existingHasContent = existingContent.length > 0;
              if (!entryContent && !existingContent) return false;
              const entryTime = parseTimestamp(entry.createdAt);
              const existingTime = parseTimestamp(existing.createdAt);
              const withinWindow =
                entryTime !== null &&
                existingTime !== null &&
                Math.abs(entryTime - existingTime) <=
                  HYDRATION_DEDUPE_WINDOW_MS;
              if (entryContent === existingContent) {
                return (
                  withinWindow ||
                  (existing.streamStatus === 'processing' && existingHasContent)
                );
              }
              if (
                existing.streamStatus === 'processing' &&
                existingHasContent &&
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

  const logFlowCommand = useCallback(
    (command: ChatMessage['command'] | undefined) => {
      if (!command || command.name !== 'flow') return;
      if (!command.label) return;
      flowLog('info', 'flows.metadata.normalized', {
        stepIndex: command.stepIndex,
        label: command.label,
      });
    },
    [flowLog],
  );

  const hydrateInflightSnapshot = useCallback(
    (historyConversationId: string, inflight: InflightSnapshot | null) => {
      if (!inflight) return;

      const sameConversation =
        conversationIdRef.current === historyConversationId;
      const activeInflightId = inflightIdRef.current;
      const seenInflightId = seenInflightIdsRef.current.has(
        inflight.inflightId,
      );
      const sameInflight = activeInflightId === inflight.inflightId;
      const staleOlderInflightReplay =
        sameConversation &&
        activeInflightId !== null &&
        !sameInflight &&
        seenInflightId;
      const duplicateActiveSnapshot =
        sameConversation &&
        sameInflight &&
        inflight.seq <= inflightSeqRef.current;

      if (staleOlderInflightReplay || duplicateActiveSnapshot) {
        return;
      }

      inflightSeqRef.current = inflight.seq;
      if (!sameConversation) {
        assistantMessageIdByInflightIdRef.current.clear();
        historicalAssistantMessageIdByInflightIdRef.current.clear();
        seenInflightIdsRef.current.clear();
        finalizedInflightIdsRef.current.clear();
      }
      conversationIdRef.current = historyConversationId;
      setConversationId(historyConversationId);
      rememberSeenInflightId(inflight.inflightId);
      rememberConfirmedInflightId(inflight.inflightId);

      const assistantId = ensureAssistantMessage({
        inflightId: inflight.inflightId,
      });

      const startedAt =
        parseTimestamp(inflight.startedAt) !== null
          ? inflight.startedAt
          : undefined;
      const normalizedCommand = normalizeCommand(inflight.command);
      logFlowCommand(normalizedCommand);

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
          command: normalizedCommand ?? undefined,
        },
        { assistantId },
      );
    },
    [
      applyToolEvent,
      ensureAssistantMessage,
      logFlowCommand,
      rememberConfirmedInflightId,
      rememberSeenInflightId,
      syncAssistantMessage,
    ],
  );

  const send = useCallback(
    async (
      text: string,
      options?: {
        workingFolder?: string;
      },
    ) => {
      const hasNonWhitespaceContent = text.trim().length > 0;
      logWithChannel('info', 'DEV-0000035:T9:chat_raw_send_evaluated', {
        source: 'useChatStream',
        rawLength: text.length,
        trimmedLength: text.trim().length,
        hasNonWhitespaceContent,
        blockedByStatus: status === 'sending',
        blockedByModel: !model,
        blockedByProvider: !provider,
      });

      if (
        !hasNonWhitespaceContent ||
        status === 'sending' ||
        !model ||
        !provider
      ) {
        logWithChannel('info', 'DEV-0000035:T9:chat_raw_send_result', {
          source: 'useChatStream',
          sent: false,
          reason: !hasNonWhitespaceContent
            ? 'whitespace_only'
            : status === 'sending'
              ? 'status_sending'
              : !model
                ? 'missing_model'
                : 'missing_provider',
          rawLength: text.length,
          trimmedLength: text.trim().length,
        });
        return;
      }

      const prevAssistantMessageId = activeAssistantMessageIdRef.current;

      clearLocalStreamingIndicators();

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
      rememberSeenInflightId(nextInflightId);

      statusRef.current = 'sending';
      setStatus('sending');
      setIsStreaming(true);

      const userMessage: ChatMessage = {
        id: makeId(),
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      };

      updateMessages((prev) => [...prev, userMessage]);
      logWithChannel('info', 'DEV-0000035:T9:chat_raw_send_result', {
        source: 'useChatStream',
        sent: true,
        reason: 'dispatching',
        rawLength: text.length,
        trimmedLength: text.trim().length,
      });

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
        const omittedFlags: string[] = [];
        const baseCodexPayload = threadIdRef.current
          ? { threadId: threadIdRef.current }
          : {};
        const codexPayload: Record<string, unknown> =
          provider === 'codex' ? { ...baseCodexPayload } : {};

        if (provider === 'codex') {
          const selectedReasoningEffort =
            typeof codexFlags?.modelReasoningEffort === 'string'
              ? codexFlags.modelReasoningEffort
              : undefined;
          const supportedReasoningEfforts = normalizeReasoningCapabilityStrings(
            selectedModelCapabilities?.supportedReasoningEfforts,
          );
          const defaultReasoningEffort =
            (typeof selectedModelCapabilities?.defaultReasoningEffort ===
              'string' &&
            selectedModelCapabilities.defaultReasoningEffort.trim().length > 0
              ? selectedModelCapabilities.defaultReasoningEffort.trim()
              : undefined) ?? codexDefaults?.modelReasoningEffort;
          const resolvedReasoningEffortCandidate =
            supportedReasoningEfforts.length > 0
              ? supportedReasoningEfforts.includes(
                  selectedReasoningEffort ?? '',
                )
                ? selectedReasoningEffort
                : supportedReasoningEfforts.includes(
                      defaultReasoningEffort ?? '',
                    )
                  ? defaultReasoningEffort
                  : supportedReasoningEfforts[0]
              : undefined;
          const resolvedReasoningEffort =
            resolvedReasoningEffortCandidate &&
            supportedReasoningEfforts.includes(resolvedReasoningEffortCandidate)
              ? resolvedReasoningEffortCandidate
              : undefined;

          if (supportedReasoningEfforts.length === 0) {
            console.error(
              `${DEV_0000037_T17_PREFIX} event=dynamic_reasoning_options_rendered result=error reason=no_supported_reasoning_efforts`,
            );
          }

          const fallbackFlags: Required<CodexFlagState> = {
            sandboxMode:
              codexFlags?.sandboxMode ?? DEFAULT_CODEX_FLAGS.sandboxMode,
            approvalPolicy:
              codexFlags?.approvalPolicy ?? DEFAULT_CODEX_FLAGS.approvalPolicy,
            modelReasoningEffort:
              resolvedReasoningEffort ??
              DEFAULT_CODEX_FLAGS.modelReasoningEffort,
            networkAccessEnabled:
              codexFlags?.networkAccessEnabled ??
              DEFAULT_CODEX_FLAGS.networkAccessEnabled,
            webSearchEnabled:
              codexFlags?.webSearchEnabled ??
              DEFAULT_CODEX_FLAGS.webSearchEnabled,
          };

          if (!codexDefaults) {
            codexPayload.sandboxMode = fallbackFlags.sandboxMode;
            codexPayload.approvalPolicy = fallbackFlags.approvalPolicy;
            if (resolvedReasoningEffort) {
              codexPayload.modelReasoningEffort = resolvedReasoningEffort;
              console.info(
                `${DEV_0000037_T02_PREFIX} event=reasoning_effort_shims_removed result=success`,
              );
              console.info(
                `${DEV_0000037_T17_PREFIX} event=dynamic_reasoning_options_rendered result=success`,
              );
            } else {
              omittedFlags.push('modelReasoningEffort');
            }
            codexPayload.networkAccessEnabled =
              fallbackFlags.networkAccessEnabled;
            codexPayload.webSearchEnabled = fallbackFlags.webSearchEnabled;
            console.info(
              '[codex-payload] defaults missing, sending fallbacks',
              {
                fallbackFlags,
              },
            );
          } else {
            const sandboxMode = codexFlags?.sandboxMode;
            if (sandboxMode && sandboxMode !== codexDefaults.sandboxMode) {
              codexPayload.sandboxMode = sandboxMode;
            } else {
              omittedFlags.push('sandboxMode');
            }

            const approvalPolicy = codexFlags?.approvalPolicy;
            if (
              approvalPolicy &&
              approvalPolicy !== codexDefaults.approvalPolicy
            ) {
              codexPayload.approvalPolicy = approvalPolicy;
            } else {
              omittedFlags.push('approvalPolicy');
            }

            const modelReasoningEffort = resolvedReasoningEffort;
            if (
              modelReasoningEffort &&
              modelReasoningEffort !== codexDefaults.modelReasoningEffort
            ) {
              codexPayload.modelReasoningEffort = modelReasoningEffort;
              console.info(
                `${DEV_0000037_T02_PREFIX} event=reasoning_effort_shims_removed result=success`,
              );
              console.info(
                `${DEV_0000037_T17_PREFIX} event=dynamic_reasoning_options_rendered result=success`,
              );
            } else {
              omittedFlags.push('modelReasoningEffort');
              if (modelReasoningEffort) {
                console.info(
                  `${DEV_0000037_T02_PREFIX} event=reasoning_effort_shims_removed result=success`,
                );
                console.info(
                  `${DEV_0000037_T17_PREFIX} event=dynamic_reasoning_options_rendered result=success`,
                );
              }
            }

            const networkAccessEnabled = codexFlags?.networkAccessEnabled;
            if (
              typeof networkAccessEnabled === 'boolean' &&
              networkAccessEnabled !== codexDefaults.networkAccessEnabled
            ) {
              codexPayload.networkAccessEnabled = networkAccessEnabled;
            } else {
              omittedFlags.push('networkAccessEnabled');
            }

            const webSearchEnabled = codexFlags?.webSearchEnabled;
            if (
              typeof webSearchEnabled === 'boolean' &&
              webSearchEnabled !== codexDefaults.webSearchEnabled
            ) {
              codexPayload.webSearchEnabled = webSearchEnabled;
            } else {
              omittedFlags.push('webSearchEnabled');
            }
          }
        }

        if (provider === 'codex' && omittedFlags.length > 0) {
          console.info('[codex-payload] omitted flags', { omittedFlags });
        }

        const res = await fetch(new URL('/chat', API_BASE).toString(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            provider,
            model,
            conversationId: currentConversationId,
            inflightId: nextInflightId,
            message: text,
            ...(options?.workingFolder?.trim()
              ? { working_folder: options.workingFolder.trim() }
              : {}),
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
          assistantMessageIdByInflightIdRef.current.clear();
          seenInflightIdsRef.current.clear();
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
      codexDefaults,
      codexFlags,
      selectedModelCapabilities,
      ensureAssistantMessage,
      handleErrorBubble,
      logWithChannel,
      model,
      provider,
      resetInflightState,
      scheduleThinkingTimer,
      rememberSeenInflightId,
      status,
      isStreaming,
      clearLocalStreamingIndicators,
      syncAssistantMessage,
      updateMessages,
      conversationId,
    ],
  );

  const handleWsEvent = useCallback(
    (event: ChatWsTranscriptEvent | ChatWsCancelAckEvent) => {
      const activeConversation = conversationIdRef.current;
      if (event.conversationId !== activeConversation) {
        logHiddenRunEventIgnored(
          event.type,
          event.conversationId,
          activeConversation,
          'conversation_mismatch',
        );
        logWithChannel('info', 'chat.ws.client_event_ignored', {
          reason: 'conversation_mismatch',
          eventConversationId: event.conversationId,
          activeConversationId: activeConversation,
          eventType: event.type,
        });
        return;
      }

      if (event.type === 'cancel_ack') {
        if (
          event.result !== 'noop' ||
          statusRef.current !== 'stopping' ||
          stopRequestIdRef.current === null ||
          stopRequestIdRef.current !== event.requestId
        ) {
          logHiddenRunEventIgnored(
            'cancel_ack',
            event.conversationId,
            activeConversation,
            event.result !== 'noop'
              ? 'cancel_ack_not_noop'
              : statusRef.current !== 'stopping'
                ? 'cancel_ack_without_explicit_stop'
                : stopRequestIdRef.current === null
                  ? 'cancel_ack_without_stop_request'
                  : 'cancel_ack_request_mismatch',
          );
          return;
        }

        removePendingAssistantIfOptimistic(stopInflightIdRef.current);
        clearThinkingTimer();
        setIsStreaming(false);
        inflightIdRef.current = null;
        setInflightId(null);
        statusRef.current = 'idle';
        setStatus('idle');
        clearPendingStop();
        console.info('[stop-debug][stream-state] noop-recovered', {
          conversationId: event.conversationId,
          requestId: event.requestId,
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
        const staleInflightReplay =
          nextInflightId !== null &&
          prevInflightId !== null &&
          nextInflightId !== prevInflightId &&
          seenInflightIdsRef.current.has(nextInflightId);

        if (staleInflightReplay) {
          logWithChannel('info', 'chat.ws.client_user_turn_ignored', {
            conversationId: event.conversationId,
            ignoredInflightId: nextInflightId,
            activeInflightId: prevInflightId,
            reason: 'stale_inflight',
          });
          return;
        }

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
          rememberSeenInflightId(nextInflightId);
          rememberConfirmedInflightId(nextInflightId);
          finalizedInflightIdsRef.current.delete(nextInflightId);
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

        const incomingContent = event.content ?? '';
        const nowTimestamp = new Date().getTime();
        const incomingTimestamp = parseTimestamp(event.createdAt);
        const assistantId = activeAssistantMessageIdRef.current;

        updateMessages((prev) => {
          if (!incomingContent) return prev;

          for (
            let i = prev.length - 1;
            i >= 0 && i >= prev.length - 8;
            i -= 1
          ) {
            const existing = prev[i];
            if (existing?.role !== 'user') continue;
            if ((existing.content ?? '') !== incomingContent) {
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
      const logIgnoredNonFinalEvent = (
        eventType:
          | 'analysis_delta'
          | 'tool_event'
          | 'stream_warning'
          | 'inflight_snapshot',
        ignoredInflightId: string,
        reason:
          | 'stale_inflight'
          | 'finalized_inflight_replay' = 'stale_inflight',
      ) => {
        logHiddenRunEventIgnored(
          eventType,
          event.conversationId,
          activeConversation,
          reason,
        );
        logWithChannel('info', 'chat.ws.client_non_final_ignored', {
          conversationId: event.conversationId,
          eventType,
          ignoredInflightId,
          activeInflightId: currentInflightId,
          reason,
        });
      };

      if (event.type === 'inflight_snapshot') {
        const eventInflightId = event.inflight.inflightId;
        const finalizedInflightReplay =
          finalizedInflightIdsRef.current.has(eventInflightId);
        const staleInflightSnapshot =
          currentInflightId !== null &&
          eventInflightId !== currentInflightId &&
          seenInflightIdsRef.current.has(eventInflightId);

        if (finalizedInflightReplay) {
          logIgnoredNonFinalEvent(
            'inflight_snapshot',
            eventInflightId,
            'finalized_inflight_replay',
          );
          logWithChannel('info', 'chat.ws.client_non_final_ignored', {
            conversationId: event.conversationId,
            eventType: 'inflight_snapshot',
            ignoredInflightId: eventInflightId,
            activeInflightId: currentInflightId,
            reason: 'finalized_inflight_replay',
          });
          return;
        }

        if (staleInflightSnapshot) {
          logIgnoredNonFinalEvent('inflight_snapshot', eventInflightId);
          return;
        }

        const assistantId = ensureAssistantMessage({
          inflightId: eventInflightId,
        });
        rememberSeenInflightId(eventInflightId);
        rememberConfirmedInflightId(eventInflightId);

        const normalizedCommand = normalizeCommand(event.inflight.command);
        logFlowCommand(normalizedCommand);
        const startedAt =
          parseTimestamp(event.inflight.startedAt) !== null
            ? event.inflight.startedAt
            : undefined;
        const inflightUpdates: Partial<ChatMessage> = {
          streamStatus: 'processing',
          ...(startedAt ? { createdAt: startedAt } : {}),
          command: normalizedCommand ?? undefined,
        };

        if (normalizedCommand) {
          logWithChannel('info', 'DEV-0000024:T8:ws_inflight_command', {
            conversationId: event.conversationId,
            inflightId: eventInflightId,
            command: normalizedCommand,
          });
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
      const finalizedInflightReplay =
        finalizedInflightIdsRef.current.has(eventInflightId);
      let assistantId = preMappedAssistantId;
      const resolveAssistantId = () => {
        if (assistantId === null) {
          assistantId = ensureAssistantMessage({
            inflightId: eventInflightId,
          });
        }
        return assistantId;
      };
      const inflightMismatch =
        currentInflightId !== null && eventInflightId !== currentInflightId;

      if (event.type === 'assistant_delta') {
        if (finalizedInflightReplay) {
          logHiddenRunEventIgnored(
            'assistant_delta',
            event.conversationId,
            activeConversation,
            'finalized_inflight_replay',
          );
          logWithChannel('info', 'chat.ws.client_assistant_delta_ignored', {
            conversationId: event.conversationId,
            ignoredInflightId: eventInflightId,
            activeInflightId: currentInflightId,
            assistantMessageId: preMappedAssistantId,
            reason: 'finalized_inflight_replay',
          });
          return;
        }

        if (inflightMismatch) {
          logHiddenRunEventIgnored(
            'assistant_delta',
            event.conversationId,
            activeConversation,
            'stale_inflight',
          );
          logWithChannel('info', 'chat.ws.client_assistant_delta_ignored', {
            conversationId: event.conversationId,
            ignoredInflightId: eventInflightId,
            activeInflightId: currentInflightId,
            assistantMessageId: preMappedAssistantId,
            reason: 'stale_inflight',
          });
          return;
        }

        const assistantId = resolveAssistantId();
        rememberSeenInflightId(eventInflightId);
        rememberConfirmedInflightId(eventInflightId);
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
        if (finalizedInflightReplay) {
          logIgnoredNonFinalEvent(
            'stream_warning',
            eventInflightId,
            'finalized_inflight_replay',
          );
          return;
        }

        if (inflightMismatch) {
          logIgnoredNonFinalEvent('stream_warning', eventInflightId);
          return;
        }

        const assistantId = resolveAssistantId();
        rememberSeenInflightId(eventInflightId);
        rememberConfirmedInflightId(eventInflightId);
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
        if (finalizedInflightReplay) {
          logIgnoredNonFinalEvent(
            'analysis_delta',
            eventInflightId,
            'finalized_inflight_replay',
          );
          return;
        }

        if (inflightMismatch) {
          logIgnoredNonFinalEvent('analysis_delta', eventInflightId);
          return;
        }

        const assistantId = resolveAssistantId();
        rememberSeenInflightId(eventInflightId);
        rememberConfirmedInflightId(eventInflightId);
        inflightIdRef.current = eventInflightId;
        setInflightId(eventInflightId);
        inflightSeqRef.current = Math.max(inflightSeqRef.current, event.seq);
        assistantThinkRef.current += event.delta;
        setIsStreaming(true);
        syncAssistantMessage({ streamStatus: 'processing' }, { assistantId });
        return;
      }

      if (event.type === 'tool_event') {
        if (finalizedInflightReplay) {
          logIgnoredNonFinalEvent(
            'tool_event',
            eventInflightId,
            'finalized_inflight_replay',
          );
          return;
        }

        if (inflightMismatch) {
          logIgnoredNonFinalEvent('tool_event', eventInflightId);
          return;
        }

        const assistantId = resolveAssistantId();
        rememberSeenInflightId(eventInflightId);
        rememberConfirmedInflightId(eventInflightId);
        inflightIdRef.current = eventInflightId;
        setInflightId(eventInflightId);
        inflightSeqRef.current = Math.max(inflightSeqRef.current, event.seq);
        applyToolEvent(event.event);
        setIsStreaming(true);
        syncAssistantMessage({ streamStatus: 'processing' }, { assistantId });
        return;
      }

      if (event.type === 'turn_final') {
        if (finalizedInflightReplay) {
          logHiddenRunEventIgnored(
            'turn_final',
            event.conversationId,
            activeConversation,
            'finalized_inflight_replay',
          );
          logWithChannel('info', 'chat.ws.client_turn_final_preserved', {
            conversationId: event.conversationId,
            finalInflightId: eventInflightId,
            activeInflightId: currentInflightId,
            reason: 'finalized_inflight_replay',
          });
          return;
        }

        const existingAssistantId =
          preMappedAssistantId ??
          getExistingAssistantMessageIdForInflight(eventInflightId);
        rememberSeenInflightId(event.inflightId);
        rememberConfirmedInflightId(event.inflightId);
        finalizedInflightIdsRef.current.add(event.inflightId);
        inflightSeqRef.current = Math.max(inflightSeqRef.current, event.seq);

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
          event.status === 'failed'
            ? 'failed'
            : event.status === 'stopped'
              ? 'stopped'
              : 'complete';

        logWithChannel('info', 'chat.client_turn_final_sync', {
          inflightId: event.inflightId,
          assistantMessageId: existingAssistantId,
          assistantTextLen: assistantTextRef.current.length,
          streamStatus,
          inflightMismatch,
        });

        assistantMessageIdByInflightIdRef.current.delete(event.inflightId);

        const isOutOfBandFinal =
          preMappedAssistantId !== null &&
          currentInflightId !== eventInflightId;
        const preservesActiveInflight =
          currentInflightId !== null && currentInflightId !== eventInflightId;

        if (preservesActiveInflight) {
          logHiddenRunEventIgnored(
            'turn_final',
            event.conversationId,
            activeConversation,
            'late_final_non_destructive',
          );
          logWithChannel('info', 'chat.ws.client_turn_final_preserved', {
            conversationId: event.conversationId,
            finalInflightId: eventInflightId,
            activeInflightId: currentInflightId,
            reason: 'late_final_non_destructive',
          });
        }

        if (inflightMismatch || isOutOfBandFinal) {
          if (!existingAssistantId) {
            logHiddenRunEventIgnored(
              'turn_final',
              event.conversationId,
              activeConversation,
              'late_final_without_visible_bubble_suppressed',
            );
            logWithChannel('info', 'chat.ws.client_turn_final_preserved', {
              conversationId: event.conversationId,
              finalInflightId: eventInflightId,
              activeInflightId: currentInflightId,
              reason: 'late_final_without_visible_bubble_suppressed',
            });
            return;
          }
          syncAssistantMessage(
            {
              streamStatus,
              thinking: false,
              thinkStreaming: false,
              ...(event.status === 'failed' ? { kind: 'error' as const } : {}),
              ...metadataUpdates,
            },
            { assistantId: existingAssistantId, useRefs: false },
          );
          return;
        }

        const assistantId = resolveAssistantId();

        inflightIdRef.current = eventInflightId;
        setInflightId(eventInflightId);
        if (event.threadId !== undefined) {
          setThreadId(event.threadId ?? null);
          threadIdRef.current = event.threadId ?? null;
        }

        clearThinkingTimer();
        setIsStreaming(false);
        statusRef.current = 'idle';
        setStatus('idle');
        clearPendingStop();

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
        if (event.status === 'stopped') {
          console.info('[stop-debug][stream-state] stopped', {
            conversationId: event.conversationId,
            inflightId: eventInflightId,
            turnId: assistantId,
          });
        }
      }
    },
    [
      applyToolEvent,
      clearPendingStop,
      clearThinkingTimer,
      ensureAssistantMessage,
      logFlowCommand,
      logWithChannel,
      getExistingAssistantMessageIdForInflight,
      logHiddenRunEventIgnored,
      rememberConfirmedInflightId,
      rememberSeenInflightId,
      removePendingAssistantIfOptimistic,
      resetAssistantPointer,
      status,
      syncAssistantMessage,
      updateMessages,
    ],
  );

  const getInflightId = useCallback(() => inflightIdRef.current, []);
  const getConversationId = useCallback(() => conversationIdRef.current, []);
  const getAssistantMessageIdForInflight = useCallback(
    (targetInflightId: string | null) => {
      if (!targetInflightId) return null;
      return (
        assistantMessageIdByInflightIdRef.current.get(targetInflightId) ??
        historicalAssistantMessageIdByInflightIdRef.current.get(
          targetInflightId,
        ) ??
        null
      );
    },
    [],
  );

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
      getConversationId,
      getAssistantMessageIdForInflight,
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
      getConversationId,
      getAssistantMessageIdForInflight,
      handleWsEvent,
    ],
  );
}

export default useChatStream;
