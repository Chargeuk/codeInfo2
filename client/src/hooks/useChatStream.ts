import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '../logging/logger';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  kind?: 'error' | 'status';
  think?: string;
  thinkStreaming?: boolean;
  citations?: ToolCitation[];
  tools?: ToolCall[];
  segments?: ChatSegment[];
  streamStatus?: 'processing' | 'complete' | 'failed';
  thinking?: boolean;
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
  | { type: 'complete' }
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

const makeId = () =>
  crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

type ReasoningState = {
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

const initialReasoningState = (): ReasoningState => ({
  pending: '',
  mode: 'final',
  analysis: '',
  final: '',
  analysisStreaming: false,
});

const parseReasoning = (
  current: ReasoningState,
  chunk: string,
  { flushAll = false }: { flushAll?: boolean } = {},
): ReasoningState => {
  let pending = current.pending + chunk;
  let analysis = current.analysis;
  let final = current.final;
  let mode = current.mode;
  let analysisStreaming = current.analysisStreaming;

  const appendText = (text: string) => {
    if (!text) return;
    if (mode === 'analysis') {
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

export function useChatStream(model?: string) {
  const logger = useRef(createLogger('client-chat')).current;
  const controllerRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const statusRef = useRef<Status>('idle');
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVisibleTextAtRef = useRef<number | null>(null);

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
  }, [finishStreaming, updateMessages]);

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
      if (!trimmed || status === 'sending' || !model) {
        return;
      }

      stop();
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsStreaming(true);
      setStatus('sending');

      const userMessage: ChatMessage = {
        id: makeId(),
        role: 'user',
        content: trimmed,
      };

      updateMessages((prev) => [...prev, userMessage]);

      const payloadMessages = messagesRef.current
        .filter((msg) => !msg.kind)
        .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
        .map((msg) => ({ role: msg.role, content: msg.content }));

      const assistantId = makeId();
      let reasoning = initialReasoningState();
      let finalText = '';
      let assistantCitations: ToolCitation[] = [];
      let segments: ChatSegment[] = [
        { id: makeId(), kind: 'text', content: '' },
      ];
      const toolsAwaitingAssistantOutput = new Set<string>();
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
        },
      ]);
      lastVisibleTextAtRef.current = null;
      clearThinkingTimer();
      thinkingTimerRef.current = setTimeout(() => {
        if (statusRef.current === 'sending') {
          setAssistantThinking(true);
        }
      }, 1000);

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
        thinkingTimerRef.current = setTimeout(() => {
          if (statusRef.current !== 'sending') return;
          updateMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, thinking: true } : msg,
            ),
          );
        }, 1000);
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
          if (segment.tool.status !== 'requesting') return segment;
          if (!toolsAwaitingAssistantOutput.has(segment.tool.id))
            return segment;
          toolsAwaitingAssistantOutput.delete(segment.tool.id);
          changed = true;
          return {
            ...segment,
            tool: { ...segment.tool, status: 'done' },
          };
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
        const res = await fetch(new URL('/chat', serverBase).toString(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [...payloadMessages, { role: 'user', content: trimmed }],
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
              if (isToolEvent(event)) {
                const status: ToolCall['status'] =
                  event.type === 'tool-request'
                    ? 'requesting'
                    : event.stage === 'error'
                      ? 'error'
                      : 'done';
                const id = event.callId ?? makeId();
                logger('info', 'chat tool event', {
                  type: event.type,
                  callId: id,
                  name: event.name,
                  stage: event.stage,
                });
                const applyResult = () => {
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
                    toolsAwaitingAssistantOutput.add(id);
                  }
                  if (event.type === 'tool-result') {
                    const citations = extractCitations(event.result);
                    appendCitations(citations);
                    toolsAwaitingAssistantOutput.add(id);
                  }
                };

                applyResult();
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

                const suppressToolEcho =
                  toolsAwaitingAssistantOutput.size > 0 &&
                  isVectorPayloadString(finalContent);
                if (suppressToolEcho) {
                  completeAwaitingToolsOnAssistantOutput();
                  continue;
                }
                completeAwaitingToolsOnAssistantOutput();
                applyReasoning(
                  parseReasoning(initialReasoningState(), finalContent, {
                    flushAll: true,
                  }),
                );
                setAssistantStatus('complete');
                setAssistantThinking(false);
              } else if (event.type === 'final') {
                completeAwaitingToolsOnAssistantOutput();
                applyReasoning(
                  parseReasoning(reasoning, '', { flushAll: true }),
                );
                setAssistantStatus('complete');
                setAssistantThinking(false);
              } else if (event.type === 'error') {
                const message =
                  event.message ?? 'Chat failed. Please retry in a moment.';
                handleErrorBubble(message);
                finishStreaming();
                setAssistantStatus('failed');
                setAssistantThinking(false);
              } else if (event.type === 'complete') {
                const completed = parseReasoning(reasoning, '', {
                  flushAll: true,
                });
                applyReasoning({ ...completed, analysisStreaming: false });
                completePendingTools();
                setTimeout(finishStreaming, 0);
                setAssistantStatus('complete');
                setAssistantThinking(false);
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
      logger,
      model,
      status,
      stop,
      updateMessages,
      clearThinkingTimer,
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
    send,
    stop,
    reset,
  };
}

export default useChatStream;
