import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type ChatModel = { key: string; displayName: string; type?: string };

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:5010';
const useMockChat = process.env.E2E_USE_MOCK_CHAT === 'true';

const skipIfUnreachable = async (page: Page) => {
  try {
    const ping = await page.request.get(baseUrl);
    if (!ping.ok()) {
      test.skip(`Client not reachable (${ping.status()})`);
    }
  } catch {
    test.skip('Client not reachable (request failed)');
  }
};

test('chat streams end-to-end', async ({ page }) => {
  await skipIfUnreachable(page);

  let models: ChatModel[] = [];
  const mockModels: ChatModel[] = [
    { key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' },
  ];

  if (useMockChat) {
    await page.route('**/chat/models', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockModels),
      }),
    );
    await page.route('**/chat', (route) => {
      if (route.request().method() !== 'POST') {
        return route.continue();
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          'data: {"type":"token","content":"Hi"}\n\n',
          'data: {"type":"final","message":{"content":"Hi there","role":"assistant"}}\n\n',
          'data: {"type":"complete"}\n\n',
        ].join(''),
      });
    });
    models = mockModels;
  } else {
    try {
      const modelsRes = await page.request.get(`${apiBase}/chat/models`);
      if (!modelsRes.ok()) {
        test.skip(`LM Studio models not reachable (${modelsRes.status()})`);
      }
      models = (await modelsRes.json()) as ChatModel[];
    } catch {
      test.skip('LM Studio models not reachable (request failed)');
    }
  }

  if (!Array.isArray(models) || models.length === 0) {
    test.skip('No LM Studio models reported by /chat/models');
  }

  mkdirSync('test-results/screenshots', { recursive: true });

  const alternateModel = models[1] ?? models[0];

  await page.goto(`${baseUrl}/chat`);

  const modelSelect = page.getByRole('combobox', { name: /Model/i });
  await expect(modelSelect).toBeEnabled({ timeout: 20000 });
  await modelSelect.click();
  await page
    .getByRole('option', { name: alternateModel.displayName, exact: false })
    .click();
  await expect(modelSelect).toHaveText(alternateModel.displayName, {
    timeout: 5000,
  });

  const input = page.getByTestId('chat-input');
  const send = page.getByTestId('chat-send');
  const assistantBubbles = page.locator(
    '[data-testid="chat-bubble"][data-role="assistant"]',
  );
  const errorBubbles = page.locator(
    '[data-testid="chat-bubble"][data-kind="error"]',
  );

  await input.fill('Hello from e2e turn one');
  await send.click();

  await expect(assistantBubbles.first()).toHaveText(/.+/, { timeout: 20000 });
  await expect(assistantBubbles.first()).toHaveAttribute('data-kind', 'normal');
  await expect(errorBubbles).toHaveCount(0);
  await expect(page.getByText(/Responding\.\.\./i)).not.toBeVisible({
    timeout: 20000,
  });

  await input.fill('Second follow-up from e2e');
  await send.click();
  await expect(assistantBubbles.nth(1)).toHaveText(/.+/, { timeout: 20000 });
  await expect(errorBubbles).toHaveCount(0);

  await page.screenshot({
    path: 'test-results/screenshots/0000004-9-chat.png',
    fullPage: true,
  });
});
