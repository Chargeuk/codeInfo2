import type { CodexOptions } from '@openai/codex-sdk';

import {
  resolveRuntimeProviderSelection,
  type ChatDefaultProvider,
  type RuntimeProviderSelection,
  type RuntimeProviderSelectionPath,
  type RuntimeProviderState,
} from '../config/chatDefaults.js';
import {
  applyCodexOpenAiCompatEndpointToRuntimeConfig,
} from '../config/codexConfig.js';
import {
  type OpenAiCompatEndpointConfig,
  validateOpenAiCompatEndpointConfigForProvider,
} from '../config/openaiCompatEndpoints.js';
import type { RuntimeTomlConfig } from '../config/runtimeConfig.js';
import { resolveExternalOpenAiCompatEndpoints } from '../config/startupEnv.js';

import { resolveOpenAiCompatEndpointRuntimeState } from './openaiCompatModelDiscovery.js';

export type ProviderRuntimeConfigResolution = {
  config: RuntimeTomlConfig;
  warnings: string[];
  endpoint?: OpenAiCompatEndpointConfig;
};

export type PreparedProviderExecution = {
  runtimeSelection: RuntimeProviderSelection;
  executionProvider: ChatDefaultProvider;
  executionModel: string;
  executionUsesEndpoint: boolean;
  endpointId?: string;
  openAiCompatEndpoint?: OpenAiCompatEndpointConfig;
  runtimeConfig?: RuntimeTomlConfig;
  warnings: string[];
};

const uniqueWarnings = (...groups: Array<string[] | undefined>) =>
  Array.from(
    new Set(
      groups.flatMap((group) =>
        (group ?? []).filter(
          (warning): warning is string =>
            typeof warning === 'string' && warning.trim().length > 0,
        ),
      ),
    ),
  );

export const buildRuntimeSelectionWarning = (params: {
  executionPath: RuntimeProviderSelectionPath;
  fallbackApplied?: boolean;
  requestedProvider: ChatDefaultProvider;
  executionProvider: ChatDefaultProvider;
  requestedModel: string;
  executionModel: string;
  endpointId?: string;
  endpointReason?: string;
  requestedReason?: string;
  fallbackReason?: string;
}) => {
  switch (params.executionPath) {
    case 'same_endpoint_repair':
      return `Requested model "${params.requestedModel}" was unavailable on endpoint "${params.endpointId ?? 'unknown'}"; using "${params.executionModel}" instead.`;
    case 'same_provider_native_fallback':
      if (!params.fallbackApplied) {
        return undefined;
      }
      if (!params.endpointId) {
        return `Requested provider "${params.requestedProvider}" was unavailable; using native ${params.executionProvider} model "${params.executionModel}".`;
      }
      return `Endpoint "${params.endpointId ?? 'unknown'}" was unavailable; falling back to native ${params.executionProvider} model "${params.executionModel}".`;
    case 'cross_provider_fallback':
      if (!params.endpointId) {
        return `Requested provider "${params.requestedProvider}" was unavailable; fell back to provider "${params.executionProvider}" model "${params.executionModel}".`;
      }
      return `Endpoint "${params.endpointId ?? 'unknown'}" was unavailable; fell back to provider "${params.executionProvider}" model "${params.executionModel}".`;
    case 'unavailable':
      return (
        params.endpointReason ??
        params.requestedReason ??
        params.fallbackReason ??
        (params.endpointId
          ? `Endpoint "${params.endpointId}" is unavailable.`
          : `Provider "${params.requestedProvider}" is unavailable.`)
      );
    case 'configured_endpoint':
    default:
      return undefined;
  }
};

const cloneRuntimeConfigWithModel = (
  runtimeConfig: RuntimeTomlConfig,
  modelId: string,
): RuntimeTomlConfig => ({
  ...(runtimeConfig as Record<string, unknown>),
  model: modelId,
}) as RuntimeTomlConfig;

export function resolveOpenAiCompatEndpointById(params: {
  provider: Extract<ChatDefaultProvider, 'codex' | 'copilot'>;
  endpointId?: string | null;
  configuredEndpoint?: OpenAiCompatEndpointConfig;
  env?: NodeJS.ProcessEnv;
  pathLabel?: string;
}): OpenAiCompatEndpointConfig | undefined {
  const normalizedEndpointId = params.endpointId?.trim();
  if (!normalizedEndpointId) {
    return undefined;
  }

  const envResolution = resolveExternalOpenAiCompatEndpoints({
    env: params.env ?? process.env,
  });
  const endpoint = [
    ...(params.configuredEndpoint ? [params.configuredEndpoint] : []),
    ...envResolution.endpoints,
  ].find((entry) => entry.endpointId === normalizedEndpointId);
  if (!endpoint) {
    return undefined;
  }

  validateOpenAiCompatEndpointConfigForProvider({
    endpoint,
    provider: params.provider,
    pathLabel: params.pathLabel ?? 'selectedEndpointId',
  });
  return endpoint;
}

export async function prepareProviderExecution(params: {
  requestedProvider: ChatDefaultProvider;
  requestedModel: string;
  providerStates: Record<ChatDefaultProvider, RuntimeProviderState>;
  loadRuntimeConfig: (
    provider: Extract<ChatDefaultProvider, 'codex' | 'copilot'>,
  ) => Promise<ProviderRuntimeConfigResolution>;
  selectedEndpoint?: OpenAiCompatEndpointConfig;
  selectedEndpointId?: string | null;
  allowCrossProviderFallback?: boolean;
  failInPlaceOnEndpointUnavailable?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<PreparedProviderExecution> {
  let requestedRuntimeResolution: ProviderRuntimeConfigResolution | undefined;
  let requestedRuntimeWarnings: string[] = [];
  if (
    params.requestedProvider === 'codex' ||
    params.requestedProvider === 'copilot'
  ) {
    try {
      requestedRuntimeResolution = await params.loadRuntimeConfig(
        params.requestedProvider,
      );
      requestedRuntimeWarnings = requestedRuntimeResolution.warnings;
    } catch {
      // Keep endpoint resolution best-effort so native or fallback selection can continue.
    }
  }

  const selectedEndpointId = params.selectedEndpointId?.trim() || undefined;
  const configuredEndpoint =
    params.selectedEndpoint ?? requestedRuntimeResolution?.endpoint;
  const effectiveEndpoint =
    selectedEndpointId &&
    (params.requestedProvider === 'codex' ||
      params.requestedProvider === 'copilot')
      ? resolveOpenAiCompatEndpointById({
          provider: params.requestedProvider,
          endpointId: selectedEndpointId,
          configuredEndpoint,
          env: params.env,
        })
      : configuredEndpoint;
  const effectiveEndpointId = selectedEndpointId ?? effectiveEndpoint?.endpointId;
  const endpointState =
    effectiveEndpoint !== undefined
      ? await resolveOpenAiCompatEndpointRuntimeState({
          endpoint: effectiveEndpoint,
          provider:
            params.requestedProvider === 'codex' ||
            params.requestedProvider === 'copilot'
              ? params.requestedProvider
              : undefined,
        })
      : effectiveEndpointId
        ? {
            endpointId: effectiveEndpointId,
            available: false,
            models: [],
            reason: `Endpoint "${effectiveEndpointId}" is unavailable.`,
          }
        : undefined;

  const runtimeSelection = resolveRuntimeProviderSelection({
    requestedProvider: params.requestedProvider,
    requestedModel: params.requestedModel,
    endpoint: endpointState,
    failInPlaceOnEndpointUnavailable:
      params.failInPlaceOnEndpointUnavailable ?? false,
    allowCrossProviderFallback: params.allowCrossProviderFallback ?? true,
    codex: params.providerStates.codex,
    copilot: params.providerStates.copilot,
    lmstudio: params.providerStates.lmstudio,
  });

  const executionProvider = runtimeSelection.executionProvider;
  const executionModel = runtimeSelection.executionModel;
  const executionUsesEndpoint =
    runtimeSelection.executionPath === 'configured_endpoint' ||
    runtimeSelection.executionPath === 'same_endpoint_repair';

  let executionRuntimeResolution: ProviderRuntimeConfigResolution | undefined;
  if (executionProvider === 'codex' || executionProvider === 'copilot') {
    if (
      requestedRuntimeResolution &&
      executionProvider === params.requestedProvider
    ) {
      executionRuntimeResolution = requestedRuntimeResolution;
    } else {
      executionRuntimeResolution = await params.loadRuntimeConfig(
        executionProvider,
      );
    }
  }

  const endpointId = executionUsesEndpoint
    ? runtimeSelection.endpointId
    : undefined;
  const runtimeConfig =
    executionProvider === 'codex' &&
    endpointId &&
    effectiveEndpoint &&
    executionRuntimeResolution
      ? applyCodexOpenAiCompatEndpointToRuntimeConfig(
          executionRuntimeResolution.config as CodexOptions['config'],
          effectiveEndpoint,
          {
            env: params.env,
            modelId: executionModel,
          },
        )
      : executionRuntimeResolution?.config;
  const runtimeSelectionWarning = buildRuntimeSelectionWarning({
    executionPath: runtimeSelection.executionPath,
    fallbackApplied: runtimeSelection.fallbackApplied,
    requestedProvider: runtimeSelection.requestedProvider,
    executionProvider: runtimeSelection.executionProvider,
    requestedModel: runtimeSelection.requestedModel,
    executionModel: runtimeSelection.executionModel,
    endpointId: runtimeSelection.endpointId,
    endpointReason: runtimeSelection.endpointReason,
    requestedReason: runtimeSelection.requestedReason,
    fallbackReason: runtimeSelection.fallbackReason,
  });

  return {
    runtimeSelection,
    executionProvider,
    executionModel,
    executionUsesEndpoint,
    endpointId,
    openAiCompatEndpoint:
      (executionProvider === 'codex' || executionProvider === 'copilot') &&
      endpointId &&
      effectiveEndpoint?.endpointId === endpointId
        ? effectiveEndpoint
        : undefined,
    runtimeConfig:
      runtimeConfig !== undefined
        ? cloneRuntimeConfigWithModel(runtimeConfig, executionModel)
        : runtimeConfig,
    warnings: uniqueWarnings(
      requestedRuntimeWarnings,
      executionRuntimeResolution?.warnings,
      runtimeSelectionWarning ? [runtimeSelectionWarning] : undefined,
    ),
  };
}
