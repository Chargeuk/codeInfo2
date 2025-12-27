import { jest } from '@jest/globals';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (globalThis as unknown as { __wsMock?: { reset: () => void } }).__wsMock?.reset();
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

describe('Chat provider selection (WS transport)', () => {
  it('shows Codex as unavailable with guidance banner', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/health')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ mongoConnected: true }) }) as unknown as Response;
      }
      if (href.includes('/chat/providers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            providers: [
              { id: 'lmstudio', label: 'LM Studio', available: true, toolsAvailable: true },
              {
                id: 'codex',
                label: 'OpenAI Codex',
                available: false,
                toolsAvailable: false,
                reason: 'Compose mounts missing',
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
            models: [{ key: 'm1', displayName: 'Model 1', type: 'gguf' }],
          }),
        }) as unknown as Response;
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response;
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', { name: /provider/i });
    expect(providerSelect).toBeInTheDocument();

    await userEvent.click(providerSelect);
    const codexOption = await screen.findByRole('option', { name: /openai codex/i });
    expect(codexOption).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');

    const banner = await screen.findByTestId('codex-unavailable-banner');
    expect(banner).toHaveTextContent('Compose mounts');
    const link = within(banner).getByRole('link', { name: /codex \(cli\)/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('#codex-cli'));
  });

  it('reuses Codex threadId from WS turn_final on subsequent turns', async () => {
    const bodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation((url: RequestInfo | URL, opts?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/health')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ mongoConnected: true }) }) as unknown as Response;
      }
      if (href.includes('/conversations') && opts?.method !== 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [], nextCursor: null }) }) as unknown as Response;
      }
      if (href.includes('/chat/providers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            providers: [
              { id: 'lmstudio', label: 'LM Studio', available: true, toolsAvailable: true },
              { id: 'codex', label: 'OpenAI Codex', available: true, toolsAvailable: true },
            ],
          }),
        }) as unknown as Response;
      }
      if (href.includes('/chat/models')) {
        const providerParam = new URL(href, 'http://localhost').searchParams.get('provider');
        if (providerParam === 'codex') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              provider: 'codex',
              available: true,
              toolsAvailable: true,
              models: [
                { key: 'gpt-5.1-codex-max', displayName: 'gpt-5.1-codex-max', type: 'codex' },
              ],
            }),
          }) as unknown as Response;
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'lmstudio',
            available: true,
            toolsAvailable: true,
            models: [{ key: 'm1', displayName: 'Model 1', type: 'gguf' }],
          }),
        }) as unknown as Response;
      }
      if (href.includes('/chat') && opts?.method === 'POST') {
        const body = opts?.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : {};
        bodies.push(body);
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            status: 'started',
            conversationId: body.conversationId,
            inflightId: 'i1',
            provider: body.provider,
            model: body.model,
          }),
        }) as unknown as Response;
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response;
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', { name: /provider/i });
    await userEvent.click(providerSelect);
    const codexOption = await screen.findByRole('option', { name: /openai codex/i });
    await userEvent.click(codexOption);

    const input = await screen.findByTestId('chat-input');
    const sendButton = await screen.findByTestId('chat-send');

    await userEvent.type(input, 'First');
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0]).not.toHaveProperty('threadId');

    const conversationId = bodies[0].conversationId as string;

    const wsRegistry = (globalThis as unknown as {
      __wsMock?: { last: () => { _receive: (d: unknown) => void } | null };
    }).__wsMock;
    const ws = wsRegistry?.last();
    expect(ws).toBeTruthy();

    ws!._receive({
      protocolVersion: 'v1',
      type: 'turn_final',
      conversationId,
      seq: 1,
      inflightId: 'i1',
      status: 'ok',
      threadId: 't1',
    });

    await userEvent.clear(input);
    await userEvent.type(input, 'Second');
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(bodies.length).toBe(2));
    expect(bodies[1].threadId).toBe('t1');
  });
});
