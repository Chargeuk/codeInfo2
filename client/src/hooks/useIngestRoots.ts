import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';

const serverBase = getApiBaseUrl();

export type IngestRoot = {
  runId: string;
  name: string;
  description?: string | null;
  path: string;
  model: string;
  status: string;
  lastIngestAt?: string | null;
  counts?: {
    files?: number;
    chunks?: number;
    embedded?: number;
  };
  lastError?: string | null;
};

type RootsResponse = {
  roots: IngestRoot[];
  lockedModelId?: string;
};

type State = {
  roots: IngestRoot[];
  lockedModelId?: string;
  isLoading: boolean;
  isError: boolean;
  error?: string;
  refetch: () => Promise<void>;
};

export function useIngestRoots(): State {
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
      setRoots(Array.isArray(data.roots) ? data.roots : []);
      setLockedModelId(data.lockedModelId ?? undefined);
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
  }, []);

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
