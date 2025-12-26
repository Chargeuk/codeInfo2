import { ReadableStream } from 'node:stream/web';
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

const modelList = [{ key: 'm1', displayName: 'Model 1', type: 'gguf' }];

function mockChatFetch(stream: ReadableStream<Uint8Array>) {
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
          models: modelList,
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

function vectorSearchStream() {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"tool-request","callId":"t1","name":"VectorSearch"}\n\n',
        ),
      );
      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"tool-result","callId":"t1","name":"VectorSearch","result":{"files":[{"hostPath":"/repo/a.txt","highestMatch":0.82,"chunkCount":3,"lineCount":20},{"hostPath":"/repo/b.txt","highestMatch":0.5,"chunkCount":1,"lineCount":5}],"results":[],"modelId":"m1"},"parameters":{"query":"hello","limit":5}}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"type":"final","message":{"role":"assistant","content":"Answer"}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 10);
    },
  });
}

function listReposStream() {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"tool-request","callId":"t2","name":"ListIngestedRepositories"}\n\n',
        ),
      );
      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"tool-result","callId":"t2","name":"ListIngestedRepositories","result":{"repos":[{"id":"docs","description":"Project docs","hostPath":"/host/docs","containerPath":"/data/docs","counts":{"files":2,"chunks":4,"embedded":4},"modelId":"embed-1"}],"lockedModelId":"embed-1"},"parameters":{}}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"type":"final","message":{"role":"assistant","content":"Docs listed"}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 10);
    },
  });
}

function toolErrorStream() {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"tool-request","callId":"t3","name":"VectorSearch"}\n\n',
        ),
      );
      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"tool-result","callId":"t3","name":"VectorSearch","stage":"error","errorTrimmed":{"code":"MODEL_UNAVAILABLE","message":"missing model"},"errorFull":{"code":"MODEL_UNAVAILABLE","message":"missing model","stack":"trace"},"parameters":{"query":"oops"}}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"type":"final","message":{"role":"assistant","content":"Error"}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 10);
    },
  });
}

function codexToolStream() {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"type":"thread","threadId":"codex-thread"}\n\n'),
      );
      controller.enqueue(
        encoder.encode(
          'data: {"type":"tool-request","callId":"c1","name":"VectorSearch","parameters":{"query":"hello"}}\n\n',
        ),
      );
      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"tool-result","callId":"c1","name":"VectorSearch","stage":"success","result":{"results":[{"repo":"repo","relPath":"src/index.ts","chunk":"text","hostPath":"/h/src/index.ts","containerPath":"/c/src/index.ts","score":0.9}],"files":[{"hostPath":"/h/src/index.ts","highestMatch":0.9,"chunkCount":1,"lineCount":1,"repo":"repo"}],"modelId":"embed-1"},"parameters":{"query":"hello"}}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"type":"final","message":{"role":"assistant","content":"reply"}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 10);
    },
  });
}

function mockCodexChatFetch(stream: ReadableStream<Uint8Array>, tools = true) {
  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('/chat/providers')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          providers: [
            {
              id: 'codex',
              label: 'OpenAI Codex',
              available: true,
              toolsAvailable: tools,
              reason: tools ? undefined : 'tools unavailable',
            },
            {
              id: 'lmstudio',
              label: 'LM Studio',
              available: true,
              toolsAvailable: true,
            },
          ],
        }),
      }) as unknown as Response;
    }
    if (href.includes('/chat/models')) {
      const providerParam = new URL(href).searchParams.get('provider');
      if (providerParam === 'codex') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'codex',
            available: true,
            toolsAvailable: tools,
            models: [
              {
                key: 'gpt-5.1-codex-max',
                displayName: 'gpt-5.1-codex-max',
                type: 'api',
              },
            ],
          }),
        }) as unknown as Response;
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          provider: 'lmstudio',
          available: true,
          toolsAvailable: true,
          models: modelList,
        }),
      }) as unknown as Response;
    }
    if (href.endsWith('/chat')) {
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

describe('Chat tool detail rendering', () => {
  it('shows closed summary then renders vector file aggregation and parameters when expanded', async () => {
    mockChatFetch(vectorSearchStream());

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = screen.getByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await user.click(sendButton);
    });

    await screen.findByText('VectorSearch · Success');
    expect(screen.queryByTestId('tool-file-item')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('tool-toggle'));

    const fileItems = await screen.findAllByTestId('tool-file-item');
    expect(fileItems).toHaveLength(2);
    expect(fileItems[0]).toHaveTextContent('/repo/a.txt');
    expect(fileItems[0]).toHaveTextContent('match 0.82');
    expect(fileItems[0]).toHaveTextContent('chunks 3');
    expect(fileItems[0]).toHaveTextContent('lines 20');

    const paramsSummary = screen.getByText('Parameters');
    expect(paramsSummary.closest('[aria-expanded]')).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await user.click(paramsSummary);
    await screen.findByText(/"query": "hello"/);
  });

  it('renders repository list with expandable metadata for ListIngestedRepositories', async () => {
    mockChatFetch(listReposStream());

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'List repos' } });
    const sendButton = screen.getByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await user.click(sendButton);
    });

    await screen.findByText('ListIngestedRepositories · Success');
    await user.click(screen.getByTestId('tool-toggle'));

    const repoItem = await screen.findByTestId('tool-repo-item');
    const repoToggle = within(repoItem).getByRole('button');
    await user.click(repoToggle);

    await within(repoItem).findByText(/Host path: \/host\/docs/);
    expect(
      within(repoItem).getByText(/Files: 2 · Chunks: 4 · Embedded: 4/),
    ).toBeVisible();
  });

  it('shows trimmed error and expands to full error payload', async () => {
    mockChatFetch(toolErrorStream());

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Oops' } });
    const sendButton = screen.getByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await user.click(sendButton);
    });

    await screen.findByText('VectorSearch · Failed');
    await user.click(screen.getByTestId('tool-toggle'));

    const trimmed = await screen.findByTestId('tool-error-trimmed');
    expect(trimmed).toHaveTextContent('MODEL_UNAVAILABLE');

    await user.click(screen.getByTestId('tool-error-toggle'));
    await screen.findByTestId('tool-error-full');
    expect(screen.getByTestId('tool-error-full')).toHaveTextContent('trace');
  });

  it('renders Codex tool results when tools are available', async () => {
    mockCodexChatFetch(codexToolStream(), true);

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Ask Codex' } });
    const sendButton = screen.getByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await user.click(sendButton);
    });

    await screen.findByText('VectorSearch · Success');
    await user.click(screen.getByTestId('tool-toggle'));

    const fileItem = await screen.findByTestId('tool-file-item');
    expect(fileItem).toHaveTextContent('/h/src/index.ts');
    expect(fileItem).toHaveTextContent('match 0.90');
  });

  it('disables Codex send when tools are unavailable', async () => {
    mockCodexChatFetch(codexToolStream(), false);

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Blocked' } });
    const sendButton = screen.getByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeDisabled());
    const toolsBanner = await screen.findByTestId('codex-tools-banner');
    expect(toolsBanner).toHaveTextContent('Codex requires MCP tools');
  });
});
