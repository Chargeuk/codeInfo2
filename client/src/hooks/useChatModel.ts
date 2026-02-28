import type {
  ChatModelInfo,
  ChatModelsResponse,
  CodexDefaults,
  ChatProviderInfo,
} from '@codeinfo2/common';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';

type Status = 'idle' | 'loading' | 'success' | 'error';

const serverBase = getApiBaseUrl();

export type SelectedModelReasoningCapabilities = {
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
};

const normalizeReasoningCapabilityStrings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  value.forEach((entry) => {
    if (typeof entry !== 'string') return;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  return normalized;
};

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
  const [codexDefaults, setCodexDefaults] = useState<
    CodexDefaults | undefined
  >();
  const [codexWarnings, setCodexWarnings] = useState<string[] | undefined>();

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
        const rawModels = Array.isArray(data.models) ? data.models : [];
        const codexDefaultEffort =
          typeof data.codexDefaults?.modelReasoningEffort === 'string'
            ? data.codexDefaults.modelReasoningEffort
            : '';
        const models =
          effectiveProvider === 'codex'
            ? rawModels.map((model) => {
                const supported = normalizeReasoningCapabilityStrings(
                  model.supportedReasoningEfforts,
                );
                const rawDefault =
                  typeof model.defaultReasoningEffort === 'string'
                    ? model.defaultReasoningEffort.trim()
                    : '';

                const normalizedSupported = [...supported];
                if (normalizedSupported.length === 0 && rawDefault) {
                  normalizedSupported.push(rawDefault);
                }
                if (normalizedSupported.length === 0 && codexDefaultEffort) {
                  normalizedSupported.push(codexDefaultEffort);
                }

                let normalizedDefault = rawDefault || codexDefaultEffort;
                if (
                  normalizedSupported.length > 0 &&
                  (!normalizedDefault ||
                    !normalizedSupported.includes(normalizedDefault))
                ) {
                  normalizedDefault = normalizedSupported[0];
                }

                return {
                  ...model,
                  supportedReasoningEfforts: normalizedSupported,
                  defaultReasoningEffort: normalizedDefault,
                };
              })
            : rawModels;
        if (data.codexDefaults) {
          const hasWarnings = Boolean(data.codexWarnings?.length);
          console.info('[codex-models-response] codexDefaults received', {
            hasWarnings,
            codexDefaults: data.codexDefaults,
          });
        }
        setAvailable(Boolean(data.available));
        setToolsAvailable(Boolean(data.toolsAvailable));
        setProviderReason(data.reason);
        setCodexDefaults(
          effectiveProvider === 'codex' ? data.codexDefaults : undefined,
        );
        setCodexWarnings(
          effectiveProvider === 'codex' ? data.codexWarnings : undefined,
        );
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
        setCodexDefaults(undefined);
        setCodexWarnings(undefined);
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

  const selectedModelCapabilities = useMemo<
    SelectedModelReasoningCapabilities | undefined
  >(() => {
    if (provider !== 'codex' || !selected) return undefined;
    const selectedModel = models.find((model) => model.key === selected);
    if (!selectedModel) return undefined;
    if (selectedModel.type !== 'codex') return undefined;

    const supported = normalizeReasoningCapabilityStrings(
      selectedModel.supportedReasoningEfforts,
    );
    const defaultReasoningEffort =
      typeof selectedModel.defaultReasoningEffort === 'string'
        ? selectedModel.defaultReasoningEffort.trim()
        : '';

    return {
      supportedReasoningEfforts: supported,
      defaultReasoningEffort,
    };
  }, [models, provider, selected]);

  return {
    providers,
    provider,
    setProvider,
    providerStatus,
    providerErrorMessage,
    providerReason,
    available,
    toolsAvailable,
    codexDefaults,
    codexWarnings,
    models,
    selected,
    setSelected,
    selectedModelCapabilities,
    status,
    errorMessage,
    refreshProviders,
    refreshModels,
    ...flags,
  };
}

export default useChatModel;
