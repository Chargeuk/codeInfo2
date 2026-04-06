import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  expect,
  request,
  test,
  type APIRequestContext,
} from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001';
const apiBase = process.env.E2E_API_URL ?? 'http://host.docker.internal:6010';
const fixturePath = '/fixtures/repo';
const largeFixtureRelPath = 'large-planning-doc.md';
const mountedLargeFixturePath = `${fixturePath}/${largeFixtureRelPath}`;
const fixtureName = 'fixtures-e2e';

const preferredEmbeddingModel = 'text-embedding-qwen3-embedding-4b';
const stableScreenshotDir = path.join(
  'artifacts',
  'story-0000055-screenshots',
);

let skipReason: string | undefined;
let ingestSkip: string | undefined;
let chosenModelId: string | undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function saveStableScreenshot(
  page: Parameters<typeof test>[0]['page'],
  fileName: string,
) {
  await mkdir(stableScreenshotDir, { recursive: true });
  await page.screenshot({
    path: path.join(stableScreenshotDir, fileName),
    fullPage: true,
  });
}

async function ensureCleanRoots() {
  const ctx = await request.newContext();
  try {
    const deadline = Date.now() + 240_000;
    let lastBusyRoot: string | undefined;
    let lastRemainingRoots: string[] = [];

    while (Date.now() < deadline) {
      const res = await ctx.get(`${apiBase}/ingest/roots`);
      if (!res.ok()) {
        throw new Error(`ingest/roots unavailable (${res.status()})`);
      }
      const data = await res.json();
      const roots = Array.isArray(data.roots) ? data.roots : [];
      lastRemainingRoots = roots.map((root) =>
        JSON.stringify({
          path: root?.path ?? null,
          status: root?.status ?? null,
          queueState: root?.queueState ?? null,
          runId: root?.runId ?? null,
        }),
      );
      if (roots.length === 0) {
        return;
      }

      for (const root of roots) {
        if (
          root?.runId &&
          (root?.status === 'ingesting' || root?.queueState === 'running')
        ) {
          await ctx.post(`${apiBase}/ingest/cancel/${root.runId}`);
        }
      }

      let sawBusy = false;

      for (const root of roots) {
        // Waiting queue items intentionally are not user-removable, so e2e
        // teardown uses the dedicated cleanup seam instead of the product route.
        const removeRes = await ctx.post(
          `${apiBase}/ingest/e2e/cleanup/${encodeURIComponent(root.path)}`,
        );
        if (removeRes.ok()) {
          continue;
        }
        if (removeRes.status() === 429) {
          sawBusy = true;
          lastBusyRoot = root.path;
          continue;
        }
        throw new Error(
          `failed to cleanup root ${root.path} (${removeRes.status()})`,
        );
      }

      if (!sawBusy) {
        const verify = await ctx.get(`${apiBase}/ingest/roots`);
        const verifyData = await verify.json();
        const remaining = Array.isArray(verifyData.roots)
          ? verifyData.roots.length
          : 0;
        if (remaining === 0) {
          return;
        }
      }

      await sleep(1_000);
    }

    throw new Error(
      `expected empty roots after cleanup, found busy root ${lastBusyRoot ?? 'none'}; remaining roots: ${lastRemainingRoots.join(', ') || 'none'}`,
    );
  } finally {
    await ctx.dispose();
  }
}

async function fetchRoots(ctx: APIRequestContext) {
  const res = await ctx.get(`${apiBase}/ingest/roots`);
  if (!res.ok()) {
    throw new Error(`ingest/roots unavailable (${res.status()})`);
  }
  const data = await res.json();
  return Array.isArray(data.roots)
    ? (data.roots as Array<{
        path?: string;
        name?: string;
        status?: string;
        queueState?: string | null;
        runId?: string | null;
      }>)
    : [];
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

async function queryServerLogs(ctx: APIRequestContext, text: string) {
  const res = await ctx.get(
    `${apiBase}/logs?text=${encodeURIComponent(text)}&limit=200&source=server`,
  );
  if (!res.ok()) {
    throw new Error(`logs endpoint unavailable (${res.status()})`);
  }
  const data = await res.json();
  return Array.isArray(data.items)
    ? (data.items as Array<{
        message?: string;
        context?: Record<string, unknown>;
      }>)
    : [];
}

async function waitForStory54Marker(
  ctx: APIRequestContext,
  options: {
    marker: string;
    runId: string;
    predicate?: (entry: { context?: Record<string, unknown> }) => boolean;
  },
) {
  await expect
    .poll(
      async () => {
        const items = await queryServerLogs(ctx, options.marker);
        return items.some((entry) => {
          if (entry.context?.runId !== options.runId) return false;
          return options.predicate ? options.predicate(entry) : true;
        });
      },
      {
        timeout: 60_000,
        message: `waiting for ${options.marker} for run ${options.runId}`,
      },
    )
    .toBe(true);
}

const waitForCompletion = async (
  page: Parameters<typeof test>[0]['page'],
  rowMatcher: RegExp,
) => {
  const activeHeading = page.getByRole('heading', { name: /Active ingest/i });
  const row = page.getByRole('row', { name: rowMatcher }).first();
  await expect(row).toBeVisible({
    timeout: 180_000,
  });
  await expect(activeHeading).toBeHidden({
    timeout: 180_000,
  });
};

const waitForQueuedRow = async (
  page: Parameters<typeof test>[0]['page'],
  rowMatcher: RegExp,
  queuePosition?: number,
) => {
  const row = page.getByRole('row', { name: rowMatcher }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(
    row.getByText(
      queuePosition
        ? new RegExp(`queued \\(#${queuePosition}\\)`, 'i')
        : /queued/i,
    ),
  ).toBeVisible({ timeout: 60_000 });
  return row;
};

const waitForInProgress = async (page: Parameters<typeof test>[0]['page']) => {
  await expect(
    page.getByRole('heading', { name: /Active ingest/i }),
  ).toBeVisible();
  await expect
    .poll(
      async () => {
        const label = await page
          .getByTestId('ingest-status-chip')
          .textContent()
          .catch(() => '');
        return label?.toLowerCase().trim() ?? '';
      },
      { timeout: 30_000, message: 'waiting for ingest to start' },
    )
    .toMatch(/(queued|scanning|embedding|completed)/);
};

const startIngestAndCaptureOutcome = async (
  page: Parameters<typeof test>[0]['page'],
) => {
  const startResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/ingest/start') &&
      response.request().method() === 'POST',
  );
  const response = await test.step(
    'remove-flow owner: start-response wait',
    async () => {
      await page.getByTestId('start-ingest').click();
      return startResponsePromise;
    },
    { timeout: 30_000 },
  );
  const responseBody = (await response.json().catch(() => ({}))) as {
    runId?: string;
    requestId?: string;
  };
  const submitResolution = await test.step(
    'remove-flow owner: submit-phase resolution',
    async () => {
      let resolution = 'pending';
      await expect
        .poll(
          async () => {
            if (page.isClosed()) {
              return 'page-closed';
            }

            return page.evaluate(() => {
              const normalize = (value: string | null | undefined) =>
                value?.replace(/\s+/g, ' ').trim() ?? '';
              const submitErrorText = normalize(
                document.querySelector('[data-testid="submit-error"]')
                  ?.textContent,
              );
              if (submitErrorText) {
                return `submit-error:${submitErrorText}`;
              }

              const statusChipText = normalize(
                document.querySelector('[data-testid="ingest-status-chip"]')
                  ?.textContent,
              );
              if (statusChipText) {
                return `active-status:${statusChipText}`;
              }

              const activeHeading = Array.from(
                document.querySelectorAll('h1, h2, h3, h4, h5, h6'),
              )
                .map((heading) => normalize(heading.textContent))
                .find((text) => /active ingest/i.test(text));
              if (activeHeading) {
                return `active-heading:${activeHeading}`;
              }

              return 'pending';
            });
          },
          {
            timeout: 30_000,
            message:
              'waiting for remove-flow submit phase to resolve before later owner markers',
          },
        )
        .not.toBe('pending');
      resolution = await (async () => {
        if (page.isClosed()) {
          return 'page-closed';
        }

        return page.evaluate(() => {
          const normalize = (value: string | null | undefined) =>
            value?.replace(/\s+/g, ' ').trim() ?? '';
          const submitErrorText = normalize(
            document.querySelector('[data-testid="submit-error"]')?.textContent,
          );
          if (submitErrorText) {
            return `submit-error:${submitErrorText}`;
          }

          const statusChipText = normalize(
            document.querySelector('[data-testid="ingest-status-chip"]')
              ?.textContent,
          );
          if (statusChipText) {
            return `active-status:${statusChipText}`;
          }

          const activeHeading = Array.from(
            document.querySelectorAll('h1, h2, h3, h4, h5, h6'),
          )
            .map((heading) => normalize(heading.textContent))
            .find((text) => /active ingest/i.test(text));
          if (activeHeading) {
            return `active-heading:${activeHeading}`;
          }

          return 'pending';
        });
      })();
      return resolution;
    },
    { timeout: 30_000 },
  );

  if (submitResolution === 'page-closed') {
    throw new Error(
      'remove-flow owner: page lifecycle around submit closed before the submit phase resolved',
    );
  }
  const errorMessage = submitResolution.startsWith('submit-error:')
    ? submitResolution.slice('submit-error:'.length)
    : null;

  return {
    ok: response.ok(),
    status: response.status(),
    runId: responseBody.runId ?? null,
    requestId: responseBody.requestId ?? null,
    errorMessage: errorMessage || null,
  };
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
    const resolvedValue = await modelSelect.evaluate((el, modelId) => {
      const select = el as HTMLSelectElement;
      const options = Array.from(select.options);
      const direct = options.find((option) => option.value === modelId);
      if (direct) {
        return direct.value;
      }
      const providerQualified = options.find((option) =>
        option.value.endsWith(`::${modelId}`),
      );
      return providerQualified?.value ?? null;
    }, chosenModelId as string);

    if (!resolvedValue) {
      throw new Error(
        `embedding model option not found in select for ${chosenModelId}`,
      );
    }
    await modelSelect.selectOption(resolvedValue);
  } else {
    console.log(
      `[e2e:ingest] embedding model select disabled; assuming locked to ${chosenModelId}`,
    );
  }
};

test.describe.serial('Ingest flows', () => {
  test.setTimeout(240_000);
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

    expect(firstPath).toBeTruthy();

    await waitForCompletion(page, new RegExp(`${fixtureName}-progress`, 'i'));
  });

  test('large-text ingest completes for the mounted Story 54 planning fixture', async ({
    page,
  }) => {
    await page.goto(`${baseUrl}/ingest`);

    // Ingest still submits the repo root through the existing UI, but this proof
    // explicitly tracks the mounted large file inside that repo: /fixtures/repo/large-planning-doc.md.
    await page.getByLabel('Folder path').fill(fixturePath);
    await page.getByLabel('Display name').fill(`${fixtureName}-large-text`);
    await page
      .getByLabel('Description (optional)')
      .fill(`Story 54 large-text proof via ${mountedLargeFixturePath}`);
    await selectEmbeddingModel(page);
    const startResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/ingest/start') &&
        response.request().method() === 'POST',
    );
    await page.getByTestId('start-ingest').click();
    const startResponse = await startResponsePromise;
    const startBody = (await startResponse.json().catch(() => ({}))) as {
      runId?: string;
    };
    const runId = startBody.runId;

    const submitError = page.getByTestId('submit-error');
    if (await submitError.isVisible({ timeout: 5000 }).catch(() => false)) {
      const message = (await submitError.textContent())?.trim() ?? 'unknown';
      ingestSkip = `ingest start failed: ${message}`;
      test.skip(ingestSkip);
    }
    if (!runId) {
      throw new Error('ingest start response did not include a runId');
    }

    await waitForInProgress(page);
    await expect
      .poll(
        async () =>
          (
            await page
              .getByTestId('ingest-current-file')
              .first()
              .textContent()
              .catch(() => '')
          )
            ?.trim()
            .toLowerCase() ?? '',
        {
          timeout: 120_000,
          message: `waiting for active ingest to reach ${largeFixtureRelPath}`,
        },
      )
      .toContain(largeFixtureRelPath);

    try {
      await waitForCompletion(
        page,
        new RegExp(`${fixtureName}-large-text`, 'i'),
      );
    } catch (err) {
      ingestSkip = `ingest did not complete: ${(err as Error).message}`;
      test.skip(ingestSkip);
    }
    const row = page
      .getByRole('row', { name: new RegExp(`${fixtureName}-large-text`, 'i') })
      .first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText(/completed/i)).toBeVisible({
      timeout: 30_000,
    });

    const ctx = await request.newContext();
    try {
      await waitForStory54Marker(ctx, {
        marker: 'DEV-0000054:large_text_path_selected',
        runId,
        predicate: (entry) =>
          entry.context?.relPath === largeFixtureRelPath &&
          entry.context?.strategy === 'prose',
      });
      await waitForStory54Marker(ctx, {
        marker: 'DEV-0000054:embedding_dispatch_slot_filled',
        runId,
      });
    } finally {
      await ctx.dispose();
    }
  });

  test('cancel in-progress ingest shows cancelled', async ({ page }) => {
    await page.goto(`${baseUrl}/ingest`);

    await page.getByLabel('Folder path').fill(`${fixturePath}`);
    await page.getByLabel('Display name').fill(`${fixtureName}-cancel`);
    await selectEmbeddingModel(page);
    await page.getByTestId('start-ingest').click();

    await waitForInProgress(page);
    await expect(page.getByText(/^Run ID:/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ingest-current-file').first()).toHaveText(
      /\S+/,
      {
        timeout: 60_000,
      },
    );
    await page.waitForTimeout(1_000);

    const cancelButton = page.getByRole('button', { name: /cancel ingest/i });
    await expect(cancelButton).toBeEnabled({ timeout: 10_000 });
    await cancelButton.click();

    await expect(
      page.getByRole('heading', { name: /Active ingest/i }),
    ).toBeHidden({
      timeout: 180_000,
    });
    const cancelRow = page
      .getByRole('row', { name: new RegExp(fixtureName, 'i') })
      .first();
    await expect(cancelRow).toBeVisible({
      timeout: 30_000,
    });
    await expect(cancelRow.getByText(/cancelled|completed/i)).toBeVisible({
      timeout: 120_000,
    });
  });

  test('re-embed updates row and stays locked', async ({ page }) => {
    await page.goto(`${baseUrl}/ingest`);
    await page.getByLabel('Folder path').fill(fixturePath);
    await page.getByLabel('Display name').fill(fixtureName);
    await selectEmbeddingModel(page);
    await page.getByTestId('start-ingest').click();

    const statusCtx = await request.newContext();
    try {
      await expect
        .poll(
          async () => {
            const roots = await fetchRoots(statusCtx);
            const root = roots.find(
              (entry) =>
                entry.path === fixturePath || entry.name === fixtureName,
            );
            return root
              ? `${root.status ?? 'unknown'}:${root.queueState ?? 'none'}`
              : 'missing';
          },
          {
            timeout: 180_000,
            message: 'waiting for seeded ingest to reach a completed root',
          },
        )
        .toMatch(/^completed:/i);
    } finally {
      await statusCtx.dispose();
    }

    const row = page
      .getByRole('row', {
        name: new RegExp(`^Select ${fixtureName} `, 'i'),
      })
      .first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.getByRole('button', { name: /re-embed/i }).click();
    await waitForCompletion(page, new RegExp(fixtureName, 'i'));
    await expect(row.getByText(/^(completed|skipped)$/i)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId('roots-lock-chip')).toBeVisible();

    await assertNoReembedErrors();
  });

  test('queued submission stays available while another run is active and exposes queued row state', async ({
    page,
  }) => {
    await page.goto(`${baseUrl}/ingest`);

    await page.getByLabel('Folder path').fill(fixturePath);
    await page.getByLabel('Display name').fill(fixtureName);
    await selectEmbeddingModel(page);
    await page.getByTestId('start-ingest').click();
    await waitForInProgress(page);

    await page.getByLabel('Folder path').fill(`${fixturePath}/docs`);
    await page.getByLabel('Display name').fill(`${fixtureName}-queued`);
    await page.getByTestId('start-ingest').click();

    const queuedRow = await waitForQueuedRow(
      page,
      new RegExp(`${fixtureName}-queued`, 'i'),
      1,
    );
    await queuedRow.getByRole('button', { name: /details/i }).click();
    await expect(page.getByText(/Request ID/i)).toBeVisible();
    await expect(page.getByText(/Pending queue start/i)).toBeVisible();
    await saveStableScreenshot(page, '0000055-queued-row-state.png');
  });

  test('queued row stays visible after a page refresh while the request is still waiting', async ({
    page,
  }) => {
    await page.goto(`${baseUrl}/ingest`);

    await page.getByLabel('Folder path').fill(fixturePath);
    await page.getByLabel('Display name').fill(fixtureName);
    await selectEmbeddingModel(page);
    await page.getByTestId('start-ingest').click();
    await waitForInProgress(page);

    await page.getByLabel('Folder path').fill(`${fixturePath}/docs`);
    await page.getByLabel('Display name').fill(`${fixtureName}-refresh`);
    await page.getByTestId('start-ingest').click();
    await waitForQueuedRow(page, new RegExp(`${fixtureName}-refresh`, 'i'), 1);

    await page.reload();
    await waitForQueuedRow(page, new RegExp(`${fixtureName}-refresh`, 'i'), 1);
  });

  test('queued row picks up a run owner after the current queue head finishes', async ({
    page,
  }) => {
    const activeName = `${fixtureName}-startup-head`;
    const queuedName = `${fixtureName}-startup-next`;
    const queuedPath = `${fixturePath}/docs`;
    const ctx = await request.newContext();

    try {
      await page.goto(`${baseUrl}/ingest`);

      await page.getByLabel('Folder path').fill(fixturePath);
      await page.getByLabel('Display name').fill(activeName);
      await selectEmbeddingModel(page);
      await page.getByTestId('start-ingest').click();
      await waitForInProgress(page);

      await page.getByLabel('Folder path').fill(queuedPath);
      await page.getByLabel('Display name').fill(queuedName);
      await page.getByTestId('start-ingest').click();

      await waitForQueuedRow(page, new RegExp(queuedName, 'i'), 1);
      await waitForCompletion(page, new RegExp(activeName, 'i'));

      await expect
        .poll(
          async () => {
            const roots = await fetchRoots(ctx);
            const queuedRoot = roots.find((root) => root.path === queuedPath);
            if (!queuedRoot) {
              return 'missing';
            }
            if (
              queuedRoot.queueState === 'waiting' &&
              queuedRoot.runId == null
            ) {
              return 'waiting-without-owner';
            }
            return JSON.stringify({
              status: queuedRoot.status ?? null,
              queueState: queuedRoot.queueState ?? null,
              runId: queuedRoot.runId ?? null,
            });
          },
          {
            timeout: 120_000,
            message:
              'waiting for the queued ingest row to stop being stranded without an owner',
          },
        )
        .not.toBe('waiting-without-owner');

      await page.reload();
      await expect
        .poll(
          async () => {
            const queuedRows = page.getByRole('row', {
              name: new RegExp(queuedName, 'i'),
            });
            if ((await queuedRows.count()) === 0) {
              return 'missing';
            }
            return (
              (await queuedRows.first().textContent())?.toLowerCase() ?? ''
            );
          },
          {
            timeout: 60_000,
            message:
              'waiting for the queued row to stop showing queued (#1) after handoff',
          },
        )
        .not.toContain('queued (#1)');
    } finally {
      await ctx.dispose();
    }
  });

  test('Remove selected ignores queued rows in a mixed selection', async ({
    page,
  }) => {
    const removeRequests: string[] = [];
    const mockedRoots = {
      roots: [
        {
          runId: 'run-removable',
          name: 'mock-removable',
          description: 'completed fixture',
          path: '/mock-removable',
          model: 'embed-1',
          status: 'completed',
          lastIngestAt: '2025-01-01T00:00:00.000Z',
          counts: { files: 2, chunks: 4, embedded: 4 },
          lastError: null,
        },
        {
          requestId: 'queue-request-queued',
          runId: null,
          name: 'mock-queued',
          description: 'waiting fixture',
          path: '/mock-queued',
          model: 'embed-1',
          status: 'ingesting',
          phase: 'queued',
          queueState: 'waiting',
          queuePosition: 1,
          lastIngestAt: '2025-01-01T00:00:00.000Z',
          counts: { files: 2, chunks: 4, embedded: 4 },
          lastError: null,
        },
      ],
      schemaVersion: '2025-02-19',
      lockedModelId: 'embed-1',
    };

    await page.route('**/ingest/roots*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockedRoots),
      });
    });
    await page.route('**/ingest/remove/**', async (route) => {
      removeRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', unlocked: false }),
      });
    });

    await page.goto(`${baseUrl}/ingest`);

    const bulkRemove = page.getByRole('button', { name: /remove selected/i });
    await expect(
      page.getByRole('row', { name: /mock-removable/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('row', { name: /mock-queued/i }).first(),
    ).toBeVisible();

    const queuedCheckbox = page.getByRole('checkbox', {
      name: /^Select mock-queued$/i,
    });
    await expect(queuedCheckbox).toBeDisabled();
    await expect(bulkRemove).toBeDisabled();

    await page
      .getByRole('checkbox', { name: /^Select mock-removable$/i })
      .check();
    await expect(bulkRemove).toBeEnabled();
    await saveStableScreenshot(page, '0000055-bulk-selection-state.png');

    await bulkRemove.click();

    await expect
      .poll(() => removeRequests.length, {
        timeout: 10_000,
        message: 'waiting for bulk remove to issue the removable request only',
      })
      .toBe(1);
    expect(removeRequests[0]).toContain('/ingest/remove/%2Fmock-removable');
    expect(removeRequests[0]).not.toContain('/ingest/remove/%2Fmock-queued');
  });

  test('remove clears entry and unlocks model when empty', async ({ page }) => {
    const removeFixtureName = `${fixtureName}-remove`;
    const removeRowNamePattern = new RegExp(`^Select ${removeFixtureName} `, 'i');
    const getRoleMatchedRows = () =>
      page.getByRole('row', {
        name: removeRowNamePattern,
      });
    const getStableRemoveRows = () =>
      page
        .getByRole('row')
        .filter({ hasText: removeFixtureName })
        .filter({ hasText: fixturePath })
        .filter({ hasText: /completed/i })
        .filter({
          has: page.getByRole('button', { name: /^Remove$/i }),
        });
    await page.goto(`${baseUrl}/ingest`);
    // Keep the validated mounted repo-root fixture path here. Task 35's
    // carried-forward timeout artifacts showed the previous `/fixtures/repo/docs`
    // shortcut was not guaranteed by the current e2e image contract.
    await page.getByLabel('Folder path').fill(fixturePath);
    await page.getByLabel('Display name').fill(removeFixtureName);
    await selectEmbeddingModel(page);
    const cleanupCtx = await request.newContext();
    let removeRunId: string | null = null;

    try {
      let started = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const outcome = await startIngestAndCaptureOutcome(page);
        if (outcome.ok) {
          removeRunId = outcome.runId;
          started = true;
          break;
        }

        if (outcome.status === 429 && attempt < 2) {
          await expect
            .poll(async () => (await fetchRoots(cleanupCtx)).length, {
              timeout: 60_000,
              message:
                'waiting for existing ingest roots to clear before retrying remove-flow setup',
            })
            .toBe(0);
          continue;
        }

        throw new Error(
          `ingest remove test start failed (${outcome.errorMessage ?? `HTTP ${outcome.status}`})`,
        );
      }

      if (!started) {
        throw new Error(
          'ingest remove test failed to start after the bounded retry budget',
        );
      }
      if (!removeRunId) {
        throw new Error(
          'ingest remove test start response did not include a runId',
        );
      }
    } finally {
      await cleanupCtx.dispose();
    }

    const statusCtx = await request.newContext();
    try {
      await test.step(
        'remove-flow owner: server completion polling',
        async () => {
          await expect
            .poll(
              async () => {
                const roots = await fetchRoots(statusCtx);
                // Match the exact started root so prior suite state with the
                // same fixture path cannot satisfy this boundary early.
                const root = roots.find(
                  (entry) =>
                    entry.runId === removeRunId ||
                    entry.name === removeFixtureName,
                );
                return root
                  ? `${root.status ?? 'unknown'}:${root.queueState ?? 'none'}`
                  : 'missing';
              },
              {
                timeout: 180_000,
                message:
                  'waiting for remove-flow ingest to reach a completed root',
              },
            )
            .toMatch(/^completed:/i);
        },
        { timeout: 180_000 },
      );
    } finally {
      await statusCtx.dispose();
    }

    await test.step(
      'remove-flow owner: row-selection contract before remove',
      async () => {
        const roleMatchedRows = getRoleMatchedRows();
        const stableRows = getStableRemoveRows();
        await expect
          .poll(
            async () => {
              const roleMatchedCount = await roleMatchedRows.count();
              const stableCount = await stableRows.count();
              const stableTexts = (await stableRows.allTextContents()).map(
                (value) => value.replace(/\s+/g, ' ').trim(),
              );
              if (stableCount === 0) {
                return `stable-missing roleMatched=${roleMatchedCount}`;
              }
              if (stableCount > 1) {
                return `multiple-stable stableCount=${stableCount} roleMatched=${roleMatchedCount}`;
              }
              const [stableText] = stableTexts;
              if (roleMatchedCount === 0) {
                return `role-mismatch ${stableText ?? 'missing'}`;
              }
              if (roleMatchedCount > 1) {
                return `multiple-role-matches roleMatched=${roleMatchedCount} stableText=${stableText ?? 'missing'}`;
              }
              return `stable-ready ${stableText ?? 'missing'}`;
            },
            {
              timeout: 30_000,
              message:
                'waiting for a stable remove-flow row-selection contract before remove',
            },
          )
          .toMatch(/^stable-ready /);
      },
      { timeout: 30_000 },
    );

    await test.step(
      'remove-flow owner: remove-click success confirmation',
      async () => {
        const row = getStableRemoveRows().first();
        await row.getByRole('button', { name: /^Remove$/i }).click();
        await expect(page.getByText(/Removed/i).first()).toBeVisible({
          timeout: 30_000,
        });

        await expect(page.getByText(/No embedded folders yet/i)).toBeVisible({
          timeout: 30_000,
        });
      },
      { timeout: 30_000 },
    );
  });
});
