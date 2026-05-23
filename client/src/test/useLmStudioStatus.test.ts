import {
  LmStudioStatusOk,
  type LmStudioStatusResponse,
} from '@codeinfo2/common';
import { renderHook, act } from '@testing-library/react';
import { getLmStudioBaseUrl } from '../config/runtimeConfig';
import { useLmStudioStatus } from '../hooks/useLmStudioStatus';
import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const okMany: LmStudioStatusOk = {
  status: 'ok',
  baseUrl: 'http://host.docker.internal:1234',
  models: [{ modelKey: 'm1', displayName: 'Model One', type: 'gguf' }],
};

const okEmpty: LmStudioStatusOk = { ...okMany, models: [] };

function mockFetchResponse(response: Response) {
  getFetchMock().mockResolvedValue(response);
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useLmStudioStatus', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = getFetchMock();
    getFetchMock().mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches models and sets success state', async () => {
    mockFetchResponse(mockJsonResponse(okMany));
    const { result } = renderHook(() => useLmStudioStatus());

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.state.status).toBe('success');
    expect(
      result.current.state.status === 'success' &&
        result.current.state.data.models.length,
    ).toBe(1);
    expect(result.current.isEmpty).toBe(false);
  });

  it('marks empty when no models', async () => {
    mockFetchResponse(mockJsonResponse(okEmpty));
    const { result } = renderHook(() => useLmStudioStatus());
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.isEmpty).toBe(true);
  });

  it('handles error response status', async () => {
    const errBody: LmStudioStatusResponse = {
      status: 'error',
      baseUrl: 'http://bad',
      error: 'boom',
    };
    mockFetchResponse(mockJsonResponse(errBody, { status: 502 }));
    const { result } = renderHook(() => useLmStudioStatus());
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state.status).toBe('error');
    expect(
      result.current.state.status === 'error' && result.current.state.error,
    ).toContain('502');
  });

  it('handles network rejection', async () => {
    getFetchMock().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useLmStudioStatus());
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state.status).toBe('error');
    expect(
      result.current.state.status === 'error' && result.current.state.error,
    ).toContain('network down');
  });

  it('persists baseUrl to localStorage', async () => {
    mockFetchResponse(mockJsonResponse(okMany));
    const { result } = renderHook(() => useLmStudioStatus());
    await act(async () => {
      await result.current.refresh('http://override:1234');
    });
    expect(localStorage.getItem('lmstudio.baseUrl')).toBe(
      'http://override:1234',
    );
    expect(result.current.baseUrl).toBe('http://override:1234');
  });

  it('falls back to the runtime default when no committed value is stored', () => {
    const { result } = renderHook(() => useLmStudioStatus());

    expect(result.current.baseUrl).toBe(getLmStudioBaseUrl());
    expect(result.current.committedBaseUrl).toBe(getLmStudioBaseUrl());
  });

  it('passes whitespace-only explicit input through the existing server error path', async () => {
    getFetchMock().mockImplementation(async (input) => {
      const href = typeof input === 'string' ? input : input.toString();
      if (
        href.includes('/lmstudio/status?baseUrl=+++') ||
        href.includes('/lmstudio/status?baseUrl=%20%20%20')
      ) {
        return mockJsonResponse(
          {
            status: 'error',
            baseUrl: '   ',
            error: 'Invalid baseUrl',
          } satisfies LmStudioStatusResponse,
          { status: 400 },
        );
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });

    const { result } = renderHook(() => useLmStudioStatus());

    await act(async () => {
      await result.current.refresh('   ');
    });

    expect(getFetchMock()).toHaveBeenCalledWith(
      expect.stringContaining('/lmstudio/status?baseUrl=+++'),
    );

    expect(result.current.state.status).toBe('error');
    expect(
      result.current.state.status === 'error' && result.current.state.error,
    ).toContain('lmstudio status failed');
  });

  it('surfaces malformed explicit input through the existing failure path', async () => {
    localStorage.setItem('lmstudio.baseUrl', 'http://persisted.example:1234');
    getFetchMock().mockImplementation(async (input) => {
      const href = typeof input === 'string' ? input : input.toString();
      if (href.includes('/lmstudio/status?baseUrl=notaurl')) {
        return mockJsonResponse(
          {
            status: 'error',
            baseUrl: 'notaurl',
            error: 'Invalid baseUrl',
          } satisfies LmStudioStatusResponse,
          { status: 400 },
        );
      }
      if (
        href.includes(
          '/lmstudio/status?baseUrl=http%3A%2F%2Fpersisted.example%3A1234',
        )
      ) {
        return mockJsonResponse({
          ...okMany,
          baseUrl: 'http://persisted.example:1234',
        });
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });

    const { result } = renderHook(() => useLmStudioStatus());

    await act(async () => {
      await result.current.refresh('notaurl');
    });

    expect(getFetchMock()).toHaveBeenCalledWith(
      expect.stringContaining('/lmstudio/status?baseUrl=notaurl'),
    );

    expect(result.current.state.status).toBe('error');
    expect(
      result.current.state.status === 'error' && result.current.state.error,
    ).toContain('lmstudio status failed');
    expect(result.current.committedBaseUrl).toBe(
      'http://persisted.example:1234',
    );
    expect(result.current.baseUrl).toBe('http://persisted.example:1234');
    expect(localStorage.getItem('lmstudio.baseUrl')).toBe(
      'http://persisted.example:1234',
    );

    await act(async () => {
      await result.current.refresh();
    });

    expect(getFetchMock()).toHaveBeenLastCalledWith(
      expect.stringContaining(
        '/lmstudio/status?baseUrl=http%3A%2F%2Fpersisted.example%3A1234',
      ),
    );
    expect(result.current.state.status).toBe('success');
    expect(
      result.current.state.status === 'success' &&
        result.current.state.data.baseUrl,
    ).toBe('http://persisted.example:1234');
  });

  it('ignores stale overlapping refresh results after a newer committed base URL wins', async () => {
    const older = deferredResponse();
    const newer = deferredResponse();
    getFetchMock()
      .mockImplementationOnce(async () => older.promise)
      .mockImplementationOnce(async () => newer.promise);

    const { result } = renderHook(() => useLmStudioStatus());

    let firstRefresh!: Promise<void>;
    let secondRefresh!: Promise<void>;
    await act(async () => {
      firstRefresh = result.current.refresh('http://older.example:1234');
      secondRefresh = result.current.refresh('http://newer.example:5678');
    });

    newer.resolve(
      mockJsonResponse({
        status: 'ok',
        baseUrl: 'http://newer.example:5678',
        models: [{ modelKey: 'new', displayName: 'New Model', type: 'gguf' }],
      } satisfies LmStudioStatusOk),
    );
    await act(async () => {
      await secondRefresh;
    });

    expect(result.current.committedBaseUrl).toBe('http://newer.example:5678');
    expect(result.current.state.status).toBe('success');
    expect(
      result.current.state.status === 'success' &&
        result.current.state.data.baseUrl,
    ).toBe('http://newer.example:5678');
    expect(
      result.current.state.status === 'success' &&
        result.current.state.data.models[0]?.displayName,
    ).toBe('New Model');

    older.resolve(
      mockJsonResponse({
        status: 'ok',
        baseUrl: 'http://older.example:1234',
        models: [{ modelKey: 'old', displayName: 'Old Model', type: 'gguf' }],
      } satisfies LmStudioStatusOk),
    );
    await act(async () => {
      await firstRefresh;
    });

    expect(result.current.committedBaseUrl).toBe('http://newer.example:5678');
    expect(result.current.state.status).toBe('success');
    expect(
      result.current.state.status === 'success' &&
        result.current.state.data.baseUrl,
    ).toBe('http://newer.example:5678');
    expect(
      result.current.state.status === 'success' &&
        result.current.state.data.models[0]?.displayName,
    ).toBe('New Model');
  });
});
