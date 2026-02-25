import { jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';
import useIngestRoots from '../hooks/useIngestRoots';

const mockFetch = global.fetch as jest.Mock;

function mockRootsResponse(payload: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response);
}

describe('useIngestRoots', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('prefers canonical lock/root fields and falls back to aliases', async () => {
    mockRootsResponse({
      lockedModelId: 'legacy-lock',
      lock: {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 1536,
        lockedModelId: 'legacy-lock',
      },
      roots: [
        {
          runId: 'run-1',
          name: 'repo',
          path: '/repo',
          status: 'completed',
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          embeddingDimensions: 1536,
          model: 'legacy-model-alias',
          modelId: 'legacy-model-alias',
          lastError: null,
        },
      ],
    });

    const first = renderHook(() => useIngestRoots());
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));

    expect(first.result.current.lockedModelId).toBe('text-embedding-3-small');
    expect(first.result.current.roots[0]?.embeddingProvider).toBe('openai');
    expect(first.result.current.roots[0]?.embeddingModel).toBe(
      'text-embedding-3-small',
    );

    first.unmount();

    mockRootsResponse({
      lockedModelId: 'legacy-lmstudio-model',
      roots: [
        {
          runId: 'run-2',
          name: 'legacy repo',
          path: '/legacy',
          status: 'completed',
          model: 'legacy-lmstudio-model',
          lastError: null,
        },
      ],
    });

    const second = renderHook(() => useIngestRoots());
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));

    expect(second.result.current.lockedModelId).toBe('legacy-lmstudio-model');
    expect(second.result.current.roots[0]?.embeddingProvider).toBe('lmstudio');
    expect(second.result.current.roots[0]?.embeddingModel).toBe(
      'legacy-lmstudio-model',
    );
  });

  it('parses normalized error object and legacy string lastError safely', async () => {
    mockRootsResponse({
      roots: [
        {
          runId: 'run-1',
          name: 'repo-a',
          path: '/repo-a',
          status: 'error',
          model: 'embed-a',
          error: {
            code: 'OPENAI_TIMEOUT',
            provider: 'openai',
            message: 'Timed out',
            retryable: true,
          },
          lastError: null,
        },
        {
          runId: 'run-2',
          name: 'repo-b',
          path: '/repo-b',
          status: 'error',
          model: 'embed-b',
          lastError: 'Legacy error message',
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isError).toBe(false);
    expect(result.current.roots[0]?.error?.code).toBe('OPENAI_TIMEOUT');
    expect(result.current.roots[0]?.lastError).toBe('Timed out');
    expect(result.current.roots[1]?.lastError).toBe('Legacy error message');
  });
});
