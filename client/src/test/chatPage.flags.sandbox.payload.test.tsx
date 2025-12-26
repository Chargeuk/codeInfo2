import { ReadableStream } from 'node:stream/web';
import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
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

function makeStream(content: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(
          `data: {"type":"final","message":{"role":"assistant","content":"${content}"}}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode('data: {"type":"complete"}\n\n'));
      controller.close();
    },
  });
}

function mockProvidersWithBodies(chatBodies: Array<Record<string, unknown>>) {
  const streams = [makeStream('lm'), makeStream('codex')];
  mockFetch.mockImplementation((url: RequestInfo | URL, opts?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('/chat/providers')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          providers: [
            {
              id: 'lmstudio',
              label: 'LM Studio',
              available: true,
              toolsAvailable: true,
            },
            {
              id: 'codex',
              label: 'OpenAI Codex',
              available: true,
              toolsAvailable: true,
            },
          ],
        }),
      }) as unknown as Response;
    }
    if (href.includes('/chat/models') && href.includes('provider=codex')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          provider: 'codex',
          available: true,
          toolsAvailable: true,
          models: [
            {
              key: 'gpt-5.1-codex-max',
              displayName: 'gpt-5.1-codex-max',
              type: 'codex',
            },
            {
              key: 'gpt-5.2',
              displayName: 'gpt-5.2',
              type: 'codex',
            },
          ],
        }),
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
          models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
        }),
      }) as unknown as Response;
    }
    if (href.includes('/chat') && !href.includes('/chat/cancel')) {
      if (opts?.body) {
        try {
          chatBodies.push(JSON.parse(opts.body as string));
        } catch {
          chatBodies.push({});
        }
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        body: streams.shift() ?? makeStream(''),
      }) as unknown as Response;
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as unknown as Response;
  });
}

describe('Codex sandbox flag payloads', () => {
  it('omits sandbox flag for LM Studio and includes chosen value for Codex', async () => {
    const chatBodies: Record<string, unknown>[] = [];
    mockProvidersWithBodies(chatBodies);

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    const sendButton = await screen.findByTestId('chat-send');

    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.clear(input);
    await userEvent.type(input, 'Hello LM');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(chatBodies.length).toBeGreaterThanOrEqual(1));
    const lmBody = chatBodies[0];
    expect(lmBody.provider).toBe('lmstudio');
    expect(lmBody).not.toHaveProperty('sandboxMode');

    const newConversationButton = screen.getByRole('button', {
      name: /new conversation/i,
    });
    await act(async () => {
      await userEvent.click(newConversationButton);
    });

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await userEvent.click(providerSelect);
    const codexOption = await screen.findByRole('option', {
      name: /openai codex/i,
    });
    await userEvent.click(codexOption);

    const sandboxSelect = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    await userEvent.click(sandboxSelect);
    const dangerOption = await screen.findByRole('option', {
      name: /danger full access/i,
    });
    await userEvent.click(dangerOption);

    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() =>
      expect(modelSelect).toHaveTextContent('gpt-5.1-codex-max'),
    );

    await userEvent.clear(input);
    await userEvent.type(input, 'Hello Codex');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(chatBodies.length).toBeGreaterThanOrEqual(2));
    const codexBody = chatBodies[1];
    expect(codexBody.provider).toBe('codex');
    expect(codexBody.sandboxMode).toBe('danger-full-access');
  });
});
