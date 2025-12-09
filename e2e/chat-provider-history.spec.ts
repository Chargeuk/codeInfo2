import { expect, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:5010';

const skipIfUnreachable = async (url: string) => {
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) {
    test.skip(`Client not reachable (${res?.status ?? 'request failed'})`);
  }
};

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
  await skipIfUnreachable(baseUrl);

  // Check providers and require Codex availability for this scenario.
  const providersRes = await fetch(`${apiBase}/chat/providers`).catch(
    () => null,
  );
  if (!providersRes || !providersRes.ok) {
    test.skip('Providers endpoint unavailable');
  }
  const providersData = await providersRes!.json();
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
    id: string,
    provider: 'codex' | 'lmstudio',
    model: string,
    title: string,
    reply: string,
  ) => {
    await fetch(`${apiBase}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, model, title, conversationId: id }),
    });
    await fetch(`${apiBase}/conversations/${id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: `hello ${provider}`,
        model,
        provider,
        status: 'ok',
      }),
    });
    await fetch(`${apiBase}/conversations/${id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'assistant',
        content: reply,
        model,
        provider,
        status: 'ok',
      }),
    });
  };

  await seedConversation(
    'conv-codex-provider',
    'codex',
    'gpt-5.1-codex-max',
    'Codex history',
    'codex reply',
  );
  await seedConversation(
    'conv-lm-provider',
    'lmstudio',
    'lm',
    'LM history',
    'lm reply',
  );

  await page.goto(`${baseUrl}/chat`);
  await hideMcpOverlay(page);
  await page.waitForTimeout(500);

  // Click the Codex conversation.
  await page.getByText('Codex history').click();

  // Expect provider dropdown to switch to Codex (currently failing).
  await expect(page.getByTestId('provider-select')).toContainText(
    /OpenAI Codex/i,
  );

  // Transcript should show codex reply.
  const transcript = page.getByTestId('chat-transcript');
  await expect(transcript).toContainText('codex reply');
});
