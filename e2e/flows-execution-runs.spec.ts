import { expect, test, type Page, type Route } from '@playwright/test';
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

test('flows and agents show stable run clues for repeated fresh executions and block quick-settling replay on the mobile first-arrival path', async ({
  page,
}) => {
  await skipIfUnreachable(page);
  await installMockChatWs(page);
  await page.addInitScript(() => {
    const callbacks: FrameRequestCallback[] = [];
    const globalWindow = window as typeof window & {
      __flushReplayBarrier?: () => void;
    };
    globalWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }) as typeof window.requestAnimationFrame;
    globalWindow.__flushReplayBarrier = () => {
      const queued = callbacks.splice(0);
      queued.forEach((callback) => callback(performance.now()));
    };
  });

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

    if (path === '/agents' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ agents: [{ name: 'planner' }] }),
      });
      return;
    }

    if (path === '/agents/planner/commands' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ commands: [] }),
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
      const executionId = `run0000${runIndex}-execution-id`;
      const conversationId =
        typeof payload.conversationId === 'string'
          ? payload.conversationId
          : `flow-run-${runIndex}`;
      const childConversationId = `planner-run-${runIndex}`;
      const timestamp = `2025-01-0${runIndex + 1}T00:00:00.000Z`;

      flowRows.unshift({
        conversationId,
        title: 'Flow: echo',
        provider: 'codex',
        model: 'gpt-5.2',
        source: 'REST',
        lastMessageAt: timestamp,
        archived: false,
        flowName: 'echo',
        flags: { flow: { executionId } },
      });

      agentRows.unshift({
        conversationId: childConversationId,
        title: `Planner child conversation ${runIndex}`,
        provider: 'codex',
        model: 'gpt-5.2',
        source: 'REST',
        lastMessageAt: timestamp,
        archived: false,
        agentName: 'planner',
        flags: { flowChild: { executionId } },
      });

      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'started',
          flowName: 'echo',
          conversationId,
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

  await page.getByTestId('flow-new').click();
  await page.getByTestId('flow-run').click();
  await expect
    .poll(() => flowRows.length, {
      timeout: 10000,
      message: 'Expected first-arrival replay barrier to mint only one run',
    })
    .toBe(1);
  expect(runBodies).toHaveLength(1);
  await page.getByTestId('conversation-drawer-toggle').click();
  await expect(
    page.getByTestId('workspace-mobile-conversations-overlay'),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Flow: echo')).toBeVisible();
  await expect(page.getByTestId('flow-run')).toBeDisabled();
  expect(runBodies).toHaveLength(1);
  expect(flowRows).toHaveLength(1);

  await page.evaluate(() => {
    (
      window as typeof window & { __flushReplayBarrier?: () => void }
    ).__flushReplayBarrier?.();
  });
  await expect(page.getByTestId('flow-run')).toBeEnabled();

  await page.goto(`${baseUrl}/agents`);
  await expect(page.getByTestId('agents-page')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: /conversations/i }).click();
  await expect(
    page.getByTestId('workspace-mobile-conversations-overlay'),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Run run00001')).toBeVisible();

  await page.goto(`${baseUrl}/flows`);
  await expect(page.getByTestId('flow-run')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('flow-run').click();
  await expect
    .poll(() => flowRows.length, {
      timeout: 10000,
      message: 'Expected second fresh flow execution to appear',
    })
    .toBe(2);

  expect(runBodies).toHaveLength(2);
  expect(runBodies[0]?.conversationId).not.toBe(runBodies[1]?.conversationId);

  await page.goto(`${baseUrl}/agents`);
  await expect(page.getByTestId('agents-page')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: /conversations/i }).click();
  await expect(
    page.getByTestId('workspace-mobile-conversations-overlay'),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Run run00001')).toBeVisible();
  await expect(page.getByText('Run run00002')).toBeVisible();

  const ordinaryRow = page
    .locator('[data-testid="conversation-row"]')
    .filter({ hasText: 'Ordinary planner conversation' });
  await expect(ordinaryRow).toBeVisible();
  await expect(ordinaryRow.getByTestId('conversation-run-chip')).toHaveCount(0);
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

  await page.getByTestId('flow-working-folder').fill('/tmp/stale');
  await page.getByTestId('flow-info').click();

  await expect(page.getByText('Primary provider unavailable')).toBeVisible();
  await expect(page.getByText('No usable provider remains')).toBeVisible();
  await expect(page.getByTestId('flow-run')).toBeDisabled();
  expect(runBodies).toHaveLength(0);
});
