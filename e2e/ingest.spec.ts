import { expect, request, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:5010';
const fixturePath = '/fixtures/repo';
const fixtureName = 'fixtures-e2e';

let skipReason: string | undefined;

async function checkPrereqs() {
  const ctx = await request.newContext();
  try {
    const res = await ctx.get(`${apiBase}/ingest/models`);
    if (!res.ok()) {
      skipReason = `ingest/models unavailable (${res.status()})`;
      return;
    }
    const data = await res.json();
    if (!Array.isArray(data.models) || data.models.length === 0) {
      skipReason = 'no embedding models available';
      return;
    }
    // light ping for LM Studio proxy availability
    const lmStatus = await ctx.get(`${apiBase}/lmstudio/status`);
    if (!lmStatus.ok()) {
      skipReason = `LM Studio status unavailable (${lmStatus.status()})`;
    }
  } catch (err) {
    skipReason = `prereq check failed: ${(err as Error).message}`;
  } finally {
    await ctx.dispose();
  }
}

const waitForCompletion = async (page: Parameters<typeof test>[0]['page']) => {
  await expect(
    page.getByRole('heading', { name: /Active ingest/i }),
  ).toBeVisible();
  await expect
    .poll(
      async () => {
        const label = await page
          .locator('.MuiChip-label')
          .first()
          .textContent();
        return label?.toLowerCase() ?? '';
      },
      { timeout: 120_000, message: 'waiting for ingest status' },
    )
    .toMatch(/(completed|cancelled|error|scanning|embedding|queued)/);
};

test.describe.serial('Ingest flows', () => {
  test.beforeAll(async () => {
    await checkPrereqs();
  });

  test.beforeEach(() => {
    test.skip(Boolean(skipReason), skipReason ?? 'prerequisites missing');
  });

  test('happy path ingest completes', async ({ page }) => {
    await page.goto(`${baseUrl}/ingest`);

    await page.getByLabel('Folder path').fill(fixturePath);
    await page.getByLabel('Display name').fill(fixtureName);
    await page.getByLabel('Description (optional)').fill('E2E ingest fixture');
    const modelSelect = page.getByLabel('Embedding model');
    if (await modelSelect.isEnabled()) {
      await modelSelect.selectOption({ index: 0 });
    }
    await page.getByTestId('start-ingest').click();

    await waitForCompletion(page);
    await expect(page.getByText(/Completed/i).first()).toBeVisible({
      timeout: 120_000,
    });
    await expect(
      page.getByRole('row', { name: new RegExp(fixtureName, 'i') }),
    ).toBeVisible({
      timeout: 30_000,
    });
  });

  test('cancel in-progress ingest shows cancelled', async ({ page }) => {
    await page.goto(`${baseUrl}/ingest`);

    await page.getByLabel('Folder path').fill(`${fixturePath}`);
    await page.getByLabel('Display name').fill(`${fixtureName}-cancel`);
    await page.getByTestId('start-ingest').click();

    const cancelButton = page.getByRole('button', { name: /cancel ingest/i });
    await expect(cancelButton).toBeEnabled({ timeout: 10_000 });
    await cancelButton.click();

    await expect(page.getByText(/cancelled/i)).toBeVisible({ timeout: 60_000 });
  });

  test('re-embed updates row and stays locked', async ({ page }) => {
    await page.goto(`${baseUrl}/ingest`);
    const row = page.getByRole('row', {
      name: new RegExp(`^Select ${fixtureName} `, 'i'),
    });
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.getByRole('button', { name: /re-embed/i }).click();
    await waitForCompletion(page);
    await expect(row.getByText(/Completed/i)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId('roots-lock-chip')).toBeVisible();
  });

  test('remove clears entry and unlocks model when empty', async ({ page }) => {
    await page.goto(`${baseUrl}/ingest`);
    const row = page.getByRole('row', {
      name: new RegExp(`^Select ${fixtureName} `, 'i'),
    });
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.getByRole('button', { name: /^Remove$/i }).click();
    await expect(page.getByText(/Removed/i).first()).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByText(/No embedded folders yet/i)).toBeVisible({
      timeout: 30_000,
    });
  });
});
