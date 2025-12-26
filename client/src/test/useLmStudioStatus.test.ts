import {
  LmStudioStatusOk,
  type LmStudioStatusResponse,
} from '@codeinfo2/common';
import { jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useLmStudioStatus } from '../hooks/useLmStudioStatus';

const okMany: LmStudioStatusOk = {
  status: 'ok',
  baseUrl: 'http://host.docker.internal:1234',
  models: [{ modelKey: 'm1', displayName: 'Model One', type: 'gguf' }],
};

const okEmpty: LmStudioStatusOk = { ...okMany, models: [] };

function mockFetch(
  response: Partial<Response> & { json: () => Promise<unknown> },
) {
  (global.fetch as jest.Mock).mockResolvedValue(response);
}

describe('useLmStudioStatus', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn();
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches models and sets success state', async () => {
    mockFetch({ ok: true, status: 200, json: async () => okMany } as Response);
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
    mockFetch({ ok: true, status: 200, json: async () => okEmpty } as Response);
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
    mockFetch({
      ok: false,
      status: 502,
      json: async () => errBody,
    } as Response);
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
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
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
    mockFetch({ ok: true, status: 200, json: async () => okMany } as Response);
    const { result } = renderHook(() => useLmStudioStatus());
    await act(async () => {
      await result.current.refresh('http://override:1234');
    });
    expect(localStorage.getItem('lmstudio.baseUrl')).toBe(
      'http://override:1234',
    );
    expect(result.current.baseUrl).toBe('http://override:1234');
  });
});
