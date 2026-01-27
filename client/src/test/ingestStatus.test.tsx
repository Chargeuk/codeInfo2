import { jest } from '@jest/globals';
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
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
});
