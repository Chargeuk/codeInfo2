import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';
import { createLogger } from '../logging';
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

export type IngestProviderId = 'lmstudio' | 'openai';

type OpenAiWarning = {
  code?: string;
  message?: string;
  retryable?: boolean;
  retryAfterMs?: number;
};

type ProviderEnvelope = {
  enabled?: boolean;
  status?: string;
  statusCode?: string;
  message?: string;
  warning?: OpenAiWarning;
};

type ModelsResponseModel = {
  id?: string;
  displayName?: string;
  provider?: IngestProviderId;
  contextLength?: number;
};

type ModelsResponse = {
  models?: ModelsResponseModel[];
  lockedModelId?: string;
  lock?: {
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    lockedModelId?: string;
    modelId?: string;
  };
  openai?: ProviderEnvelope;
  lmstudio?: ProviderEnvelope;
};

function normalizeProvider(
  value: unknown,
  fallback: IngestProviderId = 'lmstudio',
): IngestProviderId {
  return value === 'openai' || value === 'lmstudio' ? value : fallback;
}

function normalizeModelEntry(entry: ModelsResponseModel): IngestModel | null {
  const id = typeof entry.id === 'string' ? entry.id : '';
  if (!id) return null;
  return {
    id,
    displayName:
      typeof entry.displayName === 'string' && entry.displayName.length > 0
        ? entry.displayName
        : id,
    provider: normalizeProvider(entry.provider),
    contextLength:
      typeof entry.contextLength === 'number' ? entry.contextLength : undefined,
  };
}

function normalizeOpenAiStatus(
  value: ProviderEnvelope | undefined,
): OpenAiStatus {
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : undefined,
    status: typeof value?.status === 'string' ? value.status : undefined,
    statusCode:
      typeof value?.statusCode === 'string' ? value.statusCode : undefined,
    message: typeof value?.message === 'string' ? value.message : undefined,
    warning: value?.warning
      ? {
          code:
            typeof value.warning.code === 'string'
              ? value.warning.code
              : undefined,
          message:
            typeof value.warning.message === 'string'
              ? value.warning.message
              : undefined,
          retryable:
            typeof value.warning.retryable === 'boolean'
              ? value.warning.retryable
              : undefined,
          retryAfterMs:
            typeof value.warning.retryAfterMs === 'number'
              ? value.warning.retryAfterMs
              : undefined,
        }
      : undefined,
  };
}

function normalizeLockedModel(data: ModelsResponse): {
  lockedModelId?: string;
  lock: ModelLockState;
  aliasFallbackUsed: boolean;
} {
  const canonicalModel =
    typeof data.lock?.embeddingModel === 'string'
      ? data.lock.embeddingModel
      : undefined;
  const aliasModel =
    typeof data.lockedModelId === 'string'
      ? data.lockedModelId
      : typeof data.lock?.lockedModelId === 'string'
        ? data.lock.lockedModelId
        : typeof data.lock?.modelId === 'string'
          ? data.lock.modelId
          : undefined;
  const resolvedModel = canonicalModel ?? aliasModel;
  const hasCanonicalProvider = typeof data.lock?.embeddingProvider === 'string';
  const provider = hasCanonicalProvider
    ? normalizeProvider(data.lock?.embeddingProvider)
    : resolvedModel
      ? 'lmstudio'
      : undefined;
  const dimensions =
    typeof data.lock?.embeddingDimensions === 'number'
      ? data.lock.embeddingDimensions
      : undefined;
  return {
    lockedModelId: resolvedModel,
    lock: {
      embeddingProvider: provider,
      embeddingModel: resolvedModel,
      embeddingDimensions: dimensions,
    },
    aliasFallbackUsed: !canonicalModel && Boolean(aliasModel),
  };
}

export function useIngestModels() {
  const log = useMemo(() => createLogger('client'), []);
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
      const normalizedModels = Array.isArray(data.models)
        ? data.models
            .map((entry) => normalizeModelEntry(entry))
            .filter((entry): entry is IngestModel => entry !== null)
        : [];
      const normalizedLock = normalizeLockedModel(data);
      const normalizedOpenAi = normalizeOpenAiStatus(data.openai);
      const modelProviderCounts = normalizedModels.reduce(
        (acc, model) => {
          const provider = model.provider ?? 'lmstudio';
          acc[provider] = (acc[provider] ?? 0) + 1;
          return acc;
        },
        { lmstudio: 0, openai: 0 } as Record<IngestProviderId, number>,
      );
      const nextDefaultModelId =
        normalizedLock.lockedModelId ?? normalizedModels[0]?.id;

      setModels(normalizedModels);
      setLockedModelId(normalizedLock.lockedModelId);
      setLockedModel(normalizedLock.lock);
      setOpenai(normalizedOpenAi);
      log('info', 'DEV-0000036:T12:useIngestModels_normalized', {
        lmstudioModelCount: modelProviderCounts.lmstudio,
        openaiModelCount: modelProviderCounts.openai,
        defaultSelectionModelId: nextDefaultModelId ?? null,
        openaiStatus: normalizedOpenAi.status ?? null,
        openaiStatusCode: normalizedOpenAi.statusCode ?? null,
        aliasFallbackUsed: normalizedLock.aliasFallbackUsed,
      });
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
  }, [log]);

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
