import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';
import { createLogger } from '../logging/logger';
import {
  useChatWs,
  type ChatWsConnectionState,
  type ChatWsIngestStatus,
} from './useChatWs';

const serverBase = getApiBaseUrl();

type Status = {
  status: ChatWsIngestStatus | null;
  connectionState: ChatWsConnectionState;
  isLoading: boolean;
  error?: string;
  isCancelling: boolean;
  cancel: () => Promise<void>;
};
export function useIngestStatus(): Status {
  const log = useMemo(() => createLogger('client'), []);
  const [status, setStatus] = useState<ChatWsIngestStatus | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isCancelling, setIsCancelling] = useState(false);

  const { connectionState, subscribeIngest, unsubscribeIngest } = useChatWs({
    onEvent: (event) => {
      if (event.type === 'ingest_snapshot') {
        setStatus(event.status);
        log(
          'info',
          '0000022 ingest status snapshot received',
          event.status
            ? { runId: event.status.runId, state: event.status.state }
            : null,
        );
      }
      if (event.type === 'ingest_update') {
        setStatus(event.status);
        log('info', '0000022 ingest status update received', {
          runId: event.status.runId,
          state: event.status.state,
        });
      }
    },
  });

  useEffect(() => {
    subscribeIngest();
    return () => unsubscribeIngest();
  }, [subscribeIngest, unsubscribeIngest]);

  const cancel = useCallback(async () => {
    if (!status?.runId) return;
    setIsCancelling(true);
    try {
      const res = await fetch(
        new URL(
          `/ingest/cancel/${encodeURIComponent(status.runId)}`,
          serverBase,
        ).toString(),
        { method: 'POST', headers: { 'content-type': 'application/json' } },
      );
      if (!res.ok) {
        throw new Error(`Cancel failed (${res.status})`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCancelling(false);
    }
  }, [status?.runId]);

  const isLoading = connectionState === 'connecting';

  return useMemo(
    () => ({
      status,
      connectionState,
      isLoading,
      error,
      isCancelling,
      cancel,
    }),
    [status, connectionState, isLoading, error, isCancelling, cancel],
  );
}

export default useIngestStatus;
