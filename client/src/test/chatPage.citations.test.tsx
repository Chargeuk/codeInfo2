import { ReadableStream } from 'node:stream/web';
import { jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

afterEach(() => {
  mockFetch.mockReset();
});

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
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

describe('Chat citations rendering', () => {
  it('renders citations with repo/relPath and hostPath', async () => {
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
          'data: {"type":"tool-result","callId":"c1","result":{"results":[{"repo":"repo","relPath":"docs/main.txt","hostPath":"/host/repo/docs/main.txt","chunk":"fixture chunk","chunkId":"chunk-1","modelId":"text-embedding-qwen3-embedding-4b"}],"modelId":"text-embedding-qwen3-embedding-4b"}}\n\n',
          'data: {"type":"final","message":{"content":"Here is what I found","role":"assistant"}}\n\n',
          'data: {"type":"complete"}\n\n',
        ]),
      });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Question?' } });
    const sendButton = screen.getByTestId('chat-send');

    await act(async () => {
      await user.click(sendButton);
    });

    expect(
      await screen.findByText(/Here is what I found/i),
    ).toBeInTheDocument();
    const pathRow = await screen.findByTestId('citation-path');
    expect(pathRow).toHaveTextContent(
      'repo/docs/main.txt (/host/repo/docs/main.txt)',
    );
    const chunk = await screen.findByTestId('citation-chunk');
    expect(chunk).toHaveTextContent('fixture chunk');
  });
});
