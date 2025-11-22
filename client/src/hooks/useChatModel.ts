import type { ChatModelInfo } from '@codeinfo2/common';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Status = 'idle' | 'loading' | 'success' | 'error';

const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

export function useChatModel() {
  const controllerRef = useRef<AbortController | null>(null);
  const [models, setModels] = useState<ChatModelInfo[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus('loading');
    setErrorMessage(undefined);
    try {
      const res = await fetch(new URL('/chat/models', serverBase).toString(), {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch chat models (${res.status})`);
      }
      const data = (await res.json()) as ChatModelInfo[];
      setModels(data);
      setSelected((prev) => {
        if (prev && data.some((m) => m.key === prev)) {
          return prev;
        }
        return data[0]?.key;
      });
      setStatus('success');
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return;
      }
      setStatus('error');
      setErrorMessage((err as Error).message);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => controllerRef.current?.abort();
  }, [refresh]);

  const flags = useMemo(
    () => ({
      isLoading: status === 'loading',
      isError: status === 'error',
      isEmpty: status === 'success' && models.length === 0,
    }),
    [status, models.length],
  );

  return {
    models,
    selected,
    setSelected,
    status,
    errorMessage,
    refresh,
    ...flags,
  };
}

export default useChatModel;
