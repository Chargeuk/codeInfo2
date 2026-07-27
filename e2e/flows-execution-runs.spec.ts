import { expect, test, type Page, type Route } from '@playwright/test';
import {
  knownRepositoryPathsAvailable,
  validateRequestedWorkingFolder,
} from '../server/src/workingFolders/state';
import { installMockChatWs } from './support/mockChatWs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001';
const apiUrl = process.env.E2E_API_URL ?? 'http://host.docker.internal:6010';

const skipIfUnreachable = async (page: Page) => {
  try {
    const ping = await page.request.get(baseUrl);
    if (!ping.ok()) {
      test.skip(`Client not reachable (${ping.status()})`);
    }
  } catch {
    test.skip('Client not reachable (request failed)');
  }
};

test('flows keep one accepted launch for an ambiguous fresh-run retry and clear stale retry ownership on resume and later fresh runs', async ({
  page,
}) => {
  await skipIfUnreachable(page);
  await installMockChatWs(page);

  const flowRows: Array<Record<string, unknown>> = [];
  const agentRows: Array<Record<string, unknown>> = [
    {
      conversationId: 'agent-plain-1',
      title: 'Ordinary planner conversation',
      provider: 'codex',
      model: 'gpt-5.2',
      source: 'REST',
      lastMessageAt: '2025-01-01T00:00:00.000Z',
      archived: false,
      agentName: 'planner',
    },
  ];
  const runBodies: Array<Record<string, unknown>> = [];
  let acceptedConversationId: string | null = null;

  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    if (url.origin !== new URL(apiUrl).origin) {
      await route.continue();
      return;
    }
    const path = url.pathname;

    if (path === '/health' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mongoConnected: true }),
      });
      return;
    }

    if (path === '/flows' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flows: [
            { name: 'echo', description: 'Echo flow', disabled: false },
          ],
        }),
      });
      return;
    }

    if (path === '/flows/echo' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flow: {
            name: 'echo',
            description: 'Echo flow',
            disabled: false,
            warnings: [],
          },
        }),
      });
      return;
    }

    if (path === '/conversations' && method === 'GET') {
      const flowName = url.searchParams.get('flowName');
      const agentName = url.searchParams.get('agentName');
      const items =
        flowName === 'echo'
          ? flowRows
          : flowName === '__none__' && agentName === 'planner'
            ? agentRows
            : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items, nextCursor: null }),
      });
      return;
    }

    if (path.startsWith('/conversations/') && path.endsWith('/turns')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null }),
      });
      return;
    }

    if (path === '/flows/echo/run' && method === 'POST') {
      const payload = (req.postDataJSON?.() ?? {}) as Record<string, unknown>;
      runBodies.push(payload);
      const runIndex = runBodies.length;
      const freshConversationId =
        typeof payload.conversationId === 'string'
          ? payload.conversationId
          : `flow-run-${runIndex}`;
      const timestamp = `2025-01-0${runIndex + 1}T00:00:00.000Z`;

      if (runIndex === 1) {
        acceptedConversationId = freshConversationId;
        await route.abort();
        return;
      }

      if (Array.isArray(payload.resumeStepPath)) {
        flowRows.splice(
          0,
          flowRows.length,
          ...flowRows.map((row) =>
            row.conversationId === freshConversationId
              ? {
                  ...row,
                  lastMessageAt: timestamp,
                  flags: {
                    flow: {
                      executionId: `run0000${runIndex}-execution-id`,
                    },
                  },
                }
              : row,
          ),
        );
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'started',
            flowName: 'echo',
            conversationId: freshConversationId,
            inflightId: `flow-inflight-${runIndex}`,
            providerId: 'codex',
            modelId: 'gpt-5.2',
          }),
        });
        return;
      }

      const replayConversationId =
        acceptedConversationId ?? freshConversationId;
      if (runIndex === 2) {
        flowRows.unshift({
          conversationId: replayConversationId,
          title: 'Flow: echo',
          provider: 'codex',
          model: 'gpt-5.2',
          source: 'REST',
          lastMessageAt: timestamp,
          archived: false,
          flowName: 'echo',
          flags: {
            flow: {
              executionId: 'run00002-execution-id',
              stepPath: [0],
            },
          },
        });
      } else {
        flowRows.unshift({
          conversationId: freshConversationId,
          title: 'Flow: echo',
          provider: 'codex',
          model: 'gpt-5.2',
          source: 'REST',
          lastMessageAt: timestamp,
          archived: false,
          flowName: 'echo',
          flags: {
            flow: {
              executionId: `run0000${runIndex}-execution-id`,
              stepPath: [0],
            },
          },
        });
      }

      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'started',
          flowName: 'echo',
          conversationId:
            runIndex === 2 ? replayConversationId : freshConversationId,
          inflightId: `flow-inflight-${runIndex}`,
          providerId: 'codex',
          modelId: 'gpt-5.2',
        }),
      });
      return;
    }

    await route.continue();
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole('button', { name: /open menu/i }).click();
  await expect(page.getByTestId('workspace-mobile-app-menu-overlay')).toBeVisible(
    { timeout: 20000 },
  );
  await page
    .getByTestId('workspace-mobile-app-menu-overlay')
  .getByRole('link', { name: 'Flows' })
    .click();
  await expect(page).toHaveURL(/\/flows$/);
  await expect(page.getByTestId('flow-run')).toBeEnabled({ timeout: 20000 });

  await page.getByTestId('flow-run').click();
  await expect
    .poll(() => runBodies.length, {
      timeout: 10000,
      message: 'Expected first fresh run to be recorded',
    })
    .toBe(1);
  await expect(page.getByTestId('flow-run')).toBeEnabled({ timeout: 20000 });

  await page.getByTestId('flow-run').click();
  await expect
    .poll(() => flowRows.length, {
      timeout: 10000,
      message: 'Expected retry ownership replay to settle on one visible run',
    })
    .toBe(1);
  expect(runBodies).toHaveLength(2);
  expect(runBodies[0]?.retryOwnershipId).toBe(runBodies[1]?.retryOwnershipId);
  expect(flowRows).toHaveLength(1);

  await page.getByTestId('conversation-drawer-toggle').click();
  await expect(
    page.getByTestId('workspace-mobile-conversations-overlay'),
  ).toBeVisible({ timeout: 20000 });
  await page
    .locator('[data-testid="conversation-row"]')
    .filter({ hasText: 'Flow: echo' })
    .first()
    .click();
  await page.getByLabel('Close conversations').click();
  await expect(
    page.getByTestId('workspace-mobile-conversations-overlay'),
  ).toBeHidden({ timeout: 20000 });
  await expect(page.getByTestId('flow-run')).toBeEnabled({
    timeout: 20000,
  });
  await page.getByTestId('flow-run').click();
  await expect
    .poll(() => runBodies.length, {
      timeout: 10000,
      message: 'Expected resume request to be recorded',
    })
    .toBe(3);
  expect(runBodies[2]).not.toHaveProperty('retryOwnershipId');

  await page.goto(`${baseUrl}/flows`);
  await expect(page).toHaveURL(/\/flows$/);
  await expect(page.getByTestId('flow-run')).toBeEnabled({
    timeout: 20000,
  });
  await page.getByTestId('flow-run').click();
  await expect
    .poll(() => flowRows.length, {
      timeout: 10000,
      message: 'Expected later fresh run to appear independently',
    })
    .toBe(2);
  expect(runBodies).toHaveLength(4);
  expect(typeof runBodies[3].retryOwnershipId).toBe('string');
  expect(runBodies[3].retryOwnershipId).not.toBe(runBodies[1].retryOwnershipId);
  expect(flowRows).toHaveLength(2);
});

test('flows expose wave progress and target-aware repeated child identity in the browser sidebar', async ({
  page,
}) => {
  await skipIfUnreachable(page);
  await installMockChatWs(page);

  const conversations = [
    {
      conversationId: 'wave-parent',
      title: 'Flow: story-review',
      provider: 'codex',
      model: 'gpt-5.2',
      source: 'REST',
      lastMessageAt: '2025-01-03T00:00:00.000Z',
      archived: false,
      flowName: 'story-review',
      flags: {
        flow: {
          executionId: 'waveparent-12345678',
          subflowWaveProgress: {
            expected: 7,
            running: 0,
            completed: 6,
            failed: 0,
            stopped: 0,
            notApplicable: 1,
          },
        },
      },
    },
    ...['repo-one', 'repo-two'].map((targetId, index) => ({
      conversationId: `wave-child-${index}`,
      title: `Story Review-Artifact Review [${targetId}]`,
      provider: 'codex',
      model: 'gpt-5.2',
      source: 'REST',
      lastMessageAt: `2025-01-0${index + 1}T00:00:00.000Z`,
      archived: false,
      flowName: 'artifact-review',
      flags: {
        flow: { executionId: `childexec${index}-12345678` },
        flowChild: {
          executionId: 'waveparent-12345678',
          instanceId: `target-reviews:${index}:artifact-review`,
          targetId,
          displayName: `artifact-review [${targetId}]`,
        },
      },
    })),
  ];

  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== new URL(apiUrl).origin) {
      await route.continue();
      return;
    }
    const path = url.pathname;
    if (path === '/health') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mongoConnected: true }),
      });
      return;
    }
    if (path === '/flows') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flows: [
            {
              name: 'story-review',
              description: 'Story review',
              disabled: false,
            },
          ],
        }),
      });
      return;
    }
    if (path === '/flows/story-review') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flow: {
            name: 'story-review',
            description: 'Story review',
            disabled: false,
            warnings: [],
          },
        }),
      });
      return;
    }
    if (path === '/conversations') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: conversations, nextCursor: null }),
      });
      return;
    }
    if (path.endsWith('/turns')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null }),
      });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/flows`);
  await expect(page.getByTestId('flow-run')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('conversation-drawer-toggle').click();
  const overlay = page.getByTestId('workspace-mobile-conversations-overlay');
  await expect(overlay).toBeVisible({ timeout: 20000 });
  await expect(overlay.getByText('Wave 7/7')).toBeVisible();
  await expect(
    overlay
      .getByTestId('conversation-wave-target-chip')
      .filter({ hasText: 'repo-one' }),
  ).toBeVisible();
  await expect(
    overlay
      .getByTestId('conversation-wave-target-chip')
      .filter({ hasText: 'repo-two' }),
  ).toBeVisible();
  await expect(
    overlay.getByText('Story Review-Artifact Review [repo-one]'),
  ).toBeVisible();
  await expect(
    overlay.getByText('Story Review-Artifact Review [repo-two]'),
  ).toBeVisible();
});

test('flows warning rendering and disabled run guard stay visible at the browser surface', async ({
  page,
}) => {
  await skipIfUnreachable(page);
  await installMockChatWs(page);

  const runBodies: Array<Record<string, unknown>> = [];

  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    if (url.origin !== new URL(apiUrl).origin) {
      await route.continue();
      return;
    }
    const path = url.pathname;

    if (path === '/health' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mongoConnected: true }),
      });
      return;
    }

    if (path === '/flows' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flows: [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        }),
      });
      return;
    }

    if (path === '/flows/daily' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flow: {
            name: 'daily',
            description: 'Daily flow',
            disabled: true,
            warnings: [
              {
                code: 'provider_unavailable',
                message: 'Primary provider unavailable',
              },
            ],
            disabledReason: {
              code: 'provider_unavailable',
              message: 'No usable provider remains',
            },
          },
        }),
      });
      return;
    }

    if (path === '/conversations' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null }),
      });
      return;
    }

    if (path.startsWith('/conversations/') && path.endsWith('/turns')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null }),
      });
      return;
    }

    if (path === '/flows/daily/run' && method === 'POST') {
      runBodies.push((req.postDataJSON?.() ?? {}) as Record<string, unknown>);
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'started',
          flowName: 'daily',
          conversationId: 'flow-1',
          inflightId: 'i1',
          providerId: 'codex',
          modelId: 'gpt-5.2',
        }),
      });
      return;
    }

    await route.continue();
  });

  await page.goto(`${baseUrl}/flows`);
  await expect(page.getByTestId('flow-info')).toBeVisible({ timeout: 20000 });

  await page.getByTestId('flow-info').click();

  await expect(page.getByText('Primary provider unavailable')).toBeVisible();
  await expect(page.getByText('No usable provider remains')).toBeVisible();
  await expect(page.getByTestId('flow-run')).toBeDisabled();
  expect(runBodies).toHaveLength(0);
});

test('flows composer footer controls use upward desktop popovers and centered mobile dialogs', async ({
  page,
}) => {
  await skipIfUnreachable(page);
  await installMockChatWs(page);

  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    if (url.origin !== new URL(apiUrl).origin) {
      await route.continue();
      return;
    }
    const path = url.pathname;

    if (path === '/health' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mongoConnected: true }),
      });
      return;
    }

    if (path === '/flows' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flows: [{ name: 'daily', description: 'Daily flow', disabled: false }],
        }),
      });
      return;
    }

    if (path === '/flows/daily' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flow: {
            name: 'daily',
            description: 'Daily flow',
            disabled: false,
            warnings: [],
          },
        }),
      });
      return;
    }

    if (path === '/conversations' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null }),
      });
      return;
    }

    if (path.startsWith('/conversations/') && path.endsWith('/turns')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null }),
      });
      return;
    }

    await route.continue();
  });

  const expectDesktopPopoverAboveTrigger = async (
    triggerTestId: string,
    popoverTestId: string,
    contentTestId: string,
  ) => {
    const trigger = page.getByTestId(triggerTestId);
    await trigger.click();
    const popover = page.getByTestId(popoverTestId);
    await expect(popover).toBeVisible({ timeout: 20000 });
    const content = page.getByTestId(contentTestId);
    await expect(content).toBeVisible({ timeout: 20000 });

    const triggerBox = await trigger.boundingBox();
    const popoverBox = await content.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(popoverBox).not.toBeNull();
    expect(popoverBox?.y ?? 0).toBeLessThan(triggerBox?.y ?? 0);
    expect((popoverBox?.y ?? 0) + (popoverBox?.height ?? 0)).toBeLessThanOrEqual(
      (triggerBox?.y ?? 0) + 12,
    );

    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden({ timeout: 20000 });
  };

  const expectCenteredMobileDialog = async (
    triggerTestId: string,
    dialogTestId: string,
    heading: string,
  ) => {
    const trigger = page.getByTestId(triggerTestId);
    await trigger.click();
    const dialog = page.getByTestId(dialogTestId);
    await expect(dialog).toBeVisible({ timeout: 20000 });
    await expect(
      dialog.getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible();

    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(dialogBox).not.toBeNull();
    expect(viewport).not.toBeNull();

    const horizontalCenterDelta = Math.abs(
      (dialogBox?.x ?? 0) +
        (dialogBox?.width ?? 0) / 2 -
        (viewport?.width ?? 0) / 2,
    );

    expect(horizontalCenterDelta).toBeLessThan(12);
    expect(dialogBox?.width ?? 0).toBeGreaterThan(280);

    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(dialog).toBeHidden({ timeout: 20000 });
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/flows`);
  await expect(page.getByTestId('flow-info')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('flow-select-trigger')).toContainText('daily');

  await expectDesktopPopoverAboveTrigger(
    'flow-info',
    'flow-info-popover',
    'flow-info-content',
  );
  await expectDesktopPopoverAboveTrigger(
    'flow-select-trigger',
    'flow-select-popover',
    'flow-selector-content',
  );
  await expectDesktopPopoverAboveTrigger(
    'flow-title-trigger',
    'flow-title-popover',
    'flow-title-content',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/flows`);
  await expect(page.getByTestId('flow-info')).toBeVisible({ timeout: 20000 });

  await expectCenteredMobileDialog('flow-info', 'flow-info-dialog', 'Info');
  await expectCenteredMobileDialog(
    'flow-select-trigger',
    'flow-select-dialog',
    'Flow',
  );
  await expectCenteredMobileDialog(
    'flow-title-trigger',
    'flow-title-dialog',
    'Title',
  );
});

test('flows existing-conversation working-folder picker applies a local repository without a not found error', async ({
  page,
}) => {
  await skipIfUnreachable(page);
  await installMockChatWs(page);

  const workingFolderBodies: Array<Record<string, unknown>> = [];
  const knownRepositoryPathsState = knownRepositoryPathsAvailable([]);

  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    if (url.origin !== new URL(apiUrl).origin) {
      await route.continue();
      return;
    }
    const path = url.pathname;

    if (path === '/health' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mongoConnected: true }),
      });
      return;
    }

    if (path === '/flows' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flows: [{ name: 'daily', description: 'Daily flow', disabled: false }],
        }),
      });
      return;
    }

    if (path === '/flows/daily' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flow: {
            name: 'daily',
            description: 'Daily flow',
            disabled: false,
            warnings: [],
          },
        }),
      });
      return;
    }

    if (path === '/conversations' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              conversationId: 'flow-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5.2',
              source: 'REST',
              lastMessageAt: '2025-01-01T00:00:00.000Z',
              archived: false,
              flowName: 'daily',
              flags: { workingFolder: '/base/repo' },
            },
          ],
          nextCursor: null,
        }),
      });
      return;
    }

    if (path.startsWith('/conversations/') && path.endsWith('/turns')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null }),
      });
      return;
    }

    if (path === '/ingest/dirs' && method === 'GET') {
      const requestedPath = url.searchParams.get('path') ?? '/base/repo';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          base: '/base',
          path: requestedPath,
          dirs:
            requestedPath === '/base/repo' ? ['child'] : [],
        }),
      });
      return;
    }

    if (
      path === '/conversations/flow-1/working-folder' &&
      method === 'POST'
    ) {
      const payload = (req.postDataJSON?.() ?? {}) as Record<string, unknown>;
      workingFolderBodies.push(payload);
      const workingFolder =
        typeof payload.workingFolder === 'string'
          ? payload.workingFolder
          : undefined;
      try {
        const validatedWorkingFolder = await validateRequestedWorkingFolder({
          workingFolder,
          knownRepositoryPathsState,
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'ok',
            conversation: {
              conversationId: 'flow-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5.2',
              source: 'REST',
              archived: false,
              flowName: 'daily',
              flags: validatedWorkingFolder
                ? { workingFolder: validatedWorkingFolder }
                : {},
            },
          }),
        });
      } catch (error) {
        const err = error as { code?: string; reason?: string };
        await route.fulfill({
          status: err.code === 'WORKING_FOLDER_UNAVAILABLE' ? 503 : 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error:
              err.code === 'WORKING_FOLDER_UNAVAILABLE'
                ? 'working_folder_unavailable'
                : 'invalid_request',
            code: err.code ?? 'WORKING_FOLDER_INVALID',
            message:
              err.reason ??
              'working_folder validation failed',
          }),
        });
      }
      return;
    }

    await route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/flows`);
  await expect(page.getByTestId('flow-title-trigger')).toContainText(
    'Flow: daily',
    { timeout: 20000 },
  );
  await page.locator('[data-testid="conversation-row"]').first().click();

  await expect(page.getByTestId('flow-working-folder-trigger')).toContainText(
    'repo',
  );

  await page.getByTestId('flow-working-folder-trigger').click();
  await expect(page.getByRole('dialog', { name: 'Choose folder…' })).toBeVisible(
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: 'child' }).click();
  await page.getByRole('button', { name: 'Use this folder' }).click();

  await expect(page.getByRole('dialog', { name: 'Choose folder…' })).toHaveCount(
    0,
  );

  await expect(page.getByTestId('flow-working-folder-trigger')).toContainText(
    'child',
  );
  await expect(page.getByText('working_folder not found')).toHaveCount(0);
  expect(workingFolderBodies).toEqual([{ workingFolder: '/base/repo/child' }]);
});

test('flows existing conversations open at the newest visible content and preserve scrolled-away reading position', async ({
  page,
}) => {
  await skipIfUnreachable(page);
  const mockWs = await installMockChatWs(page);

  const flowTurns = Array.from({ length: 12 }, (_, index) => ({
    turnId: `turn-${index + 1}`,
    conversationId: 'flow-1',
    role: index % 2 === 0 ? 'user' : 'assistant',
    content:
      index === 0
        ? 'Reply with a short greeting.'
        : index === 1
          ? 'Hello. No tools were used.'
          : `Flow history message ${index + 1}`,
    provider: 'codex',
    model: 'gpt-5',
    status: 'ok',
    createdAt: `2025-01-01T00:0${index}:00.000Z`,
  }));

  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    if (url.origin !== new URL(apiUrl).origin) {
      await route.continue();
      return;
    }
    const path = url.pathname;

    if (path === '/health' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mongoConnected: true }),
      });
      return;
    }

    if (path === '/flows' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flows: [{ name: 'echo', description: 'Echo flow', disabled: false }],
        }),
      });
      return;
    }

    if (path === '/flows/echo' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flow: {
            name: 'echo',
            description: 'Echo flow',
            disabled: false,
            warnings: [],
          },
        }),
      });
      return;
    }

    if (path === '/conversations' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              conversationId: 'flow-1',
              title: 'Flow: echo',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: '2025-01-01T00:11:00.000Z',
              archived: false,
              flowName: 'echo',
              flags: {},
            },
          ],
          nextCursor: null,
        }),
      });
      return;
    }

    if (path.startsWith('/conversations/') && path.endsWith('/turns')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: flowTurns, nextCursor: null }),
      });
      return;
    }

    if (
      path === '/conversations/flow-1/working-folder' &&
      method === 'POST'
    ) {
      const payload = req.postDataJSON?.() ?? {};
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          conversation: {
            conversationId: 'flow-1',
            title: 'Flow: echo',
            provider: 'codex',
            model: 'gpt-5',
            source: 'REST',
            archived: false,
            flowName: 'echo',
            flags:
              typeof (payload as { workingFolder?: string }).workingFolder ===
              'string'
                ? {
                    workingFolder: (
                      payload as { workingFolder: string }
                    ).workingFolder,
                  }
                : {},
          },
        }),
      });
      return;
    }

    if (path === '/ingest/dirs' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(defaultDirs),
      });
      return;
    }

    await route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/flows`);
  await expect(page.getByTestId('flow-run')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('conversation-row').first().click();

  const transcript = page.getByTestId('flows-transcript');
  await expect(transcript).toBeVisible();

  const transcriptText = await transcript.evaluate(
    (node) => node.textContent ?? '',
  );
  expect(transcriptText.indexOf('Reply with a short greeting.')).toBeLessThan(
    transcriptText.indexOf('Hello. No tools were used.'),
  );

  const initialMetrics = await transcript.evaluate((node) => {
    const element = node as HTMLElement;
    return {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    };
  });
  expect(initialMetrics.scrollTop).toBeGreaterThan(0);

  const scrolledTop = await transcript.evaluate((node) => {
    const element = node as HTMLElement;
    const targetTop = Math.max(120, element.scrollTop - 520);
    element.scrollTop = targetTop;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
    return element.scrollTop;
  });
  expect(scrolledTop).toBeGreaterThan(0);

  const anchorMessage = transcript.getByText('Flow history message 6');
  await expect(anchorMessage).toBeVisible();

  await mockWs.waitForConversationSubscription('flow-1');
  await mockWs.sendUserTurn({
    conversationId: 'flow-1',
    inflightId: 'flow-inflight-1',
    content: 'A newer flow turn is arriving.',
  });
  await mockWs.sendAssistantDelta({
    conversationId: 'flow-1',
    inflightId: 'flow-inflight-1',
    delta: 'Preserve my reading position.',
  });
  await mockWs.sendFinal({
    conversationId: 'flow-1',
    inflightId: 'flow-inflight-1',
    status: 'ok',
  });

  await expect(anchorMessage).toBeVisible();
});
