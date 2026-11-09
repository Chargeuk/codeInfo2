import { expect, test, type Page, type Response } from '@playwright/test';
import type { WebSocketRoute } from 'playwright-core';
import { decodeJsonBody } from './support/decodeJsonBody';
import { installMockChatWs } from './support/mockChatWs';
import { resolveConfiguredE2eTimeoutMs } from './support/testTimeouts';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001';
const apiUrl = process.env.E2E_API_URL ?? 'http://host.docker.internal:6010';
const endpointId = 'https://alpha.example/target/v1';
const sourceId = '/fixtures/review-repository';
const chosenFolder = '/fixtures/chosen-folder';
const promptPath = `${chosenFolder}/prompts/review.md`;
const firstUpdateAt = '2026-11-09T10:00:01.000Z';
const lastUpdateAt = '2026-11-09T10:00:02.000Z';
type Surface = 'chat' | 'agents' | 'flows';

const surfaceUrl = (surface: Surface) => new URL(`/${surface}`, baseUrl);
const transcript = (page: Page, surface: Surface) =>
  page.getByTestId(
    surface === 'flows' ? 'flows-transcript' : 'chat-transcript',
  );
const folderTrigger = (page: Page, surface: Surface) =>
  page.getByTestId(
    surface === 'agents'
      ? 'agent-working-path-trigger'
      : `${surface === 'flows' ? 'flow' : 'chat'}-working-folder-trigger`,
  );
const isApiResponse = (response: Response, path: string) => {
  const url = new URL(response.url());
  return url.origin === new URL(apiUrl).origin && url.pathname === path;
};

async function installFixtures(page: Page, surface: Surface) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const saved = {
    conversationId: `${surface}-followups-saved`,
    title: `${surface} saved authority`,
    provider: surface === 'chat' ? 'lmstudio' : 'codex',
    model: surface === 'chat' ? 'mock-1' : 'gpt-6-luna',
    source: 'REST',
    lastMessageAt: lastUpdateAt,
    archived: false,
    ...(surface === 'agents' ? { agentName: 'coding_agent' } : {}),
    ...(surface === 'flows' ? { flowName: 'echo' } : {}),
    flags: { workingFolder: `/fixtures/saved-${surface}-folder` },
  };
  const flows = [
    { name: 'echo', disabled: false },
    { name: 'review', disabled: false },
    {
      name: 'review',
      disabled: false,
      sourceId,
      sourceLabel: 'Review repository',
    },
  ];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(apiUrl).origin) return route.continue();
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    if (path === '/health') return json({ mongoConnected: true });
    if (path === '/logs') return json({ status: 'ok' });
    if (path === '/chat/providers') {
      return json({
        providers: [
          {
            id: 'lmstudio',
            label: 'LM Studio',
            available: true,
            toolsAvailable: true,
          },
          {
            id: 'codex',
            label: 'OpenAI Codex',
            available: true,
            toolsAvailable: true,
          },
        ],
      });
    }
    if (path === '/chat/models') {
      const provider = url.searchParams.get('provider') ?? 'lmstudio';
      return json({
        provider,
        available: true,
        toolsAvailable: true,
        models:
          provider === 'codex'
            ? [
                { key: 'gpt-6-luna', displayName: 'gpt-6-luna', type: 'codex' },
                {
                  key: 'gpt-6-luna',
                  displayName: 'gpt-6-luna',
                  type: 'codex',
                  endpointId,
                },
                {
                  key: 'gpt-6-luna',
                  displayName: 'gpt-6-luna',
                  type: 'codex',
                  endpointId: 'https://alpha.example/other/v1',
                },
              ]
            : [{ key: 'mock-1', displayName: 'Mock Model 1', type: 'gguf' }],
      });
    }
    if (path === '/agents') {
      return json({
        agents: ['coding_agent', 'review_agent'].map((name) => ({
          name,
          disabled: false,
          requestedProviderId: 'codex',
          executionProviderId: 'codex',
        })),
      });
    }
    if (/^\/agents\/[^/]+\/commands$/.test(path)) {
      return json({
        commands: [
          {
            name: 'build',
            description: 'Build the workspace',
            disabled: false,
            stepCount: 3,
          },
        ],
      });
    }
    if (/^\/agents\/[^/]+\/prompts$/.test(path)) {
      return json({
        prompts: [{ relativePath: 'prompts/review.md', fullPath: promptPath }],
      });
    }
    if (/^\/agents\/[^/]+$/.test(path)) {
      return json({
        agent: {
          name: path.split('/')[2],
          disabled: false,
          warnings: [],
          fallbackCandidates: [],
          requestedProviderId: 'codex',
          executionProviderId: 'codex',
        },
      });
    }
    if (path === '/flows') return json({ flows });
    if (/^\/flows\/[^/]+$/.test(path)) {
      const flow = flows.find(
        (item) =>
          item.name === path.split('/')[2] &&
          (item.sourceId ?? '') === (url.searchParams.get('sourceId') ?? ''),
      );
      return flow
        ? json({ flow: { ...flow, warnings: [] } })
        : json({ error: 'not_found' }, 404);
    }
    if (path === '/conversations' && request.method() === 'GET') {
      // An empty sidebar keeps every initial target genuinely unsaved. Saved
      // selection must use the exact lookup, independently of sidebar paging.
      return json({
        items:
          url.searchParams.get('conversationId') === saved.conversationId
            ? [saved]
            : [],
        nextCursor: null,
      });
    }
    if (
      path === `/conversations/${saved.conversationId}/turns` &&
      request.method() === 'GET'
    ) {
      return json({
        items: [
          {
            turnId: `${saved.conversationId}-answer`,
            conversationId: saved.conversationId,
            role: 'assistant',
            content: 'Saved authoritative answer',
            provider: saved.provider,
            model: saved.model,
            status: 'ok',
            createdAt: firstUpdateAt,
            firstUpdateAt,
            lastUpdateAt,
          },
        ],
        nextCursor: null,
      });
    }
    if (
      /^\/conversations\/[^/]+\/turns$/.test(path) &&
      request.method() === 'GET'
    ) {
      return json({ items: [], nextCursor: null });
    }
    if (path === '/ingest/roots') return json({ roots: [] });
    if (path === '/ingest/dirs') {
      return json({ base: '/fixtures', path: chosenFolder, dirs: [] });
    }
    // Never let an unexpected API call reach a real provider or persistence.
    return json({ error: 'unmocked_followups_request', path }, 404);
  });
  return saved;
}

async function chooseTarget(page: Page, surface: Surface) {
  if (surface === 'agents') {
    await page.getByTestId('agent-select-trigger').click();
    await page
      .getByRole('listbox', { name: 'Agent options' })
      .getByRole('option')
      .filter({ has: page.getByText('review_agent', { exact: true }) })
      .click();
  } else if (surface === 'flows') {
    await page.getByTestId('flow-select-trigger').click();
    await page.getByTestId(`flow-option-review::${sourceId}`).click();
  } else {
    await page.getByTestId('provider-select').click();
    await page
      .getByRole('option', { name: 'OpenAI Codex', exact: true })
      .click();
    await page.getByTestId('model-select').click();
    await page
      .getByRole('option', {
        name: 'gpt-6-luna (alpha.example / target)',
        exact: true,
      })
      .click();
  }
}

async function expectTarget(page: Page, surface: Surface) {
  if (surface === 'agents') {
    await expect(page.getByTestId('agent-select-trigger')).toContainText(
      'review_agent',
    );
  } else if (surface === 'flows') {
    await expect(page.getByTestId('flow-select-trigger')).toContainText(
      'Review repository',
    );
    await page.getByTestId('flow-select-trigger').click();
    await expect(
      page.getByTestId(`flow-option-review::${sourceId}`),
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
  } else {
    await expect(page.getByTestId('provider-select')).toContainText(
      'OpenAI Codex',
    );
    await expect(page.getByTestId('model-select')).toContainText('gpt-6-luna');
    await page.getByTestId('model-select').click();
    // Same model key and hostname exist at two endpoints and natively.
    await expect(
      page.getByRole('option', {
        name: 'gpt-6-luna (alpha.example / target)',
        exact: true,
      }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
  }
}

async function chooseFolder(page: Page, surface: Surface) {
  const dirs = page.waitForResponse((response) =>
    isApiResponse(response, '/ingest/dirs'),
  );
  await folderTrigger(page, surface).click();
  await dirs;
  const dialog = page.getByRole('dialog', { name: 'Choose folder…' });
  await expect(dialog.getByTestId('directory-picker-current-path')).toHaveText(
    chosenFolder,
  );
  await dialog
    .getByRole('button', { name: 'Use this folder', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(folderTrigger(page, surface)).toContainText('chosen-folder');
}

for (const surface of ['chat', 'agents', 'flows'] as const) {
  test(`${surface}: unsaved target URL survives reload and saved conversation overrides conflicting target`, async ({
    page,
    browser,
  }) => {
    const saved = await installFixtures(page, surface);
    await installMockChatWs(page);
    await page.goto(surfaceUrl(surface).toString());
    await chooseTarget(page, surface);
    await expectTarget(page, surface);
    await expect(page).toHaveURL((url) => {
      if (url.searchParams.has('conversationId')) return false;
      if (surface === 'agents') {
        return url.searchParams.get('agentName') === 'review_agent';
      }
      if (surface === 'flows') {
        return (
          url.searchParams.get('flowName') === 'review' &&
          url.searchParams.get('sourceId') === sourceId &&
          [...url.searchParams.keys()].every((key) =>
            ['flowName', 'sourceId'].includes(key),
          )
        );
      }
      return (
        url.searchParams.get('provider') === 'codex' &&
        url.searchParams.get('model') === 'gpt-6-luna' &&
        url.searchParams.get('endpoint') === endpointId
      );
    });
    const targetUrl = page.url();
    await page.reload();
    await expectTarget(page, surface);
    await expect(page).toHaveURL(targetUrl);
    await expect(page.getByTestId('conversation-row')).toHaveCount(0);
    await expect(transcript(page, surface)).not.toContainText(
      'Saved authoritative answer',
    );

    const freshContext = await browser.newContext();
    try {
      const freshPage = await freshContext.newPage();
      await installFixtures(freshPage, surface);
      await installMockChatWs(freshPage);
      await freshPage.goto(targetUrl);
      await expectTarget(freshPage, surface);
      await expect(freshPage).toHaveURL(targetUrl);
    } finally {
      await freshContext.close();
    }

    const conflictUrl = new URL(targetUrl);
    conflictUrl.searchParams.set('conversationId', saved.conversationId);
    const turns = page.waitForResponse((response) =>
      isApiResponse(response, `/conversations/${saved.conversationId}/turns`),
    );
    await page.goto(conflictUrl.toString());
    await turns;
    await expect(transcript(page, surface)).toContainText(
      'Saved authoritative answer',
    );
    await expect(folderTrigger(page, surface)).toContainText(
      `saved-${surface}-folder`,
    );
    if (surface === 'chat') {
      await expect(page.getByTestId('provider-select')).toContainText(
        'LM Studio',
      );
      await expect(page.getByTestId('model-select')).toContainText(
        'Mock Model 1',
      );
    } else if (surface === 'agents') {
      await expect(page.getByTestId('agent-select-trigger')).toContainText(
        'coding_agent',
      );
    } else {
      await expect(page.getByTestId('flow-select-trigger')).toContainText(
        'echo',
      );
      await expect(page.getByTestId('flow-select-trigger')).not.toContainText(
        'Review repository',
      );
    }
  });

  test(`${surface}: New retains the visible folder and selecting a saved thread restores its own folder`, async ({
    page,
  }) => {
    const saved = await installFixtures(page, surface);
    await installMockChatWs(page);
    await page.goto(surfaceUrl(surface).toString());
    await chooseFolder(page, surface);
    await page.getByTestId('conversation-new').click();
    await expect(folderTrigger(page, surface)).toContainText('chosen-folder');
    await expect(page).toHaveURL(
      (url) => !url.searchParams.has('conversationId'),
    );
    if (surface === 'flows') {
      const localTargetUrl = surfaceUrl(surface);
      localTargetUrl.searchParams.set('flowName', 'echo');
      await expect(page).toHaveURL(localTargetUrl.toString());
    }

    const savedUrl = surfaceUrl(surface);
    savedUrl.searchParams.set('conversationId', saved.conversationId);
    const turns = page.waitForResponse((response) =>
      isApiResponse(response, `/conversations/${saved.conversationId}/turns`),
    );
    await page.goto(savedUrl.toString());
    await turns;
    await expect(transcript(page, surface)).toContainText(
      'Saved authoritative answer',
    );
    await expect(folderTrigger(page, surface)).toContainText(
      `saved-${surface}-folder`,
    );
    await page.getByTestId('conversation-new').click();
    await expect(page).toHaveURL(
      (url) => !url.searchParams.has('conversationId'),
    );
    await expect(transcript(page, surface)).not.toContainText(
      'Saved authoritative answer',
    );
    await expect(folderTrigger(page, surface)).toContainText(
      `saved-${surface}-folder`,
    );
  });
}

for (const mode of ['command', 'prompt'] as const) {
  test(`agents: ${mode} selection survives pending/rejected launch and resets only after acceptance`, async ({
    page,
  }) => {
    await installFixtures(page, 'agents');
    await installMockChatWs(page);
    await page.goto(surfaceUrl('agents').toString());
    await chooseFolder(page, 'agents');
    const action = page.getByTestId('agent-command-trigger');
    await action.click();
    await page
      .getByTestId(
        mode === 'command'
          ? 'agent-command-option-build::local'
          : `agent-prompt-option-${promptPath}`,
      )
      .click();
    if (mode === 'command') {
      await page.getByTestId('agent-step-trigger').click();
      await page.getByRole('option', { name: 'Step 2', exact: true }).click();
    }
    const selectedLabel = mode === 'command' ? 'build' : 'prompts/review.md';
    const path =
      mode === 'command'
        ? '/agents/coding_agent/commands/run'
        : '/agents/coding_agent/run';
    const runUrl = new URL(path, apiUrl).toString();
    let release: ((accepted: boolean) => void) | undefined;
    let pendingRoute: Promise<void> = Promise.resolve();
    let primaryFailed = false;
    try {
      for (const accepted of [false, true]) {
        const decision = new Promise<boolean>((resolve) => {
          release = resolve;
        });
        await page.route(runUrl, (route) => {
          pendingRoute = (async () => {
            const body = decodeJsonBody(route.request()) as Record<
              string,
              unknown
            >;
            const accept = await decision;
            if (page.isClosed()) return;
            await route.fulfill({
              status: accept ? 202 : 503,
              contentType: 'application/json',
              body: JSON.stringify(
                accept
                  ? {
                      status: 'started',
                      agentName: 'coding_agent',
                      commandName: 'build',
                      conversationId: body.conversationId,
                      inflightId: body.inflightId ?? 'accepted-followups-run',
                      modelId: 'gpt-6-luna',
                    }
                  : {
                      code: 'TEMPORARILY_UNAVAILABLE',
                      message: 'Followups launch rejected',
                    },
              ),
            });
          })();
          return pendingRoute;
        });
        const [request] = await Promise.all([
          page.waitForRequest(
            (candidate) =>
              candidate.url() === runUrl && candidate.method() === 'POST',
          ),
          page.getByTestId('agent-send').click(),
        ]);
        const body = decodeJsonBody(request) as Record<string, unknown>;
        expect(body.working_folder).toBe(chosenFolder);
        if (mode === 'command') {
          expect(body.commandName).toBe('build');
          expect(body.startStep).toBe(2);
          // A command's launch row belongs to the server, even while pending.
          await expect(
            page.locator('[data-testid="chat-bubble"][data-role="user"]'),
          ).toHaveCount(0);
          await expect(page.getByTestId('agent-step-trigger')).toContainText(
            'Step 2',
          );
        } else {
          expect(body.instruction).toEqual(expect.stringContaining(promptPath));
        }
        await expect(action).toContainText(selectedLabel);
        const response = page.waitForResponse(
          (candidate) =>
            isApiResponse(candidate, path) &&
            candidate.request().method() === 'POST',
        );
        release!(accepted);
        await response;
        if (!accepted) {
          await expect(page.getByTestId('agents-run-error')).toContainText(
            'Followups launch rejected',
          );
          await expect(action).toContainText(selectedLabel);
          if (mode === 'command') {
            await expect(page.getByTestId('agent-step-trigger')).toContainText(
              'Step 2',
            );
          }
          await expect(page.getByTestId('agent-send')).toBeEnabled();
        } else {
          await expect(action).toContainText('Write instruction');
          await expect(page.getByTestId('agent-input')).toBeEnabled();
          await expect(page.getByTestId('agent-step-trigger')).toBeDisabled();
          await expect(folderTrigger(page, 'agents')).toContainText(
            'chosen-folder',
          );
          if (mode === 'command') {
            await expect(
              page.locator('[data-testid="chat-bubble"][data-role="user"]'),
            ).toHaveCount(0);
          }
        }
        await pendingRoute;
        await page.unroute(runUrl);
      }
    } catch (error) {
      primaryFailed = true;
      throw error;
    } finally {
      release?.(false);
      const cleanupResults = await Promise.allSettled([
        pendingRoute,
        page.isClosed()
          ? Promise.resolve()
          : page.unrouteAll({ behavior: 'wait' }),
      ]);
      if (!primaryFailed) {
        for (const result of cleanupResults) {
          if (result.status === 'rejected') throw result.reason;
        }
      }
    }
  });
}

test('agents: canonical turn_persisted enables Fork from here on a live answer without navigation or history refresh', async ({
  page,
}) => {
  const saved = await installFixtures(page, 'agents');
  const conversationId = saved.conversationId;
  let inflightId = 'followups-live-run';
  const turnId = 'canonical-live-assistant-turn';
  let socket: WebSocketRoute | undefined;
  const subscriptions = new Set<string>();
  // The shared mock has no metadata-only turn_persisted sender yet. Keep this
  // one socket local to the page rather than changing the shared fixture.
  await page.routeWebSocket('**/ws', (ws) => {
    socket = ws;
    ws.onMessage((message) => {
      const event = JSON.parse(message.toString()) as {
        type: string;
        conversationId?: string;
      };
      if (event.type === 'subscribe_conversation' && event.conversationId) {
        subscriptions.add(event.conversationId);
      }
    });
  });
  let historyReads = 0;
  await page.route(
    new URL(`/conversations/${conversationId}/turns`, apiUrl).toString(),
    (route) => {
      historyReads += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null }),
      });
    },
  );
  await page.route(
    new URL('/agents/coding_agent/run', apiUrl).toString(),
    (route) => {
      const body = decodeJsonBody(route.request()) as Record<string, unknown>;
      if (typeof body.inflightId === 'string') inflightId = body.inflightId;
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'started',
          agentName: 'coding_agent',
          conversationId,
          inflightId,
          modelId: 'gpt-6-luna',
        }),
      });
    },
  );
  const optionsPath = `/agents/conversations/${conversationId}/fork-options`;
  await page.route(`${new URL(optionsPath, apiUrl)}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sourceTurnId: turnId,
        sourceTitle: saved.title,
        sourceAgentName: 'coding_agent',
        estimated: false,
        agents: [{ name: 'coding_agent', sameAgent: true }],
      }),
    }),
  );
  const url = surfaceUrl('agents');
  url.searchParams.set('conversationId', conversationId);
  const history = page.waitForResponse((response) =>
    isApiResponse(response, `/conversations/${conversationId}/turns`),
  );
  await page.goto(url.toString());
  await history;
  await expect
    .poll(() => subscriptions.has(conversationId), {
      timeout: resolveConfiguredE2eTimeoutMs(5000),
      message: 'Live source conversation subscribed',
    })
    .toBe(true);
  await page.getByTestId('agent-input').fill('Produce a live forkable answer');
  const accepted = page.waitForResponse((response) =>
    isApiResponse(response, '/agents/coding_agent/run'),
  );
  await page.getByTestId('agent-send').click();
  await accepted;
  const send = (event: Record<string, unknown>) =>
    socket!.send(
      JSON.stringify({
        protocolVersion: 'v1',
        conversationId,
        inflightId,
        ...event,
      }),
    );
  send({
    type: 'user_turn',
    seq: 1,
    content: 'Produce a live forkable answer',
    createdAt: firstUpdateAt,
  });
  send({
    type: 'assistant_delta',
    seq: 2,
    delta: 'Fresh live answer',
    firstUpdateAt,
  });
  const answer = page
    .locator('[data-testid="chat-bubble"][data-role="assistant"]')
    .filter({ hasText: 'Fresh live answer' });
  await expect(answer).toBeVisible();
  send({
    type: 'turn_final',
    seq: 3,
    status: 'ok',
    threadId: 'provider-live-thread',
    firstUpdateAt,
    lastUpdateAt,
  });
  await expect(answer.getByTestId('status-chip')).toContainText('Complete');
  await expect(
    answer.getByRole('button', { name: /Fork from here/i }),
  ).toHaveCount(0);
  const readsBeforePersistence = historyReads;
  // Deliberately no content/status in this envelope: the existing answer must
  // gain its canonical ID without replacing its text or requiring a reload.
  send({ type: 'turn_persisted', seq: 4, turnId, firstUpdateAt, lastUpdateAt });
  await expect(
    answer.getByRole('button', { name: /Fork from here/i }),
  ).toBeVisible();
  await expect(answer).toContainText('Fresh live answer');
  await expect(page).toHaveURL(url.toString());
  expect(historyReads).toBe(readsBeforePersistence);
  const options = page.waitForResponse((response) =>
    isApiResponse(response, optionsPath),
  );
  await answer.getByRole('button', { name: /Fork from here/i }).click();
  expect(new URL((await options).url()).searchParams.get('sourceTurnId')).toBe(
    turnId,
  );
  const dialog = page.getByRole('dialog', {
    name: 'Fork conversation',
    exact: true,
  });
  await expect(
    dialog.getByRole('combobox', { name: 'Target agent' }),
  ).toHaveValue('coding_agent (Same agent)');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
});
