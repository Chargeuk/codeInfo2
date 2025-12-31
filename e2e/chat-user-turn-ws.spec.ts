import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import { installMockChatWs } from './support/mockChatWs';

type ChatModel = { key: string; displayName: string; type?: string };

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const useMockChat = process.env.E2E_USE_MOCK_CHAT === 'true';

test('user_turn streams to non-originating tabs and dedupes sender tab', async ({
  page,
}) => {
  if (!useMockChat) {
    test.skip('Requires mock chat to keep determinism');
  }

  const context = page.context();
  const tabB = await context.newPage();

  const mockWsA = await installMockChatWs(page);
  const mockWsB = await installMockChatWs(tabB);

  const mockModels: ChatModel[] = [
    { key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' },
  ];

  const conversation = {
    conversationId: 'c1',
    title: 'Conversation A',
    provider: 'lmstudio',
    model: 'm1',
    source: 'REST',
    lastMessageAt: '2025-01-01T00:00:00.000Z',
    archived: false,
  };

  await context.route('**/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mongoConnected: true }),
    }),
  );

  await context.route('**/chat/providers*', (route) =>
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

  await context.route('**/chat/models*', (route) =>
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

  await context.route('**/conversations/**/turns*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], nextCursor: null }),
    }),
  );

  await context.route('**/conversations*', (route) => {
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
      body: JSON.stringify({ items: [conversation], nextCursor: null }),
    });
  });

  await context.route('**/chat', async (route) => {
    if (route.request().method() !== 'POST') {
      return route.continue();
    }

    const payload = (route.request().postDataJSON?.() ?? {}) as Record<
      string,
      unknown
    >;
    const conversationId = String(payload.conversationId ?? 'c1');
    const inflightId = String(payload.inflightId ?? 'i1');
    const message = String(payload.message ?? '');
    const createdAt = new Date().toISOString();

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

    await Promise.all([
      mockWsA.waitForConversationSubscription(conversationId),
      mockWsB.waitForConversationSubscription(conversationId),
    ]);

    await Promise.all([
      mockWsA.sendUserTurn({
        conversationId,
        inflightId,
        content: message,
        createdAt,
      }),
      mockWsB.sendUserTurn({
        conversationId,
        inflightId,
        content: message,
        createdAt,
      }),
    ]);

    await Promise.all([
      mockWsA.sendInflightSnapshot({ conversationId, inflightId }),
      mockWsB.sendInflightSnapshot({ conversationId, inflightId }),
    ]);
    await Promise.all([
      mockWsA.sendAssistantDelta({
        conversationId,
        inflightId,
        delta: 'Streaming reply',
      }),
      mockWsB.sendAssistantDelta({
        conversationId,
        inflightId,
        delta: 'Streaming reply',
      }),
    ]);
    await Promise.all([
      mockWsA.sendFinal({ conversationId, inflightId, status: 'ok' }),
      mockWsB.sendFinal({ conversationId, inflightId, status: 'ok' }),
    ]);
  });

  mkdirSync('test-results/screenshots', { recursive: true });

  await Promise.all([page.goto(`${baseUrl}/chat`), tabB.goto(`${baseUrl}/chat`)]);

  for (const tab of [page, tabB]) {
    const modelSelect = tab.getByRole('combobox', { name: /Model/i });
    await expect(modelSelect).toBeEnabled({ timeout: 20000 });
    await modelSelect.click();
    const option = tab.getByRole('option', {
      name: mockModels[0].displayName,
      exact: false,
    });
    const menuItem = tab.getByRole('menuitem', {
      name: mockModels[0].displayName,
      exact: false,
    });
    if (await option.count()) {
      await option.click();
    } else {
      await menuItem.click();
    }

    const conversationRow = tab.locator('[data-testid="conversation-row"]', {
      hasText: conversation.title,
    });
    await expect(conversationRow).toBeVisible({ timeout: 20000 });
    await conversationRow.click();
  }

  const userText = 'Hello from tab A';
  await page.getByTestId('chat-input').fill(userText);
  await page.getByTestId('chat-send').click();

  await expect(
    page
      .locator('[data-testid="chat-bubble"][data-role="user"]')
      .filter({ hasText: userText }),
  ).toHaveCount(1);

  await expect(
    tabB
      .locator('[data-testid="chat-bubble"][data-role="user"]')
      .filter({ hasText: userText }),
  ).toHaveCount(1);

  await page.screenshot({
    path: 'test-results/screenshots/0000019-18-tab-a.png',
    fullPage: true,
  });
  await tabB.screenshot({
    path: 'test-results/screenshots/0000019-18-tab-b.png',
    fullPage: true,
  });

  await expect(page.getByText('Streaming reply')).toBeVisible({ timeout: 10000 });
  await expect(tabB.getByText('Streaming reply')).toBeVisible({ timeout: 10000 });
});
