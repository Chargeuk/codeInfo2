import { test, expect } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';

test('shows client and server versions', async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.getByText(/Client version/i)).toBeVisible();
  await expect(page.getByText(/Server version/i)).toBeVisible();
});
