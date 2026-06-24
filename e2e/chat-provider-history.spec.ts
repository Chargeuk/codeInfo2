import { expect, test } from '@playwright/test';
import { logPlaywrightCopilotScenarioRegistration } from './support/copilotFakeScenario';
import { installMockChatWs } from './support/mockChatWs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001';
const apiBase = process.env.E2E_API_URL ?? 'http://host.docker.internal:6010';
const useMockChat = process.env.E2E_USE_MOCK_CHAT === 'true';

const hideMcpOverlay = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() => {
    const sidebar = document.getElementById('mcp-sidebar');
    if (sidebar) sidebar.style.display = 'none';
    const frame = document.querySelector('iframe[name="toolbox-frame"]');
    if (frame) (frame as HTMLElement).style.display = 'none';
  });
};

test('resumed chat history rehydrates the stored provider before showing turns', async ({
  page,
}) => {
  page.on('console', (msg) => {
    console.log('[browser]', msg.type(), msg.text());
  });
  page.on('response', (res) => {
    if (res.url().includes('/conversations')) {
      console.log('conversations response', res.url(), res.status());
    }
  });
  const ping = await page.request.get(baseUrl);
  if (!ping.ok()) {
    test.skip(`Client not reachable (${ping.status()})`);
  }

  // Check providers and require Codex availability for this scenario.
  const providersRes = await page.request.get(`${apiBase}/chat/providers`);
  if (!providersRes.ok()) {
    test.skip('Providers endpoint unavailable');
  }
  const providersData = await providersRes.json();
  const providers = Array.isArray(providersData.providers)
    ? providersData.providers
    : providersData;
  const codexAvailable = providers.some(
    (p: { id: string; available: boolean }) => p.id === 'codex' && p.available,
  );
  if (!codexAvailable) {
    test.skip('Codex provider not available');
  }

  // Seed conversations + turns.
  const seedConversation = async (
    provider: 'codex' | 'lmstudio',
    model: string,
    title: string,
    reply: string,
  ) => {
    const createRes = await page.request.post(`${apiBase}/conversations`, {
      data: { provider, model, title },
    });
    if (!createRes.ok())
      throw new Error(`Failed to create conversation ${title}`);
    const { conversationId } = (await createRes.json()) as {
      conversationId: string;
    };

    const postTurn = async (data: Record<string, unknown>) => {
      const res = await page.request.post(
        `${apiBase}/conversations/${conversationId}/turns`,
        { data },
      );
      if (!res.ok()) throw new Error(`Failed to add turn for ${title}`);
    };

    await postTurn({
      role: 'user',
      content: `hello ${provider}`,
      model,
      provider,
      status: 'ok',
    });
    await postTurn({
      role: 'assistant',
      content: reply,
      model,
      provider,
      status: 'ok',
    });

    return conversationId;
  };

  const suffix = Date.now();
  const codexTitle = `Codex history ${suffix}`;
  const lmTitle = `LM history ${suffix}`;

  const codexConversationId = await seedConversation(
    'codex',
    'gpt-5.1-codex-max',
    codexTitle,
    'codex reply',
  );
  await seedConversation('lmstudio', 'lm', lmTitle, 'lm reply');

  await expect
    .poll(async () => {
      const res = await page.request.get(`${apiBase}/conversations?limit=20`);
      if (!res.ok()) {
        return [];
      }
      const data = (await res.json()) as { items?: Array<{ title?: string }> };
      return Array.isArray(data.items)
        ? data.items
            .map((item) => (typeof item.title === 'string' ? item.title : ''))
            .filter(Boolean)
        : [];
    })
    .toContain(codexTitle);

  await page.goto(`${baseUrl}/chat`);
  await hideMcpOverlay(page);
  await page.waitForTimeout(500);

  const apiData = await page.evaluate(async (apiUrl) => {
    const res = await fetch(`${apiUrl}/conversations?limit=5`);
    return res.ok ? res.json() : { error: res.status };
  }, apiBase);
  console.log('api data from page', apiData);

  await page.getByTestId('conversation-refresh').click();
  const rowTexts = await page.$$eval(
    '[data-testid="conversation-row"]',
    (els) => els.map((el) => el.textContent ?? ''),
  );
  console.log('conversation rows found', rowTexts);

  await expect(page.getByText(codexTitle)).toBeVisible({ timeout: 15000 });

  // Click the Codex conversation.
  const turnsResponsePromise = page.waitForResponse(
    (res) =>
      res.request().method() === 'GET' &&
      res.url().includes(`/conversations/${codexConversationId}/turns`),
  );
  await page.getByText(codexTitle).click();
  const turnsResponse = await turnsResponsePromise;
  try {
    console.log(
      '[browser] turns payload',
      await turnsResponse.json(),
      'status',
      turnsResponse.status(),
    );
  } catch (err) {
    console.log('[browser] turns payload error', err);
  }
  await page.waitForFunction(
    () =>
      Boolean((window as unknown as { __chatDebug?: unknown }).__chatDebug) &&
      document.body.textContent?.includes('codex reply'),
  );
  const debugState = await page.evaluate(
    () => (window as unknown as { __chatDebug?: unknown }).__chatDebug,
  );
  console.log('chat debug snapshot', debugState);

  const providerText = await page.getByTestId('provider-select').textContent();
  console.log('provider select text', providerText);

  // Expect provider dropdown to switch to Codex (currently failing).
  await expect(page.getByTestId('provider-select')).toContainText(
    /OpenAI Codex/i,
  );

  // Transcript should show codex reply.
  const transcript = page.getByTestId('chat-transcript');
  await expect(transcript).toContainText('codex reply');
});

test('cross-provider history selection keeps Copilot pinned in the selector and transcript', async ({
  page,
}) => {
  if (!useMockChat) {
    test.skip('Requires mock chat to keep Copilot history deterministic');
  }

  const copilotScenario = logPlaywrightCopilotScenarioRegistration({
    spec: 'chat-provider-history.spec.ts',
    scenarioName: 'copilot-happy-path',
  });
  const copilotConversationId = 'copilot-history-conversation';
  const copilotConversation = {
    conversationId: copilotConversationId,
    title: 'Copilot history conversation',
    provider: 'copilot',
    model: 'copilot-gpt-5',
    source: 'REST',
    lastMessageAt: '2025-01-01T00:00:00.000Z',
    archived: false,
  };

  await page.route('**/chat/providers*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        providers: copilotScenario.e2e.providers,
      }),
    }),
  );
  await page.route('**/chat/models*', (route) => {
    const url = new URL(route.request().url());
    const provider = url.searchParams.get('provider') ?? 'lmstudio';

    if (provider === 'copilot') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(copilotScenario.e2e.copilotModels),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'lmstudio',
        available: true,
        toolsAvailable: true,
        models: [{ key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' }],
      }),
    });
  });
  await page.route('**/conversations*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [copilotConversation],
        nextCursor: null,
      }),
    }),
  );
  await page.route(
    `**/conversations/${copilotConversationId}/turns*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              turnId: 'copilot-turn-user',
              role: 'user',
              content: 'Hello from Copilot history',
              provider: 'copilot',
              model: 'copilot-gpt-5',
              status: 'ok',
              createdAt: '2025-01-01T00:00:00.000Z',
            },
            {
              turnId: 'copilot-turn-assistant',
              role: 'assistant',
              content: 'Copilot history reply',
              provider: 'copilot',
              model: 'copilot-gpt-5',
              status: 'ok',
              createdAt: '2025-01-01T00:00:01.000Z',
            },
          ],
          nextCursor: null,
        }),
      }),
  );

  await page.goto(`${baseUrl}/chat`);
  await hideMcpOverlay(page);

  await page.getByTestId('conversation-refresh').click();
  const conversationRow = page.locator('[data-testid="conversation-row"]', {
    hasText: copilotConversation.title,
  });
  await expect(conversationRow).toBeVisible({ timeout: 20000 });
  await conversationRow.click();

  await expect(page.getByTestId('provider-select')).toContainText(
    /GitHub Copilot/i,
  );
  await expect(page.getByTestId('chat-transcript')).toContainText(
    'Copilot history reply',
  );
});

test('fresh chat after selecting history ignores restored resume-only provider state', async ({
  page,
}) => {
  if (!useMockChat) {
    test.skip(
      'Requires mock chat to keep history-vs-fresh state deterministic',
    );
  }

  const chatBodies: Array<Record<string, unknown>> = [];
  const historyConversation = {
    conversationId: 'history-1',
    title: 'Historical LM conversation',
    provider: 'lmstudio',
    model: 'lm',
    source: 'REST',
    lastMessageAt: '2025-01-01T00:00:00.000Z',
    archived: false,
  };

  await page.route('**/chat/providers*', (route) =>
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
  await page.route('**/chat/models*', (route) => {
    const url = new URL(route.request().url());
    const provider = url.searchParams.get('provider') ?? 'lmstudio';
    if (provider === 'codex') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'codex',
          available: true,
          toolsAvailable: true,
          models: [
            {
              key: 'gpt-5.1-codex-max',
              displayName: 'gpt-5.1-codex-max',
              type: 'codex',
            },
          ],
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
        models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
      }),
    });
  });
  await page.route('**/conversations?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [historyConversation],
        nextCursor: null,
      }),
    }),
  );
  await page.route('**/conversations/history-1/turns*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            turnId: 'history-user',
            role: 'user',
            content: 'Earlier prompt',
            provider: 'lmstudio',
            model: 'lm',
            status: 'ok',
            createdAt: '2025-01-01T00:00:00.000Z',
          },
          {
            turnId: 'history-assistant',
            role: 'assistant',
            content: 'Earlier reply',
            provider: 'lmstudio',
            model: 'lm',
            status: 'ok',
            createdAt: '2025-01-01T00:00:01.000Z',
          },
        ],
      }),
    }),
  );
  await page.route('**/chat', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    chatBodies.push(
      (route.request().postDataJSON?.() ?? {}) as Record<string, unknown>,
    );
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'started',
        conversationId:
          typeof chatBodies.at(-1)?.conversationId === 'string'
            ? chatBodies.at(-1)?.conversationId
            : 'fresh-conversation',
        inflightId: `fresh-${chatBodies.length}`,
      }),
    });
  });

  await page.goto(`${baseUrl}/chat`);
  await hideMcpOverlay(page);

  await page.getByTestId('conversation-refresh').click();
  const historyConversationRow = page.locator(
    '[data-testid="conversation-row"]',
    {
      hasText: historyConversation.title,
    },
  );
  await expect(historyConversationRow).toBeVisible({
    timeout: 20000,
  });
  await historyConversationRow.click();
  await expect(page.getByTestId('provider-select')).toContainText(/LM Studio/i);

  await page.getByRole('button', { name: /new conversation/i }).click();
  await expect(page.getByRole('combobox', { name: /provider/i })).toBeEnabled();

  await page.getByRole('combobox', { name: /provider/i }).click();
  await page.getByRole('option', { name: /openai codex/i }).click();
  await expect(page.getByTestId('provider-select')).toContainText(
    /OpenAI Codex/i,
  );

  await page.getByTestId('chat-input').fill('Fresh run after history');
  await page.getByTestId('chat-send').click();

  await expect
    .poll(() => chatBodies.length, {
      timeout: 10000,
      message: 'Expected fresh chat submission to be sent',
    })
    .toBe(1);

  expect(chatBodies[0]?.provider).toBe('codex');
  expect(chatBodies[0]?.model).toBe('gpt-5.1-codex-max');
  expect(chatBodies[0]?.conversationId).not.toBe('history-1');
});

test('mobile endpoint-backed history selection through the conversations overlay keeps the restored endpoint visible after the overlay closes', async ({
  page,
}) => {
  if (!useMockChat) {
    test.skip('Requires mock chat to keep endpoint history deterministic');
  }

  const mockWs = await installMockChatWs(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.route('**/chat/providers*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        providers: [
          {
            id: 'codex',
            label: 'OpenAI Codex',
            available: true,
            toolsAvailable: true,
          },
          {
            id: 'lmstudio',
            label: 'LM Studio',
            available: true,
            toolsAvailable: true,
          },
        ],
        selectedProvider: 'codex',
        selectedModel: 'gpt-5.2',
        selectedEndpointId: 'https://alpha.example/base/v1',
      }),
    }),
  );
  await page.route('**/chat/models*', (route) => {
    const url = new URL(route.request().url());
    const provider = url.searchParams.get('provider') ?? 'lmstudio';

    if (provider === 'codex') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'codex',
          available: true,
          toolsAvailable: true,
          providerInfo: {
            id: 'codex',
            label: 'OpenAI Codex',
            available: true,
            toolsAvailable: true,
            defaultModel: 'gpt-5.2',
            defaultModelSource: 'config',
          },
          models: [
            {
              key: 'gpt-5.1-codex-max',
              displayName: 'gpt-5.1-codex-max',
              type: 'codex',
              endpointId: 'https://alpha.example/base/v1',
            },
            {
              key: 'gpt-5.1-codex-max',
              displayName: 'gpt-5.1-codex-max',
              type: 'codex',
              endpointId: 'https://alpha.example/alt/v1',
            },
            {
              key: 'gpt-5.2',
              displayName: 'gpt-5.2',
              type: 'codex',
              endpointId: 'https://alpha.example/base/v1',
            },
            {
              key: 'gpt-5.2',
              displayName: 'gpt-5.2',
              type: 'codex',
              endpointId: 'https://alpha.example/alt/v1',
            },
          ],
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
        models: [{ key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' }],
      }),
    });
  });
  await page.route('**/conversations*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            conversationId: 'endpoint-history-conversation',
            title: 'Endpoint history conversation',
            provider: 'codex',
            model: 'gpt-5.1-codex-max',
            source: 'REST',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            archived: false,
            flags: { endpointId: 'https://alpha.example/alt/v1' },
          },
        ],
        nextCursor: null,
      }),
    }),
  );
  await page.route(
    '**/conversations/endpoint-history-conversation/turns*',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              turnId: 'endpoint-history-user',
              role: 'user',
              content: 'Earlier prompt',
              provider: 'codex',
              model: 'gpt-5.1-codex-max',
              status: 'ok',
              createdAt: '2025-01-01T00:00:00.000Z',
            },
            {
              turnId: 'endpoint-history-assistant',
              role: 'assistant',
              content: 'Earlier reply',
              provider: 'codex',
              model: 'gpt-5.1-codex-max',
              status: 'ok',
              createdAt: '2025-01-01T00:00:01.000Z',
            },
          ],
        }),
      }),
  );
  await page.route('**/chat', async (route) => {
    if (route.request().method() !== 'POST') {
      return route.continue();
    }

    const payload = (route.request().postDataJSON?.() ?? {}) as Record<
      string,
      unknown
    >;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'started',
        conversationId: String(payload.conversationId ?? 'endpoint-history'),
        inflightId: String(payload.inflightId ?? 'endpoint-history-i1'),
        provider: payload.provider,
        model: payload.model,
      }),
    });
    const conversationId = String(payload.conversationId ?? 'endpoint-history');
    const inflightId = String(payload.inflightId ?? 'endpoint-history-i1');
    await mockWs.waitForConversationSubscription(conversationId);
    await mockWs.sendInflightSnapshot({ conversationId, inflightId });
    await mockWs.sendAssistantDelta({
      conversationId,
      inflightId,
      delta: 'Endpoint history reply',
    });
    await mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
  });

  await page.goto(`${baseUrl}/chat`);
  await hideMcpOverlay(page);

  await page.getByRole('button', { name: 'Open conversations' }).click();
  await expect(
    page.getByTestId('workspace-mobile-conversations-overlay'),
  ).toBeVisible();
  await page.getByTestId('conversation-refresh').click();
  const historyConversationRow = page.locator(
    '[data-testid="conversation-row"]',
    {
      hasText: 'Endpoint history conversation',
    },
  );
  await expect(historyConversationRow).toBeVisible({
    timeout: 20000,
  });
  await historyConversationRow.click();
  await expect(
    page.getByTestId('workspace-mobile-conversations-overlay'),
  ).toBeHidden();
  await expect(page.getByTestId('provider-select')).toContainText(
    /OpenAI Codex/i,
  );
  await expect(page.getByTestId('model-select')).toContainText(
    /gpt-5\.1-codex-max \(alpha\.example \/ alt\)/i,
  );
});

test('mobile fresh conversation after endpoint-backed history restores the create-mode endpoint pair', async ({
  page,
}) => {
  if (!useMockChat) {
    test.skip('Requires mock chat to keep endpoint history deterministic');
  }

  const mockWs = await installMockChatWs(page);
  const chatBodies: Array<Record<string, unknown>> = [];
  await page.setViewportSize({ width: 390, height: 844 });

  await page.route('**/chat/providers*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        providers: [
          {
            id: 'codex',
            label: 'OpenAI Codex',
            available: true,
            toolsAvailable: true,
          },
          {
            id: 'lmstudio',
            label: 'LM Studio',
            available: true,
            toolsAvailable: true,
          },
        ],
        selectedProvider: 'codex',
        selectedModel: 'gpt-5.2',
        selectedEndpointId: 'https://alpha.example/base/v1',
      }),
    }),
  );
  await page.route('**/chat/models*', (route) => {
    const url = new URL(route.request().url());
    const provider = url.searchParams.get('provider') ?? 'lmstudio';

    if (provider === 'codex') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'codex',
          available: true,
          toolsAvailable: true,
          providerInfo: {
            id: 'codex',
            label: 'OpenAI Codex',
            available: true,
            toolsAvailable: true,
            defaultModel: 'gpt-5.2',
            defaultModelSource: 'config',
          },
          models: [
            {
              key: 'gpt-5.1-codex-max',
              displayName: 'gpt-5.1-codex-max',
              type: 'codex',
              endpointId: 'https://alpha.example/base/v1',
            },
            {
              key: 'gpt-5.1-codex-max',
              displayName: 'gpt-5.1-codex-max',
              type: 'codex',
              endpointId: 'https://alpha.example/alt/v1',
            },
            {
              key: 'gpt-5.2',
              displayName: 'gpt-5.2',
              type: 'codex',
              endpointId: 'https://alpha.example/base/v1',
            },
            {
              key: 'gpt-5.2',
              displayName: 'gpt-5.2',
              type: 'codex',
              endpointId: 'https://alpha.example/alt/v1',
            },
          ],
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
        models: [{ key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' }],
      }),
    });
  });
  await page.route('**/conversations*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            conversationId: 'endpoint-history-conversation',
            title: 'Endpoint history conversation',
            provider: 'codex',
            model: 'gpt-5.1-codex-max',
            source: 'REST',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            archived: false,
            flags: { endpointId: 'https://alpha.example/alt/v1' },
          },
        ],
        nextCursor: null,
      }),
    }),
  );
  await page.route(
    '**/conversations/endpoint-history-conversation/turns*',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              turnId: 'endpoint-history-user',
              role: 'user',
              content: 'Earlier prompt',
              provider: 'codex',
              model: 'gpt-5.1-codex-max',
              status: 'ok',
              createdAt: '2025-01-01T00:00:00.000Z',
            },
            {
              turnId: 'endpoint-history-assistant',
              role: 'assistant',
              content: 'Earlier reply',
              provider: 'codex',
              model: 'gpt-5.1-codex-max',
              status: 'ok',
              createdAt: '2025-01-01T00:00:01.000Z',
            },
          ],
        }),
      }),
  );
  await page.route('**/chat', async (route) => {
    if (route.request().method() !== 'POST') {
      return route.continue();
    }

    const payload = (route.request().postDataJSON?.() ?? {}) as Record<
      string,
      unknown
    >;
    chatBodies.push(payload);
    const conversationId = String(payload.conversationId ?? 'endpoint-history');
    const inflightId = String(payload.inflightId ?? 'endpoint-history-i1');
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
      delta: 'Fresh draft endpoint reply',
    });
    await mockWs.sendFinal({ conversationId, inflightId, status: 'ok' });
  });

  await page.goto(`${baseUrl}/chat`);
  await hideMcpOverlay(page);

  await page.getByRole('button', { name: 'Open conversations' }).click();
  await expect(
    page.getByTestId('workspace-mobile-conversations-overlay'),
  ).toBeVisible();
  await page.getByTestId('conversation-refresh').click();
  const historyConversationRow = page.locator(
    '[data-testid="conversation-row"]',
    {
      hasText: 'Endpoint history conversation',
    },
  );
  await expect(historyConversationRow).toBeVisible({
    timeout: 20000,
  });
  await historyConversationRow.click();
  await expect(
    page.getByTestId('workspace-mobile-conversations-overlay'),
  ).toBeHidden();
  await expect(page.getByTestId('provider-select')).toContainText(
    /OpenAI Codex/i,
  );
  await expect(page.getByTestId('model-select')).toContainText(
    /gpt-5\.1-codex-max \(alpha\.example \/ alt\)/i,
  );

  await page.getByRole('button', { name: /new conversation/i }).click();
  await expect(page.getByTestId('provider-select')).toContainText(
    /OpenAI Codex/i,
  );
  await expect(page.getByTestId('model-select')).toContainText(
    /gpt-5\.2 \(alpha\.example \/ base\)/i,
  );

  await page.getByTestId('chat-input').fill('Fresh run after endpoint history');
  await page.getByTestId('chat-send').click();

  await expect.poll(() => chatBodies.length).toBe(1);
  expect(chatBodies[0]?.provider).toBe('codex');
  expect(chatBodies[0]?.model).toBe('gpt-5.2');
  expect(chatBodies[0]?.endpointId).toBe('https://alpha.example/base/v1');
  expect(chatBodies[0]?.conversationId).not.toBe('endpoint-history-conversation');
});
