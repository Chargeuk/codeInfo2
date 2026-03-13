import { jest } from '@jest/globals';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

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

const codexConversationId = 'conv-codex';
const lmConversationId = 'conv-lm';

function mockApi() {
  const chatBodies: Record<string, unknown>[] = [];

  mockFetch.mockImplementation(
    async (url: RequestInfo | URL, opts?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString();

      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok', mongoConnected: true }),
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

      if (href.includes('/chat/models') && href.includes('provider=lmstudio')) {
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
              {
                key: 'gpt-5.2',
                displayName: 'gpt-5.2',
                type: 'codex',
              },
            ],
          }),
        }) as unknown as Response;
      }

      if (href.includes('/conversations/') && href.includes('/turns')) {
        const isCodex = href.includes(codexConversationId);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                conversationId: isCodex
                  ? codexConversationId
                  : lmConversationId,
                role: 'user',
                content: isCodex ? 'hello codex' : 'hello lm',
                model: 'm1',
                provider: isCodex ? 'codex' : 'lmstudio',
                toolCalls: null,
                status: 'ok',
                createdAt: '2025-12-09T12:00:00.000Z',
              },
              {
                conversationId: isCodex
                  ? codexConversationId
                  : lmConversationId,
                role: 'assistant',
                content: isCodex ? 'codex reply' : 'lm reply',
                model: 'm1',
                provider: isCodex ? 'codex' : 'lmstudio',
                toolCalls: null,
                status: 'ok',
                createdAt: '2025-12-09T12:00:01.000Z',
              },
            ],
          }),
        }) as unknown as Response;
      }

      if (href.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                conversationId: codexConversationId,
                title: 'Codex conversation',
                provider: 'codex',
                model: 'gpt-5.1-codex-max',
                lastMessageAt: '2025-12-09T12:00:02.000Z',
                archived: false,
              },
              {
                conversationId: lmConversationId,
                title: 'LM conversation',
                provider: 'lmstudio',
                model: 'lm',
                lastMessageAt: '2025-12-09T11:59:59.000Z',
                archived: false,
              },
            ],
            nextCursor: undefined,
          }),
        }) as unknown as Response;
      }

      if (href.includes('/chat') && opts?.method === 'POST') {
        const body =
          opts?.body && typeof opts.body === 'string'
            ? (JSON.parse(opts.body) as Record<string, unknown>)
            : {};
        chatBodies.push(body);
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            status: 'started',
            conversationId: body.conversationId,
            inflightId: 'i1',
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

function getWsMessages() {
  const wsRegistry = (
    globalThis as unknown as {
      __wsMock?: { instances?: Array<{ sent: string[] }> };
    }
  ).__wsMock;

  return (wsRegistry?.instances ?? [])
    .flatMap((socket) => socket.sent)
    .map((entry) => {
      try {
        return JSON.parse(entry) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

async function startDraftRun() {
  const user = userEvent.setup();
  const { chatBodies } = mockApi();
  const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
  render(<RouterProvider router={router} />);

  await screen.findByText('Codex conversation');

  const input = screen.getByTestId('chat-input');
  await user.type(input, 'Hello inflight');

  await act(async () => {
    await user.click(screen.getByTestId('chat-send'));
  });

  await waitFor(() => expect(chatBodies).toHaveLength(1));

  return {
    user,
    draftConversationId: String(chatBodies[0]?.conversationId ?? ''),
  };
}

describe('Chat page sidebar conversation selection', () => {
  it('does not send cancel_inflight when switching conversations during an active run', async () => {
    const { user, draftConversationId } = await startDraftRun();

    const codexRowTitle = screen.getByText('Codex conversation');
    const codexRow = codexRowTitle.closest('[data-testid="conversation-row"]');
    if (!codexRow) {
      throw new Error('Codex conversation row not found');
    }

    await act(async () => {
      await user.click(codexRow);
    });

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    const cancelMessages = getWsMessages().filter(
      (msg) =>
        msg.type === 'cancel_inflight' &&
        msg.conversationId === draftConversationId,
    );

    expect(cancelMessages).toHaveLength(0);
  });

  it('shows only the selected conversation transcript and local state after switching', async () => {
    const { user } = await startDraftRun();

    expect(screen.getByText('Hello inflight')).toBeInTheDocument();
    expect(screen.getByText(/Responding.../i)).toBeInTheDocument();

    const codexRowTitle = screen.getByText('Codex conversation');
    const codexRow = codexRowTitle.closest('[data-testid="conversation-row"]');
    if (!codexRow) {
      throw new Error('Codex conversation row not found');
    }

    await act(async () => {
      await user.click(codexRow);
    });

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    const transcript = await screen.findByTestId('chat-transcript');
    expect(within(transcript).getByText('codex reply')).toBeInTheDocument();
    expect(
      within(transcript).queryByText('Hello inflight'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Responding.../i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeEnabled();
  });
});
