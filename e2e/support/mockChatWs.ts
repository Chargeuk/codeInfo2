import type { Page } from '@playwright/test';
import type { WebSocketRoute } from 'playwright-core';

type WsSentMessage = {
  type?: string;
  conversationId?: string;
  inflightId?: string;
};

export type MockChatWsServer = {
  waitForConversationSubscription: (conversationId: string) => Promise<void>;
  getLastCancel: () => { conversationId: string; inflightId: string } | null;

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
  const subscribedConversationIds = new Set<string>();
  const subscriptionWaiters = new Map<string, Array<() => void>>();
  let lastCancel: { conversationId: string; inflightId: string } | null = null;

  let routeRef: WebSocketRoute | null = null;

  const waitForRoute = async () => {
    const startedAt = Date.now();
    while (!routeRef) {
      if (Date.now() - startedAt > 5000) {
        throw new Error('Timed out waiting for WebSocketRoute to attach');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return routeRef;
  };

  const onSubscribe = (conversationId: string) => {
    subscribedConversationIds.add(conversationId);
    const waiters = subscriptionWaiters.get(conversationId);
    if (!waiters) return;
    subscriptionWaiters.delete(conversationId);
    waiters.forEach((resolve) => resolve());
  };

  // Only WebSockets created after this call will be routed. Call this before page.goto().
  await page.routeWebSocket('**/ws', async (ws) => {
    routeRef = ws as unknown as WebSocketRoute;

    ws.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString();
      try {
        const parsed = JSON.parse(text) as WsSentMessage;
        if (parsed?.type === 'subscribe_conversation' && parsed.conversationId) {
          onSubscribe(String(parsed.conversationId));
        }
        if (parsed?.type === 'cancel_inflight' && parsed.conversationId && parsed.inflightId) {
          lastCancel = {
            conversationId: String(parsed.conversationId),
            inflightId: String(parsed.inflightId),
          };
        }
      } catch {
        // ignore
      }
    });
  });

  const sendTranscript = async (conversationId: string, payload: Record<string, unknown>) => {
    const ws = await waitForRoute();
    ws.send(JSON.stringify(withProtocol({ conversationId, ...payload })));
  };

  const seqByConversation = new Map<string, number>();
  const nextSeq = (conversationId: string) => {
    const next = (seqByConversation.get(conversationId) ?? 0) + 1;
    seqByConversation.set(conversationId, next);
    return next;
  };

  return {
    waitForConversationSubscription: async (conversationId: string) => {
      const id = String(conversationId);
      if (subscribedConversationIds.has(id)) return;

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for subscription to ${id}`));
        }, 5000);

        const waiters = subscriptionWaiters.get(id) ?? [];
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
        subscriptionWaiters.set(id, waiters);
      });
    },

    getLastCancel: () => lastCancel,

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

    sendFinal: async ({ conversationId, inflightId, status, threadId, error }) => {
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

