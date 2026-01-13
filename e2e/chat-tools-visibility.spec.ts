import { mkdirSync } from 'fs';
import { expect, test, type Page } from '@playwright/test';
import { installMockChatWs, type MockChatWsServer } from './support/mockChatWs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';

const mockModels = [{ key: 'mock-chat', displayName: 'Mock Chat Model' }];
const codexReason = 'Missing auth.json in ./codex and config.toml in ./codex';

type ToolEvent = Record<string, unknown>;

function sendLegacyStreamEvent(
  mockWs: MockChatWsServer,
  args: { conversationId: string; inflightId: string },
  event: ToolEvent,
) {
  const type = event.type;
  if (type === 'token') {
    const delta = typeof event.content === 'string' ? event.content : '';
    if (delta) {
      mockWs.sendAssistantDelta({
        conversationId: args.conversationId,
        inflightId: args.inflightId,
        delta,
      });
    }
    return;
  }

  if (type === 'tool-request' || type === 'tool-result') {
    const callId =
      typeof event.callId === 'string'
        ? event.callId
        : typeof event.toolCallId === 'string'
          ? event.toolCallId
          : 'call-1';
    const name = typeof event.name === 'string' ? event.name : undefined;
    mockWs.sendToolEvent({
      conversationId: args.conversationId,
      inflightId: args.inflightId,
      event: {
        ...event,
        type,
        callId,
        ...(name ? { name } : {}),
      },
    });
    return;
  }

  if (type === 'final') {
    const message = event.message as
      | { role?: string; content?: unknown }
      | undefined;
    if (message?.role === 'assistant' && typeof message.content === 'string') {
      mockWs.sendAssistantDelta({
        conversationId: args.conversationId,
        inflightId: args.inflightId,
        delta: message.content,
      });
    }
    return;
  }
}

async function mockChatModels(page: Page, toolsAvailable = true) {
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
            toolsAvailable,
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
        toolsAvailable,
        models: mockModels,
      }),
    });
  });
}

async function mockChatStream(
  page: Page,
  mockWs: MockChatWsServer,
  events: ToolEvent[],
) {
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
    events.forEach((event) =>
      sendLegacyStreamEvent(
        mockWs,
        { conversationId, inflightId },
        event,
      ),
    );
    mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
  });
}

const vectorFiles = [
  {
    hostPath: '/data/repo/beta/file-b.txt',
    highestMatch: 0.71,
    chunkCount: 2,
    lineCount: 14,
    modelId: 'embed-1',
  },
  {
    hostPath: '/data/repo/alpha/file-a.txt',
    highestMatch: 0.904,
    chunkCount: 3,
    lineCount: 20,
    modelId: 'embed-1',
  },
];

const repos = [
  {
    id: 'repo-one',
    hostPath: '/data/repo-one',
    containerPath: '/repo/repo-one',
    counts: { files: 3, chunks: 5, embedded: 5 },
    lastIngestAt: '2025-11-01T10:00:00Z',
    modelId: 'embed-1',
    lastError: null,
    description: 'first repo',
  },
  {
    id: 'repo-two',
    hostPath: '/data/repo-two',
    containerPath: '/repo/repo-two',
    counts: { files: 1, chunks: 1, embedded: 1 },
    lastIngestAt: '2025-11-02T09:00:00Z',
    modelId: 'embed-1',
    lastError: 'previous failure',
    description: 'second repo',
  },
];

test.describe('Chat tool visibility details', () => {
  test('success path shows closed tool blocks, parameters, repos, and vector files', async ({
    page,
  }) => {
    const mockWs = await installMockChatWs(page);
    await mockChatModels(page);

    const events: ToolEvent[] = [
      { type: 'token', content: 'Thinking...', roundIndex: 0 },
      {
        type: 'tool-request',
        callId: 'repos-1',
        name: 'ListIngestedRepositories',
        roundIndex: 0,
      },
      {
        type: 'tool-result',
        callId: 'repos-1',
        name: 'ListIngestedRepositories',
        roundIndex: 0,
        parameters: { limit: 50 },
        result: { repos },
      },
      {
        type: 'tool-request',
        callId: 'vec-1',
        name: 'VectorSearch',
        roundIndex: 0,
      },
      {
        type: 'tool-result',
        callId: 'vec-1',
        name: 'VectorSearch',
        roundIndex: 0,
        parameters: { query: 'alpha info', limit: 5 },
        result: {
          files: vectorFiles,
          results: [
            {
              repo: 'Code Info 2',
              relPath: 'src/index.ts',
              hostPath: '/data/repo/alpha/file-a.txt',
              chunk: 'alpha chunk text',
              chunkId: 'c-1',
              score: 0.9,
              lineCount: 10,
            },
          ],
          modelId: 'embed-1',
        },
      },
      {
        type: 'final',
        message: { role: 'assistant', content: 'Here are the tool details.' },
        roundIndex: 0,
      },
      { type: 'complete' },
    ];

    await mockChatStream(page, mockWs, events);

    await page.goto(`${baseUrl}/chat`);

    await page.getByTestId('chat-input').fill('Show tools');
    await page.getByTestId('chat-send').click();

    await expect(page.getByText('Here are the tool details.')).toBeVisible();

    const citationsToggle = page.getByTestId('citations-toggle');
    await expect(citationsToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('citations')).not.toBeVisible();
    await citationsToggle.click();
    await expect(page.getByTestId('citations')).toBeVisible();
    await expect(page.getByTestId('citations')).toContainText(
      'alpha chunk text',
    );

    await expect(page.getByTestId('status-chip')).toContainText('Complete');

    const toolRows = page.getByTestId('tool-row');
    await expect(toolRows).toHaveCount(2, { timeout: 20000 });

    // Closed by default
    const firstToggle = page.getByTestId('tool-toggle').first();
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'false');

    // Open repo tool and verify parameters accordion default-closed
    await firstToggle.click();
    const firstParams = page.getByTestId('tool-params-accordion').first();
    await expect(firstParams.getByRole('button')).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    // Expand repo tool accordion entries and verify metadata
    const repoItems = page.getByTestId('tool-repo-item');
    await expect(repoItems).toHaveCount(2);
    await repoItems.first().click();
    await expect(repoItems.first()).toContainText('/data/repo-one');
    await expect(repoItems.last()).toContainText('previous failure');

    // Expand vector tool and verify aggregation (alphabetical order, counts, lines)
    const secondToggle = page.getByTestId('tool-toggle').nth(1);
    await secondToggle.click();
    const fileItems = page.getByTestId('tool-file-item');
    await expect(fileItems).toHaveCount(2);
    await expect(fileItems.first()).toContainText(
      '/data/repo/alpha/file-a.txt',
    );
    await expect(fileItems.first()).toContainText('distance 0.90');
    await expect(fileItems.first()).toContainText('chunks 3');
    await expect(fileItems.first()).toContainText('lines 20');

    mkdirSync('test-results/screenshots', { recursive: true });
    await page.screenshot({
      path: 'test-results/screenshots/0000008-03-chat-tools-success.png',
      fullPage: true,
    });
  });

  test('failure path shows trimmed and full error payload', async ({
    page,
  }) => {
    const mockWs = await installMockChatWs(page);
    await mockChatModels(page);

    const events: ToolEvent[] = [
      { type: 'token', content: 'Starting search', roundIndex: 0 },
      {
        type: 'tool-request',
        callId: 'vec-err',
        name: 'VectorSearch',
        roundIndex: 0,
      },
      {
        type: 'tool-result',
        callId: 'vec-err',
        name: 'VectorSearch',
        roundIndex: 0,
        stage: 'error',
        parameters: { query: 'fail', limit: 5 },
        errorTrimmed: {
          code: 'MODEL_UNAVAILABLE',
          message: 'embedding missing',
        },
        errorFull: {
          code: 'MODEL_UNAVAILABLE',
          message: 'embedding missing',
          stack: 'trace',
          meta: { modelId: 'embed-1' },
        },
        result: {},
      },
      {
        type: 'final',
        message: { role: 'assistant', content: 'Unable to run tool.' },
        roundIndex: 0,
      },
      { type: 'complete' },
    ];

    await mockChatStream(page, mockWs, events);

    await page.goto(`${baseUrl}/chat`);
    await page.getByTestId('chat-input').fill('Trigger failure');
    await page.getByTestId('chat-send').click();

    const summary = page.getByTestId('tool-call-summary');
    await expect(summary).toContainText('Failed', { timeout: 20000 });

    const toggle = page.getByTestId('tool-toggle');
    await toggle.click();
    await expect(page.getByTestId('tool-error-trimmed')).toContainText(
      'MODEL_UNAVAILABLE',
    );

    const showFull = page.getByTestId('tool-error-toggle');
    await showFull.click();
    await expect(page.getByTestId('tool-error-full')).toContainText('stack');

    mkdirSync('test-results/screenshots', { recursive: true });
    await page.screenshot({
      path: 'test-results/screenshots/0000008-03-chat-tools-failure.png',
      fullPage: true,
    });
  });

  test('renders synthesized-only tool-result stream', async ({ page }) => {
    const mockWs = await installMockChatWs(page);
    await mockChatModels(page);

    const events: ToolEvent[] = [
      { type: 'token', content: 'Synth start', roundIndex: 0 },
      {
        type: 'tool-request',
        callId: 'syn-1',
        name: 'VectorSearch',
        roundIndex: 0,
      },
      {
        type: 'tool-result',
        callId: 'syn-1',
        name: 'VectorSearch',
        stage: 'success',
        parameters: { query: 'only synthesized' },
        result: {
          files: [
            {
              hostPath: '/data/repo/synth/file.txt',
              highestMatch: 0.5,
              chunkCount: 1,
              lineCount: 4,
            },
          ],
          results: [],
          modelId: 'embed-1',
        },
      },
      {
        type: 'final',
        message: { role: 'assistant', content: 'synth done' },
        roundIndex: 0,
      },
      { type: 'complete' },
    ];

    await mockChatStream(page, mockWs, events);

    await page.goto(`${baseUrl}/chat`);
    await page.getByTestId('chat-input').fill('Show synthesized');
    await page.getByTestId('chat-send').click();

    const toolRow = page.getByTestId('tool-row');
    await expect(toolRow).toHaveCount(1, { timeout: 20000 });
    const toggle = page.getByTestId('tool-toggle');
    await toggle.click();
    const fileItem = page.getByTestId('tool-file-item').first();
    await expect(fileItem).toContainText('/data/repo/synth/file.txt');
    await expect(fileItem).toContainText('chunks 1');
    await expect(fileItem).toContainText('lines 4');
  });

  test('hides tool blocks and citations when tools are unavailable', async ({
    page,
  }) => {
    const mockWs = await installMockChatWs(page);
    await mockChatModels(page, false);

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
      await mockWs.sendInflightSnapshot({ conversationId, inflightId });
      await mockWs.sendAssistantDelta({
        conversationId,
        inflightId,
        delta: 'No tools shown',
      });
      await mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
    });

    await page.goto(`${baseUrl}/chat`);
    await expect(page.getByTestId('model-select')).toBeEnabled({
      timeout: 20000,
    });
    await page.getByTestId('chat-input').fill('Check tools');
    await page.getByTestId('chat-send').click();

    await expect(page.getByText('No tools shown')).toBeVisible();
    await expect(page.getByTestId('citations-toggle')).toHaveCount(0);
    await expect(page.getByTestId('tool-row')).toHaveCount(0, {
      timeout: 20000,
    });
  });

  test('does not surface raw tool payload text as an assistant reply', async ({
    page,
  }) => {
    const mockWs = await installMockChatWs(page);
    await mockChatModels(page);

    const events: ToolEvent[] = [
      { type: 'token', content: 'Loading tool', roundIndex: 0 },
      {
        type: 'tool-request',
        callId: 'no-echo',
        name: 'VectorSearch',
        roundIndex: 0,
      },
      {
        type: 'tool-result',
        callId: 'no-echo',
        name: 'VectorSearch',
        stage: 'success',
        parameters: { query: 'suppress' },
        result: {
          files: [
            {
              hostPath: '/host/path/a.txt',
              highestMatch: 0.8,
              chunkCount: 1,
              lineCount: 5,
            },
          ],
          results: [
            {
              hostPath: '/host/path/a.txt',
              chunk: 'raw chunk text that should not show as assistant',
              score: 0.8,
              lineCount: 5,
            },
          ],
          modelId: 'embed-1',
        },
      },
      { type: 'complete' },
    ];

    await mockChatStream(page, mockWs, events);

    await page.goto(`${baseUrl}/chat`);
    await page.getByTestId('chat-input').fill('Suppress echo');
    await page.getByTestId('chat-send').click();

    await expect(page.getByTestId('tool-call-summary')).toContainText(
      'VectorSearch',
      { timeout: 20000 },
    );
    await expect(
      page.getByText(/raw chunk text that should not show as assistant/i),
    ).not.toBeVisible();
  });

  test('assistant JSON vector payload without callId stays hidden', async ({
    page,
  }) => {
    const mockWs = await installMockChatWs(page);
    await mockChatModels(page);

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
      await mockWs.sendInflightSnapshot({ conversationId, inflightId });
      await mockWs.sendToolEvent({
        conversationId,
        inflightId,
        event: {
          type: 'tool-request',
          callId: 'shape',
          name: 'VectorSearch',
        },
      });
      await mockWs.sendToolEvent({
        conversationId,
        inflightId,
        event: {
          type: 'tool-result',
          callId: 'shape',
          name: 'VectorSearch',
          stage: 'success',
          parameters: { query: 'shape' },
          result: {
            files: [
              {
                hostPath: '/h/a.txt',
                highestMatch: 0.6,
                chunkCount: 1,
                lineCount: 2,
              },
            ],
            results: [
              {
                hostPath: '/h/a.txt',
                chunk: 'hidden text',
                score: 0.6,
                lineCount: 2,
              },
            ],
          },
        },
      });
      await mockWs.sendAssistantDelta({
        conversationId,
        inflightId,
        delta:
          '{"results":[{"hostPath":"/h/a.txt","chunk":"hidden text","score":0.6}],"files":[{"hostPath":"/h/a.txt"}]}',
      });
      await mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
    });

    await page.goto(`${baseUrl}/chat`);
    await page.getByTestId('chat-input').fill('Shape suppression');
    await page.getByTestId('chat-send').click();

    const toolRow = page.getByTestId('tool-row');
    await expect(toolRow).toHaveCount(1, { timeout: 20000 });
  });

  test('thinking spinner tracks idle gaps but ignores tool-only waits', async ({
    page,
  }) => {
    const mockWs = await installMockChatWs(page);
    await mockChatModels(page);

    const events: Array<{ delay: number; event: ToolEvent }> = [
      {
        delay: 1200,
        event: { type: 'token', content: 'First reply' },
      },
      {
        delay: 1500,
        event: {
          type: 'tool-request',
          callId: 'gap-tool',
          name: 'VectorSearch',
        },
      },
      {
        delay: 2600,
        event: {
          type: 'tool-result',
          callId: 'gap-tool',
          name: 'VectorSearch',
          result: { files: [], results: [] },
        },
      },
      {
        delay: 3800,
        event: { type: 'token', content: 'Second reply' },
      },
      {
        delay: 3900,
        event: {
          type: 'final',
          message: { role: 'assistant', content: 'Second reply' },
          roundIndex: 0,
        },
      },
      { delay: 4000, event: { type: 'complete' } },
    ];

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

      const maxDelay = Math.max(...events.map((e) => e.delay), 0);
      events.forEach(({ delay, event }) => {
        setTimeout(() => {
          sendLegacyStreamEvent(
            mockWs,
            { conversationId, inflightId },
            event,
          );
        }, delay);
      });
      setTimeout(() => {
        mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
      }, maxDelay + 50);
    });

    await page.goto(`${baseUrl}/chat`);

    await page.getByTestId('chat-input').fill('Spinner flow');
    await page.getByTestId('chat-send').click();

    const thinking = page.getByTestId('thinking-placeholder');

    await page.waitForTimeout(1100);
    await expect(thinking).toBeVisible();

    await page.waitForTimeout(400);
    await expect(thinking).toHaveCount(0);

    // During tool-only wait (no new assistant text), spinner stays off.
    await page.waitForTimeout(1600);
    await expect(thinking).toHaveCount(0);

    await page.waitForTimeout(900);
    await expect(page.getByText('Second reply')).toBeVisible();
    await expect(thinking).toHaveCount(0);
  });

  test('status chip stays processing until tool-result arrives after complete', async ({
    page,
  }) => {
    const mockWs = await installMockChatWs(page);
    await mockChatModels(page);

    await mockChatStream(page, mockWs, [
      { type: 'token', content: 'Starting status', roundIndex: 0 },
      {
        type: 'tool-request',
        callId: 'gated-1',
        name: 'VectorSearch',
        roundIndex: 0,
      },
      {
        type: 'final',
        message: { role: 'assistant', content: 'Thinking about languages...' },
        roundIndex: 0,
      },
      { type: 'token', content: 'Still working', roundIndex: 0 },
      {
        type: 'tool-result',
        callId: 'gated-1',
        name: 'VectorSearch',
        roundIndex: 0,
        result: {
          files: [
            {
              hostPath: '/host/path/gated.txt',
              highestMatch: 0.7,
              chunkCount: 1,
              lineCount: 3,
            },
          ],
          results: [],
        },
      },
      {
        type: 'final',
        message: { role: 'tool', content: '' },
        roundIndex: 1,
      },
      {
        type: 'final',
        message: {
          role: 'assistant',
          content: 'The repo uses Python and TypeScript.',
        },
        roundIndex: 2,
      },
      { type: 'complete' },
    ]);

    await page.goto(`${baseUrl}/chat`);
    await page.getByTestId('chat-input').fill('Gated status');
    await page.getByTestId('chat-send').click();

    const statusChip = page.getByTestId('status-chip');
    await expect(statusChip).toBeVisible();
    await expect(statusChip).toContainText('Complete', { timeout: 10000 });
  });

  test('parameters accordion reveals JSON when opened', async ({ page }) => {
    const mockWs = await installMockChatWs(page);
    await mockChatModels(page);

    const params = { query: 'alpha info', limit: 3 };
    const events: ToolEvent[] = [
      {
        type: 'tool-request',
        callId: 'vec-params',
        name: 'VectorSearch',
        roundIndex: 0,
      },
      {
        type: 'tool-result',
        callId: 'vec-params',
        name: 'VectorSearch',
        roundIndex: 0,
        parameters: params,
        result: { files: [], results: [] },
      },
      {
        type: 'final',
        message: { role: 'assistant', content: 'Params shown.' },
        roundIndex: 0,
      },
      { type: 'complete' },
    ];

    await mockChatStream(page, mockWs, events);

    await page.goto(`${baseUrl}/chat`);
    await page.getByTestId('chat-input').fill('Show params');
    await page.getByTestId('chat-send').click();

    const toggle = page.getByTestId('tool-toggle');
    await toggle.click();

    const paramsAccordion = page.getByTestId('tool-params-accordion');
    await paramsAccordion.getByRole('button').click();
    await expect(paramsAccordion).toContainText('"query": "alpha info"');
    await expect(paramsAccordion).toContainText('"limit": 3');
  });
});
