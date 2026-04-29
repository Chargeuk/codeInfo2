import {
  DEFAULT_CHAT_PROVIDER_ID,
  ORDERED_CHAT_PROVIDER_IDS,
  isChatProviderId,
} from '@codeinfo2/common';
import type {
  ChatAgentFlagDescriptor,
  ChatModelInfo,
  ChatModelFlagOverride,
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

function buildUnavailableProviders(reason: string): ChatProviderInfo[] {
  return ORDERED_CHAT_PROVIDER_IDS.map((id) =>
    buildProviderInfo(id, { reason }),
  );
}

function buildLegacyBootstrapProviders(): ChatProviderInfo[] {
  return ORDERED_CHAT_PROVIDER_IDS.map((id) =>
    id === 'lmstudio'
      ? buildProviderInfo(id, { available: true, toolsAvailable: true })
      : buildProviderInfo(id),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

function isChatModelInfo(value: unknown): value is ChatModelInfo {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.key !== 'string' ||
    typeof value.displayName !== 'string' ||
    typeof value.type !== 'string'
  ) {
    return false;
  }

  if (
    value.supportedReasoningEfforts !== undefined &&
    !isStringArray(value.supportedReasoningEfforts)
  ) {
    return false;
  }

  if (
    value.defaultReasoningEffort !== undefined &&
    typeof value.defaultReasoningEffort !== 'string'
  ) {
    return false;
  }

  return true;
}

function isChatProviderInfo(value: unknown): value is ChatProviderInfo {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isChatProviderId(value.id) &&
    typeof value.label === 'string' &&
    typeof value.available === 'boolean' &&
    typeof value.toolsAvailable === 'boolean' &&
    (value.reason === undefined || typeof value.reason === 'string')
  );
}

function parseProvidersResponse(
  payload: unknown,
):
  | { kind: 'legacy'; models: ChatModelInfo[] }
  | { kind: 'current'; providers: ChatProviderInfo[] } {
  if (Array.isArray(payload)) {
    if (!payload.every(isChatModelInfo)) {
      throw new Error('Malformed chat providers response');
    }

    return {
      kind: 'legacy',
      models: payload,
    };
  }

  if (!isRecord(payload) || !Array.isArray(payload.providers)) {
    throw new Error('Malformed chat providers response');
  }

  if (!payload.providers.every(isChatProviderInfo)) {
    throw new Error('Malformed chat providers response');
  }

  return {
    kind: 'current',
    providers: payload.providers,
  };
}

function parseModelsResponse(payload: unknown): ChatModelsResponse {
  if (!isRecord(payload)) {
    throw new Error('Malformed chat models response');
  }

  if (
    !Array.isArray(payload.models) ||
    !payload.models.every(isChatModelInfo) ||
    typeof payload.available !== 'boolean' ||
    typeof payload.toolsAvailable !== 'boolean'
  ) {
    throw new Error('Malformed chat models response');
  }

  if (payload.reason !== undefined && typeof payload.reason !== 'string') {
    throw new Error('Malformed chat models response');
  }

  if (
    payload.codexWarnings !== undefined &&
    !isStringArray(payload.codexWarnings)
  ) {
    throw new Error('Malformed chat models response');
  }

  return payload as ChatModelsResponse;
}

function mergeAgentFlagDescriptors(
  base: ChatAgentFlagDescriptor[] | undefined,
  overrides: ChatModelFlagOverride[] | undefined,
): ChatAgentFlagDescriptor[] {
  if (!base || base.length === 0) {
    return [];
  }

  const overrideMap = new Map(
    (overrides ?? []).map((entry) => [entry.key, entry] as const),
  );

  return base.map((descriptor) => {
    const override = overrideMap.get(descriptor.key);
    if (!override) {
      return { ...descriptor };
    }

    return {
      ...descriptor,
      ...(override.resolvedDefault !== undefined
        ? { resolvedDefault: override.resolvedDefault }
        : {}),
      ...(override.supportedValues !== undefined
        ? { supportedValues: override.supportedValues }
        : {}),
      ...(override.min !== undefined ? { min: override.min } : {}),
      ...(override.max !== undefined ? { max: override.max } : {}),
      ...(override.integer !== undefined ? { integer: override.integer } : {}),
    };
  });
}

function buildLegacyCodexAgentFlags(params: {
  defaults: CodexDefaults;
  models: ChatModelInfo[];
}): ChatAgentFlagDescriptor[] {
  const reasoningValues = normalizeReasoningCapabilityStrings(
    params.models.flatMap((model) => model.supportedReasoningEfforts ?? []),
  );

  return [
    {
      key: 'sandboxMode',
      label: 'Sandbox Mode',
      controlType: 'select',
      editable: true,
      seedDefault: 'danger-full-access',
      resolvedDefault: params.defaults.sandboxMode,
      supportedValues: [
        { value: 'workspace-write', label: 'Workspace write' },
        { value: 'read-only', label: 'Read-only' },
        { value: 'danger-full-access', label: 'Danger full access' },
      ],
    },
    {
      key: 'approvalPolicy',
      label: 'Approval Policy',
      controlType: 'select',
      editable: true,
      seedDefault: 'on-failure',
      resolvedDefault:
        params.defaults.approvalPolicy === 'on-failure'
          ? 'on-request'
          : params.defaults.approvalPolicy,
      supportedValues: [
        { value: 'never', label: 'Never (auto-approve)' },
        { value: 'on-request', label: 'On request' },
        { value: 'untrusted', label: 'Untrusted' },
      ],
    },
    {
      key: 'modelReasoningEffort',
      label: 'Reasoning Effort',
      controlType: 'select',
      editable: true,
      seedDefault: 'high',
      resolvedDefault: params.defaults.modelReasoningEffort,
      supportedValues:
        reasoningValues.length > 0
          ? reasoningValues.map((value) => ({
              value,
              label: value.charAt(0).toUpperCase() + value.slice(1),
            }))
          : [{ value: params.defaults.modelReasoningEffort, label: 'High' }],
    },
    {
      key: 'networkAccessEnabled',
      label: 'Network Access',
      controlType: 'boolean',
      editable: true,
      seedDefault: true,
      resolvedDefault: params.defaults.networkAccessEnabled,
    },
    {
      key: 'webSearchMode',
      label: 'Web Search',
      controlType: 'select',
      editable: true,
      seedDefault: 'live',
      resolvedDefault:
        params.defaults.webSearchMode ??
        (params.defaults.webSearchEnabled ? 'live' : 'disabled'),
      supportedValues: [
        { value: 'disabled', label: 'Disabled' },
        { value: 'cached', label: 'Cached' },
        { value: 'live', label: 'Live' },
      ],
    },
  ];
}

function normalizeProviders(list: ChatProviderInfo[]): ChatProviderInfo[] {
  const provided = new Map<ChatProviderId, ChatProviderInfo>();

  list.forEach((entry) => {
    if (!isChatProviderId(entry.id)) {
      return;
    }
    provided.set(entry.id, buildProviderInfo(entry.id, entry));
  });

  return ORDERED_CHAT_PROVIDER_IDS.map(
    (id) => provided.get(id) ?? buildProviderInfo(id),
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
  const [providerInfo, setProviderInfo] = useState<
    ChatProviderInfo | undefined
  >(undefined);
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
      return firstAvailable?.id ?? list[0]?.id;
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
        if (resolved === undefined) {
          return undefined;
        }
        if (!isChatProviderId(resolved)) {
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
        if (resolved === undefined) {
          return undefined;
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
      const payload = await res.json();
      const data = parseProvidersResponse(payload);

      // Legacy compatibility: some callers still return the models array directly.
      if (data.kind === 'legacy') {
        legacyBootstrapRef.current = true;
        const legacyModels = data.models;
        const list = buildLegacyBootstrapProviders();
        setProviders(list);
        setProvider('lmstudio', { source: 'legacy-bootstrap' });
        setProviderReason(undefined);
        setAvailable(true);
        setToolsAvailable(true);
        setModels(legacyModels);
        setSelected(
          (prev) => {
            if (prev && legacyModels.some((m) => m.key === prev)) {
              return prev;
            }
            return legacyModels[0]?.key;
          },
          { source: 'legacy-bootstrap' },
        );
        setStatus('success');
        setProviderStatus('success');
        return;
      }

      legacyBootstrapRef.current = false;
      const list = normalizeProviders(data.providers);
      setProviders(list);
      const chosen = pickProvider(list);
      setProvider(chosen, { source: 'provider-bootstrap' });
      const match = list.find((p) => p.id === chosen);
      setProviderReason(match?.reason);
      setProviderStatus('success');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const message = (err as Error).message;
      setProviders(buildUnavailableProviders(message));
      setProviderReason(message);
      setAvailable(false);
      setToolsAvailable(false);
      setModels([]);
      setSelected(undefined, { source: 'model-fallback' });
      setStatus('error');
      setProviderStatus('error');
      setProviderErrorMessage(message);
    } finally {
      if (providerControllerRef.current === controller) {
        providerControllerRef.current = null;
      }
    }
  }, [pickProvider, setProvider, setSelected]);

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

        const data = parseModelsResponse(await res.json());
        const rawModels = data.models;
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
        const resolvedProviderInfo =
          data.providerInfo ??
          data.providers?.find((entry) => entry.id === effectiveProvider);
        setProviderInfo(resolvedProviderInfo);
        setCodexDefaults(
          effectiveProvider === 'codex'
            ? (data.codexDefaults ??
                resolvedProviderInfo?.compatibility?.codexDefaults)
            : undefined,
        );
        setCodexWarnings(
          effectiveProvider === 'codex'
            ? (data.codexWarnings ??
                resolvedProviderInfo?.compatibility?.codexWarnings)
            : undefined,
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
        const message = (err as Error).message;
        setAvailable(false);
        setToolsAvailable(false);
        setProviderReason(message);
        setProviderInfo(undefined);
        setCodexDefaults(undefined);
        setCodexWarnings(undefined);
        setModels([]);
        setSelected(undefined, {
          source: 'model-fallback',
        });
        setStatus('error');
        setErrorMessage(message);
      } finally {
        if (modelsControllerRef.current === controller) {
          modelsControllerRef.current = null;
        }
      }
    },
    [providerState, setSelected],
  );

  useEffect(() => {
    void refreshProviders();
    return () => {
      providerControllerRef.current?.abort();
      modelsControllerRef.current?.abort();
    };
  }, [refreshProviders]);

  useEffect(() => {
    const selectedProvider = providerState
      ? providers.find((entry) => entry.id === providerState)
      : undefined;
    if (
      providerState &&
      !legacyBootstrapRef.current &&
      providerStatus === 'success' &&
      selectedProvider?.available
    ) {
      void refreshModels(providerState);
    }
  }, [providerState, providerStatus, providers, refreshModels]);

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

  const selectedModel = useMemo(
    () => models.find((model) => model.key === selected),
    [models, selected],
  );

  const agentFlags = useMemo(() => {
    const baseFlags =
      providerInfo?.agentFlags ??
      (providerState === 'codex' && codexDefaults
        ? buildLegacyCodexAgentFlags({
            defaults: codexDefaults,
            models,
          })
        : undefined);

    return mergeAgentFlagDescriptors(baseFlags, selectedModel?.flagOverrides);
  }, [
    codexDefaults,
    models,
    providerInfo?.agentFlags,
    providerState,
    selectedModel?.flagOverrides,
  ]);

  return {
    providers,
    provider: providerState,
    setProvider,
    providerStatus,
    providerInfo,
    providerErrorMessage,
    providerReason,
    available,
    toolsAvailable,
    agentFlags,
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
