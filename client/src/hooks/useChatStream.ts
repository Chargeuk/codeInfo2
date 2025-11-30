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
  status: 'requesting' | 'result' | 'error';
  payload?: unknown;
};

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
      callId?: string;
      name?: string;
      stage?: string;
      result?: unknown;
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

export function useChatStream(model?: string) {
  const logger = useRef(createLogger('client-chat')).current;
  const controllerRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const statusRef = useRef<Status>('idle');
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);

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
      setIsStreaming(false);
      setStatus('idle');
    },
    [updateMessages],
  );

  const reset = useCallback(() => {
    updateMessages(() => []);
    setIsStreaming(false);
    setStatus('idle');
  }, [updateMessages]);

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
      let assistantCitations: ToolCitation[] = [];
      let assistantTools: ToolCall[] = [];

      updateMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '' },
      ]);

      const applyReasoning = (next: ReasoningState) => {
        reasoning = next;
        updateMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: next.final,
                  think: next.analysis || undefined,
                  thinkStreaming: next.analysisStreaming,
                }
              : msg,
          ),
        );
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
        const existingIndex = assistantTools.findIndex(
          (tool) => tool.id === incoming.id,
        );
        const nextTools = [...assistantTools];
        if (existingIndex >= 0) {
          nextTools[existingIndex] = {
            ...nextTools[existingIndex],
            ...incoming,
          };
        } else {
          nextTools.push(incoming);
        }
        assistantTools = nextTools;
        updateMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  tools: nextTools,
                }
              : msg,
          ),
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
                      : 'result';
                const id = event.callId ?? makeId();
                logger('info', 'chat tool event', {
                  type: event.type,
                  callId: id,
                  name: event.name,
                  stage: event.stage,
                });
                const applyResult = () => {
                  upsertTool({
                    id,
                    name: event.name,
                    status,
                    payload: event.result,
                  });
                  if (event.type === 'tool-result') {
                    const citations = extractCitations(event.result);
                    appendCitations(citations);
                  }
                };

                if (event.type === 'tool-result') {
                  setTimeout(applyResult, 500);
                } else {
                  applyResult();
                }
                continue;
              }
              if (event.type === 'token' && typeof event.content === 'string') {
                applyReasoning(
                  parseReasoning(reasoning, event.content, {
                    flushAll: false,
                  }),
                );
              } else if (
                event.type === 'final' &&
                typeof event.message?.content === 'string'
              ) {
                applyReasoning(
                  parseReasoning(
                    initialReasoningState(),
                    event.message.content,
                    { flushAll: true },
                  ),
                );
              } else if (event.type === 'final') {
                applyReasoning(
                  parseReasoning(reasoning, '', { flushAll: true }),
                );
              } else if (event.type === 'error') {
                const message =
                  event.message ?? 'Chat failed. Please retry in a moment.';
                handleErrorBubble(message);
                setIsStreaming(false);
                setStatus('idle');
              } else if (event.type === 'complete') {
                const completed = parseReasoning(reasoning, '', {
                  flushAll: true,
                });
                applyReasoning({ ...completed, analysisStreaming: false });
                setIsStreaming(false);
                setStatus('idle');
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
        setIsStreaming(false);
        setStatus('idle');
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    [
      extractCitations,
      handleErrorBubble,
      logger,
      model,
      status,
      stop,
      updateMessages,
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
