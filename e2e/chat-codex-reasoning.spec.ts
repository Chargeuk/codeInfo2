import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';

test('renders Codex thought process when analysis frames stream', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const encoder = new TextEncoder();

    const streamEvents = [
      {
        delay: 0,
        chunk: 'data: {"type":"analysis","content":"Codex thinking."}\n\n',
      },
      {
        delay: 300,
        chunk:
          'data: {"type":"token","content":"<|channel|>analysis<|message|>Codex thinking."}\n\n',
      },
      {
        delay: 800,
        chunk: 'data: {"type":"token","content":"Final"}\n\n',
      },
      {
        delay: 1400,
        chunk:
          'data: {"type":"final","message":{"role":"assistant","content":"Final"}}\n\n',
      },
      { delay: 1500, chunk: 'data: {"type":"complete"}\n\n' },
    ];

    const originalFetch = window.fetch.bind(window);

    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/chat/providers')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
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
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );
      }

      if (url.includes('/chat/models')) {
        const provider = new URL(url, 'http://localhost').searchParams.get(
          'provider',
        );
        if (provider === 'codex') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
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
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          );
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({
              provider: 'lmstudio',
              available: true,
              toolsAvailable: true,
              models: [
                {
                  key: 'mock-chat',
                  displayName: 'Mock Chat Model',
                  type: 'gguf',
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );
      }

      if (
        url.includes('/chat') &&
        !url.includes('/chat/models') &&
        !url.includes('/chat/providers')
      ) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            streamEvents.forEach(({ chunk, delay }) =>
              setTimeout(
                () => controller.enqueue(encoder.encode(chunk)),
                delay,
              ),
            );
            const lastDelay = Math.max(...streamEvents.map((evt) => evt.delay));
            setTimeout(() => controller.close(), lastDelay + 50);
          },
        });

        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        );
      }

      return originalFetch(input, init);
    };
  });

  await page.goto(`${baseUrl}/chat`);

  await page.getByLabel('Provider').click();
  await page.getByText('OpenAI Codex').click();

  await page.getByLabel('Model').click();
  await page.getByRole('option', { name: 'gpt-5.1-codex-max' }).click();

  const input = page.getByTestId('chat-input');
  await input.fill('Show reasoning');
  await expect(page.getByTestId('chat-send')).toBeEnabled({ timeout: 10000 });
  await page.getByTestId('chat-send').click();

  await expect(page.getByTestId('think-toggle')).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId('status-chip')).toHaveText(/Complete/i, {
    timeout: 20000,
  });

  await page.getByTestId('think-toggle').click();
  await expect(page.getByTestId('think-content')).toContainText(
    'Codex thinking.',
  );
  await expect(page.getByTestId('think-spinner')).toBeHidden({
    timeout: 20000,
  });

  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({
    path: 'test-results/screenshots/0000010-08-chat-codex-reasoning.png',
    fullPage: true,
  });
});
