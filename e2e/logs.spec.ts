import { test, expect } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001';
const apiBase = process.env.E2E_API_URL ?? 'http://host.docker.internal:6010';

test('Logs page shows a streamed sample log through the utility shell', async ({
  page,
}) => {
  try {
    const ping = await page.request.get(baseUrl);
    if (!ping.ok()) {
      test.skip(`Client not reachable (${ping.status()})`);
    }
  } catch {
    test.skip('Client not reachable (request failed)');
  }

  await page.goto(`${baseUrl}/logs`);
  await expect(page.getByTestId('utility-page-shell')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search text' }).fill('sample log');
  const postResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/logs') &&
      response.status() === 202,
  );
  await page.getByRole('button', { name: 'Send sample log' }).click();
  const postResponse = await postResponsePromise;
  const postBody = (await postResponse.json()) as { sequence?: number };
  expect(postBody.sequence).toEqual(expect.any(Number));
  const newLogSequence = postBody.sequence as number;

  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${apiBase}/logs?text=${encodeURIComponent('sample log')}&source=client&sinceSequence=${newLogSequence - 1}`,
        );
        if (!response.ok()) {
          return false;
        }
        const body = (await response.json()) as {
          items?: Array<{ message?: string; sequence?: number }>;
        };
        return (
          body.items?.some(
            (entry) =>
              entry.message === 'sample log' &&
              entry.sequence === newLogSequence,
          ) ?? false
        );
      },
      {
        timeout: 20_000,
        message: 'waiting for this test run sample log to reach the logs API',
      },
    )
    .toBe(true);

  const table = page.getByRole('table', { name: 'Logs table' });
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await expect(table.getByText('sample log').first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(table.getByText(/info/i).first()).toBeVisible();
});
