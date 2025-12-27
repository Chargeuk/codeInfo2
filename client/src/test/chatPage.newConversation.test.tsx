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
const providerPayload = {
  providers: [
    {
      id: 'lmstudio',
      label: 'LM Studio',
      available: true,
      toolsAvailable: true,
    },
  ],
};

describe('Chat page new conversation control', () => {
  it('aborts the current stream, clears transcript, and refocuses input', async () => {
    const abortFns: jest.Mock[] = [];
    const OriginalAbortController = global.AbortController;

    class MockAbortController {
      signal: AbortSignal;
      abort: jest.Mock;

      constructor() {
        this.signal = { aborted: false } as AbortSignal;
        this.abort = jest.fn(() => {
          this.signal = { ...this.signal, aborted: true } as AbortSignal;
        });
        abortFns.push(this.abort);
      }
    }

    // @ts-expect-error partial mock is sufficient for tests
    global.AbortController = MockAbortController;

    try {
      const stream = new ReadableStream<Uint8Array>({
        start() {
          // keep stream open until aborted
        },
      });

      mockFetch.mockImplementation((url: RequestInfo | URL) => {
        const href = typeof url === 'string' ? url : url.toString();
        if (href.includes('/chat/providers')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => providerPayload,
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

      const user = userEvent.setup();
      const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
      render(<RouterProvider router={router} />);

      const modelSelect = await screen.findByRole('combobox', {
        name: /model/i,
      });
      await waitFor(() => expect(modelSelect).toHaveTextContent('Model 1'));

      const input = await screen.findByTestId('chat-input');
      fireEvent.change(input, { target: { value: 'Hello' } });
      const sendButton = await screen.findByTestId('chat-send');
      await waitFor(() => expect(sendButton).toBeEnabled());

      const abortCountBeforeSend = abortFns.length;

      await act(async () => {
        await user.click(sendButton);
      });

      await waitFor(() => expect(sendButton).toBeDisabled());

      await waitFor(() =>
        expect(abortFns.length).toBeGreaterThan(abortCountBeforeSend),
      );
      const sendAbort = abortFns[abortCountBeforeSend];
      const newConversationButton = screen.getByRole('button', {
        name: /new conversation/i,
      });

      await act(async () => {
        await user.click(newConversationButton);
      });

      expect(sendAbort).toHaveBeenCalled();
      expect(
        screen.getByText(/Transcript will appear here/i),
      ).toBeInTheDocument();
      expect(modelSelect).toHaveTextContent('Model 1');
      await waitFor(() => expect(input).toHaveFocus());
    } finally {
      global.AbortController = OriginalAbortController;
    }
  });
});
