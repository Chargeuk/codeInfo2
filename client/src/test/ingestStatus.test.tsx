import { jest } from '@jest/globals';
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  MemoryRouter,
  RouterProvider,
  createMemoryRouter,
} from 'react-router-dom';
import ActiveRunCard from '../components/ingest/ActiveRunCard';
import useIngestStatus from '../hooks/useIngestStatus';
import type {
  WebSocketMockInstance,
  WebSocketMockRegistry,
} from './support/mockWebSocket';

const mockFetch = jest.fn();

const { default: App } = await import('../App');
const { default: HomePage } = await import('../pages/HomePage');
const { default: IngestPage } = await import('../pages/IngestPage');

const ingestRoutes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'ingest', element: <IngestPage /> },
    ],
  },
];

function wsRegistry(): WebSocketMockRegistry {
  const registry = (
    globalThis as unknown as { __wsMock?: WebSocketMockRegistry }
  ).__wsMock;
  if (!registry) {
    throw new Error('Missing __wsMock registry; is setupTests.ts running?');
  }
  return registry;
}

function lastSocket(): WebSocketMockInstance {
  const socket = wsRegistry().last();
  if (!socket) throw new Error('No WebSocket instance created');
  return socket;
}

function getSentTypes(socket: WebSocketMockInstance): string[] {
  return socket.sent
    .map((payload) => {
      try {
        return (JSON.parse(payload) as { type?: string }).type;
      } catch {
        return undefined;
      }
    })
    .filter((value): value is string => typeof value === 'string');
}

async function openSocket() {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  await waitFor(() => expect(lastSocket().readyState).toBe(1));
}

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/ingest/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [], lockedModelId: undefined }),
      };
    }
    if (url.includes('/ingest/roots')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ roots: [], lockedModelId: undefined }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    };
  });
  wsRegistry().reset();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('useIngestStatus', () => {
  it('posts cancel with the current runId', async () => {
    const { result } = renderHook(() => useIngestStatus());
    await openSocket();

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_update',
        seq: 1,
        status: {
          runId: 'run-1',
          state: 'embedding',
          counts: { files: 1 },
          ast: {
            supportedFileCount: 1,
            skippedFileCount: 0,
            failedFileCount: 0,
            lastIndexedAt: '2026-01-27T00:00:00.000Z',
          },
        },
      });
    });

    await act(async () => {
      await result.current.cancel();
    });

    const cancelCalls = mockFetch.mock.calls.filter(([input]) =>
      String(input).includes('/ingest/cancel/run-1'),
    );
    expect(cancelCalls).toHaveLength(1);
    expect(cancelCalls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('clears status when ingest_snapshot reports no run', async () => {
    const { result } = renderHook(() => useIngestStatus());
    await openSocket();

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_update',
        seq: 1,
        status: {
          runId: 'run-2',
          state: 'embedding',
          counts: { files: 1 },
        },
      });
    });

    expect(result.current.status?.runId).toBe('run-2');

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_snapshot',
        seq: 2,
        status: null,
      });
    });

    expect(result.current.status).toBeNull();
  });

  it('does not call cancel when no run is active', async () => {
    const { result } = renderHook(() => useIngestStatus());
    await openSocket();

    await act(async () => {
      await result.current.cancel();
    });

    const cancelCalls = mockFetch.mock.calls.filter(([input]) =>
      String(input).includes('/ingest/cancel/'),
    );
    expect(cancelCalls).toHaveLength(0);
  });

  it('sends unsubscribe_ingest on unmount', async () => {
    const { unmount } = renderHook(() => useIngestStatus());
    await openSocket();

    const socket = lastSocket();
    await waitFor(() =>
      expect(getSentTypes(socket)).toEqual(
        expect.arrayContaining(['subscribe_ingest']),
      ),
    );
    unmount();

    expect(getSentTypes(socket)).toEqual(
      expect.arrayContaining(['unsubscribe_ingest']),
    );
  });
});

describe('IngestPage realtime status UI', () => {
  const renderPage = () => {
    const router = createMemoryRouter(ingestRoutes, {
      initialEntries: ['/ingest'],
    });
    render(<RouterProvider router={router} />);
  };

  it('renders ingesting roots with phase from /ingest/roots contract', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/ingest/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [], lockedModelId: undefined }),
        };
      }
      if (url.includes('/ingest/roots')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            schemaVersion: '0000038-status-phase-v1',
            roots: [
              {
                runId: 'root-run-1',
                name: 'repo-ingesting',
                path: '/repo-ingesting',
                status: 'ingesting',
                phase: 'embedding',
                model: 'embed-1',
                lastError: null,
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok' }),
      };
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/ingesting \(embedding\)/i)).toBeInTheDocument(),
    );
  });

  it('renders terminal roots without phase text', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/ingest/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [], lockedModelId: undefined }),
        };
      }
      if (url.includes('/ingest/roots')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            schemaVersion: '0000038-status-phase-v1',
            roots: [
              {
                runId: 'root-run-2',
                name: 'repo-completed',
                path: '/repo-completed',
                status: 'completed',
                model: 'embed-1',
                lastError: null,
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok' }),
      };
    });

    renderPage();

    await waitFor(() =>
      expect(
        screen.getByRole('row', { name: /repo-completed/i }),
      ).toHaveTextContent('completed'),
    );
    expect(
      screen.queryByText(/\(queued\)|\(scanning\)|\(embedding\)/i),
    ).not.toBeInTheDocument();
  });

  it('renders snapshot status immediately on subscribe', async () => {
    renderPage();
    await openSocket();

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_snapshot',
        seq: 1,
        status: {
          runId: 'run-1',
          state: 'embedding',
          counts: { files: 2 },
          ast: {
            supportedFileCount: 2,
            skippedFileCount: 0,
            failedFileCount: 0,
            lastIndexedAt: '2026-01-27T00:00:00.000Z',
          },
        },
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('ingest-status-chip')).toHaveTextContent(
        'embedding',
      ),
    );
  });

  it('hides the Active ingest panel when no run is active', async () => {
    renderPage();
    await openSocket();

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_snapshot',
        seq: 1,
        status: null,
      });
    });

    await waitFor(() =>
      expect(screen.queryByText('Active ingest')).not.toBeInTheDocument(),
    );
  });

  it('shows an explicit error when the WS closes', async () => {
    renderPage();
    await openSocket();

    act(() => {
      lastSocket().close();
    });

    await waitFor(() =>
      expect(screen.getByTestId('ingest-ws-unavailable')).toBeInTheDocument(),
    );
  });

  it('shows a connecting alert before the socket opens', () => {
    renderPage();
    expect(screen.getByTestId('ingest-ws-connecting')).toBeInTheDocument();
  });

  it('shows a banner when AST indexing is skipped', async () => {
    renderPage();
    await openSocket();

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_snapshot',
        seq: 1,
        status: {
          runId: 'run-skip',
          state: 'embedding',
          counts: { files: 2 },
          ast: {
            supportedFileCount: 1,
            skippedFileCount: 1,
            failedFileCount: 0,
            lastIndexedAt: '2026-01-27T00:00:00.000Z',
          },
        },
      });
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          'AST indexing skipped for 1 file(s) (unsupported language).',
        ),
      ).toBeInTheDocument(),
    );
  });

  it('shows a banner when AST indexing fails', async () => {
    renderPage();
    await openSocket();

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_snapshot',
        seq: 1,
        status: {
          runId: 'run-fail',
          state: 'embedding',
          counts: { files: 2 },
          ast: {
            supportedFileCount: 1,
            skippedFileCount: 0,
            failedFileCount: 1,
            lastIndexedAt: '2026-01-27T00:00:00.000Z',
          },
        },
      });
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          'AST indexing failed for 1 file(s). Check logs for details.',
        ),
      ).toBeInTheDocument(),
    );
  });

  it('hides AST banners when counts are missing or zero', async () => {
    renderPage();
    await openSocket();

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_snapshot',
        seq: 1,
        status: {
          runId: 'run-clean',
          state: 'embedding',
          counts: { files: 2 },
        },
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByText(
          'AST indexing skipped for 1 file(s) (unsupported language).',
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          'AST indexing failed for 1 file(s). Check logs for details.',
        ),
      ).not.toBeInTheDocument();
    });
  });

  it('refreshes roots/models on terminal status and hides the panel', async () => {
    renderPage();
    await openSocket();

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_snapshot',
        seq: 1,
        status: {
          runId: 'run-terminal',
          state: 'embedding',
          counts: { files: 1 },
          ast: {
            supportedFileCount: 1,
            skippedFileCount: 0,
            failedFileCount: 0,
            lastIndexedAt: '2026-01-27T00:00:00.000Z',
          },
        },
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('ingest-status-chip')).toHaveTextContent(
        'embedding',
      ),
    );

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_update',
        seq: 2,
        status: {
          runId: 'run-terminal',
          state: 'completed',
          counts: { files: 1, embedded: 1 },
          ast: {
            supportedFileCount: 1,
            skippedFileCount: 0,
            failedFileCount: 0,
            lastIndexedAt: '2026-01-27T00:00:00.000Z',
          },
        },
      });
    });

    await waitFor(() => {
      const modelCalls = mockFetch.mock.calls.filter(([input]) =>
        String(input).includes('/ingest/models'),
      );
      const rootCalls = mockFetch.mock.calls.filter(([input]) =>
        String(input).includes('/ingest/roots'),
      );
      expect(modelCalls.length).toBeGreaterThan(1);
      expect(rootCalls.length).toBeGreaterThan(1);
      expect(screen.queryByText('Active ingest')).not.toBeInTheDocument();
    });
  });

  it('keeps terminal ingest errors visible after the active panel hides', async () => {
    renderPage();
    await openSocket();

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_snapshot',
        seq: 1,
        status: {
          runId: 'run-terminal-error',
          state: 'embedding',
          counts: { files: 1 },
          ast: {
            supportedFileCount: 1,
            skippedFileCount: 0,
            failedFileCount: 0,
            lastIndexedAt: '2026-01-27T00:00:00.000Z',
          },
        },
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('ingest-status-chip')).toHaveTextContent(
        'embedding',
      ),
    );

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_update',
        seq: 2,
        status: {
          runId: 'run-terminal-error',
          state: 'error',
          counts: { files: 1, embedded: 0 },
          lastError: 'No eligible files found in /blank-repo',
          ast: {
            supportedFileCount: 1,
            skippedFileCount: 0,
            failedFileCount: 0,
            lastIndexedAt: '2026-01-27T00:00:00.000Z',
          },
        },
      });
    });

    await waitFor(() => {
      const modelCalls = mockFetch.mock.calls.filter(([input]) =>
        String(input).includes('/ingest/models'),
      );
      const rootCalls = mockFetch.mock.calls.filter(([input]) =>
        String(input).includes('/ingest/roots'),
      );
      expect(modelCalls.length).toBeGreaterThan(1);
      expect(rootCalls.length).toBeGreaterThan(1);
      expect(screen.queryByText('Active ingest')).not.toBeInTheDocument();
      expect(screen.getByTestId('ingest-terminal-error')).toHaveTextContent(
        'No eligible files found in /blank-repo',
      );
    });
  });
});

describe('ActiveRunCard error compatibility rendering', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders legacy string lastError payload safely', () => {
    render(
      <MemoryRouter>
        <ActiveRunCard
          runId="run-legacy"
          status="error"
          lastError="Legacy failure message"
          isLoading={false}
          isCancelling={false}
          onCancel={async () => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('ingest-last-error')).toHaveTextContent(
      'Legacy failure message',
    );
  });

  it('renders normalized object lastError payload safely', () => {
    render(
      <MemoryRouter>
        <ActiveRunCard
          runId="run-normalized"
          status="error"
          lastError={{
            message: 'Normalized failure message',
            details: 'detail',
          }}
          isLoading={false}
          isCancelling={false}
          onCancel={async () => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('ingest-last-error')).toHaveTextContent(
      'Normalized failure message',
    );
  });
});
