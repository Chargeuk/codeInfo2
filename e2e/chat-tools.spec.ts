import { mkdirSync } from 'fs';
import { expect, test, type APIRequestContext } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:5010';
const fixturePath = '/fixtures/repo';
const fixtureName = 'fixtures-chat-tools';
const preferredModelId = 'text-embedding-qwen3-embedding-4b';

type IngestModel = { id: string; displayName: string };

async function pickEmbeddingModel(request: APIRequestContext) {
  const res = await request.get(`${apiBase}/ingest/models`);
  if (!res.ok()) {
    test.skip(`ingest/models unavailable (${res.status()})`);
  }
  const data = await res.json();
  const models = (data.models ?? []) as IngestModel[];
  if (!Array.isArray(models) || models.length === 0) {
    test.skip('no embedding models available');
  }
  const preferred = models.find((m) => m.id === preferredModelId);
  return preferred ?? models[0];
}

async function clearRoots(request: APIRequestContext) {
  const rootsRes = await request.get(`${apiBase}/ingest/roots`);
  if (!rootsRes.ok()) return;
  const data = await rootsRes.json();
  const roots = Array.isArray(data.roots) ? data.roots : [];
  for (const root of roots) {
    if (!root?.path) continue;
    await request.post(
      `${apiBase}/ingest/remove/${encodeURIComponent(root.path as string)}`,
    );
  }
}

async function startIngest(request: APIRequestContext, modelId: string) {
  const startRes = await request.post(`${apiBase}/ingest/start`, {
    data: {
      path: fixturePath,
      name: fixtureName,
      description: 'Chat tools citation flow',
      model: modelId,
    },
  });
  if (!startRes.ok()) {
    throw new Error(`ingest start failed (${startRes.status()})`);
  }
  const body = await startRes.json();
  return body.runId as string;
}

async function waitForIngest(request: APIRequestContext, runId: string) {
  for (let i = 0; i < 90; i += 1) {
    const statusRes = await request.get(`${apiBase}/ingest/status/${runId}`);
    if (!statusRes.ok()) {
      throw new Error(`status check failed (${statusRes.status()})`);
    }
    const status = await statusRes.json();
    const state = (status.state as string)?.toLowerCase();
    if (state === 'completed') return status;
    if (state === 'error') {
      throw new Error(`ingest error: ${status.lastError ?? 'unknown'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('ingest did not complete within timeout');
}

async function vectorSearch(
  request: APIRequestContext,
  repository: string,
  query: string,
) {
  const searchRes = await request.post(`${apiBase}/tools/vector-search`, {
    data: { query, repository, limit: 5 },
  });
  if (!searchRes.ok()) {
    throw new Error(`vector search failed (${searchRes.status()})`);
  }
  return searchRes.json();
}

test.describe.serial('Chat tools citations', () => {
  test('shows vector search citation with host path', async ({ page }) => {
    // Ensure prerequisites and ingest the fixture repo
    const model = await pickEmbeddingModel(page.request);
    await clearRoots(page.request);
    const runId = await startIngest(page.request, model.id);
    await waitForIngest(page.request, runId);

    let searchPayload: Awaited<ReturnType<typeof vectorSearch>> | undefined;
    try {
      searchPayload = await vectorSearch(
        page.request,
        fixtureName,
        'What does main.txt say about the project?',
      );
    } catch (err) {
      test.skip(`vector search unavailable: ${(err as Error).message}`);
    }
    const firstResult = searchPayload?.results?.[0];
    if (!firstResult) {
      test.skip('vector search returned no results');
    }

    const mockChatModels = [
      { key: 'mock-chat', displayName: 'Mock Chat Model' },
    ];

    await page.route('**/chat/models', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockChatModels),
      }),
    );

    await page.route('**/chat', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const events = [
        {
          type: 'tool-request',
          callId: 't1',
          name: 'VectorSearch',
          roundIndex: 0,
        },
        {
          type: 'tool-result',
          name: 'VectorSearch',
          callId: 't1',
          result: {
            results: [firstResult],
            modelId: firstResult.modelId ?? null,
          },
          roundIndex: 0,
        },
        {
          type: 'final',
          message: {
            role: 'assistant',
            content: `I found this in ${firstResult.repo}/${firstResult.relPath}: ${firstResult.chunk}`,
          },
          roundIndex: 0,
        },
        { type: 'complete' },
      ];
      const body = events
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join('');
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body,
      });
    });

    await page.goto(`${baseUrl}/chat`);

    mkdirSync('test-results/screenshots', { recursive: true });

    const input = page.getByTestId('chat-input');
    const send = page.getByTestId('chat-send');

    await input.fill('What does main.txt say about the project?');
    await send.click();

    const toolToggle = page.getByTestId('tool-toggle');
    await toolToggle.waitFor({ timeout: 20000 });
    await toolToggle.click();

    const pathLabel = `${firstResult.repo}/${firstResult.relPath}`;
    const hostSuffix = firstResult.hostPath ? ` (${firstResult.hostPath})` : '';

    const citations = page.getByTestId('citations');
    await expect(citations).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('citation-path').first()).toHaveText(
      pathLabel + hostSuffix,
    );
    await expect(page.getByTestId('citation-chunk').first()).toContainText(
      firstResult.chunk,
    );

    await expect(page.getByTestId('tool-result-path').first()).toHaveText(
      pathLabel + hostSuffix,
    );
    await expect(page.getByTestId('tool-result-chunk').first()).toContainText(
      firstResult.chunk,
    );

    const assistantBubble = page
      .getByTestId('chat-bubble')
      .filter({ has: page.getByTestId('tool-row') })
      .first();
    const toolBeforeText = await assistantBubble.evaluate((el) => {
      const tool = el.querySelector('[data-testid="tool-row"]');
      const text = Array.from(
        el.querySelectorAll('[data-testid="assistant-markdown"]'),
      ).find((node) => node.textContent?.includes('I found this'));
      if (!tool || !text) return false;
      return !!(
        tool.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    });

    expect(toolBeforeText).toBeTruthy();

    await page.screenshot({
      path: 'test-results/screenshots/0000006-4-chat-tools.png',
      fullPage: true,
    });
  });

  test('stops spinner when tool-result is missing but a final tool message appears', async ({
    page,
  }) => {
    const mockChatModels = [
      { key: 'mock-chat', displayName: 'Mock Chat Model' },
    ];

    await page.route('**/chat/models', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockChatModels),
      }),
    );

    await page.route('**/chat', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const events = [
        {
          type: 'tool-request',
          callId: 'miss-1',
          name: 'VectorSearch',
          roundIndex: 0,
        },
        {
          type: 'final',
          message: {
            role: 'tool',
            content: {
              toolCallId: 'miss-1',
              name: 'VectorSearch',
              result: { results: [{ repo: 'r', relPath: 'a.txt' }] },
            },
          },
          roundIndex: 0,
        },
        {
          type: 'token',
          content: 'Here is the answer after the tool.',
          roundIndex: 0,
        },
        {
          type: 'final',
          message: {
            role: 'assistant',
            content: 'Here is the answer after the tool.',
          },
          roundIndex: 0,
        },
        { type: 'complete' },
      ];
      const body = events
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

    await input.fill('Hi');
    await send.click();

    const toolRow = page.getByTestId('tool-row');
    await expect(toolRow).toBeVisible({ timeout: 20000 });
    const answer = page.getByText('Here is the answer after the tool.');
    await expect(answer).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('tool-spinner')).not.toBeVisible({
      timeout: 20000,
    });

    const assistantBubble = page
      .getByTestId('chat-bubble')
      .filter({ has: toolRow })
      .first();
    const toolBeforeText = await assistantBubble.evaluate((el) => {
      const tool = el.querySelector('[data-testid="tool-row"]');
      const text = el.querySelector('[data-testid="assistant-markdown"]');
      if (!tool || !text) return false;
      return !!(
        tool.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    });

    expect(toolBeforeText).toBeTruthy();
  });
});
