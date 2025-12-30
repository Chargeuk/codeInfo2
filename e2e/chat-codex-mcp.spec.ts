import { expect, test } from '@playwright/test';
import { installMockChatWs } from './support/mockChatWs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const useMockChat = process.env.E2E_USE_MOCK_CHAT === 'true';

// Minimal repo + vector payload used in tool-result
const repos = [
  {
    id: 'Code Info 2',
    description: 'demo',
    containerPath: '/data/repo',
    hostPath: '/host/repo',
    hostPathWarning: undefined,
    lastIngestAt: '2025-12-01T00:00:00.000Z',
    modelId: 'embed-model',
    counts: { files: 1, chunks: 1, embedded: 1 },
    lastError: null,
  },
];

const vectorResults = [
  {
    repo: 'Code Info 2',
    relPath: 'src/index.ts',
    containerPath: '/data/repo/src/index.ts',
    hostPath: '/host/repo/src/index.ts',
    chunk: 'alpha chunk text',
    chunkId: 'chunk-1',
    modelId: 'embed-model',
    lineCount: 5,
    score: 0.9,
  },
];

const vectorFiles = [
  {
    hostPath: '/host/repo/src/index.ts',
    highestMatch: 0.9,
    chunkCount: 1,
    lineCount: 5,
    hostPathWarning: undefined,
    repo: 'Code Info 2',
    modelId: 'embed-model',
  },
];

test('Codex MCP tool call succeeds (mock)', async ({ page }) => {
  if (!useMockChat) {
    test.skip('Runs only with mock chat to keep determinism');
  }

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
    const isCodex = provider === 'codex';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: provider ?? 'lmstudio',
        available: true,
        toolsAvailable: true,
        models: isCodex
          ? [{ key: 'gpt-5.1-codex-max', displayName: 'gpt-5.1-codex-max' }]
          : [{ key: 'mock-lm', displayName: 'Mock LM' }],
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
    mockWs.sendToolEvent({
      conversationId,
      inflightId,
      event: {
        type: 'tool-request',
        callId: 'repos-1',
        name: 'ListIngestedRepositories',
      },
    });
    mockWs.sendToolEvent({
      conversationId,
      inflightId,
      event: {
        type: 'tool-result',
        callId: 'repos-1',
        name: 'ListIngestedRepositories',
        parameters: {},
        result: { repos },
      },
    });
    mockWs.sendToolEvent({
      conversationId,
      inflightId,
      event: {
        type: 'tool-request',
        callId: 'vec-1',
        name: 'VectorSearch',
      },
    });
    mockWs.sendToolEvent({
      conversationId,
      inflightId,
      event: {
        type: 'tool-result',
        callId: 'vec-1',
        name: 'VectorSearch',
        parameters: { query: 'alpha' },
        result: {
          files: vectorFiles,
          results: vectorResults,
          modelId: 'embed-model',
        },
      },
    });
    mockWs.sendAssistantDelta({
      conversationId,
      inflightId,
      delta: 'Here are your repos.',
    });
    mockWs.sendFinal({
      conversationId,
      inflightId,
      status: 'ok',
      threadId: 'mock-thread',
    });
  });

  await page.goto(`${baseUrl}/chat`);

  const providerSelect = page.getByTestId('provider-select');
  const modelSelect = page.getByTestId('model-select');
  const input = page.getByTestId('chat-input');
  const send = page.getByTestId('chat-send');

  await providerSelect.click();
  await page.getByRole('option', { name: /OpenAI Codex/i }).click();

  await modelSelect.click();
  await page.getByRole('option', { name: /gpt-5.1-codex-max/i }).click();

  const codexFlagsToggle = page
    .getByTestId('codex-flags-panel')
    .getByRole('button', { name: /Codex flags/i });
  if ((await codexFlagsToggle.getAttribute('aria-expanded')) === 'true') {
    await codexFlagsToggle.click();
  }

  await input.fill('List ingested repos');
  await send.click();

  const assistantBubble = page.locator(
    '[data-testid="chat-bubble"][data-role="assistant"][data-kind="normal"]',
  );
  await expect(assistantBubble.first()).toContainText('Here are your repos', {
    timeout: 20000,
  });

  // Expand citations to verify content is present
  await page.getByRole('button', { name: /citations/i }).click();
  await expect(page.getByText('Code Info 2')).toBeVisible();
  await expect(page.getByText('/host/repo/src/index.ts')).toBeVisible();
});
