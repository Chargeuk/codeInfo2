import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import { logPlaywrightCopilotScenarioRegistration } from './support/copilotFakeScenario';
import { installMockChatWs } from './support/mockChatWs';

type ChatModel = { key: string; displayName: string; type?: string };

const baseUrl = process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001';
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

  await Promise.all([
    page.goto(`${baseUrl}/chat`),
    tabB.goto(`${baseUrl}/chat`),
  ]);

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

  await expect(page.getByText('Streaming reply')).toBeVisible({
    timeout: 10000,
  });
  await expect(tabB.getByText('Streaming reply')).toBeVisible({
    timeout: 10000,
  });
});

test('copilot websocket streaming renders streamed output in the transcript', async ({
  page,
}) => {
  if (!useMockChat) {
    test.skip('Requires mock chat to keep determinism');
  }

  const scenario = logPlaywrightCopilotScenarioRegistration({
    spec: 'chat-user-turn-ws.spec.ts',
    scenarioName: 'copilot-happy-path',
  });
  const mockWs = await installMockChatWs(page);
  const recordedBodies: Array<Record<string, unknown>> = [];

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
        providers: scenario.e2e.providers,
      }),
    }),
  );
  await page.route('**/chat/models*', (route) => {
    const url = new URL(route.request().url());
    const provider = url.searchParams.get('provider') ?? 'lmstudio';

    if (provider === 'copilot') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(scenario.e2e.copilotModels),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'lmstudio',
        available: true,
        toolsAvailable: true,
        models: [{ key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' }],
      }),
    });
  });
  await page.route('**/conversations/**/turns*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], nextCursor: null }),
    }),
  );
  await page.route('**/conversations*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], nextCursor: null }),
    }),
  );
  await page.route('**/chat', async (route) => {
    if (route.request().method() !== 'POST') {
      return route.continue();
    }

    const payload = (route.request().postDataJSON?.() ?? {}) as Record<
      string,
      unknown
    >;
    recordedBodies.push(payload);
    const conversationId = String(payload.conversationId ?? 'copilot-ws-c1');
    const inflightId = String(payload.inflightId ?? 'copilot-ws-i1');

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
    await mockWs.sendInflightSnapshot({
      conversationId,
      inflightId,
      assistantThink: 'copilot websocket trace',
    });
    for (const delta of scenario.e2e.chatStream.assistantDeltas) {
      await mockWs.sendAssistantDelta({ conversationId, inflightId, delta });
    }
    await mockWs.sendFinal({
      conversationId,
      inflightId,
      status: scenario.e2e.chatStream.finalStatus ?? 'ok',
    });
  });

  await page.goto(`${baseUrl}/chat`);

  const providerSelect = page.getByRole('combobox', { name: /Provider/i });
  await providerSelect.click();
  await page.getByRole('option', { name: /GitHub Copilot/i }).click();
  await expect(providerSelect).toHaveText(/GitHub Copilot/i);

  const modelSelect = page.getByRole('combobox', { name: /Model/i });
  await modelSelect.click();
  await page.getByRole('option', { name: /Copilot GPT-5/i }).click();
  await expect(modelSelect).toHaveText(/Copilot GPT-5/i);

  await page
    .getByTestId('chat-input')
    .fill('Show the Copilot websocket stream');
  await page.getByTestId('chat-send').click();

  await expect.poll(() => recordedBodies.length).toBe(1);
  expect(recordedBodies[0]?.provider).toBe('copilot');
  expect(recordedBodies[0]?.model).toBe('copilot-gpt-5');

  await expect(page.getByTestId('chat-transcript')).toContainText(
    'Hello from fake Copilot',
    { timeout: 10000 },
  );
  const thinkToggle = page.locator('[data-testid="think-toggle"]').first();
  await expect(thinkToggle).toBeVisible({ timeout: 10000 });
  await thinkToggle.click();
  await expect(page.locator('[data-testid="think-content"]').first()).toContainText(
    'copilot websocket trace',
    { timeout: 10000 },
  );
});
