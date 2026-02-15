import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  process.env.MODE = 'test';
  global.fetch = mockFetch as unknown as typeof fetch;
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
  return Promise.resolve({
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    json: async () => payload,
  } as Response);
}

describe('Flows page stop control', () => {
  it('renders ingested flow labels and keeps duplicate names selectable', async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows') && !target.includes('/run')) {
        return mockJsonResponse({
          flows: [
            {
              name: 'release',
              description: 'Release flow',
              disabled: false,
              sourceId: '/data/repo-b',
              sourceLabel: 'Repo B',
            },
            {
              name: 'release',
              description: 'Release flow',
              disabled: false,
              sourceId: '/data/repo-a',
              sourceLabel: 'Repo A',
            },
            { name: 'smoke', description: 'Smoke flow', disabled: false },
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

    const flowSelect = await screen.findByRole('combobox', { name: /flow/i });
    await waitFor(() => expect(flowSelect).toBeEnabled());
    await user.click(flowSelect);

    const options = await screen.findAllByRole('option');
    const optionLabels = options.map((option) => option.textContent ?? '');
    expect(optionLabels).toEqual([
      'release - [Repo A]',
      'release - [Repo B]',
      'smoke',
    ]);
  });

  it('includes sourceId when running an ingested flow', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows') && !target.includes('/run')) {
        return mockJsonResponse({
          flows: [
            {
              name: 'release',
              description: 'Release flow',
              disabled: false,
              sourceId: '/data/repo-a',
              sourceLabel: 'Repo A',
            },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({
          items: [],
          inflight: {
            inflightId: 'i1',
            assistantText: '',
            assistantThink: '',
            toolEvents: [],
            startedAt: now,
            seq: 1,
          },
        });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'flow-1',
              title: 'Flow: release',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flowName: 'release',
              flags: {},
            },
          ],
        });
      }

      if (target.includes('/flows/release/run')) {
        return mockJsonResponse({
          status: 'started',
          flowName: 'release',
          conversationId: 'flow-1',
          inflightId: 'i1',
          modelId: 'gpt-5',
        });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const flowSelect = await screen.findByRole('combobox', { name: /flow/i });
    await waitFor(() => expect(flowSelect).toBeEnabled());
    await user.click(flowSelect);
    const option = await screen.findByRole('option', {
      name: 'release - [Repo A]',
    });
    await user.click(option);

    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);

    await waitFor(() => {
      const runCall = mockFetch.mock.calls.find(([url]) =>
        url.toString().includes('/flows/release/run'),
      );
      expect(runCall).toBeDefined();
      const [, init] = runCall as [unknown, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.sourceId).toBe('/data/repo-a');
    });
  });

  it('omits sourceId when running a local flow', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows') && !target.includes('/run')) {
        return mockJsonResponse({
          flows: [
            {
              name: 'smoke',
              description: 'Smoke flow',
              disabled: false,
            },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({
          items: [],
          inflight: {
            inflightId: 'i1',
            assistantText: '',
            assistantThink: '',
            toolEvents: [],
            startedAt: now,
            seq: 1,
          },
        });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'flow-1',
              title: 'Flow: smoke',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flowName: 'smoke',
              flags: {},
            },
          ],
        });
      }

      if (target.includes('/flows/smoke/run')) {
        return mockJsonResponse({
          status: 'started',
          flowName: 'smoke',
          conversationId: 'flow-1',
          inflightId: 'i1',
          modelId: 'gpt-5',
        });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);

    await waitFor(() => {
      const runCall = mockFetch.mock.calls.find(([url]) =>
        url.toString().includes('/flows/smoke/run'),
      );
      expect(runCall).toBeDefined();
      const [, init] = runCall as [unknown, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body).not.toHaveProperty('sourceId');
    });
  });

  it('sends cancel_inflight over WS when stopping a flow run', async () => {
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
        return mockJsonResponse({
          items: [],
          inflight: {
            inflightId: 'i1',
            assistantText: '',
            assistantThink: '',
            toolEvents: [],
            startedAt: now,
            seq: 1,
          },
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

    const stopButton = await screen.findByTestId('flow-stop');
    await waitFor(() => expect(stopButton).toBeEnabled());

    await user.click(stopButton);

    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: { instances?: Array<{ sent: string[] }> };
      }
    ).__wsMock;

    await waitFor(() => {
      const sockets = wsRegistry?.instances ?? [];
      expect(sockets.length).toBeGreaterThan(0);

      const cancelMessages = sockets
        .flatMap((socket) => socket.sent)
        .map((entry) => {
          try {
            return JSON.parse(entry) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .filter((msg) => msg?.type === 'cancel_inflight');

      expect(cancelMessages.length).toBeGreaterThan(0);
      expect(cancelMessages.at(-1)?.conversationId).toBe('flow-1');
      expect(cancelMessages.at(-1)?.inflightId).toBe('i1');
    });
  });
});
