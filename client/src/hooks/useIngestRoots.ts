import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';
import { createLogger } from '../logging';

const serverBase = getApiBaseUrl();

type IngestProviderId = 'lmstudio' | 'openai';

export type NormalizedIngestError = {
  code?: string;
  provider?: string;
  message?: string;
  retryable?: boolean;
  details?: string;
  status?: number;
};

export type IngestRoot = {
  runId: string;
  name: string;
  description?: string | null;
  path: string;
  model: string;
  modelId?: string;
  embeddingProvider?: IngestProviderId;
  embeddingModel?: string;
  embeddingDimensions?: number;
  lock?: {
    embeddingProvider?: IngestProviderId;
    embeddingModel?: string;
    embeddingDimensions?: number;
    lockedModelId?: string;
    modelId?: string;
  };
  status: string;
  lastIngestAt?: string | null;
  counts?: {
    files?: number;
    chunks?: number;
    embedded?: number;
  };
  ast?: {
    supportedFileCount?: number;
    skippedFileCount?: number;
    failedFileCount?: number;
    lastIndexedAt?: string | null;
  };
  lastError?: string | null;
  error?: NormalizedIngestError | null;
};

type RootsResponse = {
  roots?: Array<Record<string, unknown>>;
  lockedModelId?: string;
  lock?: {
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    lockedModelId?: string;
    modelId?: string;
  };
};

type State = {
  roots: IngestRoot[];
  lockedModelId?: string;
  isLoading: boolean;
  isError: boolean;
  error?: string;
  refetch: () => Promise<void>;
};

function normalizeProvider(value: unknown): IngestProviderId | undefined {
  return value === 'lmstudio' || value === 'openai' ? value : undefined;
}

function normalizeError(value: unknown): NormalizedIngestError | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  return {
    code: typeof source.code === 'string' ? source.code : undefined,
    provider: typeof source.provider === 'string' ? source.provider : undefined,
    message: typeof source.message === 'string' ? source.message : undefined,
    retryable:
      typeof source.retryable === 'boolean' ? source.retryable : undefined,
    details: typeof source.details === 'string' ? source.details : undefined,
    status: typeof source.status === 'number' ? source.status : undefined,
  };
}

function normalizeLastError(
  lastError: unknown,
  error: NormalizedIngestError | null,
): string | null {
  if (typeof lastError === 'string') return lastError;
  if (lastError && typeof lastError === 'object') {
    const objectMessage = (lastError as { message?: unknown }).message;
    if (typeof objectMessage === 'string' && objectMessage.length > 0) {
      return objectMessage;
    }
  }
  if (typeof error?.message === 'string' && error.message.length > 0) {
    return error.message;
  }
  if (lastError === null) return null;
  return null;
}

function normalizeRoot(entry: Record<string, unknown>): IngestRoot {
  const error = normalizeError(entry.error);
  const embeddingModel =
    typeof entry.embeddingModel === 'string'
      ? entry.embeddingModel
      : typeof entry.model === 'string'
        ? entry.model
        : '';
  const lockObj =
    entry.lock && typeof entry.lock === 'object'
      ? (entry.lock as Record<string, unknown>)
      : undefined;
  const lockModel =
    typeof lockObj?.embeddingModel === 'string'
      ? lockObj.embeddingModel
      : typeof lockObj?.lockedModelId === 'string'
        ? lockObj.lockedModelId
        : typeof lockObj?.modelId === 'string'
          ? lockObj.modelId
          : embeddingModel || undefined;
  const lockProvider =
    normalizeProvider(lockObj?.embeddingProvider) ??
    normalizeProvider(entry.embeddingProvider) ??
    (lockModel ? 'lmstudio' : undefined);
  const lockDimensions =
    typeof lockObj?.embeddingDimensions === 'number'
      ? lockObj.embeddingDimensions
      : typeof entry.embeddingDimensions === 'number'
        ? entry.embeddingDimensions
        : undefined;

  return {
    runId: typeof entry.runId === 'string' ? entry.runId : '',
    name: typeof entry.name === 'string' ? entry.name : '',
    description:
      typeof entry.description === 'string' ? entry.description : null,
    path: typeof entry.path === 'string' ? entry.path : '',
    model: embeddingModel,
    modelId: typeof entry.modelId === 'string' ? entry.modelId : embeddingModel,
    embeddingProvider:
      normalizeProvider(entry.embeddingProvider) ?? lockProvider ?? 'lmstudio',
    embeddingModel,
    embeddingDimensions:
      typeof entry.embeddingDimensions === 'number'
        ? entry.embeddingDimensions
        : lockDimensions,
    lock: lockModel
      ? {
          embeddingProvider: lockProvider ?? 'lmstudio',
          embeddingModel: lockModel,
          embeddingDimensions: lockDimensions,
          lockedModelId:
            typeof lockObj?.lockedModelId === 'string'
              ? lockObj.lockedModelId
              : lockModel,
          modelId:
            typeof lockObj?.modelId === 'string' ? lockObj.modelId : lockModel,
        }
      : undefined,
    status: typeof entry.status === 'string' ? entry.status : 'unknown',
    lastIngestAt:
      typeof entry.lastIngestAt === 'string' ? entry.lastIngestAt : null,
    counts:
      entry.counts && typeof entry.counts === 'object'
        ? {
            files:
              typeof (entry.counts as { files?: unknown }).files === 'number'
                ? (entry.counts as { files: number }).files
                : undefined,
            chunks:
              typeof (entry.counts as { chunks?: unknown }).chunks === 'number'
                ? (entry.counts as { chunks: number }).chunks
                : undefined,
            embedded:
              typeof (entry.counts as { embedded?: unknown }).embedded ===
              'number'
                ? (entry.counts as { embedded: number }).embedded
                : undefined,
          }
        : undefined,
    ast:
      entry.ast && typeof entry.ast === 'object'
        ? {
            supportedFileCount:
              typeof (entry.ast as { supportedFileCount?: unknown })
                .supportedFileCount === 'number'
                ? (entry.ast as { supportedFileCount: number })
                    .supportedFileCount
                : undefined,
            skippedFileCount:
              typeof (entry.ast as { skippedFileCount?: unknown })
                .skippedFileCount === 'number'
                ? (entry.ast as { skippedFileCount: number }).skippedFileCount
                : undefined,
            failedFileCount:
              typeof (entry.ast as { failedFileCount?: unknown })
                .failedFileCount === 'number'
                ? (entry.ast as { failedFileCount: number }).failedFileCount
                : undefined,
            lastIndexedAt:
              typeof (entry.ast as { lastIndexedAt?: unknown })
                .lastIndexedAt === 'string'
                ? (entry.ast as { lastIndexedAt: string }).lastIndexedAt
                : null,
          }
        : undefined,
    error,
    lastError: normalizeLastError(entry.lastError, error),
  };
}

export function useIngestRoots(): State {
  const log = useMemo(() => createLogger('client'), []);
  const [roots, setRoots] = useState<IngestRoot[]>([]);
  const [lockedModelId, setLockedModelId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const controllerRef = useRef<AbortController | null>(null);

  const fetchRoots = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoading(true);
    try {
      const res = await fetch(new URL('/ingest/roots', serverBase).toString(), {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Failed to load ingest roots (${res.status})`);
      }
      const data = (await res.json()) as RootsResponse;
      const normalizedRoots = Array.isArray(data.roots)
        ? data.roots
            .filter(
              (entry): entry is Record<string, unknown> =>
                Boolean(entry) && typeof entry === 'object',
            )
            .map((entry) => normalizeRoot(entry))
        : [];
      const lockModelAlias =
        typeof data.lockedModelId === 'string'
          ? data.lockedModelId
          : typeof data.lock?.lockedModelId === 'string'
            ? data.lock.lockedModelId
            : typeof data.lock?.modelId === 'string'
              ? data.lock.modelId
              : undefined;
      const lockModelCanonical =
        typeof data.lock?.embeddingModel === 'string'
          ? data.lock.embeddingModel
          : undefined;
      const resolvedLockModel = lockModelCanonical ?? lockModelAlias;
      const lockProvider =
        normalizeProvider(data.lock?.embeddingProvider) ??
        (resolvedLockModel ? 'lmstudio' : undefined);
      const hasNormalizedErrorObject = normalizedRoots.some(
        (root) => root.error && Object.keys(root.error).length > 0,
      );
      const aliasFallbackUsed = !lockModelCanonical && Boolean(lockModelAlias);

      setRoots(normalizedRoots);
      setLockedModelId(resolvedLockModel);
      log('info', 'DEV-0000036:T12:useIngestRoots_normalized', {
        rootCount: normalizedRoots.length,
        canonicalLockProvider: lockProvider ?? null,
        canonicalLockModel: resolvedLockModel ?? null,
        aliasFallbackUsed,
        normalizedErrorShapeDetected: hasNormalizedErrorObject,
      });
      setIsError(false);
      setError(undefined);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setIsError(true);
      setError((err as Error).message);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      setIsLoading(false);
    }
  }, [log]);

  useEffect(() => {
    void fetchRoots();
    return () => {
      controllerRef.current?.abort();
    };
  }, [fetchRoots]);

  const refetch = useCallback(async () => {
    await fetchRoots();
  }, [fetchRoots]);

  return useMemo(
    () => ({ roots, lockedModelId, isLoading, isError, error, refetch }),
    [roots, lockedModelId, isLoading, isError, error, refetch],
  );
}

export default useIngestRoots;
