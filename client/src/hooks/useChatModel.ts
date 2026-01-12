import type {
  ChatModelInfo,
  ChatModelsResponse,
  ChatProviderInfo,
} from '@codeinfo2/common';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';

type Status = 'idle' | 'loading' | 'success' | 'error';

const serverBase = getApiBaseUrl();

export function useChatModel() {
  const providerControllerRef = useRef<AbortController | null>(null);
  const modelsControllerRef = useRef<AbortController | null>(null);
  const legacyBootstrapRef = useRef(false);
  const fallbackModels: ChatModelInfo[] = useMemo(
    () => [
      { key: 'fallback-model', displayName: 'Mock Chat Model', type: 'gguf' },
    ],
    [],
  );

  const [providers, setProviders] = useState<ChatProviderInfo[]>([]);
  const [provider, setProvider] = useState<string | undefined>();
  const [providerStatus, setProviderStatus] = useState<Status>('idle');
  const [providerErrorMessage, setProviderErrorMessage] = useState<
    string | undefined
  >();

  const [models, setModels] = useState<ChatModelInfo[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [available, setAvailable] = useState<boolean>(true);
  const [toolsAvailable, setToolsAvailable] = useState<boolean>(true);
  const [providerReason, setProviderReason] = useState<string | undefined>();

  const pickProvider = useCallback(
    (list: ChatProviderInfo[]) => {
      if (provider && list.some((p) => p.id === provider)) {
        return provider;
      }
      const firstAvailable = list.find((p) => p.available);
      return firstAvailable?.id ?? list[0]?.id;
    },
    [provider],
  );

  const refreshProviders = useCallback(async () => {
    providerControllerRef.current?.abort();
    const controller = new AbortController();
    providerControllerRef.current = controller;
    setProviderStatus('loading');
    setProviderErrorMessage(undefined);
    try {
      const res = await fetch(
        new URL('/chat/providers', serverBase).toString(),
        { signal: controller.signal },
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch chat providers (${res.status})`);
      }
      const data = (await res.json()) as
        | { providers?: ChatProviderInfo[] }
        | ChatModelInfo[];

      // Legacy compatibility: some callers still return the models array directly.
      if (Array.isArray(data)) {
        legacyBootstrapRef.current = true;
        const list: ChatProviderInfo[] = [
          {
            id: 'lmstudio',
            label: 'LM Studio',
            available: true,
            toolsAvailable: true,
          },
        ];
        setProviders(list);
        setProvider('lmstudio');
        setProviderReason(undefined);
        setAvailable(true);
        setToolsAvailable(true);
        setModels(data);
        setSelected((prev) => {
          if (prev && data.some((m) => m.key === prev)) {
            return prev;
          }
          return data[0]?.key;
        });
        setStatus('success');
        setProviderStatus('success');
        return;
      }

      const list = (data.providers ?? []).length
        ? (data.providers ?? [])
        : [
            {
              id: 'lmstudio',
              label: 'LM Studio',
              available: true,
              toolsAvailable: true,
              reason: undefined,
            },
          ];
      setProviders(list);
      const chosen = pickProvider(list);
      setProvider(chosen);
      const match = list.find((p) => p.id === chosen);
      setProviderReason(match?.reason);
      setProviderStatus('success');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const fallbackProviders: ChatProviderInfo[] = [
        {
          id: 'lmstudio',
          label: 'LM Studio',
          available: true,
          toolsAvailable: true,
          reason: (err as Error).message,
        },
      ];
      setProviders(fallbackProviders);
      setProvider('lmstudio');
      setProviderReason((err as Error).message);
      setAvailable(true);
      setToolsAvailable(true);
      setModels(fallbackModels);
      setSelected((prev) => prev ?? fallbackModels[0]?.key);
      setStatus('success');
      setProviderStatus('success');
      setProviderErrorMessage((err as Error).message);
    } finally {
      if (providerControllerRef.current === controller) {
        providerControllerRef.current = null;
      }
    }
  }, [pickProvider, fallbackModels]);

  const refreshModels = useCallback(
    async (targetProvider?: string) => {
      const effectiveProvider = targetProvider ?? provider;
      if (!effectiveProvider) return;

      modelsControllerRef.current?.abort();
      const controller = new AbortController();
      modelsControllerRef.current = controller;
      setStatus('loading');
      setErrorMessage(undefined);
      try {
        const res = await fetch(
          new URL(
            `/chat/models?provider=${encodeURIComponent(effectiveProvider)}`,
            serverBase,
          ).toString(),
          { signal: controller.signal },
        );

        if (!res.ok) {
          throw new Error(`Failed to fetch chat models (${res.status})`);
        }

        const data = (await res.json()) as ChatModelsResponse;
        const models = Array.isArray(data.models) ? data.models : [];
        setAvailable(Boolean(data.available));
        setToolsAvailable(Boolean(data.toolsAvailable));
        setProviderReason(data.reason);
        setModels(models);
        setSelected((prev) => {
          if (prev && models.some((m) => m.key === prev)) {
            return prev;
          }
          return models[0]?.key;
        });
        setStatus('success');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setAvailable(true);
        setToolsAvailable(true);
        setProviderReason((err as Error).message);
        setModels(fallbackModels);
        setSelected((prev) => prev ?? fallbackModels[0]?.key);
        setStatus('success');
        setErrorMessage((err as Error).message);
      } finally {
        if (modelsControllerRef.current === controller) {
          modelsControllerRef.current = null;
        }
      }
    },
    [provider, fallbackModels],
  );

  useEffect(() => {
    void refreshProviders();
    return () => {
      providerControllerRef.current?.abort();
      modelsControllerRef.current?.abort();
    };
  }, [refreshProviders]);

  useEffect(() => {
    if (provider && !legacyBootstrapRef.current) {
      void refreshModels(provider);
    }
  }, [provider, refreshModels]);

  const flags = useMemo(() => {
    const isLoading =
      providerStatus === 'loading' || status === 'loading' || !provider;
    const isError = providerStatus === 'error' || status === 'error';
    const isEmpty =
      status === 'success' &&
      providerStatus === 'success' &&
      models.length === 0;

    return { isLoading, isError, isEmpty };
  }, [models.length, provider, providerStatus, status]);

  return {
    providers,
    provider,
    setProvider,
    providerStatus,
    providerErrorMessage,
    providerReason,
    available,
    toolsAvailable,
    models,
    selected,
    setSelected,
    status,
    errorMessage,
    refreshProviders,
    refreshModels,
    ...flags,
  };
}

export default useChatModel;
