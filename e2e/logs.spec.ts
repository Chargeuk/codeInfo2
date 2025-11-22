import { test, expect } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';

test('Logs page shows a streamed sample log', async ({ page }) => {
  try {
    const ping = await page.request.get(baseUrl);
    if (!ping.ok()) {
      test.skip(`Client not reachable (${ping.status()})`);
    }
  } catch {
    test.skip('Client not reachable (request failed)');
  }

  await page.goto(`${baseUrl}/logs`);
  await page.getByRole('button', { name: 'Send sample log' }).click();
  await page.getByRole('button', { name: 'Refresh now' }).click();

  const table = page.getByRole('table', { name: 'Logs table' });
  await expect(table.getByText('sample log').first()).toBeVisible({
    timeout: 15000,
  });
  await expect(table.getByText(/info/i).first()).toBeVisible();
});
