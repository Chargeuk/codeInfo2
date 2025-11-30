import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';

const mockChatModels = [{ key: 'mock-chat', displayName: 'Mock Chat Model' }];

const reasoningEvents = [
  {
    type: 'token',
    content: '<|channel|>analysis<|message|>Need answer: Neil Armstrong.',
    roundIndex: 0,
  },
  {
    type: 'final',
    message: {
      role: 'assistant',
      content:
        '<|channel|>analysis<|message|>Need answer: Neil Armstrong.<|end|><|start|>assistant<|channel|>final<|message|>He was the first person on the Moon.',
    },
    roundIndex: 0,
  },
  { type: 'complete' },
];

test('collapses reasoning while streaming Harmony channels', async ({
  page,
}) => {
  await page.route('**/chat/models', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockChatModels),
    }),
  );

  await page.route('**/chat', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = reasoningEvents
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('');
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body,
    });
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
  await expect(page.getByTestId('think-content')).toHaveText(
    'Need answer: Neil Armstrong.',
  );

  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({
    path: 'test-results/screenshots/0000007-3-chat-reasoning.png',
    fullPage: true,
  });
});
