import type { LmStudioStatusResponse } from '@codeinfo2/common';
import { expect, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:5010';
const lmBaseUrl =
  process.env.LMSTUDIO_BASE_URL ?? 'http://host.docker.internal:1234';

test('LM Studio models render', async ({ page }) => {
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

  await page.goto(baseUrl);
  await page.getByRole('tab', { name: /LM Studio/i }).click();
  await page.getByLabel(/LM Studio base URL/i).fill(lmBaseUrl);
  await page.getByRole('button', { name: /Check status/i }).click();

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
