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

describe('Chat page streaming', () => {
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
    expect(await screen.findByText('Hi')).toBeInTheDocument();
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
          'data: {"type":"tool-request","callId":"c1","name":"noop"}\n\n',
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

      expect(await screen.findByText('Hi there')).toBeInTheDocument();

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
});
