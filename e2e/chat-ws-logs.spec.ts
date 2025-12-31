import { expect, test } from '@playwright/test';
import { installMockChatWs } from './support/mockChatWs';

type ChatModel = { key: string; displayName: string; type?: string };

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';

test('Logs page shows chat WS client log lines after transcript events', async ({ page }) => {
  try {
    const ping = await page.request.get(baseUrl);
    if (!ping.ok()) {
      test.skip(`Client not reachable (${ping.status()})`);
    }
  } catch {
    test.skip('Client not reachable (request failed)');
  }

  const mockWs = await installMockChatWs(page);
  const mockModels: ChatModel[] = [
    { key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' },
  ];

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
      delta: 'Hello from WS logs e2e',
    });
    await mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
  });

  await page.goto(`${baseUrl}/chat`);

  const modelSelect = page.getByRole('combobox', { name: /Model/i });
  await expect(modelSelect).toBeEnabled({ timeout: 20000 });
  await modelSelect.click();
  await page.getByRole('option', { name: 'Mock Model 1' }).click();

  await page.getByTestId('chat-input').fill('Hello');
  await page.getByTestId('chat-send').click();

  const assistantBubbles = page.locator(
    '[data-testid="chat-bubble"][data-role="assistant"]',
  );
  await expect(assistantBubbles.first()).toHaveText(/Hello from WS logs e2e/i, {
    timeout: 20000,
  });

  await page.goto(`${baseUrl}/logs`);
  await page.getByRole('button', { name: 'Refresh now' }).click();

  const table = page.getByRole('table', { name: 'Logs table' });
  await expect(table.getByText('chat.ws.client_connect').first()).toBeVisible({
    timeout: 20000,
  });
  await expect(
    table.getByText('chat.ws.client_snapshot_received').first(),
  ).toBeVisible({ timeout: 20000 });
  await expect(table.getByText('chat.ws.client_final_received').first()).toBeVisible({
    timeout: 20000,
  });
});

