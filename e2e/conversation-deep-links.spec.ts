import {
  expect,
  test,
  type Page,
  type Response,
  type Route,
} from '@playwright/test';
import { installMockChatWs, type MockChatWsServer } from './support/mockChatWs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001';
const apiUrl = process.env.E2E_API_URL ?? 'http://host.docker.internal:6010';

type Surface = 'chat' | 'agents' | 'flows';
type SavedConversation = {
  conversationId: string;
  title: string;
  provider: string;
  model: string;
  source: 'REST';
  lastMessageAt: string;
  archived: boolean;
  agentName?: string;
  flowName?: string;
  flags: {
    workingFolder: string;
    flow?: { sourceId: string; flowDefinitionRoot: string };
  };
};

const sourceId = '/fixtures/saved-repository';
const flowSources = [
  { name: 'echo', disabled: false },
  { name: 'review', disabled: false },
  {
    name: 'review',
    disabled: false,
    sourceId,
    sourceLabel: 'Saved repository',
  },
];

const conversationUrl = (surface: Surface, conversationId?: string) => {
  const url = new URL(`/${surface}`, baseUrl);
  if (conversationId) url.searchParams.set('conversationId', conversationId);
  return url.toString();
};

const transcript = (page: Page, surface: Surface) =>
  page.getByTestId(
    surface === 'flows' ? 'flows-transcript' : 'chat-transcript',
  );

const replyFor = (conversation: SavedConversation) =>
  `Saved answer for ${conversation.conversationId}`;

const workingFolderTrigger = (page: Page, surface: Surface) =>
  page.getByTestId(
    surface === 'agents'
      ? 'agent-working-path-trigger'
      : `${surface === 'flows' ? 'flow' : 'chat'}-working-folder-trigger`,
  );

async function installConversationFixtures(
  page: Page,
  surface: Surface,
  live = false,
) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const ws = await installMockChatWs(page);
  const makeConversation = (
    letter: 'a' | 'b' | 'target',
  ): SavedConversation => ({
    conversationId: `${surface}-deep-link-${letter}`,
    title: `${surface} saved ${letter.toUpperCase()}`,
    provider: surface === 'chat' && letter === 'b' ? 'lmstudio' : 'codex',
    model: surface === 'chat' && letter === 'b' ? 'mock-1' : 'gpt-6-luna',
    source: 'REST',
    // B is the default first row on surfaces that auto-select their newest run.
    lastMessageAt:
      letter === 'b' ? '2025-01-02T00:00:00.000Z' : '2025-01-01T00:00:00.000Z',
    archived: letter === 'target' && surface !== 'chat',
    ...(surface === 'agents'
      ? { agentName: letter === 'target' ? 'review_agent' : 'coding_agent' }
      : {}),
    ...(surface === 'flows'
      ? { flowName: letter === 'target' ? 'review' : 'echo' }
      : {}),
    flags: {
      workingFolder: `/fixtures/work-${surface}-${letter}`,
      ...(surface === 'flows' && letter === 'target'
        ? { flow: { sourceId, flowDefinitionRoot: `${sourceId}/flows` } }
        : {}),
    },
  });
  const a = makeConversation('a');
  const b = makeConversation('b');
  const target = makeConversation('target');
  const conversations = [a, b, target];

  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(apiUrl).origin) return route.continue();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    const path = url.pathname;

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
            ? [{ key: 'gpt-6-luna', displayName: 'gpt-6-luna', type: 'codex' }]
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
    if (/^\/agents\/[^/]+\/commands$/.test(path)) return json({ commands: [] });
    if (/^\/agents\/[^/]+\/prompts$/.test(path)) return json({ prompts: [] });
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
    if (path === '/flows') return json({ flows: flowSources });
    if (/^\/flows\/[^/]+$/.test(path)) {
      const flow = flowSources.find(
        (item) =>
          item.name === path.split('/')[2] &&
          (item.sourceId ?? '') === (url.searchParams.get('sourceId') ?? ''),
      );
      return flow
        ? json({ flow: { ...flow, warnings: [] } })
        : json({ error: 'not_found' }, 404);
    }
    if (path === '/conversations' && request.method() === 'GET') {
      const id = url.searchParams.get('conversationId');
      if (id) {
        // The exact lookup has the existing list shape and must include archives.
        return json({
          items:
            url.searchParams.get('state') === 'all'
              ? conversations.filter((item) => item.conversationId === id)
              : [],
          nextCursor: null,
        });
      }
      const agentName = url.searchParams.get('agentName');
      const flowName = url.searchParams.get('flowName');
      const matches = (filter: string | null, value?: string) =>
        !filter || (filter === '__none__' ? !value : filter === value);
      // Target is deliberately unavailable from every sidebar page, even state=all.
      return json({
        items: [b, a].filter(
          (item) =>
            matches(agentName, item.agentName) &&
            matches(flowName, item.flowName),
        ),
        nextCursor: 'older-conversations',
      });
    }
    const turnsMatch = path.match(/^\/conversations\/([^/]+)\/turns$/);
    if (turnsMatch && request.method() === 'GET') {
      const saved = conversations.find(
        (item) => item.conversationId === turnsMatch[1],
      );
      if (!saved) return json({ items: [], nextCursor: null });
      return json({
        items: ['user', 'assistant'].map((role, index) => ({
          turnId: `${saved.conversationId}-${role}`,
          conversationId: saved.conversationId,
          role,
          content:
            role === 'assistant'
              ? replyFor(saved)
              : `Saved question for ${saved.conversationId}`,
          provider: saved.provider,
          model: saved.model,
          status: 'ok',
          createdAt: `2025-01-01T00:00:0${index}.000Z`,
        })),
        nextCursor: null,
        ...(live && saved.conversationId === a.conversationId
          ? {
              inflight: {
                inflightId: 'deep-link-live-run',
                assistantText: 'Live answer held open',
                assistantThink: '',
                toolEvents: [],
                startedAt: '2025-01-03T00:00:00.000Z',
                seq: 0,
              },
            }
          : {}),
      });
    }
    if (path === '/ingest/roots') return json({ roots: [] });
    if (path === '/ingest/dirs') {
      return json({ base: '/fixtures', path: '/fixtures', dirs: [] });
    }
    // Keep unconfigured requests local; no real provider execution or persistence.
    return json({ error: 'unmocked_deep_link_request', path }, 404);
  });

  return { a, b, target, ws };
}

function isConversationGet(response: Response, path: string) {
  const url = new URL(response.url());
  return (
    url.origin === new URL(apiUrl).origin &&
    url.pathname === path &&
    response.request().method() === 'GET' &&
    response.status() === 200
  );
}

async function restoreSelection(
  page: Page,
  ws: MockChatWsServer,
  saved: SavedConversation,
  action: () => Promise<unknown>,
  exactLookup = false,
) {
  // Register every observer before the navigation or click that can satisfy it.
  const turns = page.waitForResponse((response) =>
    isConversationGet(response, `/conversations/${saved.conversationId}/turns`),
  );
  const lookup = exactLookup
    ? page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          isConversationGet(response, '/conversations') &&
          url.searchParams.get('conversationId') === saved.conversationId &&
          url.searchParams.get('state') === 'all'
        );
      })
    : Promise.resolve();
  await Promise.all([
    turns,
    lookup,
    ws.waitForConversationSubscription(saved.conversationId),
    action(),
  ]);
}

async function expectSelection(
  page: Page,
  surface: Surface,
  saved: SavedConversation,
) {
  await expect(page).toHaveURL(conversationUrl(surface, saved.conversationId));
  await expect(transcript(page, surface)).toContainText(replyFor(saved));
  await expect(workingFolderTrigger(page, surface)).toContainText(
    saved.flags.workingFolder.split('/').at(-1)!,
  );
  if (surface === 'chat') {
    await expect(page.getByTestId('provider-select')).toContainText(
      saved.provider === 'codex' ? 'OpenAI Codex' : 'LM Studio',
    );
    await expect(page.getByTestId('model-select')).toContainText(
      saved.provider === 'codex' ? 'gpt-6-luna' : 'Mock Model 1',
    );
  } else if (surface === 'agents') {
    await expect(page.getByTestId('agent-select-trigger')).toContainText(
      saved.agentName!,
    );
  } else {
    await expect(page.getByTestId('flow-select-trigger')).toContainText(
      saved.flowName!,
    );
    await expect(page.getByTestId('flow-launch-title')).toContainText(
      saved.title,
    );
    if (saved.flags.flow) {
      // Same flow name exists locally: the saved repository must disambiguate it.
      await expect(page.getByTestId('flow-select-trigger')).toContainText(
        'Saved repository',
      );
    }
  }
}

for (const surface of ['chat', 'agents', 'flows'] as const) {
  test(`${surface}: sidebar selections push URLs; Back/Forward restore A/B; New clears selection and draft`, async ({
    page,
  }) => {
    const { a, b, ws } = await installConversationFixtures(page, surface);
    await page.goto(conversationUrl(surface));
    const row = (saved: SavedConversation) =>
      page.getByTestId('conversation-row').filter({ hasText: saved.title });

    await restoreSelection(page, ws, a, () => row(a).click());
    await expectSelection(page, surface, a);
    await restoreSelection(page, ws, b, () => row(b).click());
    await expectSelection(page, surface, b);
    await expect(transcript(page, surface)).not.toContainText(replyFor(a));

    await restoreSelection(page, ws, a, () => page.goBack());
    await expectSelection(page, surface, a);
    await expect(transcript(page, surface)).not.toContainText(replyFor(b));
    await restoreSelection(page, ws, b, () => page.goForward());
    await expectSelection(page, surface, b);

    if (surface !== 'flows') {
      await page
        .getByTestId(surface === 'chat' ? 'chat-input' : 'agent-input')
        .fill('Unsent draft');
    }
    await page.getByTestId('conversation-new').click();
    await expect(page).toHaveURL(conversationUrl(surface));
    await expect(transcript(page, surface)).not.toContainText(replyFor(a));
    await expect(transcript(page, surface)).not.toContainText(replyFor(b));
    await expect(workingFolderTrigger(page, surface)).toContainText(
      'Select folder',
    );
    if (surface === 'flows') {
      await expect(page.getByTestId('flow-select-trigger')).toContainText(
        'echo',
      );
      await expect(page.getByTestId('flow-launch-title')).toHaveText('echo');
    } else {
      await expect(
        page.getByTestId(surface === 'chat' ? 'chat-input' : 'agent-input'),
      ).toHaveValue('');
    }
  });

  test(`${surface}: ${surface === 'chat' ? 'paged-out' : 'archived'} deep link restores saved context on direct opening, reload and a fresh browser context`, async ({
    page,
    browser,
  }) => {
    const { target, ws } = await installConversationFixtures(page, surface);
    const url = conversationUrl(surface, target.conversationId);
    await restoreSelection(page, ws, target, () => page.goto(url), true);
    await expectSelection(page, surface, target);
    await restoreSelection(page, ws, target, () => page.reload(), true);
    await expectSelection(page, surface, target);

    // A separate context has no shared session/local storage or in-memory selection.
    const freshContext = await browser.newContext();
    try {
      const freshPage = await freshContext.newPage();
      const fresh = await installConversationFixtures(freshPage, surface);
      await restoreSelection(
        freshPage,
        fresh.ws,
        fresh.target,
        () => freshPage.goto(url),
        true,
      );
      await expectSelection(freshPage, surface, fresh.target);
    } finally {
      await freshContext.close();
    }
  });
}

test('chat: history navigation away from a live deep link preserves the run and restores its snapshot', async ({
  page,
}) => {
  const { a, b, ws } = await installConversationFixtures(page, 'chat', true);
  await restoreSelection(
    page,
    ws,
    a,
    () => page.goto(conversationUrl('chat', a.conversationId)),
    true,
  );
  await expectSelection(page, 'chat', a);
  await expect(transcript(page, 'chat')).toContainText('Live answer held open');

  await restoreSelection(page, ws, b, () =>
    page.getByTestId('conversation-row').filter({ hasText: b.title }).click(),
  );
  await expectSelection(page, 'chat', b);
  await restoreSelection(page, ws, a, () => page.goBack());
  await expectSelection(page, 'chat', a);
  await expect(transcript(page, 'chat')).toContainText('Live answer held open');
  // The run remains deterministically open until this test sends its final frame.
  expect(ws.getLastCancel()).toBeNull();
  await ws.sendInflightSnapshot({
    conversationId: a.conversationId,
    inflightId: 'deep-link-live-run',
    assistantText: 'Live answer held open',
  });
  await ws.sendAssistantDelta({
    conversationId: a.conversationId,
    inflightId: 'deep-link-live-run',
    delta: ' and completed after Back',
  });
  await ws.sendFinal({
    conversationId: a.conversationId,
    inflightId: 'deep-link-live-run',
  });
  await expect(transcript(page, 'chat')).toContainText(
    'Live answer held open and completed after Back',
  );
  expect(ws.getLastCancel()).toBeNull();
});
