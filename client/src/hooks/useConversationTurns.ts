import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

export type StoredTurn = {
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string;
  provider: string;
  toolCalls?: Record<string, unknown> | null;
  status: 'ok' | 'stopped' | 'failed';
  createdAt: string;
};

type ApiResponse = {
  items?: StoredTurn[];
  nextCursor?: string;
};

type Mode = 'replace' | 'prepend';

type State = {
  turns: StoredTurn[];
  lastPage: StoredTurn[];
  lastMode: Mode | null;
  isLoading: boolean;
  isError: boolean;
  error?: string;
  hasMore: boolean;
  loadOlder: () => Promise<void>;
  reset: () => void;
};

const PAGE_SIZE = 50;

export function useConversationTurns(conversationId?: string): State {
  const [turns, setTurns] = useState<StoredTurn[]>([]);
  const [lastPage, setLastPage] = useState<StoredTurn[]>([]);
  const [lastMode, setLastMode] = useState<Mode | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const controllerRef = useRef<AbortController | null>(null);

  const dedupeTurns = useCallback((items: StoredTurn[]) => {
    const seen = new Set<string>();
    return items.filter((turn) => {
      const key = `${turn.createdAt}-${turn.role}-${turn.provider}-${turn.model}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, []);

  const fetchPage = useCallback(
    async (mode: Mode = 'replace') => {
      if (!conversationId) {
        setTurns([]);
        setLastPage([]);
        setLastMode(null);
        setHasMore(false);
        return;
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsLoading(true);
      console.info('useConversationTurns:fetchPage:start', {
        conversationId,
        mode,
        cursor,
      });
      try {
        const search = new URLSearchParams({ limit: `${PAGE_SIZE}` });
        if (mode === 'prepend' && cursor) search.set('cursor', cursor);
        const res = await fetch(
          new URL(
            `/conversations/${conversationId}/turns?${search.toString()}`,
            serverBase,
          ).toString(),
          { signal: controller.signal },
        );
        if (res.status === 404) {
          setTurns([]);
          setLastPage([]);
          setLastMode(null);
          setHasMore(false);
          setIsError(false);
          setError(undefined);
          return;
        }
        if (!res.ok) {
          throw new Error(`Failed to load conversation turns (${res.status})`);
        }
        const data = (await res.json()) as ApiResponse;
        const items = Array.isArray(data.items) ? data.items : [];
        const chronological = items.slice().reverse();
        setLastPage(chronological);
        setLastMode(mode);
        setHasMore(Boolean(data.nextCursor));
        setCursor(data.nextCursor);
        setTurns((prev) => {
          const merged =
            mode === 'prepend' ? [...chronological, ...prev] : chronological;
          return dedupeTurns(merged);
        });
        console.info('useConversationTurns:fetchPage:success', {
          conversationId,
          mode,
          fetched: chronological.length,
          hasMore: Boolean(data.nextCursor),
          nextCursor: data.nextCursor,
        });
        setIsError(false);
        setError(undefined);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setIsError(true);
        setError((err as Error).message);
        console.error('useConversationTurns:fetchPage:error', {
          conversationId,
          mode,
          message: (err as Error).message,
        });
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        setIsLoading(false);
      }
    },
    [conversationId, cursor, dedupeTurns],
  );

  useEffect(() => {
    setTurns([]);
    setLastPage([]);
    setLastMode(null);
    setCursor(undefined);
    setHasMore(false);
    console.info('useConversationTurns:conversationChanged', {
      conversationId,
    });
    void fetchPage('replace');
    return () => controllerRef.current?.abort();
  }, [conversationId, fetchPage]);

  const loadOlder = useCallback(async () => {
    if (!hasMore || isLoading) return;
    await fetchPage('prepend');
  }, [fetchPage, hasMore, isLoading]);

  const reset = useCallback(() => {
    setTurns([]);
    setLastPage([]);
    setLastMode(null);
    setCursor(undefined);
    setHasMore(false);
    setIsError(false);
    setError(undefined);
    controllerRef.current?.abort();
  }, []);

  return useMemo(
    () => ({
      turns,
      lastPage,
      lastMode,
      isLoading,
      isError,
      error,
      hasMore,
      loadOlder,
      reset,
    }),
    [
      turns,
      lastPage,
      lastMode,
      isLoading,
      isError,
      error,
      hasMore,
      loadOlder,
      reset,
    ],
  );
}

export default useConversationTurns;
