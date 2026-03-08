import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ensureCodexFlagsPanelExpanded } from './support/ensureCodexFlagsPanelExpanded';
import { asFetchImplementation, mockJsonResponse } from './support/fetchMock';

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

function mockProvidersWithBodies(chatBodies: Array<Record<string, unknown>>) {
  mockFetch.mockImplementation(
    asFetchImplementation(
      async (url: RequestInfo | URL, opts?: RequestInit) => {
        const href = typeof url === 'string' ? url : url.toString();
        if (href.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        if (href.includes('/conversations') && opts?.method !== 'POST') {
          return mockJsonResponse({ items: [], nextCursor: null });
        }
        if (href.includes('/chat/providers')) {
          return mockJsonResponse({
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
        if (href.includes('/chat/models') && href.includes('provider=codex')) {
          return mockJsonResponse({
            provider: 'codex',
            available: true,
            toolsAvailable: true,
            codexDefaults: {
              sandboxMode: 'workspace-write',
              approvalPolicy: 'on-failure',
              modelReasoningEffort: 'medium',
              networkAccessEnabled: true,
              webSearchEnabled: true,
            },
            codexWarnings: [],
            models: [
              {
                key: 'gpt-5.1-codex-max',
                displayName: 'gpt-5.1-codex-max',
                type: 'codex',
                supportedReasoningEfforts: ['medium', 'high'],
                defaultReasoningEffort: 'medium',
              },
              {
                key: 'gpt-5.2',
                displayName: 'gpt-5.2',
                type: 'codex',
                supportedReasoningEfforts: ['minimal'],
                defaultReasoningEffort: 'minimal',
              },
            ],
          });
        }
        if (href.includes('/chat/models')) {
          return mockJsonResponse({
            provider: 'lmstudio',
            available: true,
            toolsAvailable: true,
            models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
          });
        }
        if (href.includes('/chat') && opts?.method === 'POST') {
          if (opts?.body) {
            try {
              chatBodies.push(JSON.parse(opts.body as string));
            } catch {
              chatBodies.push({});
            }
          }

          const body = chatBodies.at(-1) ?? {};
          return mockJsonResponse(
            {
              status: 'started',
              conversationId: body.conversationId,
              inflightId: 'i1',
              provider: body.provider,
              model: body.model,
            },
            { status: 202 },
          );
        }
        return mockJsonResponse({});
      },
    ),
  );
}

describe('Codex web search flag payloads', () => {
  it('omits web search flag for LM Studio, includes toggled value for Codex, and resets to default', async () => {
    const user = userEvent.setup();
    const chatBodies: Record<string, unknown>[] = [];
    mockProvidersWithBodies(chatBodies);

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    const sendButton = await screen.findByTestId('chat-send');

    await waitFor(() => expect(input).toBeEnabled());
    await user.clear(input);
    await user.type(input, 'Hello LM');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(chatBodies.length).toBeGreaterThanOrEqual(1));
    const lmBody = chatBodies[0];
    expect(lmBody.provider).toBe('lmstudio');
    expect(lmBody).not.toHaveProperty('webSearchEnabled');

    const newConversationButton = screen.getByRole('button', {
      name: /new conversation/i,
    });
    await act(async () => {
      await user.click(newConversationButton);
    });

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await user.click(providerSelect);
    const codexOption = await screen.findByRole('option', {
      name: /openai codex/i,
    });
    await user.click(codexOption);

    await ensureCodexFlagsPanelExpanded();

    const webSearchSwitch = await screen.findByTestId('web-search-switch');
    await waitFor(() => expect(webSearchSwitch).toBeChecked());
    await user.click(webSearchSwitch);

    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() =>
      expect(modelSelect).toHaveTextContent('gpt-5.1-codex-max'),
    );

    await user.clear(input);
    await user.type(input, 'Hello Codex');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(chatBodies.length).toBeGreaterThanOrEqual(2));
    const codexBody = chatBodies[1];
    expect(codexBody.provider).toBe('codex');
    expect(codexBody.webSearchEnabled).toBe(false);

    await act(async () => {
      await user.click(newConversationButton);
    });

    await ensureCodexFlagsPanelExpanded();
    const resetSwitch = await screen.findByTestId('web-search-switch');
    await waitFor(() => expect(resetSwitch).toBeChecked());
  });
});
