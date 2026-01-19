import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';
import { createLogger } from '../logging/logger';

const serverBase = getApiBaseUrl();

export type ConversationSummary = {
  conversationId: string;
  title: string;
  provider: string;
  model: string;
  source?: 'REST' | 'MCP';
  lastMessageAt?: string;
  archived?: boolean;
  flags?: Record<string, unknown>;
  agentName?: string;
  flowName?: string;
};

export type ConversationFilterState = 'active' | 'all' | 'archived';

export type ConversationBulkAction = 'archive' | 'restore' | 'delete';

export type ConversationBulkError = Error & {
  code: string;
  httpStatus?: number;
};

type State = {
  conversations: ConversationSummary[];
  filterState: ConversationFilterState;
  isLoading: boolean;
  isError: boolean;
  error?: string;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  archive: (conversationId: string) => Promise<void>;
  restore: (conversationId: string) => Promise<void>;
  bulkArchive: (conversationIds: string[]) => Promise<{ updatedCount: number }>;
  bulkRestore: (conversationIds: string[]) => Promise<{ updatedCount: number }>;
  bulkDelete: (conversationIds: string[]) => Promise<{ deletedCount: number }>;
  applyWsUpsert: (conversation: ConversationSummary) => void;
  applyWsDelete: (conversationId: string) => void;
  setFilterState: (state: ConversationFilterState) => void;
};

type ApiResponse = {
  items?: ConversationSummary[];
  nextCursor?: string;
};

type BulkOkResponse =
  | { status: 'ok'; updatedCount: number }
  | { status: 'ok'; deletedCount: number };

type BulkErrorResponse = {
  status?: 'error';
  code?: string;
  message?: string;
};

const PAGE_SIZE = 20;

export function useConversations(params?: {
  agentName?: string;
  flowName?: string;
}): State {
  const agentName = params?.agentName;
  const flowName = params?.flowName;
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [filterState, setFilterState] =
    useState<ConversationFilterState>('active');
  const cursorRef = useRef<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const controllerRef = useRef<AbortController | null>(null);
  const log = useMemo(() => createLogger('client-flows'), []);

  const normalizedFlowName =
    typeof flowName === 'string' ? flowName.trim() : '';

  const applyFilter = useCallback(
    (items: ConversationSummary[]) => {
      const flowFiltered = normalizedFlowName
        ? items.filter((item) => {
            if (normalizedFlowName === '__none__') {
              return !item.flowName;
            }
            return item.flowName === normalizedFlowName;
          })
        : items;
      if (filterState === 'all') return flowFiltered;
      if (filterState === 'archived') {
        return flowFiltered.filter((item) => Boolean(item.archived));
      }
      return flowFiltered.filter((item) => !item.archived);
    },
    [filterState, normalizedFlowName],
  );

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
          flowName: normalizedFlowName,
          filterState,
          cursor: cursorRef.current,
        });
        log('info', 'flows.filter.requested', {
          flowName: normalizedFlowName || '__all__',
        });
        const search = new URLSearchParams({ limit: `${PAGE_SIZE}` });
        search.set('state', filterState);
        if (agentName) search.set('agentName', agentName);
        if (normalizedFlowName) search.set('flowName', normalizedFlowName);
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
          return dedupeAndSort(applyFilter(merged));
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
    [
      agentName,
      filterState,
      normalizedFlowName,
      log,
      dedupeAndSort,
      applyFilter,
    ],
  );

  useEffect(() => {
    cursorRef.current = undefined;
    setConversations([]);
    setHasMore(false);
    void fetchPage('replace');
    return () => controllerRef.current?.abort();
  }, [fetchPage]);

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
              if (filterState === 'all') return true;
              if (filterState === 'archived') return Boolean(conv.archived);
              return !conv.archived;
            }),
        ),
      );
    },
    [dedupeAndSort, filterState],
  );

  const archive = useCallback(
    async (conversationId: string) => {
      const res = await fetch(
        new URL(
          `/conversations/${conversationId}/archive`,
          serverBase,
        ).toString(),
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(`Archive failed (${res.status})`);
      mutateArchiveFlag(conversationId, true);
    },
    [mutateArchiveFlag],
  );

  const restore = useCallback(
    async (conversationId: string) => {
      const res = await fetch(
        new URL(
          `/conversations/${conversationId}/restore`,
          serverBase,
        ).toString(),
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(`Restore failed (${res.status})`);
      mutateArchiveFlag(conversationId, false);
    },
    [mutateArchiveFlag],
  );

  const postBulk = useCallback(
    async (action: ConversationBulkAction, conversationIds: string[]) => {
      const res = await fetch(
        new URL(`/conversations/bulk/${action}`, serverBase).toString(),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ conversationIds }),
        },
      );

      const payload = (await res.json().catch(() => null)) as
        | BulkOkResponse
        | BulkErrorResponse
        | null;

      if (!res.ok) {
        const err = new Error(
          typeof payload?.message === 'string'
            ? payload.message
            : `Bulk ${action} failed (${res.status})`,
        ) as ConversationBulkError;
        err.code =
          typeof payload?.code === 'string'
            ? payload.code
            : `HTTP_${res.status}`;
        err.httpStatus = res.status;
        throw err;
      }

      return payload as BulkOkResponse;
    },
    [],
  );

  const bulkArchive = useCallback(
    async (conversationIds: string[]) => {
      const payload = await postBulk('archive', conversationIds);
      const updatedCount =
        'updatedCount' in payload
          ? payload.updatedCount
          : conversationIds.length;
      setConversations((prev) =>
        dedupeAndSort(
          applyFilter(
            prev.map((conv) =>
              conversationIds.includes(conv.conversationId)
                ? { ...conv, archived: true }
                : conv,
            ),
          ),
        ),
      );
      return { updatedCount };
    },
    [applyFilter, dedupeAndSort, postBulk],
  );

  const bulkRestore = useCallback(
    async (conversationIds: string[]) => {
      const payload = await postBulk('restore', conversationIds);
      const updatedCount =
        'updatedCount' in payload
          ? payload.updatedCount
          : conversationIds.length;
      setConversations((prev) =>
        dedupeAndSort(
          applyFilter(
            prev.map((conv) =>
              conversationIds.includes(conv.conversationId)
                ? { ...conv, archived: false }
                : conv,
            ),
          ),
        ),
      );
      return { updatedCount };
    },
    [applyFilter, dedupeAndSort, postBulk],
  );

  const bulkDelete = useCallback(
    async (conversationIds: string[]) => {
      const payload = await postBulk('delete', conversationIds);
      const deletedCount =
        'deletedCount' in payload
          ? payload.deletedCount
          : conversationIds.length;
      setConversations((prev) =>
        dedupeAndSort(
          applyFilter(
            prev.filter(
              (conv) => !conversationIds.includes(conv.conversationId),
            ),
          ),
        ),
      );
      return { deletedCount };
    },
    [applyFilter, dedupeAndSort, postBulk],
  );

  const applyWsUpsert = useCallback(
    (conversation: ConversationSummary) => {
      setConversations((prev) =>
        dedupeAndSort(
          applyFilter([
            {
              ...conversation,
              source: conversation.source ?? 'REST',
            },
            ...prev.filter(
              (c) => c.conversationId !== conversation.conversationId,
            ),
          ]),
        ),
      );
    },
    [applyFilter, dedupeAndSort],
  );

  const applyWsDelete = useCallback(
    (conversationId: string) => {
      setConversations((prev) =>
        dedupeAndSort(
          applyFilter(prev.filter((c) => c.conversationId !== conversationId)),
        ),
      );
    },
    [applyFilter, dedupeAndSort],
  );

  return useMemo(
    () => ({
      conversations,
      filterState,
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
      applyWsUpsert,
      applyWsDelete,
      setFilterState,
    }),
    [
      conversations,
      filterState,
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
      applyWsUpsert,
      applyWsDelete,
      setFilterState,
    ],
  );
}

export default useConversations;
