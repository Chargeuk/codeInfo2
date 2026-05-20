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

  await page.getByTestId('flow-new').click();
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
  await expect(page.getByTestId('flow-resume')).toBeEnabled({
    timeout: 20000,
  });
  await page.getByTestId('flow-resume').click();
  await expect
    .poll(() => runBodies.length, {
      timeout: 10000,
      message: 'Expected resume request to be recorded',
    })
    .toBe(3);
  expect(runBodies[2]).not.toHaveProperty('retryOwnershipId');

  await page.getByTestId('flow-new').click();
  await expect(page.getByTestId('flow-run')).toBeEnabled({ timeout: 20000 });
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
