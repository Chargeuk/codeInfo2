import { ReadableStream } from 'node:stream/web';
import { jest } from '@jest/globals';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

function makeStream(frames: unknown[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      frames.forEach((frame) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(frame)}\n\n`),
        ),
      );
      controller.close();
    },
  });
}

function mockCodexAvailable(chatBodies: Array<Record<string, unknown>>) {
  const streams = [
    makeStream([
      { type: 'thread', threadId: 'thread-codex' },
      { type: 'token', content: 'Hello' },
      { type: 'final', message: { role: 'assistant', content: 'Hello world' } },
      { type: 'complete', threadId: 'thread-codex' },
    ]),
    makeStream([
      { type: 'final', message: { role: 'assistant', content: 'Second turn' } },
      { type: 'complete', threadId: 'thread-codex' },
    ]),
  ];

  mockFetch.mockImplementation((url: RequestInfo | URL, opts?: RequestInit) => {
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
    if (href.includes('/chat')) {
      if (opts?.body) {
        try {
          chatBodies.push(JSON.parse(opts.body as string));
        } catch {
          chatBodies.push({});
        }
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        body: streams.shift() ?? makeStream([]),
      }) as unknown as Response;
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as unknown as Response;
  });
}

function mockCodexToolsMissing() {
  const stream = makeStream([
    { type: 'final', message: { role: 'assistant', content: 'ok' } },
    { type: 'complete' },
  ]);

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
              available: true,
              toolsAvailable: false,
              reason: 'MCP tools missing',
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
          toolsAvailable: false,
          reason: 'MCP tools missing',
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

    const banner = await screen.findByTestId('codex-unavailable-banner');
    expect(banner).toHaveTextContent('Compose mounts');
    const link = within(banner).getByRole('link', { name: /codex \(cli\)/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('#codex-cli'));

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() => expect(modelSelect).toHaveTextContent('Model 1'));
  });

  it('keeps Codex disabled when tools are unavailable', async () => {
    mockCodexToolsMissing();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await userEvent.click(providerSelect);
    const codexOption = await screen.findByRole('option', {
      name: /openai codex/i,
    });
    await userEvent.click(codexOption);

    const toolsBanner = await screen.findByTestId('codex-tools-banner');
    expect(toolsBanner).toBeInTheDocument();

    const input = await screen.findByTestId('chat-input');
    expect(input).toBeDisabled();
    const sendButton = screen.getByTestId('chat-send');
    expect(sendButton).toBeDisabled();
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

  it('sends Codex chat and reuses threadId on subsequent turns', async () => {
    const chatBodies: Record<string, unknown>[] = [];
    mockCodexAvailable(chatBodies);

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await userEvent.click(providerSelect);
    const codexOption = await screen.findByRole('option', {
      name: /openai codex/i,
    });
    await userEvent.click(codexOption);

    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() =>
      expect(modelSelect).toHaveTextContent('gpt-5.1-codex-max'),
    );

    const input = await screen.findByTestId('chat-input');
    const sendButton = screen.getByTestId('chat-send');

    await userEvent.clear(input);
    await userEvent.type(input, 'Hello Codex');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() =>
      expect(screen.getByText(/Hello world/i)).toBeInTheDocument(),
    );

    await waitFor(() => {
      expect(providerSelect).toHaveAttribute('aria-disabled', 'true');
    });

    await userEvent.type(input, 'Second turn');
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(chatBodies.length).toBeGreaterThanOrEqual(2));

    const firstBody = chatBodies[0];
    const secondBody = chatBodies[1];

    expect(firstBody.provider).toBe('codex');
    expect(firstBody.threadId).toBeUndefined();
    expect(secondBody.provider).toBe('codex');
    expect(secondBody.threadId).toBe('thread-codex');
  });
});
