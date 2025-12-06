import { ReadableStream } from 'node:stream/web';
import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
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

afterEach(() => {
  jest.useRealTimers();
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

type ProviderEntry = {
  id: string;
  label: string;
  available: boolean;
  toolsAvailable?: boolean;
  reason?: string;
};

type ModelResponse = {
  provider: string;
  available: boolean;
  toolsAvailable?: boolean;
  models: Array<{ key: string; displayName: string; type?: string }>;
};

function mockChatFetch(
  stream: ReadableStream<Uint8Array>,
  options: {
    providers?: ProviderEntry[];
    models?: Record<string, ModelResponse>;
  } = {},
) {
  const providers: ProviderEntry[] =
    options.providers ??
    ([
      {
        id: 'lmstudio',
        label: 'LM Studio',
        available: true,
        toolsAvailable: true,
      },
    ] as ProviderEntry[]);

  const modelMap: Record<string, ModelResponse> = {
    lmstudio: {
      provider: 'lmstudio',
      available: true,
      toolsAvailable: true,
      models: modelList,
    },
    ...(options.models ?? {}),
  };

  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('/chat/providers')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ providers }),
      }) as unknown as Response;
    }
    if (href.includes('/chat/models')) {
      const providerParam = new URL(href, 'http://localhost').searchParams.get(
        'provider',
      );
      const providerId = providerParam || 'lmstudio';
      const response =
        modelMap[providerId] ??
        modelMap.lmstudio ??
        ({
          provider: providerId,
          available: false,
          toolsAvailable: false,
          models: [],
        } satisfies ModelResponse);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => response,
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

function streamWithReasoningFrames() {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"token","content":"<|channel|>analysis<|message|>Need answer: Neil Armstrong."}\n\n',
        ),
      );
      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"token","content":" Continue analysis."}\n\n',
          ),
        );
      }, 60);
      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"final","message":{"role":"assistant","content":"<|channel|>analysis<|message|>Need answer: Neil Armstrong.<|end|><|start|>assistant<|channel|>final<|message|>He was the first person on the Moon."}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 200);
    },
  });
}

function streamWithReasoningAndToolFrames() {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"tool-request","callId":"t2","name":"VectorSearch"}\n\n',
        ),
      );
      controller.enqueue(
        encoder.encode(
          'data: {"type":"token","content":"<|channel|>analysis<|message|>Looking up context."}\n\n',
        ),
      );

      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"tool-result","callId":"t2","name":"VectorSearch","result":{"results":[{"repo":"repo","relPath":"doc.txt","chunk":"context"}]}}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"type":"token","content":"<|channel|>final<|message|>Final answer after tool."}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 40);
    },
  });
}

function streamWithReasoningAndToolFinalMessageOnly() {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"tool-request","callId":"t3","name":"VectorSearch"}\n\n',
        ),
      );
      controller.enqueue(
        encoder.encode(
          'data: {"type":"token","content":"<|channel|>analysis<|message|>Finding docs."}\n\n',
        ),
      );

      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"final","message":{"role":"tool","content":{"toolCallId":"t3","name":"VectorSearch","result":{"results":[{"repo":"repo","relPath":"doc.txt","chunk":"context"}]}}}}\n\n',
          ),
        );
      }, 60);

      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"token","content":"<|channel|>final<|message|>Answer with context."}\n\n',
          ),
        );
      }, 120);

      setTimeout(() => {
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 200);
    },
  });
}

function streamWithToolGapNoNewText() {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"type":"token","content":"Hi"}\n\n'),
      );
      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"tool-request","callId":"tool-gap","name":"VectorSearch"}\n\n',
          ),
        );
      }, 100);

      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"tool-result","callId":"tool-gap","name":"VectorSearch","result":{"results":[],"files":[]}}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"type":"final","message":{"role":"assistant","content":"Hi"}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 1800);
    },
  });
}

function streamWithCodexAnalysisFrames() {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"analysis","content":"Codex thinking."}\n\n',
        ),
      );
      setTimeout(() => {
        controller.enqueue(
          encoder.encode('data: {"type":"token","content":"Final"}\n\n'),
        );
      }, 50);
      setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"final","message":{"role":"assistant","content":"Final"}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
        controller.close();
      }, 120);
    },
  });
}

describe('Chat reasoning collapse', () => {
  it('collapses analysis with spinner and streams final separately', async () => {
    mockChatFetch(streamWithReasoningFrames());

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Explain the moon landing' } });

    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());

    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await screen.findByTestId('think-toggle');

    await waitFor(() =>
      expect(
        screen.getByText('He was the first person on the Moon.'),
      ).toBeInTheDocument(),
    );

    expect(screen.queryByTestId('think-spinner')).toBeNull();

    await user.click(screen.getByTestId('think-toggle'));
    expect(screen.getByTestId('think-content')).toHaveTextContent(
      'Need answer: Neil Armstrong.',
    );
  });

  it('keeps tool block inline before trailing final text when reasoning is present', async () => {
    mockChatFetch(streamWithReasoningAndToolFrames());

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Run tool' } });

    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());

    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    const toolRow = await screen.findByTestId('tool-row');

    await waitFor(() =>
      expect(screen.queryByTestId('tool-spinner')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText('Final answer after tool.')).toBeInTheDocument(),
    );

    const answer = screen.getByText('Final answer after tool.');
    expect(
      toolRow.compareDocumentPosition(answer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(await screen.findByTestId('think-toggle'));
    expect(screen.getByTestId('think-content')).toHaveTextContent(
      'Looking up context.',
    );
  });

  it('ends spinner when tool completion only appears inside a final tool message with reasoning', async () => {
    mockChatFetch(streamWithReasoningAndToolFinalMessageOnly());

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Run tool with reasoning' } });

    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());

    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    const toolRow = await screen.findByTestId('tool-row');

    const answer = await screen.findByText('Answer with context.');
    expect(screen.queryByTestId('tool-spinner')).not.toBeInTheDocument();
    expect(
      toolRow.compareDocumentPosition(answer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows Codex thought process when analysis frames stream', async () => {
    mockChatFetch(streamWithCodexAnalysisFrames(), {
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
      models: {
        codex: {
          provider: 'codex',
          available: true,
          toolsAvailable: true,
          models: [
            { key: 'gpt-5.1-codex-max', displayName: 'gpt-5.1-codex-max' },
          ],
        },
      },
    });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByLabelText('Provider');
    await user.click(providerSelect);
    await user.click(await screen.findByText('OpenAI Codex'));

    const modelSelect = await screen.findByLabelText('Model');
    await user.click(modelSelect);
    await user.click(
      await screen.findByRole('option', { name: 'gpt-5.1-codex-max' }),
    );

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Explain' } });
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());

    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await screen.findByTestId('think-toggle');

    await waitFor(() => expect(screen.getByText(/Final/)).toBeInTheDocument());

    await user.click(screen.getByTestId('think-toggle'));
    expect(screen.getByTestId('think-content')).toHaveTextContent(
      'Codex thinking.',
    );
    expect(screen.queryByTestId('think-spinner')).toBeNull();
  });

  it('keeps thinking spinner off during tool-only waits once visible text exists', async () => {
    mockChatFetch(streamWithToolGapNoNewText());

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Tool gap' } });

    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());

    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    expect(
      await screen.findByText(/Hi/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1400));
    });

    expect(screen.queryByTestId('thinking-placeholder')).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    expect(screen.getByTestId('status-chip')).toHaveTextContent('Complete');
    expect(screen.queryByTestId('thinking-placeholder')).toBeNull();
  }, 10000);
});
