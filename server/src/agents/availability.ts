import type { ChatProviderId } from '@codeinfo2/common';
import {
  LMStudioClient,
  type LMStudioClientConstructorOpts,
} from '@lmstudio/sdk';

import { resolveAgentProviderFallbackOrder } from '../config/startupEnv.js';
import { disposeClient } from '../lmstudio/clientPool.js';
import {
  getCodexDetection,
  type CodexDetection,
} from '../providers/codexRegistry.js';
import {
  resolveCopilotReadiness,
  type CopilotReadinessOptions,
  type CopilotReadinessResult,
  type CopilotReadinessRuntime,
} from '../providers/copilotReadiness.js';
import { getMcpStatus } from '../providers/mcpStatus.js';
import {
  enterTestOverrideScope,
  getScopedAgentAvailabilityDepsOverride,
  hasActiveTestOverrideScope,
} from '../test/support/testOverrideScope.js';

import { readAgentRequestedProviderMetadata } from './config.js';

const BASE_URL_REGEX = /^(https?|wss?):\/\//i;

export type AgentAvailabilityWarningCode =
  | 'duplicate_root'
  | 'discovery_warning'
  | 'invalid_provider'
  | 'provider_unavailable'
  | 'fallback_provider';

export type AgentDisabledReasonCode =
  | 'invalid_provider'
  | 'provider_unavailable'
  | 'agent_not_found';

export type AgentAvailabilityWarning = {
  code: AgentAvailabilityWarningCode;
  message: string;
  visibility: 'list' | 'details';
  providerId?: string;
  fallbackProviderId?: ChatProviderId;
};

export type AgentDisabledReason = {
  code: AgentDisabledReasonCode;
  message: string;
  providerId?: string;
};

export type AgentAvailabilityFallbackCandidate = {
  providerId: ChatProviderId;
  available: boolean;
  reason?: string;
};

export type AgentAvailabilitySnapshot = {
  requestedProviderId?: string;
  executionProviderId?: ChatProviderId;
  fallbackCandidates: AgentAvailabilityFallbackCandidate[];
  warnings: AgentAvailabilityWarning[];
  disabled: boolean;
  disabledReason?: AgentDisabledReason;
};

type ProviderAvailabilityState = {
  providerId: ChatProviderId;
  available: boolean;
  reason?: string;
};

type AvailabilityContext = {
  providerStates: Record<ChatProviderId, ProviderAvailabilityState>;
  fallbackCandidates: AgentAvailabilityFallbackCandidate[];
};

type AvailabilityDeps = {
  getCodexDetection: () => CodexDetection;
  getMcpStatus: typeof getMcpStatus;
  resolveCopilotReadiness: (
    options: CopilotReadinessOptions,
  ) => Promise<CopilotReadinessResult>;
  copilotRuntimeFactory?: () => CopilotReadinessRuntime;
  resolveAgentProviderFallbackOrder: typeof resolveAgentProviderFallbackOrder;
  readAgentRequestedProviderMetadata: typeof readAgentRequestedProviderMetadata;
  lmstudioClientFactory: (baseUrl: string) => LMStudioClient;
  getLmStudioBaseUrl: () => string | undefined;
};

const availabilityDeps: AvailabilityDeps = {
  getCodexDetection,
  getMcpStatus,
  resolveCopilotReadiness,
  resolveAgentProviderFallbackOrder,
  readAgentRequestedProviderMetadata,
  lmstudioClientFactory: (baseUrl: string) =>
    new LMStudioClient({
      baseUrl,
    } as LMStudioClientConstructorOpts),
  getLmStudioBaseUrl: () => process.env.CODEINFO_LMSTUDIO_BASE_URL,
};

const getEffectiveAvailabilityDeps = (): AvailabilityDeps => {
  const scoped =
    getScopedAgentAvailabilityDepsOverride() as Partial<AvailabilityDeps> | undefined;
  if (!scoped) {
    return availabilityDeps;
  }
  return {
    ...availabilityDeps,
    ...scoped,
  };
};

const isChatProviderId = (value: string): value is ChatProviderId =>
  value === 'codex' || value === 'copilot' || value === 'lmstudio';

const toWebSocketUrl = (value: string) => {
  if (value.startsWith('http://')) return value.replace(/^http:/iu, 'ws:');
  if (value.startsWith('https://')) return value.replace(/^https:/iu, 'wss:');
  return value;
};

const isChatModel = (model: { type?: string; architecture?: string }) => {
  const kind = (model.type ?? '').toLowerCase();
  return kind !== 'embedding' && kind !== 'vector';
};

const mapDiscoveryWarning = (message: string): AgentAvailabilityWarning => ({
  code: /exists in both codeinfo_agents and codex_agents/iu.test(message)
    ? 'duplicate_root'
    : 'discovery_warning',
  message,
  visibility: /exists in both codeinfo_agents and codex_agents/iu.test(message)
    ? 'list'
    : 'details',
});

const buildInvalidProviderMessage = (requestedProviderId: string) =>
  `Agent config requested unsupported provider "${requestedProviderId}".`;

const buildProviderUnavailableMessage = (
  providerId: string,
  reason?: string,
) =>
  reason
    ? `Provider "${providerId}" is unavailable: ${reason}.`
    : `Provider "${providerId}" is unavailable.`;

const buildFallbackWarningMessage = (params: {
  requestedProviderId: string;
  fallbackProviderId: ChatProviderId;
}) =>
  `Agent will use fallback provider "${params.fallbackProviderId}" because "${params.requestedProviderId}" cannot execute.`;

const buildDisabledReason = (params: {
  code: AgentDisabledReasonCode;
  providerId?: string;
  message: string;
}): AgentDisabledReason => ({
  code: params.code,
  ...(params.providerId ? { providerId: params.providerId } : {}),
  message: params.message,
});

async function resolveLmStudioAvailability(
  deps: AvailabilityDeps,
): Promise<ProviderAvailabilityState> {
  const baseUrl = deps.getLmStudioBaseUrl()?.trim();
  if (!baseUrl || !BASE_URL_REGEX.test(baseUrl)) {
    return {
      providerId: 'lmstudio',
      available: false,
      reason: 'lmstudio unavailable',
    };
  }

  try {
    const client = deps.lmstudioClientFactory(toWebSocketUrl(baseUrl));
    try {
      const models = await client.system.listDownloadedModels();
      const available = models.some(isChatModel);
      return {
        providerId: 'lmstudio',
        available,
        reason: available ? undefined : 'lmstudio unavailable',
      };
    } finally {
      await disposeClient(client);
    }
  } catch (error) {
    return {
      providerId: 'lmstudio',
      available: false,
      reason: (error as Error)?.message ?? 'lmstudio unavailable',
    };
  }
}

export async function createAgentAvailabilityContext(): Promise<AvailabilityContext> {
  const deps = getEffectiveAvailabilityDeps();
  const codexDetection = deps.getCodexDetection();
  const mcp = await deps.getMcpStatus();
  const [copilotReadiness, lmstudioState] = await Promise.all([
    deps.resolveCopilotReadiness({
      createRuntime: deps.copilotRuntimeFactory,
      env: process.env,
      toolsAvailable: mcp.available,
      toolsReason: mcp.reason,
    }),
    resolveLmStudioAvailability(deps),
  ]);

  const providerStates: Record<ChatProviderId, ProviderAvailabilityState> = {
    codex: {
      providerId: 'codex',
      available: codexDetection.available,
      reason: codexDetection.reason ?? 'codex unavailable',
    },
    copilot: {
      providerId: 'copilot',
      available: copilotReadiness.available,
      reason: copilotReadiness.reason ?? 'copilot unavailable',
    },
    lmstudio: lmstudioState,
  };

  const fallbackOrder = deps.resolveAgentProviderFallbackOrder();
  const fallbackCandidates = fallbackOrder.normalizedProviders.map(
    (providerId) => ({
      providerId,
      available: providerStates[providerId].available,
      reason: providerStates[providerId].reason,
    }),
  );

  return {
    providerStates,
    fallbackCandidates,
  };
}

const resolveFallbackExecutionProvider = (params: {
  requestedProviderId: string;
  context: AvailabilityContext;
  excludeProviderId?: ChatProviderId;
}) => {
  const candidates = params.context.fallbackCandidates.filter(
    (candidate) => candidate.providerId !== params.excludeProviderId,
  );
  const winner = candidates.find((candidate) => candidate.available);
  return {
    candidates,
    executionProviderId: winner?.providerId,
  };
};

export async function evaluateAgentAvailability(params: {
  agentName: string;
  configPath: string;
  discoveryWarnings?: string[];
  entrypoint?: 'agents.service' | 'flows.service';
  context?: AvailabilityContext;
}): Promise<AgentAvailabilitySnapshot> {
  const deps = getEffectiveAvailabilityDeps();
  const context = params.context ?? (await createAgentAvailabilityContext());
  const requestedMetadata = await deps.readAgentRequestedProviderMetadata({
    configPath: params.configPath,
  });

  const warnings = (params.discoveryWarnings ?? []).map(mapDiscoveryWarning);
  const requestedProviderId = requestedMetadata.requestedProviderId;
  for (const message of requestedMetadata.warnings) {
    warnings.push({
      code: 'discovery_warning',
      message,
      visibility: 'details',
    });
  }

  if (requestedProviderId && !isChatProviderId(requestedProviderId)) {
    warnings.push({
      code: 'invalid_provider',
      message: buildInvalidProviderMessage(requestedProviderId),
      visibility: 'details',
      providerId: requestedProviderId,
    });

    const { candidates, executionProviderId } =
      resolveFallbackExecutionProvider({
        requestedProviderId,
        context,
      });

    if (executionProviderId) {
      warnings.push({
        code: 'fallback_provider',
        message: buildFallbackWarningMessage({
          requestedProviderId,
          fallbackProviderId: executionProviderId,
        }),
        visibility: 'details',
        providerId: requestedProviderId,
        fallbackProviderId: executionProviderId,
      });
      return {
        requestedProviderId,
        executionProviderId,
        fallbackCandidates: candidates,
        warnings,
        disabled: false,
      };
    }

    return {
      requestedProviderId,
      fallbackCandidates: candidates,
      warnings,
      disabled: true,
      disabledReason: buildDisabledReason({
        code: 'invalid_provider',
        providerId: requestedProviderId,
        message:
          'No configured fallback provider is currently available for this agent.',
      }),
    };
  }

  const requestedChatProvider =
    requestedProviderId && isChatProviderId(requestedProviderId)
      ? requestedProviderId
      : requestedMetadata.providerId;
  const requestedState = context.providerStates[requestedChatProvider];
  const { candidates, executionProviderId } = resolveFallbackExecutionProvider({
    requestedProviderId: requestedChatProvider,
    context,
    excludeProviderId: requestedChatProvider,
  });

  if (requestedState.available) {
    return {
      requestedProviderId,
      executionProviderId: requestedChatProvider,
      fallbackCandidates: candidates,
      warnings,
      disabled: false,
    };
  }

  warnings.push({
    code: 'provider_unavailable',
    message: buildProviderUnavailableMessage(
      requestedChatProvider,
      requestedState.reason,
    ),
    visibility: 'details',
    providerId: requestedChatProvider,
  });

  if (executionProviderId) {
    warnings.push({
      code: 'fallback_provider',
      message: buildFallbackWarningMessage({
        requestedProviderId: requestedChatProvider,
        fallbackProviderId: executionProviderId,
      }),
      visibility: 'details',
      providerId: requestedChatProvider,
      fallbackProviderId: executionProviderId,
    });
    return {
      requestedProviderId,
      executionProviderId,
      fallbackCandidates: candidates,
      warnings,
      disabled: false,
    };
  }

  return {
    requestedProviderId,
    fallbackCandidates: candidates,
    warnings,
    disabled: true,
    disabledReason: buildDisabledReason({
      code: 'provider_unavailable',
      providerId: requestedChatProvider,
      message: buildProviderUnavailableMessage(
        requestedChatProvider,
        requestedState.reason,
      ),
    }),
  };
}

export function __setAgentAvailabilityDepsForTests(
  overrides: Partial<AvailabilityDeps>,
) {
  if (hasActiveTestOverrideScope()) {
    enterTestOverrideScope({
      agentAvailabilityDeps: overrides as Record<string, unknown>,
    });
    return;
  }
  Object.assign(availabilityDeps, overrides);
}

export function __resetAgentAvailabilityDepsForTests() {
  if (hasActiveTestOverrideScope()) {
    enterTestOverrideScope({
      agentAvailabilityDeps: null,
    });
    return;
  }
  availabilityDeps.getCodexDetection = getCodexDetection;
  availabilityDeps.getMcpStatus = getMcpStatus;
  availabilityDeps.resolveCopilotReadiness = resolveCopilotReadiness;
  availabilityDeps.copilotRuntimeFactory = undefined;
  availabilityDeps.resolveAgentProviderFallbackOrder =
    resolveAgentProviderFallbackOrder;
  availabilityDeps.readAgentRequestedProviderMetadata =
    readAgentRequestedProviderMetadata;
  availabilityDeps.lmstudioClientFactory = (baseUrl: string) =>
    new LMStudioClient({
      baseUrl,
    } as LMStudioClientConstructorOpts);
  availabilityDeps.getLmStudioBaseUrl = () =>
    process.env.CODEINFO_LMSTUDIO_BASE_URL;
}

export function toAgentListWarnings(snapshot: AgentAvailabilitySnapshot) {
  return snapshot.warnings
    .filter((warning) => warning.visibility === 'list')
    .map((warning) => warning.message);
}

export function toAgentLaunchWarnings(snapshot: AgentAvailabilitySnapshot) {
  return Array.from(
    new Set(snapshot.warnings.map((warning) => warning.message)),
  );
}
