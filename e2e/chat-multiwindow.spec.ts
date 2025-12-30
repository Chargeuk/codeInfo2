import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import { installMockChatWs } from './support/mockChatWs';

type ChatModel = { key: string; displayName: string; type?: string };

type Turn = {
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string;
  provider: string;
  status: 'ok' | 'failed' | 'stopped';
  createdAt: string;
};

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const useMockChat = process.env.E2E_USE_MOCK_CHAT === 'true';

test('cross-tab follow-up creates a new assistant bubble in passive window', async ({
  page,
}) => {
  if (!useMockChat) {
    test.skip('Requires mock chat to keep determinism');
  }

  const context = page.context();
  const pageB = await context.newPage();

  const apiBase = process.env.E2E_API_URL;
  if (apiBase) {
    for (const tab of [page, pageB]) {
      await tab.addInitScript((value) => {
        const w = window as unknown as {
          process?: { env?: Record<string, string> };
        };
        w.process = w.process ?? { env: {} };
        w.process.env = {
          ...(w.process.env ?? {}),
          VITE_API_URL: String(value),
        };
      }, apiBase);
    }
  }

  await page.setViewportSize({ width: 640, height: 720 });
  await pageB.setViewportSize({ width: 640, height: 720 });

  const mockWsA = await installMockChatWs(page);
  const mockWsB = await installMockChatWs(pageB);

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

  const turnsByConversationId: Record<
    string,
    { items: Turn[]; nextCursor: null }
  > = {
    c1: { items: [], nextCursor: null },
  };

  const updateTurnsForRun = (params: {
    conversationId: string;
    message: string;
    assistant: string;
    baseTime: string;
  }) => {
    const provider = 'lmstudio';
    const model = 'm1';
    const userTurn: Turn = {
      conversationId: params.conversationId,
      role: 'user',
      content: params.message,
      provider,
      model,
      status: 'ok',
      createdAt: params.baseTime,
    };
    const assistantTurn: Turn = {
      conversationId: params.conversationId,
      role: 'assistant',
      content: params.assistant,
      provider,
      model,
      status: 'ok',
      createdAt: new Date(Date.parse(params.baseTime) + 10_000).toISOString(),
    };

    const existing = turnsByConversationId[params.conversationId]?.items ?? [];

    // API returns newest-first.
    turnsByConversationId[params.conversationId] = {
      items: [assistantTurn, userTurn, ...existing],
      nextCursor: null,
    };
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

  await context.route('**/conversations/**/turns*', (route) => {
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

  let runIndex = 0;

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

    runIndex += 1;
    const baseTime = new Date(
      Date.parse('2025-01-01T00:00:00.000Z') + (runIndex - 1) * 60_000,
    ).toISOString();

    const assistantText = runIndex === 1 ? 'Assistant one' : 'Assistant two';

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
        createdAt: baseTime,
      }),
      mockWsB.sendUserTurn({
        conversationId,
        inflightId,
        content: message,
        createdAt: baseTime,
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
        delta: assistantText,
      }),
      mockWsB.sendAssistantDelta({
        conversationId,
        inflightId,
        delta: assistantText,
      }),
    ]);

    await Promise.all([
      mockWsA.sendFinal({ conversationId, inflightId, status: 'ok' }),
      mockWsB.sendFinal({ conversationId, inflightId, status: 'ok' }),
    ]);

    updateTurnsForRun({
      conversationId,
      message,
      assistant: assistantText,
      baseTime,
    });
  });

  mkdirSync('test-results/screenshots', { recursive: true });

  await Promise.all([
    page.goto(`${baseUrl}/chat`),
    pageB.goto(`${baseUrl}/chat`),
  ]);

  for (const tab of [page, pageB]) {
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

  const inputA = page.getByTestId('chat-input');
  const sendA = page.getByTestId('chat-send');

  await inputA.fill('Hello from page A');
  await sendA.click();

  await expect(page.getByText('Assistant one')).toBeVisible({ timeout: 10000 });
  await expect(pageB.getByText('Assistant one')).toBeVisible({
    timeout: 10000,
  });

  await inputA.fill('Follow-up from page A');
  await sendA.click();

  await expect(page.getByText('Assistant two')).toBeVisible({ timeout: 10000 });
  await expect(pageB.getByText('Assistant two')).toBeVisible({
    timeout: 10000,
  });

  const assistantBubblesB = pageB.locator(
    '[data-testid="chat-bubble"][data-role="assistant"][data-kind="normal"]',
  );
  await expect(assistantBubblesB).toHaveCount(2);

  await page.screenshot({
    path: 'test-results/screenshots/0000019-27-multiwindow-a.png',
    fullPage: true,
  });
  await pageB.screenshot({
    path: 'test-results/screenshots/0000019-27-multiwindow-b.png',
    fullPage: true,
  });

  // Both pages should render the same transcript order after refresh.
  await Promise.all([page.reload(), pageB.reload()]);

  for (const tab of [page, pageB]) {
    const conversationRow = tab.locator('[data-testid="conversation-row"]', {
      hasText: conversation.title,
    });
    await expect(conversationRow).toBeVisible({ timeout: 20000 });
    await conversationRow.click();
    await expect(tab.getByText('Assistant two')).toBeVisible({
      timeout: 10000,
    });
    await expect(tab.getByText('Assistant one')).toBeVisible({
      timeout: 10000,
    });
    const transcript = tab.locator('[data-testid="chat-transcript"]');
    const transcriptText = (await transcript.textContent()) ?? '';
    expect(transcriptText.indexOf('Assistant two')).toBeLessThan(
      transcriptText.indexOf('Assistant one'),
    );
  }
});
