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

describe('Chat page stop control', () => {
  it('cancels an in-flight stream and shows a stopped status bubble', async () => {
    const abortFns: jest.Mock[] = [];
    const OriginalAbortController = global.AbortController;
    class MockAbortController {
      signal: AbortSignal;
      abort: jest.Mock;
      constructor() {
        this.signal = {
          aborted: false,
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
        } as unknown as AbortSignal;
        this.abort = jest.fn(() => {
          this.signal = { ...this.signal, aborted: true } as AbortSignal;
        });
        abortFns.push(this.abort);
      }
    }
    // @ts-expect-error partial mock is sufficient for tests
    global.AbortController = MockAbortController;

    try {
      let reads = 0;
      const reader = {
        read: jest.fn<() => Promise<ReadableStreamReadResult<Uint8Array>>>(
          () => {
            reads += 1;
            if (reads === 1) {
              return Promise.resolve({
                value: new TextEncoder().encode('data: {"type":"token"}\n\n'),
                done: false,
              });
            }
            return new Promise(() => {});
          },
        ),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => modelList,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: reader.read,
            }),
          } as unknown as ReadableStream<Uint8Array>,
        });

      const user = userEvent.setup();
      const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
      render(<RouterProvider router={router} />);

      const modelSelect = await screen.findByRole('combobox', {
        name: /model/i,
      });
      expect(modelSelect).toBeEnabled();
      const input = await screen.findByTestId('chat-input');
      fireEvent.change(input, { target: { value: 'Hello' } });
      const sendButton = await screen.findByTestId('chat-send');

      await waitFor(() => expect(sendButton).toBeEnabled());

      await act(async () => {
        await user.click(sendButton);
      });

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

      const stopButton = await screen.findByTestId('chat-stop');
      expect(stopButton).toBeVisible();

      await act(async () => {
        await user.click(stopButton);
      });

      expect(abortFns.at(-1)).toHaveBeenCalled();
      await waitFor(() => expect(sendButton).toBeEnabled());
      expect(
        await screen.findByText(/generation stopped/i),
      ).toBeInTheDocument();
    } finally {
      global.AbortController = OriginalAbortController;
    }
  });
});
