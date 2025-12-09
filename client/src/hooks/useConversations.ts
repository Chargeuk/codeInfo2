import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

export type ConversationSummary = {
  conversationId: string;
  title: string;
  provider: string;
  model: string;
  lastMessageAt?: string;
  archived?: boolean;
  flags?: Record<string, unknown>;
};

type State = {
  conversations: ConversationSummary[];
  includeArchived: boolean;
  isLoading: boolean;
  isError: boolean;
  error?: string;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  archive: (conversationId: string) => Promise<void>;
  restore: (conversationId: string) => Promise<void>;
  setIncludeArchived: (include: boolean) => void;
};

type ApiResponse = {
  items?: ConversationSummary[];
  nextCursor?: string;
};

const PAGE_SIZE = 20;

export function useConversations(): State {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const controllerRef = useRef<AbortController | null>(null);

  const dedupeAndSort = useCallback((items: ConversationSummary[]) => {
    const seen = new Set<string>();
    return items
      .filter((item) => {
        if (seen.has(item.conversationId)) return false;
        seen.add(item.conversationId);
        return true;
      })
      .sort((a, b) => {
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bTime - aTime;
      });
  }, []);

  const fetchPage = useCallback(
    async (mode: 'replace' | 'append' = 'replace') => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsLoading(true);
      try {
        const search = new URLSearchParams({ limit: `${PAGE_SIZE}` });
        if (includeArchived) search.set('archived', 'true');
        if (mode === 'append' && cursor) search.set('cursor', cursor);
        const res = await fetch(
          new URL(`/conversations?${search.toString()}`, serverBase).toString(),
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(`Failed to load conversations (${res.status})`);
        }
        const data = (await res.json()) as ApiResponse;
        const items = Array.isArray(data.items) ? data.items : [];
        setHasMore(Boolean(data.nextCursor));
        setCursor(data.nextCursor);
        setConversations((prev) => {
          const merged = mode === 'append' ? [...prev, ...items] : items;
          const filtered = includeArchived
            ? merged
            : merged.filter((item) => !item.archived);
          return dedupeAndSort(filtered);
        });
        setIsError(false);
        setError(undefined);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setIsError(true);
        setError((err as Error).message);
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        setIsLoading(false);
      }
    },
    [includeArchived, cursor, dedupeAndSort],
  );

  useEffect(() => {
    setCursor(undefined);
    setConversations([]);
    setHasMore(false);
    void fetchPage('replace');
    return () => controllerRef.current?.abort();
  }, [includeArchived, fetchPage]);

  const refresh = useCallback(async () => {
    setCursor(undefined);
    await fetchPage('replace');
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    await fetchPage('append');
  }, [fetchPage, hasMore, isLoading]);

  const mutateArchiveFlag = useCallback(
    (conversationId: string, archived: boolean) => {
      setConversations((prev) =>
        dedupeAndSort(
          prev
            .map((conv) =>
              conv.conversationId === conversationId
                ? { ...conv, archived }
                : conv,
            )
            .filter((conv) => (includeArchived ? true : !conv.archived)),
        ),
      );
    },
    [dedupeAndSort, includeArchived],
  );

  const archive = useCallback(
    async (conversationId: string) => {
      await fetch(
        new URL(
          `/conversations/${conversationId}/archive`,
          serverBase,
        ).toString(),
        { method: 'POST' },
      );
      mutateArchiveFlag(conversationId, true);
    },
    [mutateArchiveFlag],
  );

  const restore = useCallback(
    async (conversationId: string) => {
      await fetch(
        new URL(
          `/conversations/${conversationId}/restore`,
          serverBase,
        ).toString(),
        { method: 'POST' },
      );
      mutateArchiveFlag(conversationId, false);
    },
    [mutateArchiveFlag],
  );

  return useMemo(
    () => ({
      conversations,
      includeArchived,
      isLoading,
      isError,
      error,
      hasMore,
      refresh,
      loadMore,
      archive,
      restore,
      setIncludeArchived,
    }),
    [
      conversations,
      includeArchived,
      isLoading,
      isError,
      error,
      hasMore,
      refresh,
      loadMore,
      archive,
      restore,
      setIncludeArchived,
    ],
  );
}

export default useConversations;
