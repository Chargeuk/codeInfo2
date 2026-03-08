import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, useEffect, useRef } from 'react';
import useConversationTurns from '../hooks/useConversationTurns';
import {
  asFetchImplementation,
  getFetchMock,
  mockJsonResponse,
} from './support/fetchMock';

const mockFetch = getFetchMock();

beforeEach(() => {
  mockFetch.mockReset();
});

function mockTurnsSnapshot(
  items: Array<Record<string, unknown>>,
  inflight?: Record<string, unknown>,
): Response {
  return mockJsonResponse({
    items,
    ...(inflight === undefined ? {} : { inflight }),
  });
}

function mockApi() {
  let turnsCall = 0;
  mockFetch.mockImplementation(
    asFetchImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (!url.includes('/conversations/c1/turns')) {
        return mockJsonResponse({});
      }

      turnsCall += 1;
      if (turnsCall === 1) {
        return mockTurnsSnapshot([
          {
            conversationId: 'c1',
            role: 'assistant',
            content: 'Initial reply',
            model: 'm1',
            provider: 'lmstudio',
            toolCalls: null,
            status: 'ok',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ]);
      }

      return mockTurnsSnapshot([
        {
          conversationId: 'c1',
          role: 'assistant',
          content: 'Refreshed reply',
          model: 'm1',
          provider: 'lmstudio',
          toolCalls: null,
          status: 'ok',
          createdAt: '2025-01-02T00:00:00Z',
        },
      ]);
    }),
  );
}

function TestTurnsRefresh() {
  const { turns, refresh } = useConversationTurns('c1');
  const refreshedRef = useRef(false);

  useEffect(() => {
    if (
      !refreshedRef.current &&
      turns.some((turn) => turn.content === 'Initial reply')
    ) {
      refreshedRef.current = true;
      void refresh();
    }
  }, [refresh, turns]);

  return createElement(
    'div',
    null,
    ...turns.map((turn) =>
      createElement('p', { key: turn.createdAt }, turn.content),
    ),
  );
}

test('useConversationTurns.refresh replaces turn state from full snapshot', async () => {
  mockApi();

  render(createElement(TestTurnsRefresh));

  expect(await screen.findByText('Initial reply')).toBeInTheDocument();

  await act(async () => {
    await Promise.resolve();
  });

  expect(await screen.findByText('Refreshed reply')).toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledTimes(2);

  const urls = mockFetch.mock.calls.map(([input]) =>
    typeof input === 'string' ? input : input.toString(),
  );
  expect(urls.every((url) => url.includes('/conversations/c1/turns'))).toBe(
    true,
  );
  expect(urls.some((url) => url.includes('?'))).toBe(false);
});

test('useConversationTurns.refresh error does not clear existing turns', async () => {
  let turnsCall = 0;
  mockFetch.mockImplementation(
    asFetchImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (!url.includes('/conversations/c1/turns')) {
        return mockJsonResponse({});
      }

      turnsCall += 1;
      if (turnsCall === 1) {
        return mockTurnsSnapshot([
          {
            conversationId: 'c1',
            role: 'assistant',
            content: 'Initial reply',
            model: 'm1',
            provider: 'lmstudio',
            toolCalls: null,
            status: 'ok',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ]);
      }

      return mockJsonResponse({}, { status: 500 });
    }),
  );

  function TestTurnsError() {
    const { turns, isError, error, refresh } = useConversationTurns('c1');
    const refreshedRef = useRef(false);

    useEffect(() => {
      if (!refreshedRef.current && turns.length > 0) {
        refreshedRef.current = true;
        void refresh();
      }
    }, [refresh, turns]);

    return createElement(
      'div',
      null,
      createElement(
        'span',
        { 'data-testid': 'error' },
        isError ? (error ?? 'error') : 'ok',
      ),
      ...turns.map((turn) =>
        createElement('p', { key: turn.createdAt }, turn.content),
      ),
    );
  }

  render(createElement(TestTurnsError));
  expect(await screen.findByText('Initial reply')).toBeInTheDocument();

  await act(async () => {
    await Promise.resolve();
  });

  expect(screen.getByText('Initial reply')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByTestId('error').textContent).toContain('Failed to load'),
  );
});

type OverlayState = {
  turns: string[];
  inflightId: string;
};

function TestInflightOverlay() {
  const { turns, inflight } = useConversationTurns('c1');
  const state: OverlayState = {
    turns: turns.map((turn) => turn.content),
    inflightId: inflight?.inflightId ?? 'none',
  };

  return createElement(
    'div',
    { 'data-testid': 'overlay' },
    JSON.stringify(state),
  );
}

function findOverlayLog(logSpy: { mock: { calls: unknown[][] } }) {
  return logSpy.mock.calls
    .map(([entry]) => entry)
    .find(
      (
        entry,
      ): entry is {
        message?: string;
        context?: {
          overlayApplied?: boolean;
          assistantPresent?: boolean;
        };
      } =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        entry !== null &&
        'message' in entry &&
        (entry as { message?: string }).message ===
          'DEV-0000029:T2:inflight_overlay_decision',
    );
}

test('snapshot retains assistant history during inflight thinking', async () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  mockFetch.mockImplementation(
    asFetchImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/conversations/c1/turns')) {
        return mockTurnsSnapshot(
          [
            {
              conversationId: 'c1',
              role: 'assistant',
              content: 'Assistant A',
              model: 'm1',
              provider: 'lmstudio',
              toolCalls: null,
              status: 'ok',
              createdAt: '2025-01-01T00:00:00Z',
            },
            {
              conversationId: 'c1',
              role: 'assistant',
              content: 'Assistant B',
              model: 'm1',
              provider: 'lmstudio',
              toolCalls: null,
              status: 'ok',
              createdAt: '2025-01-01T00:00:01Z',
            },
          ],
          {
            inflightId: 'i1',
            assistantText: '',
            assistantThink: '',
            toolEvents: [],
            startedAt: '2025-01-02T00:00:00Z',
            seq: 1,
          },
        );
      }

      return mockJsonResponse({});
    }),
  );

  render(createElement(TestInflightOverlay));

  await waitFor(() => {
    const overlay = screen.getByTestId('overlay');
    const state = JSON.parse(overlay.textContent ?? '{}') as OverlayState;
    expect(state.turns).toEqual(['Assistant A', 'Assistant B']);
    expect(state.inflightId).toBe('i1');
  });

  await waitFor(() => {
    const logEntry = findOverlayLog(logSpy);
    expect(logEntry?.context?.overlayApplied).toBe(true);
  });

  logSpy.mockRestore();
});

test('no duplicate assistant bubble when snapshot includes inflight assistant', async () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  mockFetch.mockImplementation(
    asFetchImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/conversations/c1/turns')) {
        return mockTurnsSnapshot(
          [
            {
              conversationId: 'c1',
              role: 'assistant',
              content: 'Inflight content',
              model: 'm1',
              provider: 'lmstudio',
              toolCalls: null,
              status: 'ok',
              createdAt: '2025-01-02T00:00:00Z',
            },
          ],
          {
            inflightId: 'i1',
            assistantText: 'Inflight content',
            assistantThink: '',
            toolEvents: [],
            startedAt: '2025-01-02T00:00:00Z',
            seq: 1,
          },
        );
      }

      return mockJsonResponse({});
    }),
  );

  render(createElement(TestInflightOverlay));

  await waitFor(() => {
    const overlay = screen.getByTestId('overlay');
    const state = JSON.parse(overlay.textContent ?? '{}') as OverlayState;
    expect(state.turns).toEqual(['Inflight content']);
    expect(state.inflightId).toBe('none');
  });

  await waitFor(() => {
    const logEntry = findOverlayLog(logSpy);
    expect(logEntry?.context?.overlayApplied).toBe(false);
  });

  logSpy.mockRestore();
});

test('no overlay when snapshot has finalized inflight assistant with empty text', async () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  mockFetch.mockImplementation(
    asFetchImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/conversations/c1/turns')) {
        return mockTurnsSnapshot(
          [
            {
              conversationId: 'c1',
              role: 'assistant',
              content: '',
              model: 'm1',
              provider: 'lmstudio',
              toolCalls: null,
              status: 'ok',
              createdAt: '2025-01-02T00:00:00Z',
            },
          ],
          {
            inflightId: 'i1',
            assistantText: '',
            assistantThink: '',
            toolEvents: [],
            startedAt: '2025-01-02T00:00:00Z',
            seq: 1,
          },
        );
      }

      return mockJsonResponse({});
    }),
  );

  render(createElement(TestInflightOverlay));

  await waitFor(() => {
    const overlay = screen.getByTestId('overlay');
    const state = JSON.parse(overlay.textContent ?? '{}') as OverlayState;
    expect(state.turns).toEqual(['']);
    expect(state.inflightId).toBe('none');
  });

  await waitFor(() => {
    const logEntry = findOverlayLog(logSpy);
    expect(logEntry?.context?.overlayApplied).toBe(false);
  });

  logSpy.mockRestore();
});

test('overlay appears when snapshot has no inflight assistant', async () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  mockFetch.mockImplementation(
    asFetchImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/conversations/c1/turns')) {
        return mockTurnsSnapshot(
          [
            {
              conversationId: 'c1',
              role: 'user',
              content: 'hello',
              model: 'm1',
              provider: 'lmstudio',
              toolCalls: null,
              status: 'ok',
              createdAt: '2025-01-01T00:00:00Z',
            },
          ],
          {
            inflightId: 'i1',
            assistantText: '',
            assistantThink: '',
            toolEvents: [],
            startedAt: '2025-01-02T00:00:00Z',
            seq: 1,
          },
        );
      }

      return mockJsonResponse({});
    }),
  );

  render(createElement(TestInflightOverlay));

  await waitFor(() => {
    const overlay = screen.getByTestId('overlay');
    const state = JSON.parse(overlay.textContent ?? '{}') as OverlayState;
    expect(state.turns).toEqual(['hello']);
    expect(state.inflightId).toBe('i1');
  });

  await waitFor(() => {
    const logEntry = findOverlayLog(logSpy);
    expect(logEntry?.context?.overlayApplied).toBe(true);
  });

  logSpy.mockRestore();
});

test('inflight id change resets overlay', async () => {
  let turnsCall = 0;
  mockFetch.mockImplementation(
    asFetchImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (!url.includes('/conversations/c1/turns')) {
        return mockJsonResponse({});
      }

      turnsCall += 1;
      if (turnsCall === 1) {
        return mockTurnsSnapshot([], {
          inflightId: 'i1',
          assistantText: 'First',
          assistantThink: '',
          toolEvents: [],
          startedAt: '2025-01-02T00:00:00Z',
          seq: 1,
        });
      }

      return mockTurnsSnapshot([], {
        inflightId: 'i2',
        assistantText: 'Second',
        assistantThink: '',
        toolEvents: [],
        startedAt: '2025-01-03T00:00:00Z',
        seq: 1,
      });
    }),
  );

  function TestInflightRefresh() {
    const { inflight, refresh } = useConversationTurns('c1');
    const refreshedRef = useRef(false);

    useEffect(() => {
      if (!refreshedRef.current && inflight?.inflightId === 'i1') {
        refreshedRef.current = true;
        void refresh();
      }
    }, [inflight, refresh]);

    return createElement(
      'div',
      { 'data-testid': 'inflight' },
      `${inflight?.inflightId ?? 'none'}:${inflight?.assistantText ?? ''}`,
    );
  }

  render(createElement(TestInflightRefresh));

  expect(await screen.findByText('i1:First')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByText('i2:Second')).toBeInTheDocument(),
  );
});
