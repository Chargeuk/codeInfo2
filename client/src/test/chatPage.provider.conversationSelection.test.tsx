import { jest } from '@jest/globals';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
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
  mockFetch.mockImplementation((url: RequestInfo | URL, opts?: RequestInit) => {
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
              conversationId: isCodex ? codexConversationId : lmConversationId,
              role: 'user',
              content: isCodex ? 'hello codex' : 'hello lm',
              model: 'm1',
              provider: isCodex ? 'codex' : 'lmstudio',
              toolCalls: null,
              status: 'ok',
              createdAt: '2025-12-09T12:00:00.000Z',
            },
            {
              conversationId: isCodex ? codexConversationId : lmConversationId,
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
  });
}

describe('Chat page provider follows selected conversation', () => {
  it('switches provider to selected conversation and shows turns', async () => {
    mockApi();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Codex conversation');

    const providerSelect = screen.getByTestId('provider-select');
    expect(providerSelect).toHaveTextContent(/LM Studio/i);

    const codexRowTitle = screen.getByText('Codex conversation');
    const codexRow = codexRowTitle.closest('[data-testid="conversation-row"]');
    if (!codexRow) {
      throw new Error('Codex conversation row not found');
    }
    await userEvent.click(codexRow);

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    const providerCombobox = screen.getByRole('combobox', {
      name: /provider/i,
    });
    expect(providerCombobox).toHaveAttribute('aria-disabled', 'true');

    const transcript = await screen.findByTestId('chat-transcript');
    expect(within(transcript).getByText('codex reply')).toBeInTheDocument();
  });
});
