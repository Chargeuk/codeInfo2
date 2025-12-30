import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import { installMockChatWs } from './support/mockChatWs';

type ChatModel = { key: string; displayName: string; type?: string };

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const useMockChat = process.env.E2E_USE_MOCK_CHAT === 'true';

test('mid-stream conversation switch hydrates inflight snapshot on return', async ({
  page,
}) => {
  if (!useMockChat) {
    test.skip('Requires mock chat to keep determinism');
  }

  const mockWs = await installMockChatWs(page);

  const mockModels: ChatModel[] = [
    { key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' },
  ];

  const conversationA = {
    conversationId: 'c1',
    title: 'Conversation A',
    provider: 'lmstudio',
    model: 'm1',
    source: 'REST',
    lastMessageAt: '2025-01-01T00:00:00.000Z',
    archived: false,
  };

  const conversationB = {
    conversationId: 'c2',
    title: 'Conversation B',
    provider: 'lmstudio',
    model: 'm1',
    source: 'REST',
    lastMessageAt: '2025-01-01T00:00:00.000Z',
    archived: false,
  };

  const turnsByConversationId: Record<string, any> = {
    c1: {
      items: [],
      nextCursor: null,
    },
    c2: {
      items: [],
      nextCursor: null,
    },
  };

  await page.route('**/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mongoConnected: true }),
    }),
  );

  await page.route('**/chat/providers*', (route) =>
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
        ],
      }),
    }),
  );

  await page.route('**/chat/models*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'lmstudio',
        available: true,
        toolsAvailable: true,
        models: mockModels,
      }),
    }),
  );

  await page.route('**/conversations/**/turns*', (route) => {
    const url = new URL(route.request().url());
    const match = url.pathname.match(/\/conversations\/(.+)\/turns/);
    const conversationId = match?.[1] ?? 'unknown';
    const payload = turnsByConversationId[conversationId] ?? {
      items: [],
      nextCursor: null,
    };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  await page.route('**/conversations*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/turns')) {
      return route.continue();
    }
    if (route.request().method() === 'POST') {
      return route.continue();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [conversationA, conversationB],
        nextCursor: null,
      }),
    });
  });

  await page.route('**/chat', async (route) => {
    if (route.request().method() !== 'POST') {
      return route.continue();
    }

    const payload = (route.request().postDataJSON?.() ?? {}) as Record<
      string,
      unknown
    >;
    const conversationId = String(payload.conversationId ?? 'c1');
    const inflightId = String(payload.inflightId ?? 'i1');

    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'started',
        conversationId,
        inflightId,
        provider: payload.provider,
        model: payload.model,
      }),
    });

    await mockWs.waitForConversationSubscription(conversationId);

    await mockWs.sendInflightSnapshot({ conversationId, inflightId });
    await mockWs.sendAssistantDelta({
      conversationId,
      inflightId,
      delta: 'Partial response',
    });

    turnsByConversationId.c1.inflight = {
      inflightId,
      assistantText: 'Partial response',
      assistantThink: '',
      toolEvents: [],
      startedAt: '2025-01-01T00:00:00.000Z',
      seq: 2,
    };
  });

  mkdirSync('test-results/screenshots', { recursive: true });

  await page.goto(`${baseUrl}/chat`);

  const modelSelect = page.getByRole('combobox', { name: /Model/i });
  await expect(modelSelect).toBeEnabled({ timeout: 20000 });
  await modelSelect.click();
  const option = page.getByRole('option', {
    name: mockModels[0].displayName,
    exact: false,
  });
  const menuItem = page.getByRole('menuitem', {
    name: mockModels[0].displayName,
    exact: false,
  });
  if (await option.count()) {
    await option.click();
  } else {
    await menuItem.click();
  }

  const conversationARow = page.locator('[data-testid="conversation-row"]', {
    hasText: 'Conversation A',
  });
  const conversationBRow = page.locator('[data-testid="conversation-row"]', {
    hasText: 'Conversation B',
  });

  await conversationARow.click();

  const input = page.getByTestId('chat-input');
  const send = page.getByTestId('chat-send');
  await input.fill('Hello');
  await send.click();

  await expect(page.getByText('Partial response')).toBeVisible({
    timeout: 10000,
  });

  // Switch away mid-stream.
  await conversationBRow.click();

  // Switching back should hydrate the inflight snapshot via the turns refresh.
  await conversationARow.click();
  await expect(page.getByText('Partial response')).toBeVisible({
    timeout: 10000,
  });

  await mockWs.waitForConversationSubscription('c1');

  await page.screenshot({
    path: 'test-results/screenshots/0000019-17-midstream-refresh.png',
    fullPage: true,
  });

  await page.waitForTimeout(150);
  await mockWs.sendAssistantDelta({
    conversationId: 'c1',
    inflightId: 'i1',
    delta: ' (continued)',
  });
  await mockWs.sendFinal({ conversationId: 'c1', inflightId: 'i1', status: 'ok' });

  await expect(page.getByText('Partial response (continued)')).toBeVisible({
    timeout: 10000,
  });

  await page.screenshot({
    path: 'test-results/screenshots/0000019-17-final.png',
    fullPage: true,
  });
});
