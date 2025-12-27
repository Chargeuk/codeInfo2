import type { Page } from '@playwright/test';

type WsSentMessage = {
  type?: string;
  conversationId?: string;
  inflightId?: string;
};

export type MockChatWsServer = {
  waitForConversationSubscription: (conversationId: string) => Promise<void>;
  getLastCancel: () => Promise<{ conversationId: string; inflightId: string } | null>;

  sendInflightSnapshot: (args: {
    conversationId: string;
    inflightId: string;
    assistantText?: string;
    assistantThink?: string;
    toolEvents?: unknown[];
  }) => Promise<void>;
  sendAssistantDelta: (args: {
    conversationId: string;
    inflightId: string;
    delta: string;
  }) => Promise<void>;
  sendAnalysisDelta: (args: {
    conversationId: string;
    inflightId: string;
    delta: string;
  }) => Promise<void>;
  sendToolEvent: (args: {
    conversationId: string;
    inflightId: string;
    event: unknown;
  }) => Promise<void>;
  sendFinal: (args: {
    conversationId: string;
    inflightId: string;
    status?: 'ok' | 'stopped' | 'failed';
    threadId?: string | null;
    error?: { code?: string; message?: string } | null;
  }) => Promise<void>;
};

function withProtocol(payload: Record<string, unknown>) {
  return { protocolVersion: 'v1', ...payload };
}

export async function installMockChatWs(page: Page): Promise<MockChatWsServer> {
  await page.addInitScript(() => {
    const globalAny = globalThis as unknown as Record<string, unknown>;

    type MockWsInstance = {
      url: string;
      readyState: number;
      sent: string[];
      onopen: ((ev: unknown) => void) | null;
      onclose: ((ev: unknown) => void) | null;
      onerror: ((ev: unknown) => void) | null;
      onmessage: ((ev: { data: unknown }) => void) | null;
      send: (data: unknown) => void;
      close: () => void;
      _receive: (data: unknown) => void;
    };

    const state = {
      instances: [] as MockWsInstance[],
      subscribedConversationIds: {} as Record<string, boolean>,
      lastCancel: null as null | { conversationId: string; inflightId: string },
    };

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      url: string;
      readyState = MockWebSocket.CONNECTING;
      sent: string[] = [];
      onopen: ((ev: unknown) => void) | null = null;
      onclose: ((ev: unknown) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      onmessage: ((ev: { data: unknown }) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        state.instances.push(this as unknown as MockWsInstance);
        setTimeout(() => {
          if (this.readyState !== MockWebSocket.CONNECTING) return;
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.({});
        }, 0);
      }

      send(data: unknown) {
        const text = typeof data === 'string' ? data : String(data);
        this.sent.push(text);
        try {
          const parsed = JSON.parse(text) as WsSentMessage;
          if (parsed?.type === 'subscribe_conversation' && parsed.conversationId) {
            state.subscribedConversationIds[String(parsed.conversationId)] = true;
          }
          if (parsed?.type === 'cancel_inflight' && parsed.conversationId && parsed.inflightId) {
            state.lastCancel = {
              conversationId: String(parsed.conversationId),
              inflightId: String(parsed.inflightId),
            };
          }
        } catch {
          // ignore
        }
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({});
      }

      _receive(data: unknown) {
        const payload = typeof data === 'string' ? data : JSON.stringify(data ?? null);
        this.onmessage?.({ data: payload });
      }
    }

    globalAny.__CODEINFO_E2E_WS__ = state;
    // @ts-expect-error override WebSocket in browser for E2E
    globalAny.WebSocket = MockWebSocket;
  });

  const receiveOnLastSocket = async (payload: Record<string, unknown>) => {
    await page.evaluate((message) => {
      const globalAny = globalThis as unknown as Record<string, any>;
      const state = globalAny.__CODEINFO_E2E_WS__ as {
        instances: Array<{ _receive: (data: unknown) => void }>;
      };
      const last = state.instances.at(-1);
      if (!last) return;
      last._receive(message);
    }, payload);
  };

  const sendTranscript = async (
    conversationId: string,
    payload: Record<string, unknown>,
  ) => {
    await receiveOnLastSocket(withProtocol({ conversationId, ...payload }));
  };

  const seqByConversation = new Map<string, number>();
  const nextSeq = (conversationId: string) => {
    const next = (seqByConversation.get(conversationId) ?? 0) + 1;
    seqByConversation.set(conversationId, next);
    return next;
  };

  return {
    waitForConversationSubscription: async (conversationId: string) => {
      await page.waitForFunction((id) => {
        const globalAny = globalThis as unknown as Record<string, any>;
        const state = globalAny.__CODEINFO_E2E_WS__ as {
          subscribedConversationIds: Record<string, boolean>;
        };
        return Boolean(state?.subscribedConversationIds?.[String(id)]);
      }, conversationId);
    },

    getLastCancel: async () => {
      return page.evaluate(() => {
        const globalAny = globalThis as unknown as Record<string, any>;
        const state = globalAny.__CODEINFO_E2E_WS__ as {
          lastCancel: null | { conversationId: string; inflightId: string };
        };
        return state?.lastCancel ?? null;
      });
    },

    sendInflightSnapshot: async ({
      conversationId,
      inflightId,
      assistantText,
      assistantThink,
      toolEvents,
    }) => {
      await sendTranscript(conversationId, {
        type: 'inflight_snapshot',
        seq: nextSeq(conversationId),
        inflight: {
          inflightId,
          assistantText: assistantText ?? '',
          assistantThink: assistantThink ?? '',
          toolEvents: toolEvents ?? [],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      });
    },

    sendAssistantDelta: async ({ conversationId, inflightId, delta }) => {
      await sendTranscript(conversationId, {
        type: 'assistant_delta',
        seq: nextSeq(conversationId),
        inflightId,
        delta,
      });
    },

    sendAnalysisDelta: async ({ conversationId, inflightId, delta }) => {
      await sendTranscript(conversationId, {
        type: 'analysis_delta',
        seq: nextSeq(conversationId),
        inflightId,
        delta,
      });
    },

    sendToolEvent: async ({ conversationId, inflightId, event }) => {
      await sendTranscript(conversationId, {
        type: 'tool_event',
        seq: nextSeq(conversationId),
        inflightId,
        event,
      });
    },

    sendFinal: async ({
      conversationId,
      inflightId,
      status,
      threadId,
      error,
    }) => {
      await sendTranscript(conversationId, {
        type: 'turn_final',
        seq: nextSeq(conversationId),
        inflightId,
        status: status ?? 'ok',
        threadId: threadId ?? null,
        ...(error !== undefined ? { error } : {}),
      });
    },
  };
}
