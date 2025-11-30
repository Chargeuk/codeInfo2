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

function streamWithToolFrames() {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"tool-request","callId":"t1","name":"VectorSearch"}\n\n',
        ),
      );
      setTimeout(() => {
        [
          'data: {"type":"tool-result","callId":"t1","name":"VectorSearch","result":{"results":[{"repo":"repo","relPath":"main.txt","hostPath":"/host/repo/main.txt","chunk":"sample chunk"}]}}\n\n',
          'data: {"type":"final","message":{"content":"Answer","role":"assistant"}}\n\n',
          'data: {"type":"complete"}\n\n',
        ].forEach((frame) => controller.enqueue(encoder.encode(frame)));
        controller.close();
      }, 5);
    },
  });
}

describe('Chat tool call visibility', () => {
  it('shows spinner during tool call then collapsible results with paths and chunks', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamWithToolFrames(),
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

    expect(await screen.findByTestId('tool-spinner')).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId('tool-toggle')).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId('tool-toggle'));

    const path = await screen.findByTestId('tool-result-path');
    expect(path).toHaveTextContent('repo/main.txt');
    expect(path).toHaveTextContent('/host/repo/main.txt');
    expect(screen.getByTestId('tool-result-chunk')).toHaveTextContent(
      'sample chunk',
    );
  });
});
