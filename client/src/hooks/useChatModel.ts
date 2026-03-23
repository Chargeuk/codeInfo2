import {
  DEFAULT_CHAT_PROVIDER_ID,
  ORDERED_CHAT_PROVIDER_IDS,
  isChatProviderId,
} from '@codeinfo2/common';
import type {
  ChatModelInfo,
  ChatModelsResponse,
  CodexDefaults,
  ChatProviderInfo,
  ChatProviderId,
} from '@codeinfo2/common';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';
import { normalizeReasoningCapabilityStrings } from '../utils/reasoningCapabilities';

type Status = 'idle' | 'loading' | 'success' | 'error';

const serverBase = getApiBaseUrl();
const PROVIDER_LABELS: Record<ChatProviderId, string> = {
  codex: 'OpenAI Codex',
  copilot: 'GitHub Copilot',
  lmstudio: 'LM Studio',
};
const DEGRADED_FALLBACK_REASON =
  'Provider bootstrap fell back to LM Studio only.';

type ProviderSelectionSource =
  | 'provider-bootstrap'
  | 'provider-fallback'
  | 'provider-change'
  | 'conversation-select'
  | 'conversation-sync'
  | 'legacy-bootstrap';

type ModelSelectionSource =
  | 'model-bootstrap'
  | 'model-fallback'
  | 'model-change'
  | 'conversation-select'
  | 'conversation-sync'
  | 'legacy-bootstrap';

type SelectionLogContext = {
  chosenProvider: ChatProviderId;
  chosenModel?: string;
  nextSendOnly: boolean;
  source: ProviderSelectionSource | ModelSelectionSource;
  selectionType: 'provider' | 'model';
};

function logSelectionApplied(context: SelectionLogContext) {
  console.info('story.0000051.task11.provider_selection_applied', context);
}

function buildProviderInfo(
  id: ChatProviderId,
  overrides: Partial<ChatProviderInfo> = {},
): ChatProviderInfo {
  return {
    id,
    label: PROVIDER_LABELS[id],
    available: false,
    toolsAvailable: false,
    ...overrides,
  };
}

function buildDegradedFallbackProviders(reason: string): ChatProviderInfo[] {
  return ORDERED_CHAT_PROVIDER_IDS.map((id) =>
    id === 'lmstudio'
      ? buildProviderInfo(id, { available: true, toolsAvailable: true })
      : buildProviderInfo(id, { reason }),
  );
}

function normalizeProviders(list: ChatProviderInfo[]): ChatProviderInfo[] {
  const provided = new Map<ChatProviderId, ChatProviderInfo>();

  list.forEach((entry) => {
    if (!isChatProviderId(entry.id)) {
      return;
    }
    provided.set(entry.id, buildProviderInfo(entry.id, entry));
  });

  const missingReason = DEGRADED_FALLBACK_REASON;
  return ORDERED_CHAT_PROVIDER_IDS.map(
    (id) =>
      provided.get(id) ??
      buildProviderInfo(id, {
        reason: missingReason,
      }),
  );
}

export type SelectedModelReasoningCapabilities = {
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
};

export function useChatModel() {
  const providerControllerRef = useRef<AbortController | null>(null);
  const modelsControllerRef = useRef<AbortController | null>(null);
  const legacyBootstrapRef = useRef(false);
  const providerRef = useRef<ChatProviderId | undefined>(undefined);
  const fallbackModels: ChatModelInfo[] = useMemo(
    () => [
      { key: 'fallback-model', displayName: 'Mock Chat Model', type: 'gguf' },
    ],
    [],
  );

  const [providers, setProviders] = useState<ChatProviderInfo[]>([]);
  const [providerState, setProviderState] = useState<
    ChatProviderId | undefined
  >(undefined);
  const [providerStatus, setProviderStatus] = useState<Status>('idle');
  const [providerErrorMessage, setProviderErrorMessage] = useState<
    string | undefined
  >();

  const [models, setModels] = useState<ChatModelInfo[]>([]);
  const [selected, setSelectedState] = useState<string | undefined>();
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [available, setAvailable] = useState<boolean>(true);
  const [toolsAvailable, setToolsAvailable] = useState<boolean>(true);
  const [providerReason, setProviderReason] = useState<string | undefined>();
  const [codexDefaults, setCodexDefaults] = useState<
    CodexDefaults | undefined
  >();
  const [codexWarnings, setCodexWarnings] = useState<string[] | undefined>();

  useEffect(() => {
    providerRef.current = providerState;
  }, [providerState]);

  const pickProvider = useCallback(
    (list: ChatProviderInfo[]) => {
      if (providerState && list.some((p) => p.id === providerState)) {
        return providerState;
      }
      const firstAvailable = list.find((p) => p.available);
      return firstAvailable?.id ?? DEFAULT_CHAT_PROVIDER_ID;
    },
    [providerState],
  );

  const setProvider = useCallback(
    (
      nextValue:
        | string
        | undefined
        | ((current: ChatProviderId | undefined) => string | undefined),
      options?: {
        nextSendOnly?: boolean;
        source?: ProviderSelectionSource;
      },
    ) => {
      setProviderState((current) => {
        const resolved =
          typeof nextValue === 'function' ? nextValue(current) : nextValue;
        if (!resolved || !isChatProviderId(resolved)) {
          return current;
        }
        if (resolved !== current) {
          logSelectionApplied({
            selectionType: 'provider',
            chosenProvider: resolved,
            nextSendOnly: Boolean(options?.nextSendOnly),
            source: options?.source ?? 'provider-bootstrap',
          });
        }
        return resolved;
      });
    },
    [],
  );

  const setSelected = useCallback(
    (
      nextValue:
        | string
        | undefined
        | ((current: string | undefined) => string | undefined),
      options?: {
        nextSendOnly?: boolean;
        source?: ModelSelectionSource;
      },
    ) => {
      setSelectedState((current) => {
        const resolved =
          typeof nextValue === 'function' ? nextValue(current) : nextValue;
        if (!resolved) {
          return current;
        }
        if (resolved !== current) {
          logSelectionApplied({
            selectionType: 'model',
            chosenProvider: providerRef.current ?? DEFAULT_CHAT_PROVIDER_ID,
            chosenModel: resolved,
            nextSendOnly: Boolean(options?.nextSendOnly),
            source: options?.source ?? 'model-bootstrap',
          });
        }
        return resolved;
      });
    },
    [],
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
        const list = buildDegradedFallbackProviders(DEGRADED_FALLBACK_REASON);
        setProviders(list);
        setProvider('lmstudio', { source: 'legacy-bootstrap' });
        setProviderReason(undefined);
        setAvailable(true);
        setToolsAvailable(true);
        setModels(data);
        setSelected(
          (prev) => {
            if (prev && data.some((m) => m.key === prev)) {
              return prev;
            }
            return data[0]?.key;
          },
          { source: 'legacy-bootstrap' },
        );
        setStatus('success');
        setProviderStatus('success');
        return;
      }

      const list = normalizeProviders(data.providers ?? []);
      setProviders(list);
      const chosen = pickProvider(list);
      setProvider(chosen, { source: 'provider-bootstrap' });
      const match = list.find((p) => p.id === chosen);
      setProviderReason(match?.reason);
      setProviderStatus('success');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const fallbackProviders = buildDegradedFallbackProviders(
        (err as Error).message,
      );
      setProviders(fallbackProviders);
      setProvider('lmstudio', { source: 'provider-fallback' });
      setProviderReason((err as Error).message);
      setAvailable(true);
      setToolsAvailable(true);
      setModels(fallbackModels);
      setSelected((prev) => prev ?? fallbackModels[0]?.key, {
        source: 'model-fallback',
      });
      setStatus('success');
      setProviderStatus('success');
      setProviderErrorMessage((err as Error).message);
    } finally {
      if (providerControllerRef.current === controller) {
        providerControllerRef.current = null;
      }
    }
  }, [fallbackModels, pickProvider, setProvider, setSelected]);

  const refreshModels = useCallback(
    async (targetProvider?: ChatProviderId | string) => {
      const effectiveProvider = targetProvider ?? providerState;
      if (!effectiveProvider) return;
      if (!isChatProviderId(effectiveProvider)) return;

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
        setSelected(
          (prev) => {
            if (prev && models.some((m) => m.key === prev)) {
              return prev;
            }
            return models[0]?.key;
          },
          { source: 'model-bootstrap' },
        );
        setStatus('success');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setAvailable(true);
        setToolsAvailable(true);
        setProviderReason((err as Error).message);
        setCodexDefaults(undefined);
        setCodexWarnings(undefined);
        setModels(fallbackModels);
        setSelected((prev) => prev ?? fallbackModels[0]?.key, {
          source: 'model-fallback',
        });
        setStatus('success');
        setErrorMessage((err as Error).message);
      } finally {
        if (modelsControllerRef.current === controller) {
          modelsControllerRef.current = null;
        }
      }
    },
    [providerState, fallbackModels, setSelected],
  );

  useEffect(() => {
    void refreshProviders();
    return () => {
      providerControllerRef.current?.abort();
      modelsControllerRef.current?.abort();
    };
  }, [refreshProviders]);

  useEffect(() => {
    if (providerState && !legacyBootstrapRef.current) {
      void refreshModels(providerState);
    }
  }, [providerState, refreshModels]);

  const flags = useMemo(() => {
    const isLoading =
      providerStatus === 'loading' || status === 'loading' || !providerState;
    const isError = providerStatus === 'error' || status === 'error';
    const isEmpty =
      status === 'success' &&
      providerStatus === 'success' &&
      models.length === 0;

    return { isLoading, isError, isEmpty };
  }, [models.length, providerState, providerStatus, status]);

  const selectedModelCapabilities = useMemo<
    SelectedModelReasoningCapabilities | undefined
  >(() => {
    if (providerState !== 'codex' || !selected) return undefined;
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
  }, [models, providerState, selected]);

  return {
    providers,
    provider: providerState,
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
