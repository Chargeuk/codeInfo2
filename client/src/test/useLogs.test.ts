import type { LogEntry } from '@codeinfo2/common';
import { jest } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import useLogs from '../hooks/useLogs';
import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const originalFetch = global.fetch;
const originalEventSource = global.EventSource;

const baseLog: LogEntry = {
  level: 'info',
  message: 'initial',
  timestamp: '2025-01-01T00:00:00.000Z',
  source: 'server',
  sequence: 1,
};

function createMockEventSource() {
  const es = {
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
    onerror: null as (() => void) | null,
    close: jest.fn(),
  } as unknown as EventSource;

  return {
    es,
    emit(data: unknown) {
      es.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
    },
  };
}

describe('useLogs', () => {
  beforeEach(() => {
    global.fetch = getFetchMock();
    getFetchMock().mockReset();
    getFetchMock().mockResolvedValue(
      mockJsonResponse({ items: [baseLog], lastSequence: 1 }),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.EventSource = originalEventSource as typeof EventSource;
    jest.clearAllMocks();
  });

  it('fetches logs and processes SSE events', async () => {
    const { es, emit } = createMockEventSource();
    global.EventSource = jest.fn(() => es) as unknown as typeof EventSource;

    const { result } = renderHook(() =>
      useLogs({ level: [], source: [], text: '' }, true),
    );

    await waitFor(() => expect(result.current.logs).toHaveLength(1));

    act(() => {
      emit({ ...baseLog, message: 'streamed', sequence: 2 });
    });

    await waitFor(() =>
      expect(result.current.logs.some((l) => l.message === 'streamed')).toBe(
        true,
      ),
    );
  });

  it('does not open EventSource when live is false', async () => {
    const mockEs = createMockEventSource().es;
    global.EventSource = jest.fn(() => mockEs) as unknown as typeof EventSource;

    const { result } = renderHook(
      ({ live }) => useLogs({ level: [], source: [], text: '' }, live),
      { initialProps: { live: false } },
    );

    await waitFor(() => expect(result.current.logs).toHaveLength(1));
    expect(global.EventSource).not.toHaveBeenCalled();
  });

  it('re-fetches logs with the active filters when refreshQuery is used', async () => {
    const { es } = createMockEventSource();
    global.EventSource = jest.fn(() => es) as unknown as typeof EventSource;

    const { result } = renderHook(() =>
      useLogs({ level: ['error'], source: ['server'], text: 'boom' }, true),
    );

    await waitFor(() => expect(result.current.logs).toHaveLength(1));
    expect(getFetchMock().mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('/logs?level=error&source=server&text=boom'),
    );

    getFetchMock().mockResolvedValueOnce(
      mockJsonResponse({
        items: [{ ...baseLog, message: 'refreshed', sequence: 2 }],
        lastSequence: 2,
      }),
    );

    await act(async () => {
      result.current.refreshQuery();
    });

    await waitFor(() =>
      expect(
        result.current.logs.some((log) => log.message === 'refreshed'),
      ).toBe(true),
    );
    expect(getFetchMock().mock.calls.at(-1)?.[0]).toEqual(
      expect.stringContaining('_r=1'),
    );
  });
});
