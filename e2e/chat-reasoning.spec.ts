import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import { installMockChatWs } from './support/mockChatWs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const codexReason = 'Missing auth.json in ./codex and config.toml in ./codex';

test('collapses reasoning while streaming Harmony channels', async ({
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
            available: false,
            toolsAvailable: false,
            reason: codexReason,
          },
        ],
      }),
    }),
  );

  await page.route('**/chat/models', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'lmstudio',
        available: true,
        toolsAvailable: true,
        models: [{ key: 'mock-chat', displayName: 'Mock Chat Model' }],
      }),
    }),
  );

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
        delta: 'Need answer: Neil Armstrong.',
      });
    }, 0);
    setTimeout(() => {
      mockWs.sendAnalysisDelta({
        conversationId,
        inflightId,
        delta: ' Continue analysis.',
      });
    }, 1200);
    setTimeout(() => {
      mockWs.sendAssistantDelta({
        conversationId,
        inflightId,
        delta: 'He was the first person on the Moon.',
      });
    }, 2200);
    setTimeout(() => {
      mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
    }, 2300);
  });

  await page.goto(`${baseUrl}/chat`);

  const input = page.getByTestId('chat-input');
  const send = page.getByTestId('chat-send');

  await input.fill('Who was the first person on the Moon?');
  await send.click();

  await expect(page.getByTestId('think-toggle')).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByText('He was the first person on the Moon.'),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('think-spinner')).not.toBeVisible({
    timeout: 20000,
  });

  await page.getByTestId('think-toggle').click();
  await expect(page.getByTestId('think-content')).toContainText(
    'Need answer: Neil Armstrong.',
  );

  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({
    path: 'test-results/screenshots/0000007-3-chat-reasoning.png',
    fullPage: true,
  });
});
