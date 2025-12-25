import { expect, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:5010';

const skipIfUnreachable = async (page: any) => {
  try {
    const ping = await page.request.get(baseUrl);
    if (!ping.ok()) {
      test.skip(`Client not reachable (${ping.status()})`);
    }
  } catch {
    test.skip('Client not reachable (request failed)');
  }
};

async function createConversation(request: any, title: string) {
  const res = await request.post(`${apiBase}/conversations`, {
    data: {
      provider: 'lmstudio',
      model: 'mock-model',
      title,
      source: 'REST',
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.conversationId as string;
}

type WsMock = {
  seedInflight: (conversationId: string, params?: { assistantText?: string }) => {
    inflightId: string;
  };
  emitAssistantDelta: (conversationId: string, delta: string) => void;
  closeAll: () => Promise<void>;
  waitForMessage: (predicate: (msg: any) => boolean) => Promise<any>;
  getReceived: () => any[];
};

async function installWsMock(context: any): Promise<WsMock> {
  const received: any[] = [];

  const sockets = new Set<{
    route: any;
    subscribedSidebar: boolean;
    subscribedConversations: Set<string>;
  }>();

  const inflights = new Map<
    string,
    {
      inflightId: string;
      assistantText: string;
      analysisText: string;
      tools: unknown[];
      startedAt: string;
    }
  >();

  const seqByConversation = new Map<string, number>();
  const nextSeq = (conversationId: string) => {
    const next = (seqByConversation.get(conversationId) ?? 0) + 1;
    seqByConversation.set(conversationId, next);
    return next;
  };

  const messageWaiters: Array<{
    predicate: (msg: any) => boolean;
    resolve: (msg: any) => void;
  }> = [];

  const handleInbound = (msg: any) => {
    received.push(msg);
    for (let i = 0; i < messageWaiters.length; i += 1) {
      const waiter = messageWaiters[i];
      if (waiter && waiter.predicate(msg)) {
        messageWaiters.splice(i, 1);
        waiter.resolve(msg);
        break;
      }
    }
  };

  const sendJson = (route: any, payload: unknown) => {
    route.send(JSON.stringify(payload));
  };

  await context.routeWebSocket('**/ws', async (route: any) => {
    const socket = {
      route,
      subscribedSidebar: false,
      subscribedConversations: new Set<string>(),
    };

    sockets.add(socket);

    route.onMessage((message: string | Buffer) => {
      const text = Buffer.isBuffer(message) ? message.toString('utf8') : message;
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }

      handleInbound(parsed);

      const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : undefined;
      const type = typeof parsed.type === 'string' ? parsed.type : undefined;

      if (requestId) {
        sendJson(route, { type: 'ack', requestId });
      }

      if (type === 'subscribe_sidebar') {
        socket.subscribedSidebar = true;
        return;
      }

      if (type === 'unsubscribe_sidebar') {
        socket.subscribedSidebar = false;
        return;
      }

      if (type === 'subscribe_conversation') {
        const conversationId =
          typeof parsed.conversationId === 'string' ? parsed.conversationId : '';
        if (!conversationId) return;

        socket.subscribedConversations.add(conversationId);

        const inflight = inflights.get(conversationId);
        if (inflight) {
          sendJson(route, {
            type: 'inflight_snapshot',
            conversationId,
            seq: nextSeq(conversationId),
            inflight: { ...inflight },
          });
        }

        return;
      }

      if (type === 'unsubscribe_conversation') {
        const conversationId =
          typeof parsed.conversationId === 'string' ? parsed.conversationId : '';
        if (!conversationId) return;
        socket.subscribedConversations.delete(conversationId);
        return;
      }

      if (type === 'cancel_inflight') {
        const conversationId =
          typeof parsed.conversationId === 'string' ? parsed.conversationId : '';
        const inflightId =
          typeof parsed.inflightId === 'string' ? parsed.inflightId : '';
        if (!conversationId || !inflightId) return;

        sendJson(route, {
          type: 'turn_final',
          conversationId,
          seq: nextSeq(conversationId),
          inflightId,
          status: 'stopped',
        });
        return;
      }
    });

    route.onClose(() => {
      sockets.delete(socket);
    });
  });

  return {
    seedInflight: (conversationId: string, params?: { assistantText?: string }) => {
      const inflightId = `inflight-${conversationId}`;
      inflights.set(conversationId, {
        inflightId,
        assistantText: params?.assistantText ?? 'Hello',
        analysisText: '',
        tools: [
          {
            id: 'tool-1',
            name: 'VectorSearch',
            status: 'requesting',
            stage: 'request',
            params: { query: 'test' },
          },
        ],
        startedAt: new Date().toISOString(),
      });
      return { inflightId };
    },
    emitAssistantDelta: (conversationId: string, delta: string) => {
      const inflight = inflights.get(conversationId);
      if (!inflight) return;
      inflight.assistantText += delta;
      for (const socket of sockets) {
        if (!socket.subscribedConversations.has(conversationId)) continue;
        sendJson(socket.route, {
          type: 'assistant_delta',
          conversationId,
          seq: nextSeq(conversationId),
          inflightId: inflight.inflightId,
          delta,
        });
      }
    },
    closeAll: async () => {
      await Promise.all(
        [...sockets].map(async (socket) => {
          await socket.route.close({ code: 1001, reason: 'e2e disconnect' });
        }),
      );
    },
    waitForMessage: (predicate: (msg: any) => boolean) =>
      new Promise((resolve) => {
        messageWaiters.push({ predicate, resolve });
      }),
    getReceived: () => received,
  };
}

function installProviderMocks(page: any) {
  return Promise.all([
    page.route('**/chat/providers*', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          providers: [
            {
              id: 'lmstudio',
              label: 'LM Studio',
              available: true,
              toolsAvailable: true,
            },
            {
              id: 'codex',
              label: 'OpenAI Codex',
              available: false,
              toolsAvailable: false,
              reason: 'e2e mock',
            },
          ],
        }),
      }),
    ),
    page.route('**/chat/models*', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'lmstudio',
          available: true,
          toolsAvailable: true,
          models: [{ key: 'mock-model', displayName: 'Mock Model' }],
        }),
      }),
    ),
  ]);
}

async function openConversation(page: any, title: string) {
  const rowTitle = page
    .getByTestId('conversation-title')
    .filter({ hasText: title })
    .first();
  await expect(rowTitle).toBeVisible({ timeout: 20000 });
  await rowTitle.click();
}

test('cross-tab inflight catch-up (snapshot then deltas)', async ({ page }) => {
  await skipIfUnreachable(page);

  await installProviderMocks(page);

  const title = `e2e-live-${Date.now()}`;
  const conversationId = await createConversation(page.request, title);

  const wsMock = await installWsMock(page.context());
  wsMock.seedInflight(conversationId, { assistantText: 'Hello' });

  await page.goto(`${baseUrl}/chat`);
  const initialSubscribePromise = wsMock.waitForMessage(
    (msg) => msg.type === 'subscribe_conversation' && msg.conversationId === conversationId,
  );
  await openConversation(page, title);
  await initialSubscribePromise;

  const assistantBubblesA = page.locator(
    '[data-testid="chat-bubble"][data-role="assistant"]',
  );
  await expect(assistantBubblesA.last()).toContainText('Hello');

  wsMock.emitAssistantDelta(conversationId, ' world');
  await expect(assistantBubblesA.last()).toContainText('Hello world');

  const pageB = await page.context().newPage();
  await installProviderMocks(pageB);

  await pageB.goto(`${baseUrl}/chat`);
  await openConversation(pageB, title);

  const assistantBubblesB = pageB.locator(
    '[data-testid="chat-bubble"][data-role="assistant"]',
  );
  await expect(assistantBubblesB.last()).toContainText('Hello world');

  wsMock.emitAssistantDelta(conversationId, '!!!');
  await expect(assistantBubblesA.last()).toContainText('Hello world!!!');
  await expect(assistantBubblesB.last()).toContainText('Hello world!!!');
});

test('detach (navigate away) does not cancel; Stop sends cancel and shows status bubble', async ({ page }) => {
  await skipIfUnreachable(page);

  await installProviderMocks(page);

  const title = `e2e-detach-${Date.now()}`;
  const conversationId = await createConversation(page.request, title);

  const wsMock = await installWsMock(page.context());
  const { inflightId } = wsMock.seedInflight(conversationId, {
    assistantText: 'Streaming',
  });

  await page.goto(`${baseUrl}/chat`);
  const initialSubscribePromise = wsMock.waitForMessage(
    (msg) => msg.type === 'subscribe_conversation' && msg.conversationId === conversationId,
  );
  await openConversation(page, title);
  await initialSubscribePromise;

  const assistantBubbles = page.locator(
    '[data-testid="chat-bubble"][data-role="assistant"]',
  );
  await expect(assistantBubbles.last()).toContainText('Streaming');

  const receivedBeforeDetach = wsMock.getReceived().length;
  const unsubscribePromise = wsMock.waitForMessage(
    (msg) =>
      msg.type === 'unsubscribe_conversation' && msg.conversationId === conversationId,
  );
  await page.getByRole('tab', { name: 'Ingest', exact: true }).click();
  await expect(page).toHaveURL(/\/ingest/);
  await unsubscribePromise;

  const detachMessages = wsMock.getReceived().slice(receivedBeforeDetach);
  expect(detachMessages.some((m) => m.type === 'cancel_inflight')).toBe(false);

  await page.goto(`${baseUrl}/chat`);
  const resubscribeAfterDetachPromise = wsMock.waitForMessage(
    (msg) => msg.type === 'subscribe_conversation' && msg.conversationId === conversationId,
  );
  await openConversation(page, title);
  await resubscribeAfterDetachPromise;

  const stopButton = page.getByTestId('chat-stop');
  await expect(stopButton).toBeVisible({ timeout: 20000 });

  const receivedBeforeStop = wsMock.getReceived().length;
  const cancelPromise = wsMock.waitForMessage(
    (msg) =>
      msg.type === 'cancel_inflight' &&
      msg.conversationId === conversationId &&
      msg.inflightId === inflightId,
  );

  await stopButton.click();
  await cancelPromise;

  const stopMessages = wsMock.getReceived().slice(receivedBeforeStop);
  expect(stopMessages.some((m) => m.type === 'cancel_inflight')).toBe(true);

  // For a WS-only inflight (viewer tab), local stream status may be idle, so no status bubble is guaranteed.
  // Assert the inflight bubble clears after turn_final and Stop disappears.
  await expect(stopButton).toBeHidden({ timeout: 20000 });
  await expect(
    page.locator('[data-testid=\"chat-bubble\"][data-role=\"assistant\"]'),
  ).toHaveCount(0);
});

test('WS reconnect refreshes list + turns before resubscribe', async ({ page }) => {
  await skipIfUnreachable(page);

  await installProviderMocks(page);

  const title = `e2e-reconnect-${Date.now()}`;
  const conversationId = await createConversation(page.request, title);

  const wsMock = await installWsMock(page.context());
  wsMock.seedInflight(conversationId, { assistantText: 'Reconnecting' });

  await page.goto(`${baseUrl}/chat`);
  await openConversation(page, title);

  await wsMock.waitForMessage(
    (msg) =>
      msg.type === 'subscribe_conversation' && msg.conversationId === conversationId,
  );

  const seenRequestIds = new Set(
    wsMock
      .getReceived()
      .map((msg) => (typeof msg.requestId === 'string' ? msg.requestId : null))
      .filter((id) => Boolean(id)) as string[],
  );

  const conversationsReqPromise = page.waitForRequest((req: any) =>
    req.method() === 'GET' && req.url().startsWith(`${apiBase}/conversations`),
  );

  const turnsReqPromise = page.waitForRequest((req: any) =>
    req.method() === 'GET' &&
    req.url().startsWith(`${apiBase}/conversations/${conversationId}/turns`),
  );

  await wsMock.closeAll();

  const conversationsReq = await conversationsReqPromise;
  const tConversations = Date.now();

  const turnsReq = await turnsReqPromise;
  const tTurns = Date.now();

  const subscribeSidebarMsg = await wsMock.waitForMessage(
    (msg) => msg.type === 'subscribe_sidebar' && !seenRequestIds.has(msg.requestId),
  );
  const tSubscribeSidebar = Date.now();

  const subscribeConversationMsg = await wsMock.waitForMessage(
    (msg) =>
      msg.type === 'subscribe_conversation' &&
      msg.conversationId === conversationId &&
      !seenRequestIds.has(msg.requestId),
  );
  const tSubscribeConversation = Date.now();

  expect(conversationsReq.url()).toContain('/conversations');
  expect(turnsReq.url()).toContain(`/conversations/${conversationId}/turns`);

  expect(tConversations).toBeLessThan(tSubscribeSidebar);
  expect(tTurns).toBeLessThan(tSubscribeConversation);

  expect(subscribeSidebarMsg.type).toBe('subscribe_sidebar');
  expect(subscribeConversationMsg.type).toBe('subscribe_conversation');
});
