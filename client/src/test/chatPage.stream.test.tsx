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
const loggedEntries: unknown[] = [];

await jest.unstable_mockModule('../logging/transport', () => ({
  sendLogs: jest.fn((entries: unknown[]) => loggedEntries.push(...entries)),
  flushQueue: jest.fn(),
  _getQueue: () => loggedEntries,
}));

const mockedSystemContext = 'Stay concise and cite sources.';
await jest.unstable_mockModule('../constants/systemContext', () => ({
  SYSTEM_CONTEXT: mockedSystemContext,
}));

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  loggedEntries.length = 0;
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

function streamFromFrames(frames: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      frames.forEach((frame) => controller.enqueue(encoder.encode(frame)));
      controller.close();
    },
  });
}

function delayedStream(frames: string[], delayMs: number) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      setTimeout(() => {
        frames.forEach((frame) => controller.enqueue(encoder.encode(frame)));
        controller.close();
      }, delayMs);
    },
  });
}

function timedStream(frames: Array<{ frame: string; delay: number }>) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const lastDelay = Math.max(...frames.map((item) => item.delay), 0);
      frames.forEach(({ frame, delay }) => {
        setTimeout(() => controller.enqueue(encoder.encode(frame)), delay);
      });
      setTimeout(() => controller.close(), lastDelay + 10);
    },
  });
}

describe('Chat page streaming', () => {
  it('shows processing status chip, thinking placeholder after idle, then completes', async () => {
    jest.useFakeTimers();
    try {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => modelList,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: delayedStream(
            [
              'data: {"type":"final","message":{"content":"All done","role":"assistant"}}\n\n',
              'data: {"type":"complete"}\n\n',
            ],
            1500,
          ),
        });

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
      render(<RouterProvider router={router} />);

      const input = await screen.findByTestId('chat-input');
      fireEvent.change(input, { target: { value: 'Hello' } });
      const sendButton = screen.getByTestId('chat-send');

      await act(async () => {
        await user.click(sendButton);
      });

      expect(await screen.findByTestId('status-chip')).toHaveTextContent(
        /Processing/i,
      );

      await act(async () => {
        jest.advanceTimersByTime(1100);
      });

      expect(screen.getByTestId('thinking-placeholder')).toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      expect(await screen.findByText(/All done/)).toBeInTheDocument();
      expect(screen.getByTestId('status-chip')).toHaveTextContent(/Complete/i);
      expect(screen.queryByTestId('thinking-placeholder')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows thinking after a pre-token pause then hides on first streamed text', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: timedStream([
          {
            frame: 'data: {"type":"token","content":"First chunk"}\n\n',
            delay: 1200,
          },
          {
            frame:
              'data: {"type":"final","message":{"content":"First chunk","role":"assistant"}}\n\n',
            delay: 1500,
          },
          { frame: 'data: {"type":"complete"}\n\n', delay: 1600 },
        ]),
      });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = screen.getByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());

    await waitFor(() => expect(sendButton).toBeEnabled());

    await waitFor(() => expect(sendButton).toBeEnabled());

    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await user.click(sendButton);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });

    expect(screen.getByTestId('thinking-placeholder')).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    expect(await screen.findByText(/First chunk/)).toBeInTheDocument();
    expect(screen.queryByTestId('thinking-placeholder')).toBeNull();
  }, 15000);

  it('restarts thinking after a mid-turn silent gap and stops once text resumes', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: timedStream([
          {
            frame: 'data: {"type":"token","content":"Hello"}\n\n',
            delay: 0,
          },
          {
            frame: 'data: {"type":"token","content":" again"}\n\n',
            delay: 1400,
          },
          {
            frame:
              'data: {"type":"final","message":{"content":"Hello again","role":"assistant"}}\n\n',
            delay: 1400,
          },
          { frame: 'data: {"type":"complete"}\n\n', delay: 1600 },
        ]),
      });

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

    expect(await screen.findByText('Hello')).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1300));
    });

    expect(screen.getByTestId('thinking-placeholder')).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    const assistantTexts = await screen.findAllByTestId('assistant-markdown');
    expect(
      assistantTexts.some((node) => node.textContent?.includes('Hello again')),
    ).toBe(true);
    expect(screen.queryByTestId('thinking-placeholder')).toBeNull();
  }, 15000);

  it('stays processing after final until the complete frame arrives', async () => {
    jest.useFakeTimers();
    try {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => modelList,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: timedStream([
            {
              frame:
                'data: {"type":"final","message":{"content":"All done","role":"assistant"}}\n\n',
              delay: 0,
            },
            { frame: 'data: {"type":"complete"}\n\n', delay: 800 },
          ]),
        });

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
      render(<RouterProvider router={router} />);

      const input = await screen.findByTestId('chat-input');
      fireEvent.change(input, { target: { value: 'Hello' } });
      const sendButton = screen.getByTestId('chat-send');

      await act(async () => {
        await user.click(sendButton);
      });

      expect(await screen.findByTestId('status-chip')).toHaveTextContent(
        /Processing/i,
      );

      await act(async () => {
        jest.advanceTimersByTime(20);
      });

      expect(await screen.findByText(/All done/)).toBeInTheDocument();
      expect(screen.getByTestId('status-chip')).toHaveTextContent(
        /Processing/i,
      );

      await act(async () => {
        jest.advanceTimersByTime(800);
      });

      expect(screen.getByTestId('status-chip')).toHaveTextContent(/Complete/i);
    } finally {
      jest.useRealTimers();
    }
  });

  it('waits for tool-result after complete before marking complete', async () => {
    jest.useFakeTimers();
    try {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => modelList,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: timedStream([
            {
              frame:
                'data: {"type":"tool-request","callId":"1","name":"VectorSearch","stage":"request","parameters":{"query":"q"}}\n\n',
              delay: 0,
            },
            {
              frame:
                'data: {"type":"final","message":{"content":"Working","role":"assistant"}}\n\n',
              delay: 0,
            },
            { frame: 'data: {"type":"complete"}\n\n', delay: 800 },
            {
              frame:
                'data: {"type":"tool-result","callId":"1","name":"VectorSearch","result":{"results":[{"hostPath":"/repo/a.txt","chunk":"x","score":0.9}]}}\n\n',
              delay: 1200,
            },
          ]),
        });

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
      render(<RouterProvider router={router} />);

      const input = await screen.findByTestId('chat-input');
      fireEvent.change(input, { target: { value: 'Hello' } });
      const sendButton = screen.getByTestId('chat-send');

      await act(async () => {
        await user.click(sendButton);
      });

      expect(await screen.findByTestId('status-chip')).toHaveTextContent(
        /Processing/i,
      );

      await act(async () => {
        jest.advanceTimersByTime(10);
      });

      expect(await screen.findByText(/Working/)).toBeInTheDocument();
      expect(screen.getByTestId('status-chip')).toHaveTextContent(
        /Processing/i,
      );

      await act(async () => {
        jest.advanceTimersByTime(800);
      });
      expect(screen.getByTestId('status-chip')).toHaveTextContent(
        /Processing/i,
      );

      await act(async () => {
        jest.advanceTimersByTime(400);
      });

      await waitFor(() =>
        expect(screen.getByTestId('status-chip')).toHaveTextContent(
          /Complete/i,
        ),
      );
    } finally {
      jest.useRealTimers();
    }
  });
  it('streams tokens into one assistant bubble and re-enables send', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamFromFrames([
          'data: {"type":"token","content":"Hi"}\n\n',
          'data: {"type":"final","message":{"content":"Hi","role":"assistant"}}\n\n',
        ]),
      });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    expect(modelSelect).toBeEnabled();
    const input = await screen.findByTestId('chat-input');
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: 'Hello' } });
    await waitFor(() => expect(input).toHaveValue('Hello'));
    const sendButton = screen.getByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(sendButton).toBeDisabled());
    const assistantTexts = await screen.findAllByTestId('assistant-markdown');
    expect(
      assistantTexts.some((node) => node.textContent?.includes('Hi')),
    ).toBe(true);
  });

  it('renders <think> content as a collapsible section', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamFromFrames([
          'data: {"type":"final","message":{"content":"Visible reply <think>internal chain</think>","role":"assistant"}}\n\n',
          'data: {"type":"complete"}\n\n',
        ]),
      });

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

    expect(await screen.findByText('Visible reply')).toBeInTheDocument();
    const toggle = screen.getByTestId('think-toggle');
    expect(toggle).toBeInTheDocument();
    expect(screen.queryByTestId('think-content')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(await screen.findByTestId('think-content')).toHaveTextContent(
      'internal chain',
    );
  });

  it('shows an inline error bubble when the stream errors', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamFromFrames(['data: {"type":"error","message":"boom"}\n\n']),
      });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    expect(modelSelect).toBeEnabled();
    const input = await screen.findByTestId('chat-input');
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: 'Hello' } });
    await waitFor(() => expect(input).toHaveValue('Hello'));
    const sendButton = screen.getByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    expect(await screen.findByText(/boom/i)).toBeInTheDocument();
    expect(screen.getByTestId('status-chip')).toHaveTextContent(/Failed/i);
    expect(screen.queryByTestId('thinking-placeholder')).toBeNull();
  });

  it('does not surface tool payload text as an assistant reply when only tool-result is streamed', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamFromFrames([
          'data: {"type":"tool-request","callId":"t5","name":"VectorSearch"}\n\n',
          'data: {"type":"tool-result","callId":"t5","name":"VectorSearch","stage":"success","parameters":{"query":"hi"},"result":{"results":[{"repo":"r","relPath":"a.txt","hostPath":"/h/a.txt","chunk":"one","chunkId":"1","score":0.7,"modelId":"m"}],"files":[{"hostPath":"/h/a.txt","highestMatch":0.7,"chunkCount":1,"lineCount":1}]}}\n\n',
          'data: {"type":"final","message":{"data":{"role":"assistant","content":[{"type":"text","text":"<|channel|>final<|message|>ok"}]}},"roundIndex":0}\n\n',
          'data: {"type":"complete"}\n\n',
        ]),
      });

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

    // Tool block should render, but raw JSON payload should not appear as assistant text.
    expect(
      await screen.findByText(/VectorSearch · Success/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/"chunk"/i)).toBeNull();
  });

  it('suppresses assistant JSON vector payload without callId', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamFromFrames([
          'data: {"type":"tool-request","callId":"t6","name":"VectorSearch"}\n\n',
          'data: {"type":"tool-result","callId":"t6","name":"VectorSearch","stage":"success","parameters":{"query":"hi"},"result":{"results":[{"hostPath":"/h/a.txt","chunk":"one","score":0.7,"lineCount":2}],"files":[{"hostPath":"/h/a.txt","highestMatch":0.7,"chunkCount":1,"lineCount":2}]}}\n\n',
          'data: {"type":"final","message":{"role":"assistant","content":"{\\"results\\":[{\\"hostPath\\":\\"/h/a.txt\\",\\"chunk\\":\\"one\\",\\"score\\":0.7}]}"}}\n\n',
          'data: {"type":"complete"}\n\n',
        ]),
      });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = screen.getByTestId('chat-send');

    await act(async () => {
      await user.click(sendButton);
    });

    await expect(
      screen.findByText(/VectorSearch · Success/i),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByText(/one/)).toBeNull();
  });

  it('aborts the stream when the page unmounts', async () => {
    const abortFns: jest.Mock[] = [];
    const OriginalAbortController = global.AbortController;
    class MockAbortController {
      signal = {
        aborted: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      } as unknown as AbortSignal;
      abort = jest.fn(() => {
        this.signal = { ...this.signal, aborted: true } as AbortSignal;
      });
      constructor() {
        abortFns.push(this.abort);
      }
    }
    // @ts-expect-error partial mock is sufficient for tests
    global.AbortController = MockAbortController;

    try {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => modelList,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: new ReadableStream<Uint8Array>({
            // keep stream open until abort closes it
            start() {},
          }),
        });

      const user = userEvent.setup();
      const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
      const { unmount } = render(<RouterProvider router={router} />);

      const modelSelect = await screen.findByRole('combobox', {
        name: /model/i,
      });
      expect(modelSelect).toBeEnabled();
      const input = await screen.findByTestId('chat-input');
      expect(input).toBeEnabled();
      fireEvent.change(input, { target: { value: 'Hello' } });
      await waitFor(() => expect(input).toHaveValue('Hello'));
      const sendButton = screen.getByTestId('chat-send');

      await waitFor(() => expect(sendButton).toBeEnabled());
      await act(async () => {
        await user.click(sendButton);
      });

      await waitFor(() => expect(sendButton).toBeDisabled());
      unmount();
      expect(abortFns.at(-1)).toHaveBeenCalled();
    } finally {
      global.AbortController = OriginalAbortController;
    }
  });

  it('logs tool events without rendering them as bubbles', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamFromFrames([
          'data: {"type":"tool-request","callId":"c1","name":"VectorSearch"}\n\n',
          'data: {"type":"tool-result","callId":"c1","stage":"toolCallResult"}\n\n',
          'data: {"type":"token","content":"Hi"}\n\n',
          'data: {"type":"final","message":{"content":"Hi there","role":"assistant"}}\n\n',
          'data: {"type":"complete"}\n\n',
        ]),
      });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = screen.getByTestId('chat-send');

    try {
      await act(async () => {
        await user.click(sendButton);
      });

      const assistantTexts = await screen.findAllByTestId('assistant-markdown');
      expect(
        assistantTexts.some((node) => node.textContent?.includes('Hi there')),
      ).toBe(true);

      const bubbles = screen.getAllByTestId('chat-bubble');
      expect(bubbles.length).toBe(2);
      expect(
        logSpy.mock.calls.some(
          ([entry]) =>
            entry &&
            typeof entry === 'object' &&
            (entry as { message?: string }).message === 'chat tool event',
        ),
      ).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('sends tool event logs with client source and chat channel tag', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamFromFrames([
          'data: {"type":"tool-request","callId":"c1","name":"VectorSearch"}\n\n',
          'data: {"type":"tool-result","callId":"c1","name":"VectorSearch","result":{"results":[]}}\n\n',
          'data: {"type":"final","message":{"content":"Done","role":"assistant"}}\n\n',
          'data: {"type":"complete"}\n\n',
        ]),
      });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = screen.getByTestId('chat-send');

    await act(async () => {
      await user.click(sendButton);
    });

    await screen.findByText('Done');

    await waitFor(
      () => {
        expect(loggedEntries.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );

    const payload = loggedEntries[0] as {
      source?: string;
      context?: { channel?: string };
    };
    expect(payload.source).toBe('client');
    expect(payload.context?.channel).toBe('client-chat');
  });

  it('prepends system context to chat payloads when provided', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamFromFrames(['data: {"type":"complete"}\n\n']),
      });

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

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const body = (mockFetch.mock.calls[1]?.[1] as RequestInit | undefined)
      ?.body as string;
    const parsed = JSON.parse(body);
    expect(parsed.messages[0]).toEqual({
      role: 'system',
      content: mockedSystemContext,
    });
    expect(parsed.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Hello',
    });
  });

  it('renders user and assistant bubbles with 14px border radius', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamFromFrames([
          'data: {"type":"final","message":{"content":"Reply","role":"assistant"}}\n\n',
          'data: {"type":"complete"}\n\n',
        ]),
      });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, 'Hello');
    const sendButton = screen.getByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await user.click(sendButton);
    });

    const bubbles = await screen.findAllByTestId('chat-bubble');
    const assistantBubble = bubbles.find(
      (bubble) => bubble.getAttribute('data-role') === 'assistant',
    );
    const userBubble = bubbles.find(
      (bubble) => bubble.getAttribute('data-role') === 'user',
    );

    expect(assistantBubble).toBeTruthy();
    expect(userBubble).toBeTruthy();

    const assistantRadius = getComputedStyle(
      assistantBubble as HTMLElement,
    ).borderRadius;
    const userRadius = getComputedStyle(userBubble as HTMLElement).borderRadius;

    expect(assistantRadius).toBe('14px');
    expect(userRadius).toBe('14px');
  });
});
