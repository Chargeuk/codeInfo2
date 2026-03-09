import { act } from '@testing-library/react';
import {
  asFetchImplementation,
  getFetchMock,
  mockJsonResponse,
  type TestFetchMock,
} from './fetchMock';
import type {
  WebSocketMockInstance,
  WebSocketMockRegistry,
} from './mockWebSocket';

type MockFetchReturn = Response | Promise<Response>;
type JsonPayload = Record<string, unknown>;
type ChatHarnessFetch = (
  url: RequestInfo | URL,
  opts?: RequestInit,
) => MockFetchReturn;
type TranscriptEventType =
  | 'user_turn'
  | 'inflight_snapshot'
  | 'stream_warning'
  | 'assistant_delta'
  | 'analysis_delta'
  | 'tool_event'
  | 'turn_final';

type ControlEvent = {
  type: 'cancel_ack';
  conversationId: string;
  requestId: string;
  result: 'noop';
};

type TranscriptEvent = {
  type: TranscriptEventType;
  conversationId: string;
  seq: number;
  inflightId?: string;
} & JsonPayload;

type SidebarEvent =
  | {
      type: 'conversation_upsert';
      seq: number;
      conversation: JsonPayload;
    }
  | {
      type: 'conversation_delete';
      seq: number;
      conversationId: string;
    };

type HarnessEvent = TranscriptEvent | SidebarEvent | ControlEvent;

function wsRegistry(): WebSocketMockRegistry {
  const registry = globalThis.__wsMock;
  if (!registry) {
    throw new Error('Missing __wsMock registry; is setupTests.ts running?');
  }
  return registry;
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
  mockFetch?: TestFetchMock;
  providers?: JsonPayload;
  models?: JsonPayload;
  health?: JsonPayload;
  conversations?: JsonPayload;
  turns?: JsonPayload;
  chatFetch?: (
    body: Record<string, unknown>,
    opts?: RequestInit,
  ) => MockFetchReturn;
  fallbackFetch?: ChatHarnessFetch;
}) {
  const chatBodies: JsonPayload[] = [];
  let lastConversationId: string | null = null;
  let lastInflightId: string | null = null;
  let seq = 0;
  const mockFetch = params.mockFetch ?? getFetchMock();

  const providersPayload = params.providers ?? defaultProviders;
  const modelsPayload = params.models ?? defaultModels;
  const healthPayload = params.health ?? { mongoConnected: true };
  const conversationsPayload = params.conversations ?? {
    items: [],
    nextCursor: null,
  };
  const turnsPayload = params.turns ?? {
    items: [],
    nextCursor: null,
  };

  mockFetch.mockImplementation(
    asFetchImplementation((url: RequestInfo | URL, opts?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString();

      if (href.includes('/health')) {
        return mockJsonResponse(healthPayload);
      }

      if (href.includes('/chat/providers')) {
        return mockJsonResponse(providersPayload);
      }

      if (href.includes('/chat/models')) {
        return mockJsonResponse(modelsPayload);
      }

      if (href.includes('/conversations/') && href.includes('/turns')) {
        return mockJsonResponse(turnsPayload);
      }

      if (href.includes('/conversations') && opts?.method !== 'POST') {
        return mockJsonResponse(conversationsPayload);
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

        if (params.chatFetch) {
          return params.chatFetch(body, opts);
        }

        return mockJsonResponse(
          {
            status: 'started',
            conversationId: lastConversationId,
            inflightId: lastInflightId,
            provider: body.provider,
            model: body.model,
          },
          { status: 202 },
        );
      }

      if (params.fallbackFetch) {
        return params.fallbackFetch(url, opts);
      }

      return mockJsonResponse({});
    }),
  );

  const sockets = (): WebSocketMockInstance[] => {
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

  const emit = (event: HarnessEvent) => {
    setTimeout(() => {
      const withProtocol = { protocolVersion: 'v1', ...event };
      const handler =
        typeof window !== 'undefined'
          ? window.__chatTest?.handleWsEvent
          : undefined;

      const isTranscript =
        withProtocol.type === 'user_turn' ||
        withProtocol.type === 'inflight_snapshot' ||
        withProtocol.type === 'stream_warning' ||
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
    setSeq: (value: number) => {
      seq = value;
    },
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
      command?: {
        name?: string;
        stepIndex?: number;
        totalSteps?: number;
        loopDepth?: number;
        label?: string;
        agentType?: string;
        identifier?: string;
      };
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
          ...(payload.command ? { command: payload.command } : {}),
        },
      });
    },
    emitUserTurn: (payload: {
      conversationId: string;
      inflightId: string;
      content: string;
      createdAt?: string;
    }) => {
      emit({
        type: 'user_turn',
        conversationId: payload.conversationId,
        seq: nextSeq(),
        inflightId: payload.inflightId,
        content: payload.content,
        createdAt: payload.createdAt ?? '2025-01-01T00:00:00.000Z',
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
    emitStreamWarning: (payload: {
      conversationId: string;
      inflightId: string;
      message: string;
    }) => {
      emit({
        type: 'stream_warning',
        conversationId: payload.conversationId,
        seq: nextSeq(),
        inflightId: payload.inflightId,
        message: payload.message,
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
      event: JsonPayload;
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
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        cachedInputTokens?: number;
      };
      timing?: { totalTimeSec?: number; tokensPerSecond?: number };
    }) => {
      emit({
        type: 'turn_final',
        conversationId: payload.conversationId,
        seq: nextSeq(),
        inflightId: payload.inflightId,
        status: payload.status ?? 'ok',
        threadId: payload.threadId ?? null,
        ...(payload.usage ? { usage: payload.usage } : {}),
        ...(payload.timing ? { timing: payload.timing } : {}),
        ...(payload.error !== undefined ? { error: payload.error } : {}),
      });
    },
    emitCancelAck: (payload: {
      conversationId: string;
      requestId: string;
      result?: 'noop';
    }) => {
      emit({
        type: 'cancel_ack',
        conversationId: payload.conversationId,
        requestId: payload.requestId,
        result: payload.result ?? 'noop',
      });
    },
  };
}
