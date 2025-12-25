import { LogLevel } from '@codeinfo2/common';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '../logging/logger';

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

type Status = 'idle' | 'sending';

type StreamEvent =
  | { type: 'token'; content?: string; roundIndex?: number }
  | {
      type: 'final';
      message?: { role?: string; content?: string };
      roundIndex?: number;
    }
  | { type: 'complete'; threadId?: string | null }
  | { type: 'thread'; threadId?: string | null }
  | { type: 'error'; message?: string }
  | {
      type: 'tool-request' | 'tool-result';
      callId?: string | number;
      name?: string;
      stage?: string;
      result?: unknown;
      parameters?: unknown;
      errorTrimmed?: unknown;
      errorFull?: unknown;
    };

const serverBase =
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

export type ReasoningState = {
  pending: string;
  mode: 'final' | 'analysis';
  analysis: string;
  final: string;
  analysisStreaming: boolean;
};

const controlTokens = [
  {
    token: '<|start|>assistant<|channel|>final<|message|>',
    onHit: (state: ReasoningState) => {
      state.mode = 'final';
      state.analysisStreaming = false;
    },
  },
  {
    token: '<|channel|>analysis<|message|>',
    onHit: (state: ReasoningState) => {
      state.mode = 'analysis';
      state.analysisStreaming = true;
    },
  },
  {
    token: '<|channel|>final<|message|>',
    onHit: (state: ReasoningState) => {
      state.mode = 'final';
      state.analysisStreaming = false;
    },
  },
  {
    token: '<think>',
    onHit: (state: ReasoningState) => {
      state.mode = 'analysis';
      state.analysisStreaming = true;
    },
  },
  {
    token: '</think>',
    onHit: (state: ReasoningState) => {
      state.mode = 'final';
      state.analysisStreaming = false;
    },
  },
  {
    token: '<|start|>assistant',
    onHit: (state: ReasoningState) => {
      state.analysisStreaming = false;
    },
  },
  {
    token: '<|end|>',
    onHit: () => {},
  },
];

const maxMarkerLength = controlTokens.reduce(
  (max, token) => Math.max(max, token.token.length),
  0,
);

const maxLookback = Math.max(maxMarkerLength - 1, 0);

export const initialReasoningState = (): ReasoningState => ({
  pending: '',
  mode: 'final',
  analysis: '',
  final: '',
  analysisStreaming: false,
});

export const parseReasoning = (
  current: ReasoningState,
  chunk: string,
  {
    flushAll = false,
    dedupeAnalysis = false,
  }: { flushAll?: boolean; dedupeAnalysis?: boolean } = {},
): ReasoningState => {
  let pending = current.pending + chunk;
  let analysis = current.analysis;
  let final = current.final;
  let mode = current.mode;
  let analysisStreaming = current.analysisStreaming;

  const appendText = (text: string) => {
    if (!text) return;
    if (mode === 'analysis') {
      if (dedupeAnalysis && text && analysis.endsWith(text)) {
        return;
      }
      analysis += text;
    } else {
      final += text;
    }
  };

  while (pending.length) {
    let nearest: { idx: number; token: (typeof controlTokens)[number] } | null =
      null;

    for (const token of controlTokens) {
      const idx = pending.indexOf(token.token);
      if (idx === -1) continue;
      if (
        nearest === null ||
        idx < nearest.idx ||
        (idx === nearest.idx &&
          token.token.length > (nearest.token?.token.length ?? 0))
      ) {
        nearest = { idx, token };
      }
    }

    if (!nearest) {
      if (flushAll) {
        appendText(pending);
        pending = '';
      } else if (pending.length > maxLookback) {
        const emitLen = pending.length - maxLookback;
        appendText(pending.slice(0, emitLen));
        pending = pending.slice(emitLen);
      }
      break;
    }

    const prefix = pending.slice(0, nearest.idx);
    appendText(prefix);
    pending = pending.slice(nearest.idx + nearest.token.token.length);

    const tokenState = {
      pending: '',
      mode,
      analysis,
      final,
      analysisStreaming,
    };
    nearest.token.onHit(tokenState);
    ({ mode, analysis, final, analysisStreaming } = tokenState);
  }

  return {
    pending,
    mode,
    analysis,
    final,
    analysisStreaming,
  };
};

const isToolEvent = (
  event: StreamEvent,
): event is Extract<StreamEvent, { type: 'tool-request' | 'tool-result' }> =>
  event.type === 'tool-request' || event.type === 'tool-result';

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

export function useChatStream(
  model?: string,
  provider?: string,
  codexFlags?: CodexFlagState,
) {
  const log = useRef(createLogger('client')).current;
  const threadIdRef = useRef<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const logWithChannel = useCallback(
    (level: LogLevel, message: string, context: Record<string, unknown> = {}) =>
      log(level, message, {
        channel: 'client-chat',
        provider,
        model,
        ...(threadIdRef.current ? { threadId: threadIdRef.current } : {}),
        ...context,
      }),
    [log, model, provider],
  );

  const controllerRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const statusRef = useRef<Status>('idle');
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string>(() => makeId());
  const conversationIdRef = useRef<string>(conversationId);
  const [inflightId, setInflightId] = useState<string | null>(null);
  const inflightIdRef = useRef<string | null>(null);
  const suppressNextProviderResetRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVisibleTextAtRef = useRef<number | null>(null);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    inflightIdRef.current = inflightId;
  }, [inflightId]);

  useEffect(() => {
    if (suppressNextProviderResetRef.current) {
      suppressNextProviderResetRef.current = false;
      return;
    }
    setThreadId(null);
    threadIdRef.current = null;
    const nextConversationId = makeId();
    setConversationId(nextConversationId);
    conversationIdRef.current = nextConversationId;
  }, [provider]);

  const clearThinkingTimer = useCallback(() => {
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
  }, []);

  const finishStreaming = useCallback(() => {
    setIsStreaming(false);
    setStatus('idle');
    clearThinkingTimer();
  }, [clearThinkingTimer]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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

  const stop = useCallback(
    (options?: { showStatusBubble?: boolean }) => {
      const wasSending = statusRef.current === 'sending';
      controllerRef.current?.abort();
      controllerRef.current = null;
      updateMessages((prev) =>
        prev.map((msg) =>
          msg.role === 'assistant' ? { ...msg, thinking: false } : msg,
        ),
      );
      if (options?.showStatusBubble && wasSending) {
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
      finishStreaming();
    },
    [finishStreaming, updateMessages],
  );

  const reset = useCallback(() => {
    updateMessages(() => []);
    finishStreaming();
    lastVisibleTextAtRef.current = null;
    setThreadId(null);
    threadIdRef.current = null;
    setInflightId(null);
    inflightIdRef.current = null;
    const nextConversationId = makeId();
    setConversationId(nextConversationId);
    conversationIdRef.current = nextConversationId;
    return nextConversationId;
  }, [finishStreaming, updateMessages]);

  const setConversation = useCallback(
    (
      nextConversationId: string,
      options?: { clearMessages?: boolean; threadId?: string | null },
    ) => {
      console.info('[chat-stream] setConversation', {
        nextConversationId,
        clearMessages: Boolean(options?.clearMessages),
      });
      suppressNextProviderResetRef.current = true;
      stop();
      if (options?.clearMessages) {
        updateMessages(() => []);
      }
      const nextThreadId = Object.prototype.hasOwnProperty.call(
        options ?? {},
        'threadId',
      )
        ? (options?.threadId ?? null)
        : null;
      setThreadId(nextThreadId);
      threadIdRef.current = nextThreadId;
      setInflightId(null);
      inflightIdRef.current = null;
      setConversationId(nextConversationId);
      conversationIdRef.current = nextConversationId;
      console.info('[chat-stream] conversation set', {
        conversationId: nextConversationId,
      });
    },
    [stop, updateMessages],
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

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === 'sending' || !model || !provider) {
        return;
      }

      stop();
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsStreaming(true);
      setStatus('sending');
      statusRef.current = 'sending';

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

      const currentInflightId = makeId();
      setInflightId(currentInflightId);
      inflightIdRef.current = currentInflightId;

      const assistantId = makeId();
      let reasoning = initialReasoningState();
      let finalText = '';
      let assistantCitations: ToolCitation[] = [];
      let segments: ChatSegment[] = [
        { id: makeId(), kind: 'text', content: '' },
      ];
      const toolsAwaitingAssistantOutput = new Set<string>();
      const pendingToolResults = new Set<string>();
      let toolRequestsSeen = 0;
      let toolResultsSeen = 0;
      const toolEchoGuards = new Set<string>();
      let completeFrameSeen = false;
      let completeTimeout: ReturnType<typeof setTimeout> | null = null;
      const COMPLETE_STATUS_DELAY_MS = 0;
      const minProcessingUntil = Date.now();
      const logContentDecision = (reason: string, content: string) => {
        console.log('[chat-stream] content decision', { reason, content });
      };
      const logSync = (reason: string) => {
        console.log('[chat-stream] sync message', {
          reason,
          finalText,
          analysis: reasoning.analysis,
          segmentsCount: segments.length,
        });
      };

      const setAssistantThinking = (thinking: boolean) => {
        updateMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, thinking } : msg,
          ),
        );
      };

      const computeWaitingForVisibleText = () => {
        const hasVisibleText = segments.some(
          (segment) => segment.kind === 'text' && segment.content.length > 0,
        );
        return (
          statusRef.current === 'sending' &&
          !hasVisibleText &&
          pendingToolResults.size === 0
        );
      };

      const scheduleThinkingTimer = () => {
        clearThinkingTimer();
        thinkingTimerRef.current = setTimeout(() => {
          const waitingForVisibleText = computeWaitingForVisibleText();
          setAssistantThinking(waitingForVisibleText);
          if (statusRef.current === 'sending') {
            scheduleThinkingTimer();
          }
        }, 1000);
      };

      const setAssistantStatus = (
        streamStatus: ChatMessage['streamStatus'],
      ) => {
        updateMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, streamStatus } : msg,
          ),
        );
      };

      updateMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          segments,
          streamStatus: 'processing',
          thinking: false,
          createdAt: new Date().toISOString(),
        },
      ]);
      lastVisibleTextAtRef.current = null;
      scheduleThinkingTimer();

      // Yield so the initial "Processing" state can render before stream frames arrive.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const maybeMarkComplete = () => {
        if (!completeFrameSeen) return;
        if (pendingToolResults.size > 0 || toolResultsSeen < toolRequestsSeen) {
          return;
        }
        if (completeTimeout) return;
        const delay = Math.max(
          COMPLETE_STATUS_DELAY_MS,
          minProcessingUntil - Date.now(),
        );
        if (delay <= 0) {
          setAssistantStatus('complete');
          setAssistantThinking(false);
          completeTimeout = null;
          return;
        }
        completeTimeout = setTimeout(() => {
          setAssistantStatus('complete');
          setAssistantThinking(false);
          completeTimeout = null;
        }, delay);
      };

      const syncAssistantMessage = () => {
        const toolList = segments
          .filter(
            (segment): segment is Extract<ChatSegment, { kind: 'tool' }> =>
              segment.kind === 'tool',
          )
          .map((segment) => segment.tool);

        updateMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: finalText,
                  think: reasoning.analysis || undefined,
                  thinkStreaming: reasoning.analysisStreaming,
                  segments,
                  tools: toolList,
                }
              : msg,
          ),
        );
        logSync('syncAssistantMessage');
      };

      const appendTextSegment = (text: string) => {
        if (!text) return;
        lastVisibleTextAtRef.current = Date.now();
        clearThinkingTimer();
        const last = segments[segments.length - 1];
        let nextSegments = [...segments];
        if (last && last.kind === 'text') {
          nextSegments[nextSegments.length - 1] = {
            ...last,
            content: last.content + text,
          };
        } else {
          nextSegments = [
            ...nextSegments,
            { id: makeId(), kind: 'text', content: text },
          ];
        }
        segments = nextSegments;
        setAssistantThinking(false);
        scheduleThinkingTimer();
      };

      const applyReasoning = (next: ReasoningState) => {
        const newFinal = next.final;
        if (newFinal.length >= finalText.length) {
          const delta = newFinal.slice(finalText.length);
          appendTextSegment(delta);
          finalText = newFinal;
          logContentDecision('append-final-delta', delta);
        } else {
          finalText = newFinal;
          segments = segments.filter((segment) => segment.kind !== 'text');
          segments = [
            ...segments,
            { id: makeId(), kind: 'text', content: newFinal },
          ];
          logContentDecision('reset-final-text', newFinal);
        }
        reasoning = next;
        syncAssistantMessage();
      };

      const appendCitations = (incoming: ToolCitation[]) => {
        if (!incoming.length) return;
        assistantCitations = [...assistantCitations, ...incoming];
        updateMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  citations: [...(msg.citations ?? []), ...incoming],
                }
              : msg,
          ),
        );
      };

      const upsertTool = (incoming: ToolCall) => {
        const stripTrailingEmptyText = (list: ChatSegment[]) => {
          const last = list[list.length - 1];
          if (last && last.kind === 'text' && last.content === '') {
            return list.slice(0, -1);
          }
          return list;
        };

        const ensureTrailingText = (list: ChatSegment[]) => {
          const last = list[list.length - 1];
          if (!last || last.kind !== 'text' || last.content.length > 0) {
            return [
              ...list,
              { id: makeId(), kind: 'text', content: '' } as ChatSegment,
            ];
          }
          return list;
        };

        let nextSegments = [...segments];
        const existingIndex = nextSegments.findIndex(
          (segment) =>
            segment.kind === 'tool' && segment.tool.id === incoming.id,
        );

        if (existingIndex >= 0) {
          const existing = nextSegments[existingIndex] as Extract<
            ChatSegment,
            { kind: 'tool' }
          >;
          nextSegments[existingIndex] = {
            ...existing,
            tool: { ...existing.tool, ...incoming },
          };
        } else {
          nextSegments = stripTrailingEmptyText(nextSegments);
          nextSegments = [
            ...nextSegments,
            { id: incoming.id, kind: 'tool', tool: incoming },
          ];
          nextSegments = ensureTrailingText(nextSegments);
        }

        segments = nextSegments;
        syncAssistantMessage();
      };

      const completeAwaitingToolsOnAssistantOutput = () => {
        if (!toolsAwaitingAssistantOutput.size) return;
        let changed = false;
        segments = segments.map((segment) => {
          if (segment.kind !== 'tool') return segment;
          if (!toolsAwaitingAssistantOutput.has(segment.tool.id))
            return segment;
          toolsAwaitingAssistantOutput.delete(segment.tool.id);
          if (segment.tool.status === 'requesting') {
            changed = true;
            return {
              ...segment,
              tool: { ...segment.tool, status: 'done' },
            };
          }
          return segment;
        });

        if (changed) {
          syncAssistantMessage();
        }
      };

      const completePendingTools = () => {
        const nextSegments = segments.map((segment) =>
          segment.kind === 'tool' && segment.tool.status === 'requesting'
            ? {
                ...segment,
                tool: { ...segment.tool, status: 'done' },
              }
            : segment,
        );
        segments = nextSegments;
        syncAssistantMessage();
        updateMessages((prev) =>
          prev.map((msg, idx, list) => {
            if (idx !== list.length - 1 || msg.role !== 'assistant') {
              return msg;
            }
            const updatedTools = msg.tools?.map((tool) =>
              tool.status === 'requesting' ? { ...tool, status: 'done' } : tool,
            );
            const updatedSegments = msg.segments?.map((segment) =>
              segment.kind === 'tool' && segment.tool.status === 'requesting'
                ? {
                    ...segment,
                    tool: { ...segment.tool, status: 'done' },
                  }
                : segment,
            );

            const toolsChanged =
              JSON.stringify(updatedTools) !== JSON.stringify(msg.tools);
            const segmentsChanged =
              JSON.stringify(updatedSegments) !== JSON.stringify(msg.segments);

            if (!toolsChanged && !segmentsChanged) return msg;
            return {
              ...msg,
              ...(updatedTools ? { tools: updatedTools } : {}),
              ...(updatedSegments ? { segments: updatedSegments } : {}),
            } as ChatMessage;
          }),
        );
      };

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

        const res = await fetch(new URL('/chat', serverBase).toString(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            provider,
            model,
            conversationId: currentConversationId,
            inflightId: currentInflightId,
            cancelOnDisconnect: false,
            message: trimmed,
            ...codexPayload,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`Chat request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const trimmedLine = part.trim();
            if (!trimmedLine.startsWith('data:')) {
              continue;
            }
            const payload = trimmedLine.replace(/^data:\s*/, '');
            try {
              const event = JSON.parse(payload) as StreamEvent;
              if (event.type === 'thread') {
                if (event.threadId) {
                  setThreadId(event.threadId);
                  threadIdRef.current = event.threadId;
                  logWithChannel('info', 'chat thread assigned', {
                    threadId: event.threadId,
                  });
                }
                continue;
              }
              if (isToolEvent(event)) {
                const status: ToolCall['status'] =
                  event.type === 'tool-request'
                    ? 'requesting'
                    : event.stage === 'error'
                      ? 'error'
                      : 'done';
                const id = event.callId ?? makeId();
                const idStr = id.toString();
                logWithChannel('info', 'chat tool event', {
                  type: event.type,
                  callId: id,
                  name: event.name,
                  stage: event.stage,
                });
                const applyResult = () => {
                  if (event.type === 'tool-request') {
                    toolRequestsSeen += 1;
                  } else {
                    toolResultsSeen += 1;
                  }
                  const toolParameters =
                    event.parameters ??
                    (event.result &&
                    typeof event.result === 'object' &&
                    'parameters' in (event.result as Record<string, unknown>)
                      ? (event.result as { parameters?: unknown }).parameters
                      : undefined);
                  upsertTool({
                    id,
                    name: event.name,
                    status,
                    payload: event.result,
                    parameters: toolParameters,
                    stage: event.stage,
                    errorTrimmed: (event as { errorTrimmed?: unknown })
                      .errorTrimmed as ToolCall['errorTrimmed'],
                    errorFull: (event as { errorFull?: unknown }).errorFull,
                  });
                  if (event.type === 'tool-request') {
                    pendingToolResults.add(idStr);
                    toolsAwaitingAssistantOutput.add(id);
                    setAssistantThinking(false);
                    scheduleThinkingTimer();
                  }
                  if (event.type === 'tool-result') {
                    const citations = extractCitations(event.result);
                    appendCitations(citations);
                    pendingToolResults.delete(idStr);
                    toolsAwaitingAssistantOutput.delete(id);
                    toolEchoGuards.add(id.toString());
                    setAssistantThinking(computeWaitingForVisibleText());
                    scheduleThinkingTimer();
                  }
                };

                applyResult();
                maybeMarkComplete();
                continue;
              }
              if (event.type === 'final' && event.message?.role === 'tool') {
                segments
                  .filter(
                    (
                      segment,
                    ): segment is Extract<ChatSegment, { kind: 'tool' }> =>
                      segment.kind === 'tool' &&
                      segment.tool.status === 'requesting',
                  )
                  .forEach((segment) => {
                    toolsAwaitingAssistantOutput.add(segment.tool.id);
                  });
                continue;
              }

              if (
                event.type === 'analysis' &&
                typeof event.content === 'string'
              ) {
                const next = parseReasoning(
                  { ...reasoning, mode: 'analysis', analysisStreaming: true },
                  event.content,
                  { flushAll: true },
                );
                const normalized = { ...next, mode: 'final' as const };
                reasoning = normalized;
                applyReasoning(normalized);
                continue;
              }

              if (event.type === 'token' && typeof event.content === 'string') {
                completeAwaitingToolsOnAssistantOutput();
                applyReasoning(
                  parseReasoning(reasoning, event.content, {
                    flushAll: false,
                  }),
                );
              } else if (
                event.type === 'final' &&
                (typeof event.message?.content === 'string' ||
                  Array.isArray(
                    (event.message as { data?: unknown })?.data?.['content'],
                  ))
              ) {
                const dataContent = Array.isArray(
                  (event.message as { data?: { content?: unknown } })?.data
                    ?.content,
                )
                  ? ((event.message as { data?: { content?: unknown } })?.data
                      ?.content as Array<{ type?: string; text?: string }>)
                  : [];
                const contentFromData = dataContent
                  .filter((item) => item?.type === 'text')
                  .map((item) => item.text ?? '')
                  .join('');
                const finalContent =
                  typeof event.message?.content === 'string'
                    ? event.message.content
                    : contentFromData;

                const hasToolContext =
                  pendingToolResults.size > 0 ||
                  toolsAwaitingAssistantOutput.size > 0 ||
                  toolEchoGuards.size > 0;
                const suppressToolEcho =
                  hasToolContext && isVectorPayloadString(finalContent);
                if (suppressToolEcho) {
                  completeAwaitingToolsOnAssistantOutput();
                  toolEchoGuards.clear();
                  continue;
                }
                completeAwaitingToolsOnAssistantOutput();
                const parsedFinal = parseReasoning(
                  reasoning,
                  finalText.length > 0 ? '' : finalContent,
                  {
                    flushAll: true,
                    dedupeAnalysis: true,
                  },
                );
                applyReasoning(parsedFinal);
                setAssistantThinking(false);
                toolEchoGuards.clear();
                maybeMarkComplete();
              } else if (event.type === 'final') {
                completeAwaitingToolsOnAssistantOutput();
                applyReasoning(
                  parseReasoning(reasoning, '', { flushAll: true }),
                );
                setAssistantThinking(false);
                toolEchoGuards.clear();
                maybeMarkComplete();
              } else if (event.type === 'error') {
                const message =
                  event.message ?? 'Chat failed. Please retry in a moment.';
                handleErrorBubble(message);
                finishStreaming();
                setInflightId(null);
                inflightIdRef.current = null;
                setAssistantStatus('failed');
                setAssistantThinking(false);
              } else if (event.type === 'complete') {
                if ('threadId' in event && event.threadId) {
                  setThreadId(event.threadId);
                  threadIdRef.current = event.threadId;
                }
                completeFrameSeen = true;
                const completed = parseReasoning(reasoning, '', {
                  flushAll: true,
                });
                applyReasoning({ ...completed, analysisStreaming: false });
                completePendingTools();
                maybeMarkComplete();
                setAssistantThinking(false);
                setTimeout(() => {
                  maybeMarkComplete();
                  finishStreaming();
                  setInflightId(null);
                  inflightIdRef.current = null;
                }, 0);
              }
            } catch {
              continue;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return;
        }
        handleErrorBubble(
          (err as Error)?.message ?? 'Chat failed. Please try again.',
        );
        finishStreaming();
        setInflightId(null);
        inflightIdRef.current = null;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    [
      extractCitations,
      finishStreaming,
      handleErrorBubble,
      logWithChannel,
      model,
      provider,
      codexFlags?.sandboxMode,
      codexFlags?.approvalPolicy,
      codexFlags?.modelReasoningEffort,
      codexFlags?.networkAccessEnabled,
      codexFlags?.webSearchEnabled,
      status,
      stop,
      updateMessages,
      clearThinkingTimer,
      setThreadId,
    ],
  );

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  return {
    messages,
    status,
    isStreaming,
    inflightId,
    send,
    stop,
    reset,
    conversationId,
    setConversation,
    hydrateHistory,
  };
}

export default useChatStream;
