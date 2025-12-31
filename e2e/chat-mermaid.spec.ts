import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import { installMockChatWs } from './support/mockChatWs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const codexReason = 'Missing auth.json in ./codex and config.toml in ./codex';

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

test('renders mermaid diagrams safely', async ({ page }) => {
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

  await page.route('**/chat/models', (route) => {
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
        models: mockChatModels,
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
    mockWs.sendAssistantDelta({ conversationId, inflightId, delta: mermaidMessage });
    mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
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
