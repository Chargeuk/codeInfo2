import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:5010';

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

const routeAgentsApis = async (
  page: Page,
  runBodies: Array<Record<string, unknown>>,
  options?: {
    conversations?: Array<Record<string, unknown>>;
    turnsByConversationId?: Record<string, Array<Record<string, unknown>>>;
  },
) => {
  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    if (url.origin !== new URL(apiUrl).origin) {
      await route.continue();
      return;
    }
    const path = url.pathname;

    if (path === '/health' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mongoConnected: true }),
      });
      return;
    }

    if (path === '/agents' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ agents: [{ name: 'coding_agent' }] }),
      });
      return;
    }

    if (path === '/agents/coding_agent/commands' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ commands: [] }),
      });
      return;
    }

    if (path === '/conversations' && method === 'GET') {
      const items = options?.conversations ?? [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items }),
      });
      return;
    }

    if (path.startsWith('/conversations/') && path.endsWith('/turns')) {
      const conversationId = path.split('/')[2] ?? '';
      const items = options?.turnsByConversationId?.[conversationId] ?? [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items }),
      });
      return;
    }

    if (path === '/agents/coding_agent/run' && method === 'POST') {
      const payload = (req.postDataJSON?.() ?? {}) as Record<string, unknown>;
      runBodies.push(payload);
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'started',
          agentName: 'coding_agent',
          conversationId:
            typeof payload.conversationId === 'string'
              ? payload.conversationId
              : 'c1',
          inflightId: 'i1',
          modelId: 'gpt-5.3-codex',
        }),
      });
      return;
    }

    await route.continue();
  });
};

test('agents preserves raw outbound payload and blocks whitespace-only submit', async ({
  page,
}) => {
  await skipIfUnreachable(page);

  const runBodies: Array<Record<string, unknown>> = [];
  await routeAgentsApis(page, runBodies);

  await page.goto(`${baseUrl}/agents`);

  const agentSelect = page.getByTestId('agent-select');
  await expect(agentSelect).toBeVisible({ timeout: 20000 });
  await expect
    .poll(async () => await agentSelect.inputValue(), {
      timeout: 20000,
      message: 'Expected agent select to hydrate coding_agent',
    })
    .toBe('coding_agent');

  const input = page.getByTestId('agent-input');
  const send = page.getByTestId('agent-send');

  const rawInstruction = '  line one\nline two  ';
  await input.fill(rawInstruction);
  await expect(send).toBeEnabled();
  await send.click();

  await expect
    .poll(() => runBodies.length, {
      timeout: 10000,
      message: 'Expected one agents run POST request for valid payload',
    })
    .toBe(1);

  expect(runBodies[0]?.instruction).toBe(rawInstruction);

  await input.fill('   \n   ');
  await expect(send).toBeDisabled();
  await page.waitForTimeout(300);
  expect(runBodies).toHaveLength(1);
});

test('agents hydrated user markdown matches assistant list/code/mermaid rendering', async ({
  page,
}) => {
  await skipIfUnreachable(page);

  const runBodies: Array<Record<string, unknown>> = [];
  const markdown = [
    'List:',
    '- item one',
    '- item two',
    '',
    '`inline`',
    '',
    '```mermaid',
    'graph TD',
    '  A[Start] --> B[Done]',
    "  %% <script>alert('x')</script> should be stripped",
    '```',
  ].join('\n');
  await routeAgentsApis(page, runBodies, {
    conversations: [
      {
        conversationId: 'c1',
        title: 'Markdown parity',
        provider: 'codex',
        model: 'gpt-5.3-codex',
        lastMessageAt: '2025-01-01T00:00:00.000Z',
      },
    ],
    turnsByConversationId: {
      c1: [
        {
          conversationId: 'c1',
          role: 'assistant',
          content: markdown,
          createdAt: '2025-01-01T00:00:02.000Z',
          status: 'ok',
        },
        {
          conversationId: 'c1',
          role: 'user',
          content: markdown,
          createdAt: '2025-01-01T00:00:01.000Z',
          status: 'ok',
        },
      ],
    },
  });

  await page.goto(`${baseUrl}/agents`);
  await page.getByTestId('conversation-row').first().click();

  const userMarkdown = page
    .locator('[data-role="user"] [data-testid="agents-user-markdown"]')
    .first();
  const assistantMarkdown = page
    .locator('[data-role="assistant"] [data-testid="assistant-markdown"]')
    .first();

  await expect(userMarkdown.locator('li')).toHaveCount(2);
  await expect(assistantMarkdown.locator('li')).toHaveCount(2);
  await expect(userMarkdown.locator('code')).toHaveCount(1);
  await expect(assistantMarkdown.locator('code')).toHaveCount(1);
  await expect(userMarkdown.locator('svg')).toBeVisible();
  await expect(assistantMarkdown.locator('svg')).toBeVisible();
  await expect(userMarkdown.locator('script')).toHaveCount(0);
  await expect(assistantMarkdown.locator('script')).toHaveCount(0);
});

test('agents malformed mermaid input uses safe fallback for user and assistant bubbles', async ({
  page,
}) => {
  await skipIfUnreachable(page);

  const runBodies: Array<Record<string, unknown>> = [];
  const malformed = [
    '```mermaid',
    'this is not valid mermaid syntax',
    '```',
  ].join('\n');
  await routeAgentsApis(page, runBodies, {
    conversations: [
      {
        conversationId: 'c1',
        title: 'Malformed mermaid',
        provider: 'codex',
        model: 'gpt-5.3-codex',
        lastMessageAt: '2025-01-01T00:00:00.000Z',
      },
    ],
    turnsByConversationId: {
      c1: [
        {
          conversationId: 'c1',
          role: 'assistant',
          content: malformed,
          createdAt: '2025-01-01T00:00:02.000Z',
          status: 'ok',
        },
        {
          conversationId: 'c1',
          role: 'user',
          content: malformed,
          createdAt: '2025-01-01T00:00:01.000Z',
          status: 'ok',
        },
      ],
    },
  });

  await page.goto(`${baseUrl}/agents`);
  await page.getByTestId('conversation-row').first().click();

  const userMarkdown = page
    .locator('[data-role="user"] [data-testid="agents-user-markdown"]')
    .first();
  const assistantMarkdown = page
    .locator('[data-role="assistant"] [data-testid="assistant-markdown"]')
    .first();
  await expect(userMarkdown).toContainText('Diagram failed to render');
  await expect(assistantMarkdown).toContainText('Diagram failed to render');
});
