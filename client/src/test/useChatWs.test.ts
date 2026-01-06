import { act, renderHook, waitFor } from '@testing-library/react';
import { jest } from '@jest/globals';
import { useChatWs } from '../hooks/useChatWs';
import type {
  WebSocketMockInstance,
  WebSocketMockRegistry,
} from './support/mockWebSocket';

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

function getSentMessages(): Array<Record<string, unknown>> {
  return wsRegistry()
    .instances.flatMap((socket) => socket.sent)
    .map((payload) => {
      try {
        return JSON.parse(payload) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((value): value is Record<string, unknown> => Boolean(value));
}

describe('useChatWs', () => {
  beforeEach(() => {
    wsRegistry().reset();
  });

  it('connects once on mount and closes on unmount', async () => {
    const { result, unmount } = renderHook(() => useChatWs());
    await waitFor(() => expect(result.current.connectionState).toBe('open'));

    expect(wsRegistry().instances).toHaveLength(1);
    const socket = lastSocket();
    expect(socket.url).toContain('/ws');

    unmount();

    expect(wsRegistry().instances).toHaveLength(1);
    expect(socket.readyState).toBe(3);
  });

  it('ignores unknown inbound event types without throwing', async () => {
    const { result } = renderHook(() => useChatWs());
    await waitFor(() => expect(result.current.connectionState).toBe('open'));

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'unknown_event',
        seq: 1,
      });
    });

    expect(result.current.connectionState).toBe('open');
  });

  it('handles malformed JSON safely', async () => {
    const { result } = renderHook(() => useChatWs());
    await waitFor(() => expect(result.current.connectionState).toBe('open'));

    act(() => {
      lastSocket()._receive('not-json');
    });

    expect(result.current.connectionState).toBe('open');
  });

  it('ignores stale/out-of-order transcript events based on seq', async () => {
    const received: string[] = [];
    const { result } = renderHook(() =>
      useChatWs({
        onEvent: (event) => received.push(event.type),
      }),
    );
    await waitFor(() => expect(result.current.connectionState).toBe('open'));

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId: 'c1',
        seq: 2,
        inflight: {
          inflightId: 'i1',
          assistantText: '',
          assistantThink: '',
          toolEvents: [],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      });
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId: 'c1',
        seq: 1,
        inflightId: 'i1',
        delta: 'stale',
      });
    });

    expect(received).toEqual(['inflight_snapshot']);
  });

  it('refreshes snapshots and re-subscribes on reconnect', async () => {
    const refresh = jest.fn();

    const { result } = renderHook(() =>
      useChatWs({
        onReconnectBeforeResubscribe: refresh,
      }),
    );

    await waitFor(() => expect(result.current.connectionState).toBe('open'));

    act(() => {
      result.current.subscribeSidebar();
      result.current.subscribeConversation('c1');
    });

    const first = lastSocket();
    expect(getSentTypes(first)).toEqual(
      expect.arrayContaining(['subscribe_sidebar', 'subscribe_conversation']),
    );

    act(() => {
      first.close();
    });

    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 2000 });

    const resubscribeCount = getSentMessages().filter(
      (msg) =>
        msg.type === 'subscribe_conversation' && msg.conversationId === 'c1',
    ).length;
    expect(resubscribeCount).toBeGreaterThanOrEqual(2);
  });

  it('sends subscribe_ingest when requested', async () => {
    const { result } = renderHook(() => useChatWs());
    await waitFor(() => expect(result.current.connectionState).toBe('open'));

    act(() => {
      result.current.subscribeIngest();
    });

    const socket = lastSocket();
    expect(getSentTypes(socket)).toEqual(
      expect.arrayContaining(['subscribe_ingest']),
    );
  });

  it('sends unsubscribe_ingest when requested', async () => {
    const { result } = renderHook(() => useChatWs());
    await waitFor(() => expect(result.current.connectionState).toBe('open'));

    act(() => {
      result.current.unsubscribeIngest();
    });

    const socket = lastSocket();
    expect(getSentTypes(socket)).toEqual(
      expect.arrayContaining(['unsubscribe_ingest']),
    );
  });

  it('re-sends subscribe_ingest after reconnect', async () => {
    const { result } = renderHook(() => useChatWs());
    await waitFor(() => expect(result.current.connectionState).toBe('open'));

    act(() => {
      result.current.subscribeIngest();
    });

    const first = lastSocket();
    act(() => {
      first.close();
    });

    await waitFor(() =>
      expect(wsRegistry().instances.length).toBeGreaterThan(1),
    );

    const subscribeCount = getSentMessages().filter(
      (msg) => msg.type === 'subscribe_ingest',
    ).length;
    expect(subscribeCount).toBeGreaterThanOrEqual(2);
  });

  it('does not resubscribe to ingest after unsubscribe', async () => {
    const { result } = renderHook(() => useChatWs());
    await waitFor(() => expect(result.current.connectionState).toBe('open'));

    act(() => {
      result.current.subscribeIngest();
      result.current.unsubscribeIngest();
    });

    const first = lastSocket();
    act(() => {
      first.close();
    });

    await waitFor(() =>
      expect(wsRegistry().instances.length).toBeGreaterThan(1),
    );

    const subscribeCount = getSentMessages().filter(
      (msg) => msg.type === 'subscribe_ingest',
    ).length;
    expect(subscribeCount).toBe(1);
  });

  it('forwards ingest events without conversationId to onEvent', async () => {
    const onEvent = jest.fn();
    const { result } = renderHook(() => useChatWs({ onEvent }));
    await waitFor(() => expect(result.current.connectionState).toBe('open'));

    const event = {
      protocolVersion: 'v1',
      type: 'ingest_snapshot',
      seq: 1,
      status: null,
    };

    act(() => {
      lastSocket()._receive(event);
    });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it('does not subscribe or reconnect when realtime is disabled', async () => {
    const refresh = jest.fn();
    const { result } = renderHook(() =>
      useChatWs({
        realtimeEnabled: false,
        onReconnectBeforeResubscribe: refresh,
      }),
    );
    await waitFor(() => expect(result.current.connectionState).toBe('open'));

    const socket = lastSocket();
    const initialInstances = wsRegistry().instances.length;

    act(() => {
      result.current.subscribeSidebar();
      result.current.subscribeConversation('c1');
    });

    expect(socket.sent).toHaveLength(0);

    act(() => {
      socket.close();
    });

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(refresh).not.toHaveBeenCalled();
    expect(
      getSentMessages().some(
        (msg) =>
          msg.type === 'subscribe_sidebar' ||
          msg.type === 'subscribe_conversation',
      ),
    ).toBe(false);
    expect(wsRegistry().instances).toHaveLength(initialInstances);
  });
});
