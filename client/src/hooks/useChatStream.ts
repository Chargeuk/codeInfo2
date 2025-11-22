import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '../logging/logger';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  kind?: 'error' | 'status';
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
    };

const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

const makeId = () =>
  crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

const isToolEvent = (
  event: StreamEvent,
): event is Extract<StreamEvent, { type: 'tool-request' | 'tool-result' }> =>
  event.type === 'tool-request' || event.type === 'tool-result';

export function useChatStream(model?: string) {
  const logger = useRef(createLogger('client-chat')).current;
  const controllerRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);

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

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus('idle');
  }, []);

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

  const handleToolEvent = useCallback(
    (event: Extract<StreamEvent, { type: 'tool-request' | 'tool-result' }>) => {
      logger('info', 'chat tool event', {
        type: event.type,
        callId: event.callId,
        name: event.name,
        stage: event.stage,
      });
    },
    [logger],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === 'sending' || !model) {
        return;
      }

      stop();
      const controller = new AbortController();
      controllerRef.current = controller;
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
      let assistantContent = '';

      updateMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '' },
      ]);

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

        const flushAssistant = (content: string) => {
          assistantContent = content;
          updateMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, content } : msg,
            ),
          );
        };

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
                handleToolEvent(event);
                continue;
              }
              if (event.type === 'token' && typeof event.content === 'string') {
                flushAssistant(assistantContent + event.content);
              } else if (
                event.type === 'final' &&
                typeof event.message?.content === 'string'
              ) {
                flushAssistant(event.message.content);
              } else if (event.type === 'error') {
                const message =
                  event.message ?? 'Chat failed. Please retry in a moment.';
                handleErrorBubble(message);
                setStatus('idle');
              }
            } catch {
              continue;
            }
          }
        }

        if (!controller.signal.aborted) {
          setStatus('idle');
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return;
        }
        handleErrorBubble(
          (err as Error)?.message ?? 'Chat failed. Please try again.',
        );
        setStatus('idle');
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    [handleErrorBubble, handleToolEvent, model, status, stop, updateMessages],
  );

  useEffect(
    () => () => {
      stop();
    },
    [stop],
  );

  return {
    messages,
    status,
    send,
    stop,
  };
}

export default useChatStream;
