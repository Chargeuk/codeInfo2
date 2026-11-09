import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import useChatStream, { type ChatMessage } from '../hooks/useChatStream';
import type { ChatWsTranscriptEvent } from '../hooks/useChatWs';
import { decodeJsonBody } from './support/decodeJsonBody';
import { mockJsonResponse } from './support/fetchMock';
import { installNativeCompression } from './support/nativeCompression';

const firstUpdateAt = '2026-11-01T10:00:01.000Z';
const lastUpdateAt = '2026-11-01T10:00:02.000Z';
const envelope = { protocolVersion: 'v1' as const, conversationId: 'c1' };

it('exports monotonic delivery transitions and preserves failed pre-dispatch evidence', () => {
  const { result } = renderHook(() => useChatStream('m1', 'codex'));
  let id = '';
  act(() => {
    id = result.current.appendOptimisticUserMessage('hello');
  });
  expect(result.current.messages[0]).toMatchObject({
    id,
    deliveryStatus: 'requested',
  });
  expect(result.current.messages[0].firstUpdateAt).toBeUndefined();
  expect(result.current.messages[0].lastUpdateAt).toBeUndefined();
  act(() => result.current.finalizeOptimisticUserMessage(id));
  expect(result.current.messages[0].deliveryStatus).toBe('requested');
  act(() => result.current.markUserMessageDispatched(id));
  expect(result.current.messages[0].deliveryStatus).toBe('dispatched');
  act(() => result.current.acknowledgeUserMessage(id));
  act(() => {
    result.current.markUserMessageDispatched(id);
    result.current.finalizeOptimisticUserMessage(id);
  });
  expect(result.current.messages[0]).toMatchObject({
    deliveryStatus: 'acknowledged',
    optimistic: false,
  });
});

it.each(['accepted', 'early-ws-then-error', 'http-error', 'invalid-accepted'])(
  'tracks requested before preparation, dispatched at fetch, and correlated acknowledgement: %s',
  async (outcome) => {
    const native = installNativeCompression();
    const text = 'delivery proof '.repeat(100);
    const gate = native.holdNextBuffer((body) => body.message === text);
    let finish!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    let enteredFetch!: () => void;
    const fetched = new Promise<void>((resolve) => {
      enteredFetch = resolve;
    });
    let body: { inflightId: string; conversationId: string } | undefined;
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url, init) => {
        if (!String(url).endsWith('/chat')) return mockJsonResponse({});
        body = decodeJsonBody(init) as typeof body;
        enteredFetch();
        return response;
      });
    const { result, unmount } = renderHook(() => useChatStream('m1', 'codex'));
    let request: Promise<unknown> = Promise.resolve();
    try {
      act(() => result.current.setConversation('c1', { clearMessages: true }));
      act(() => {
        request = result.current.send(text);
      });
      await gate.entered;
      const userId = result.current.messages.find(
        (message) => message.role === 'user',
      )!.id;
      expect(
        result.current.messages.find((message) => message.id === userId)
          ?.deliveryStatus,
      ).toBe('requested');
      expect(body).toBeUndefined();
      await act(async () => {
        gate.release();
        await fetched;
      });
      expect(
        result.current.messages.find((message) => message.id === userId)
          ?.deliveryStatus,
      ).toBe('dispatched');
      if (outcome === 'early-ws-then-error') {
        act(() =>
          result.current.handleWsEvent({
            ...envelope,
            type: 'user_turn',
            seq: 1,
            inflightId: body!.inflightId,
            content: text,
            createdAt: firstUpdateAt,
            firstUpdateAt,
            lastUpdateAt,
          }),
        );
        expect(
          result.current.messages.find((message) => message.id === userId),
        ).toMatchObject({
          deliveryStatus: 'acknowledged',
          firstUpdateAt,
          lastUpdateAt,
        });
      }
      await act(async () => {
        finish(
          outcome === 'accepted' || outcome === 'invalid-accepted'
            ? mockJsonResponse(
                {
                  status: 'started',
                  conversationId: 'c1',
                  inflightId:
                    outcome === 'accepted' ? body!.inflightId : 'unrelated',
                },
                { status: 202 },
              )
            : mockJsonResponse({ message: 'HTTP failed' }, { status: 500 }),
        );
        await request;
      });
      const user = result.current.messages.find(
        (message) => message.id === userId,
      )!;
      expect(user.deliveryStatus).toBe(
        outcome === 'accepted' || outcome === 'early-ws-then-error'
          ? 'acknowledged'
          : 'dispatched',
      );
      expect(
        result.current.messages.filter((message) => message.role === 'user'),
      ).toHaveLength(1);
      if (outcome === 'accepted') {
        act(() =>
          result.current.handleWsEvent({
            ...envelope,
            type: 'user_turn',
            seq: 2,
            inflightId: body!.inflightId,
            content: text,
            createdAt: firstUpdateAt,
          }),
        );
        expect(
          result.current.messages.filter((message) => message.role === 'user'),
        ).toHaveLength(1);
        expect(
          result.current.messages.find((message) => message.id === userId)
            ?.createdAt,
        ).toBe(firstUpdateAt);
      }
    } finally {
      gate.release();
      finish(mockJsonResponse({}, { status: 500 }));
      await act(async () => {
        await request;
      });
      unmount();
      fetchSpy.mockRestore();
      await native.restore();
    }
  },
);

it('keeps a cancelled preparation requested and never calls fetch for it', async () => {
  const native = installNativeCompression();
  const text = 'cancel proof '.repeat(100);
  const gate = native.holdNextBuffer((body) => body.message === text);
  const dispatched: string[] = [];
  const fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url) => {
      if (String(url).endsWith('/chat')) dispatched.push(String(url));
      return mockJsonResponse({});
    });
  const { result, unmount } = renderHook(() => useChatStream('m1', 'codex'));
  let request: Promise<unknown> = Promise.resolve();
  try {
    act(() => {
      request = result.current.send(text);
    });
    await gate.entered;
    act(() => result.current.stop({ showStatusBubble: true }));
    await act(async () => {
      gate.release();
      await request;
    });
    expect(dispatched).toEqual([]);
    expect(
      result.current.messages.find((message) => message.role === 'user')
        ?.deliveryStatus,
    ).toBe('requested');
  } finally {
    gate.release();
    await act(async () => {
      await request;
    });
    unmount();
    fetchSpy.mockRestore();
    await native.restore();
  }
});

it('does not acknowledge an unrelated same-content receipt or a stale conversation receipt', () => {
  const { result } = renderHook(() => useChatStream('m1', 'codex'));
  act(() => result.current.setConversation('c1', { clearMessages: true }));
  let id = '';
  act(() => {
    id = result.current.appendOptimisticUserMessage('repeat');
    result.current.bindOptimisticUserMessageToInflight(id, 'local-run');
    result.current.markUserMessageDispatched(id);
  });
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      conversationId: 'old',
      type: 'user_turn',
      seq: 1,
      inflightId: 'local-run',
      content: 'repeat',
      createdAt: firstUpdateAt,
    }),
  );
  expect(result.current.messages).toHaveLength(1);
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      type: 'user_turn',
      seq: 1,
      inflightId: 'other-run',
      content: 'repeat',
      createdAt: firstUpdateAt,
    }),
  );
  expect(
    result.current.messages.find((message) => message.id === id)
      ?.deliveryStatus,
  ).toBe('dispatched');
  expect(
    result.current.messages.filter((message) => message.role === 'user'),
  ).toHaveLength(2);
});

it('clears run correlations on New and ignores a late accepted response', async () => {
  const native = installNativeCompression();
  let enteredFetch!: () => void;
  const fetched = new Promise<void>((resolve) => {
    enteredFetch = resolve;
  });
  let finish!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  let body: { conversationId: string; inflightId: string } | undefined;
  const fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url, init) => {
      if (!String(url).endsWith('/chat')) return mockJsonResponse({});
      body = decodeJsonBody(init) as typeof body;
      enteredFetch();
      return response;
    });
  const { result, unmount } = renderHook(() => useChatStream('m1', 'codex'));
  let request: Promise<unknown> = Promise.resolve();
  try {
    act(() => {
      request = result.current.send('old run');
    });
    await act(async () => {
      await fetched;
    });
    act(() => {
      result.current.reset();
    });
    const newConversationId = result.current.conversationId;
    await act(async () => {
      finish(mockJsonResponse({ status: 'started', ...body }, { status: 202 }));
      await request;
    });
    act(() =>
      result.current.handleWsEvent({
        ...envelope,
        conversationId: body!.conversationId,
        type: 'turn_persisted',
        seq: 2,
        inflightId: body!.inflightId,
        turnId: 'old-stored',
        firstUpdateAt,
        lastUpdateAt,
      }),
    );
    expect(result.current.conversationId).toBe(newConversationId);
    expect(result.current.messages).toEqual([]);
    expect(result.current.getInflightId()).toBeNull();
    expect(
      result.current.getAssistantMessageIdForInflight(body!.inflightId),
    ).toBeNull();
    expect(result.current.status).toBe('idle');
  } finally {
    finish(mockJsonResponse({}, { status: 500 }));
    await act(async () => {
      await request;
    });
    unmount();
    fetchSpy.mockRestore();
    await native.restore();
  }
});

it('applies persisted identity and server times to the same finalized bubble during a newer run', () => {
  const { result } = renderHook(() => useChatStream('m1', 'codex'));
  act(() => result.current.setConversation('c1', { clearMessages: true }));
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      type: 'assistant_delta',
      seq: 1,
      inflightId: 'i1',
      delta: 'first',
    }),
  );
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      type: 'turn_final',
      seq: 2,
      inflightId: 'i1',
      status: 'stopped',
    }),
  );
  const original = result.current.messages[0];
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      type: 'turn_persisted',
      seq: 3,
      inflightId: 'i1',
      turnId: 'stored-1',
      firstUpdateAt,
    }),
  );
  expect(result.current.messages[0]).toEqual({
    ...original,
    storedTurnId: 'stored-1',
    firstUpdateAt,
  });
  expect(result.current.isStreaming).toBe(false);
  expect(result.current.status).toBe('idle');
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      type: 'user_turn',
      seq: 1,
      inflightId: 'i2',
      content: 'next prompt',
      createdAt: lastUpdateAt,
    }),
  );
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      type: 'assistant_delta',
      seq: 2,
      inflightId: 'i2',
      delta: 'second',
    }),
  );
  const newerId = result.current.getAssistantMessageIdForInflight('i2');
  const newer = result.current.messages.find(
    (message) => message.id === newerId,
  );
  expect(newer).toMatchObject({
    content: 'second',
    streamStatus: 'processing',
  });
  expect(result.current.getInflightId()).toBe('i2');
  expect(result.current.isStreaming).toBe(true);
  const messageIds = result.current.messages.map((message) => message.id);
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      type: 'turn_persisted',
      seq: 4,
      inflightId: 'i1',
      turnId: 'stored-1',
      lastUpdateAt,
    }),
  );
  expect(result.current.messages[0]).toEqual({
    ...original,
    storedTurnId: 'stored-1',
    firstUpdateAt,
    lastUpdateAt,
  });
  expect(
    result.current.messages.find((message) => message.id === newerId),
  ).toBe(newer);
  expect(result.current.messages.map((message) => message.id)).toEqual(
    messageIds,
  );
  expect(result.current.getInflightId()).toBe('i2');
  expect(result.current.isStreaming).toBe(true);
  const before = result.current.messages;
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      type: 'turn_persisted',
      seq: 5,
      inflightId: 'unknown',
      turnId: 'missing',
    }),
  );
  expect(result.current.messages).toBe(before);
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      conversationId: 'old',
      type: 'turn_persisted',
      seq: 6,
      inflightId: 'i1',
      turnId: 'wrong',
    }),
  );
  expect(result.current.messages).toBe(before);
});

it('preserves supplied times through live events, snapshots and history without restamping legacy data', () => {
  const { result } = renderHook(() => useChatStream('m1', 'codex'));
  act(() => result.current.setConversation('c1', { clearMessages: true }));
  act(() =>
    result.current.hydrateInflightSnapshot('c1', {
      inflightId: 'i1',
      assistantText: 'snapshot',
      assistantThink: '',
      toolEvents: [],
      startedAt: '2026-11-01T10:00:00.000Z',
      seq: 1,
      firstUpdateAt,
    }),
  );
  expect(result.current.messages[0].firstUpdateAt).toBe(firstUpdateAt);
  expect(result.current.messages[0].lastUpdateAt).toBeUndefined();
  const events: ChatWsTranscriptEvent[] = [
    {
      ...envelope,
      type: 'inflight_snapshot',
      seq: 2,
      inflight: {
        inflightId: 'i1',
        assistantText: 'snapshot',
        assistantThink: '',
        toolEvents: [],
        startedAt: '2026-11-01T10:00:00.000Z',
        firstUpdateAt,
        lastUpdateAt,
      },
    },
    {
      ...envelope,
      type: 'assistant_delta',
      seq: 3,
      inflightId: 'i1',
      delta: ' text',
      lastUpdateAt,
    },
    {
      ...envelope,
      type: 'analysis_delta',
      seq: 4,
      inflightId: 'i1',
      delta: 'thought',
      lastUpdateAt,
    },
    {
      ...envelope,
      type: 'tool_event',
      seq: 5,
      inflightId: 'i1',
      event: { type: 'tool-request', callId: 't1' },
      lastUpdateAt,
    },
    {
      ...envelope,
      type: 'stream_warning',
      seq: 6,
      inflightId: 'i1',
      message: 'warning',
      lastUpdateAt,
    },
    {
      ...envelope,
      type: 'turn_final',
      seq: 7,
      inflightId: 'i1',
      status: 'ok',
      lastUpdateAt,
    },
  ];
  events.forEach((event, index) => {
    const receiptTime = `2026-11-01T10:00:0${index + 2}.000Z`;
    act(() =>
      result.current.handleWsEvent(
        event.type === 'inflight_snapshot'
          ? {
              ...event,
              inflight: { ...event.inflight, lastUpdateAt: receiptTime },
            }
          : { ...event, lastUpdateAt: receiptTime },
      ),
    );
    expect(result.current.messages[0]).toMatchObject({
      firstUpdateAt,
      lastUpdateAt: receiptTime,
    });
  });
  act(() => result.current.setConversation('c1', { clearMessages: true }));
  act(() =>
    result.current.hydrateHistory('c1', [
      {
        id: 'legacy-user',
        role: 'user',
        content: 'old',
        createdAt: firstUpdateAt,
      },
      {
        id: 'stored-assistant',
        role: 'assistant',
        content: 'saved',
        firstUpdateAt,
        lastUpdateAt,
      },
    ]),
  );
  expect(result.current.messages[0]).toMatchObject({
    deliveryStatus: 'acknowledged',
    createdAt: firstUpdateAt,
  });
  expect(result.current.messages[0].firstUpdateAt).toBeUndefined();
  expect(result.current.messages[0].lastUpdateAt).toBeUndefined();
  expect(result.current.messages[1]).toMatchObject({
    firstUpdateAt,
    lastUpdateAt,
  });
});

it('keeps preparation failures requested without inventing server timestamps', async () => {
  const native = installNativeCompression();
  const fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(mockJsonResponse({}));
  Object.defineProperty(globalThis, 'CompressionStream', {
    value: class {
      constructor() {
        throw new Error('compression failed');
      }
    },
  });
  const { result, unmount } = renderHook(() => useChatStream('m1', 'codex'));
  try {
    await act(async () => {
      await result.current.send('unsent');
    });
    const user = result.current.messages.find(
      (message) => message.role === 'user',
    )!;
    expect(user.deliveryStatus).toBe('requested');
    expect(user.firstUpdateAt).toBeUndefined();
    expect(user.lastUpdateAt).toBeUndefined();
    expect(
      fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/chat')),
    ).toHaveLength(0);
  } finally {
    unmount();
    fetchSpy.mockRestore();
    await native.restore();
  }
});

it.each([
  'assistant_delta',
  'inflight_snapshot',
  'turn_final',
  'turn_persisted',
] as const)(
  'acknowledges a correlated %s before dispatch and never downgrades it',
  (type) => {
    const { result } = renderHook(() => useChatStream('m1', 'codex'));
    act(() => result.current.setConversation('c1', { clearMessages: true }));
    let id = '';
    act(() => {
      id = result.current.appendOptimisticUserMessage('prompt');
      result.current.bindOptimisticUserMessageToInflight(id, 'i1');
    });
    const event: ChatWsTranscriptEvent =
      type === 'inflight_snapshot'
        ? {
            ...envelope,
            type,
            seq: 1,
            inflight: {
              inflightId: 'i1',
              assistantText: '',
              assistantThink: '',
              toolEvents: [],
              startedAt: firstUpdateAt,
            },
          }
        : type === 'assistant_delta'
          ? { ...envelope, type, seq: 1, inflightId: 'i1', delta: 'reply' }
          : type === 'turn_final'
            ? { ...envelope, type, seq: 1, inflightId: 'i1', status: 'ok' }
            : { ...envelope, type, seq: 1, inflightId: 'i1', turnId: 'stored' };
    act(() => result.current.handleWsEvent(event));
    act(() => result.current.markUserMessageDispatched(id));
    expect(
      result.current.messages.find((message) => message.id === id)
        ?.deliveryStatus,
    ).toBe('acknowledged');
  },
);

it('does not match pending history users by content and preserves canonical assistant identity for time-only hydration', () => {
  const { result } = renderHook(() => useChatStream('m1', 'codex'));
  act(() => result.current.setConversation('c1', { clearMessages: true }));
  let pendingId = '';
  act(() => {
    pendingId = result.current.appendOptimisticUserMessage('repeat');
  });
  act(() =>
    result.current.hydrateHistory('c1', [
      {
        id: 'stored-user',
        role: 'user',
        content: 'repeat',
        createdAt: firstUpdateAt,
      },
    ]),
  );
  expect(
    result.current.messages.find((message) => message.id === pendingId)
      ?.deliveryStatus,
  ).toBe('requested');
  expect(
    result.current.messages.find((message) => message.id === 'stored-user')
      ?.deliveryStatus,
  ).toBe('acknowledged');
  act(() => result.current.setConversation('c1', { clearMessages: true }));
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      type: 'assistant_delta',
      seq: 1,
      inflightId: 'i1',
      delta: 'reply',
    }),
  );
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      type: 'turn_final',
      seq: 2,
      inflightId: 'i1',
      status: 'ok',
    }),
  );
  act(() =>
    result.current.handleWsEvent({
      ...envelope,
      type: 'turn_persisted',
      seq: 3,
      inflightId: 'i1',
      turnId: 'stored-assistant',
      firstUpdateAt,
    }),
  );
  const originalId = result.current.messages[0].id;
  act(() =>
    result.current.hydrateHistory('c1', [
      {
        id: 'history-id',
        storedTurnId: 'stored-assistant',
        role: 'assistant',
        content: 'reply',
        streamStatus: 'complete',
        firstUpdateAt,
        lastUpdateAt,
      },
    ]),
  );
  expect(result.current.messages).toHaveLength(1);
  expect(result.current.messages[0]).toMatchObject({
    id: originalId,
    storedTurnId: 'stored-assistant',
    firstUpdateAt,
    lastUpdateAt,
  });
});

it.each([
  'lost-both-acks',
  'history-before-http',
  'http-before-history',
] as const)(
  'reconciles completed persisted history by inflight identity with %s',
  async (order) => {
    const native = installNativeCompression();
    let finish!: (response: Response) => void;
    let rejectResponse!: (reason: unknown) => void;
    const response = new Promise<Response>((resolve, reject) => {
      finish = resolve;
      rejectResponse = reject;
    });
    let enteredFetch!: () => void;
    const fetched = new Promise<void>((resolve) => {
      enteredFetch = resolve;
    });
    let body: { conversationId: string; inflightId: string } | undefined;
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url, init) => {
        if (!String(url).endsWith('/chat')) return mockJsonResponse({});
        body = decodeJsonBody(init) as typeof body;
        enteredFetch();
        return response;
      });
    const { result, unmount } = renderHook(() => useChatStream('m1', 'codex'));
    let request: Promise<unknown> = Promise.resolve();
    try {
      act(() => result.current.setConversation('c1', { clearMessages: true }));
      act(() => {
        request = result.current.send('repeat');
      });
      await act(async () => {
        await fetched;
      });
      const liveId = result.current.messages.find(
        (message) => message.role === 'user',
      )!.id;
      expect(
        result.current.messages.find((message) => message.id === liveId)
          ?.deliveryStatus,
      ).toBe('dispatched');
      const accepted = mockJsonResponse(
        { status: 'started', ...body },
        { status: 202 },
      );
      if (order !== 'history-before-http') {
        await act(async () => {
          if (order === 'lost-both-acks') {
            rejectResponse(
              new TypeError('network response lost after server acceptance'),
            );
          } else {
            finish(accepted);
          }
          await request;
        });
      }
      if (order === 'lost-both-acks') {
        expect(
          result.current.messages.find((message) => message.id === liveId)
            ?.deliveryStatus,
        ).toBe('dispatched');
        expect(result.current.getInflightId()).toBeNull();
      }
      // The run completed while offline: only stored history is received, with no
      // user_turn, turn_final, or inflight snapshot to supply an acknowledgement.
      const stored: ChatMessage[] = [
        {
          id: 'stored-user',
          role: 'user',
          content: 'repeat',
          inflightId: body!.inflightId,
          createdAt: firstUpdateAt,
        },
        {
          id: 'stored-assistant',
          role: 'assistant',
          content: 'completed answer',
          inflightId: body!.inflightId,
          streamStatus: 'complete',
          createdAt: lastUpdateAt,
        },
      ];
      act(() => result.current.hydrateHistory('c1', stored));
      expect(
        result.current.messages.filter((message) => message.role === 'user'),
      ).toHaveLength(1);
      expect(
        result.current.messages.find((message) => message.id === liveId),
      ).toMatchObject({
        inflightId: body!.inflightId,
        content: 'repeat',
        createdAt: firstUpdateAt,
        optimistic: false,
        deliveryStatus: 'acknowledged',
      });
      if (order === 'history-before-http') {
        await act(async () => {
          finish(accepted);
          await request;
        });
      }
      act(() => {
        result.current.acknowledgeUserMessage(liveId);
        result.current.markUserMessageDispatched(liveId);
      });
      act(() =>
        result.current.hydrateHistory(
          'c1',
          stored.map((message) => ({ ...message })),
        ),
      );
      act(() =>
        result.current.hydrateHistory(
          'c1',
          stored.map((message) => ({ ...message })),
        ),
      );
      expect(
        result.current.messages.filter((message) => message.role === 'user'),
      ).toHaveLength(1);
      expect(
        result.current.messages.find((message) => message.id === liveId)
          ?.deliveryStatus,
      ).toBe('acknowledged');
      let unrelatedId = '';
      act(() => {
        unrelatedId = result.current.appendOptimisticUserMessage('repeat');
        result.current.bindOptimisticUserMessageToInflight(
          unrelatedId,
          'unrelated-run',
        );
        result.current.markUserMessageDispatched(unrelatedId);
      });
      act(() => result.current.hydrateHistory('c1', stored));
      expect(
        result.current.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.id),
      ).toEqual([liveId, unrelatedId]);
      expect(
        result.current.messages.find((message) => message.id === unrelatedId)
          ?.deliveryStatus,
      ).toBe('dispatched');
    } finally {
      finish(mockJsonResponse({}, { status: 500 }));
      await act(async () => {
        await request;
      });
      unmount();
      fetchSpy.mockRestore();
      await native.restore();
    }
  },
);

it('reconciles an existing stored duplicate when later history adds only inflight identity', () => {
  const { result } = renderHook(() => useChatStream('m1', 'codex'));
  act(() => result.current.setConversation('c1', { clearMessages: true }));
  let liveId = '';
  act(() => {
    liveId = result.current.appendOptimisticUserMessage('repeat');
    result.current.bindOptimisticUserMessageToInflight(liveId, 'i1');
    result.current.markUserMessageDispatched(liveId);
  });
  const legacy: ChatMessage = {
    id: 'stored-user',
    role: 'user',
    content: 'repeat',
    createdAt: firstUpdateAt,
  };
  act(() => result.current.hydrateHistory('c1', [legacy]));
  expect(
    result.current.messages.filter((message) => message.role === 'user'),
  ).toHaveLength(2);
  // Put the live user beyond the existing six-message content matching window.
  act(() => {
    for (let index = 0; index < 8; index += 1) {
      result.current.appendLocalMessage({
        id: `other-${index}`,
        role: 'assistant',
        content: `${index}`,
      });
    }
  });
  const identified = { ...legacy, inflightId: 'i1' };
  act(() => result.current.hydrateHistory('c1', [identified]));
  act(() => result.current.hydrateHistory('c1', [{ ...identified }]));
  expect(
    result.current.messages.filter((message) => message.role === 'user'),
  ).toEqual([
    {
      ...identified,
      id: liveId,
      deliveryStatus: 'acknowledged',
      optimistic: false,
    },
  ]);
  act(() => result.current.acknowledgeUserMessage(liveId));
  expect(
    result.current.messages.filter((message) => message.role === 'user'),
  ).toHaveLength(1);
});
