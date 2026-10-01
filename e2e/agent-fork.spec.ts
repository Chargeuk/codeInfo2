import { expect, test } from '@playwright/test';
import { resolveConfiguredE2eTimeoutMs } from './support/testTimeouts';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001';
const apiUrl = process.env.E2E_API_URL ?? 'http://host.docker.internal:6010';

for (const viewport of [
  { width: 1280, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`agent fork filters compatible targets and selects child at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    let childCreated = false;
    const forkBodies: Record<string, unknown>[] = [];
    const requests: string[] = [];
    const row = (id: string, agentName: string) => ({
      conversationId: id,
      title:
        id === 'source' ? 'Source conversation' : 'Fork conversation result',
      agentName,
      provider: 'codex',
      model: 'target-model',
      lastMessageAt: '2026-09-29T00:00:00Z',
      archived: false,
      flags: { workingFolder: '/shared/folder' },
    });
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== new URL(apiUrl).origin) {
        await route.continue();
        return;
      }
      requests.push(url.pathname);
      let payload: unknown;
      if (url.pathname === '/health') payload = { mongoConnected: true };
      else if (url.pathname === '/agents')
        payload = {
          agents: [
            { name: 'source_agent' },
            { name: 'target_agent' },
            { name: 'incompatible_agent' },
          ],
        };
      else if (url.pathname.endsWith('/fork-options'))
        payload = {
          sourceTurnId: 'completed-response',
          sourceTitle: 'Source conversation',
          sourceAgentName: 'source_agent',
          estimated: true,
          agents: [
            { name: 'source_agent', sameAgent: true },
            { name: 'target_agent', sameAgent: false },
          ],
        };
      else if (url.pathname.endsWith('/fork')) {
        forkBodies.push(request.postDataJSON());
        childCreated = true;
        payload = {
          conversationId: 'child',
          agentName: 'target_agent',
          model: 'target-model',
          workingFolder: '/shared/folder',
          estimated: true,
        };
      } else if (url.pathname.endsWith('/commands')) payload = { commands: [] };
      else if (url.pathname.endsWith('/prompts')) payload = { prompts: [] };
      else if (/^\/agents\/[^/]+$/.test(url.pathname))
        payload = {
          agent: {
            name: url.pathname.split('/').at(-1),
            disabled: false,
            warnings: [],
            fallbackCandidates: [],
          },
        };
      else if (url.pathname === '/conversations')
        payload = {
          items:
            url.searchParams.get('agentName') === 'target_agent' && childCreated
              ? [row('child', 'target_agent')]
              : [row('source', 'source_agent')],
          nextCursor: null,
        };
      else if (url.pathname.endsWith('/turns')) {
        const child = url.pathname.includes('/child/');
        payload = {
          items: [
            {
              turnId: child ? 'copied-assistant' : 'completed-response',
              conversationId: child ? 'child' : 'source',
              role: 'assistant',
              content: 'Completed source response',
              provider: 'codex',
              model: 'historic-model',
              status: 'ok',
              createdAt: '2026-09-29T00:00:00Z',
            },
          ],
          ...(child
            ? {}
            : {
                inflight: {
                  inflightId: 'later-run',
                  assistantText: 'Later source work',
                  assistantThink: '',
                  toolEvents: [],
                  startedAt: '2026-09-29T00:01:00Z',
                  seq: 1,
                },
              }),
        };
      } else {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });
    await page.goto(`${baseUrl}/agents`);
    if (viewport.width < 600)
      await page.getByRole('button', { name: 'Open conversations' }).click();
    await expect(
      page.getByText('Source conversation', { exact: true }),
    ).toBeVisible({ timeout: resolveConfiguredE2eTimeoutMs(20_000) });
    const sourceRow = page.getByTestId('conversation-row').filter({
      has: page.getByText('Source conversation', { exact: true }),
    });
    await sourceRow
      .getByRole('button', { name: 'Conversation actions', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Fork conversation...' }).click();
    const dialog = page.getByRole('dialog', { name: 'Fork conversation' });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    if (viewport.width < 600) {
      expect(bounds!.width).toBeGreaterThan(viewport.width * 0.9);
      expect(bounds!.width).toBeLessThanOrEqual(viewport.width);
    } else expect(bounds!.width).toBeLessThanOrEqual(600);
    const input = dialog.getByRole('combobox', { name: 'Target agent' });
    await expect(input).toHaveValue('source_agent (Same agent)');
    await input.fill('target');
    await page
      .getByRole('option', { name: 'target_agent', exact: true })
      .click();
    await expect(
      page.getByRole('option', { name: 'incompatible_agent' }),
    ).toHaveCount(0);
    const create = dialog.getByRole('button', { name: 'Create fork' });
    expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await create.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('agent-select-trigger')).toContainText(
      'target_agent',
    );
    if (viewport.width < 600)
      await expect(
        page.getByTestId('workspace-mobile-conversations-overlay'),
      ).toBeHidden();
    await expect(
      page.getByText('Completed source response', { exact: true }),
    ).toBeVisible();
    expect(forkBodies).toHaveLength(1);
    expect(forkBodies[0].targetAgentName).toBe('target_agent');
    expect(forkBodies[0].sourceTurnId).toBe('completed-response');
    expect(
      requests.some(
        (path) => path.endsWith('/run') || path.includes('/cancel'),
      ),
    ).toBe(false);
    expect(requests).toContain('/conversations/child/turns');
  });
}
