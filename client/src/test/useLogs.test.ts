import type { LogEntry } from '@codeinfo2/common';
import { jest } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import useLogs from '../hooks/useLogs';

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
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ items: [baseLog], lastSequence: 1 }),
      } as Response);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.EventSource = originalEventSource as typeof EventSource;
    jest.clearAllMocks();
  });

  it('fetches logs and processes SSE events', async () => {
    const { es, emit } = createMockEventSource();
    (global as typeof globalThis & { EventSource: jest.Mock }).EventSource =
      jest.fn(() => es);

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
    (global as typeof globalThis & { EventSource: jest.Mock }).EventSource =
      jest.fn(() => mockEs);

    const { result } = renderHook(
      ({ live }) => useLogs({ level: [], source: [], text: '' }, live),
      { initialProps: { live: false } },
    );

    await waitFor(() => expect(result.current.logs).toHaveLength(1));
    expect(global.EventSource).not.toHaveBeenCalled();
  });
});
