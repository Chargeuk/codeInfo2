import { INGEST_ROOTS_SCHEMA_VERSION } from '@codeinfo2/common';
import { act, renderHook, waitFor } from '@testing-library/react';
import useIngestRoots from '../hooks/useIngestRoots';
import {
  asFetchImplementation,
  getFetchMock,
  mockJsonResponse,
} from './support/fetchMock';

const mockFetch = getFetchMock();

function mockRootsResponse(payload: unknown) {
  mockFetch.mockResolvedValueOnce(mockJsonResponse(payload));
}

function createDeferredRootsRequest() {
  let resolveResponse: ((value: Response) => void) | undefined;
  let rejectResponse: ((reason?: unknown) => void) | undefined;
  let resolveAborted: (() => void) | undefined;
  const aborted = new Promise<void>((resolve) => {
    resolveAborted = resolve;
  });

  return {
    request: (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        resolveResponse = resolve;
        rejectResponse = reject;
        const signal = init?.signal;
        const rejectAbort = () => {
          resolveAborted?.();
          reject(
            Object.assign(new Error('Aborted'), {
              name: 'AbortError',
            }),
          );
        };

        if (signal?.aborted) {
          rejectAbort();
          return;
        }

        signal?.addEventListener('abort', rejectAbort, { once: true });
      }),
    resolveJson(payload: unknown) {
      resolveResponse?.(mockJsonResponse(payload));
    },
    reject(error: Error) {
      rejectResponse?.(error);
    },
    aborted,
  };
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

  it('maps the flat route-payload error field into NormalizedIngestError.code and keeps legacy lastError safe', async () => {
    mockRootsResponse({
      roots: [
        {
          runId: 'run-1',
          name: 'repo-a',
          path: '/repo-a',
          status: 'error',
          model: 'embed-a',
          error: {
            error: 'OPENAI_TIMEOUT',
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

  it('preserves requestId, null runId, and queuePosition from queued rows', async () => {
    mockRootsResponse({
      roots: [
        {
          requestId: 'queue-request-1',
          runId: null,
          queueState: 'waiting',
          queuePosition: 2,
          name: 'repo-queued',
          path: '/repo-queued',
          status: 'ingesting',
          phase: 'queued',
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.roots[0]).toMatchObject({
      requestId: 'queue-request-1',
      runId: null,
      queueState: 'waiting',
      queuePosition: 2,
      status: 'ingesting',
      phase: 'queued',
    });
  });

  it('prefers the restored route-level id while keeping fresh waiting metadata for reused queued rows', async () => {
    mockRootsResponse({
      roots: [
        {
          id: 'stable-repo-id',
          requestId: 'queue-request-2',
          runId: null,
          queueState: 'waiting',
          queuePosition: 1,
          name: 'repo-reused',
          path: '/repo-reused',
          status: 'ingesting',
          phase: 'queued',
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          model: 'text-embedding-3-small',
          modelId: 'text-embedding-3-small',
          lock: {
            embeddingProvider: 'lmstudio',
            embeddingModel: 'stale-lock-model',
            embeddingDimensions: 768,
            lockedModelId: 'stale-lock-model',
            modelId: 'stale-lock-model',
          },
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.roots[0]).toMatchObject({
      id: 'stable-repo-id',
      requestId: 'queue-request-2',
      queueState: 'waiting',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      model: 'text-embedding-3-small',
      modelId: 'text-embedding-3-small',
      lock: {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        lockedModelId: 'text-embedding-3-small',
        modelId: 'text-embedding-3-small',
      },
    });
  });

  it('keeps the canonical waiting overlay identity when a queued row still carries incompatible legacy model fields', async () => {
    mockRootsResponse({
      roots: [
        {
          id: 'stable-repo-id',
          requestId: 'queue-request-canonical-mixed',
          runId: null,
          queueState: 'waiting',
          queuePosition: 1,
          name: 'repo-canonical-mixed',
          path: '/repo-canonical-mixed',
          status: 'ingesting',
          phase: 'queued',
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          model: 'legacy-lmstudio-model',
          modelId: 'legacy-lmstudio-model',
          lock: {
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
            embeddingDimensions: 1536,
            lockedModelId: 'text-embedding-3-small',
            modelId: 'text-embedding-3-small',
          },
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.roots[0]).toMatchObject({
      id: 'stable-repo-id',
      queueState: 'waiting',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      model: 'text-embedding-3-small',
      modelId: 'text-embedding-3-small',
      lock: {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        lockedModelId: 'text-embedding-3-small',
        modelId: 'text-embedding-3-small',
      },
    });
    expect(result.current.roots[0]?.model).not.toBe('legacy-lmstudio-model');
  });

  it('clears stale persisted diagnostics from healthy waiting rows during normalization', async () => {
    mockRootsResponse({
      roots: [
        {
          id: 'stable-repo-id',
          requestId: 'queue-request-waiting-recovery',
          runId: null,
          queueState: 'waiting',
          queuePosition: 1,
          name: 'repo-waiting-recovery',
          path: '/repo-waiting-recovery',
          status: 'ingesting',
          phase: 'queued',
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          model: 'text-embedding-3-small',
          lastError: 'stale persisted failure',
          error: {
            error: 'OPENAI_TIMEOUT',
            message: 'stale persisted failure',
            retryable: true,
            provider: 'openai',
          },
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.roots[0]).toMatchObject({
      id: 'stable-repo-id',
      queueState: 'waiting',
      status: 'ingesting',
      phase: 'queued',
      lastError: null,
      error: null,
    });
  });

  it('treats the restored route-level id as canonical row identity even when runtime-only runId is present', async () => {
    mockRootsResponse({
      roots: [
        {
          id: 'canonical-row-id',
          runId: 'runtime-only-run',
          name: 'fallback-name',
          path: '/fallback-path',
          status: 'ingesting',
          phase: 'queued',
          queueState: 'waiting',
          queuePosition: 1,
          requestId: 'queue-request-3',
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.roots[0]).toMatchObject({
      id: 'canonical-row-id',
      runId: 'runtime-only-run',
      name: 'fallback-name',
      path: '/fallback-path',
    });
  });

  it('keeps canonical path fallback identity for legacy rows that still do not provide id', async () => {
    mockRootsResponse({
      roots: [
        {
          name: 'legacy-name',
          path: '/legacy-path',
          status: 'completed',
          model: 'legacy-model',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.roots[0]).toMatchObject({
      id: '/legacy-path',
      name: 'legacy-name',
      path: '/legacy-path',
    });
  });

  it('queued rows keep canonical path identity even before the repaired route-level id is restored on refetch', async () => {
    mockRootsResponse({
      roots: [
        {
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'ingesting',
          phase: 'queued',
          queueState: 'waiting',
          queuePosition: 1,
          requestId: 'queue-request-4',
          runId: null,
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.roots).toHaveLength(1);
    expect(result.current.roots[0]?.id).toBe('/stable-repo');

    mockRootsResponse({
      roots: [
        {
          id: 'stable-repo-id',
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'ingesting',
          phase: 'queued',
          queueState: 'waiting',
          queuePosition: 1,
          requestId: 'queue-request-4',
          runId: null,
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    await result.current.refetch();

    await waitFor(() =>
      expect(result.current.roots[0]?.id).toBe('stable-repo-id'),
    );
    expect(result.current.roots).toHaveLength(1);
    expect(result.current.roots[0]).toMatchObject({
      id: 'stable-repo-id',
      name: 'stable-repo',
      path: '/stable-repo',
    });
  });

  it('resumed rows keep canonical route-level identity instead of reusing runtime-only runId metadata', async () => {
    mockRootsResponse({
      roots: [
        {
          id: '/stable-repo',
          requestId: 'queue-request-5',
          runId: null,
          queueState: 'waiting',
          queuePosition: 1,
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'ingesting',
          phase: 'queued',
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.roots[0]?.id).toBe('/stable-repo');

    mockRootsResponse({
      roots: [
        {
          id: '/stable-repo',
          requestId: 'queue-request-5',
          runId: 'run-queued-5',
          queueState: 'running',
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'ingesting',
          phase: 'scanning',
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    await result.current.refetch();

    await waitFor(() =>
      expect(result.current.roots[0]).toMatchObject({
        id: '/stable-repo',
        runId: 'run-queued-5',
        queueState: 'running',
        phase: 'scanning',
      }),
    );
  });

  it('clears stale diagnostics and stale persisted model identity from healthy running queue overlay rows during normalization', async () => {
    mockRootsResponse({
      roots: [
        {
          id: '/stable-repo',
          requestId: 'queue-request-running-recovery',
          runId: 'run-queued-recovery',
          queueState: 'running',
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'ingesting',
          phase: 'scanning',
          model: 'fresh-running-model',
          modelId: 'stale-persisted-model-id',
          embeddingProvider: 'openai',
          embeddingModel: 'fresh-running-model',
          embeddingDimensions: 1536,
          lock: {
            embeddingProvider: 'lmstudio',
            embeddingModel: 'stale-persisted-model',
            embeddingDimensions: 768,
            lockedModelId: 'stale-persisted-model',
            modelId: 'stale-persisted-model',
          },
          lastError: 'stale persisted failure',
          error: {
            error: 'OPENAI_TIMEOUT',
            message: 'stale persisted failure',
            retryable: true,
            provider: 'openai',
          },
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.roots[0]).toMatchObject({
      id: '/stable-repo',
      runId: 'run-queued-recovery',
      queueState: 'running',
      status: 'ingesting',
      phase: 'scanning',
      lastError: null,
      error: null,
      model: 'fresh-running-model',
      modelId: 'fresh-running-model',
      embeddingProvider: 'openai',
      embeddingModel: 'fresh-running-model',
      embeddingDimensions: 1536,
      lock: {
        embeddingProvider: 'openai',
        embeddingModel: 'fresh-running-model',
        embeddingDimensions: 1536,
        lockedModelId: 'fresh-running-model',
        modelId: 'fresh-running-model',
      },
    });
  });

  it('keeps the fresh runtime error payload and matching lastError when a running queue overlay beats stale persisted diagnostics', async () => {
    mockRootsResponse({
      roots: [
        {
          id: '/runtime-error-repo',
          requestId: 'queue-request-running-error',
          runId: 'run-runtime-error',
          queueState: 'running',
          name: 'runtime-error-repo',
          path: '/runtime-error-repo',
          status: 'error',
          model: 'embed-model',
          lastError: 'fresh runtime failure',
          error: {
            error: 'OPENAI_TIMEOUT',
            message: 'fresh runtime failure',
            retryable: true,
            provider: 'openai',
          },
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.roots[0]).toMatchObject({
      id: '/runtime-error-repo',
      runId: 'run-runtime-error',
      queueState: 'running',
      status: 'error',
      lastError: 'fresh runtime failure',
      error: {
        code: 'OPENAI_TIMEOUT',
        message: 'fresh runtime failure',
        retryable: true,
        provider: 'openai',
      },
    });
  });

  it('retried rows keep canonical route-level identity instead of reviving stale display-derived fallback data', async () => {
    mockRootsResponse({
      roots: [
        {
          id: '/stable-repo',
          requestId: 'queue-request-6',
          runId: null,
          queueState: 'waiting',
          queuePosition: 1,
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'ingesting',
          phase: 'queued',
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockRootsResponse({
      roots: [
        {
          id: '/stable-repo',
          requestId: 'queue-request-7',
          runId: null,
          queueState: 'waiting',
          queuePosition: 1,
          name: 'stale-display-name',
          path: '/stable-repo',
          status: 'ingesting',
          phase: 'queued',
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    await result.current.refetch();

    await waitFor(() =>
      expect(result.current.roots[0]).toMatchObject({
        id: '/stable-repo',
        requestId: 'queue-request-7',
        name: 'stale-display-name',
        path: '/stable-repo',
      }),
    );
  });

  it('queued-to-running refetches exclude stale display-derived identity from client row tracking', async () => {
    mockRootsResponse({
      roots: [
        {
          id: 'display-derived-stale-id',
          requestId: 'queue-request-8',
          runId: null,
          queueState: 'waiting',
          queuePosition: 1,
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'ingesting',
          phase: 'queued',
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.roots[0]?.id).toBe('display-derived-stale-id');

    mockRootsResponse({
      roots: [
        {
          id: '/stable-repo',
          requestId: 'queue-request-8',
          runId: 'run-queued-8',
          queueState: 'running',
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'ingesting',
          phase: 'scanning',
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    await result.current.refetch();

    await waitFor(() =>
      expect(result.current.roots).toMatchObject([
        {
          id: '/stable-repo',
          runId: 'run-queued-8',
          path: '/stable-repo',
        },
      ]),
    );
    expect(result.current.roots).toHaveLength(1);
  });

  it('queued-to-retried refetches exclude stale display-derived identity while tracking the retried row by canonical identity', async () => {
    mockRootsResponse({
      roots: [
        {
          id: 'display-derived-retry-id',
          requestId: 'queue-request-9',
          runId: null,
          queueState: 'waiting',
          queuePosition: 1,
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'ingesting',
          phase: 'queued',
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockRootsResponse({
      roots: [
        {
          id: '/stable-repo',
          requestId: 'queue-request-10',
          runId: null,
          queueState: 'waiting',
          queuePosition: 1,
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'ingesting',
          phase: 'queued',
          model: 'embed-model',
          lastError: null,
        },
      ],
    });

    await result.current.refetch();

    await waitFor(() =>
      expect(result.current.roots).toMatchObject([
        {
          id: '/stable-repo',
          requestId: 'queue-request-10',
          path: '/stable-repo',
        },
      ]),
    );
    expect(result.current.roots).toHaveLength(1);
  });

  it('keeps loading owned by the newest overlapping ingest-roots refetch until that request settles', async () => {
    mockRootsResponse({
      roots: [
        {
          id: '/stable-repo',
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'completed',
          model: 'embed-model-a',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const olderRefresh = createDeferredRootsRequest();
    const newerRefresh = createDeferredRootsRequest();
    mockFetch.mockImplementationOnce(
      asFetchImplementation(olderRefresh.request),
    );
    mockFetch.mockImplementationOnce(
      asFetchImplementation(newerRefresh.request),
    );

    await act(async () => {
      void result.current.refetch();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    await act(async () => {
      void result.current.refetch();
    });

    await olderRefresh.aborted;
    expect(result.current.isLoading).toBe(true);
    expect(result.current.roots).toMatchObject([
      {
        id: '/stable-repo',
        model: 'embed-model-a',
      },
    ]);

    newerRefresh.resolveJson({
      roots: [
        {
          id: '/fresh-repo',
          name: 'fresh-repo',
          path: '/fresh-repo',
          status: 'completed',
          model: 'embed-model-b',
          lastError: null,
        },
      ],
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.roots).toMatchObject([
      {
        id: '/fresh-repo',
        model: 'embed-model-b',
      },
    ]);
  });

  it('keeps the previously settled repo list locally visible until the newest successful refetch replaces it', async () => {
    mockRootsResponse({
      roots: [
        {
          id: '/stable-repo',
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'completed',
          model: 'embed-model-a',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const refresh = createDeferredRootsRequest();
    mockFetch.mockImplementationOnce(asFetchImplementation(refresh.request));

    await act(async () => {
      void result.current.refetch();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.roots).toMatchObject([
      {
        id: '/stable-repo',
        model: 'embed-model-a',
      },
    ]);

    refresh.resolveJson({
      roots: [
        {
          id: '/replacement-repo',
          name: 'replacement-repo',
          path: '/replacement-repo',
          status: 'completed',
          model: 'embed-model-b',
          lastError: null,
        },
      ],
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.roots).toMatchObject([
      {
        id: '/replacement-repo',
        model: 'embed-model-b',
      },
    ]);
  });

  it('keeps the previously settled repo list locally visible while the newest refetch fails', async () => {
    mockRootsResponse({
      roots: [
        {
          id: '/stable-repo',
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'completed',
          model: 'embed-model-a',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const refresh = createDeferredRootsRequest();
    mockFetch.mockImplementationOnce(asFetchImplementation(refresh.request));

    await act(async () => {
      void result.current.refetch();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.roots).toMatchObject([
      {
        id: '/stable-repo',
        model: 'embed-model-a',
      },
    ]);

    refresh.reject(new Error('Failed to load ingest roots (500)'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe('Failed to load ingest roots (500)');
    expect(result.current.roots).toMatchObject([
      {
        id: '/stable-repo',
        model: 'embed-model-a',
      },
    ]);
  });

  it('excludes stale aborted ingest-roots refetch completions from the visible retained repo list', async () => {
    mockRootsResponse({
      roots: [
        {
          id: '/stable-repo',
          name: 'stable-repo',
          path: '/stable-repo',
          status: 'completed',
          model: 'embed-model-a',
          lastError: null,
        },
      ],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const olderRefresh = createDeferredRootsRequest();
    const newerRefresh = createDeferredRootsRequest();
    mockFetch.mockImplementationOnce(
      asFetchImplementation(olderRefresh.request),
    );
    mockFetch.mockImplementationOnce(
      asFetchImplementation(newerRefresh.request),
    );

    await act(async () => {
      void result.current.refetch();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    await act(async () => {
      void result.current.refetch();
    });

    await olderRefresh.aborted;
    expect(result.current.roots).toMatchObject([
      {
        id: '/stable-repo',
        model: 'embed-model-a',
      },
    ]);

    newerRefresh.resolveJson({
      roots: [
        {
          id: '/replacement-repo',
          name: 'replacement-repo',
          path: '/replacement-repo',
          status: 'completed',
          model: 'embed-model-b',
          lastError: null,
        },
      ],
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.roots).toMatchObject([
      {
        id: '/replacement-repo',
        model: 'embed-model-b',
      },
    ]);
  });

  it('accepts and exposes the shared ingest roots schemaVersion constant', async () => {
    mockRootsResponse({
      schemaVersion: INGEST_ROOTS_SCHEMA_VERSION,
      roots: [],
    });

    const { result } = renderHook(() => useIngestRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.schemaVersion).toBe(INGEST_ROOTS_SCHEMA_VERSION);
  });
});
