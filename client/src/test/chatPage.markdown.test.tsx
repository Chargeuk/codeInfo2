import { ReadableStream } from 'node:stream/web';
import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

function streamWithMarkdown() {
  const encoder = new TextEncoder();
  const markdown = [
    'Here is a list:',
    '- first item',
    '- second item',
    '',
    '```ts',
    'const answer = 42;',
    '```',
    '',
    'Inline `code` sample.',
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

describe('Chat markdown rendering', () => {
  it('renders lists and code blocks without escaping content', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => modelList,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: streamWithMarkdown(),
      });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Show markdown' } });
    const sendButton = screen.getByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    const markdownBoxes = await screen.findAllByTestId('assistant-markdown');
    expect(markdownBoxes.length).toBeGreaterThan(0);
    const markdownBox = markdownBoxes[0];

    await waitFor(() =>
      expect(markdownBox.textContent ?? '').toContain('Inline code sample.'),
    );

    const codeBlock = markdownBox.querySelector('pre code');
    expect(codeBlock?.textContent ?? '').toContain('const answer = 42;');

    await waitFor(() => {
      const items = within(markdownBox).getAllByRole('listitem');
      expect(items.map((item) => item.textContent)).toEqual([
        'first item',
        'second item',
      ]);
    });
  });
});
