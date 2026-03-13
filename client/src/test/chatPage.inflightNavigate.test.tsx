import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { setupChatWsHarness } from './support/mockChatWs';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
});

const { default: App } = await import('../App');
const { default: ChatPage } = await import('../pages/ChatPage');
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'chat', element: <ChatPage /> },
    ],
  },
];

function mockProviderNextSendApi() {
  const chatBodies: Record<string, unknown>[] = [];

  mockFetch.mockImplementation(
    async (url: RequestInfo | URL, opts?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString();

      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }

      if (href.includes('/chat/providers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
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
          }),
        }) as unknown as Response;
      }

      if (href.includes('/chat/models') && href.includes('provider=codex')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'codex',
            available: true,
            toolsAvailable: true,
            codexDefaults: {
              sandboxMode: 'workspace-write',
              approvalPolicy: 'on-failure',
              modelReasoningEffort: 'high',
              networkAccessEnabled: true,
              webSearchEnabled: true,
            },
            codexWarnings: [],
            models: [
              {
                key: 'gpt-5.1-codex-max',
                displayName: 'gpt-5.1-codex-max',
                type: 'codex',
              },
            ],
          }),
        }) as unknown as Response;
      }

      if (href.includes('/chat/models')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'lmstudio',
            available: true,
            toolsAvailable: true,
            models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
          }),
        }) as unknown as Response;
      }

      if (href.includes('/conversations/c1/turns')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                conversationId: 'c1',
                role: 'user',
                content: 'Earlier prompt',
                model: 'lm',
                provider: 'lmstudio',
                toolCalls: null,
                status: 'ok',
                createdAt: '2025-01-01T00:00:00.000Z',
              },
              {
                conversationId: 'c1',
                role: 'assistant',
                content: 'Earlier reply',
                model: 'lm',
                provider: 'lmstudio',
                toolCalls: null,
                status: 'ok',
                createdAt: '2025-01-01T00:00:01.000Z',
              },
            ],
            inflight: {
              inflightId: 'i1',
              assistantText: 'Persisted partial',
              assistantThink: '',
              toolEvents: [],
              startedAt: '2025-01-01T00:00:02.000Z',
              seq: 3,
            },
          }),
        }) as unknown as Response;
      }

      if (href.includes('/conversations/') && href.includes('/turns')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [] }),
        }) as unknown as Response;
      }

      if (href.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                conversationId: 'c1',
                title: 'Conversation 1',
                provider: 'lmstudio',
                model: 'lm',
                source: 'REST',
                lastMessageAt: '2025-01-01T00:00:03.000Z',
                archived: false,
              },
            ],
            nextCursor: null,
          }),
        }) as unknown as Response;
      }

      if (href.includes('/chat') && opts?.method === 'POST') {
        const body =
          typeof opts.body === 'string'
            ? (JSON.parse(opts.body) as Record<string, unknown>)
            : {};
        chatBodies.push(body);
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            status: 'started',
            conversationId: body.conversationId,
            inflightId: `inflight-${chatBodies.length}`,
            provider: body.provider,
            model: body.model,
          }),
        }) as unknown as Response;
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
    },
  );

  return { chatBodies };
}

test('navigating away/back during inflight keeps persisted history + inflight', async () => {
  const turnsPayload = {
    items: [
      {
        conversationId: 'c1',
        role: 'user',
        content: 'In-flight user',
        model: 'm1',
        provider: 'lmstudio',
        toolCalls: null,
        status: 'ok',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      {
        conversationId: 'c1',
        role: 'assistant',
        content: 'Past reply',
        model: 'm1',
        provider: 'lmstudio',
        toolCalls: null,
        status: 'ok',
        createdAt: '2024-12-31T00:00:00.000Z',
      },
    ],
    inflight: {
      inflightId: 'i1',
      assistantText: 'Snapshot partial',
      assistantThink: '',
      toolEvents: [],
      startedAt: '2025-01-01T00:00:00.000Z',
      seq: 3,
    },
  };
  const conversationsPayload = {
    items: [
      {
        conversationId: 'c1',
        title: 'Conversation 1',
        provider: 'lmstudio',
        model: 'm1',
        source: 'REST',
        lastMessageAt: '2025-01-01T00:00:00.000Z',
        archived: false,
      },
    ],
    nextCursor: null,
  };

  const harness = setupChatWsHarness({
    mockFetch,
    conversations: conversationsPayload,
    turns: turnsPayload,
  });
  const user = userEvent.setup();

  const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
  render(<RouterProvider router={router} />);

  const row = await screen.findByTestId('conversation-row');
  await waitFor(() => expect(row).toBeEnabled());
  await user.click(row);

  await waitFor(() => {
    const debug = (
      window as unknown as { __chatDebug?: { activeConversationId?: string } }
    ).__chatDebug;
    expect(debug?.activeConversationId).toBe('c1');
  });

  await waitFor(() => {
    const debug = (
      window as unknown as { __chatDebug?: { turnsCount?: number } }
    ).__chatDebug;
    expect(debug?.turnsCount).toBeGreaterThan(0);
  });

  expect(await screen.findByText('Past reply')).toBeInTheDocument();
  const assistantTexts = screen
    .getAllByTestId('assistant-markdown')
    .map((node) => node.textContent ?? '');
  expect(assistantTexts.join('\n')).toContain('Snapshot partial');

  await act(async () => {
    await router.navigate('/');
    await router.navigate('/chat');
  });

  const rowAfter = await screen.findByTestId('conversation-row');
  await waitFor(() => expect(rowAfter).toBeEnabled());
  await user.click(rowAfter);

  await waitFor(() => {
    const debug = (
      window as unknown as { __chatDebug?: { activeConversationId?: string } }
    ).__chatDebug;
    expect(debug?.activeConversationId).toBe('c1');
  });

  await waitFor(() => {
    const debug = (
      window as unknown as { __chatDebug?: { turnsCount?: number } }
    ).__chatDebug;
    expect(debug?.turnsCount).toBeGreaterThan(0);
  });

  expect(await screen.findByText('Past reply')).toBeInTheDocument();
  const assistantTextsAfter = screen
    .getAllByTestId('assistant-markdown')
    .map((node) => node.textContent ?? '');
  expect(assistantTextsAfter.join('\n')).toContain('Snapshot partial');

  await act(async () => {
    harness.emitAssistantDelta({
      conversationId: 'c1',
      inflightId: 'i1',
      delta: ' + delta',
    });
  });

  expect(
    await screen.findByText('Snapshot partial + delta'),
  ).toBeInTheDocument();
});

test('provider changes during an active run apply only to the next send', async () => {
  const { chatBodies } = mockProviderNextSendApi();
  const user = userEvent.setup();

  const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
  render(<RouterProvider router={router} />);

  const row = await screen.findByTestId('conversation-row');
  await user.click(row);

  await waitFor(() =>
    expect(screen.getByTestId('provider-select')).toHaveTextContent(
      /LM Studio/i,
    ),
  );

  const providerSelect = screen.getByRole('combobox', { name: /provider/i });
  await user.click(providerSelect);
  await user.click(
    await screen.findByRole('option', { name: /openai codex/i }),
  );

  await waitFor(() =>
    expect(screen.getByTestId('provider-select')).toHaveTextContent(
      /OpenAI Codex/i,
    ),
  );

  await user.type(screen.getByTestId('chat-input'), 'Use codex next');
  await act(async () => {
    await user.click(screen.getByTestId('chat-send'));
  });

  await waitFor(() => expect(chatBodies).toHaveLength(1));
  expect(chatBodies[0]?.provider).toBe('codex');
});

test('revisiting the hidden conversation restores its persisted provider after a provider change', async () => {
  mockProviderNextSendApi();
  const user = userEvent.setup();

  const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
  render(<RouterProvider router={router} />);

  const row = await screen.findByTestId('conversation-row');
  await user.click(row);

  const providerSelect = await screen.findByRole('combobox', {
    name: /provider/i,
  });
  await user.click(providerSelect);
  await user.click(
    await screen.findByRole('option', { name: /openai codex/i }),
  );

  await waitFor(() =>
    expect(screen.getByTestId('provider-select')).toHaveTextContent(
      /OpenAI Codex/i,
    ),
  );

  await user.click(await screen.findByTestId('conversation-row'));

  await waitFor(() =>
    expect(screen.getByTestId('provider-select')).toHaveTextContent(
      /LM Studio/i,
    ),
  );
  expect(await screen.findByText('Earlier reply')).toBeInTheDocument();
});
