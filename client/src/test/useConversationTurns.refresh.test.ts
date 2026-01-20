import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, useEffect, useRef } from 'react';
import useConversationTurns from '../hooks/useConversationTurns';

const mockFetch = global.fetch as jest.Mock;

beforeEach(() => {
  mockFetch.mockReset();
});

function mockApi() {
  let turnsCall = 0;
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/conversations/c1/turns')) {
      turnsCall += 1;
      if (turnsCall === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
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
            ],
          }),
        }) as Response;
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
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
          ],
        }),
      }) as Response;
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Response;
  });
}

function TestTurnsRefresh() {
  const { turns, refresh } = useConversationTurns('c1');
  const refreshedRef = useRef(false);

  useEffect(() => {
    if (
      !refreshedRef.current &&
      turns.some((t) => t.content === 'Initial reply')
    ) {
      refreshedRef.current = true;
      void refresh();
    }
  }, [refresh, turns]);

  return createElement(
    'div',
    null,
    ...turns.map((t) => createElement('p', { key: t.createdAt }, t.content)),
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

  const urls = mockFetch.mock.calls.map((call) =>
    typeof call[0] === 'string' ? call[0] : call[0].toString(),
  );
  expect(urls.every((url) => url.includes('/conversations/c1/turns'))).toBe(
    true,
  );
  expect(urls.some((url) => url.includes('?'))).toBe(false);
});

test('useConversationTurns.refresh error does not clear existing turns', async () => {
  let turnsCall = 0;
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (!url.includes('/conversations/c1/turns')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as Response;
    }

    turnsCall += 1;
    if (turnsCall === 1) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
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
          ],
        }),
      }) as Response;
    }

    return Promise.resolve({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as Response;
  });

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
      ...turns.map((t) => createElement('p', { key: t.createdAt }, t.content)),
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

const findOverlayLog = (logSpy: jest.SpyInstance) =>
  logSpy.mock.calls
    .map((call) => call[0])
    .find(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        'message' in entry &&
        (entry as { message?: string }).message ===
          'DEV-0000029:T2:inflight_overlay_decision',
    ) as
    | {
        context?: {
          overlayApplied?: boolean;
          assistantPresent?: boolean;
        };
      }
    | undefined;

test('snapshot retains assistant history during inflight thinking', async () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/conversations/c1/turns')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
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
          inflight: {
            inflightId: 'i1',
            assistantText: '',
            assistantThink: '',
            toolEvents: [],
            startedAt: '2025-01-02T00:00:00Z',
            seq: 1,
          },
        }),
      }) as Response;
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Response;
  });

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

  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/conversations/c1/turns')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
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
          inflight: {
            inflightId: 'i1',
            assistantText: 'Inflight content',
            assistantThink: '',
            toolEvents: [],
            startedAt: '2025-01-02T00:00:00Z',
            seq: 1,
          },
        }),
      }) as Response;
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Response;
  });

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

  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/conversations/c1/turns')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
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
          inflight: {
            inflightId: 'i1',
            assistantText: '',
            assistantThink: '',
            toolEvents: [],
            startedAt: '2025-01-02T00:00:00Z',
            seq: 1,
          },
        }),
      }) as Response;
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Response;
  });

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

  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/conversations/c1/turns')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
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
          inflight: {
            inflightId: 'i1',
            assistantText: '',
            assistantThink: '',
            toolEvents: [],
            startedAt: '2025-01-02T00:00:00Z',
            seq: 1,
          },
        }),
      }) as Response;
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Response;
  });

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
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/conversations/c1/turns')) {
      turnsCall += 1;
      if (turnsCall === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [],
            inflight: {
              inflightId: 'i1',
              assistantText: 'First',
              assistantThink: '',
              toolEvents: [],
              startedAt: '2025-01-02T00:00:00Z',
              seq: 1,
            },
          }),
        }) as Response;
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [],
          inflight: {
            inflightId: 'i2',
            assistantText: 'Second',
            assistantThink: '',
            toolEvents: [],
            startedAt: '2025-01-03T00:00:00Z',
            seq: 1,
          },
        }),
      }) as Response;
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Response;
  });

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
