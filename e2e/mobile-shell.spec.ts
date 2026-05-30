import { test, expect } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001';

test('mobile utility shell uses the shared compact top bar', async ({ page }) => {
  try {
    const ping = await page.request.get(baseUrl);
    if (!ping.ok()) {
      test.skip(`Client not reachable (${ping.status()})`);
    }
  } catch {
    test.skip('Client not reachable (request failed)');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/logs`);

  await expect(page.getByTestId('utility-page-shell')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open conversations' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: /^Conversations$/i })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: /^Menu$/i })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByTestId('workspace-mobile-app-menu-overlay')).toBeVisible(
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(
    page.getByTestId('workspace-mobile-app-menu-overlay'),
  ).toBeHidden({ timeout: 20000 });
});

test('mobile workspace shell uses the shared compact top bar', async ({
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl);

  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByTestId('workspace-mobile-app-menu-overlay')).toBeVisible(
    { timeout: 20000 },
  );
  await page
    .getByTestId('workspace-mobile-app-menu-overlay')
    .getByRole('link', { name: 'Chat' })
    .click();

  await expect(page).toHaveURL(/\/chat$/);
  const drawerToggle = page.getByTestId('conversation-drawer-toggle');
  await expect(drawerToggle).toBeVisible();
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();

  await drawerToggle.click();
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('workspace-mobile-conversations-overlay')).toBeVisible(
    { timeout: 20000 },
  );

  await page.getByLabel('Close conversations').click();
  await expect(
    page.getByTestId('workspace-mobile-conversations-overlay'),
  ).toBeHidden({ timeout: 20000 });

  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByTestId('workspace-mobile-app-menu-overlay')).toBeVisible(
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(
    page.getByTestId('workspace-mobile-app-menu-overlay'),
  ).toBeHidden({ timeout: 20000 });
});
