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
  if (!('getBBox' in SVGElement.prototype)) {
    // @ts-expect-error jsdom SVGElement shim for mermaid layout
    SVGElement.prototype.getBBox = () => ({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  }
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

function streamWithMermaid() {
  const encoder = new TextEncoder();
  const markdown = [
    'Here is a diagram:',
    '```mermaid',
    'graph TD',
    '  A[Start] --> B{Choice}',
    '  B -->|Yes| C[Render diagram]',
    '  B -->|No| D[Stop]',
    "  %% <script>alert('x')</script> should be stripped",
    '  D --> E[Done]',
    '```',
  ].join('\n');

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const payload = JSON.stringify({
        type: 'final',
        message: { content: markdown, role: 'assistant' },
      });
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
      controller.close();
    },
  });
}

describe('Chat mermaid rendering', () => {
  it('renders mermaid diagrams and strips script tags', async () => {
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
          body: streamWithMermaid(),
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

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Show mermaid' } });
    const sendButton = screen.getByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    const markdownBox = await screen.findByTestId('assistant-markdown');

    await waitFor(() => {
      const svg = markdownBox.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    const script = markdownBox.querySelector('script');
    expect(script).toBeNull();
  });
});
