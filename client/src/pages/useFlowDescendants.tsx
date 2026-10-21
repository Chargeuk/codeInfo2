import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';
import {
  parseConversationSummary,
  type ConversationApiSummary,
} from '../api/conversations';
import useChatStream, { type ChatMessage } from '../hooks/useChatStream';
import type { ChatWsServerEvent } from '../hooks/useChatWs';
import useConversationTurns from '../hooks/useConversationTurns';
import { mapFlowTurnsToMessages } from './flowTranscriptHistory';

type TranscriptEvent = Parameters<
  ReturnType<typeof useChatStream>['handleWsEvent']
>[0];
type Subscription = (id: string) => void;
type Descendant = ConversationApiSummary;
type StreamRegistration = {
  event: (event: TranscriptEvent) => void;
  refresh: () => Promise<void>;
};

// Each child owns the existing single-conversation stream and history hooks, but
// uses the Flows page's socket. No child state enters the parent's run controls.
function DescendantStream({
  conversation,
  parentId,
  register,
  subscribe,
  unsubscribe,
  publish,
}: {
  conversation: Descendant;
  parentId: string;
  register: (id: string, stream: StreamRegistration | null) => void;
  subscribe: Subscription;
  unsubscribe: Subscription;
  publish: (id: string, messages: ChatMessage[], error?: string) => void;
}) {
  const id = conversation.conversationId;
  const {
    messages,
    conversationId: streamConversationId,
    setConversation,
    hydrateHistory,
    hydrateInflightSnapshot,
    handleWsEvent,
  } = useChatStream(conversation.model, conversation.provider);
  const { turns, inflight, isLoading, isError, error, refresh, reset } =
    useConversationTurns(id, { autoFetch: false });
  // Stream callbacks change with streaming state; initializing again would clear
  // an incoming child message. Keep initialization tied to conversation identity.
  const streamRef = useRef({ setConversation, handleWsEvent });
  streamRef.current = { setConversation, handleWsEvent };
  useEffect(() => {
    streamRef.current.setConversation(id, { clearMessages: true });
  }, [id]);
  useEffect(() => {
    // The hook clears inflight mappings when its conversation identity commits.
    // Subscribe only after those effects, so immediate catch-up survives them.
    if (streamConversationId !== id) return;
    register(id, {
      event: (event) => {
        streamRef.current.handleWsEvent(event);
        if (event.type === 'turn_final') void refresh();
      },
      refresh,
    });
    subscribe(id);
    // Subscribe before the REST snapshot: a child can complete while discovery
    // is loading. Finals refresh history and subscription snapshots catch live work.
    void refresh();
    return () => {
      register(id, null);
      unsubscribe(id);
      reset();
    };
  }, [
    id,
    streamConversationId,
    refresh,
    register,
    reset,
    subscribe,
    unsubscribe,
  ]);
  const hydratedTurns = useRef<typeof turns | null>(null);
  useEffect(() => {
    if (isLoading || hydratedTurns.current === turns) return;
    hydratedTurns.current = turns;
    hydrateHistory(id, mapFlowTurnsToMessages(turns), 'replace', {
      matchFullHistory: true,
    });
    hydrateInflightSnapshot(id, inflight);
  }, [id, turns, inflight, isLoading, hydrateHistory, hydrateInflightSnapshot]);
  const ancestors = conversation.flags!.flowChild!.ancestors!;
  const enriched = useMemo(
    () =>
      messages.map((message) => ({
        ...message,
        id: `${id}:${message.id}`,
        flowOrigin: {
          level:
            ancestors.length -
            ancestors.findIndex(
              (ancestor) => ancestor.conversationId === parentId,
            ),
          flowName: conversation.flowName!,
          ancestry: [
            ...ancestors,
            { conversationId: id, flowName: conversation.flowName! },
          ],
        },
      })),
    [messages, id, ancestors, parentId, conversation.flowName],
  );
  useEffect(() => {
    publish(
      id,
      enriched,
      isError
        ? `History unavailable for ${conversation.flowName} (${id})${error ? `: ${error}` : ''}`
        : undefined,
    );
  }, [id, enriched, publish, isError, error, conversation.flowName]);
  return null;
}

export default function useFlowDescendants(parentId: string | undefined) {
  const [descendants, setDescendants] = useState<Descendant[]>([]);
  const [transcripts, setTranscripts] = useState<
    Record<string, { messages: ChatMessage[]; error?: string }>
  >({});
  const [error, setError] = useState<string>();
  const streams = useRef(new Map<string, StreamRegistration>());
  const discoveryController = useRef<AbortController | null>(null);
  const currentParent = useRef(parentId);
  currentParent.current = parentId;
  const matches = useCallback(
    (conversation: Descendant) =>
      Boolean(
        parentId &&
          conversation.flowName &&
          !conversation.agentName &&
          conversation.flags?.flowChild?.ancestors?.some(
            (ancestor) => ancestor.conversationId === parentId,
          ),
      ),
    [parentId],
  );
  const register = useCallback(
    (id: string, stream: StreamRegistration | null) => {
      if (stream) streams.current.set(id, stream);
      else streams.current.delete(id);
    },
    [],
  );
  const publish = useCallback(
    (id: string, messages: ChatMessage[], error?: string) => {
      setTranscripts((previous) => ({ ...previous, [id]: { messages, error } }));
    },
    [],
  );
  const discover = useCallback(
    async (signal?: AbortSignal) => {
      if (!parentId) return;
      try {
        let cursor: string | undefined;
        do {
          const query = new URLSearchParams({
            ancestorConversationId: parentId,
            state: 'all',
            limit: '100',
          });
          if (cursor) query.set('cursor', cursor);
          const response = await fetch(
            new URL(`/conversations?${query}`, getApiBaseUrl()),
            { signal },
          );
          if (!response.ok)
            throw new Error(
              `Failed to load descendant conversations (${response.status})`,
            );
          const page = (await response.json()) as {
            items: unknown[];
            nextCursor?: string;
          };
          if (signal?.aborted || currentParent.current !== parentId) return;
          const items = page.items
            .map(parseConversationSummary)
            .filter(matches);
          // Preserve sidebar discoveries received while the list was in flight.
          setDescendants((previous) => [
            ...new Map(
              [...previous, ...items].map((item) => [
                item.conversationId,
                item,
              ]),
            ).values(),
          ]);
          cursor = page.nextCursor;
        } while (cursor);
        setError(undefined);
      } catch (cause) {
        if (!signal?.aborted && currentParent.current === parentId)
          setError((cause as Error).message);
      }
    },
    [parentId, matches],
  );
  useEffect(() => {
    setDescendants([]);
    setTranscripts({});
    setError(undefined);
    const controller = new AbortController();
    discoveryController.current = controller;
    void discover(controller.signal);
    return () => controller.abort();
  }, [discover]);
  const refresh = useCallback(async () => {
    await Promise.all([
      discover(discoveryController.current?.signal),
      ...[...streams.current.values()].map((stream) => stream.refresh()),
    ]);
  }, [discover]);
  const onEvent = useCallback(
    (event: ChatWsServerEvent) => {
      if (event.type === 'conversation_upsert') {
        const conversation = parseConversationSummary(event.conversation);
        if (matches(conversation))
          setDescendants((previous) => [
            ...previous.filter(
              (item) => item.conversationId !== conversation.conversationId,
            ),
            conversation,
          ]);
      } else if (event.type === 'conversation_delete') {
        setDescendants((previous) =>
          previous.filter(
            (item) => item.conversationId !== event.conversationId,
          ),
        );
      } else if (
        'conversationId' in event &&
        event.conversationId !== parentId
      ) {
        streams.current
          .get(event.conversationId)
          ?.event(event as TranscriptEvent);
      }
    },
    [matches, parentId],
  );
  const visibleDescendants = descendants.filter(matches);
  const messages = visibleDescendants.flatMap(
    (conversation) => transcripts[conversation.conversationId]?.messages ?? [],
  );
  const controllers = (subscribe: Subscription, unsubscribe: Subscription) =>
    parentId
      ? visibleDescendants.map((conversation) => (
          <DescendantStream
            key={`${parentId}:${conversation.conversationId}`}
            conversation={conversation}
            parentId={parentId}
            register={register}
            subscribe={subscribe}
            unsubscribe={unsubscribe}
            publish={publish}
          />
        ))
      : null;
  return {
    messages,
    controllers,
    onEvent,
    refresh,
    error:
      [
        error,
        ...visibleDescendants.map(
          (conversation) => transcripts[conversation.conversationId]?.error,
        ),
      ]
        .filter(Boolean)
        .join(' ') || undefined,
  };
}
