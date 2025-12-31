import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installMockChatWs } from './support/mockChatWs';

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
    const mockWs = await installMockChatWs(page);

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
      mockWs.sendInflightSnapshot({ conversationId, inflightId });
      mockWs.sendAssistantDelta({
        conversationId,
        inflightId,
        delta: 'Hi there ',
      });
      mockWs.sendAnalysisDelta({
        conversationId,
        inflightId,
        delta: 'mock trace',
      });
      mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
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

test('chat provider/model selects work on small viewport', async ({ page }) => {
  await skipIfUnreachable(page);

  await page.setViewportSize({ width: 500, height: 900 });

  let models: ChatModel[] = [];
  const mockModels: ChatModel[] = [
    { key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' },
  ];

  if (useMockChat) {
    await installMockChatWs(page);

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
    test.skip('No models reported by /chat/models');
  }

  const selectedModel = pickChatModel(models);

  await page.goto(`${baseUrl}/chat`);

  const providerSelect = page.getByRole('combobox', { name: /Provider/i });
  await expect(providerSelect).toBeVisible({ timeout: 20000 });
  await providerSelect.click();
  const providerOption = page.getByRole('option').first();
  const providerMenuItem = page.getByRole('menuitem').first();
  if (await providerOption.count()) {
    await expect(providerOption).toBeVisible();
  } else {
    await expect(providerMenuItem).toBeVisible();
  }
  await page.keyboard.press('Escape');

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
});

test('conversations drawer is persistent on desktop and pushes content', async ({
  page,
}) => {
  await skipIfUnreachable(page);

  await page.setViewportSize({ width: 1280, height: 720 });

  if (useMockChat) {
    await installMockChatWs(page);
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
          models: [{ key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' }],
        }),
      }),
    );
  }

  await page.goto(`${baseUrl}/chat`);

  const drawerToggle = page.getByTestId('conversation-drawer-toggle');
  await expect(drawerToggle).toBeVisible();
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('conversation-list')).toBeVisible();
  await expect(page.locator('.MuiBackdrop-root')).toHaveCount(0);

  const chatColumn = page.getByTestId('chat-column');
  const boxOpen = await chatColumn.boundingBox();
  expect(boxOpen).not.toBeNull();

  const drawerPaper = page.locator('[data-testid="conversation-drawer"] .MuiDrawer-paper');
  await expect(drawerPaper).toBeVisible();
  const drawerBox = await drawerPaper.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(Math.abs((drawerBox?.y ?? 0) - (boxOpen?.y ?? 0))).toBeLessThan(2);

  await drawerToggle.click();
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false');

  const boxClosed = await chatColumn.boundingBox();
  expect(boxClosed).not.toBeNull();
  expect((boxClosed?.x ?? 0) + 150).toBeLessThan(boxOpen?.x ?? 0);
});

test('conversations drawer is closed by default on mobile and overlays content', async ({
  page,
}) => {
  await skipIfUnreachable(page);

  await page.setViewportSize({ width: 500, height: 900 });

  if (useMockChat) {
    await installMockChatWs(page);
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
          models: [{ key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' }],
        }),
      }),
    );
  }

  await page.goto(`${baseUrl}/chat`);

  const drawerToggle = page.getByTestId('conversation-drawer-toggle');
  await expect(drawerToggle).toBeVisible();
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-testid="conversation-list"]')).toHaveCount(0);

  const chatColumn = page.getByTestId('chat-column');
  const boxBefore = await chatColumn.boundingBox();
  expect(boxBefore).not.toBeNull();

  await drawerToggle.click();
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('conversation-list')).toBeVisible();
  await expect(page.locator('.MuiBackdrop-root')).toHaveCount(1);

  const boxAfter = await chatColumn.boundingBox();
  expect(boxAfter).not.toBeNull();
  expect(Math.abs((boxAfter?.x ?? 0) - (boxBefore?.x ?? 0))).toBeLessThan(20);

  const drawerPaper = page.locator('[data-testid="conversation-drawer"] .MuiDrawer-paper');
  await expect(drawerPaper).toBeVisible();
  const drawerBox = await drawerPaper.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(Math.abs((drawerBox?.y ?? 0) - (boxBefore?.y ?? 0))).toBeLessThan(2);
});

test('conversations drawer toggle works after resizing across breakpoints', async ({
  page,
}) => {
  await skipIfUnreachable(page);

  await page.setViewportSize({ width: 1280, height: 720 });

  if (useMockChat) {
    await installMockChatWs(page);
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
          models: [{ key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' }],
        }),
      }),
    );
  }

  await page.goto(`${baseUrl}/chat`);

  const drawerToggle = page.getByTestId('conversation-drawer-toggle');
  await expect(drawerToggle).toBeVisible();
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('conversation-list')).toBeVisible();

  await page.setViewportSize({ width: 500, height: 900 });
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('conversation-list')).toBeHidden();

  await drawerToggle.click();
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('conversation-list')).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('conversation-list')).toBeVisible();

  await drawerToggle.click();
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false');
});

test('conversations drawer stays vertically aligned when persistence banner is visible', async ({
  page,
}) => {
  await skipIfUnreachable(page);

  await page.setViewportSize({ width: 1280, height: 720 });

  await page.route('**/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mongoConnected: false }),
    }),
  );

  if (useMockChat) {
    await installMockChatWs(page);
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
          models: [{ key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' }],
        }),
      }),
    );
  }

  await page.goto(baseUrl + '/chat');

  await expect(page.getByTestId('persistence-banner')).toBeVisible();

  const drawerPaper = page.locator('[data-testid="conversation-drawer"] .MuiDrawer-paper');
  await expect(drawerPaper).toBeVisible();

  const drawerBox = await drawerPaper.boundingBox();
  const chatBox = await page.getByTestId('chat-column').boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(chatBox).not.toBeNull();
  expect(Math.abs((drawerBox?.y ?? 0) - (chatBox?.y ?? 0))).toBeLessThan(2);
});
