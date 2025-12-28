import { act } from '@testing-library/react';

type WsMock = {
  sent: string[];
  _receive: (data: unknown) => void;
};

type WsMockRegistry = {
  reset: () => void;
  last: () => WsMock | null;
  instances?: WsMock[];
};

function wsRegistry(): WsMockRegistry {
  return (globalThis as unknown as { __wsMock?: WsMockRegistry }).__wsMock!;
}

const defaultProviders = {
  providers: [
    {
      id: 'lmstudio',
      label: 'LM Studio',
      available: true,
      toolsAvailable: true,
    },
  ],
};

const defaultModels = {
  provider: 'lmstudio',
  available: true,
  toolsAvailable: true,
  models: [{ key: 'm1', displayName: 'Model 1', type: 'gguf' }],
};

export function setupChatWsHarness(params: {
  mockFetch: {
    mockImplementation: (
      fn: (url: RequestInfo | URL, opts?: RequestInit) => unknown,
    ) => void;
  };
  providers?: unknown;
  models?: unknown;
  health?: unknown;
  conversations?: unknown;
}) {
  const chatBodies: Record<string, unknown>[] = [];
  let lastConversationId: string | null = null;
  let lastInflightId: string | null = null;
  let seq = 0;

  const providersPayload = params.providers ?? defaultProviders;
  const modelsPayload = params.models ?? defaultModels;
  const healthPayload = params.health ?? { mongoConnected: true };
  const conversationsPayload = params.conversations ?? {
    items: [],
    nextCursor: null,
  };

  params.mockFetch.mockImplementation(
    (url: RequestInfo | URL, opts?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString();

      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => healthPayload,
        }) as unknown as Response;
      }

      if (href.includes('/chat/providers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => providersPayload,
        }) as unknown as Response;
      }

      if (href.includes('/chat/models')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => modelsPayload,
        }) as unknown as Response;
      }

      if (href.includes('/conversations') && opts?.method !== 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => conversationsPayload,
        }) as unknown as Response;
      }

      if (href.includes('/chat') && opts?.method === 'POST') {
        const body =
          typeof opts?.body === 'string'
            ? (JSON.parse(opts.body) as Record<string, unknown>)
            : {};
        chatBodies.push(body);
        lastConversationId =
          typeof body.conversationId === 'string' ? body.conversationId : null;
        lastInflightId =
          typeof body.inflightId === 'string' ? body.inflightId : 'i1';

        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            status: 'started',
            conversationId: lastConversationId,
            inflightId: lastInflightId,
            provider: body.provider,
            model: body.model,
          }),
        }) as unknown as Response;
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
    },
  );

  const sockets = () => {
    const registry = wsRegistry();
    const instances = registry.instances ?? [];
    if (instances.length === 0) {
      const socket = registry.last();
      if (!socket) {
        throw new Error('No WebSocket instance created; did ChatPage mount?');
      }
      return [socket];
    }
    return instances;
  };

  const nextSeq = () => {
    seq += 1;
    return seq;
  };

  const emit = (event: Record<string, unknown>) => {
    setTimeout(() => {
      const withProtocol = { protocolVersion: 'v1', ...event };
      const handler =
        typeof window !== 'undefined'
          ? (
              window as unknown as {
                __chatTest?: { handleWsEvent?: (ev: unknown) => void };
              }
            ).__chatTest?.handleWsEvent
          : undefined;

      const isTranscript =
        withProtocol.type === 'inflight_snapshot' ||
        withProtocol.type === 'assistant_delta' ||
        withProtocol.type === 'analysis_delta' ||
        withProtocol.type === 'tool_event' ||
        withProtocol.type === 'turn_final';

      if (typeof handler === 'function' && isTranscript) {
        act(() => {
          handler(withProtocol);
        });
        return;
      }

      sockets().forEach((socket) => {
        socket._receive(withProtocol);
      });
    }, 0);
  };

  return {
    resetWs: () => wsRegistry().reset(),
    chatBodies,
    getConversationId: () => lastConversationId,
    getInflightId: () => lastInflightId,
    emitSidebarUpsert: (conversation: Record<string, unknown>) => {
      emit({ type: 'conversation_upsert', seq: nextSeq(), conversation });
    },
    emitSidebarDelete: (conversationId: string) => {
      emit({ type: 'conversation_delete', seq: nextSeq(), conversationId });
    },
    emitInflightSnapshot: (payload: {
      conversationId: string;
      inflightId: string;
      assistantText?: string;
      assistantThink?: string;
      toolEvents?: unknown[];
      startedAt?: string;
    }) => {
      emit({
        type: 'inflight_snapshot',
        conversationId: payload.conversationId,
        seq: nextSeq(),
        inflight: {
          inflightId: payload.inflightId,
          assistantText: payload.assistantText ?? '',
          assistantThink: payload.assistantThink ?? '',
          toolEvents: payload.toolEvents ?? [],
          startedAt: payload.startedAt ?? '2025-01-01T00:00:00.000Z',
        },
      });
    },
    emitAssistantDelta: (payload: {
      conversationId: string;
      inflightId: string;
      delta: string;
    }) => {
      emit({
        type: 'assistant_delta',
        conversationId: payload.conversationId,
        seq: nextSeq(),
        inflightId: payload.inflightId,
        delta: payload.delta,
      });
    },
    emitAnalysisDelta: (payload: {
      conversationId: string;
      inflightId: string;
      delta: string;
    }) => {
      emit({
        type: 'analysis_delta',
        conversationId: payload.conversationId,
        seq: nextSeq(),
        inflightId: payload.inflightId,
        delta: payload.delta,
      });
    },
    emitToolEvent: (payload: {
      conversationId: string;
      inflightId: string;
      event: Record<string, unknown>;
    }) => {
      emit({
        type: 'tool_event',
        conversationId: payload.conversationId,
        seq: nextSeq(),
        inflightId: payload.inflightId,
        event: payload.event,
      });
    },
    emitFinal: (payload: {
      conversationId: string;
      inflightId: string;
      status?: 'ok' | 'stopped' | 'failed';
      threadId?: string | null;
      error?: { code?: string; message?: string } | null;
    }) => {
      emit({
        type: 'turn_final',
        conversationId: payload.conversationId,
        seq: nextSeq(),
        inflightId: payload.inflightId,
        status: payload.status ?? 'ok',
        threadId: payload.threadId ?? null,
        ...(payload.error !== undefined ? { error: payload.error } : {}),
      });
    },
  };
}
