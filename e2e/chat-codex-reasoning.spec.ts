import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import { installMockChatWs } from './support/mockChatWs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';

test('renders Codex thought process when analysis frames stream', async ({
  page,
}) => {
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
    const provider = new URL(route.request().url()).searchParams.get(
      'provider',
    );
    if (provider === 'codex') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'codex',
          available: true,
          toolsAvailable: true,
          models: [
            {
              key: 'gpt-5.1-codex-max',
              displayName: 'gpt-5.1-codex-max',
              type: 'codex',
            },
          ],
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
        models: [
          {
            key: 'mock-chat',
            displayName: 'Mock Chat Model',
            type: 'gguf',
          },
        ],
      }),
    });
  });

  await page.route('**/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
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
    setTimeout(() => {
      mockWs.sendAnalysisDelta({
        conversationId,
        inflightId,
        delta: 'Codex thinking.',
      });
    }, 0);
    setTimeout(() => {
      mockWs.sendAssistantDelta({
        conversationId,
        inflightId,
        delta: 'Final',
      });
    }, 800);
    setTimeout(() => {
      mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
    }, 1500);
  });

  await page.goto(`${baseUrl}/chat`);

  await page.getByLabel('Provider').click();
  await page.getByText('OpenAI Codex').click();

  await page.getByLabel('Model').click();
  await page.getByRole('option', { name: 'gpt-5.1-codex-max' }).click();

  const codexFlagsToggle = page
    .getByTestId('codex-flags-panel')
    .getByRole('button', { name: /Codex flags/i });
  if ((await codexFlagsToggle.getAttribute('aria-expanded')) === 'true') {
    await codexFlagsToggle.click();
  }

  const input = page.getByTestId('chat-input');
  await input.fill('Show reasoning');
  await expect(page.getByTestId('chat-send')).toBeEnabled({ timeout: 10000 });
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('think-toggle')).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId('status-chip')).toHaveText(/Complete/i, {
    timeout: 20000,
  });

  await page.getByTestId('think-toggle').scrollIntoViewIfNeeded();
  await page.getByTestId('think-toggle').click();
  await expect(page.getByTestId('think-content')).toContainText(
    'Codex thinking.',
  );
  await expect(page.getByTestId('think-spinner')).toBeHidden({
    timeout: 20000,
  });

  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({
    path: 'test-results/screenshots/0000010-08-chat-codex-reasoning.png',
    fullPage: true,
  });
});
