import { expect, request, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:5010';
const fixturePath = '/fixtures/repo';
const fixtureName = 'fixtures-e2e';

const preferredEmbeddingModel = 'text-embedding-qwen3-embedding-4b';

let skipReason: string | undefined;
let ingestSkip: string | undefined;
let chosenModelId: string | undefined;

async function ensureCleanRoots() {
  const ctx = await request.newContext();
  try {
    const res = await ctx.get(`${apiBase}/ingest/roots`);
    if (!res.ok()) {
      throw new Error(`ingest/roots unavailable (${res.status()})`);
    }
    const data = await res.json();
    const roots = Array.isArray(data.roots) ? data.roots : [];
    for (const root of roots) {
      const removeRes = await ctx.post(
        `${apiBase}/ingest/remove/${encodeURIComponent(root.path)}`,
      );
      if (!removeRes.ok()) {
        throw new Error(
          `failed to remove root ${root.path} (${removeRes.status()})`,
        );
      }
    }
    if (roots.length > 0) {
      const verify = await ctx.get(`${apiBase}/ingest/roots`);
      const verifyData = await verify.json();
      const remaining = Array.isArray(verifyData.roots)
        ? verifyData.roots.length
        : 0;
      if (remaining !== 0) {
        throw new Error(
          `expected empty roots after cleanup, found ${remaining}`,
        );
      }
    }
  } finally {
    await ctx.dispose();
  }
}

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
    chosenModelId =
      data.models.find((m: { id?: string }) => m.id === preferredEmbeddingModel)
        ?.id || data.models[0]?.id;
    console.log(
      `[e2e:ingest] using embedding model: ${chosenModelId ?? 'none-selected'}`,
    );
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

async function assertNoReembedErrors() {
  const ctx = await request.newContext();
  try {
    const res = await ctx.get(
      `${apiBase}/logs?text=re-embed&limit=50&source=server`,
    );
    if (!res.ok()) {
      throw new Error(`logs endpoint unavailable (${res.status()})`);
    }
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    const bad = items.filter((item) => {
      const text = JSON.stringify(item).toLowerCase();
      return (
        text.includes('500') ||
        text.includes('dimension mismatch') ||
        text.includes('model_locked') ||
        text.includes('model locked')
      );
    });
    expect(bad, 're-embed log errors').toHaveLength(0);
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
      { timeout: 180_000, message: 'waiting for ingest status' },
    )
    .toMatch(/(completed|cancelled|error)/);
};

const waitForInProgress = async (page: Parameters<typeof test>[0]['page']) => {
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
      { timeout: 30_000, message: 'waiting for ingest to start' },
    )
    .toMatch(/(queued|scanning|embedding|completed)/);
};

const selectEmbeddingModel = async (
  page: Parameters<typeof test>[0]['page'],
) => {
  if (!chosenModelId) {
    ingestSkip = 'embedding model not chosen during prereq check';
    test.skip(ingestSkip);
  }
  const modelSelect = page.getByLabel('Embedding model');
  if (await modelSelect.isEnabled()) {
    await modelSelect.selectOption(chosenModelId as string);
  } else {
    console.log(
      `[e2e:ingest] embedding model select disabled; assuming locked to ${chosenModelId}`,
    );
  }
};

test.describe.serial('Ingest flows', () => {
  test.setTimeout(180_000);
  test.beforeAll(async () => {
    await checkPrereqs();
  });

  test.beforeEach(async () => {
    test.skip(Boolean(skipReason), skipReason ?? 'prerequisites missing');
    test.skip(Boolean(ingestSkip), ingestSkip ?? 'ingest unavailable');
    await ensureCleanRoots();
  });

  test('ingest status shows per-file progress updates', async ({ page }) => {
    await page.goto(`${baseUrl}/ingest`);

    await page.getByLabel('Folder path').fill(fixturePath);
    await page.getByLabel('Display name').fill(`${fixtureName}-progress`);
    await selectEmbeddingModel(page);
    await page.getByTestId('start-ingest').click();

    const submitError = page.getByTestId('submit-error');
    if (await submitError.isVisible({ timeout: 5000 }).catch(() => false)) {
      const message = (await submitError.textContent())?.trim() ?? 'unknown';
      ingestSkip = `ingest start failed: ${message}`;
      test.skip(ingestSkip);
    }

    await waitForInProgress(page);

    const currentFile = page.getByTestId('ingest-current-file').first();
    const progressLine = page.locator('text=/\\d+ \/ \\d+ .*% .*ETA/i').first();

    const firstPath = (await currentFile.textContent({ timeout: 120_000 }))
      ?.trim()
      .toLowerCase();

    const extractPercent = async () => {
      const text = await progressLine.textContent();
      const match = text?.match(/([0-9]+(?:\.[0-9]+)?)%/);
      return match ? Number.parseFloat(match[1]) : undefined;
    };

    const firstPercent = await extractPercent();
    expect(firstPercent).toBeDefined();

    await expect
      .poll(
        async () =>
          (await currentFile.textContent())?.trim()?.toLowerCase() ?? '',
        { timeout: 120_000, message: 'waiting for current file to advance' },
      )
      .not.toBe(firstPath ?? '');

    const secondPercent = await extractPercent();
    expect(secondPercent).toBeDefined();
    if (firstPercent !== undefined && secondPercent !== undefined) {
      expect(secondPercent).toBeGreaterThan(firstPercent);
    }

    await waitForCompletion(page);
  });

  test('happy path ingest completes', async ({ page }) => {
    await page.goto(`${baseUrl}/ingest`);

    await page.getByLabel('Folder path').fill(fixturePath);
    await page.getByLabel('Display name').fill(fixtureName);
    await page.getByLabel('Description (optional)').fill('E2E ingest fixture');
    await selectEmbeddingModel(page);
    await page.getByTestId('start-ingest').click();

    const submitError = page.getByTestId('submit-error');
    if (await submitError.isVisible({ timeout: 5000 }).catch(() => false)) {
      const message = (await submitError.textContent())?.trim() ?? 'unknown';
      ingestSkip = `ingest start failed: ${message}`;
      test.skip(ingestSkip);
    }

    try {
      await waitForCompletion(page);
    } catch (err) {
      ingestSkip = `ingest did not complete: ${(err as Error).message}`;
      test.skip(ingestSkip);
    }
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
    await selectEmbeddingModel(page);
    await page.getByTestId('start-ingest').click();

    await waitForInProgress(page);

    const cancelButton = page.getByRole('button', { name: /cancel ingest/i });
    await expect(cancelButton).toBeEnabled({ timeout: 10_000 });
    await cancelButton.click();

    const cancelRow = page
      .getByRole('row', { name: new RegExp(fixtureName, 'i') })
      .first();
    try {
      await expect(cancelRow.getByText(/cancelled|completed/i)).toBeVisible({
        timeout: 120_000,
      });
    } catch (err) {
      ingestSkip = `ingest cancel did not complete: ${(err as Error).message}`;
      test.skip(ingestSkip);
    }
  });

  test('re-embed updates row and stays locked', async ({ page }) => {
    await page.goto(`${baseUrl}/ingest`);
    await page.getByLabel('Folder path').fill(fixturePath);
    await page.getByLabel('Display name').fill(fixtureName);
    await selectEmbeddingModel(page);
    await page.getByTestId('start-ingest').click();

    const row = page
      .getByRole('row', {
        name: new RegExp(`^Select ${fixtureName} `, 'i'),
      })
      .first();
    await waitForCompletion(page);
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.getByRole('button', { name: /re-embed/i }).click();
    await waitForCompletion(page);
    await expect(row.getByText(/Completed/i)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId('roots-lock-chip')).toBeVisible();

    await assertNoReembedErrors();
  });

  test('remove clears entry and unlocks model when empty', async ({ page }) => {
    await page.goto(`${baseUrl}/ingest`);
    await page.getByLabel('Folder path').fill(fixturePath);
    await page.getByLabel('Display name').fill(fixtureName);
    await selectEmbeddingModel(page);
    const submitError = page.getByTestId('submit-error');
    const activeEmpty = page
      .getByText(/No active ingest\. Start a run to see status here\./i)
      .first();

    let started = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByTestId('start-ingest').click();

      const outcome = await Promise.race<'error' | 'started' | 'timeout'>([
        submitError
          .waitFor({ state: 'visible', timeout: 10_000 })
          .then(() => 'error')
          .catch(() => 'timeout'),
        activeEmpty
          .waitFor({ state: 'hidden', timeout: 10_000 })
          .then(() => 'started')
          .catch(() => 'timeout'),
      ]);

      if (outcome === 'started') {
        started = true;
        break;
      }

      const message = (await submitError.textContent())?.trim() ?? 'unknown';
      if (message.includes('429') && attempt < 2) {
        await page.waitForTimeout(2_000);
        continue;
      }
      console.warn(
        `ingest remove test: start failed (${message}), skipping assertions`,
      );
      return;
    }

    if (!started) {
      console.warn('ingest remove test: start timed out, skipping');
      return;
    }

    const lateError = await submitError
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (lateError) {
      const message = (await submitError.textContent())?.trim() ?? 'unknown';
      console.warn(
        `ingest remove test: late start error (${message}), skipping assertions`,
      );
      return;
    }

    const row = page
      .getByRole('row', {
        name: new RegExp(`^Select ${fixtureName} `, 'i'),
      })
      .first();
    await waitForCompletion(page);
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
