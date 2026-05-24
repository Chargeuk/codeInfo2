import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001';
const apiUrl = process.env.E2E_API_URL ?? 'http://host.docker.internal:6010';

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
  commandRunBodies: Array<Record<string, unknown>> = runBodies,
  options?: {
    conversations?: Array<Record<string, unknown>>;
    turnsByConversationId?: Record<string, Array<Record<string, unknown>>>;
    commandsByAgent?: Record<
      string,
      Array<{
        name: string;
        description: string;
        disabled?: boolean;
        stepCount: number;
      }>
    >;
    promptsByAgent?: Record<
      string,
      Array<{ relativePath: string; fullPath: string }>
    >;
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
        body: JSON.stringify({
          commands: options?.commandsByAgent?.coding_agent ?? [],
        }),
      });
      return;
    }

    if (path === '/agents/coding_agent/prompts' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          prompts: options?.promptsByAgent?.coding_agent ?? [],
        }),
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

const buildLongTranscriptTurns = (conversationId: string) => {
  const turns: Array<Record<string, unknown>> = [];
  for (let index = 0; index < 28; index += 1) {
    const createdAt = new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString();
    turns.push({
      conversationId,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content:
        index % 2 === 0
          ? `User turn ${index + 1}: explain how transcript virtualization should preserve scroll state, keep rich rows stable, and avoid input lag while the list is long.`
          : `Assistant turn ${index + 1}: this is a deliberately long transcript row for Story 49 validation. `.repeat(
              10,
            ),
      createdAt,
      status: 'ok',
    });
  }
  return turns;
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
  expect(runBodies).toHaveLength(1);
});

test('agents composer popovers open upward on desktop and centered on mobile', async ({
  page,
}) => {
  await skipIfUnreachable(page);

  const runBodies: Array<Record<string, unknown>> = [];
  const commandRunBodies: Array<Record<string, unknown>> = [];
  await routeAgentsApis(page, runBodies, commandRunBodies, {
    commandsByAgent: {
      coding_agent: [
        {
          name: 'build',
          description: 'Build the workspace',
          disabled: false,
          stepCount: 3,
        },
      ],
    },
    promptsByAgent: {
      coding_agent: [
        {
          relativePath: 'workflows/prompts/review.md',
          fullPath: '/workflows/prompts/review.md',
        },
      ],
    },
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/agents`);

  const infoTrigger = page.getByTestId('agent-composer-info');
  const agentTrigger = page.getByTestId('agent-select-trigger');
  const commandTrigger = page.getByTestId('agent-command-trigger');

  await infoTrigger.click();
  const infoPopover = page.getByTestId('agent-info-popover');
  await expect(infoPopover).toBeVisible();
  const infoTriggerBox = await infoTrigger.boundingBox();
  const infoPopoverBox = await infoPopover.boundingBox();
  expect(infoTriggerBox).not.toBeNull();
  expect(infoPopoverBox).not.toBeNull();
  expect((infoPopoverBox?.y ?? 0) + (infoPopoverBox?.height ?? 0)).toBeLessThan(
    infoTriggerBox?.y ?? 0,
  );

  await agentTrigger.click();
  const agentPopover = page.getByTestId('agent-selector-popover');
  await expect(agentPopover).toBeVisible();
  const agentTriggerBox = await agentTrigger.boundingBox();
  const agentPopoverBox = await agentPopover.boundingBox();
  expect(agentTriggerBox).not.toBeNull();
  expect(agentPopoverBox).not.toBeNull();
  expect((agentPopoverBox?.y ?? 0) + (agentPopoverBox?.height ?? 0)).toBeLessThan(
    agentTriggerBox?.y ?? 0,
  );

  await commandTrigger.click();
  const commandPopover = page.getByTestId('agent-command-popover');
  await expect(commandPopover).toBeVisible();
  const commandTriggerBox = await commandTrigger.boundingBox();
  const commandPopoverBox = await commandPopover.boundingBox();
  expect(commandTriggerBox).not.toBeNull();
  expect(commandPopoverBox).not.toBeNull();
  expect(
    (commandPopoverBox?.y ?? 0) + (commandPopoverBox?.height ?? 0),
  ).toBeLessThan(commandTriggerBox?.y ?? 0);

  await page.getByRole('option', { name: 'Build' }).click();
  await page.getByTestId('agent-step-trigger').click();
  const stepPopover = page.getByTestId('agent-step-popover');
  await expect(stepPopover).toBeVisible();
  const stepTriggerBox = await page.getByTestId('agent-step-trigger').boundingBox();
  const stepPopoverBox = await stepPopover.boundingBox();
  expect(stepTriggerBox).not.toBeNull();
  expect(stepPopoverBox).not.toBeNull();
  expect((stepPopoverBox?.y ?? 0) + (stepPopoverBox?.height ?? 0)).toBeLessThan(
    stepTriggerBox?.y ?? 0,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/agents`);

  const mobileCommandTrigger = page.getByTestId('agent-command-trigger');
  await mobileCommandTrigger.click();
  const mobileCommandDialog = page.getByTestId('agent-command-dialog');
  await expect(mobileCommandDialog).toBeVisible();
  const dialogBox = await mobileCommandDialog.boundingBox();
  const viewport = page.viewportSize();
  expect(dialogBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(
    Math.abs(
      (dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) / 2 - (viewport?.width ?? 0) / 2,
    ),
  ).toBeLessThan(80);

  await page.getByRole('option', { name: 'Build' }).click();
  await expect(page.getByTestId('agent-input')).toBeDisabled();
  await page.getByTestId('agent-step-trigger').click();
  await page.getByRole('option', { name: 'Step 2' }).click();
  await page.getByTestId('agent-send').click();

  await expect
    .poll(() => commandRunBodies.length, {
      timeout: 10000,
      message: 'Expected one command run POST request from the shared send button',
    })
    .toBe(1);
  expect(commandRunBodies[0]).toMatchObject({
    commandName: 'build',
    startStep: 2,
  });
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

test('agents keeps instruction input responsive while a long transcript is visible', async ({
  page,
}) => {
  await skipIfUnreachable(page);

  const runBodies: Array<Record<string, unknown>> = [];
  const conversationId = 'long-transcript-agents';
  await routeAgentsApis(page, runBodies, {
    conversations: [
      {
        conversationId,
        title: 'Long transcript responsiveness',
        provider: 'codex',
        model: 'gpt-5.3-codex',
        lastMessageAt: '2025-01-01T00:00:30.000Z',
      },
    ],
    turnsByConversationId: {
      [conversationId]: buildLongTranscriptTurns(conversationId),
    },
  });

  await page.goto(`${baseUrl}/agents`);
  await page.getByTestId('conversation-row').first().click();

  const transcript = page.getByTestId('chat-transcript');
  await expect(transcript).toBeVisible();
  await expect(page.getByTestId('chat-bubble').first()).toBeVisible();

  await expect
    .poll(
      async () =>
        await transcript.evaluate((node) => {
          const element = node as HTMLDivElement;
          return element.scrollHeight > element.clientHeight;
        }),
      { timeout: 10000, message: 'Expected the long transcript to scroll' },
    )
    .toBe(true);

  const input = page.getByTestId('agent-input');
  const send = page.getByTestId('agent-send');
  const longInstruction = [
    'Please continue the long transcript validation.',
    'Keep the rendered transcript visible while I type.',
    'Do not drop characters or disable the send button.',
  ].join(' ');

  await input.fill(longInstruction);
  await expect(input).toHaveValue(longInstruction);
  await expect(send).toBeEnabled();
});

test('agents warning timing and disabled-state guard stay visible at the browser surface', async ({
  page,
}) => {
  await skipIfUnreachable(page);

  const runBodies: Array<Record<string, unknown>> = [];
  const commandRunBodies: Array<Record<string, unknown>> = [];

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

    if (path === '/agents/coding_agent' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agent: {
            name: 'coding_agent',
            description: 'Disabled now',
            disabled: true,
            warnings: [
              {
                code: 'invalid_provider',
                message:
                  'Agent config requested unsupported provider "not-a-provider".',
              },
            ],
            disabledReason: {
              code: 'provider_unavailable',
              message: 'No usable provider remains',
            },
            fallbackCandidates: [],
          },
        }),
      });
      return;
    }

    if (path === '/agents/coding_agent/commands' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          commands: [
            {
              name: 'improve_plan',
              description: 'Improve',
              disabled: false,
              stepCount: 1,
            },
          ],
        }),
      });
      return;
    }

    if (path === '/conversations' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
      return;
    }

    if (path === '/agents/coding_agent/commands/run' && method === 'POST') {
      commandRunBodies.push((req.postDataJSON?.() ?? {}) as Record<string, unknown>);
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'started',
          agentName: 'coding_agent',
          conversationId: 'c1',
          inflightId: 'i2',
          modelId: 'gpt-5.3-codex',
        }),
      });
      return;
    }

    if (path === '/agents/coding_agent/run' && method === 'POST') {
      runBodies.push((req.postDataJSON?.() ?? {}) as Record<string, unknown>);
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'started',
          agentName: 'coding_agent',
          conversationId: 'c1',
          inflightId: 'i1',
          modelId: 'gpt-5.3-codex',
        }),
      });
      return;
    }

    await route.continue();
  });

  await page.goto(`${baseUrl}/agents`);

  const infoButton = page.getByTestId('agent-info');
  const sendButton = page.getByTestId('agent-send');
  const commandSelect = page.getByRole('combobox', { name: 'Command' });
  const executeCommandButton = page.getByTestId('agent-command-execute');
  const folder = page.getByRole('textbox', { name: 'working_folder' });

  await expect(infoButton).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText(/unsupported provider "not-a-provider"/i),
  ).toHaveCount(0);
  await commandSelect.click();
  await page.getByRole('option', { name: 'Improve' }).click();
  await expect(executeCommandButton).toBeEnabled();

  await folder.fill('/tmp/stale');
  await infoButton.click();

  await expect(
    page.getByText(/unsupported provider "not-a-provider"/i),
  ).toBeVisible();
  await expect(page.getByTestId('agent-disabled')).toContainText(
    'No usable provider remains',
  );
  await expect(sendButton).toBeDisabled();
  await expect(executeCommandButton).toBeDisabled();
  expect(runBodies).toHaveLength(0);
  expect(commandRunBodies).toHaveLength(0);
});
