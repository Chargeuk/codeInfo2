import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

type IngestState =
  | 'queued'
  | 'scanning'
  | 'embedding'
  | 'completed'
  | 'cancelled'
  | 'error';

type IngestProgress = {
  currentFile?: string | null;
  fileIndex?: number;
  fileTotal?: number;
  percent?: number;
  etaMs?: number;
};

type IngestCounts = {
  files?: number;
  chunks?: number;
  embedded?: number;
  skipped?: number;
};

type StatusResponse = {
  runId: string;
  state: IngestState;
  counts?: IngestCounts;
  lastError?: string | null;
  message?: string | null;
  currentFile?: string | null;
  fileIndex?: number;
  fileTotal?: number;
  percent?: number;
  etaMs?: number;
};

type Status = {
  status?: IngestState;
  counts?: IngestCounts;
  lastError?: string | null;
  message?: string | null;
  currentFile?: string | null;
  fileIndex?: number;
  fileTotal?: number;
  percent?: number;
  etaMs?: number;
  isLoading: boolean;
  isError: boolean;
  error?: string;
  isCancelling: boolean;
  cancel: () => Promise<void>;
};

const terminalStates: IngestState[] = ['completed', 'cancelled', 'error'];

export function useIngestStatus(runId?: string): Status {
  const [status, setStatus] = useState<IngestState | undefined>();
  const [counts, setCounts] = useState<IngestCounts | undefined>();
  const [lastError, setLastError] = useState<string | null | undefined>();
  const [message, setMessage] = useState<string | null | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isCancelling, setIsCancelling] = useState(false);
  const [progress, setProgress] = useState<IngestProgress | undefined>();

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const activeController = useRef<AbortController | null>(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  };

  const fetchStatus = useCallback(async () => {
    if (!runId) return;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setIsLoading(true);
    try {
      const res = await fetch(
        new URL(
          `/ingest/status/${encodeURIComponent(runId)}`,
          serverBase,
        ).toString(),
        { signal: controller.signal },
      );
      if (!res.ok) {
        throw new Error(`Status fetch failed (${res.status})`);
      }
      const data = (await res.json()) as StatusResponse;
      setStatus(data.state);
      setCounts(data.counts);
      setLastError(data.lastError);
      setMessage(data.message);
      setProgress({
        currentFile: data.currentFile,
        fileIndex: data.fileIndex,
        fileTotal: data.fileTotal,
        percent: data.percent,
        etaMs: data.etaMs,
      });
      setIsError(false);
      setError(undefined);
      const isTerminal = terminalStates.includes(data.state);
      if (!isTerminal) {
        pollRef.current = setTimeout(fetchStatus, 2000);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setIsError(true);
      setError((err as Error).message);
      pollRef.current = setTimeout(fetchStatus, 4000);
    } finally {
      if (activeController.current === controller) {
        activeController.current = null;
      }
      setIsLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    clearPoll();
    setStatus(undefined);
    setCounts(undefined);
    setLastError(undefined);
    setMessage(undefined);
    setProgress(undefined);
    setIsError(false);
    setError(undefined);
    if (runId) {
      void fetchStatus();
    }
    return () => {
      clearPoll();
      activeController.current?.abort();
    };
  }, [runId, fetchStatus]);

  const cancel = useCallback(async () => {
    if (!runId) return;
    setIsCancelling(true);
    try {
      const res = await fetch(
        new URL(
          `/ingest/cancel/${encodeURIComponent(runId)}`,
          serverBase,
        ).toString(),
        { method: 'POST', headers: { 'content-type': 'application/json' } },
      );
      if (!res.ok) {
        throw new Error(`Cancel failed (${res.status})`);
      }
      setStatus('cancelled');
      clearPoll();
    } catch (err) {
      setIsError(true);
      setError((err as Error).message);
    } finally {
      setIsCancelling(false);
    }
  }, [runId]);

  const flags = useMemo(
    () => ({ isLoading, isError, error, isCancelling }),
    [isLoading, isError, error, isCancelling],
  );

  return {
    status,
    counts,
    lastError,
    message,
    ...flags,
    cancel,
    ...progress,
  };
}

export default useIngestStatus;
