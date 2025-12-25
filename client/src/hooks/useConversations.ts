import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  archiveConversation as apiArchiveConversation,
  bulkArchiveConversations as apiBulkArchiveConversations,
  bulkDeleteConversations as apiBulkDeleteConversations,
  bulkRestoreConversations as apiBulkRestoreConversations,
  restoreConversation as apiRestoreConversation,
} from '../api/conversations';

const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

export type ConversationSummary = {
  conversationId: string;
  title: string;
  provider: string;
  model: string;
  source?: 'REST' | 'MCP';
  lastMessageAt?: string;
  archived?: boolean;
  flags?: Record<string, unknown>;
};

export type ConversationArchivedFilter = 'active' | 'all' | 'archived';

type State = {
  conversations: ConversationSummary[];
  archivedFilter: ConversationArchivedFilter;
  isLoading: boolean;
  isError: boolean;
  error?: string;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  archive: (conversationId: string) => Promise<void>;
  restore: (conversationId: string) => Promise<void>;
  bulkArchive: (conversationIds: string[]) => Promise<void>;
  bulkRestore: (conversationIds: string[]) => Promise<void>;
  bulkDelete: (conversationIds: string[]) => Promise<void>;
  setArchivedFilter: (filter: ConversationArchivedFilter) => void;
};

type ApiResponse = {
  items?: ConversationSummary[];
  nextCursor?: string;
};

const PAGE_SIZE = 20;

export function useConversations(params?: { agentName?: string }): State {
  const agentName = params?.agentName;
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [archivedFilter, setArchivedFilter] =
    useState<ConversationArchivedFilter>('active');
  const cursorRef = useRef<string | undefined>(undefined);
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
        console.info('[conversations] fetch start', {
          mode,
          agentName,
          archivedFilter,
          cursor: cursorRef.current,
        });
        const search = new URLSearchParams({ limit: `${PAGE_SIZE}` });
        if (archivedFilter === 'all') search.set('archived', 'true');
        if (archivedFilter === 'archived') search.set('archived', 'only');
        if (agentName) search.set('agentName', agentName);
        const cursorToUse = mode === 'append' ? cursorRef.current : undefined;
        if (mode === 'append' && cursorToUse) search.set('cursor', cursorToUse);
        const res = await fetch(
          new URL(`/conversations?${search.toString()}`, serverBase).toString(),
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(`Failed to load conversations (${res.status})`);
        }
        const data = (await res.json()) as ApiResponse;
        const items = (Array.isArray(data.items) ? data.items : []).map(
          (item) => ({
            ...item,
            source: item.source ?? 'REST',
          }),
        );
        setHasMore(Boolean(data.nextCursor));
        cursorRef.current = data.nextCursor;
        setConversations((prev) => {
          const merged = mode === 'append' ? [...prev, ...items] : items;
          return dedupeAndSort(merged);
        });
        console.info('[conversations] fetch success', {
          mode,
          received: items.length,
          hasMore: Boolean(data.nextCursor),
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
    [agentName, archivedFilter, dedupeAndSort],
  );

  useEffect(() => {
    cursorRef.current = undefined;
    cursorRef.current = undefined;
    setConversations([]);
    setHasMore(false);
    void fetchPage('replace');
    return () => controllerRef.current?.abort();
  }, [fetchPage, archivedFilter, agentName]);

  const refresh = useCallback(async () => {
    cursorRef.current = undefined;
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
            .filter((conv) => {
              if (archivedFilter === 'all') return true;
              if (archivedFilter === 'archived') return Boolean(conv.archived);
              return !conv.archived;
            }),
        ),
      );
    },
    [archivedFilter, dedupeAndSort],
  );

  const archive = useCallback(
    async (conversationId: string) => {
      await apiArchiveConversation({ conversationId });
      mutateArchiveFlag(conversationId, true);
    },
    [mutateArchiveFlag],
  );

  const restore = useCallback(
    async (conversationId: string) => {
      await apiRestoreConversation({ conversationId });
      mutateArchiveFlag(conversationId, false);
    },
    [mutateArchiveFlag],
  );

  const bulkArchive = useCallback(
    async (conversationIds: string[]) => {
      if (!conversationIds.length) return;
      await apiBulkArchiveConversations({ conversationIds });
      setConversations((prev) => {
        const selected = new Set(conversationIds);
        const updated = prev.map((conv) =>
          selected.has(conv.conversationId) ? { ...conv, archived: true } : conv,
        );
        return dedupeAndSort(
          updated.filter((conv) => {
            if (archivedFilter === 'all') return true;
            if (archivedFilter === 'archived') return Boolean(conv.archived);
            return !conv.archived;
          }),
        );
      });
    },
    [archivedFilter, dedupeAndSort],
  );

  const bulkRestore = useCallback(
    async (conversationIds: string[]) => {
      if (!conversationIds.length) return;
      await apiBulkRestoreConversations({ conversationIds });
      setConversations((prev) => {
        const selected = new Set(conversationIds);
        const updated = prev.map((conv) =>
          selected.has(conv.conversationId)
            ? { ...conv, archived: false }
            : conv,
        );
        return dedupeAndSort(
          updated.filter((conv) => {
            if (archivedFilter === 'all') return true;
            if (archivedFilter === 'archived') return Boolean(conv.archived);
            return !conv.archived;
          }),
        );
      });
    },
    [archivedFilter, dedupeAndSort],
  );

  const bulkDelete = useCallback(
    async (conversationIds: string[]) => {
      if (!conversationIds.length) return;
      await apiBulkDeleteConversations({ conversationIds });
      setConversations((prev) => {
        const selected = new Set(conversationIds);
        return dedupeAndSort(
          prev.filter((conv) => !selected.has(conv.conversationId)),
        );
      });
    },
    [dedupeAndSort],
  );

  return useMemo(
    () => ({
      conversations,
      archivedFilter,
      isLoading,
      isError,
      error,
      hasMore,
      refresh,
      loadMore,
      archive,
      restore,
      bulkArchive,
      bulkRestore,
      bulkDelete,
      setArchivedFilter,
    }),
    [
      conversations,
      archivedFilter,
      isLoading,
      isError,
      error,
      hasMore,
      refresh,
      loadMore,
      archive,
      restore,
      bulkArchive,
      bulkRestore,
      bulkDelete,
      setArchivedFilter,
    ],
  );
}

export default useConversations;
