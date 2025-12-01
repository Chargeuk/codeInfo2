import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';

const mockChatModels = [{ key: 'mock-chat', displayName: 'Mock Chat Model' }];

const mermaidMessage = [
  'Here is a mermaid diagram:',
  '```mermaid',
  'graph TD',
  '  A[Start] --> B{Render}',
  '  B --> C[Diagram]',
  "  %% <script>alert('x')</script> should be stripped",
  '  C --> D[Done]',
  '```',
].join('\n');

const mermaidEvents = [
  {
    type: 'final',
    message: { role: 'assistant', content: mermaidMessage },
    roundIndex: 0,
  },
  { type: 'complete' },
];

test('renders mermaid diagrams safely', async ({ page }) => {
  await page.route('**/chat/models', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockChatModels),
    }),
  );

  await page.route('**/chat', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = mermaidEvents
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

  await input.fill('Show me a mermaid diagram');
  await send.click();

  const bubble = page.getByTestId('assistant-markdown').first();
  await expect(bubble.locator('svg')).toBeVisible({ timeout: 20000 });
  await expect(bubble.locator('script')).toHaveCount(0);

  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({
    path: 'test-results/screenshots/0000007-5-chat-mermaid.png',
    fullPage: true,
  });
});
