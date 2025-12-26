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

const modelPayload = {
  provider: 'lmstudio',
  available: true,
  toolsAvailable: true,
  models: [{ key: 'm1', displayName: 'Model 1', type: 'gguf' }],
};

const streamFrames = [
  'data: {"type":"tool-result","callId":"c1","result":{"results":[{"repo":"repo","relPath":"docs/main.txt","chunk":"fixture chunk"}],"modelId":"text-embedding-qwen3-embedding-4b"}}\n\n',
  'data: {"type":"final","message":{"content":"Here is what I found","role":"assistant"}}\n\n',
  'data: {"type":"complete"}\n\n',
];

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
          json: async () => modelPayload,
        }) as unknown as Response;
      }
      if (href.includes('/chat')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          body: streamFromFrames(streamFrames),
        }) as unknown as Response;
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);
    const user = userEvent.setup();

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() => expect(modelSelect).toBeEnabled());
    const input = await screen.findByTestId('chat-input');
    await waitFor(() => expect(input).toBeEnabled());

    fireEvent.change(input, { target: { value: 'Question?' } });
    const sendButton = screen.getByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await user.click(sendButton);
    });

    expect(
      await screen.findByText(/Here is what I found/i),
    ).toBeInTheDocument();

    const toggle = await screen.findByTestId('citations-toggle');
    await user.click(toggle);
    const pathRow = await screen.findByTestId('citation-path');
    expect(pathRow).toHaveTextContent('repo/docs/main.txt');
    expect(pathRow).not.toHaveTextContent('(');
    const chunk = await screen.findByTestId('citation-chunk');
    expect(chunk).toHaveTextContent('fixture chunk');
  });
});
