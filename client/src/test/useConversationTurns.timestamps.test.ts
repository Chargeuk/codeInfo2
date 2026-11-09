import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import useConversationTurns from '../hooks/useConversationTurns';
import { mockJsonResponse } from './support/fetchMock';

it('retains history and inflight server times and leaves legacy timestamps absent', async () => {
  const createdAt = '2026-11-01T10:00:00.000Z';
  const firstUpdateAt = '2026-11-01T10:00:01.000Z';
  const lastUpdateAt = '2026-11-01T10:00:02.000Z';
  const legacy = {
    turnId: 'legacy',
    conversationId: 'c1',
    role: 'user',
    content: 'old',
    model: 'm1',
    provider: 'codex',
    status: 'ok',
    createdAt,
  };
  const assistant = {
    ...legacy,
    turnId: 'assistant',
    role: 'assistant',
    content: 'answer',
    firstUpdateAt,
    lastUpdateAt,
    runtime: { replay: { inflightId: 'persisted-run' } },
  };
  const inflight = {
    inflightId: 'i1',
    assistantText: 'next',
    assistantThink: '',
    toolEvents: [],
    startedAt: '2026-11-01T10:00:03.000Z',
    seq: 3,
    firstUpdateAt,
    lastUpdateAt,
  };
  const fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      mockJsonResponse({ items: [assistant, legacy], inflight }),
    );
  const { result, unmount } = renderHook(() =>
    useConversationTurns('c1', { autoFetch: false }),
  );
  try {
    await act(async () => {
      await result.current.refresh();
    });
    expect(
      result.current.turns.find((turn) => turn.turnId === 'assistant'),
    ).toMatchObject({
      firstUpdateAt,
      lastUpdateAt,
      runtime: { replay: { inflightId: 'persisted-run' } },
    });
    const storedLegacy = result.current.turns.find(
      (turn) => turn.turnId === 'legacy',
    )!;
    expect(storedLegacy.createdAt).toBe(createdAt);
    expect(storedLegacy).not.toHaveProperty('firstUpdateAt');
    expect(storedLegacy).not.toHaveProperty('lastUpdateAt');
    expect(result.current.inflight).toMatchObject({
      firstUpdateAt,
      lastUpdateAt,
    });
    fetchSpy.mockResolvedValue(
      mockJsonResponse({
        items: [legacy],
        inflight: {
          inflightId: 'i2',
          assistantText: '',
          assistantThink: '',
          toolEvents: [],
          startedAt: inflight.startedAt,
          seq: 4,
        },
      }),
    );
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.inflight).not.toHaveProperty('firstUpdateAt');
    expect(result.current.inflight).not.toHaveProperty('lastUpdateAt');
  } finally {
    unmount();
    fetchSpy.mockRestore();
  }
});
