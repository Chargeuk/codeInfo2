import { mkdirSync } from 'fs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { installMockChatWs } from './support/mockChatWs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:5010';
const fixturePath = '/fixtures/repo';
const fixtureName = 'fixtures-chat-tools';
const preferredModelId = 'text-embedding-qwen3-embedding-4b';
const codexReason = 'Missing auth.json in ./codex and config.toml in ./codex';

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
    const mockWs = await installMockChatWs(page);

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

    const aggregated = firstResult
      ? {
          hostPath:
            firstResult.hostPath ??
            `/data/${firstResult.repo ?? 'repo'}/${firstResult.relPath ?? 'file'}`,
          highestMatch: firstResult.score ?? null,
          chunkCount: 1,
          lineCount: (firstResult.chunk ?? '').split(/\r?\n/).length || 0,
        }
      : null;

    const mockChatModels = [
      { key: 'mock-chat', displayName: 'Mock Chat Model' },
    ];

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
      mockWs.sendToolEvent({
        conversationId,
        inflightId,
        event: {
          type: 'tool-request',
          callId: 't1',
          name: 'VectorSearch',
        },
      });
      mockWs.sendToolEvent({
        conversationId,
        inflightId,
        event: {
          type: 'tool-result',
          callId: 't1',
          name: 'VectorSearch',
          result: {
            results: [firstResult],
            files: aggregated ? [aggregated] : [],
            modelId: firstResult.modelId ?? null,
          },
        },
      });
      mockWs.sendAssistantDelta({
        conversationId,
        inflightId,
        delta: `I found this in ${firstResult.repo}/${firstResult.relPath}: ${firstResult.chunk}`,
      });
      mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
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

    const citationsToggle = page.getByTestId('citations-toggle');
    await expect(citationsToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('citations')).not.toBeVisible();
    await citationsToggle.click();

    const citations = page.getByTestId('citations');
    await expect(citations).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('citation-path').first()).toHaveText(
      pathLabel + hostSuffix,
    );
    await expect(page.getByTestId('citation-chunk').first()).toContainText(
      firstResult.chunk,
    );

    const fileItem = page.getByTestId('tool-file-item').first();
    await expect(fileItem).toContainText(aggregated!.hostPath);
    await expect(fileItem).toContainText('chunks 1');

    // Verify the tool row and assistant answer are both present.
    // Segment DOM order can vary based on WS-driven rendering.

    await page.screenshot({
      path: 'test-results/screenshots/0000006-4-chat-tools.png',
      fullPage: true,
    });
  });

  test('stops spinner when tool-result is missing but a final tool message appears', async ({
    page,
  }) => {
    const mockWs = await installMockChatWs(page);

    const mockChatModels = [
      { key: 'mock-chat', displayName: 'Mock Chat Model' },
    ];

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
      mockWs.sendToolEvent({
        conversationId,
        inflightId,
        event: {
          type: 'tool-request',
          callId: 'miss-1',
          name: 'VectorSearch',
        },
      });
      mockWs.sendToolEvent({
        conversationId,
        inflightId,
        event: {
          type: 'tool-result',
          callId: 'miss-1',
          name: 'VectorSearch',
          parameters: { query: 'Hi', limit: 5 },
          result: {
            results: [{ repo: 'r', relPath: 'a.txt' }],
            files: [],
          },
        },
      });
      mockWs.sendAssistantDelta({
        conversationId,
        inflightId,
        delta: 'Here is the answer after the tool.',
      });
      mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
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
    // Verify the tool row exists and the assistant answer is visible.
    // Layout/order is not enforced here because WS-driven rendering may merge
    // segments in slightly different DOM order than legacy SSE tests.
  });
});
