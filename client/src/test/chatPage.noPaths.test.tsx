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

describe('Chat citations without host paths', () => {
  it('shows citation without hostPath and renders chunk', async () => {
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
          'data: {"type":"tool-result","callId":"c1","result":{"results":[{"repo":"repo","relPath":"notes/info.md","chunk":"hostless chunk","chunkId":"chunk-2"}],"modelId":null}}\n\n',
          'data: {"type":"final","message":{"content":"Done","role":"assistant"}}\n\n',
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

    expect(await screen.findByText(/Done/)).toBeInTheDocument();
    const pathRow = await screen.findByTestId('citation-path');
    expect(pathRow).toHaveTextContent('repo/notes/info.md');
    expect(pathRow).not.toHaveTextContent('(');
    const chunk = await screen.findByTestId('citation-chunk');
    expect(chunk).toHaveTextContent('hostless chunk');
  });
});
