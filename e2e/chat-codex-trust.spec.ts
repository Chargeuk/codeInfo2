import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import { installMockChatWs } from './support/mockChatWs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:5010';
const useMockChat = process.env.E2E_USE_MOCK_CHAT === 'true';
const codexReason = 'Missing auth.json in ./codex and config.toml in ./codex';

const trustErrorText =
  'Not inside a trusted directory and --skip-git-repo-check was not specified.';

test('Codex disabled banner shows when provider is unavailable (mock)', async ({
  page,
}) => {
  if (!useMockChat) {
    test.skip('Codex disabled banner path only runs with mock chat');
  }

  await page.route('**/chat/providers', (route) =>
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

  await page.route('**/chat/models**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'lmstudio',
        available: true,
        toolsAvailable: true,
        models: [{ key: 'mock-lm', displayName: 'Mock LM' }],
      }),
    }),
  );

  await page.goto(`${baseUrl}/chat`);

  await expect(
    page.getByText('OpenAI Codex is unavailable', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(codexReason, { exact: false })).toBeVisible();
});

test('Codex chat succeeds without trust error when working directory is handled', async ({
  page,
}) => {
  // Skip quickly when the client is unreachable.
  try {
    const ping = await page.request.get(baseUrl);
    if (!ping.ok()) {
      test.skip(`Client not reachable (${ping.status()})`);
    }
  } catch {
    test.skip('Client not reachable (request failed)');
  }

  if (useMockChat) {
    let chatCalls = 0;
    const mockWs = await installMockChatWs(page);

    await page.route('**/chat/providers', (route) =>
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
              available: true,
              toolsAvailable: true,
            },
          ],
        }),
      }),
    );

    await page.route('**/chat/models?**', (route) => {
      const url = route.request().url();
      const provider = new URL(url).searchParams.get('provider');
      const isCodex = provider === 'codex';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: provider ?? 'lmstudio',
          available: true,
          toolsAvailable: true,
          models: isCodex
            ? [
                {
                  key: 'gpt-5.1',
                  displayName: 'gpt-5.1',
                },
              ]
            : [
                {
                  key: 'mock-lm',
                  displayName: 'Mock LM',
                },
              ],
        }),
      });
    });

    await page.route('**/chat', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      chatCalls += 1;

      const payload = (route.request().postDataJSON?.() ?? {}) as Record<
        string,
        unknown
      >;
      const conversationId = String(payload.conversationId ?? 'c1');
      const inflightId = String(payload.inflightId ?? `i-${chatCalls}`);

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
        delta: 'Hello from Codex',
      });
      mockWs.sendFinal({
        conversationId,
        inflightId,
        status: 'ok',
        threadId: 'mock-thread',
      });
    });
  } else {
    try {
      const providersRes = await page.request.get(`${apiBase}/chat/providers`);
      if (!providersRes.ok()) {
        test.skip(`chat providers not reachable (${providersRes.status()})`);
      }
      const providersJson = await providersRes.json();
      const codexProvider = Array.isArray(providersJson?.providers)
        ? providersJson.providers.find((p: { id?: string }) => p.id === 'codex')
        : undefined;
      if (!codexProvider || !codexProvider.available) {
        test.skip('Codex provider is unavailable');
      }
    } catch {
      test.skip('chat providers not reachable (request failed)');
    }
  }

  mkdirSync('test-results/screenshots', { recursive: true });

  await page.goto(`${baseUrl}/chat`);

  const providerSelect = page.getByTestId('provider-select');
  const modelSelect = page.getByTestId('model-select');
  const input = page.getByTestId('chat-input');
  const send = page.getByTestId('chat-send');
  const assistantBubble = page.locator(
    '[data-testid="chat-bubble"][data-role="assistant"][data-kind="normal"]',
  );
  const errorBubble = page.locator(
    '[data-testid="chat-bubble"][data-kind="error"]',
  );

  await providerSelect.click();
  await page.getByRole('option', { name: /OpenAI Codex/i }).click();

  await modelSelect.click();
  await page.getByRole('option').first().click();

  await input.fill('Hello Codex');
  await send.click();

  if (useMockChat) {
    // Mock path no longer emits the legacy trust error frame; it should go straight
    // to a successful reply when the working directory is handled.
    await expect(assistantBubble.first()).toHaveText(/Hello from Codex/i, {
      timeout: 20000,
    });
  } else {
    await expect(assistantBubble.first()).toHaveText(/.+/, { timeout: 20000 });
  }

  await expect(errorBubble.filter({ hasText: trustErrorText })).toHaveCount(0);

  await page.screenshot({
    path: 'test-results/screenshots/0000010-4-codex-trust.png',
    fullPage: true,
  });
});
