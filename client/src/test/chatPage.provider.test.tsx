import { ReadableStream } from 'node:stream/web';
import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
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

function mockChatApis() {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(
          'data: {"type":"final","message":{"role":"assistant","content":"ok"}}\n\n',
        ),
      );
      controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
      controller.close();
    },
  });

  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
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
              available: false,
              toolsAvailable: false,
              reason: 'Missing auth',
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
          models: [{ key: 'm1', displayName: 'Model 1', type: 'gguf' }],
        }),
      }) as unknown as Response;
    }
    if (href.includes('/chat')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        body: stream,
      }) as unknown as Response;
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as unknown as Response;
  });
}

describe('Chat provider selection', () => {
  it('shows Codex as unavailable with guidance banner', async () => {
    mockChatApis();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    expect(providerSelect).toBeInTheDocument();

    await userEvent.click(providerSelect);
    const codexOption = await screen.findByRole('option', {
      name: /openai codex/i,
    });
    expect(codexOption).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');

    const banner = await screen.findByText(/codex is currently disabled/i, {
      exact: false,
    });
    expect(banner).toBeInTheDocument();

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() => expect(modelSelect).toHaveTextContent('Model 1'));
  });

  it('locks the provider after sending the first message', async () => {
    mockChatApis();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() => expect(modelSelect).toBeEnabled());
    const input = await screen.findByTestId('chat-input');
    await waitFor(() => expect(input).toBeEnabled());
    const providerSelect = screen.getByRole('combobox', { name: /provider/i });
    const sendButton = screen.getByTestId('chat-send');

    await userEvent.type(input, 'Hello world');
    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => {
      expect(providerSelect).toHaveAttribute('aria-disabled', 'true');
    });
  });
});
