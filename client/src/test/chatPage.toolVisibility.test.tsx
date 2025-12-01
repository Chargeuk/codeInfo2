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

function mockChatFetch(stream: ReadableStream<Uint8Array>) {
  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.endsWith('/chat/models')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => modelList,
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

function streamWithoutToolResultButWithToolMessage() {
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
          'data: {"type":"final","message":{"role":"tool","content":{"toolCallId":"t1","name":"VectorSearch","result":{"results":[{"repo":"repo","relPath":"main.txt","hostPath":"/host/repo/main.txt","chunk":"sample chunk"}]}}}}\n\n',
          'data: {"type":"final","message":{"content":"Answer after tool","role":"assistant"}}\n\n',
          'data: {"type":"complete"}\n\n',
        ].forEach((frame) => controller.enqueue(encoder.encode(frame)));
        controller.close();
      }, 40);
    },
  });
}

describe('Chat tool call visibility', () => {
  it('shows spinner during tool call then collapsible results with paths and chunks', async () => {
    mockChatFetch(streamWithToolFrames());

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

    const toolRow = await screen.findByTestId('tool-row');

    await waitFor(() =>
      expect(screen.queryByTestId('tool-spinner')).not.toBeInTheDocument(),
    );
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

    const answerText = screen.getByText('Answer');
    expect(
      toolRow.compareDocumentPosition(answerText) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('stops spinner and keeps tool block in place when server only sends a final tool message', async () => {
    mockChatFetch(streamWithoutToolResultButWithToolMessage());

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hi' } });
    const sendButton = screen.getByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await user.click(sendButton);
    });

    const toolRow = await screen.findByTestId('tool-row');

    await waitFor(() =>
      expect(screen.queryByTestId('tool-spinner')).not.toBeInTheDocument(),
    );
    const answerText = screen.getByText('Answer after tool');
    expect(
      toolRow.compareDocumentPosition(answerText) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
