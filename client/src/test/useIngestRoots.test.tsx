import { INGEST_ROOTS_SCHEMA_VERSION } from '@codeinfo2/common';
import { renderHook, waitFor } from '@testing-library/react';
import useIngestRoots from '../hooks/useIngestRoots';
import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const mockFetch = getFetchMock();

function mockRootsResponse(payload: unknown) {
  mockFetch.mockResolvedValueOnce(mockJsonResponse(payload));
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

  it('preserves ingesting phase values from external listing contract', async () => {
    mockRootsResponse({
      roots: [
        {
          runId: 'run-phase',
          name: 'repo-phase',
          path: '/repo-phase',
          status: 'ingesting',
          phase: 'embedding',
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.roots[0]).toMatchObject({
      status: 'ingesting',
      phase: 'embedding',
    });
  });

  it('omits phase for terminal statuses', async () => {
    mockRootsResponse({
      roots: [
        {
          runId: 'run-completed',
          name: 'repo-completed',
          path: '/repo-completed',
          status: 'completed',
          phase: 'embedding',
          model: 'embed-model',
          lastError: null,
        },
        {
          runId: 'run-cancelled',
          name: 'repo-cancelled',
          path: '/repo-cancelled',
          status: 'cancelled',
          phase: 'queued',
          model: 'embed-model',
          lastError: null,
        },
        {
          runId: 'run-error',
          name: 'repo-error',
          path: '/repo-error',
          status: 'error',
          phase: 'scanning',
          model: 'embed-model',
          lastError: 'boom',
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.roots[0]?.phase).toBeUndefined();
    expect(result.current.roots[1]?.phase).toBeUndefined();
    expect(result.current.roots[2]?.phase).toBeUndefined();
  });

  it('accepts and exposes schemaVersion 0000038-status-phase-v1', async () => {
    mockRootsResponse({
      schemaVersion: '0000038-status-phase-v1',
      roots: [],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.schemaVersion).toBe(INGEST_ROOTS_SCHEMA_VERSION);
  });
});
