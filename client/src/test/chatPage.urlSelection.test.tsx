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

const draftProviders = {
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
    },
  ],
  selectedProvider: 'codex',
  selectedModel: 'server-default',
  selectedEndpointId: 'https://server.example/v1',
};

function draftModels(provider: string) {
  return mockJsonResponse({
    provider,
    available: true,
    toolsAvailable: true,
    defaultModel: 'server-default',
    models: [
      { key: 'server-default', displayName: 'Server default', type: 'gguf' },
      {
        key: 'shared',
        displayName: 'Shared',
        type: 'gguf',
        endpointId: 'https://alpha.example/v1',
      },
      { key: 'shared', displayName: 'Shared native', type: 'gguf' },
      {
        key: 'shared',
        displayName: 'Shared',
        type: 'gguf',
        endpointId: 'https://beta.example/v1',
      },
    ],
  });
}

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
    providers?: Record<string, unknown>;
    models?: (provider: string) => Response | Promise<Response>;
  } = {},
) {
  const sidebar = { items: options.items ?? [a, b], nextCursor: null };
  const harness = setupChatWsHarness({
    mockFetch,
    conversations: sidebar,
    chatFetch: options.chatFetch,
    providers: options.providers,
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
    if (options.models && url.pathname === '/chat/models') {
      return Promise.resolve(
        options.models(url.searchParams.get('provider') ?? 'lmstudio'),
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

function urlSelection(router: ReturnType<typeof createMemoryRouter>) {
  return Object.fromEntries(new URLSearchParams(router.state.location.search));
}

describe('Chat URL selection', () => {
  it.each([undefined, 'https://beta.example/v1'])(
    'restores an unsaved draft with endpoint %s over server bootstrap defaults',
    async (endpoint) => {
      const query = new URLSearchParams({
        provider: 'lmstudio',
        model: 'shared',
        keep: 'yes',
      });
      if (endpoint) query.set('endpoint', endpoint);
      const { router, chatBodies } = setup({
        initialEntries: [`/chat?${query}`],
        providers: draftProviders,
        models: draftModels,
      });
      await waitFor(() =>
        expect(screen.getByTestId('chat-send')).toBeEnabled(),
      );
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        'LM Studio',
      );
      expect(urlSelection(router)).toEqual(Object.fromEntries(query));
      const key = router.state.location.key;
      fireEvent.change(screen.getByTestId('chat-input'), {
        target: { value: 'Keep this unsent draft' },
      });
      await userEvent.click(screen.getByRole('combobox', { name: 'Provider' }));
      await userEvent.click(
        await screen.findByRole('option', { name: 'LM Studio' }),
      );
      await userEvent.click(screen.getByRole('combobox', { name: 'Model' }));
      const chosen = screen
        .getAllByRole('option')
        .find((option) => option.getAttribute('aria-selected') === 'true');
      if (!chosen) throw new Error('Missing selected model option');
      await userEvent.click(chosen);
      expect(router.state.location.key).toBe(key);
      expect(screen.getByTestId('chat-input')).toHaveValue(
        'Keep this unsent draft',
      );
      await submit();
      await waitFor(() => expect(chatBodies).toHaveLength(1));
      expect(chatBodies[0]).toMatchObject({
        provider: 'lmstudio',
        model: 'shared',
      });
      expect(chatBodies[0].endpointId).toBe(endpoint);
    },
  );

  it('pushes model and provider changes, restores drafts on Back/Forward and retains the visible folder', async () => {
    const { router, chatBodies } = setup({
      initialEntries: ['/chat?provider=lmstudio&model=shared&keep=yes'],
      providers: draftProviders,
      models: draftModels,
    });
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
    fireEvent.change(screen.getByTestId('chat-working-folder'), {
      target: { value: '/visible/repo' },
    });
    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: 'Unsent model draft' },
    });
    const originalKey = router.state.location.key;
    await userEvent.click(screen.getByRole('combobox', { name: 'Model' }));
    await userEvent.click(
      await screen.findByRole('option', { name: /shared.*beta\.example/i }),
    );
    expect(router.state.historyAction).toBe('PUSH');
    expect(urlSelection(router)).toEqual({
      provider: 'lmstudio',
      model: 'shared',
      endpoint: 'https://beta.example/v1',
      keep: 'yes',
    });
    expect(screen.getByTestId('chat-input')).toHaveValue('');
    expect(screen.getByTestId('chat-working-folder')).toHaveValue(
      '/visible/repo',
    );
    const endpointKey = router.state.location.key;
    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: 'Discard when returning to the native model' },
    });
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).not.toHaveTextContent(
        'beta.example',
      ),
    );
    expect(router.state.location.key).toBe(originalKey);
    expect(screen.getByTestId('chat-input')).toHaveValue('');
    await act(async () => {
      await router.navigate(1);
    });
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        'beta.example',
      ),
    );
    expect(router.state.location.key).toBe(endpointKey);
    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: 'Unsent provider draft' },
    });
    await userEvent.click(screen.getByRole('combobox', { name: 'Provider' }));
    await userEvent.click(
      await screen.findByRole('option', { name: 'OpenAI Codex' }),
    );
    await waitFor(() =>
      expect(urlSelection(router)).toEqual({
        provider: 'codex',
        model: 'server-default',
        keep: 'yes',
      }),
    );
    expect(screen.getByTestId('chat-input')).toHaveValue('');
    expect(screen.getByTestId('chat-working-folder')).toHaveValue(
      '/visible/repo',
    );
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        'LM Studio',
      ),
    );
    expect(router.state.location.key).toBe(endpointKey);
    await submit();
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]).toMatchObject({
      provider: 'lmstudio',
      model: 'shared',
      endpointId: 'https://beta.example/v1',
      working_folder: '/visible/repo',
    });
  });

  it('keeps a provider-only URL unresolved until that provider models load instead of publishing the previous model', async () => {
    const targetModels = deferred<Response>();
    const { router, chatBodies } = setup({
      initialEntries: ['/chat?provider=codex&model=server-default&keep=yes'],
      providers: draftProviders,
      models: (provider) =>
        provider === 'lmstudio' ? targetModels.promise : draftModels(provider),
    });
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
    try {
      await act(async () => {
        await router.navigate('/chat?provider=lmstudio&keep=yes');
      });
      expect(screen.getByTestId('chat-send')).toBeDisabled();
      expect(urlSelection(router)).toEqual({
        provider: 'lmstudio',
        keep: 'yes',
      });
    } finally {
      await act(async () => {
        targetModels.resolve(
          mockJsonResponse({
            provider: 'lmstudio',
            available: true,
            toolsAvailable: true,
            defaultModel: 'lm-next',
            models: [{ key: 'lm-next', displayName: 'LM Next', type: 'gguf' }],
          }),
        );
      });
    }
    await waitFor(() =>
      expect(urlSelection(router)).toEqual({
        provider: 'lmstudio',
        model: 'lm-next',
        keep: 'yes',
      }),
    );
    await submit();
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]).toMatchObject({
      provider: 'lmstudio',
      model: 'lm-next',
    });
    expect(chatBodies[0].endpointId).toBeUndefined();
  });

  it('removes contradictory endpoint metadata when the saved conversation is native', async () => {
    const { router, chatBodies } = setup({
      initialEntries: [
        '/chat?conversationId=a&provider=codex&model=wrong&endpoint=wrong',
      ],
    });
    await screen.findByText('Transcript a');
    await waitFor(() =>
      expect(urlSelection(router)).toEqual({
        conversationId: 'a',
        provider: 'lmstudio',
        model: 'm1',
      }),
    );
    expect(router.state.historyAction).toBe('REPLACE');
    await submit();
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0].endpointId).toBeUndefined();
  });

  it.each(['provider', 'model'] as const)(
    '%s reset clears an active draft and retains its visible folder without cancelling it',
    async (selection) => {
      const { emitInflightSnapshot, chatBodies } = setup({
        initialEntries: ['/chat?provider=lmstudio&model=shared'],
        providers: draftProviders,
        models: draftModels,
      });
      await waitFor(() =>
        expect(screen.getByTestId('chat-send')).toBeEnabled(),
      );
      fireEvent.change(screen.getByTestId('chat-working-folder'), {
        target: { value: '/visible/repo' },
      });
      await submit('Running draft');
      await waitFor(() => expect(chatBodies).toHaveLength(1));
      await emitInflightSnapshot({
        conversationId: String(chatBodies[0].conversationId),
        inflightId: 'old-run',
        assistantText: 'Old partial reply',
      });
      await screen.findByText('Old partial reply');
      await userEvent.click(
        screen.getByRole('combobox', {
          name: selection === 'provider' ? 'Provider' : 'Model',
        }),
      );
      await userEvent.click(
        await screen.findByRole('option', {
          name:
            selection === 'provider'
              ? 'OpenAI Codex'
              : /shared.*beta\.example/i,
        }),
      );
      await waitFor(() =>
        expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument(),
      );
      expect(screen.queryByText('Old partial reply')).not.toBeInTheDocument();
      expect(screen.queryByText('Running draft')).not.toBeInTheDocument();
      expect(screen.getByTestId('chat-input')).toHaveValue('');
      expect(screen.getByTestId('chat-working-folder')).toHaveValue(
        '/visible/repo',
      );
      expect(screen.getByTestId('chat-working-folder')).toBeEnabled();
      const sent = (globalThis.__wsMock?.instances ?? []).flatMap(
        (socket) => socket.sent,
      );
      expect(
        sent
          .map((entry) => JSON.parse(entry) as { type: string })
          .filter((entry) => entry.type === 'cancel_inflight'),
      ).toHaveLength(0);
    },
  );

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
        initialEntries: [
          '/chat?conversationId=old&provider=codex&model=wrong&endpoint=wrong&keep=yes',
        ],
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
      await waitFor(() =>
        expect(urlSelection(router)).toEqual({
          conversationId: 'old',
          provider: 'lmstudio',
          model: 'saved-model',
          endpoint: 'saved-endpoint',
          keep: 'yes',
        }),
      );
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
    await waitFor(() =>
      expect(urlSelection(router)).toEqual({
        conversationId: 'a',
        provider: 'lmstudio',
        model: 'm1',
      }),
    );
    const selectedKey = router.state.location.key;
    expect(urlSelection(router)).toMatchObject({
      conversationId: 'a',
      provider: 'lmstudio',
      model: 'm1',
    });
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
    expect(urlSelection(router)).toMatchObject({
      conversationId: 'b',
      provider: 'lmstudio',
      model: 'm1',
    });
    await act(async () => {
      await router.navigate(-2);
    });
    expect(urlSelection(router)).toEqual({ provider: 'lmstudio', model: 'm1' });
    expect(screen.queryByText('Transcript b')).not.toBeInTheDocument();
  });

  it('New clears the ID, preserves unrelated query parameters and resets the composer', async () => {
    const { router } = setup({
      initialEntries: ['/chat?conversationId=a&keep=yes'],
      items: [{ ...a, flags: { workingFolder: '/saved/repo' } }, b],
    });
    await screen.findByText('Transcript a');
    await waitFor(() =>
      expect(screen.getByTestId('chat-working-folder')).toHaveValue(
        '/saved/repo',
      ),
    );
    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: 'Unsent' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: /new conversation/i }),
    );
    expect(urlSelection(router)).toEqual({
      keep: 'yes',
      provider: 'lmstudio',
      model: 'm1',
    });
    expect(screen.getByTestId('chat-input')).toHaveValue('');
    expect(screen.getByTestId('chat-working-folder')).toHaveValue(
      '/saved/repo',
    );
    expect(screen.queryByText('Transcript a')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByText('Transcript a');
  });

  it('restores each saved folder including empty after New retains the visible folder', async () => {
    setup({
      initialEntries: ['/chat?conversationId=a'],
      items: [{ ...a, flags: { workingFolder: '/saved/repo' } }, b],
    });
    await screen.findByText('Transcript a');
    await waitFor(() =>
      expect(screen.getByTestId('chat-working-folder')).toHaveValue(
        '/saved/repo',
      ),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /new conversation/i }),
    );
    expect(screen.getByTestId('chat-working-folder')).toHaveValue(
      '/saved/repo',
    );
    await select(b.title);
    await screen.findByText('Transcript b');
    await waitFor(() =>
      expect(screen.getByTestId('chat-working-folder')).toHaveValue(''),
    );
    await select(a.title);
    await screen.findByText('Transcript a');
    await waitFor(() =>
      expect(screen.getByTestId('chat-working-folder')).toHaveValue(
        '/saved/repo',
      ),
    );
  });

  it('preserves replay identity through page history mapping for a pending user receipt', async () => {
    const accepted = deferred<Response>();
    let history: Record<string, unknown>[] = [];
    const { chatBodies, turnsIds } = setup({
      initialEntries: ['/chat?conversationId=a'],
      turns: () => mockJsonResponse({ items: history }),
      chatFetch: () => accepted.promise,
    });
    await submit('Pending receipt');
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    try {
      await waitFor(() =>
        expect(screen.getByTestId('user-ack-tick')).toHaveAttribute(
          'data-delivery-status',
          'dispatched',
        ),
      );
      history = [
        {
          conversationId: 'a',
          turnId: 'stored-user',
          role: 'user',
          content: 'Pending receipt',
          provider: 'lmstudio',
          model: 'm1',
          status: 'ok',
          createdAt: '2026-01-01T00:00:00.000Z',
          runtime: { replay: { inflightId: chatBodies[0].inflightId } },
        },
      ];
      const fetchCount = turnsIds.length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });
      await waitFor(() => expect(turnsIds.length).toBeGreaterThan(fetchCount));
      await waitFor(() => {
        expect(screen.getAllByTestId('user-ack-tick')).toHaveLength(1);
        expect(screen.getByTestId('user-ack-tick')).toHaveAttribute(
          'data-delivery-status',
          'acknowledged',
        );
      });
      expect(screen.getAllByText('Pending receipt')).toHaveLength(1);
    } finally {
      await act(async () => {
        accepted.resolve(
          mockJsonResponse(
            {
              status: 'started',
              conversationId: chatBodies[0].conversationId,
              inflightId: chatBodies[0].inflightId,
            },
            { status: 202 },
          ),
        );
      });
    }
  });

  it('copies stored receipt metadata through history hydration', async () => {
    setup({
      initialEntries: ['/chat?conversationId=a'],
      turns: () =>
        mockJsonResponse({
          items: [
            {
              conversationId: 'a',
              turnId: 'stored',
              role: 'assistant',
              content: 'Stored reply',
              provider: 'lmstudio',
              model: 'm1',
              status: 'ok',
              createdAt: '2026-01-01T00:00:00.000Z',
              firstUpdateAt: '2026-01-01T00:00:01.000Z',
              lastUpdateAt: '2026-01-01T00:00:03.000Z',
            },
          ],
        }),
    });
    await screen.findByText('Stored reply');
    await userEvent.click(screen.getByTestId('bubble-info'));
    expect(
      await screen.findByTestId('bubble-info-first-update'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('bubble-info-last-update')).toBeInTheDocument();
  });

  it('forwards a late persisted receipt without restoring running controls', async () => {
    const { emitInflightSnapshot, emitFinal } = setup({
      initialEntries: ['/chat?conversationId=a'],
      turns: () => mockJsonResponse({ items: [] }),
    });
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
    await emitInflightSnapshot({
      conversationId: 'a',
      inflightId: 'receipt-run',
      assistantText: 'Finished reply',
    });
    await screen.findByText('Finished reply');
    await emitFinal({
      conversationId: 'a',
      inflightId: 'receipt-run',
      status: 'ok',
    });
    await waitFor(() =>
      expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument(),
    );
    const socket = globalThis.__wsMock?.last();
    if (!socket) throw new Error('Missing Chat WebSocket');
    await act(async () => {
      socket._receive({
        protocolVersion: 'v1',
        type: 'turn_persisted',
        conversationId: 'a',
        seq: 100,
        inflightId: 'receipt-run',
        turnId: 'real-assistant-id',
        firstUpdateAt: '2026-01-01T00:00:01.000Z',
        lastUpdateAt: '2026-01-01T00:00:03.000Z',
      });
    });
    expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-working-folder')).toBeEnabled();
    await userEvent.click(screen.getByTestId('bubble-info'));
    expect(
      await screen.findByTestId('bubble-info-first-update'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('bubble-info-last-update')).toBeInTheDocument();
    expect(screen.getAllByText('Finished reply')).toHaveLength(1);
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
      expect(urlSelection(router)).toEqual({
        provider: 'lmstudio',
        model: 'm1',
      });
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
    expect(urlSelection(router)).toMatchObject({
      conversationId: 'b',
      provider: 'lmstudio',
      model: 'm1',
    });
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
    expect(urlSelection(router)).toMatchObject({ conversationId: 'old' });
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
      expect(urlSelection(router)).toEqual({
        provider: 'lmstudio',
        model: 'm1',
      });
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
    expect(urlSelection(router)).toEqual({
      keep: 'yes',
      provider: 'lmstudio',
      model: 'm1',
    });
    const id = String(chatBodies[0].conversationId);
    await act(async () => {
      accepted.resolve(
        mockJsonResponse(
          {
            status: 'started',
            conversationId: id,
            inflightId: chatBodies[0].inflightId,
          },
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

  it('does not let a matching draft acceptance overtake pending sidebar navigation to B', async () => {
    const accepted = deferred<Response>();
    const { router, chatBodies } = setup({
      chatFetch: () => accepted.promise,
    });
    await submit('Draft A');
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    const row = screen
      .getByText(b.title)
      .closest('[data-testid="conversation-row"]');
    if (!row) throw new Error('Missing conversation B row');
    const navigationObserved = deferred<void>();
    const refreshObserved = deferred<void>();
    const unsubscribe = router.subscribe(({ location }) => {
      if (new URLSearchParams(location.search).get('conversationId') === 'b') {
        navigationObserved.resolve();
      }
    });
    const baseFetch = mockFetch.getMockImplementation()!;
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
        !url.searchParams.has('conversationId')
      ) {
        refreshObserved.resolve();
      }
      return baseFetch(input, init);
    });
    try {
      await act(async () => {
        fireEvent.click(row);
        await navigationObserved.promise;
        accepted.resolve(
          mockJsonResponse(
            {
              status: 'started',
              conversationId: chatBodies[0].conversationId,
              inflightId: chatBodies[0].inflightId,
            },
            { status: 202 },
          ),
        );
        await refreshObserved.promise;
        // The acceptance finished before React committed the sidebar selection.
        expect(row).not.toHaveClass('Mui-selected');
        expect(urlSelection(router)).toMatchObject({ conversationId: 'b' });
      });
    } finally {
      unsubscribe();
      mockFetch.mockImplementation(baseFetch);
    }
    await screen.findByText('Transcript b');
    expect(urlSelection(router)).toMatchObject({
      conversationId: 'b',
      provider: 'lmstudio',
      model: 'm1',
    });
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
    expect(urlSelection(router)).toMatchObject({
      conversationId: 'a',
      provider: 'lmstudio',
      model: 'm1',
    });
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
    expect(urlSelection(router)).toEqual({ provider: 'lmstudio', model: 'm1' });
    expect(screen.queryByText('Abandoned draft')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument();
  });
});
