import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type ChatModel = { key: string; displayName: string; type?: string };

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:5010';
const useMockChat = process.env.E2E_USE_MOCK_CHAT === 'true';
const preferredChatModel = 'openai/gpt-oss-20b';
const codexReason = 'Missing auth.json in ./codex and config.toml in ./codex';

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

const pickChatModel = (models: ChatModel[]) => {
  const preferred = models.find((m) => m.key === preferredChatModel);
  return preferred ?? models[0];
};

test('chat streams end-to-end', async ({ page }) => {
  await skipIfUnreachable(page);

  let models: ChatModel[] = [];
  const mockModels: ChatModel[] = [
    { key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' },
  ];

  if (useMockChat) {
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
            {
              id: 'codex',
              label: 'OpenAI Codex',
              available: false,
              toolsAvailable: false,
              reason: codexReason,
            },
          ],
        }),
      }),
    );
    await page.route('**/chat/models*', (route) => {
      const url = new URL(route.request().url());
      const provider = url.searchParams.get('provider') ?? 'lmstudio';

      if (provider === 'codex') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            provider: 'codex',
            available: false,
            toolsAvailable: false,
            reason: codexReason,
            models: [],
          }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'lmstudio',
          available: true,
          toolsAvailable: true,
          models: mockModels,
        }),
      });
    });
    await page.route('**/chat', (route) => {
      if (route.request().method() !== 'POST') {
        return route.continue();
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          'data: {"type":"token","content":"Hi"}\n\n',
          'data: {"type":"final","message":{"content":"Hi there <think>mock trace</think>","role":"assistant"}}\n\n',
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
      const data = await modelsRes.json();
      models = Array.isArray(data)
        ? (data as ChatModel[])
        : ((data as { models?: ChatModel[] }).models ?? []);
    } catch {
      test.skip('LM Studio models not reachable (request failed)');
    }
  }

  if (!Array.isArray(models) || models.length === 0) {
    test.skip('No LM Studio models reported by /chat/models');
  }

  const selectedModel = pickChatModel(models);
  console.log(`[e2e:chat] using chat model: ${selectedModel.key}`);

  mkdirSync('test-results/screenshots', { recursive: true });

  await page.goto(`${baseUrl}/chat`);

  const modelSelect = page.getByRole('combobox', { name: /Model/i });
  await expect(modelSelect).toBeEnabled({ timeout: 20000 });
  await modelSelect.click();

  const option = page.getByRole('option', {
    name: selectedModel.displayName,
    exact: false,
  });
  const menuItem = page.getByRole('menuitem', {
    name: selectedModel.displayName,
    exact: false,
  });
  if (await option.count()) {
    await option.click();
  } else {
    await menuItem.click();
  }
  await expect(modelSelect).toHaveText(selectedModel.displayName, {
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
  const thinkToggle = page.locator('[data-testid="think-toggle"]');
  const thinkContent = page.locator('[data-testid="think-content"]');
  const responding = page.getByText(/Responding\.\.\./i);

  await input.fill('Hello from e2e turn one');
  await send.click();

  try {
    await expect(assistantBubbles.first()).toHaveText(/.+/, { timeout: 20000 });
    await expect(assistantBubbles.first()).toHaveAttribute(
      'data-kind',
      'normal',
    );
    await expect(errorBubbles).toHaveCount(0);
    if (await responding.count()) {
      await expect(responding).toBeVisible({ timeout: 20000 });
      await expect(responding).not.toBeVisible({ timeout: 20000 });
    }

    if (useMockChat) {
      await expect(thinkToggle).toBeVisible();
      await thinkToggle.first().click();
      await expect(thinkContent.first()).toHaveText(/mock trace/i);
    }

    await input.fill('Second follow-up from e2e');
    await send.click();
    await expect(assistantBubbles.nth(1)).toHaveText(/.+/, { timeout: 20000 });
    await expect(errorBubbles).toHaveCount(0);
  } finally {
    await page.screenshot({
      path: 'test-results/screenshots/0000004-9-chat.png',
      fullPage: true,
    });
  }
});
