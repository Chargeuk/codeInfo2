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

describe('Chat reasoning collapse', () => {
  it('collapses analysis with spinner and streams final separately', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamWithReasoningFrames(),
      });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Explain the moon landing' } });

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
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamWithReasoningAndToolFrames(),
      });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Run tool' } });

    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    expect(await screen.findByTestId('tool-spinner')).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.queryByTestId('tool-spinner')).not.toBeInTheDocument(),
    );

    const toolRow = await screen.findByTestId('tool-row');
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
});
