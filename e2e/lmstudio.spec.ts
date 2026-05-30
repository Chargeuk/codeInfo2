import type { LmStudioStatusResponse } from '@codeinfo2/common';
import { expect, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001';
const apiBase = process.env.E2E_API_URL ?? 'http://host.docker.internal:6010';
const lmBaseUrl =
  process.env.CODEINFO_LMSTUDIO_BASE_URL ?? 'http://host.docker.internal:1234';

test('LM Studio compatibility route lands on Home with the LM Studio section visible', async ({
  page,
}) => {
  let statusJson: LmStudioStatusResponse;
  try {
    const statusRes = await page.request.get(
      `${apiBase}/lmstudio/status?baseUrl=${encodeURIComponent(lmBaseUrl)}`,
    );
    if (!statusRes.ok()) {
      test.skip(`LM Studio not reachable (${statusRes.status()})`);
    }
    statusJson = (await statusRes.json()) as LmStudioStatusResponse;
  } catch {
    test.skip('LM Studio not reachable (request failed)');
  }
  if (statusJson.status !== 'ok') {
    test.skip(`LM Studio returned error: ${statusJson.error ?? 'unknown'}`);
  }
  const hasModels =
    statusJson.status === 'ok' &&
    Array.isArray(statusJson.models) &&
    statusJson.models.length > 0;

  await page.goto(`${baseUrl}/lmstudio`);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.getByTestId('utility-page-shell')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'LM Studio' })).toBeVisible();
  await page.getByLabel(/Base URL/i).fill(lmBaseUrl);
  await page.getByRole('button', { name: /^Check$/i }).click();

  if (hasModels) {
    await expect(
      page.getByText(statusJson.models[0].displayName, { exact: false }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByText(/No models reported by LM Studio/i),
    ).toBeVisible();
  }
});

test('mobile app-menu navigation returns focus before the drawer unmounts', async ({
  page,
}) => {
  const browserWarnings: string[] = [];
  const focusWarningText =
    'Blocked aria-hidden on an element because its descendant retained focus';
  page.on('console', (msg) => {
    if (msg.type() === 'warning' || msg.type() === 'error') {
      browserWarnings.push(msg.text());
    }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  await page.getByRole('button', { name: /open menu/i }).click();
  await expect(page.getByTestId('workspace-mobile-app-menu-overlay')).toBeVisible();

  await page
    .getByTestId('workspace-mobile-app-menu-overlay')
    .getByText('Chat', { exact: true })
    .click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(
    page.getByTestId('workspace-mobile-app-menu-overlay'),
  ).toBeHidden();
  await expect(page.getByTestId('conversation-drawer-toggle')).toBeVisible();

  expect(
    browserWarnings.some((text) => text.includes(focusWarningText)),
  ).toBe(false);
});
