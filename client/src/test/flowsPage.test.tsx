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

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  process.env.MODE = 'test';
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
});

const { default: App } = await import('../App');
const { default: FlowsPage } = await import('../pages/FlowsPage');
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'flows', element: <FlowsPage /> },
    ],
  },
];

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function emitWsEvent(event: Record<string, unknown>) {
  const wsRegistry = (
    globalThis as unknown as {
      __wsMock?: { last: () => { _receive: (data: unknown) => void } | null };
    }
  ).__wsMock;
  const ws = wsRegistry?.last();
  if (!ws) throw new Error('No WebSocket instance; did FlowsPage mount?');
  act(() => {
    ws._receive(event);
  });
}

describe('Flows page basics', () => {
  it('renders flows list and flow step metadata', async () => {
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows')) {
        return mockJsonResponse({
          flows: [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({
          items: [
            {
              turnId: 't1',
              conversationId: 'flow-1',
              role: 'assistant',
              content: 'Flow content',
              provider: 'codex',
              model: 'gpt-5',
              status: 'ok',
              command: {
                name: 'flow',
                stepIndex: 1,
                totalSteps: 3,
                label: 'Plan',
                agentType: 'planning_agent',
                identifier: 'main',
              },
              createdAt: now,
            },
          ],
        });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'flow-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flowName: 'daily',
              flags: {},
            },
          ],
        });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const flowSelect = await screen.findByTestId('flow-select');
    await waitFor(() =>
      expect((flowSelect as HTMLInputElement).value).toBe('daily::local'),
    );

    const metadata = await screen.findByTestId('bubble-flow-meta');
    expect(metadata).toHaveTextContent('Plan · planning_agent/main');
    expect(screen.getByTestId('flows-transcript')).toBeInTheDocument();
    expect(screen.queryByTestId('citations-toggle')).not.toBeInTheDocument();
  });

  it('shows the flow turns warning when conversation history fails to load', async () => {
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows')) {
        return mockJsonResponse({
          flows: [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'boom' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'flow-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flowName: 'daily',
              flags: {},
            },
          ],
        });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId('flows-turns-error')).toHaveTextContent(
      'Failed to load conversation turns (500)',
    );
    expect(screen.getByTestId('flow-select')).toBeInTheDocument();
  });

  it('does not show stale conversations when flow has no history', async () => {
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows')) {
        return mockJsonResponse({
          flows: [
            {
              name: 'execute_plan',
              description: 'Execute a plan until it is complete',
              disabled: false,
            },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({
          items: [
            {
              turnId: 't-stale',
              conversationId: 'chat-1',
              role: 'assistant',
              content: 'Stale content',
              provider: 'codex',
              model: 'gpt-5',
              status: 'ok',
              createdAt: now,
            },
          ],
        });
      }

      if (target.includes('/conversations')) {
        const urlObj = new URL(target);
        const flowName = urlObj.searchParams.get('flowName');
        if (flowName === 'execute_plan') {
          return mockJsonResponse({ items: [] });
        }
        return mockJsonResponse({
          items: [
            {
              conversationId: 'chat-1',
              title: 'Chat: test',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flags: {},
            },
          ],
        });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const flowSelect = await screen.findByTestId('flow-select');
    await waitFor(() =>
      expect((flowSelect as HTMLInputElement).value).toBe(
        'execute_plan::local',
      ),
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Transcript will appear here once a flow run starts/i),
      ).toBeInTheDocument(),
    );

    expect(screen.queryByText('Stale content')).not.toBeInTheDocument();
  });

  it('keeps flow conversations visible when conversation_upsert omits flowName', async () => {
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows')) {
        return mockJsonResponse({
          flows: [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'flow-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flowName: 'daily',
              flags: {},
            },
          ],
        });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const flowSelect = await screen.findByTestId('flow-select');
    await waitFor(() =>
      expect((flowSelect as HTMLInputElement).value).toBe('daily::local'),
    );
    await screen.findByText('Flow: daily');

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'conversation_upsert',
      seq: 1,
      conversation: {
        conversationId: 'flow-1',
        title: 'Flow: daily updated',
        provider: 'codex',
        model: 'gpt-5',
        source: 'REST',
        lastMessageAt: new Date('2025-01-02T00:00:00.000Z').toISOString(),
        archived: false,
      },
    });

    await screen.findByText('Flow: daily updated');
  });

  it('does not leak shared expansion state between flow conversations', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows')) {
        return mockJsonResponse({
          flows: [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        const conversationId = target.includes('/conversations/flow-1/')
          ? 'flow-1'
          : 'flow-2';
        const suffix = conversationId === 'flow-1' ? 'One' : 'Two';
        return mockJsonResponse({
          items: [
            {
              turnId: `turn-${suffix}`,
              conversationId,
              role: 'assistant',
              content: `Flow content ${suffix}`,
              provider: 'codex',
              model: 'gpt-5',
              status: 'ok',
              command: {
                name: 'flow',
                stepIndex: 1,
                totalSteps: 2,
                label: `Step ${suffix}`,
                agentType: 'coding_agent',
                identifier: 'coder',
              },
              createdAt: now,
            },
          ],
        });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'flow-1',
              title: 'Flow: daily one',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flowName: 'daily',
              flags: {},
            },
            {
              conversationId: 'flow-2',
              title: 'Flow: daily two',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flowName: 'daily',
              flags: {},
            },
          ],
        });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Flow: daily one');
    await user.click(screen.getByText('Flow: daily one'));

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'inflight_snapshot',
      conversationId: 'flow-1',
      seq: 1,
      inflight: {
        inflightId: 'i1',
        assistantText: 'Flow content One',
        assistantThink: 'Flow reasoning One',
        toolEvents: [],
        startedAt: now,
      },
    });

    await user.click(await screen.findByTestId('think-toggle'));
    expect(await screen.findByTestId('think-content')).toBeVisible();
    expect(screen.queryByTestId('citations-toggle')).not.toBeInTheDocument();

    await user.click(await screen.findByText('Flow: daily two'));

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'inflight_snapshot',
      conversationId: 'flow-2',
      seq: 2,
      inflight: {
        inflightId: 'i2',
        assistantText: 'Flow content Two',
        assistantThink: 'Flow reasoning Two',
        toolEvents: [],
        startedAt: now,
      },
    });

    expect(await screen.findByTestId('bubble-flow-meta')).toHaveTextContent(
      'Step Two · coding_agent/coder',
    );
    expect(await screen.findByTestId('think-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTestId('think-content')).toBeNull();
    expect(screen.queryByTestId('citations-toggle')).not.toBeInTheDocument();
  });
});

describe('Flows info popover', () => {
  it('shows warnings when the flow is disabled', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows')) {
        return mockJsonResponse({
          flows: [
            {
              name: 'broken_flow',
              description: 'Broken flow',
              disabled: true,
              error: 'Failed to parse flow JSON',
            },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const flowSelect = await screen.findByTestId('flow-select');
    await waitFor(() =>
      expect((flowSelect as HTMLInputElement).value).toBe('broken_flow::local'),
    );

    fireEvent.click(screen.getByTestId('flow-info'));

    const popover = await screen.findByTestId('flow-info-popover');
    expect(popover).toBeInTheDocument();
    expect(screen.getByTestId('flow-warnings')).toHaveTextContent('Warnings');
    expect(screen.getByText('Failed to parse flow JSON')).toBeInTheDocument();
  });

  it('shows the Markdown description when available', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows')) {
        return mockJsonResponse({
          flows: [
            {
              name: 'daily',
              description: 'Run the **daily** flow.',
              disabled: false,
            },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const flowSelect = await screen.findByTestId('flow-select');
    await waitFor(() =>
      expect((flowSelect as HTMLInputElement).value).toBe('daily::local'),
    );

    fireEvent.click(screen.getByTestId('flow-info'));

    const description = await screen.findByTestId('flow-description');
    expect(description).toHaveTextContent('Run the daily flow.');
  });

  it('shows the empty-state copy when no warnings or description', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows')) {
        return mockJsonResponse({
          flows: [{ name: 'simple_flow', disabled: false }],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const flowSelect = await screen.findByTestId('flow-select');
    await waitFor(() =>
      expect((flowSelect as HTMLInputElement).value).toBe('simple_flow::local'),
    );

    fireEvent.click(screen.getByTestId('flow-info'));

    const emptyState = await screen.findByTestId('flow-info-empty');
    expect(emptyState).toHaveTextContent(
      'No description or warnings are available for this flow yet.',
    );
  });
});
