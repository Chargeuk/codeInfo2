import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

type State = {
  mongoConnected: boolean | null;
  isLoading: boolean;
  error?: string;
  refresh: () => Promise<void>;
};

export function usePersistenceStatus(): State {
  const [mongoConnected, setMongoConnected] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoading(true);
    try {
      const res = await fetch(new URL('/health', serverBase).toString(), {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Health check failed (${res.status})`);
      }
      const data = (await res.json()) as { mongoConnected?: boolean };
      const connected =
        typeof data.mongoConnected === 'boolean' ? data.mongoConnected : true;
      setMongoConnected(connected);
      setError(undefined);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
      // Default to true so banner only shows when explicitly reported as false.
      setMongoConnected(true);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => controllerRef.current?.abort();
  }, [refresh]);

  return useMemo(
    () => ({ mongoConnected, isLoading, error, refresh }),
    [mongoConnected, isLoading, error, refresh],
  );
}

export default usePersistenceStatus;
