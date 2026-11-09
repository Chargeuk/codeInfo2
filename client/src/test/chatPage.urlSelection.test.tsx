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
import { mockJsonResponse } from './support/fetchMock';
import { setupChatWsHarness } from './support/mockChatWs';
import { resolveClientTestTimeoutMs } from './support/testTimeouts';

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = global.fetch;
const { default: App } = await import('../App');
const { default: ChatPage } = await import('../pages/ChatPage');

beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockReset();
  globalThis.__wsMock?.reset();
});
afterEach(() => {
  global.fetch = originalFetch;
});

const a: ConversationApiSummary = {
  conversationId: 'a',
  title: 'Conversation A',
  provider: 'lmstudio',
  model: 'm1',
  lastMessageAt: '2026-01-01T00:00:00.000Z',
};
const b: ConversationApiSummary = {
  ...a,
  conversationId: 'b',
  title: 'Conversation B',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(
  options: {
    initialEntries?: string[];
    items?: ConversationApiSummary[];
    lookup?: (id: string) => Response | Promise<Response>;
    turns?: (id: string) => Response | Promise<Response>;
    chatFetch?: (body: Record<string, unknown>) => Response | Promise<Response>;
    savedIdentity?: boolean;
  } = {},
) {
  const sidebar = { items: options.items ?? [a, b], nextCursor: null };
  const harness = setupChatWsHarness({
    mockFetch,
    conversations: sidebar,
    chatFetch: options.chatFetch,
    ...(options.savedIdentity
      ? {
          providers: {
            providers: [
              {
                id: 'codex',
                label: 'OpenAI Codex',
                available: true,
                toolsAvailable: true,
              },
              {
                id: 'lmstudio',
                label: 'LM Studio',
                available: true,
                toolsAvailable: true,
                agentFlags: [
                  {
                    key: 'temperature',
                    label: 'Temperature',
                    controlType: 'number',
                    editable: true,
                    seedDefault: 0.5,
                    resolvedDefault: 0.5,
                  },
                ],
              },
            ],
            selectedProvider: 'codex',
            selectedModel: 'default-model',
          },
        }
      : {}),
  });
  const baseFetch = mockFetch.getMockImplementation()!;
  const lookupIds: string[] = [];
  const turnsIds: string[] = [];
  mockFetch.mockImplementation((input, init) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
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
    const match = url.pathname.match(/^\/conversations\/([^/]+)\/turns$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
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
                provider: 'lmstudio',
                model: 'm1',
                status: 'ok',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          }),
      );
    }
    if (options.savedIdentity && url.pathname === '/chat/models') {
      const provider = url.searchParams.get('provider') ?? 'codex';
      const key = provider === 'codex' ? 'default-model' : 'saved-model';
      return Promise.resolve(
        mockJsonResponse({
          provider,
          available: true,
          toolsAvailable: true,
          providerInfo: {
            id: provider,
            label: provider === 'codex' ? 'OpenAI Codex' : 'LM Studio',
            available: true,
            toolsAvailable: true,
            agentFlags:
              provider === 'lmstudio'
                ? [
                    {
                      key: 'temperature',
                      label: 'Temperature',
                      controlType: 'number',
                      editable: true,
                      seedDefault: 0.5,
                      resolvedDefault: 0.5,
                    },
                  ]
                : [],
          },
          models: [
            {
              key,
              displayName: key,
              type: provider === 'codex' ? 'codex' : 'gguf',
              endpointId: 'saved-endpoint',
            },
          ],
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
          { path: 'chat', element: <ChatPage /> },
          { path: 'before', element: <div>Before Chat</div> },
        ],
      },
    ],
    { initialEntries: options.initialEntries ?? ['/chat'] },
  );
  render(<RouterProvider router={router} />);
  return { ...harness, router, sidebar, lookupIds, turnsIds };
}

async function select(title: string) {
  const row = (await screen.findAllByTestId('conversation-row')).find((item) =>
    within(item).queryByText(title),
  );
  if (!row) throw new Error(`Missing row ${title}`);
  await userEvent.click(row);
}

async function submit(text = 'Continue') {
  const send = await screen.findByTestId('chat-send');
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.change(screen.getByTestId('chat-input'), {
    target: { value: text },
  });
  await userEvent.click(send);
}

describe('Chat URL selection', () => {
  it(
    'opens an archived URL target outside the sidebar and restores execution context before send',
    async () => {
      const lookup = deferred<Response>();
      const transcript = deferred<Response>();
      const saved = {
        ...a,
        conversationId: 'old',
        model: 'saved-model',
        archived: true,
        flags: {
          endpointId: 'saved-endpoint',
          workingFolder: '/saved/repo',
          agentFlags: { temperature: 0.2 },
        },
      };
      const { router, chatBodies, turnsIds } = setup({
        initialEntries: ['/chat?conversationId=old'],
        items: [b],
        savedIdentity: true,
        lookup: () => lookup.promise,
        turns: () => transcript.promise,
      });
      expect(await screen.findByTestId('chat-send')).toBeDisabled();
      expect(chatBodies).toHaveLength(0);
      await act(async () => {
        lookup.resolve(mockJsonResponse({ items: [saved] }));
      });
      await waitFor(() =>
        expect(screen.getByTestId('chat-send')).toBeEnabled(),
      );
      expect(turnsIds).toContain('old');
      expect(router.state.location.search).toBe('?conversationId=old');
      await waitFor(() =>
        expect(screen.getByTestId('provider-select')).toHaveTextContent(
          'LM Studio',
        ),
      );
      await submit();
      await waitFor(() => expect(chatBodies).toHaveLength(1));
      expect(chatBodies[0]).toMatchObject({
        conversationId: 'old',
        provider: 'lmstudio',
        model: 'saved-model',
        endpointId: 'saved-endpoint',
        working_folder: '/saved/repo',
        agentFlags: { temperature: 0.2 },
      });
      await act(async () => {
        transcript.resolve(mockJsonResponse({ items: [] }));
      });
    },
    resolveClientTestTimeoutMs(60000),
  );

  it('pushes sidebar selection, makes same-ID clicks a no-op and applies Back/Forward without extra entries', async () => {
    const { router } = setup();
    await select(a.title);
    await screen.findByText('Transcript a');
    const selectedKey = router.state.location.key;
    expect(router.state.location.search).toBe('?conversationId=a');
    await select(a.title);
    expect(router.state.location.key).toBe(selectedKey);
    await select(b.title);
    await screen.findByText('Transcript b');
    expect(screen.queryByText('Transcript a')).not.toBeInTheDocument();
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByText('Transcript a');
    expect(router.state.location.key).toBe(selectedKey);
    await act(async () => {
      await router.navigate(1);
    });
    await screen.findByText('Transcript b');
    expect(router.state.location.search).toBe('?conversationId=b');
    await act(async () => {
      await router.navigate(-2);
    });
    expect(router.state.location.search).toBe('');
    expect(screen.queryByText('Transcript b')).not.toBeInTheDocument();
  });

  it('New clears the ID, preserves unrelated query parameters and resets the composer', async () => {
    const { router } = setup({
      initialEntries: ['/chat?conversationId=a&keep=yes'],
    });
    await screen.findByText('Transcript a');
    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: 'Unsent' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: /new conversation/i }),
    );
    expect(router.state.location.search).toBe('?keep=yes');
    expect(screen.getByTestId('chat-input')).toHaveValue('');
    expect(screen.queryByText('Transcript a')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByText('Transcript a');
  });

  it.each(['missing', 'error'])(
    'preserves an unresolved %s target and allows normal recovery',
    async (mode) => {
      const { router, chatBodies } = setup({
        initialEntries: ['/chat?conversationId=unavailable'],
        lookup: () =>
          mode === 'missing'
            ? mockJsonResponse({ items: [] })
            : mockJsonResponse(
                { message: 'History unavailable' },
                { status: 503 },
              ),
      });
      expect(
        await screen.findByTestId('chat-selection-error'),
      ).toHaveTextContent(
        mode === 'missing' ? 'Conversation not found.' : 'History unavailable',
      );
      expect(router.state.location.search).toBe('?conversationId=unavailable');
      expect(screen.getByTestId('chat-send')).toBeDisabled();
      expect(chatBodies).toHaveLength(0);
      await select(b.title);
      await screen.findByText('Transcript b');
      expect(
        screen.queryByTestId('chat-selection-error'),
      ).not.toBeInTheDocument();
      await userEvent.click(
        screen.getByRole('button', { name: /new conversation/i }),
      );
      expect(router.state.location.search).toBe('');
    },
  );

  it('ignores a late lookup after URL A has changed to B', async () => {
    const late = deferred<Response>();
    const { router } = setup({
      initialEntries: ['/chat?conversationId=old-a'],
      lookup: () => late.promise,
    });
    expect(await screen.findByTestId('chat-send')).toBeDisabled();
    await select(b.title);
    await screen.findByText('Transcript b');
    await act(async () => {
      late.resolve(
        mockJsonResponse({ items: [{ ...a, conversationId: 'old-a' }] }),
      );
    });
    expect(router.state.location.search).toBe('?conversationId=b');
    expect(screen.getByText('Transcript b')).toBeInTheDocument();
    expect(screen.queryByText('Transcript old-a')).not.toBeInTheDocument();
  });

  it('keeps a selected fallback current through the existing sidebar refresh flow', async () => {
    let saved = {
      ...a,
      conversationId: 'old',
      flags: { workingFolder: '/first' },
    };
    const { router, lookupIds } = setup({
      initialEntries: ['/chat?conversationId=old'],
      items: [b],
      lookup: () => mockJsonResponse({ items: [saved] }),
    });
    await screen.findByText('Transcript old');
    const count = lookupIds.length;
    saved = { ...saved, flags: { workingFolder: '/updated' } };
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(lookupIds.length).toBeGreaterThan(count));
    await waitFor(() =>
      expect(screen.getByTestId('chat-working-folder')).toHaveValue('/updated'),
    );
    expect(router.state.location.search).toBe('?conversationId=old');
  });

  it.each([
    { status: 500, bodyStatus: 'started' },
    { status: 200, bodyStatus: 'started' },
    { status: 202, bodyStatus: 'rejected' },
  ])(
    'does not write a draft ID for a non-accepted $status/$bodyStatus send',
    async ({ status, bodyStatus }) => {
      const { router, chatBodies } = setup({
        items: [],
        chatFetch: () =>
          mockJsonResponse(
            { status: bodyStatus, message: 'Not accepted' },
            { status },
          ),
      });
      await submit();
      await screen.findByText('Not accepted');
      expect(chatBodies).toHaveLength(1);
      expect(router.state.location.search).toBe('');
    },
  );

  it('replaces the draft URL only after an actual 202 started acknowledgement', async () => {
    const accepted = deferred<Response>();
    const { router, chatBodies } = setup({
      initialEntries: ['/before', '/chat?keep=yes'],
      items: [],
      chatFetch: () => accepted.promise,
    });
    await submit();
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(router.state.location.search).toBe('?keep=yes');
    const id = String(chatBodies[0].conversationId);
    await act(async () => {
      accepted.resolve(
        mockJsonResponse(
          { status: 'started', conversationId: id, inflightId: 'accepted' },
          { status: 202 },
        ),
      );
    });
    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get('conversationId'),
      ).toBe(id),
    );
    expect(new URLSearchParams(router.state.location.search).get('keep')).toBe(
      'yes',
    );
    expect(router.state.historyAction).toBe('REPLACE');
    await act(async () => {
      await router.navigate(-1);
    });
    expect(await screen.findByText('Before Chat')).toBeInTheDocument();
  });

  it('does not steal selection when a draft send is accepted after navigation to B', async () => {
    const accepted = deferred<Response>();
    const { router, chatBodies, getConversationId } = setup({
      chatFetch: () => accepted.promise,
    });
    await submit('Draft A');
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    const draftId = getConversationId();
    await select(b.title);
    await screen.findByText('Transcript b');
    await act(async () => {
      accepted.resolve(
        mockJsonResponse(
          { status: 'started', conversationId: draftId, inflightId: 'late' },
          { status: 202 },
        ),
      );
    });
    expect(router.state.location.search).toBe('?conversationId=b');
    expect(screen.getByText('Transcript b')).toBeInTheDocument();
    expect(screen.queryByText('Draft A')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
    const socketMessages = (globalThis.__wsMock?.instances ?? [])
      .flatMap((socket) => socket.sent)
      .map((message) => JSON.parse(message) as { type?: string });
    expect(
      socketMessages.filter((message) => message.type === 'cancel_inflight'),
    ).toHaveLength(0);
  });

  it('ignores an accepted A response after switching to B and back to A', async () => {
    const accepted = deferred<Response>();
    const { router, chatBodies } = setup({
      initialEntries: ['/chat?conversationId=a'],
      chatFetch: () => accepted.promise,
    });
    await screen.findByText('Transcript a');
    await submit('Old A send');
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    await select(b.title);
    await screen.findByText('Transcript b');
    await select(a.title);
    await screen.findByText('Transcript a');
    await act(async () => {
      accepted.resolve(
        mockJsonResponse(
          {
            status: 'started',
            conversationId: 'remapped-old-a',
            inflightId: 'late',
          },
          { status: 202 },
        ),
      );
    });
    expect(router.state.location.search).toBe('?conversationId=a');
    expect(screen.getByText('Transcript a')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
  });

  it('keeps New current when the abandoned draft is accepted later', async () => {
    const accepted = deferred<Response>();
    const { router, chatBodies } = setup({ chatFetch: () => accepted.promise });
    await submit('Abandoned draft');
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    await userEvent.click(
      screen.getByRole('button', { name: /new conversation/i }),
    );
    await act(async () => {
      accepted.resolve(
        mockJsonResponse(
          {
            status: 'started',
            conversationId: chatBodies[0].conversationId,
            inflightId: 'late',
          },
          { status: 202 },
        ),
      );
    });
    expect(router.state.location.search).toBe('');
    expect(screen.queryByText('Abandoned draft')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument();
  });
});
