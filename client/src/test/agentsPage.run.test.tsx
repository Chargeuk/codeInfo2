import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  if (!('getBBox' in SVGElement.prototype)) {
    // @ts-expect-error jsdom SVGElement shim for mermaid layout
    SVGElement.prototype.getBBox = () => ({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  }
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
});

const { default: App } = await import('../App');
const { default: AgentsPage } = await import('../pages/AgentsPage');
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'agents', element: <AgentsPage /> },
    ],
  },
];

describe('Agents page - run', () => {
  it('realtime-enabled mode renders transcript from WS events and ignores REST segments', async () => {
    const user = userEvent.setup();
    const runBodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ mongoConnected: true }),
          } as Response);
        }

        if (target.includes('/agents') && !target.includes('/run')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ agents: [{ name: 'coding_agent' }] }),
          } as Response);
        }

        if (target.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
          } as Response);
        }

        if (target.includes('/agents/coding_agent/run')) {
          expect(init?.method).toBe('POST');
          if (init?.body) {
            runBodies.push(JSON.parse(init.body.toString()));
          }
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({
              status: 'started',
              agentName: 'coding_agent',
              conversationId:
                typeof runBodies.at(-1)?.conversationId === 'string'
                  ? runBodies.at(-1)?.conversationId
                  : 'c1',
              inflightId: 'start-i1',
              modelId: 'gpt-5.1-codex-max',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response);
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const agentSelect = await screen.findByRole('combobox', { name: /agent/i });
    await waitFor(() => expect(agentSelect).toHaveTextContent('coding_agent'));

    const workingFolder = await screen.findByRole('textbox', {
      name: 'working_folder',
    });
    await user.type(workingFolder, '/abs/path');

    const input = await screen.findByTestId('agent-input');
    await user.type(input, 'Question');
    await waitFor(() => expect(screen.getByTestId('agent-send')).toBeEnabled());
    await act(async () => {
      await user.click(screen.getByTestId('agent-send'));
    });

    await waitFor(() => expect(runBodies.length).toBeGreaterThan(0));
    expect(runBodies[0]).toHaveProperty('working_folder', '/abs/path');
    expect(typeof runBodies[0].conversationId).toBe('string');
    expect((runBodies[0].conversationId as string).length).toBeGreaterThan(0);

    const conversationId = runBodies[0].conversationId as string;

    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: { last: () => { _receive: (data: unknown) => void } | null };
      }
    ).__wsMock;
    const ws = wsRegistry?.last();
    if (!ws) throw new Error('No WebSocket instance; did AgentsPage mount?');
    ws._receive({
      protocolVersion: 'v1',
      type: 'user_turn',
      conversationId,
      seq: 1,
      inflightId: 'i1',
      content: 'Question',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    ws._receive({
      protocolVersion: 'v1',
      type: 'assistant_delta',
      conversationId,
      seq: 2,
      inflightId: 'i1',
      delta: 'Final answer',
    });
    ws._receive({
      protocolVersion: 'v1',
      type: 'turn_final',
      conversationId,
      seq: 3,
      inflightId: 'i1',
      status: 'ok',
    });

    await screen.findByText('Question');
    await screen.findByText('Final answer');
    expect(screen.queryByText('SEGMENT_SHOULD_NOT_RENDER')).toBeNull();
  });

  it('preserves leading and trailing whitespace in outbound instruction payload', async () => {
    const user = userEvent.setup();
    const runBodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ mongoConnected: true }),
          } as Response);
        }

        if (target.includes('/agents') && !target.includes('/run')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ agents: [{ name: 'coding_agent' }] }),
          } as Response);
        }

        if (target.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
          } as Response);
        }

        if (target.includes('/agents/coding_agent/run')) {
          expect(init?.method).toBe('POST');
          if (init?.body) {
            runBodies.push(JSON.parse(init.body.toString()));
          }
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({
              status: 'started',
              agentName: 'coding_agent',
              conversationId:
                typeof runBodies.at(-1)?.conversationId === 'string'
                  ? runBodies.at(-1)?.conversationId
                  : 'c1',
              inflightId: 'start-i1',
              modelId: 'gpt-5.1-codex-max',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response);
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const input = await screen.findByTestId('agent-input');
    const rawInstruction = '  padded instruction  ';
    await user.type(input, rawInstruction);
    await waitFor(() => expect(screen.getByTestId('agent-send')).toBeEnabled());
    await act(async () => {
      await user.click(screen.getByTestId('agent-send'));
    });

    await waitFor(() => expect(runBodies.length).toBe(1));
    expect(runBodies[0]).toHaveProperty('instruction', rawInstruction);
  });

  it('renders user markdown with the same list/code/mermaid behavior as assistant in realtime flow', async () => {
    const user = userEvent.setup();
    const runBodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ mongoConnected: true }),
          } as Response);
        }

        if (target.includes('/agents') && !target.includes('/run')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ agents: [{ name: 'coding_agent' }] }),
          } as Response);
        }

        if (target.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
          } as Response);
        }

        if (target.includes('/agents/coding_agent/run')) {
          expect(init?.method).toBe('POST');
          if (init?.body) {
            runBodies.push(JSON.parse(init.body.toString()));
          }
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({
              status: 'started',
              agentName: 'coding_agent',
              conversationId:
                typeof runBodies.at(-1)?.conversationId === 'string'
                  ? runBodies.at(-1)?.conversationId
                  : 'c1',
              inflightId: 'start-i1',
              modelId: 'gpt-5.1-codex-max',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response);
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const input = await screen.findByTestId('agent-input');
    const content = [
      'List:',
      '- item one',
      '- item two',
      '',
      '`inline`',
      '',
      '```mermaid',
      'graph TD',
      '  A[Start] --> B[Done]',
      "  %% <script>alert('x')</script> stripped",
      '```',
    ].join('\n');
    await user.type(input, content);
    await waitFor(() => expect(screen.getByTestId('agent-send')).toBeEnabled());
    await act(async () => {
      await user.click(screen.getByTestId('agent-send'));
    });

    await waitFor(() => expect(runBodies.length).toBe(1));
    const conversationId = String(runBodies[0]?.conversationId ?? 'c1');
    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: { last: () => { _receive: (data: unknown) => void } | null };
      }
    ).__wsMock;
    const ws = wsRegistry?.last();
    if (!ws) throw new Error('No WebSocket instance; did AgentsPage mount?');
    ws._receive({
      protocolVersion: 'v1',
      type: 'user_turn',
      conversationId,
      seq: 1,
      inflightId: 'i1',
      content,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    ws._receive({
      protocolVersion: 'v1',
      type: 'assistant_delta',
      conversationId,
      seq: 2,
      inflightId: 'i1',
      delta: content,
    });
    ws._receive({
      protocolVersion: 'v1',
      type: 'turn_final',
      conversationId,
      seq: 3,
      inflightId: 'i1',
      status: 'ok',
    });

    const userMarkdown = await screen.findByTestId('agents-user-markdown');
    const assistantMarkdown = await screen.findByTestId('assistant-markdown');

    await waitFor(() => {
      expect(userMarkdown.querySelector('svg')).toBeTruthy();
      expect(assistantMarkdown.querySelector('svg')).toBeTruthy();
    });
    expect(userMarkdown.querySelectorAll('li')).toHaveLength(
      assistantMarkdown.querySelectorAll('li').length,
    );
    expect(userMarkdown.querySelector('code')).toBeTruthy();
    expect(assistantMarkdown.querySelector('code')).toBeTruthy();
    expect(userMarkdown.querySelector('script')).toBeNull();
    expect(assistantMarkdown.querySelector('script')).toBeNull();
  });

  it('uses the same safe fallback for malformed mermaid in user and assistant realtime bubbles', async () => {
    const user = userEvent.setup();
    const runBodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ mongoConnected: true }),
          } as Response);
        }

        if (target.includes('/agents') && !target.includes('/run')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ agents: [{ name: 'coding_agent' }] }),
          } as Response);
        }

        if (target.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
          } as Response);
        }

        if (target.includes('/agents/coding_agent/run')) {
          expect(init?.method).toBe('POST');
          if (init?.body) {
            runBodies.push(JSON.parse(init.body.toString()));
          }
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({
              status: 'started',
              agentName: 'coding_agent',
              conversationId:
                typeof runBodies.at(-1)?.conversationId === 'string'
                  ? runBodies.at(-1)?.conversationId
                  : 'c1',
              inflightId: 'start-i1',
              modelId: 'gpt-5.1-codex-max',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response);
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const malformed = [
      '```mermaid',
      'this is not valid mermaid syntax',
      '```',
    ].join('\n');
    const input = await screen.findByTestId('agent-input');
    await user.type(input, malformed);
    await act(async () => {
      await user.click(screen.getByTestId('agent-send'));
    });

    await waitFor(() => expect(runBodies.length).toBe(1));
    const conversationId = String(runBodies[0]?.conversationId ?? 'c1');
    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: { last: () => { _receive: (data: unknown) => void } | null };
      }
    ).__wsMock;
    const ws = wsRegistry?.last();
    if (!ws) throw new Error('No WebSocket instance; did AgentsPage mount?');
    ws._receive({
      protocolVersion: 'v1',
      type: 'user_turn',
      conversationId,
      seq: 1,
      inflightId: 'i1',
      content: malformed,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    ws._receive({
      protocolVersion: 'v1',
      type: 'assistant_delta',
      conversationId,
      seq: 2,
      inflightId: 'i1',
      delta: malformed,
    });
    ws._receive({
      protocolVersion: 'v1',
      type: 'turn_final',
      conversationId,
      seq: 3,
      inflightId: 'i1',
      status: 'ok',
    });

    const userMarkdown = await screen.findByTestId('agents-user-markdown');
    const assistantMarkdown = await screen.findByTestId('assistant-markdown');

    await waitFor(() => {
      expect(userMarkdown).toHaveTextContent('Diagram failed to render');
      expect(assistantMarkdown).toHaveTextContent('Diagram failed to render');
    });
  });

  it('preserves multiline newline formatting in outbound instruction payload', async () => {
    const user = userEvent.setup();
    const runBodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ mongoConnected: true }),
          } as Response);
        }

        if (target.includes('/agents') && !target.includes('/run')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ agents: [{ name: 'coding_agent' }] }),
          } as Response);
        }

        if (target.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
          } as Response);
        }

        if (target.includes('/agents/coding_agent/run')) {
          expect(init?.method).toBe('POST');
          if (init?.body) {
            runBodies.push(JSON.parse(init.body.toString()));
          }
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({
              status: 'started',
              agentName: 'coding_agent',
              conversationId:
                typeof runBodies.at(-1)?.conversationId === 'string'
                  ? runBodies.at(-1)?.conversationId
                  : 'c1',
              inflightId: 'start-i1',
              modelId: 'gpt-5.1-codex-max',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response);
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const input = await screen.findByTestId('agent-input');
    const rawInstruction = 'line one\nline two\nline three';
    await user.type(input, rawInstruction);
    await waitFor(() => expect(screen.getByTestId('agent-send')).toBeEnabled());
    await act(async () => {
      await user.click(screen.getByTestId('agent-send'));
    });

    await waitFor(() => expect(runBodies.length).toBe(1));
    expect(runBodies[0]).toHaveProperty('instruction', rawInstruction);
  });

  it('blocks whitespace-only input before dispatching a run request', async () => {
    const user = userEvent.setup();
    const runBodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ mongoConnected: true }),
          } as Response);
        }

        if (target.includes('/agents') && !target.includes('/run')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ agents: [{ name: 'coding_agent' }] }),
          } as Response);
        }

        if (target.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
          } as Response);
        }

        if (target.includes('/agents/coding_agent/run')) {
          expect(init?.method).toBe('POST');
          if (init?.body) {
            runBodies.push(JSON.parse(init.body.toString()));
          }
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({
              status: 'started',
              agentName: 'coding_agent',
              conversationId:
                typeof runBodies.at(-1)?.conversationId === 'string'
                  ? runBodies.at(-1)?.conversationId
                  : 'c1',
              inflightId: 'start-i1',
              modelId: 'gpt-5.1-codex-max',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response);
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const input = await screen.findByTestId('agent-input');
    await user.type(input, '   \n   ');
    await waitFor(() =>
      expect(screen.getByTestId('agent-send')).toBeDisabled(),
    );
    expect(runBodies).toHaveLength(0);
  });
});
