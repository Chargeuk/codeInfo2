import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { ConversationApiSummary } from '../api/conversations';
import type { FlowSummary } from '../api/flows';
import { formatBubbleTimestamp } from '../components/chat/chatTranscriptFormatting';
import { decodeJsonBody } from './support/decodeJsonBody';
import { mockJsonResponse } from './support/fetchMock';
import { setupChatWsHarness } from './support/mockChatWs';
import { resolveClientTestTimeoutMs } from './support/testTimeouts';

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = global.fetch;
const { default: App } = await import('../App');
const { default: FlowsPage } = await import('../pages/FlowsPage');

beforeEach(() => {
  setScopedTestEnvValue('MODE', 'test');
  global.fetch = mockFetch;
  mockFetch.mockReset();
  globalThis.__wsMock?.reset();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  global.fetch = originalFetch;
});

const a: ConversationApiSummary = {
  conversationId: 'a',
  title: 'Flow A',
  provider: 'codex',
  model: 'saved-model',
  flowName: 'daily',
  lastMessageAt: '2026-01-01T00:00:00.000Z',
  flags: { flow: { stepPath: [1] } },
};
const b: ConversationApiSummary = {
  ...a,
  conversationId: 'b',
  title: 'Flow B',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function started(conversationId: string) {
  return mockJsonResponse(
    {
      status: 'started',
      flowName: 'daily',
      conversationId,
      inflightId: `run-${conversationId}`,
      providerId: 'codex',
      modelId: 'accepted-model',
    },
    { status: 202 },
  );
}

function setup(
  options: {
    initialEntries?: string[];
    items?: ConversationApiSummary[];
    flows?: FlowSummary[];
    flowsResponse?: Promise<Response>;
    conversationsList?: (
      flowName: string | null,
    ) => Response | Promise<Response>;
    details?: (
      flowName: string,
      sourceId: string | null,
    ) => Response | Promise<Response>;
    lookup?: (id: string) => Response | Promise<Response>;
    turns?: (id: string) => Response | Promise<Response>;
    run?: (body: Record<string, unknown>) => Response | Promise<Response>;
  } = {},
) {
  const sidebar = { items: options.items ?? [a, b], nextCursor: null };
  const harness = setupChatWsHarness({ mockFetch, conversations: sidebar });
  const baseFetch = mockFetch.getMockImplementation()!;
  const lookupIds: string[] = [];
  const turnsIds: string[] = [];
  const runBodies: Record<string, unknown>[] = [];
  const runAccepted = deferred<void>();
  mockFetch.mockImplementation((input, init) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === '/flows') {
      return (
        options.flowsResponse ??
        Promise.resolve(
          mockJsonResponse({
            flows: options.flows ?? [{ name: 'daily', disabled: false }],
          }),
        )
      );
    }
    const flow = url.pathname.match(/^\/flows\/([^/]+)(\/run)?$/);
    if (flow) {
      if (flow[2]) {
        const body = decodeJsonBody(init!) as Record<string, unknown>;
        runBodies.push(body);
        runAccepted.resolve();
        return Promise.resolve(
          options.run?.(body) ?? started(String(body.conversationId)),
        );
      }
      if (options.details) {
        return Promise.resolve(
          options.details(
            decodeURIComponent(flow[1]),
            url.searchParams.get('sourceId'),
          ),
        );
      }
      return Promise.resolve(
        mockJsonResponse({
          flow: {
            name: decodeURIComponent(flow[1]),
            sourceId: url.searchParams.get('sourceId') ?? undefined,
            disabled: false,
            warnings: [],
          },
        }),
      );
    }
    if (
      url.pathname === '/conversations' &&
      url.searchParams.has('conversationId')
    ) {
      const id = url.searchParams.get('conversationId')!;
      lookupIds.push(id);
      return Promise.resolve(
        options.lookup?.(id) ??
          mockJsonResponse({
            items: sidebar.items.filter((item) => item.conversationId === id),
          }),
      );
    }
    if (url.searchParams.has('ancestorConversationId')) {
      return Promise.resolve(mockJsonResponse({ items: [] }));
    }
    const turns = url.pathname.match(/^\/conversations\/([^/]+)\/turns$/);
    if (turns) {
      const id = decodeURIComponent(turns[1]);
      turnsIds.push(id);
      return Promise.resolve(
        options.turns?.(id) ??
          mockJsonResponse({
            items: [
              {
                conversationId: id,
                turnId: `turn-${id}`,
                role: 'assistant',
                content: `Transcript ${id}`,
                provider: 'codex',
                model: 'saved-model',
                status: 'ok',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          }),
      );
    }
    if (url.pathname === '/conversations' && options.conversationsList) {
      return Promise.resolve(
        options.conversationsList(url.searchParams.get('flowName')),
      );
    }
    return baseFetch(input, init);
  });
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <App />,
        children: [
          { path: 'flows', element: <FlowsPage /> },
          { path: 'before', element: <div>Before Flows</div> },
        ],
      },
    ],
    { initialEntries: options.initialEntries ?? ['/flows'] },
  );
  const view = render(<RouterProvider router={router} />);
  return {
    ...harness,
    unmount: view.unmount,
    router,
    sidebar,
    lookupIds,
    turnsIds,
    runBodies,
    runAccepted,
  };
}

async function select(title: string) {
  const row = (await screen.findAllByTestId('conversation-row')).find((item) =>
    within(item).queryByText(title),
  );
  if (!row) throw new Error(`Missing row ${title}`);
  await userEvent.click(row);
}

async function run() {
  const button = await screen.findByTestId('flow-run');
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}

function sentMessages() {
  return globalThis.__wsMock!.instances.flatMap((socket) =>
    socket.sent.map((entry) => JSON.parse(entry) as Record<string, unknown>),
  );
}

describe('Flows URL selection', () => {
  it.each([undefined, '/repo with spaces'])(
    'restores an explicit draft source %s after a delayed catalog and refresh without selecting saved history',
    async (sourceId) => {
      const catalog = deferred<Response>();
      const query = new URLSearchParams({ flowName: 'daily', keep: 'yes' });
      if (sourceId) query.set('sourceId', sourceId);
      const url = `/flows?${query}`;
      const flows = [
        { name: 'other' },
        { name: 'daily' },
        { name: 'daily', sourceId: '/repo with spaces' },
      ];
      const first = setup({
        initialEntries: [url],
        flowsResponse: catalog.promise,
      });
      try {
        expect(await screen.findByTestId('flow-run')).toBeDisabled();
        await act(async () => {
          catalog.resolve(mockJsonResponse({ flows }));
        });
        await screen.findAllByTestId('conversation-row');
        await waitFor(() =>
          expect(screen.getByTestId('flow-run')).toBeEnabled(),
        );
        expect(screen.getByTestId('flow-select')).toHaveValue(
          `daily::${sourceId ?? 'local'}`,
        );
        expect(first.router.state.location.search).toBe(`?${query}`);
        expect(first.turnsIds).toHaveLength(0);
        first.unmount();
        const refreshed = setup({ initialEntries: [url], flows });
        await screen.findAllByTestId('conversation-row');
        await waitFor(() =>
          expect(screen.getByTestId('flow-run')).toBeEnabled(),
        );
        expect(screen.getByTestId('flow-select')).toHaveValue(
          `daily::${sourceId ?? 'local'}`,
        );
        expect(refreshed.turnsIds).toHaveLength(0);
        await run();
        await refreshed.runAccepted.promise;
        expect(refreshed.runBodies[0].sourceId).toBe(sourceId);
        await waitFor(() =>
          expect(
            new URLSearchParams(refreshed.router.state.location.search).get(
              'conversationId',
            ),
          ).toBe(refreshed.runBodies[0].conversationId),
        );
        expect(refreshed.router.state.historyAction).toBe('REPLACE');
        const acceptedQuery = new URLSearchParams(
          refreshed.router.state.location.search,
        );
        expect(acceptedQuery.get('keep')).toBe('yes');
        expect(acceptedQuery.get('flowName')).toBe('daily');
        expect(acceptedQuery.get('sourceId')).toBe(sourceId ?? null);
      } finally {
        await act(async () => {
          catalog.resolve(mockJsonResponse({ flows }));
        });
      }
    },
  );

  it('restores the default flow on Back to a bare draft and the chosen flow on Forward', async () => {
    const { router, turnsIds } = setup({
      initialEntries: ['/flows'],
      items: [],
      flows: [{ name: 'daily' }, { name: 'weekly' }],
    });
    await waitFor(() => expect(screen.getByTestId('flow-run')).toBeEnabled());
    expect(screen.getByTestId('flow-select')).toHaveValue('daily::local');
    expect(router.state.location.search).toBe('');
    const defaultKey = router.state.location.key;
    fireEvent.change(screen.getByTestId('flow-working-folder'), {
      target: { value: '/visible-folder' },
    });
    fireEvent.change(screen.getByTestId('flow-select'), {
      target: { value: 'weekly::local' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-select')).toHaveValue('weekly::local'),
    );
    expect(router.state.location.search).toBe('?flowName=weekly');
    expect(router.state.historyAction).toBe('PUSH');
    const chosenKey = router.state.location.key;
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-select-trigger')).toHaveTextContent(
        'daily',
      ),
    );
    expect(screen.getByTestId('flow-select')).toHaveValue('daily::local');
    expect(router.state.location.search).toBe('');
    expect(router.state.location.key).toBe(defaultKey);
    expect(screen.getByTestId('flow-run')).toBeEnabled();
    await act(async () => {
      await router.navigate(1);
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-select')).toHaveValue('weekly::local'),
    );
    expect(router.state.location.search).toBe('?flowName=weekly');
    expect(router.state.location.key).toBe(chosenKey);
    await userEvent.click(screen.getByTestId('flow-new'));
    expect(screen.getByTestId('flow-select')).toHaveValue('weekly::local');
    expect(screen.getByTestId('flow-working-folder')).toHaveValue(
      '/visible-folder',
    );
    expect(router.state.location.key).toBe(chosenKey);
    expect(turnsIds).toHaveLength(0);
  });

  it.each([
    { target: 'weekly', label: 'weekly' },
    { target: 'missing', label: 'Select flow' },
  ])(
    'preserves the explicit $target target after Back and Forward',
    async ({ target, label }) => {
      const { router, turnsIds } = setup({
        initialEntries: ['/flows', `/flows?flowName=${target}`],
        items: [],
        flows: [{ name: 'daily' }, { name: 'weekly', disabled: true }],
      });
      await waitFor(() =>
        expect(screen.getByTestId('flow-select-trigger')).toBeEnabled(),
      );
      expect(screen.getByTestId('flow-select-trigger')).toHaveTextContent(
        label,
      );
      expect(screen.getByTestId('flow-run')).toBeDisabled();
      await act(async () => {
        await router.navigate(-1);
      });
      await waitFor(() =>
        expect(screen.getByTestId('flow-select-trigger')).toHaveTextContent(
          'daily',
        ),
      );
      expect(screen.getByTestId('flow-run')).toBeEnabled();
      await act(async () => {
        await router.navigate(1);
      });
      await waitFor(() =>
        expect(screen.getByTestId('flow-select-trigger')).toHaveTextContent(
          label,
        ),
      );
      expect(screen.getByTestId('flow-run')).toBeDisabled();
      expect(router.state.location.search).toBe(`?flowName=${target}`);
      expect(turnsIds).toHaveLength(0);
    },
  );

  it('pushes source changes, preserves the visible folder, and restores draft identity through Back and Forward', async () => {
    const { router, turnsIds } = setup({
      initialEntries: ['/flows?flowName=daily&sourceId=%2Frepo-a&keep=yes'],
      flows: [
        { name: 'daily', sourceId: '/repo-a' },
        { name: 'daily', sourceId: '/repo-b' },
        { name: 'daily' },
      ],
    });
    await screen.findAllByTestId('conversation-row');
    await waitFor(() => expect(screen.getByTestId('flow-run')).toBeEnabled());
    fireEvent.change(screen.getByTestId('flow-working-folder'), {
      target: { value: '/visible-folder' },
    });
    fireEvent.change(screen.getByTestId('flow-custom-title'), {
      target: { value: 'Draft title' },
    });
    const originalKey = router.state.location.key;
    fireEvent.change(screen.getByTestId('flow-select'), {
      target: { value: 'daily::/repo-a' },
    });
    expect(router.state.location.key).toBe(originalKey);
    expect(screen.getByTestId('flow-custom-title')).toHaveValue('Draft title');
    fireEvent.change(screen.getByTestId('flow-select'), {
      target: { value: 'daily::/repo-b' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-select')).toHaveValue('daily::/repo-b'),
    );
    expect(router.state.historyAction).toBe('PUSH');
    expect(router.state.location.search).toBe(
      '?flowName=daily&sourceId=%2Frepo-b&keep=yes',
    );
    expect(screen.getByTestId('flow-custom-title')).toHaveValue('');
    expect(screen.getByTestId('flow-working-folder')).toHaveValue(
      '/visible-folder',
    );
    const sourceBKey = router.state.location.key;
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-select')).toHaveValue('daily::/repo-a'),
    );
    expect(router.state.location.key).toBe(originalKey);
    await act(async () => {
      await router.navigate(1);
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-select')).toHaveValue('daily::/repo-b'),
    );
    expect(router.state.location.key).toBe(sourceBKey);
    expect(screen.getByTestId('flow-working-folder')).toHaveValue(
      '/visible-folder',
    );
    expect(turnsIds).toHaveLength(0);
    fireEvent.change(screen.getByTestId('flow-select'), {
      target: { value: 'daily::local' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-select')).toHaveValue('daily::local'),
    );
    expect(router.state.location.search).toBe('?flowName=daily&keep=yes');
    expect(screen.getByTestId('flow-working-folder')).toHaveValue(
      '/visible-folder',
    );
  });

  it('keeps an unavailable explicit source unresolved instead of falling back to the local flow or saved history', async () => {
    const { router, turnsIds, runBodies } = setup({
      initialEntries: ['/flows?flowName=daily&sourceId=%2Fmissing&keep=yes'],
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-select-trigger')).toBeEnabled(),
    );
    expect(screen.getByTestId('flow-select-trigger')).toHaveTextContent(
      'Select flow',
    );
    expect(screen.getByTestId('flow-run')).toBeDisabled();
    expect(turnsIds).toHaveLength(0);
    expect(runBodies).toHaveLength(0);
    expect(router.state.location.search).toBe(
      '?flowName=daily&sourceId=%2Fmissing&keep=yes',
    );
  });

  it('forwards a post-final persistence receipt without restarting the run or locking the folder', async () => {
    setup({
      initialEntries: ['/flows?conversationId=a'],
      turns: () => mockJsonResponse({ items: [] }),
    });
    await waitFor(() => expect(screen.getByTestId('flow-run')).toBeEnabled());
    await waitFor(() =>
      expect(sentMessages()).toContainEqual(
        expect.objectContaining({
          type: 'subscribe_conversation',
          conversationId: 'a',
        }),
      ),
    );
    const socket = globalThis.__wsMock!.last()!;
    act(() => {
      socket._receive({
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId: 'a',
        seq: 1,
        inflight: {
          inflightId: 'receipt-run',
          assistantText: 'Receipt response',
          assistantThink: '',
          toolEvents: [],
          startedAt: '2026-01-01T00:00:00.000Z',
          seq: 1,
        },
      });
    });
    await screen.findByText('Receipt response');
    act(() => {
      socket._receive({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId: 'a',
        inflightId: 'receipt-run',
        seq: 2,
        status: 'ok',
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-working-folder')).toBeEnabled(),
    );
    const firstUpdateAt = '2026-01-01T00:00:01.000Z';
    const lastUpdateAt = '2026-01-01T00:00:03.000Z';
    const receipt = {
      protocolVersion: 'v1',
      type: 'turn_persisted',
      conversationId: 'a',
      inflightId: 'receipt-run',
      turnId: 'receipt-turn',
      seq: 3,
      firstUpdateAt,
      lastUpdateAt,
    };
    await userEvent.click(screen.getByTestId('bubble-info'));
    const info = await screen.findByTestId('bubble-info-popover');
    act(() => {
      socket._receive({ ...receipt, conversationId: 'b' });
    });
    expect(
      within(info).queryByTestId('bubble-info-first-update'),
    ).not.toBeInTheDocument();
    act(() => {
      socket._receive(receipt);
    });
    expect(
      await within(info).findByTestId('bubble-info-first-update'),
    ).toHaveTextContent(formatBubbleTimestamp(firstUpdateAt)!);
    expect(
      within(info).getByTestId('bubble-info-last-update'),
    ).toHaveTextContent(formatBubbleTimestamp(lastUpdateAt)!);
    expect(screen.getAllByText('Receipt response')).toHaveLength(1);
    expect(screen.getByTestId('flow-run')).toBeEnabled();
    expect(screen.getByTestId('flow-working-folder')).toBeEnabled();
    expect(screen.queryByTestId('flow-stop')).not.toBeInTheDocument();
  });

  it(
    'resolves an archived target outside the sidebar and restores saved source, title, folder and resume context without waiting for turns',
    async () => {
      const lookup = deferred<Response>();
      const transcript = deferred<Response>();
      const saved = {
        ...a,
        conversationId: 'old',
        title: 'Archived saved flow',
        archived: true,
        flags: {
          workingFolder: '/repo',
          flow: {
            sourceId: '/repo',
            flowDefinitionRoot: '/repo/flows',
            stepPath: [2, 1],
          },
        },
      };
      const { router, runBodies, runAccepted, turnsIds, lookupIds } = setup({
        initialEntries: [
          '/flows?conversationId=old&flowName=other&sourceId=%2Fwrong&keep=yes',
        ],
        items: [b],
        flows: [
          { name: 'daily' },
          { name: 'daily', sourceId: '/repo', sourceLabel: 'Saved repository' },
        ],
        lookup: () => lookup.promise,
        turns: () => transcript.promise,
      });
      try {
        expect(await screen.findByTestId('flow-run')).toBeDisabled();
        expect(runBodies).toHaveLength(0);
        await act(async () => {
          lookup.resolve(mockJsonResponse({ items: [saved] }));
        });
        await waitFor(() =>
          expect(screen.getByTestId('flow-select')).toHaveValue('daily::/repo'),
        );
        await waitFor(() =>
          expect(screen.getByTestId('flow-run')).toBeEnabled(),
        );
        expect(screen.getByTestId('flow-title-trigger')).toHaveTextContent(
          saved.title,
        );
        expect(screen.getByTestId('flow-working-folder')).toHaveValue('/repo');
        expect(router.state.location.search).toBe(
          '?conversationId=old&flowName=other&sourceId=%2Fwrong&keep=yes',
        );
        expect(turnsIds).toContain('old');
        expect(lookupIds).toContain('old');
        await userEvent.click(screen.getByTestId('flow-info'));
        const info = await screen.findByTestId('flow-info-content');
        expect(within(info).getByText('codex')).toBeInTheDocument();
        expect(within(info).getByText('saved-model')).toBeInTheDocument();
        fireEvent.keyDown(info, { key: 'Escape', code: 'Escape' });
        await waitFor(() =>
          expect(
            screen.queryByTestId('flow-info-content'),
          ).not.toBeInTheDocument(),
        );
        await run();
        await runAccepted.promise;
        expect(runBodies[0]).toMatchObject({
          conversationId: 'old',
          sourceId: '/repo',
          working_folder: '/repo',
          resumeStepPath: [2, 1],
        });
      } finally {
        await act(async () => {
          lookup.resolve(mockJsonResponse({ items: [saved] }));
          transcript.resolve(mockJsonResponse({ items: [] }));
        });
      }
    },
    resolveClientTestTimeoutMs(60000),
  );

  it('restores a root-bound local option and a different saved flow name', async () => {
    const saved = {
      ...a,
      conversationId: 'local',
      flowName: 'weekly',
      flags: {
        flow: { flowDefinitionRoot: '/configured/flows', stepPath: [3] },
      },
    };
    const { router } = setup({
      initialEntries: ['/flows?conversationId=local'],
      items: [b],
      flows: [
        { name: 'daily' },
        { name: 'weekly', sourceId: '/repo' },
        { name: 'weekly' },
      ],
      lookup: () => mockJsonResponse({ items: [saved] }),
    });
    await screen.findByText('Transcript local');
    await waitFor(() =>
      expect(screen.getByTestId('flow-select')).toHaveValue('weekly::local'),
    );
    expect(router.state.location.search).toBe('?conversationId=local');
  });

  it('reads a saved transcript when its flow is absent from the catalog', async () => {
    const saved = { ...a, conversationId: 'removed', flowName: 'retired' };
    const { router } = setup({
      initialEntries: ['/flows?conversationId=removed'],
      lookup: () => mockJsonResponse({ items: [saved] }),
    });
    await screen.findByText('Transcript removed');
    expect(screen.getByTestId('flow-title-trigger')).toHaveTextContent(
      saved.title,
    );
    expect(router.state.location.search).toBe('?conversationId=removed');
  });

  it('auto-selects only the matching flow when a delayed catalog follows unscoped Chat and Agent history', async () => {
    const catalog = deferred<Response>();
    const scopedList = deferred<Response>();
    const unscopedRequested = deferred<void>();
    const scopedRequested = deferred<void>();
    const chat: ConversationApiSummary = {
      conversationId: 'chat',
      title: 'Newer Chat',
      provider: 'codex',
      model: 'saved-model',
      lastMessageAt: '2026-03-01T00:00:00.000Z',
    };
    const agent: ConversationApiSummary = {
      ...chat,
      conversationId: 'agent',
      title: 'Newer Agent',
      agentName: 'planner',
      lastMessageAt: '2026-02-01T00:00:00.000Z',
    };
    const initialItems = [chat, agent, a];
    const { router, turnsIds } = setup({
      items: initialItems,
      flowsResponse: catalog.promise,
      conversationsList: (flowName) => {
        if (flowName === 'daily') {
          scopedRequested.resolve();
          return scopedList.promise;
        }
        unscopedRequested.resolve();
        return mockJsonResponse({ items: initialItems });
      },
    });
    const selectedIds: string[] = [];
    const unsubscribe = router.subscribe((state) => {
      const id = new URLSearchParams(state.location.search).get(
        'conversationId',
      );
      if (id) selectedIds.push(id);
    });
    try {
      await act(async () => {
        await unscopedRequested.promise;
      });
      expect(router.state.location.search).toBe('');
      await act(async () => {
        catalog.resolve(
          mockJsonResponse({ flows: [{ name: 'daily', disabled: false }] }),
        );
      });
      await act(async () => {
        await scopedRequested.promise;
      });
      // Hold the scoped response so any selection from the initial unscoped
      // history is observable before the proper flow list can replace it.
      expect(router.state.location.search).toBe('?conversationId=a');
      expect(selectedIds).toContain('a');
      expect(selectedIds.every((id) => id === 'a')).toBe(true);
      expect(turnsIds).not.toContain('chat');
      expect(turnsIds).not.toContain('agent');
      await act(async () => {
        scopedList.resolve(mockJsonResponse({ items: [a] }));
      });
      await screen.findByText('Transcript a');
      expect(turnsIds).toContain('a');
      expect(router.state.location.search).toBe('?conversationId=a');
      expect(screen.getByTestId('flow-title-trigger')).toHaveTextContent(
        a.title,
      );
      expect(selectedIds.length).toBeGreaterThan(0);
      expect(selectedIds.every((id) => id === 'a')).toBe(true);
      expect(turnsIds).not.toContain('chat');
      expect(turnsIds).not.toContain('agent');
    } finally {
      unsubscribe();
      await act(async () => {
        catalog.resolve(
          mockJsonResponse({ flows: [{ name: 'daily', disabled: false }] }),
        );
        scopedList.resolve(mockJsonResponse({ items: [a] }));
      });
    }
  });

  it('canonicalizes bare auto-selection with replace, then pushes selection and restores Back/Forward without extra entries', async () => {
    const { router } = setup({
      initialEntries: ['/before', '/flows?keep=yes'],
    });
    await screen.findByText('Transcript a');
    expect(router.state.location.search).toBe('?keep=yes&conversationId=a');
    const keyA = router.state.location.key;
    await select(a.title);
    expect(router.state.location.key).toBe(keyA);
    await select(b.title);
    await screen.findByText('Transcript b');
    expect(screen.queryByText('Transcript a')).not.toBeInTheDocument();
    const keyB = router.state.location.key;
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByText('Transcript a');
    expect(router.state.location.key).toBe(keyA);
    await act(async () => {
      await router.navigate(1);
    });
    await screen.findByText('Transcript b');
    expect(router.state.location.key).toBe(keyB);
    await act(async () => {
      await router.navigate(-2);
    });
    await screen.findByText('Before Flows');
  });

  it('New retains flow identity and folder, clears run context, and restores saved and draft views through history', async () => {
    const items = [
      {
        ...a,
        flags: {
          workingFolder: '/repo',
          flow: { sourceId: '/repo', stepPath: [1] },
        },
      },
      {
        ...b,
        flags: {
          flow: { flowDefinitionRoot: '/configured/flows', stepPath: [2] },
        },
      },
    ];
    const { router } = setup({
      initialEntries: ['/flows?conversationId=a&keep=yes'],
      flows: [{ name: 'daily' }, { name: 'daily', sourceId: '/repo' }],
      items,
    });
    await screen.findByText('Transcript a');
    await waitFor(() =>
      expect(screen.getByTestId('flow-select')).toHaveValue('daily::/repo'),
    );
    expect(screen.getByTestId('flow-working-folder')).toHaveValue('/repo');
    await userEvent.click(screen.getByTestId('flow-new'));
    expect(router.state.location.search).toBe(
      '?keep=yes&flowName=daily&sourceId=%2Frepo',
    );
    expect(screen.queryByText('Transcript a')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('flow-run')).toBeEnabled());
    expect(screen.getByTestId('flow-working-folder')).toHaveValue('/repo');
    expect(screen.getByTestId('flow-custom-title')).toHaveValue('');
    expect(screen.getByTestId('flow-title-trigger')).toHaveTextContent('daily');
    expect(screen.getByTestId('flow-resume')).toBeDisabled();
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByText('Transcript a');
    await act(async () => {
      await router.navigate(1);
    });
    await waitFor(() => expect(screen.getByTestId('flow-run')).toBeEnabled());
    expect(router.state.location.search).toBe(
      '?keep=yes&flowName=daily&sourceId=%2Frepo',
    );
    expect(screen.queryByText('Transcript a')).not.toBeInTheDocument();
    expect(screen.getByTestId('flow-working-folder')).toHaveValue('/repo');
    await select(b.title);
    await screen.findByText('Transcript b');
    await waitFor(() =>
      expect(screen.getByTestId('flow-select')).toHaveValue('daily::local'),
    );
    expect(screen.getByTestId('flow-working-folder')).toHaveValue('');
    expect(screen.getByTestId('flow-title-trigger')).toHaveTextContent(b.title);
  });

  it.each(['missing', 'error'])(
    'keeps an unresolved %s URL and allows selection and New recovery',
    async (mode) => {
      const { router, runBodies } = setup({
        initialEntries: ['/flows?conversationId=unavailable'],
        lookup: () =>
          mode === 'missing'
            ? mockJsonResponse({ items: [] })
            : mockJsonResponse(
                { message: 'History unavailable' },
                { status: 503 },
              ),
      });
      expect(
        await screen.findByTestId('flows-selection-error'),
      ).toHaveTextContent(
        mode === 'missing' ? 'Conversation not found.' : 'History unavailable',
      );
      expect(screen.getByTestId('flow-run')).toBeDisabled();
      expect(runBodies).toHaveLength(0);
      expect(router.state.location.search).toBe('?conversationId=unavailable');
      await select(b.title);
      await screen.findByText('Transcript b');
      expect(
        screen.queryByTestId('flows-selection-error'),
      ).not.toBeInTheDocument();
      await userEvent.click(screen.getByTestId('flow-new'));
      expect(router.state.location.search).toBe('?flowName=daily');
      await waitFor(() => expect(screen.getByTestId('flow-run')).toBeEnabled());
    },
  );

  it('ignores a superseded exact lookup', async () => {
    const lookup = deferred<Response>();
    const { router } = setup({
      initialEntries: ['/flows?conversationId=old'],
      lookup: () => lookup.promise,
    });
    try {
      expect(await screen.findByTestId('flow-run')).toBeDisabled();
      await select(b.title);
      await screen.findByText('Transcript b');
      await act(async () => {
        lookup.resolve(
          mockJsonResponse({ items: [{ ...a, conversationId: 'old' }] }),
        );
      });
      expect(router.state.location.search).toBe('?conversationId=b');
      expect(screen.getByText('Transcript b')).toBeInTheDocument();
      expect(screen.queryByText('Transcript old')).not.toBeInTheDocument();
    } finally {
      await act(async () => {
        lookup.resolve(mockJsonResponse({ items: [] }));
      });
    }
  });

  it('replaces the current draft URL only when its first run is accepted', async () => {
    const acceptance = deferred<Response>();
    const { router, runAccepted, runBodies, sidebar } = setup({
      initialEntries: ['/before', '/flows?keep=yes'],
      items: [],
      run: () => acceptance.promise,
    });
    try {
      const draftKey = router.state.location.key;
      await run();
      await runAccepted.promise;
      expect(router.state.location.search).toBe('?keep=yes');
      expect(router.state.location.key).toBe(draftKey);
      const id = String(runBodies[0].conversationId);
      sidebar.items = [{ ...a, conversationId: id }];
      await act(async () => {
        acceptance.resolve(started(id));
      });
      await waitFor(() =>
        expect(router.state.location.search).toBe(
          `?keep=yes&conversationId=${id}`,
        ),
      );
      await act(async () => {
        await router.navigate(-1);
      });
      await screen.findByText('Before Flows');
    } finally {
      await act(async () => {
        acceptance.resolve(
          started(String(runBodies[0]?.conversationId ?? 'accepted')),
        );
      });
    }
  });

  it.each(['selection', 'new', 'history'])(
    'late run acceptance cannot steal a newer %s and sends no cancellation',
    async (destination) => {
      const acceptance = deferred<Response>();
      const { router, runAccepted, runBodies } = setup({
        initialEntries: ['/flows?conversationId=b', '/flows?conversationId=a'],
        run: () => acceptance.promise,
      });
      try {
        await screen.findByText('Transcript a');
        await run();
        await runAccepted.promise;
        if (destination === 'selection') {
          await select(b.title);
          await screen.findByText('Transcript b');
        } else if (destination === 'history') {
          await act(async () => {
            await router.navigate(-1);
          });
          await screen.findByText('Transcript b');
        } else {
          await userEvent.click(screen.getByTestId('flow-new'));
          await waitFor(() =>
            expect(screen.getByTestId('flow-run')).toBeEnabled(),
          );
        }
        const currentKey = router.state.location.key;
        await act(async () => {
          acceptance.resolve(started(String(runBodies[0].conversationId)));
        });
        expect(router.state.location.key).toBe(currentKey);
        expect(router.state.location.search).toBe(
          destination !== 'new' ? '?conversationId=b' : '?flowName=daily',
        );
        if (destination !== 'new')
          expect(screen.getByText('Transcript b')).toBeInTheDocument();
        expect(
          sentMessages().some((message) => message.type === 'cancel_inflight'),
        ).toBe(false);
      } finally {
        await act(async () => {
          acceptance.resolve(started('a'));
        });
      }
    },
  );

  it.each([
    { mode: 'run', outcome: 'valid', bPending: false },
    { mode: 'run', outcome: 'recoverable', bPending: false },
    { mode: 'resume', outcome: 'valid', bPending: false },
    { mode: 'resume', outcome: 'recoverable', bPending: false },
    { mode: 'resume', outcome: 'valid', bPending: true },
  ] as const)(
    'continues captured $mode A after $outcome details while preserving B (pending=$bPending)',
    async ({ mode, outcome, bPending }) => {
      const details = deferred<Response>();
      const detailsRequested = deferred<void>();
      const aAcceptance = deferred<Response>();
      const bAcceptance = deferred<Response>();
      const aDispatched = deferred<void>();
      const bDispatched = deferred<void>();
      const origin = {
        ...a,
        flags: {
          workingFolder: '/repo-a',
          flow: {
            sourceId: '/repo-a',
            ...(mode === 'resume' ? { stepPath: [4, 2] } : {}),
          },
        },
      };
      const target = {
        ...b,
        provider: 'lmstudio',
        model: 'model-b',
        flags: {
          workingFolder: '/repo-b',
          flow: { sourceId: '/repo-b', stepPath: [7] },
        },
      };
      const { router, runBodies } = setup({
        initialEntries: ['/flows?conversationId=a'],
        items: [origin, target],
        flows: [
          { name: 'daily', sourceId: '/repo-a' },
          { name: 'daily', sourceId: '/repo-b' },
        ],
        details: (flowName, sourceId) => {
          if (sourceId === '/repo-a') {
            detailsRequested.resolve();
            return details.promise;
          }
          return mockJsonResponse({
            flow: { name: flowName, sourceId, disabled: false, warnings: [] },
          });
        },
        run: (body) => {
          if (body.sourceId === '/repo-a') {
            aDispatched.resolve();
            return aAcceptance.promise;
          }
          bDispatched.resolve();
          return bAcceptance.promise;
        },
      });
      try {
        await screen.findByText('Transcript a');
        await waitFor(() =>
          expect(screen.getByTestId('flow-working-folder')).toHaveValue(
            '/repo-a',
          ),
        );
        await run();
        await detailsRequested.promise;
        await select(target.title);
        await screen.findByText('Transcript b');
        await waitFor(() =>
          expect(screen.getByTestId('flow-select')).toHaveValue(
            'daily::/repo-b',
          ),
        );
        await waitFor(() =>
          expect(screen.getByTestId('flow-run')).toBeEnabled(),
        );
        if (bPending) {
          await run();
          await bDispatched.promise;
          await screen.findByTestId('flow-stop');
        }
        const selectedKey = router.state.location.key;
        const subscriptions = sentMessages().filter(
          (message) => message.type === 'subscribe_conversation',
        );
        await act(async () => {
          details.resolve(
            outcome === 'valid'
              ? mockJsonResponse({
                  flow: {
                    name: 'daily',
                    sourceId: '/repo-a',
                    disabled: false,
                    warnings: [],
                  },
                })
              : mockJsonResponse(
                  { message: 'Temporary details failure' },
                  { status: 503 },
                ),
          );
        });
        await aDispatched.promise;
        const request = runBodies.find((body) => body.sourceId === '/repo-a')!;
        expect(request).toMatchObject({
          sourceId: '/repo-a',
          working_folder: '/repo-a',
        });
        if (mode === 'resume') {
          expect(request).toMatchObject({
            conversationId: 'a',
            resumeStepPath: [4, 2],
          });
          expect(request).not.toHaveProperty('retryOwnershipId');
        } else {
          expect(typeof request.conversationId).toBe('string');
          expect(request.conversationId).not.toBe('a');
          expect(request.conversationId).not.toBe('b');
          expect(request).not.toHaveProperty('resumeStepPath');
          expect(typeof request.retryOwnershipId).toBe('string');
        }
        const requestCall = mockFetch.mock.calls.find(([input, init]) => {
          const href =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;
          return (
            href.includes('/flows/daily/run') &&
            init?.body != null &&
            (decodeJsonBody(init) as Record<string, unknown>).sourceId ===
              '/repo-a'
          );
        });
        expect(requestCall).toBeDefined();
        expect(router.state.location.search).toBe('?conversationId=b');
        expect(router.state.location.key).toBe(selectedKey);
        expect(screen.getByText('Transcript b')).toBeInTheDocument();
        expect(screen.getByTestId('flow-title-trigger')).toHaveTextContent(
          target.title,
        );
        expect(screen.getByTestId('flow-working-folder')).toHaveValue(
          '/repo-b',
        );
        expect(
          sentMessages().filter(
            (message) => message.type === 'subscribe_conversation',
          ),
        ).toEqual(subscriptions);
        expect(
          screen.getByTestId(bPending ? 'flow-stop' : 'flow-run'),
        ).toBeEnabled();
        await act(async () => {
          aAcceptance.resolve(
            mockJsonResponse(
              {
                status: 'started',
                flowName: 'daily',
                conversationId: request.conversationId,
                inflightId: 'accepted-a',
                providerId: 'provider-a',
                modelId: 'model-a',
                warnings: ['Stale A warning'],
              },
              { status: 202 },
            ),
          );
        });
        expect(router.state.location.search).toBe('?conversationId=b');
        expect(router.state.location.key).toBe(selectedKey);
        expect(screen.getByText('Transcript b')).toBeInTheDocument();
        expect(screen.getByTestId('flow-title-trigger')).toHaveTextContent(
          target.title,
        );
        expect(screen.getByTestId('flow-working-folder')).toHaveValue(
          '/repo-b',
        );
        expect(
          screen.queryByTestId('flows-launch-warnings'),
        ).not.toBeInTheDocument();
        expect(screen.queryByTestId('flows-run-error')).not.toBeInTheDocument();
        expect(
          sentMessages().filter(
            (message) => message.type === 'subscribe_conversation',
          ),
        ).toEqual(subscriptions);
        expect(
          screen.getByTestId(bPending ? 'flow-stop' : 'flow-run'),
        ).toBeEnabled();
        if (bPending) {
          expect(
            runBodies.find((body) => body.sourceId === '/repo-b'),
          ).toMatchObject({
            conversationId: 'b',
            working_folder: '/repo-b',
            resumeStepPath: [7],
          });
          await act(async () => {
            bAcceptance.resolve(started('b'));
          });
          await waitFor(() =>
            expect(screen.getByTestId('flow-run')).toBeEnabled(),
          );
        } else {
          await userEvent.click(screen.getByTestId('flow-info'));
          const info = await screen.findByTestId('flow-info-content');
          expect(within(info).getByText(target.provider)).toBeInTheDocument();
          expect(within(info).getByText(target.model)).toBeInTheDocument();
        }
        expect(
          sentMessages().some((message) => message.type === 'cancel_inflight'),
        ).toBe(false);
      } finally {
        await act(async () => {
          details.resolve(
            mockJsonResponse({
              flow: {
                name: 'daily',
                sourceId: '/repo-a',
                disabled: false,
                warnings: [],
              },
            }),
          );
          aAcceptance.resolve(started('a'));
          bAcceptance.resolve(started('b'));
        });
      }
    },
    resolveClientTestTimeoutMs(60000),
  );

  it.each(['disabled', 'unavailable', 'malformed'] as const)(
    'still blocks A on %s details without replacing B with an error',
    async (outcome) => {
      const details = deferred<Response>();
      const detailsRequested = deferred<void>();
      const origin = {
        ...a,
        flags: {
          workingFolder: '/repo-a',
          flow: { sourceId: '/repo-a', stepPath: [1] },
        },
      };
      const target = {
        ...b,
        flags: {
          workingFolder: '/repo-b',
          flow: { sourceId: '/repo-b', stepPath: [7] },
        },
      };
      const { router, runBodies } = setup({
        initialEntries: ['/flows?conversationId=a'],
        items: [origin, target],
        flows: [
          { name: 'daily', sourceId: '/repo-a' },
          { name: 'daily', sourceId: '/repo-b' },
        ],
        details: () => {
          detailsRequested.resolve();
          return details.promise;
        },
      });
      try {
        await screen.findByText('Transcript a');
        await run();
        await detailsRequested.promise;
        await select(target.title);
        await screen.findByText('Transcript b');
        await waitFor(() =>
          expect(screen.getByTestId('flow-select')).toHaveValue(
            'daily::/repo-b',
          ),
        );
        const selectedKey = router.state.location.key;
        await act(async () => {
          details.resolve(
            outcome === 'disabled'
              ? mockJsonResponse({
                  flow: {
                    name: 'daily',
                    sourceId: '/repo-a',
                    disabled: true,
                    disabledReason: { message: 'A disabled' },
                    warnings: [],
                  },
                })
              : outcome === 'unavailable'
                ? mockJsonResponse(
                    {
                      code: 'DETAILS_UNAVAILABLE',
                      message: 'A details unavailable',
                    },
                    { status: 503 },
                  )
                : mockJsonResponse({ flow: { name: 'daily' } }),
          );
        });
        expect(runBodies).toHaveLength(0);
        expect(router.state.location.search).toBe('?conversationId=b');
        expect(router.state.location.key).toBe(selectedKey);
        expect(screen.getByText('Transcript b')).toBeInTheDocument();
        expect(screen.getByTestId('flow-title-trigger')).toHaveTextContent(
          target.title,
        );
        expect(screen.getByTestId('flow-working-folder')).toHaveValue(
          '/repo-b',
        );
        expect(screen.queryByTestId('flows-run-error')).not.toBeInTheDocument();
        expect(
          screen.queryByTestId('flows-launch-warnings'),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId('flow-run')).toBeEnabled();
      } finally {
        await act(async () => {
          details.resolve(
            mockJsonResponse(
              { code: 'DETAILS_UNAVAILABLE', message: 'A details unavailable' },
              { status: 503 },
            ),
          );
        });
      }
    },
    resolveClientTestTimeoutMs(60000),
  );

  it('late acceptance of a first new run preserves a newer sidebar selection', async () => {
    const acceptance = deferred<Response>();
    const { router, runAccepted, runBodies } = setup({
      run: () => acceptance.promise,
    });
    try {
      await screen.findByText('Transcript a');
      await userEvent.click(screen.getByTestId('flow-new'));
      await run();
      await runAccepted.promise;
      await select(b.title);
      await screen.findByText('Transcript b');
      const selectedKey = router.state.location.key;
      await act(async () => {
        acceptance.resolve(started(String(runBodies[0].conversationId)));
      });
      expect(router.state.location.search).toBe(
        '?flowName=daily&conversationId=b',
      );
      expect(router.state.location.key).toBe(selectedKey);
      expect(screen.getByText('Transcript b')).toBeInTheDocument();
      expect(
        sentMessages().some((message) => message.type === 'cancel_inflight'),
      ).toBe(false);
    } finally {
      await act(async () => {
        acceptance.resolve(started('new-run'));
      });
    }
  });

  it('pushes a flow draft URL when the picker changes and restores the saved flow with Back', async () => {
    const { router } = setup({
      initialEntries: ['/flows?conversationId=a'],
      flows: [{ name: 'daily' }, { name: 'weekly' }],
    });
    await screen.findByText('Transcript a');
    fireEvent.change(screen.getByTestId('flow-select'), {
      target: { value: 'weekly::local' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-select')).toHaveValue('weekly::local'),
    );
    expect(router.state.location.search).toBe('?flowName=weekly');
    expect(screen.queryByText('Transcript a')).not.toBeInTheDocument();
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByText('Transcript a');
    await waitFor(() =>
      expect(screen.getByTestId('flow-select')).toHaveValue('daily::local'),
    );
  });

  it('navigation away from an existing inflight conversation keeps its server run alive', async () => {
    const { router, emitInflightSnapshot } = setup({
      initialEntries: ['/flows?conversationId=a'],
    });
    await screen.findByText('Transcript a');
    await act(async () => {
      await emitInflightSnapshot({
        conversationId: 'a',
        inflightId: 'running-a',
        assistantText: 'Still running A',
      });
    });
    await screen.findByTestId('flow-stop');
    await select(b.title);
    await screen.findByText('Transcript b');
    expect(router.state.location.search).toBe('?conversationId=b');
    expect(
      sentMessages().some((message) => message.type === 'cancel_inflight'),
    ).toBe(false);
  });
});
