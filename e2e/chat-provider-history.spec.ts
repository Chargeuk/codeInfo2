import { expect, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:5010';

const hideMcpOverlay = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() => {
    const sidebar = document.getElementById('mcp-sidebar');
    if (sidebar) sidebar.style.display = 'none';
    const frame = document.querySelector('iframe[name="toolbox-frame"]');
    if (frame) (frame as HTMLElement).style.display = 'none';
  });
};

test('historical conversation uses its provider and shows turns', async ({
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
  const modelsRequest = page.waitForRequest(
    (req) =>
      req.method() === 'GET' &&
      req.url().includes('/chat/models') &&
      req.url().includes('provider=codex'),
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
  await modelsRequest;
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __chatDebug?: unknown }).__chatDebug),
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
