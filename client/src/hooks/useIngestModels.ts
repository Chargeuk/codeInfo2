import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';
import type { IngestModel } from '../components/ingest/IngestForm';

type Status = 'idle' | 'loading' | 'success' | 'error';

export type OpenAiStatus = {
  enabled?: boolean;
  status?: string;
  statusCode?: string;
  message?: string;
  warning?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    retryAfterMs?: number;
  };
};

export type ModelLockState = {
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
};

const serverBase = getApiBaseUrl();

type ModelsResponse = {
  models: IngestModel[];
  lockedModelId?: string;
  lock?: {
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
  };
  openai?: {
    enabled?: boolean;
    status?: string;
    statusCode?: string;
    message?: string;
    warning?: {
      code?: string;
      message?: string;
      retryable?: boolean;
      retryAfterMs?: number;
    };
  };
};

export function useIngestModels() {
  const controllerRef = useRef<AbortController | null>(null);
  const [models, setModels] = useState<IngestModel[]>([]);
  const [lockedModelId, setLockedModelId] = useState<string | undefined>();
  const [lockedModel, setLockedModel] = useState<ModelLockState>({});
  const [openai, setOpenai] = useState<OpenAiStatus | undefined>();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus('loading');
    setError(undefined);
    try {
      const res = await fetch(
        new URL('/ingest/models', serverBase).toString(),
        {
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch ingest models (${res.status})`);
      }
      const data = (await res.json()) as ModelsResponse;
      setModels(data.models ?? []);
      setLockedModelId(data.lockedModelId ?? undefined);
      setLockedModel({
        embeddingProvider: data.lock?.embeddingProvider,
        embeddingModel: data.lock?.embeddingModel,
        embeddingDimensions: data.lock?.embeddingDimensions,
      });
      setOpenai(data.openai);
      setStatus('success');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setStatus('error');
      setError((err as Error).message);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => controllerRef.current?.abort();
  }, [refresh]);

  const defaultModelId = useMemo(() => {
    if (lockedModelId) return lockedModelId;
    return models[0]?.id;
  }, [models, lockedModelId]);

  return {
    models,
    lockedModelId,
    lockedModel,
    openai,
    defaultModelId,
    isLoading: status === 'loading',
    isError: status === 'error',
    error,
    refresh,
  };
}

export default useIngestModels;
