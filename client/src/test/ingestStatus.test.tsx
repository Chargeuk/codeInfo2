import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import useIngestStatus from '../hooks/useIngestStatus';
import type {
  WebSocketMockInstance,
  WebSocketMockRegistry,
} from './support/mockWebSocket';

const mockFetch = jest.fn();

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
  mockFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok' }),
  }));
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
