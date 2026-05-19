import {
  LmStudioStatusOk,
  type LmStudioStatusResponse,
} from '@codeinfo2/common';
import { renderHook, act } from '@testing-library/react';
import { useLmStudioStatus } from '../hooks/useLmStudioStatus';
import { getLmStudioBaseUrl } from '../config/runtimeConfig';
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
  });
});
