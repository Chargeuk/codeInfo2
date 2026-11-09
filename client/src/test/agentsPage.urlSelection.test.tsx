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
import { decodeJsonBody } from './support/decodeJsonBody';
import { mockJsonResponse } from './support/fetchMock';
import { setupChatWsHarness } from './support/mockChatWs';
import { resolveClientTestTimeoutMs } from './support/testTimeouts';

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = global.fetch;
const { default: App } = await import('../App');
const { default: AgentsPage } = await import('../pages/AgentsPage');
const timeout = resolveClientTestTimeoutMs(60000);

const a: ConversationApiSummary = {
  conversationId: 'a',
  title: 'Conversation A',
  agentName: 'coding_agent',
  provider: 'codex',
  model: 'saved-model-a',
  lastMessageAt: '2026-01-01T00:00:00.000Z',
  flags: { workingFolder: '/repo/a' },
};
const b: ConversationApiSummary = {
  ...a,
  conversationId: 'b',
  title: 'Conversation B',
  model: 'saved-model-b',
  flags: { workingFolder: '/repo/b' },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockReset();
  globalThis.__wsMock?.reset();
});
afterEach(() => {
  global.fetch = originalFetch;
});

function setup(
  options: {
    initialEntries?: string[];
    items?: ConversationApiSummary[];
    catalog?: () => Response | Promise<Response>;
    lookup?: (id: string) => Response | Promise<Response>;
    turns?: (id: string) => Response | Promise<Response>;
    run?: (
      body: Record<string, unknown>,
      accepted: Response,
    ) => Response | Promise<Response>;
  } = {},
) {
  setupChatWsHarness({ mockFetch });
  const baseFetch = mockFetch.getMockImplementation()!;
  const sidebar = { items: options.items ?? [a, b] };
  const summaries = new Map(
    sidebar.items.map((item) => [item.conversationId, item]),
  );
  const lookupIds: string[] = [];
  const turnsIds: string[] = [];
  const runBodies: Record<string, unknown>[] = [];
  const runPaths: string[] = [];
  mockFetch.mockImplementation((input, init) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === '/agents') {
      return Promise.resolve(
        options.catalog?.() ??
          mockJsonResponse({
            agents: [{ name: 'coding_agent' }, { name: 'saved_agent' }],
          }),
      );
    }
    if (/^\/agents\/[^/]+\/commands$/.test(url.pathname)) {
      return Promise.resolve(
        mockJsonResponse({
          commands: [
            {
              name: 'improve_plan',
              description: 'Improve',
              disabled: false,
              stepCount: 1,
            },
          ],
        }),
      );
    }
    if (/^\/agents\/[^/]+\/prompts$/.test(url.pathname)) {
      return Promise.resolve(mockJsonResponse({ prompts: [] }));
    }
    const details = url.pathname.match(/^\/agents\/([^/]+)$/);
    if (details) {
      return Promise.resolve(
        mockJsonResponse({
          agent: {
            name: decodeURIComponent(details[1]),
            disabled: false,
            warnings: [],
            fallbackCandidates: [],
          },
        }),
      );
    }
    if (/^\/agents\/[^/]+\/(commands\/)?run$/.test(url.pathname)) {
      const body = decodeJsonBody(init);
      const id = String(body.conversationId);
      runBodies.push(body);
      runPaths.push(url.pathname);
      summaries.set(id, {
        ...a,
        conversationId: id,
        agentName: url.pathname.split('/')[2],
      });
      const accepted = mockJsonResponse(
        {
          status: 'started',
          agentName: url.pathname.split('/')[2],
          commandName: 'improve_plan',
          conversationId: id,
          inflightId: 'run-1',
          modelId: 'accepted-model',
        },
        { status: 202 },
      );
      return Promise.resolve(options.run?.(body, accepted) ?? accepted);
    }
    if (url.pathname === '/conversations') {
      const id = url.searchParams.get('conversationId');
      if (id) {
        lookupIds.push(id);
        return Promise.resolve(
          options.lookup?.(id) ??
            mockJsonResponse({
              items: summaries.has(id) ? [summaries.get(id)] : [],
            }),
        );
      }
      const agentName = url.searchParams.get('agentName');
      return Promise.resolve(
        mockJsonResponse({
          items: sidebar.items.filter((item) => item.agentName === agentName),
          nextCursor: null,
        }),
      );
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
            inflight: null,
          }),
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
          { path: 'agents', element: <AgentsPage /> },
          { path: 'before', element: <div>Before Agents</div> },
        ],
      },
    ],
    { initialEntries: options.initialEntries ?? ['/agents'] },
  );
  render(<RouterProvider router={router} />);
  return { router, sidebar, lookupIds, turnsIds, runBodies, runPaths };
}

async function select(title: string) {
  const row = (await screen.findAllByTestId('conversation-row')).find((item) =>
    within(item).queryByText(title),
  );
  if (!row) throw new Error(`Missing row ${title}`);
  await userEvent.click(row);
}

async function submit(mode: 'instruction' | 'command' = 'instruction') {
  if (mode === 'command') {
    const trigger = await screen.findByTestId('agent-command-trigger');
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    await userEvent.click(
      await screen.findByTestId('agent-command-option-improve_plan::local'),
    );
  } else {
    const input = await screen.findByTestId('agent-input');
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Continue' } });
  }
  const send = await screen.findByTestId('agent-send');
  await waitFor(() => expect(send).toBeEnabled());
  await userEvent.click(send);
}

function sentMessages() {
  return (globalThis.__wsMock?.instances ?? [])
    .flatMap((socket) => socket.sent)
    .map((entry) => JSON.parse(entry) as Record<string, unknown>);
}

describe('Agents URL selection', () => {
  it(
    'restores an archived off-sidebar target and saved context before sending without waiting for turns',
    async () => {
      const lookup = deferred<Response>();
      const transcript = deferred<Response>();
      const saved = {
        ...a,
        conversationId: 'old',
        agentName: 'saved_agent',
        archived: true,
        model: 'restored-model',
        flags: { workingFolder: '/saved/repo' },
      };
      const { router, lookupIds, turnsIds, runBodies, runPaths } = setup({
        initialEntries: ['/agents?conversationId=old'],
        lookup: () => lookup.promise,
        turns: () => transcript.promise,
      });
      await waitFor(() => expect(lookupIds).toContain('old'));
      expect(screen.getByTestId('agent-select-trigger')).not.toHaveTextContent(
        'coding_agent',
      );
      fireEvent.change(screen.getByTestId('agent-input'), {
        target: { value: 'Blocked' },
      });
      expect(screen.getByTestId('agent-send')).toBeDisabled();
      fireEvent.submit(screen.getByTestId('agent-input').closest('form')!);
      expect(runBodies).toHaveLength(0);
      await act(async () => {
        lookup.resolve(mockJsonResponse({ items: [saved] }));
      });
      await waitFor(() =>
        expect(screen.getByTestId('agent-select-trigger')).toHaveTextContent(
          'saved_agent',
        ),
      );
      await waitFor(() =>
        expect(screen.getByTestId('agent-working-folder')).toHaveValue(
          '/saved/repo',
        ),
      );
      await userEvent.click(screen.getByTestId('agent-info'));
      expect(await screen.findByText('restored-model')).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      await submit();
      await waitFor(() => expect(runBodies).toHaveLength(1));
      expect(runPaths).toEqual(['/agents/saved_agent/run']);
      expect(runBodies[0]).toMatchObject({
        conversationId: 'old',
        working_folder: '/saved/repo',
      });
      expect(turnsIds).toContain('old');
      expect(router.state.location.search).toBe('?conversationId=old');
      await act(async () => {
        transcript.resolve(mockJsonResponse({ items: [] }));
      });
    },
    timeout,
  );

  it(
    'restores the persisted transcript and context when the agent catalog is unavailable',
    async () => {
      const { router } = setup({
        initialEntries: ['/agents?conversationId=old'],
        catalog: () => mockJsonResponse({}, { status: 503 }),
        lookup: () =>
          mockJsonResponse({
            items: [{ ...a, conversationId: 'old', agentName: 'saved_agent' }],
          }),
      });
      await screen.findByText('Transcript old');
      await waitFor(() =>
        expect(screen.getByTestId('agent-select-trigger')).toHaveTextContent(
          'saved_agent',
        ),
      );
      await waitFor(() =>
        expect(screen.getByTestId('agent-working-folder')).toHaveValue(
          '/repo/a',
        ),
      );
      expect(router.state.location.search).toBe('?conversationId=old');
    },
    timeout,
  );

  it(
    'pushes selection, ignores the same selection, applies Back/Forward and clears the URL and draft on New',
    async () => {
      const { router } = setup();
      await select(a.title);
      await screen.findByText('Transcript a');
      const firstKey = router.state.location.key;
      expect(router.state.location.search).toBe('?conversationId=a');
      await select(a.title);
      expect(router.state.location.key).toBe(firstKey);
      await select(b.title);
      await screen.findByText('Transcript b');
      const secondKey = router.state.location.key;
      await act(async () => {
        await router.navigate(-1);
      });
      await screen.findByText('Transcript a');
      expect(router.state.location.key).toBe(firstKey);
      expect(screen.getByTestId('agent-working-folder')).toHaveValue('/repo/a');
      await act(async () => {
        await router.navigate(1);
      });
      await screen.findByText('Transcript b');
      expect(router.state.location.key).toBe(secondKey);
      fireEvent.change(screen.getByTestId('agent-input'), {
        target: { value: 'Draft' },
      });
      await userEvent.click(
        screen.getByTestId('agent-new-conversation-trigger'),
      );
      expect(router.state.location.search).toBe('');
      expect(screen.getByTestId('agent-input')).toHaveValue('');
      expect(screen.getByTestId('agent-working-folder')).toHaveValue('');
      expect(screen.queryByText('Transcript b')).not.toBeInTheDocument();
      await act(async () => {
        await router.navigate(-1);
      });
      await screen.findByText('Transcript b');
      expect(router.state.location.key).toBe(secondKey);
    },
    timeout,
  );

  it(
    'clears the selected URL when the user changes agents',
    async () => {
      const { router } = setup({
        initialEntries: ['/agents?conversationId=a'],
      });
      await screen.findByText('Transcript a');
      await userEvent.click(screen.getByTestId('agent-select-trigger'));
      const agentMenu = await screen.findByTestId('agent-selector-popover');
      await userEvent.click(await within(agentMenu).findByText('saved_agent'));
      expect(router.state.location.search).toBe('');
      expect(screen.getByTestId('agent-select-trigger')).toHaveTextContent(
        'saved_agent',
      );
      expect(screen.getByTestId('agent-working-folder')).toHaveValue('');
      expect(screen.queryByText('Transcript a')).not.toBeInTheDocument();
    },
    timeout,
  );

  it.each(['missing', 'error'] as const)(
    'keeps a %s link explicit and permits New and normal selection',
    async (kind) => {
      const { router, runBodies } = setup({
        initialEntries: ['/agents?conversationId=unavailable'],
        lookup: () =>
          kind === 'missing'
            ? mockJsonResponse({ items: [] })
            : mockJsonResponse(
                { message: 'Lookup unavailable' },
                { status: 503 },
              ),
      });
      expect(
        await screen.findByTestId('agents-selection-error'),
      ).toHaveTextContent(
        kind === 'missing'
          ? 'Conversation not found.'
          : /503|Lookup unavailable/,
      );
      expect(router.state.location.search).toBe('?conversationId=unavailable');
      fireEvent.change(screen.getByTestId('agent-input'), {
        target: { value: 'Blocked' },
      });
      expect(screen.getByTestId('agent-send')).toBeDisabled();
      expect(runBodies).toHaveLength(0);
      await userEvent.click(
        screen.getByTestId('agent-new-conversation-trigger'),
      );
      expect(router.state.location.search).toBe('');
      await select(a.title);
      await screen.findByText('Transcript a');
      expect(router.state.location.search).toBe('?conversationId=a');
      expect(
        screen.queryByTestId('agents-selection-error'),
      ).not.toBeInTheDocument();
    },
    timeout,
  );

  it(
    'does not apply a superseded summary lookup to a newer URL selection',
    async () => {
      const lookup = deferred<Response>();
      const { router, lookupIds } = setup({
        initialEntries: ['/agents?conversationId=old'],
        lookup: (id) =>
          id === 'old' ? lookup.promise : mockJsonResponse({ items: [b] }),
      });
      await waitFor(() => expect(lookupIds).toContain('old'));
      await act(async () => {
        await router.navigate('/agents?conversationId=b');
      });
      await screen.findByText('Transcript b');
      await act(async () => {
        lookup.resolve(
          mockJsonResponse({
            items: [{ ...a, conversationId: 'old', agentName: 'saved_agent' }],
          }),
        );
      });
      expect(router.state.location.search).toBe('?conversationId=b');
      expect(screen.getByTestId('agent-select-trigger')).toHaveTextContent(
        'coding_agent',
      );
      expect(screen.getByTestId('agent-working-folder')).toHaveValue('/repo/b');
      expect(screen.queryByText('Transcript old')).not.toBeInTheDocument();
    },
    timeout,
  );

  it.each(['instruction', 'command'] as const)(
    'replaces the draft URL only after the first %s launch is accepted',
    async (mode) => {
      const acceptance = deferred<Response>();
      const received = deferred<Response>();
      const { router, runBodies } = setup({
        initialEntries: ['/before', '/agents'],
        run: (_body, accepted) => {
          received.resolve(accepted);
          return acceptance.promise;
        },
      });
      await submit(mode);
      const accepted = await received.promise;
      expect(router.state.location.search).toBe('');
      await act(async () => {
        acceptance.resolve(accepted);
      });
      await waitFor(() =>
        expect(router.state.location.search).toBe(
          `?conversationId=${runBodies[0].conversationId}`,
        ),
      );
      expect(router.state.historyAction).toBe('REPLACE');
      await act(async () => {
        await router.navigate(-1);
      });
      await screen.findByText('Before Agents');
    },
    timeout,
  );

  it.each(['instruction', 'command'] as const)(
    'replaces the same draft URL when a failed first %s launch succeeds on retry',
    async (mode) => {
      const acceptance = deferred<Response>();
      const retryReceived = deferred<Response>();
      let attempts = 0;
      const { router, runBodies } = setup({
        initialEntries: ['/before', '/agents'],
        run: (_body, accepted) => {
          attempts += 1;
          if (attempts === 1) {
            return mockJsonResponse(
              { message: 'First attempt failed' },
              { status: 503 },
            );
          }
          retryReceived.resolve(accepted);
          return acceptance.promise;
        },
      });
      const draftKey = router.state.location.key;
      await submit(mode);
      expect(await screen.findByTestId('agents-run-error')).toHaveTextContent(
        'First attempt failed',
      );
      expect(runBodies).toHaveLength(1);
      const draftId = runBodies[0].conversationId;
      expect(router.state.location.search).toBe('');
      expect(router.state.location.key).toBe(draftKey);
      await submit(mode);
      const accepted = await retryReceived.promise;
      expect(runBodies).toHaveLength(2);
      expect(runBodies[1].conversationId).toBe(draftId);
      expect(router.state.location.search).toBe('');
      await act(async () => {
        acceptance.resolve(accepted);
      });
      await waitFor(() =>
        expect(router.state.location.search).toBe(`?conversationId=${draftId}`),
      );
      expect(router.state.historyAction).toBe('REPLACE');
      await act(async () => {
        await router.navigate(-1);
      });
      await screen.findByText('Before Agents');
    },
    timeout,
  );

  it.each([
    ['instruction', 'select'],
    ['instruction', 'new'],
    ['command', 'select'],
    ['command', 'new'],
  ] as const)(
    'does not steal selection when a late %s acceptance follows %s',
    async (mode, navigation) => {
      const acceptance = deferred<Response>();
      const received = deferred<Response>();
      const { router } = setup({
        run: (_body, accepted) => {
          received.resolve(accepted);
          return acceptance.promise;
        },
      });
      await submit(mode);
      const accepted = await received.promise;
      if (navigation === 'select') {
        await select(b.title);
        await screen.findByText('Transcript b');
      } else {
        await userEvent.click(
          screen.getByTestId('agent-new-conversation-trigger'),
        );
      }
      const selectedLocation = router.state.location;
      await act(async () => {
        acceptance.resolve(accepted);
      });
      expect(router.state.location).toEqual(selectedLocation);
      expect(router.state.location.search).toBe(
        navigation === 'select' ? '?conversationId=b' : '',
      );
      if (navigation === 'select') {
        expect(screen.getByTestId('agent-working-folder')).toHaveValue(
          '/repo/b',
        );
        await userEvent.click(screen.getByTestId('agent-info'));
        const info = await screen.findByTestId('agent-composer-info-content');
        expect(
          await within(info).findByText('saved-model-b'),
        ).toBeInTheDocument();
        expect(
          within(info).queryByText('accepted-model'),
        ).not.toBeInTheDocument();
      }
      expect(
        sentMessages().some((message) => message.type === 'cancel_inflight'),
      ).toBe(false);
    },
    timeout,
  );

  it.each([
    ['instruction', 'reject'],
    ['instruction', 'conflict'],
    ['command', 'reject'],
    ['command', 'conflict'],
  ] as const)(
    'keeps B selected when A has a late %s %s failure',
    async (mode, failure) => {
      const result = deferred<Response>();
      const received = deferred<void>();
      const { router } = setup({
        initialEntries: ['/agents?conversationId=a'],
        run: () => {
          received.resolve(undefined);
          return result.promise;
        },
      });
      await screen.findByText('Transcript a');
      await submit(mode);
      await received.promise;
      await select(b.title);
      await screen.findByText('Transcript b');
      const selectedLocation = router.state.location;
      await act(async () => {
        if (failure === 'reject') {
          result.reject(new Error('Late launch failure'));
        } else {
          result.resolve(
            mockJsonResponse(
              {
                code: 'RUN_IN_PROGRESS',
                message: 'Late launch conflict',
              },
              { status: 409 },
            ),
          );
        }
      });
      expect(router.state.location).toEqual(selectedLocation);
      expect(router.state.location.search).toBe('?conversationId=b');
      expect(screen.getByText('Transcript b')).toBeInTheDocument();
      expect(screen.queryByText('Transcript a')).not.toBeInTheDocument();
      expect(screen.queryByText('Late launch failure')).not.toBeInTheDocument();
      expect(
        screen.queryByText(/already has a run in progress/),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId('agents-run-error')).not.toBeInTheDocument();
      expect(screen.getByTestId('agent-select-trigger')).toHaveTextContent(
        'coding_agent',
      );
      expect(screen.getByTestId('agent-working-folder')).toHaveValue('/repo/b');
      await userEvent.click(screen.getByTestId('agent-info'));
      const info = await screen.findByTestId('agent-composer-info-content');
      expect(
        await within(info).findByText('saved-model-b'),
      ).toBeInTheDocument();
      expect(within(info).queryByText('saved-model-a')).not.toBeInTheDocument();
      expect(
        sentMessages().some((message) => message.type === 'cancel_inflight'),
      ).toBe(false);
    },
    timeout,
  );

  it.each(['instruction', 'command'] as const)(
    'keeps a newer %s launch pending when an older launch fails after New',
    async (mode) => {
      const olderResult = deferred<Response>();
      const newerResult = deferred<Response>();
      const olderReceived = deferred<void>();
      const newerReceived = deferred<Response>();
      let attempts = 0;
      const { router, runBodies } = setup({
        run: (_body, accepted) => {
          attempts += 1;
          if (attempts === 1) {
            olderReceived.resolve(undefined);
            return olderResult.promise;
          }
          newerReceived.resolve(accepted);
          return newerResult.promise;
        },
      });
      await submit(mode);
      await olderReceived.promise;
      await userEvent.click(
        screen.getByTestId('agent-new-conversation-trigger'),
      );
      await submit(mode);
      const accepted = await newerReceived.promise;
      expect(runBodies).toHaveLength(2);
      expect(runBodies[1].conversationId).not.toBe(runBodies[0].conversationId);
      await act(async () => {
        olderResult.reject(new Error('Older launch failed'));
      });
      expect(router.state.location.search).toBe('');
      expect(screen.getByTestId('agent-stop')).toBeEnabled();
      expect(screen.queryByTestId('agent-send')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agents-run-error')).not.toBeInTheDocument();
      expect(screen.queryByText('Older launch failed')).not.toBeInTheDocument();
      await act(async () => {
        newerResult.resolve(accepted);
      });
      await waitFor(() =>
        expect(router.state.location.search).toBe(
          `?conversationId=${runBodies[1].conversationId}`,
        ),
      );
      expect(router.state.historyAction).toBe('REPLACE');
      expect(
        sentMessages().some((message) => message.type === 'cancel_inflight'),
      ).toBe(false);
    },
    timeout,
  );

  it(
    'keeps the selected target and saved context when filtering omits it from the sidebar',
    async () => {
      const { router, sidebar, lookupIds } = setup({
        initialEntries: ['/agents?conversationId=a'],
      });
      await screen.findByText('Transcript a');
      sidebar.items = [b];
      await userEvent.click(screen.getByTestId('conversation-filter-archived'));
      await waitFor(() => expect(lookupIds).toContain('a'));
      expect(router.state.location.search).toBe('?conversationId=a');
      expect(screen.getByTestId('agent-working-folder')).toHaveValue('/repo/a');
      expect(screen.getByText('Transcript a')).toBeInTheDocument();
    },
    timeout,
  );

  it(
    'navigates a running conversation through sidebar and history without cancelling it',
    async () => {
      const { router } = setup({
        initialEntries: ['/agents?conversationId=a'],
      });
      await screen.findByText('Transcript a');
      await waitFor(() =>
        expect(sentMessages()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'subscribe_conversation',
              conversationId: 'a',
            }),
          ]),
        ),
      );
      const socket = globalThis.__wsMock?.last();
      if (!socket) throw new Error('Missing WebSocket');
      act(() => {
        socket._receive({
          protocolVersion: 'v1',
          type: 'inflight_snapshot',
          conversationId: 'a',
          seq: 1,
          inflight: {
            inflightId: 'running-a',
            assistantText: 'Running',
            assistantThink: '',
            toolEvents: [],
            startedAt: '2026-01-01T00:00:00.000Z',
          },
        });
      });
      expect(await screen.findByTestId('agent-stop')).toBeInTheDocument();
      await select(b.title);
      await screen.findByText('Transcript b');
      const previousSubscriptions = sentMessages().filter(
        (message) =>
          message.type === 'subscribe_conversation' &&
          message.conversationId === 'a',
      ).length;
      await act(async () => {
        await router.navigate(-1);
      });
      expect(router.state.location.search).toBe('?conversationId=a');
      await waitFor(() =>
        expect(
          sentMessages().filter(
            (message) =>
              message.type === 'subscribe_conversation' &&
              message.conversationId === 'a',
          ).length,
        ).toBeGreaterThan(previousSubscriptions),
      );
      expect(
        sentMessages().some((message) => message.type === 'cancel_inflight'),
      ).toBe(false);
    },
    timeout,
  );
});
