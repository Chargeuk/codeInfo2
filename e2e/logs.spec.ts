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
    (response) => {
      if (
        response.request().method() !== 'POST' ||
        !response.url().includes('/logs') ||
        response.status() !== 202
      ) {
        return false;
      }

      const requestBody = response.request().postDataJSON() as
        | {
            message?: string;
            source?: string;
            context?: { generatedAt?: string };
          }
        | Array<unknown>;

      return (
        !Array.isArray(requestBody) &&
        requestBody.message === 'sample log' &&
        requestBody.source === 'client' &&
        typeof requestBody.context?.generatedAt === 'string'
      );
    },
  );
  await page.getByRole('button', { name: 'Send sample log' }).click();
  const postResponse = await postResponsePromise;
  const postBody = (await postResponse.json()) as { sequence?: number };
  const postRequestBody = postResponse.request().postDataJSON() as {
    message?: string;
    source?: string;
    context?: { generatedAt?: string };
  };
  expect(postBody.sequence).toEqual(expect.any(Number));
  const newLogSequence = postBody.sequence as number;
  expect(postRequestBody.message).toBe('sample log');
  expect(postRequestBody.source).toBe('client');
  const generatedAt = postRequestBody.context?.generatedAt;
  expect(generatedAt).toEqual(expect.any(String));
  if (typeof generatedAt !== 'string') {
    throw new Error('expected sample log request to include generatedAt');
  }

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
  const sampleLogRow = table
    .locator('tbody tr')
    .filter({ hasText: 'sample log' })
    .filter({ hasText: `"generatedAt":"${generatedAt}"` });
  await expect(sampleLogRow.first()).toBeVisible({
    timeout: 20_000,
  });
});
