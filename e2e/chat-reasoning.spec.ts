import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const codexReason = 'Missing auth.json in ./codex and config.toml in ./codex';

test('collapses reasoning while streaming Harmony channels', async ({
  page,
}) => {
  await page.addInitScript(
    ({ codexReason: injectedCodexReason }) => {
      const encoder = new TextEncoder();
      const streamEvents = [
        {
          delay: 0,
          chunk:
            'data: {"type":"token","content":"<|channel|>analysis<|message|>Need answer: Neil Armstrong."}\n\n',
        },
        {
          delay: 1200,
          chunk: 'data: {"type":"token","content":" Continue analysis."}\n\n',
        },
        {
          delay: 2200,
          chunk:
            'data: {"type":"final","message":{"role":"assistant","content":"<|channel|>analysis<|message|>Need answer: Neil Armstrong.<|end|><|start|>assistant<|channel|>final<|message|>He was the first person on the Moon."}}\n\n',
        },
        { delay: 2300, chunk: 'data: {"type":"complete"}\n\n' },
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
                    available: false,
                    toolsAvailable: false,
                    reason: injectedCodexReason,
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
          return Promise.resolve(
            new Response(
              JSON.stringify({
                provider: 'lmstudio',
                available: true,
                toolsAvailable: true,
                models: [{ key: 'mock-chat', displayName: 'Mock Chat Model' }],
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          );
        }

        if (url.endsWith('/chat')) {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              streamEvents.forEach(({ chunk, delay }) =>
                setTimeout(
                  () => controller.enqueue(encoder.encode(chunk)),
                  delay,
                ),
              );
              const lastDelay = Math.max(
                ...streamEvents.map((evt) => evt.delay),
              );
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
    },
    { codexReason },
  );

  await page.goto(`${baseUrl}/chat`);

  const input = page.getByTestId('chat-input');
  const send = page.getByTestId('chat-send');

  await input.fill('Who was the first person on the Moon?');
  await send.click();

  await expect(page.getByTestId('think-toggle')).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByText('He was the first person on the Moon.'),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('think-spinner')).not.toBeVisible({
    timeout: 20000,
  });

  await page.getByTestId('think-toggle').click();
  await expect(page.getByTestId('think-content')).toContainText(
    'Need answer: Neil Armstrong.',
  );

  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({
    path: 'test-results/screenshots/0000007-3-chat-reasoning.png',
    fullPage: true,
  });
});
