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

function pickProvider(
  list: ChatProviderInfo[],
  options?: {
    currentProvider?: ChatProviderId;
    preferredProvider?: ChatProviderId;
  },
): ChatProviderId | undefined {
  const currentProvider =
    options?.currentProvider &&
    list.find((provider) => provider.id === options.currentProvider);
  if (currentProvider?.available) {
    return currentProvider.id;
  }

  const preferredProvider =
    options?.preferredProvider &&
    list.find((provider) => provider.id === options.preferredProvider);
  if (preferredProvider?.available) {
    return preferredProvider.id;
  }

  const firstAvailable = list.find((provider) => provider.available);
  if (firstAvailable) {
    return firstAvailable.id;
  }

  if (
    options?.currentProvider &&
    list.some((provider) => provider.id === options.currentProvider)
  ) {
    return options.currentProvider;
  }

  if (
    options?.preferredProvider &&
    list.some((provider) => provider.id === options.preferredProvider)
  ) {
    return options.preferredProvider;
  }
  return list[0]?.id;
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

function isSelectedModelIdentity(
  model: ChatModelInfo,
  selected?: string,
  selectedEndpointId?: string,
): boolean {
  return (
    model.key === selected &&
    (model.endpointId ?? undefined) === (selectedEndpointId ?? undefined)
  );
}

function findSelectedModel(
  models: ChatModelInfo[],
  selected?: string,
  selectedEndpointId?: string,
): ChatModelInfo | undefined {
  if (!selected) return undefined;

  const exactMatch = models.find((model) =>
    isSelectedModelIdentity(model, selected, selectedEndpointId),
  );
  if (exactMatch) return exactMatch;

  if (selectedEndpointId === undefined) {
    return models.find((model) => model.key === selected);
  }

  return undefined;
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

function parseProvidersResponse(payload: unknown):
  | { kind: 'legacy'; models: ChatModelInfo[] }
  | {
      kind: 'current';
      providers: ChatProviderInfo[];
      selectedProvider?: ChatProviderId;
      selectedModel?: string;
      selectedEndpointId?: string;
    } {
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

  const selectedProvider =
    payload.selectedProvider === undefined
      ? undefined
      : typeof payload.selectedProvider === 'string' &&
          isChatProviderId(payload.selectedProvider)
        ? payload.selectedProvider
        : undefined;
  if (
    payload.selectedProvider !== undefined &&
    selectedProvider === undefined
  ) {
    throw new Error('Malformed chat providers response');
  }

  const selectedModel =
    payload.selectedModel === undefined
      ? undefined
      : typeof payload.selectedModel === 'string'
        ? payload.selectedModel
        : undefined;
  if (payload.selectedModel !== undefined && selectedModel === undefined) {
    throw new Error('Malformed chat providers response');
  }

  const selectedEndpointId =
    payload.selectedEndpointId === undefined
      ? undefined
      : typeof payload.selectedEndpointId === 'string'
        ? payload.selectedEndpointId
        : undefined;
  if (
    payload.selectedEndpointId !== undefined &&
    selectedEndpointId === undefined
  ) {
    throw new Error('Malformed chat providers response');
  }

  return {
    kind: 'current',
    providers: payload.providers,
    selectedProvider,
    selectedModel,
    selectedEndpointId,
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
  options?: {
    provider?: ChatProviderId;
    serverSelectedProvider?: ChatProviderId;
    selectedModel?: string;
    providerDefaultModel?: string;
  },
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

    const keepCopilotProviderResolvedDefault =
      shouldPreserveCopilotReasoningDefault({
        provider: options?.provider,
        serverSelectedProvider: options?.serverSelectedProvider,
        descriptorKey: descriptor.key,
        providerDefaultModel: options?.providerDefaultModel,
        selectedModel: options?.selectedModel,
      });

    return {
      ...descriptor,
      ...(!keepCopilotProviderResolvedDefault &&
      override.resolvedDefault !== undefined
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

export function shouldPreserveCopilotReasoningDefault(params: {
  provider?: ChatProviderId;
  serverSelectedProvider?: ChatProviderId;
  descriptorKey: string;
  providerDefaultModel?: string;
  selectedModel?: string;
}): boolean {
  return (
    params.provider === 'copilot' &&
    params.serverSelectedProvider === 'copilot' &&
    params.descriptorKey === 'modelReasoningEffort' &&
    typeof params.providerDefaultModel === 'string' &&
    params.providerDefaultModel.length > 0 &&
    params.selectedModel === params.providerDefaultModel
  );
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

  const orderedFromServer: ChatProviderInfo[] = [];
  list.forEach((entry) => {
    if (!isChatProviderId(entry.id)) {
      return;
    }
    const built = buildProviderInfo(entry.id, entry);
    provided.set(entry.id, built);
    orderedFromServer.push(built);
  });

  // Always return providers in canonical ordering (ORDERED_CHAT_PROVIDER_IDS),
  // but use server-provided entries when present and fall back to defaults for
  // any missing providers.
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
  const selectedRef = useRef<string | undefined>(undefined);
  const selectedEndpointIdRef = useRef<string | undefined>(undefined);
  const bootstrapSelectedModelRef = useRef<{
    provider: ChatProviderId;
    model: string;
    endpointId?: string;
  } | null>(null);
  const hydratedModelsProviderRef = useRef<ChatProviderId | undefined>(
    undefined,
  );

  const [providers, setProviders] = useState<ChatProviderInfo[]>([]);
  const [serverSelectedProvider, setServerSelectedProvider] = useState<
    ChatProviderId | undefined
  >(undefined);
  const [providerState, setProviderState] = useState<
    ChatProviderId | undefined
  >(undefined);
  const [providerStatus, setProviderStatus] = useState<Status>('idle');
  const [providerErrorMessage, setProviderErrorMessage] = useState<
    string | undefined
  >();

  const [models, setModels] = useState<ChatModelInfo[]>([]);
  const [selected, setSelectedState] = useState<string | undefined>();
  const [selectedEndpointId, setSelectedEndpointIdState] = useState<
    string | undefined
  >();
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

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    selectedEndpointIdRef.current = selectedEndpointId;
  }, [selectedEndpointId]);

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
        endpointId?: string | null;
      },
    ) => {
      const currentSelected = selectedRef.current;
      const resolved =
        typeof nextValue === 'function' ? nextValue(currentSelected) : nextValue;
      const nextEndpointId =
        resolved === undefined
          ? undefined
          : options?.endpointId !== undefined
            ? options.endpointId ?? undefined
            : resolved === currentSelected
              ? selectedEndpointIdRef.current
              : undefined;

      setSelectedState((current) => {
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
      setSelectedEndpointIdState(nextEndpointId);
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
        setServerSelectedProvider(undefined);
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
            if (
              prev &&
              legacyModels.some((model) =>
                isSelectedModelIdentity(model, prev, undefined),
              )
            ) {
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
      console.info(
        '[useChatModel] normalized providers order:',
        list.map((p) => p.id),
      );
      setProviders(list);
      setServerSelectedProvider(data.selectedProvider);
      const preferredProvider =
        data.selectedProvider &&
        list.some((provider) => provider.id === data.selectedProvider)
          ? data.selectedProvider
          : undefined;
      const chosen = pickProvider(list, {
        currentProvider: providerRef.current,
        preferredProvider,
      });
      const bootstrapEndpointId =
        preferredProvider &&
        chosen === preferredProvider &&
        typeof data.selectedEndpointId === 'string' &&
        data.selectedEndpointId.trim().length > 0
          ? data.selectedEndpointId.trim()
          : undefined;
      bootstrapSelectedModelRef.current =
        preferredProvider &&
        chosen === preferredProvider &&
        data.selectedModel &&
        data.selectedModel.trim().length > 0
          ? {
              provider: preferredProvider,
              model: data.selectedModel.trim(),
              endpointId: bootstrapEndpointId,
            }
          : null;
      setProvider(chosen, { source: 'provider-bootstrap' });
      const match = list.find((p) => p.id === chosen);
      setProviderReason(match?.reason);
      setSelectedEndpointIdState(bootstrapEndpointId);
      setProviderStatus('success');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const message = (err as Error).message;
      setServerSelectedProvider(undefined);
      setProviders(buildUnavailableProviders(message));
      setProviderReason(message);
      setAvailable(false);
      setToolsAvailable(false);
      setModels([]);
      setSelected(undefined, {
        source: 'model-fallback',
        endpointId: null,
      });
      setStatus('error');
      setProviderStatus('error');
      setProviderErrorMessage(message);
    } finally {
      if (providerControllerRef.current === controller) {
        providerControllerRef.current = null;
      }
    }
  }, [setProvider, setSelected]);

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
        const resolvedProviderInfo =
          data.providerInfo ??
          data.providers?.find((entry) => entry.id === effectiveProvider);
        const resolvedCompatibility =
          data.compatibility ?? resolvedProviderInfo?.compatibility;
        const resolvedCodexDefaults =
          resolvedCompatibility?.codexDefaults ?? data.codexDefaults;
        const resolvedCodexWarnings =
          resolvedCompatibility?.codexWarnings ?? data.codexWarnings;
        const codexDefaultEffort =
          typeof resolvedCodexDefaults?.modelReasoningEffort === 'string'
            ? resolvedCodexDefaults.modelReasoningEffort
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

                if (normalizedSupported.length === 0 && !normalizedDefault) {
                  console.error(
                    '[DEV-0000037][T17] event=codex_reasoning_capabilities_invalid result=error',
                    {
                      provider: effectiveProvider,
                      modelKey: model.key,
                    },
                  );
                }

                const legacyReasoningOverride =
                  normalizedSupported.length > 0
                    ? [
                        {
                          key: 'modelReasoningEffort' as const,
                          supportedValues: normalizedSupported.map((value) => ({
                            value,
                            label:
                              value.charAt(0).toUpperCase() + value.slice(1),
                          })),
                          resolvedDefault: normalizedDefault,
                        },
                      ]
                    : [];

                return {
                  ...model,
                  supportedReasoningEfforts: normalizedSupported,
                  defaultReasoningEffort: normalizedDefault,
                  flagOverrides:
                    model.flagOverrides && model.flagOverrides.length > 0
                      ? model.flagOverrides
                      : legacyReasoningOverride,
                };
              })
            : rawModels;
        if (resolvedCodexDefaults) {
          const hasWarnings = Boolean(resolvedCodexWarnings?.length);
          console.info('[codex-models-response] codexDefaults received', {
            hasWarnings,
            codexDefaults: resolvedCodexDefaults,
          });
        }
        setAvailable(Boolean(data.available));
        setToolsAvailable(Boolean(data.toolsAvailable));
        setProviderReason(data.reason);
        hydratedModelsProviderRef.current = effectiveProvider;
        setProviderInfo(resolvedProviderInfo);
        setCodexDefaults(
          effectiveProvider === 'codex' ? resolvedCodexDefaults : undefined,
        );
        setCodexWarnings(
          effectiveProvider === 'codex' ? resolvedCodexWarnings : undefined,
        );
        setModels(models);
        const currentSelection = findSelectedModel(
          models,
          selectedRef.current,
          selectedEndpointIdRef.current,
        );
        const bootstrapSelection =
          bootstrapSelectedModelRef.current?.provider === effectiveProvider
            ? findSelectedModel(
                models,
                bootstrapSelectedModelRef.current.model,
                bootstrapSelectedModelRef.current.endpointId,
              )
            : undefined;
        const resolvedDefaultSelection =
          typeof data.defaultModel === 'string'
            ? findSelectedModel(models, data.defaultModel)
            : typeof resolvedProviderInfo?.defaultModel === 'string'
              ? findSelectedModel(models, resolvedProviderInfo.defaultModel)
              : undefined;
        const nextSelection =
          currentSelection ??
          bootstrapSelection ??
          resolvedDefaultSelection ??
          models[0];
        setSelected(nextSelection?.key, {
          source: 'model-bootstrap',
          endpointId: nextSelection?.endpointId ?? null,
        });
        if (bootstrapSelectedModelRef.current?.provider === effectiveProvider) {
          bootstrapSelectedModelRef.current = null;
        }
        setStatus('success');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        const message = (err as Error).message;
        setAvailable(false);
        setToolsAvailable(false);
        setProviderReason(message);
        hydratedModelsProviderRef.current = undefined;
        setProviderInfo(undefined);
        setCodexDefaults(undefined);
        setCodexWarnings(undefined);
        setModels([]);
        setSelected(undefined, {
          source: 'model-fallback',
          endpointId: null,
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
      providerStatus === 'success' &&
      !legacyBootstrapRef.current &&
      selectedProvider &&
      !selectedProvider.available
    ) {
      hydratedModelsProviderRef.current = undefined;
      setAvailable(false);
      setToolsAvailable(Boolean(selectedProvider.toolsAvailable));
      setProviderReason(selectedProvider.reason);
      setProviderInfo(selectedProvider);
      setCodexDefaults(selectedProvider.compatibility?.codexDefaults);
      setCodexWarnings(selectedProvider.compatibility?.codexWarnings);
      setModels([]);
      setSelected(undefined, { source: 'model-fallback', endpointId: null });
      setSelectedEndpointIdState(undefined);
      return;
    }

    if (
      providerState &&
      hydratedModelsProviderRef.current &&
      hydratedModelsProviderRef.current !== providerState
    ) {
      hydratedModelsProviderRef.current = undefined;
      setModels([]);
      setSelected(undefined, { source: 'model-fallback', endpointId: null });
      setSelectedEndpointIdState(undefined);
      setProviderInfo(undefined);
      setCodexDefaults(undefined);
      setCodexWarnings(undefined);
      setProviderReason(selectedProvider?.reason);
      setAvailable(Boolean(selectedProvider?.available));
      setToolsAvailable(Boolean(selectedProvider?.toolsAvailable));
    }

    if (
      providerState &&
      !legacyBootstrapRef.current &&
      providerStatus === 'success' &&
      selectedProvider?.available
    ) {
      void refreshModels(providerState);
    }
  }, [providerState, providerStatus, providers, refreshModels, setSelected]);

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
    const selectedModel = findSelectedModel(
      models,
      selected,
      selectedEndpointId,
    );
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
  }, [models, providerState, selected, selectedEndpointId]);

  const selectedModel = useMemo(
    () => findSelectedModel(models, selected, selectedEndpointId),
    [models, selected, selectedEndpointId],
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

    return mergeAgentFlagDescriptors(baseFlags, selectedModel?.flagOverrides, {
      provider: providerState,
      serverSelectedProvider,
      selectedModel: selected,
      providerDefaultModel: providerInfo?.defaultModel,
    });
  }, [
    codexDefaults,
    models,
    providerInfo?.agentFlags,
    providerInfo?.defaultModel,
    providerState,
    selected,
    selectedModel?.flagOverrides,
    serverSelectedProvider,
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
    selectedEndpointId,
    selectedModelCapabilities,
    status,
    errorMessage,
    refreshProviders,
    refreshModels,
    ...flags,
  };
}

export default useChatModel;
