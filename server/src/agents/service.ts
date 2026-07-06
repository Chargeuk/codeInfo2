import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { ChatProviderId } from '@codeinfo2/common';
import type { ModelInfo } from '@github/copilot-sdk';
import {
  LMStudioClient,
  type LMStudioClientConstructorOpts,
} from '@lmstudio/sdk';
import type { CodexOptions } from '@openai/codex-sdk';

import { buildConversationFlags } from '../chat/agentFlags.js';
import { attachChatStreamBridge } from '../chat/chatStreamBridge.js';
import {
  findRunnableCopilotModel,
  normalizeImplicitCopilotRequestedModel,
} from '../chat/copilotModelSupport.js';
import { UnsupportedProviderError, getChatInterface } from '../chat/factory.js';
import {
  createInflight,
  abortInflight,
  bindPendingConversationCancelToInflight,
  cleanupInflight,
  cleanupPendingConversationCancel,
  consumePendingConversationCancel,
  getInflight,
  markInflightPersisted,
} from '../chat/inflightRegistry.js';
import { ChatInterface } from '../chat/interfaces/ChatInterface.js';
import type {
  ChatAnalysisEvent,
  ChatFinalEvent,
  ChatToolResultEvent,
} from '../chat/interfaces/ChatInterface.js';
import {
  getMemoryTurns,
  memoryConversations,
  recordMemoryTurn,
  shouldUseMemoryPersistence,
  updateMemoryConversationMeta,
  updateMemoryConversationWorkingFolder,
} from '../chat/memoryPersistence.js';
import { shouldForceUnslothBuiltInWebSearch } from '../chat/openAiCompatBuiltInWebSearch.js';
import { resolveOpenAiCompatEndpointRuntimeState } from '../chat/openaiCompatModelDiscovery.js';
import { buildRuntimeSelectionWarning } from '../chat/providerExecution.js';
import { McpResponder } from '../chat/responders/McpResponder.js';
import { resolveCodexCapabilities } from '../codex/capabilityResolver.js';
import {
  resolveChatDefaults,
  resolveRuntimeProviderSelection,
  type ChatDefaultProvider,
  type RuntimeProviderSelectionPath,
} from '../config/chatDefaults.js';
import {
  applyCodexOpenAiCompatEndpointToRuntimeConfig,
} from '../config/codexConfig.js';
import { type OpenAiCompatEndpointConfig } from '../config/openaiCompatEndpoints.js';
import {
  RuntimeConfigResolutionError,
  getProviderBootstrapStatus,
  resolveAgentRuntimeConfig,
} from '../config/runtimeConfig.js';
import {
  resolveAgentProviderFallbackOrder,
  resolveExternalOpenAiCompatEndpoints,
} from '../config/startupEnv.js';
import {
  buildRepositoryCandidateLookupSummary,
  buildRepositoryCandidateOrderLogContext,
  buildRepositoryCandidateOrder,
  DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER,
  normalizeRepositoryCandidateLabel,
  type RepositoryCandidateLookupSummary,
  type RepositoryCandidateOrderResult,
  type RepositoryCandidateOrderSlot,
} from '../flows/repositoryCandidateOrder.js';
import { disposeClient } from '../lmstudio/clientPool.js';
import {
  listIngestedRepositories,
  resolveRepoEmbeddingIdentity,
  type RepoEntry,
} from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import { appendRepoBackedTransitiveConsumerLogs } from '../logging/transitiveConsumerMarkers.js';
import { ConversationModel } from '../mongo/conversation.js';
import type {
  Conversation,
  ConversationProvider,
} from '../mongo/conversation.js';
import {
  appendTurn,
  createConversation,
  updateConversationMeta,
  updateConversationWorkingFolder,
} from '../mongo/repo.js';
import type {
  Turn,
  TurnCommandMetadata,
  TurnRuntimeMetadata,
  TurnSource,
} from '../mongo/turn.js';
import { TurnModel } from '../mongo/turn.js';
import { getCodexDetection } from '../providers/codexRegistry.js';
import { resolveCopilotReadiness } from '../providers/copilotReadiness.js';
import { getMcpStatus } from '../providers/mcpStatus.js';
import {
  enterTestOverrideScope,
  getScopedAgentServiceDepsOverride,
  getScopedEnvValue,
  hasActiveTestOverrideScope,
} from '../test/support/testOverrideScope.js';
import {
  resolveSharedExecutionContext,
  resolveWorkingFolderWorkingDirectory,
  type RepositoryExecutionContextMetadata,
  type SharedExecutionContext,
} from '../workingFolders/executionContext.js';
import {
  appendWorkingFolderDecisionLog,
  getConversationRecordType,
  knownRepositoryPathsUnavailable,
  knownRepositoryPathsAvailable,
  restoreSavedWorkingFolder,
  validateRequestedWorkingFolder,
} from '../workingFolders/state.js';
import { publishUserTurn } from '../ws/server.js';

import {
  createAgentAvailabilityContext,
  evaluateAgentAvailability,
  toAgentLaunchWarnings,
  toAgentListWarnings,
} from './availability.js';
import {
  loadAgentCommandFile,
  loadAgentCommandSummary,
} from './commandsLoader.js';
import { runAgentCommandRunner } from './commandsRunner.js';
import { readAgentRequestedProviderMetadata } from './config.js';
import { discoverAgents } from './discovery.js';
import { resolveAgentHomeForRepository } from './roots.js';
import {
  getActiveRunOwnership,
  releaseConversationLock,
  tryAcquireConversationLock,
} from './runLock.js';
import type { AgentDetails, AgentSummary } from './types.js';

const agentRuntimeDiagnosticsEnabled =
  process.env.CODEINFO_TEST_RUNTIME_DIAGNOSTICS === '1';

const appendAgentRuntimeDiagnostic = (
  message: string,
  context: Record<string, unknown>,
) => {
  if (!agentRuntimeDiagnosticsEnabled) return;
  append({
    level: 'info',
    message,
    timestamp: new Date().toISOString(),
    source: 'server',
    context,
  });
};

export async function listAgents(): Promise<{ agents: AgentSummary[] }> {
  const discovered = await discoverAgents();
  const availabilityContext = await createAgentAvailabilityContext();
  const agents = await Promise.all(
    discovered.map(async (agent) => {
      const availability = await evaluateAgentAvailability({
        agentName: agent.name,
        configPath: agent.configPath,
        discoveryWarnings: agent.warnings,
        entrypoint: 'agents.service',
        context: availabilityContext,
      });
      const warnings = toAgentListWarnings(availability);
      return {
        name: agent.name,
        description: agent.description,
        disabled: availability.disabled,
        warnings: warnings.length > 0 ? warnings : undefined,
        requestedProviderId: availability.requestedProviderId,
        executionProviderId: availability.executionProviderId,
      } satisfies AgentSummary;
    }),
  );
  return {
    agents,
  };
}

export async function getAgentDetails(
  agentName: string,
): Promise<AgentDetails> {
  const discovered = await discoverAgents();
  const selected = discovered.find((agent) => agent.name === agentName);
  if (!selected) {
    const error = new Error(`Agent "${agentName}" not found`) as Error & {
      code?: string;
    };
    error.code = 'AGENT_NOT_FOUND';
    throw error;
  }

  const availability = await evaluateAgentAvailability({
    agentName: selected.name,
    configPath: selected.configPath,
    discoveryWarnings: selected.warnings,
    entrypoint: 'agents.service',
  });

  return {
    name: selected.name,
    description: selected.description,
    disabled: availability.disabled,
    warnings: availability.warnings,
    fallbackCandidates: availability.fallbackCandidates,
    disabledReason: availability.disabledReason,
    requestedProviderId: availability.requestedProviderId,
    executionProviderId: availability.executionProviderId,
  };
}

export type RunAgentInstructionParams = {
  agentName: string;
  instruction: string;
  working_folder?: string;
  conversationId?: string;
  signal?: AbortSignal;
  source: 'REST' | 'MCP';
  inflightId?: string;
  chatFactory?: typeof getChatInterface;
};

export type RunAgentInstructionResult = {
  agentName: string;
  conversationId: string;
  providerId: ChatProviderId;
  modelId: string;
  segments: unknown[];
  warnings?: string[];
};

type AgentServiceDeps = {
  listIngestedRepositories: typeof listIngestedRepositories;
  getCodexDetection: typeof getCodexDetection;
  resolveCodexCapabilities: typeof resolveCodexCapabilities;
  getMcpStatus: typeof getMcpStatus;
  resolveCopilotReadiness: typeof resolveCopilotReadiness;
  resolveAgentProviderFallbackOrder: typeof resolveAgentProviderFallbackOrder;
  createAgentAvailabilityContext: typeof createAgentAvailabilityContext;
  evaluateAgentAvailability: typeof evaluateAgentAvailability;
  lmstudioClientFactory: (baseUrl: string) => LMStudioClient;
  getLmStudioBaseUrl: () => string | undefined;
};

type InstructionRuntimeCleanupFn = typeof cleanupInflight;
type InstructionReleaseLockFn = typeof releaseConversationLock;

type RunAgentErrorCode =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_DISABLED'
  | 'CONVERSATION_ARCHIVED'
  | 'AGENT_MISMATCH'
  | 'RUN_IN_PROGRESS'
  | 'COMMAND_NOT_FOUND'
  | 'COMMAND_INVALID'
  | 'INVALID_START_STEP'
  | 'INVALID_PROVIDER'
  | 'PROVIDER_UNAVAILABLE'
  | 'WORKING_FOLDER_INVALID'
  | 'WORKING_FOLDER_NOT_FOUND'
  | 'WORKING_FOLDER_UNAVAILABLE'
  | 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE';

type RunAgentError = {
  code: RunAgentErrorCode;
  reason?: string;
  causeCode?: string;
  providerId?: ChatProviderId;
  requestedProviderId?: string;
};

const toRunAgentError = (
  code: RunAgentErrorCode,
  reason?: string,
  causeCode?: string,
) =>
  ({
    code,
    ...(reason ? { reason } : {}),
    ...(causeCode ? { causeCode } : {}),
  }) satisfies RunAgentError;

const T06_ERROR_LOG =
  '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=error';
const T06_SUCCESS_LOG =
  '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=success';
const T07_SUCCESS_LOG =
  '[DEV-0000037][T07] event=runtime_overrides_applied_flow_mcp result=success';
const T07_ERROR_LOG =
  '[DEV-0000037][T07] event=runtime_overrides_applied_flow_mcp result=error';
const agentServiceDeps: AgentServiceDeps = {
  listIngestedRepositories,
  getCodexDetection,
  resolveCodexCapabilities,
  getMcpStatus,
  resolveCopilotReadiness,
  resolveAgentProviderFallbackOrder,
  createAgentAvailabilityContext,
  evaluateAgentAvailability,
  lmstudioClientFactory: (baseUrl: string) =>
    new LMStudioClient({
      baseUrl,
    } as LMStudioClientConstructorOpts),
  getLmStudioBaseUrl: () => getScopedEnvValue('CODEINFO_LMSTUDIO_BASE_URL'),
};

const getEffectiveAgentServiceDeps = (): AgentServiceDeps => {
  const scoped =
    getScopedAgentServiceDepsOverride() as Partial<AgentServiceDeps> | undefined;
  if (!scoped) {
    return agentServiceDeps;
  }
  return {
    ...agentServiceDeps,
    ...scoped,
  };
};

export function __setAgentServiceDepsForTests(
  overrides: Partial<AgentServiceDeps>,
) {
  if (hasActiveTestOverrideScope()) {
    enterTestOverrideScope({
      agentServiceDeps: overrides as Record<string, unknown>,
    });
    return;
  }
  Object.assign(agentServiceDeps, overrides);
}

export function __resetAgentServiceDepsForTests() {
  if (hasActiveTestOverrideScope()) {
    enterTestOverrideScope({
      agentServiceDeps: null,
    });
    return;
  }
  agentServiceDeps.listIngestedRepositories = listIngestedRepositories;
  agentServiceDeps.getCodexDetection = getCodexDetection;
  agentServiceDeps.resolveCodexCapabilities = resolveCodexCapabilities;
  agentServiceDeps.getMcpStatus = getMcpStatus;
  agentServiceDeps.resolveCopilotReadiness = resolveCopilotReadiness;
  agentServiceDeps.resolveAgentProviderFallbackOrder =
    resolveAgentProviderFallbackOrder;
  agentServiceDeps.createAgentAvailabilityContext =
    createAgentAvailabilityContext;
  agentServiceDeps.evaluateAgentAvailability = evaluateAgentAvailability;
  agentServiceDeps.lmstudioClientFactory = (baseUrl: string) =>
    new LMStudioClient({
      baseUrl,
    } as LMStudioClientConstructorOpts);
  agentServiceDeps.getLmStudioBaseUrl = () =>
    getScopedEnvValue('CODEINFO_LMSTUDIO_BASE_URL');
}

type DirectAgentProviderState = {
  available: boolean;
  models: string[];
  reason?: string;
  modelsRaw?: ModelInfo[];
};

type DirectAgentPreparedExecution = {
  requestedProviderId?: string;
  executionProviderId: ChatProviderId;
  modelId: string;
  endpointId?: string;
  openAiCompatEndpoint?: OpenAiCompatEndpointConfig;
  runtimePath?: RuntimeProviderSelectionPath;
  runtimeConfig: CodexOptions['config'];
  warnings: string[];
  availability: Awaited<ReturnType<typeof evaluateAgentAvailability>>;
  executionContext: SharedExecutionContext;
  repositoryContext: RepositoryExecutionContextMetadata;
  workingDirectoryOverride?: string;
  copilotModels: ModelInfo[];
};

const BASE_URL_REGEX = /^(https?|wss?):\/\//i;

const isChatProviderId = (value: string): value is ChatProviderId =>
  value === 'codex' || value === 'copilot' || value === 'lmstudio';

const toWsBaseUrl = (value: string) => {
  if (value.startsWith('http://')) return value.replace(/^http:/iu, 'ws:');
  if (value.startsWith('https://')) return value.replace(/^https:/iu, 'wss:');
  return value;
};

const isChatModel = (model: { type?: string; architecture?: string }) => {
  const kind = (model.type ?? '').toLowerCase();
  return kind !== 'embedding' && kind !== 'vector';
};

const normalizeModel = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;

const uniqueModels = (models: Array<string | undefined>) => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const candidate of models) {
    const normalized = normalizeModel(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
};

const mergeWarningMessages = (...groups: Array<string[] | undefined>) =>
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

const cloneRuntimeConfigWithModel = (
  runtimeConfig: CodexOptions['config'],
  modelId: string,
): CodexOptions['config'] => {
  const next =
    runtimeConfig && typeof runtimeConfig === 'object'
      ? { ...(runtimeConfig as Record<string, unknown>) }
      : {};
  next.model = modelId;
  return next as CodexOptions['config'];
};

const getSavedRequestedProviderId = (
  conversation: Conversation | null | undefined,
): string | undefined => {
  const requestedProviderId = conversation?.flags?.requestedProviderId;
  return typeof requestedProviderId === 'string' &&
    requestedProviderId.trim().length > 0
    ? requestedProviderId.trim()
    : undefined;
};

async function loadTurnsChronological(conversationId: string): Promise<Turn[]> {
  return shouldUseMemoryPersistence()
    ? getMemoryTurns(conversationId)
    : ((await TurnModel.find({ conversationId })
        .sort({ createdAt: 1, _id: 1 })
        .lean()
        .exec()) as Turn[]);
}

async function persistDirectAgentConversation(params: {
  conversationId: string;
  existingConversation: Conversation | null;
  agentName: string;
  providerId: ConversationProvider;
  modelId: string;
  requestedProviderId?: string;
  endpointId?: string | null;
  title: string;
  source: 'REST' | 'MCP';
  workingFolder?: string;
  threadId?: string | null;
}): Promise<Conversation> {
  const now = new Date();
  const currentEndpointId =
    typeof params.existingConversation?.flags?.endpointId === 'string' &&
    params.existingConversation.flags.endpointId.trim().length > 0
      ? params.existingConversation.flags.endpointId.trim()
      : undefined;
  const nextEndpointId = params.endpointId?.trim() || undefined;
  const persistedThreadId =
    params.providerId === 'codex' &&
    params.threadId?.trim() &&
    currentEndpointId === nextEndpointId
      ? params.threadId.trim()
      : null;
  const flags = buildConversationFlags({
    provider: params.providerId,
    currentFlags: params.existingConversation?.flags,
    workingFolder: params.workingFolder,
    threadId: persistedThreadId,
    endpointId: params.endpointId,
  });
  const savedRequestedProviderId =
    params.requestedProviderId?.trim() ||
    getSavedRequestedProviderId(params.existingConversation);
  if (savedRequestedProviderId) {
    flags.requestedProviderId = savedRequestedProviderId;
  }

  if (shouldUseMemoryPersistence()) {
    const existing =
      params.existingConversation ??
      memoryConversations.get(params.conversationId) ??
      null;
    const next: Conversation = existing
      ? ({
          ...existing,
          provider: params.providerId,
          model: params.modelId,
          agentName: params.agentName,
          title: existing.title || params.title,
          source: existing.source ?? params.source,
          flags,
          lastMessageAt: now,
          updatedAt: now,
        } as Conversation)
      : ({
          _id: params.conversationId,
          provider: params.providerId,
          model: params.modelId,
          title: params.title,
          agentName: params.agentName,
          source: params.source,
          flags,
          lastMessageAt: now,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        } as Conversation);
    memoryConversations.set(params.conversationId, next);
    return next;
  }

  if (!params.existingConversation) {
    await createConversation({
      conversationId: params.conversationId,
      provider: params.providerId,
      model: params.modelId,
      title: params.title,
      agentName: params.agentName,
      source: params.source,
      flags,
      lastMessageAt: now,
    });
  } else {
  const metaOutcome = await updateConversationMeta({
    conversationId: params.conversationId,
    provider: params.providerId,
    model: params.modelId,
    flags,
    replaceFlags: true,
    lastMessageAt: now,
  });
  if (metaOutcome.outcome === 'not_found') {
    throw toRunAgentError('CONVERSATION_ARCHIVED');
  }
  if (metaOutcome.outcome === 'retry_exhausted') {
    throw new Error('agent conversation metadata update exhausted');
  }
  }

  const persisted = (await ConversationModel.findById(params.conversationId)
    .lean()
    .exec()) as Conversation | null;
  if (!persisted) {
    throw toRunAgentError('AGENT_NOT_FOUND');
  }
  return persisted;
}

async function collectDirectAgentProviderStates(): Promise<
  Record<ChatProviderId, DirectAgentProviderState>
> {
  const deps = getEffectiveAgentServiceDeps();
  const codexDetection = deps.getCodexDetection();
  const codexCapabilities = await deps.resolveCodexCapabilities({
    consumer: 'chat_validation',
  });
  const mcp = await deps.getMcpStatus();
  const [copilotReadiness, lmstudioState] = await Promise.all([
    deps.resolveCopilotReadiness({
      env: process.env,
      toolsAvailable: mcp.available,
      toolsReason: mcp.reason,
    }),
    (async (): Promise<DirectAgentProviderState> => {
      const baseUrl = deps.getLmStudioBaseUrl()?.trim();
      if (!baseUrl || !BASE_URL_REGEX.test(baseUrl)) {
        return {
          available: false,
          models: [],
          reason: 'lmstudio unavailable',
        };
      }
      try {
        const client = deps.lmstudioClientFactory(toWsBaseUrl(baseUrl));
        try {
          const models = await client.system.listDownloadedModels();
          const availableModels = models
            .filter(isChatModel)
            .map((entry) => normalizeModel(entry.modelKey))
            .filter((entry): entry is string => entry !== undefined);
          return {
            available: availableModels.length > 0,
            models: availableModels,
            reason:
              availableModels.length > 0 ? undefined : 'lmstudio unavailable',
          };
        } finally {
          await disposeClient(client);
        }
      } catch (error) {
        return {
          available: false,
          models: [],
          reason: (error as Error)?.message ?? 'lmstudio unavailable',
        };
      }
    })(),
  ]);

  return {
    codex: {
      available: codexDetection.available,
      models: codexCapabilities.models.map((entry) => entry.model),
      reason: codexDetection.reason ?? 'codex unavailable',
    },
    copilot: {
      available: copilotReadiness.available,
      models: copilotReadiness.models,
      modelsRaw: copilotReadiness.modelsRaw as ModelInfo[],
      reason: copilotReadiness.reason ?? 'copilot unavailable',
    },
    lmstudio: lmstudioState,
  };
}

const applyBootstrapStatusToDirectAgentProviderState = (
  provider: ChatProviderId,
  state: DirectAgentProviderState,
): DirectAgentProviderState => {
  const bootstrapStatus = getProviderBootstrapStatus(provider);
  if (bootstrapStatus.healthy) {
    return state;
  }
  return {
    ...state,
    available: false,
    reason:
      bootstrapStatus.reason ??
      `Provider "${provider}" is unavailable because startup bootstrap degraded.`,
  };
};

function enrichOpenAiCompatEndpointFromEnv(
  endpoint: OpenAiCompatEndpointConfig | undefined,
): OpenAiCompatEndpointConfig | undefined {
  if (!endpoint) {
    return undefined;
  }

  const envEndpoint = resolveExternalOpenAiCompatEndpoints({
    env: process.env,
  }).endpoints.find((entry) => entry.endpointId === endpoint.endpointId);

  if (!envEndpoint) {
    return endpoint;
  }

  return {
    ...endpoint,
    capabilities: envEndpoint.capabilities,
    displayLabel: envEndpoint.displayLabel ?? endpoint.displayLabel,
    authLookupKey: envEndpoint.authLookupKey ?? endpoint.authLookupKey,
    supportsBuiltInWebSearch:
      envEndpoint.supportsBuiltInWebSearch ?? endpoint.supportsBuiltInWebSearch,
  };
}

async function resolveProviderRuntimeConfig(params: {
  agentConfigPath: string;
  providerId: ChatProviderId;
}): Promise<{
  config: CodexOptions['config'];
  warnings: string[];
  endpoint?: OpenAiCompatEndpointConfig;
}> {
  const resolved = await resolveAgentRuntimeConfig({
    provider: params.providerId,
    agentConfigPath: params.agentConfigPath,
  });
  return {
    config: resolved.config as CodexOptions['config'],
    warnings: resolved.warnings.map((warning) => warning.message),
    endpoint: enrichOpenAiCompatEndpointFromEnv(
      resolved.appMetadata?.codeinfoOpenAiEndpoint,
    ),
  };
}

async function resolveProviderRuntimeConfigForExecution(params: {
  configPath: string;
  providerId: ChatProviderId;
  source: 'REST' | 'MCP';
  surface:
    | 'agents.run'
    | 'agents.commands.run'
    | 'mcp.agents.run'
    | 'flows.run';
}) {
  try {
    const resolved = await resolveProviderRuntimeConfig({
      agentConfigPath: params.configPath,
      providerId: params.providerId,
    });
    if (params.source === 'REST') {
      console.info(T06_SUCCESS_LOG, {
        surface: params.surface,
        source: params.source,
        providerId: params.providerId,
        hasModel:
          typeof (resolved.config as Record<string, unknown>)?.model ===
          'string',
      });
    } else {
      console.info(T07_SUCCESS_LOG, {
        surface: params.surface,
        source: params.source,
        providerId: params.providerId,
        hasModel:
          typeof (resolved.config as Record<string, unknown>)?.model ===
          'string',
      });
    }
    return resolved;
  } catch (error) {
    const code =
      error instanceof RuntimeConfigResolutionError
        ? error.code
        : 'UNKNOWN_ERROR';
    if (params.source === 'REST') {
      console.error(
        `${T06_ERROR_LOG} surface=${params.surface} source=${params.source} code=${code}`,
      );
    } else {
      console.error(
        `${T07_ERROR_LOG} surface=${params.surface} source=${params.source} code=${code}`,
      );
    }
    throw error;
  }
}

function resolveProviderModelForExecution(params: {
  providerId: ChatProviderId;
  requestedModel?: string;
  providerState: DirectAgentProviderState;
  preferConfiguredModel?: boolean;
}): string | null {
  if (!params.providerState.available) return null;
  const defaultModel = resolveChatDefaults({
    requestProvider: params.providerId as ChatDefaultProvider,
  }).model;
  const normalizedRequestedModel =
    params.providerId === 'copilot' &&
    Array.isArray(params.providerState.modelsRaw) &&
    params.requestedModel
      ? normalizeImplicitCopilotRequestedModel({
          models: params.providerState.modelsRaw,
          requestedModel: params.requestedModel,
          requestedModelSource: 'config',
        })
      : params.requestedModel;
  if (params.preferConfiguredModel && normalizedRequestedModel) {
    return normalizedRequestedModel;
  }
  const preferred =
    params.providerId === 'copilot' &&
    Array.isArray(params.providerState.modelsRaw)
      ? findRunnableCopilotModel(
          params.providerState.modelsRaw,
          normalizedRequestedModel ?? defaultModel,
        )
      : undefined;
  const candidates = uniqueModels([
    normalizedRequestedModel,
    defaultModel,
    preferred,
    params.providerState.models[0],
  ]);
  for (const candidate of candidates) {
    if (params.providerState.models.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function prepareDirectAgentExecution(params: {
  agentName: string;
  configPath: string;
  workingFolder?: string;
  defaultRepositoryRoot?: string;
  source: 'REST' | 'MCP';
  surface:
    | 'agents.run'
    | 'agents.commands.run'
    | 'mcp.agents.run'
    | 'flows.run';
  pinnedProviderId?: ConversationProvider;
  pinnedModelId?: string;
  pinnedRequestedProviderId?: string;
  pinnedEndpointId?: string | null;
  allowFallback: boolean;
}): Promise<DirectAgentPreparedExecution> {
  let requestedMetadata;
  try {
    requestedMetadata = await readAgentRequestedProviderMetadata({
      configPath: params.configPath,
    });
  } catch (error) {
    const code =
      error instanceof RuntimeConfigResolutionError
        ? error.code
        : 'UNKNOWN_ERROR';
    if (params.source === 'REST') {
      console.error(
        `${T06_ERROR_LOG} surface=${params.surface} source=${params.source} code=${code}`,
      );
    } else {
      console.error(
        `${T07_ERROR_LOG} surface=${params.surface} source=${params.source} code=${code}`,
      );
    }
    throw error;
  }
  const availabilityContext =
    await getEffectiveAgentServiceDeps().createAgentAvailabilityContext();
  const availability = await getEffectiveAgentServiceDeps().evaluateAgentAvailability({
    agentName: params.agentName,
    configPath: params.configPath,
    entrypoint: 'agents.service',
    context: availabilityContext,
  });
  const providerStates = await collectDirectAgentProviderStates();
  const runtimeProviderStates = {
    codex: applyBootstrapStatusToDirectAgentProviderState(
      'codex',
      providerStates.codex,
    ),
    copilot: applyBootstrapStatusToDirectAgentProviderState(
      'copilot',
      providerStates.copilot,
    ),
    lmstudio: applyBootstrapStatusToDirectAgentProviderState(
      'lmstudio',
      providerStates.lmstudio,
    ),
  };
  const executionContext = await resolveSharedExecutionContext({
    workingFolder: params.workingFolder,
  });
  if (params.pinnedProviderId) {
    const providerState = runtimeProviderStates[params.pinnedProviderId];
    const providerRuntimeResolution = await resolveProviderRuntimeConfigForExecution({
      configPath: params.configPath,
      providerId: params.pinnedProviderId,
      source: params.source,
      surface: params.surface,
    });
    const configuredEndpointId =
      providerRuntimeResolution.endpoint?.endpointId?.trim() || undefined;
    if (
      params.pinnedEndpointId &&
      configuredEndpointId &&
      configuredEndpointId !== params.pinnedEndpointId
    ) {
      throw toRunAgentError(
        'PROVIDER_UNAVAILABLE',
        `Saved endpoint "${params.pinnedEndpointId}" does not match configured endpoint "${configuredEndpointId}" for provider "${params.pinnedProviderId}".`,
        undefined,
      );
    }
    const endpointState =
      providerRuntimeResolution.endpoint !== undefined
        ? await resolveOpenAiCompatEndpointRuntimeState({
            endpoint: providerRuntimeResolution.endpoint,
            provider:
              params.pinnedProviderId === 'codex' ||
              params.pinnedProviderId === 'copilot'
                ? params.pinnedProviderId
                : undefined,
          })
        : params.pinnedEndpointId
          ? {
              endpointId: params.pinnedEndpointId,
              available: false,
              models: [],
              reason: `Endpoint "${params.pinnedEndpointId}" is unavailable.`,
            }
          : undefined;
    const requestedModel =
      params.pinnedModelId ??
      normalizeModel(
        (providerRuntimeResolution.config as Record<string, unknown>)?.model,
      ) ??
      providerState?.models[0] ??
      'unknown-model';
    if (
      !endpointState &&
      params.pinnedModelId &&
      providerState?.available &&
      providerState.models.length > 0 &&
      !providerState.models.includes(params.pinnedModelId)
    ) {
      throw toRunAgentError(
        'PROVIDER_UNAVAILABLE',
        `Saved model "${params.pinnedModelId}" is unavailable for provider "${params.pinnedProviderId}".`,
        undefined,
      );
    }
    const runtimeSelection = resolveRuntimeProviderSelection({
      requestedProvider: params.pinnedProviderId,
      requestedModel,
      endpoint: endpointState,
      failInPlaceOnEndpointUnavailable: Boolean(
        params.pinnedEndpointId && !endpointState?.available,
      ),
      allowCrossProviderFallback: false,
      codex: runtimeProviderStates.codex,
      copilot: runtimeProviderStates.copilot,
      lmstudio: runtimeProviderStates.lmstudio,
    });
    if (runtimeSelection.unavailable) {
      throw toRunAgentError(
        'PROVIDER_UNAVAILABLE',
        runtimeSelection.requestedReason ??
          providerState?.reason ??
          `Saved provider "${params.pinnedProviderId}" is unavailable.`,
        undefined,
      );
    }

    const runtimePath = runtimeSelection.executionPath;
    const endpointId =
      runtimePath === 'configured_endpoint' ||
      runtimePath === 'same_endpoint_repair'
        ? runtimeSelection.endpointId
        : undefined;
    const runtimeConfig =
      runtimeSelection.executionProvider === 'codex' &&
      endpointId &&
      providerRuntimeResolution.endpoint
        ? applyCodexOpenAiCompatEndpointToRuntimeConfig(
            providerRuntimeResolution.config,
            providerRuntimeResolution.endpoint,
            {
              env: process.env,
              modelId: runtimeSelection.executionModel,
            },
          )
        : providerRuntimeResolution.config;
    const runtimeWarning = buildRuntimeSelectionWarning({
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
      requestedProviderId: params.pinnedRequestedProviderId,
      executionProviderId: runtimeSelection.executionProvider,
      modelId: runtimeSelection.executionModel,
      endpointId,
      openAiCompatEndpoint:
        (runtimeSelection.executionProvider === 'copilot' ||
          runtimeSelection.executionProvider === 'codex') &&
        endpointId &&
        providerRuntimeResolution.endpoint?.endpointId === endpointId
          ? providerRuntimeResolution.endpoint
          : undefined,
      runtimePath,
      runtimeConfig: cloneRuntimeConfigWithModel(
        runtimeConfig,
        runtimeSelection.executionModel,
      ),
      warnings: [
        ...toAgentLaunchWarnings(availability),
        ...(runtimeWarning ? [runtimeWarning] : []),
        ...providerRuntimeResolution.warnings,
      ],
      availability,
      executionContext,
      repositoryContext: executionContext.repositoryMetadata,
      workingDirectoryOverride: executionContext.workingDirectoryOverride,
      copilotModels: providerStates.copilot.modelsRaw ?? [],
    };
  }

  const requestedProviderId =
    requestedMetadata.requestedProviderId ?? availability.requestedProviderId;
  const fallbackOrder =
    getEffectiveAgentServiceDeps().resolveAgentProviderFallbackOrder()
      .normalizedProviders;
  const configuredRequestedProvider =
    requestedProviderId && isChatProviderId(requestedProviderId)
      ? requestedProviderId
      : (fallbackOrder.find(
          (providerId) => providerStates[providerId]?.available,
        ) ??
        availability.executionProviderId ??
        'codex');
  const filteredFallbackOrder = fallbackOrder.filter(
    (providerId) => providerId !== configuredRequestedProvider,
  );
  const executionOrder = [
    configuredRequestedProvider,
    ...(params.allowFallback ? filteredFallbackOrder : []),
  ];
  const runtimeWarnings = [...requestedMetadata.warnings];
  let lastRuntimeConfigFailure:
    | { providerId: ChatProviderId; message: string }
    | undefined;

  let invalidProviderReason: string | undefined;
  if (requestedProviderId && !isChatProviderId(requestedProviderId)) {
    invalidProviderReason =
      availability.disabledReason?.message ??
      `Agent config requested unsupported provider "${requestedProviderId}".`;
  }

  for (const providerId of executionOrder) {
    const providerState = providerStates[providerId];
    const runtimeProviderState = runtimeProviderStates[providerId];
    if (!runtimeProviderState?.available) continue;
    let providerRuntimeResolution:
      | {
          config: CodexOptions['config'];
          warnings: string[];
          endpoint?: OpenAiCompatEndpointConfig;
        }
      | undefined;
    try {
      providerRuntimeResolution =
        await resolveProviderRuntimeConfigForExecution({
          configPath: params.configPath,
          providerId,
          source: params.source,
          surface: params.surface,
        });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? 'unknown error');
      runtimeWarnings.push(
        providerId === configuredRequestedProvider
          ? `Agent could not execute on requested provider "${providerId}" because its runtime config could not load: ${message}`
          : `Fallback provider "${providerId}" was skipped because its runtime config could not load: ${message}`,
      );
      lastRuntimeConfigFailure = { providerId, message };
      continue;
    }
    const endpointState = providerRuntimeResolution.endpoint
      ? await resolveOpenAiCompatEndpointRuntimeState({
          endpoint: providerRuntimeResolution.endpoint,
          provider:
            providerId === 'codex' || providerId === 'copilot'
              ? providerId
              : undefined,
        })
      : params.pinnedEndpointId
        ? {
            endpointId: params.pinnedEndpointId,
            available: false,
            models: [],
            reason: `Endpoint "${params.pinnedEndpointId}" is unavailable.`,
          }
        : undefined;
    const configuredModel = normalizeModel(
      (providerRuntimeResolution.config as Record<string, unknown>)?.model,
    );
    const requestedModel =
      resolveProviderModelForExecution({
        providerId,
        requestedModel: configuredModel,
        providerState: runtimeProviderState,
        preferConfiguredModel: endpointState !== undefined,
      }) ??
      configuredModel ??
      providerState.models[0] ??
      'unknown-model';
    const runtimeSelection = resolveRuntimeProviderSelection({
      requestedProvider: providerId,
      requestedModel,
      endpoint: endpointState,
      failInPlaceOnEndpointUnavailable: Boolean(
        params.pinnedEndpointId && !endpointState?.available,
      ),
      allowCrossProviderFallback: false,
      codex: runtimeProviderStates.codex,
      copilot: runtimeProviderStates.copilot,
      lmstudio: runtimeProviderStates.lmstudio,
    });
    if (runtimeSelection.unavailable) {
      if (
        params.pinnedEndpointId &&
        providerRuntimeResolution.endpoint?.endpointId === params.pinnedEndpointId
      ) {
        throw toRunAgentError(
          'PROVIDER_UNAVAILABLE',
          runtimeSelection.requestedReason ??
            providerState.reason ??
            `Saved provider "${providerId}" is unavailable.`,
          undefined,
        );
      }
      runtimeWarnings.push(
        providerId === configuredRequestedProvider
          ? `Agent could not execute on requested provider "${providerId}" because ${runtimeSelection.requestedReason ?? providerState.reason ?? 'provider unavailable'}.`
          : `Fallback provider "${providerId}" was skipped because ${runtimeSelection.requestedReason ?? providerState.reason ?? 'provider unavailable'}.`,
      );
      lastRuntimeConfigFailure = {
        providerId,
        message:
          runtimeSelection.requestedReason ??
          providerState.reason ??
          'provider unavailable',
      };
      continue;
    }
    const runtimeWarning = buildRuntimeSelectionWarning({
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
    const endpointId =
      runtimeSelection.executionPath === 'configured_endpoint' ||
      runtimeSelection.executionPath === 'same_endpoint_repair'
        ? runtimeSelection.endpointId
        : undefined;
    const runtimeConfig =
      runtimeSelection.executionProvider === 'codex' &&
      endpointId &&
      providerRuntimeResolution.endpoint
        ? applyCodexOpenAiCompatEndpointToRuntimeConfig(
            providerRuntimeResolution.config,
            providerRuntimeResolution.endpoint,
            {
              env: process.env,
              modelId: runtimeSelection.executionModel,
            },
          )
        : providerRuntimeResolution.config;
    const fallbackWarning =
      providerId !== configuredRequestedProvider
        ? [
            `Agent will use fallback provider "${runtimeSelection.executionProvider}" because "${configuredRequestedProvider}" could not execute.`,
          ]
        : [];
    return {
      requestedProviderId,
      executionProviderId: runtimeSelection.executionProvider,
      modelId: runtimeSelection.executionModel,
      endpointId,
      openAiCompatEndpoint:
        (runtimeSelection.executionProvider === 'copilot' ||
          runtimeSelection.executionProvider === 'codex') &&
        endpointId &&
        providerRuntimeResolution.endpoint?.endpointId === endpointId
          ? providerRuntimeResolution.endpoint
          : undefined,
      runtimePath: runtimeSelection.executionPath,
      runtimeConfig: cloneRuntimeConfigWithModel(
        runtimeConfig,
        runtimeSelection.executionModel,
      ),
      warnings: mergeWarningMessages(
        toAgentLaunchWarnings(availability),
        runtimeWarnings,
        fallbackWarning,
        runtimeWarning ? [runtimeWarning] : undefined,
        providerRuntimeResolution.warnings,
      ),
      availability,
      executionContext,
      repositoryContext: executionContext.repositoryMetadata,
      workingDirectoryOverride: executionContext.workingDirectoryOverride,
      copilotModels: providerStates.copilot.modelsRaw ?? [],
    };
  }

  if (invalidProviderReason) {
    throw toRunAgentError('INVALID_PROVIDER', invalidProviderReason);
  }

  const requestedState = providerStates[configuredRequestedProvider];
  throw toRunAgentError(
    'PROVIDER_UNAVAILABLE',
    lastRuntimeConfigFailure?.providerId === configuredRequestedProvider
      ? `Provider "${configuredRequestedProvider}" could not execute because its runtime config could not load: ${lastRuntimeConfigFailure.message}`
      : requestedState?.reason
        ? `Provider "${configuredRequestedProvider}" is unavailable: ${requestedState.reason}.`
        : `Provider "${configuredRequestedProvider}" is unavailable.`,
  );
}

export async function prepareFlowOwnedAgentExecution(params: {
  agentName: string;
  configPath: string;
  workingFolder?: string;
  defaultRepositoryRoot?: string;
  source: 'REST' | 'MCP';
  pinnedProviderId?: ConversationProvider;
  pinnedModelId?: string;
  pinnedRequestedProviderId?: string;
  pinnedEndpointId?: string | null;
  allowFallback: boolean;
}): Promise<DirectAgentPreparedExecution> {
  return prepareDirectAgentExecution({
    ...params,
    surface: 'flows.run',
  });
}

function logTransitiveContractRead(params: {
  consumer: string;
  sourceId: string;
  repo: RepoEntry;
}) {
  appendRepoBackedTransitiveConsumerLogs({
    consumer: params.consumer,
    subjectKind: 'repository',
    subjectId: params.repo.containerPath,
    sourceId: params.sourceId,
    containerPath: params.repo.containerPath,
    repoIdentity: resolveRepoEmbeddingIdentity(params.repo),
  });
}

async function getConversation(
  conversationId: string,
): Promise<Conversation | null> {
  if (shouldUseMemoryPersistence()) {
    return memoryConversations.get(conversationId) ?? null;
  }
  return (await ConversationModel.findById(conversationId)
    .lean()
    .exec()) as Conversation | null;
}

const persistConversationWorkingFolder = async (params: {
  conversationId: string;
  workingFolder?: string | null;
  expectedWorkingFolder?: string | null;
}): Promise<string | undefined> => {
  if (shouldUseMemoryPersistence()) {
    const updated = updateMemoryConversationWorkingFolder(params);
    return updated?.flags?.workingFolder?.trim();
  }
  const updated = await updateConversationWorkingFolder(params);
  if (updated?.flags?.workingFolder) {
    return updated.flags.workingFolder.trim();
  }
  if (!params.workingFolder && params.expectedWorkingFolder) {
    return (
      (
        await getConversation(params.conversationId)
      )?.flags?.workingFolder?.trim() ?? undefined
    );
  }
  return undefined;
};

const resolveConversationWorkingFolderForRun = async (params: {
  conversationId: string;
  conversation: Conversation | null;
  requestedWorkingFolder?: string;
  surface: 'agent_run' | 'agent_command_run';
  knownRepositoryPathsState?: import('../workingFolders/state.js').KnownRepositoryPathsState;
}): Promise<string | undefined> => {
  if (params.requestedWorkingFolder) {
    const validated = await validateRequestedWorkingFolder({
      workingFolder: params.requestedWorkingFolder,
      knownRepositoryPathsState: params.knownRepositoryPathsState,
    });
    if (params.conversation) {
      await persistConversationWorkingFolder({
        conversationId: params.conversationId,
        workingFolder: validated,
      });
      appendWorkingFolderDecisionLog({
        conversationId: params.conversationId,
        recordType: getConversationRecordType(params.conversation),
        surface: params.surface,
        action: 'save',
        decisionReason: 'request_value_persisted',
        workingFolder: validated,
      });
    }
    return validated;
  }

  if (!params.conversation) return undefined;
  return await restoreSavedWorkingFolder({
    conversation: params.conversation,
    surface: params.surface,
    clearPersistedWorkingFolder: async (
      conversationId,
      expectedWorkingFolder,
    ) => {
      const updatedWorkingFolder = await persistConversationWorkingFolder({
        conversationId,
        workingFolder: null,
        expectedWorkingFolder,
      });
      if (updatedWorkingFolder) return updatedWorkingFolder;
      if (!expectedWorkingFolder) return undefined;
      return (
        await getConversation(conversationId)
      )?.flags?.workingFolder?.trim();
    },
    knownRepositoryPathsState: params.knownRepositoryPathsState,
  });
};

async function ensureAgentConversation(params: {
  conversationId: string;
  agentName: string;
  providerId: ConversationProvider;
  modelId: string;
  title: string;
  source: 'REST' | 'MCP';
  workingFolder?: string;
  endpointId?: string | null;
  inflightId?: string;
  chatFactory?: typeof getChatInterface;
}): Promise<void> {
  const now = new Date();
  if (shouldUseMemoryPersistence()) {
    const existing = memoryConversations.get(params.conversationId);
    if (existing) return;
    memoryConversations.set(params.conversationId, {
      _id: params.conversationId,
      provider: params.providerId,
      model: params.modelId,
      title: params.title,
      agentName: params.agentName,
      source: params.source,
      flags: buildConversationFlags({
        provider: params.providerId,
        workingFolder: params.workingFolder,
        endpointId: params.endpointId,
      }),
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);
    return;
  }

  const existing = (await ConversationModel.findById(params.conversationId)
    .lean()
    .exec()) as Conversation | null;
  if (existing) return;

  await createConversation({
    conversationId: params.conversationId,
    provider: params.providerId,
    model: params.modelId,
    title: params.title,
    agentName: params.agentName,
    source: params.source,
    flags: buildConversationFlags({
      provider: params.providerId,
      workingFolder: params.workingFolder,
      endpointId: params.endpointId,
    }),
    lastMessageAt: now,
  });
}

class NoopChat extends ChatInterface {
  async execute(): Promise<void> {
    return undefined;
  }
}

type DirectCommandResolution = {
  commandsRoot: string;
  commandFilePath: string;
  selectedRepositoryPath: string;
  selectedRepositoryLabel: string;
  selectedRepositorySlot: RepositoryCandidateOrderSlot;
  orderedCandidates: RepositoryCandidateOrderResult;
  lookupSummary: RepositoryCandidateLookupSummary;
  runtimeLookupSummary: RepositoryCandidateLookupSummary;
};

const codeInfo2RootForAgent = (agentHome: string) =>
  path.resolve(agentHome, '..', '..');

const appendDirectCommandResolutionLogs = (params: {
  agentName: string;
  commandName: string;
  selectedCandidate?: {
    sourceId: string;
    sourceLabel: string;
    slot: RepositoryCandidateOrderSlot;
  };
  orderedCandidates: RepositoryCandidateOrderResult;
  decision: 'selected' | 'fail_fast' | 'not_found';
  failureReason?: string;
  failureMessage?: string;
}) => {
  append({
    level: params.decision === 'selected' ? 'info' : 'warn',
    message: DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: buildRepositoryCandidateOrderLogContext({
      orderedCandidates: params.orderedCandidates,
      referenceType: 'commandFile',
    }),
  });

  const lookupSummary = params.selectedCandidate
    ? buildRepositoryCandidateLookupSummary({
        orderedCandidates: params.orderedCandidates,
        selectedRepositoryPath: params.selectedCandidate.sourceId,
      })
    : undefined;

  append({
    level: params.decision === 'selected' ? 'info' : 'warn',
    message: 'DEV-0000034:T2:command_run_resolved',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      agentName: params.agentName,
      commandName: params.commandName,
      decision: params.decision,
      selectedRepositoryPath: lookupSummary?.selectedRepositoryPath ?? null,
      selectedRepositoryLabel: params.selectedCandidate?.sourceLabel ?? null,
      selectedRepositorySlot: params.selectedCandidate?.slot ?? null,
      fallbackUsed: lookupSummary?.fallbackUsed ?? false,
      workingRepositoryAvailable:
        params.orderedCandidates.workingRepositoryAvailable,
      candidateRepositories: buildRepositoryCandidateOrderLogContext({
        orderedCandidates: params.orderedCandidates,
        referenceType: 'commandFile',
      }).candidateRepositories,
      ...(params.failureReason ? { failureReason: params.failureReason } : {}),
      ...(params.failureMessage
        ? { failureMessage: params.failureMessage }
        : {}),
    },
  });
};

const buildDirectCommandRuntimeLookupSummary = (params: {
  orderedCandidates: RepositoryCandidateOrderResult;
  workingRepositoryPath: string;
}): RepositoryCandidateLookupSummary => {
  const selectedRepositoryPath = path.resolve(params.workingRepositoryPath);
  const selectedCandidate = params.orderedCandidates.candidates.find(
    (candidate) => candidate.sourceId === selectedRepositoryPath,
  );
  if (!selectedCandidate) {
    throw new Error(
      `working repository ${selectedRepositoryPath} is not present in the ordered candidate list`,
    );
  }

  return {
    selectedRepositoryPath,
    // Runtime metadata describes the execution repository, not whether
    // command-file lookup had to fall back to an owner repository.
    fallbackUsed: false,
    workingRepositoryAvailable:
      params.orderedCandidates.workingRepositoryAvailable,
  };
};

const resolveDirectCommandSelection = async (params: {
  agentName: string;
  agentHome: string;
  commandName: string;
  workingRepositoryPath?: string;
  sourceId?: string;
  repos: RepoEntry[];
}): Promise<DirectCommandResolution> => {
  const codeInfo2Root = codeInfo2RootForAgent(params.agentHome);
  const ownerRepositoryPath = params.sourceId?.trim()
    ? path.resolve(params.sourceId)
    : codeInfo2Root;
  const ownerRepository = params.repos.find(
    (repo) => path.resolve(repo.containerPath) === ownerRepositoryPath,
  );
  const ownerRepositoryLabel =
    ownerRepository?.id ??
    normalizeRepositoryCandidateLabel({
      sourceId: ownerRepositoryPath,
      sourceLabel: params.sourceId ? undefined : path.basename(codeInfo2Root),
    });

  const orderedCandidates = buildRepositoryCandidateOrder({
    caller: 'direct-command',
    workingRepositoryPath: params.workingRepositoryPath,
    ownerRepositoryPath,
    ownerRepositoryLabel,
    codeInfo2Root,
    otherRepositoryRoots: params.repos.map((repo) => ({
      sourceId: repo.containerPath,
      sourceLabel: repo.id,
    })),
  });

  for (const candidate of orderedCandidates.candidates) {
    const resolvedAgentHome =
      candidate.sourceId === codeInfo2Root
        ? { home: params.agentHome }
        : await resolveAgentHomeForRepository({
            repositoryRoot: candidate.sourceId,
            agentName: params.agentName,
          });
    const commandsRoot = path.join(
      resolvedAgentHome.home ??
        path.join(candidate.sourceId, 'codeinfo_agents', params.agentName),
      'commands',
    );
    const commandFilePath = path.resolve(
      commandsRoot,
      `${params.commandName}.json`,
    );
    const relativePath = path.relative(commandsRoot, commandFilePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      appendDirectCommandResolutionLogs({
        agentName: params.agentName,
        commandName: params.commandName,
        orderedCandidates,
        selectedCandidate: candidate,
        decision: 'fail_fast',
        failureReason: 'INVALID',
        failureMessage: 'commandName must be a valid file name',
      });
      throw toRunAgentError('COMMAND_INVALID');
    }

    const commandStat = await fs.stat(commandFilePath).catch((error) => {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw error;
    });
    if (!commandStat?.isFile()) {
      continue;
    }

    const parsed = await loadAgentCommandFile({ filePath: commandFilePath });
    if (!parsed.ok) {
      appendDirectCommandResolutionLogs({
        agentName: params.agentName,
        commandName: params.commandName,
        orderedCandidates,
        selectedCandidate: candidate,
        decision: 'fail_fast',
        failureReason: 'INVALID',
        failureMessage: `Command ${params.commandName} failed schema validation`,
      });
      throw toRunAgentError('COMMAND_INVALID');
    }

    const lookupSummary = buildRepositoryCandidateLookupSummary({
      orderedCandidates,
      selectedRepositoryPath: candidate.sourceId,
    });
    const runtimeLookupSummary = params.workingRepositoryPath?.trim()
      ? buildDirectCommandRuntimeLookupSummary({
          orderedCandidates,
          workingRepositoryPath: params.workingRepositoryPath,
        })
      : lookupSummary;
    appendDirectCommandResolutionLogs({
      agentName: params.agentName,
      commandName: params.commandName,
      orderedCandidates,
      selectedCandidate: candidate,
      decision: 'selected',
    });
    return {
      commandsRoot,
      commandFilePath,
      selectedRepositoryPath: candidate.sourceId,
      selectedRepositoryLabel: candidate.sourceLabel,
      selectedRepositorySlot: candidate.slot,
      orderedCandidates,
      lookupSummary,
      runtimeLookupSummary,
    };
  }

  appendDirectCommandResolutionLogs({
    agentName: params.agentName,
    commandName: params.commandName,
    orderedCandidates,
    decision: 'not_found',
  });
  throw toRunAgentError('COMMAND_NOT_FOUND');
};

async function persistSyntheticAgentTurn(params: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  model: string;
  provider: string;
  source: TurnSource;
  status: Turn['status'];
  toolCalls: Record<string, unknown> | null;
  command: TurnCommandMetadata;
  runtime?: TurnRuntimeMetadata;
  createdAt: Date;
}): Promise<{ turnId?: string }> {
  if (shouldUseMemoryPersistence()) {
    recordMemoryTurn({
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      model: params.model,
      provider: params.provider,
      source: params.source,
      toolCalls: params.toolCalls,
      status: params.status,
      command: params.command,
      runtime: params.runtime,
      createdAt: params.createdAt,
    } as Turn);
    updateMemoryConversationMeta(params.conversationId, {
      lastMessageAt: params.createdAt,
      model: params.model,
    });
    return {};
  }

  const turn = await appendTurn({
    conversationId: params.conversationId,
    role: params.role,
    content: params.content,
    model: params.model,
    provider: params.provider,
    source: params.source,
    toolCalls: params.toolCalls,
    status: params.status,
    command: params.command,
    runtime: params.runtime,
    createdAt: params.createdAt,
  });

  const metaOutcome = await updateConversationMeta({
    conversationId: params.conversationId,
    lastMessageAt: params.createdAt,
    model: params.model,
  });
  if (metaOutcome.outcome === 'not_found') {
    throw toRunAgentError('CONVERSATION_ARCHIVED');
  }
  if (metaOutcome.outcome === 'retry_exhausted') {
    throw new Error('agent turn metadata update exhausted');
  }

  const turnId =
    turn && typeof turn === 'object' && '_id' in (turn as object)
      ? String((turn as { _id?: unknown })._id ?? '')
      : undefined;
  return turnId?.length ? { turnId } : {};
}

async function emitFailedAgentCommandStep(params: {
  conversationId: string;
  inflightId: string;
  instruction: string;
  providerId: ChatProviderId;
  modelId: string;
  source: 'REST' | 'MCP';
  message: string;
  errorCode?: string;
  command: TurnCommandMetadata;
}): Promise<void> {
  const createdAtIso = new Date().toISOString();
  createInflight({
    conversationId: params.conversationId,
    inflightId: params.inflightId,
    provider: params.providerId,
    model: params.modelId,
    source: params.source,
    command: params.command,
    userTurn: { content: params.instruction, createdAt: createdAtIso },
  });

  const bridge = attachChatStreamBridge({
    conversationId: params.conversationId,
    inflightId: params.inflightId,
    provider: params.providerId,
    model: params.modelId,
    chat: new NoopChat(),
    deferFinal: true,
  });

  try {
    publishUserTurn({
      conversationId: params.conversationId,
      inflightId: params.inflightId,
      content: params.instruction,
      createdAt: createdAtIso,
    });

    const userCreatedAt = new Date(createdAtIso);
    const userPersisted = await persistSyntheticAgentTurn({
      conversationId: params.conversationId,
      role: 'user',
      content: params.instruction,
      model: params.modelId,
      provider: params.providerId,
      source: params.source,
      status: 'ok',
      toolCalls: null,
      command: params.command,
      createdAt: userCreatedAt,
    });

    const assistantCreatedAt = new Date();
    const assistantPersisted = await persistSyntheticAgentTurn({
      conversationId: params.conversationId,
      role: 'assistant',
      content: params.message,
      model: params.modelId,
      provider: params.providerId,
      source: params.source,
      status: 'failed',
      toolCalls: null,
      command: params.command,
      createdAt: assistantCreatedAt,
    });

    markInflightPersisted({
      conversationId: params.conversationId,
      inflightId: params.inflightId,
      role: 'user',
      turnId: userPersisted.turnId,
    });
    markInflightPersisted({
      conversationId: params.conversationId,
      inflightId: params.inflightId,
      role: 'assistant',
      turnId: assistantPersisted.turnId,
    });

    bridge.finalize({
      fallback: {
        status: 'failed',
        error: {
          code: params.errorCode,
          message: params.message,
        },
      },
    });
  } finally {
    bridge.cleanup();
    cleanupInflight({
      conversationId: params.conversationId,
      inflightId: params.inflightId,
    });
  }
}

export async function startAgentInstruction(
  params: Omit<RunAgentInstructionParams, 'signal'> & {
    cleanupInflightFn?: InstructionRuntimeCleanupFn;
    releaseConversationLockFn?: InstructionReleaseLockFn;
  },
): Promise<{
  conversationId: string;
  inflightId: string;
  providerId: ChatProviderId;
  modelId: string;
  warnings?: string[];
}> {
  const clientProvidedConversationId = Boolean(params.conversationId);
  const conversationId = params.conversationId ?? crypto.randomUUID();
  const inflightId = params.inflightId ?? crypto.randomUUID();

  if (!tryAcquireConversationLock(conversationId)) {
    throw toRunAgentError(
      'RUN_IN_PROGRESS',
      'A run is already in progress for this conversation.',
    );
  }
  const ownership = getActiveRunOwnership(conversationId);
  if (!ownership) {
    releaseConversationLock(conversationId);
    throw new Error('Conversation run ownership could not be resolved.');
  }
  const { runToken } = ownership;

  const mustExist = false;

  append({
    level: 'info',
    message: 'DEV-0000021[T1] agents.run mustExist resolved',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      agentName: params.agentName,
      source: params.source,
      conversationId,
      clientProvidedConversationId,
      mustExist,
    },
  });

  let modelId = 'gpt-5.1-codex-max';
  let providerId: ChatProviderId = 'codex';
  let warnings: string[] = [];
  let startPathWasNewConversation = false;

  try {
    const discovered = await discoverAgents();
    const agent = discovered.find((item) => item.name === params.agentName);
    if (!agent) {
      throw toRunAgentError('AGENT_NOT_FOUND');
    }

    const listedReposResult = await loadKnownRepositoryPathsStateForAgentRuns();
    const existingConversation = await getConversation(conversationId);
    const isNewConversation = !existingConversation;
    startPathWasNewConversation = isNewConversation;
    if (mustExist && isNewConversation) {
      throw toRunAgentError('AGENT_NOT_FOUND');
    }
    if (existingConversation?.archivedAt) {
      throw toRunAgentError('CONVERSATION_ARCHIVED');
    }
    if (
      existingConversation &&
      (existingConversation.agentName ?? '') !== params.agentName
    ) {
      throw toRunAgentError('AGENT_MISMATCH');
    }

    const effectiveWorkingFolder = await resolveConversationWorkingFolderForRun(
      {
        conversationId,
        conversation: existingConversation,
        requestedWorkingFolder: params.working_folder,
        surface: 'agent_run',
        knownRepositoryPathsState: listedReposResult.knownRepositoryPathsState,
      },
    );

    const prepared = await prepareDirectAgentExecution({
      agentName: params.agentName,
      configPath: agent.configPath,
      workingFolder: effectiveWorkingFolder,
      source: params.source,
      surface: params.source === 'MCP' ? 'mcp.agents.run' : 'agents.run',
      pinnedProviderId: existingConversation?.provider,
      pinnedModelId: existingConversation?.model,
      pinnedEndpointId: existingConversation?.flags?.endpointId,
      allowFallback: !existingConversation,
    });
    modelId = prepared.modelId;
    providerId = prepared.executionProviderId;
    warnings = [...prepared.warnings];

    const title =
      params.instruction.trim().slice(0, 80) || 'Untitled conversation';

    if (isNewConversation) {
      await ensureAgentConversation({
        conversationId,
        agentName: params.agentName,
        providerId,
        modelId,
        title,
        source: params.source,
        workingFolder: effectiveWorkingFolder,
        endpointId: prepared.endpointId ?? null,
      });
      if (effectiveWorkingFolder) {
        appendWorkingFolderDecisionLog({
          conversationId,
          recordType: 'agent',
          surface: 'agent_run',
          action: 'save',
          decisionReason: 'request_value_persisted_on_create',
          workingFolder: effectiveWorkingFolder,
        });
      }
    }
    params.working_folder = effectiveWorkingFolder;
  } catch (err) {
    cleanupPendingConversationCancel({ conversationId, runToken });
    releaseConversationLock(conversationId, runToken);
    throw err;
  }

  void (async () => {
    try {
      appendAgentRuntimeDiagnostic('agents.test.start_instruction.background_entered', {
        agentName: params.agentName,
        conversationId,
        inflightId,
        source: params.source,
        runToken,
        startPathWasNewConversation,
        workingFolder: params.working_folder ?? null,
      });
      await runAgentInstructionUnlocked({
        ...params,
        conversationId,
        mustExist,
        startPathWasNewConversation,
        inflightId,
        // Intentionally omit any request-bound signal; cancellation happens only
        // via explicit WS cancel_inflight.
        signal: undefined,
        runToken,
        cleanupInflightFn: params.cleanupInflightFn,
        releaseConversationLockFn: params.releaseConversationLockFn,
      });
      appendAgentRuntimeDiagnostic('agents.test.start_instruction.background_complete', {
        agentName: params.agentName,
        conversationId,
        inflightId,
        source: params.source,
        runToken,
      });
    } catch (err) {
      appendAgentRuntimeDiagnostic('agents.test.start_instruction.background_failed', {
        agentName: params.agentName,
        conversationId,
        inflightId,
        source: params.source,
        runToken,
        error:
          err instanceof Error ? err.message : String(err ?? 'unknown error'),
      });
      baseLogger.error(
        { agentName: params.agentName, conversationId, inflightId, err },
        'agents run failed (background)',
      );
    }
  })();

  appendAgentRuntimeDiagnostic('agents.test.start_instruction.accepted', {
    agentName: params.agentName,
    conversationId,
    inflightId,
    providerId,
    modelId,
    source: params.source,
    runToken,
    warningCount: warnings.length,
    workingFolder: params.working_folder ?? null,
  });
  return {
    conversationId,
    inflightId,
    providerId,
    modelId,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function runAgentInstruction(
  params: RunAgentInstructionParams,
): Promise<RunAgentInstructionResult> {
  const clientProvidedConversationId = Boolean(params.conversationId);
  const conversationId = params.conversationId ?? crypto.randomUUID();
  if (!tryAcquireConversationLock(conversationId)) {
    throw toRunAgentError(
      'RUN_IN_PROGRESS',
      'A run is already in progress for this conversation.',
    );
  }
  const ownership = getActiveRunOwnership(conversationId);
  if (!ownership) {
    releaseConversationLock(conversationId);
    throw new Error('Conversation run ownership could not be resolved.');
  }
  const { runToken } = ownership;

  const mustExist = false;
  append({
    level: 'info',
    message: 'DEV-0000021[T1] agents.run mustExist resolved',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      agentName: params.agentName,
      source: params.source,
      conversationId,
      clientProvidedConversationId,
      mustExist,
    },
  });

  const listedReposResult = await loadKnownRepositoryPathsStateForAgentRuns();
  const existingConversation = await getConversation(conversationId);
  const effectiveWorkingFolder = await resolveConversationWorkingFolderForRun({
    conversationId,
    conversation: existingConversation,
    requestedWorkingFolder: params.working_folder,
    surface: 'agent_run',
    knownRepositoryPathsState: listedReposResult.knownRepositoryPathsState,
  });

  return await runAgentInstructionUnlocked({
    ...params,
    conversationId,
    working_folder: effectiveWorkingFolder,
    mustExist,
    runToken,
  });
}

function isSafeAgentCommandName(raw: string): boolean {
  const name = raw.trim();
  if (!name) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('..')) return false;
  return true;
}

const FALLBACK_COMMAND_MODEL_ID = 'gpt-5.1-codex-max';

const loadKnownRepositoryPathsStateForAgentRuns = async () =>
  await getEffectiveAgentServiceDeps()
    .listIngestedRepositories()
    .then((result) => ({
      repos: result.repos,
      knownRepositoryPathsState: knownRepositoryPathsAvailable(
        result.repos.map((repo) => repo.containerPath),
      ),
    }))
    .catch((error) => ({
      repos: [] as RepoEntry[],
      knownRepositoryPathsState: knownRepositoryPathsUnavailable(error),
    }));

function buildCommandConversationTitle(params: {
  commandName: string;
  parsedCommand:
    | Awaited<ReturnType<typeof loadAgentCommandFile>>
    | { ok: false };
  startIndex: number;
}): string {
  if (!params.parsedCommand.ok) {
    return `Command: ${params.commandName}`;
  }

  const startItem = params.parsedCommand.command.items[params.startIndex];
  if (
    startItem?.type === 'message' &&
    'content' in startItem &&
    Array.isArray(startItem.content)
  ) {
    const title = startItem.content.join('\n').trim().slice(0, 80);
    if (title.length > 0) return title;
  }

  return `Command: ${params.commandName}`;
}

async function prepareDirectCommandBootstrap(params: {
  agentName: string;
  commandName: string;
  agentHome: string;
  configPath: string;
  conversationId: string;
  commandFilePath: string;
  startStep: number;
  source: 'REST' | 'MCP';
  workingFolder?: string;
}): Promise<{
  providerId: ChatProviderId;
  initialModelId: string;
  conversationEnsured: boolean;
  endpointId?: string | null;
  warnings: string[];
}> {
  const parsed = await loadAgentCommandFile({
    filePath: params.commandFilePath,
  }).catch(() => ({ ok: false }) as const);
  if (!parsed.ok) {
    return {
      providerId: 'codex',
      initialModelId: FALLBACK_COMMAND_MODEL_ID,
      conversationEnsured: false,
      endpointId: undefined,
      warnings: [],
    };
  }

  const remainingItems = parsed.command.items.slice(params.startStep - 1);
  const suffixNeedsProvider = remainingItems.some(
    (item) => item.type !== 'reingest',
  );
  const startsWithProviderFreeItem = remainingItems[0]?.type === 'reingest';

  const existingConversation = await getConversation(params.conversationId);
  if (existingConversation?.archivedAt) {
    throw toRunAgentError('CONVERSATION_ARCHIVED');
  }
  if (
    existingConversation &&
    (existingConversation.agentName ?? '') !== params.agentName
  ) {
    throw toRunAgentError('AGENT_MISMATCH');
  }

  const title = buildCommandConversationTitle({
    commandName: params.commandName,
    parsedCommand: parsed,
    startIndex: params.startStep - 1,
  });

  if (!suffixNeedsProvider) {
    const providerId =
      (existingConversation?.provider as ChatProviderId | undefined) ?? 'codex';
    const initialModelId =
      existingConversation?.model ?? FALLBACK_COMMAND_MODEL_ID;
    if (!existingConversation) {
      await ensureAgentConversation({
        conversationId: params.conversationId,
        agentName: params.agentName,
        providerId,
        modelId: initialModelId,
        title,
        source: params.source,
        workingFolder: params.workingFolder,
        endpointId: undefined,
      });
    }
    return {
      providerId,
      initialModelId,
      conversationEnsured: !existingConversation,
      endpointId:
        typeof existingConversation?.flags?.endpointId === 'string' &&
        existingConversation.flags.endpointId.trim().length > 0
          ? existingConversation.flags.endpointId.trim()
          : undefined,
      warnings: [],
    };
  }

  const prepared = await prepareDirectAgentExecution({
    agentName: params.agentName,
    configPath: params.configPath,
    workingFolder: params.workingFolder,
    source: params.source,
    surface: params.source === 'MCP' ? 'mcp.agents.run' : 'agents.commands.run',
    pinnedProviderId: existingConversation?.provider,
    pinnedModelId: existingConversation?.model,
    pinnedEndpointId: existingConversation?.flags?.endpointId,
    allowFallback: !existingConversation,
  });
  const initialModelId = prepared.modelId ?? FALLBACK_COMMAND_MODEL_ID;

  if (!startsWithProviderFreeItem || existingConversation) {
    return {
      providerId: prepared.executionProviderId,
      initialModelId,
      conversationEnsured: false,
      endpointId: prepared.endpointId ?? null,
      warnings: prepared.warnings,
    };
  }

  await ensureAgentConversation({
    conversationId: params.conversationId,
    agentName: params.agentName,
    providerId: prepared.executionProviderId,
    modelId: initialModelId,
    title,
    source: params.source,
    workingFolder: params.workingFolder,
    endpointId: prepared.endpointId ?? null,
  });

  return {
    providerId: prepared.executionProviderId,
    initialModelId,
    conversationEnsured: true,
    endpointId: prepared.endpointId ?? null,
    warnings: prepared.warnings,
  };
}

function validateDirectCommandStartStepOrThrow(
  startStep: number,
  totalSteps: number,
) {
  if (!Number.isInteger(startStep) || startStep < 1 || startStep > totalSteps) {
    throw toRunAgentError(
      'INVALID_START_STEP',
      `startStep must be between 1 and ${totalSteps}`,
    );
  }
}

export async function startAgentCommand(params: {
  agentName: string;
  commandName: string;
  startStep?: number;
  conversationId?: string;
  working_folder?: string;
  sourceId?: string;
  source: 'REST' | 'MCP';
  chatFactory?: typeof getChatInterface;
}): Promise<{
  agentName: string;
  commandName: string;
  conversationId: string;
  providerId: ChatProviderId;
  modelId: string;
  warnings?: string[];
}> {
  const discovered = await discoverAgents();
  const agent = discovered.find((item) => item.name === params.agentName);
  if (!agent) throw toRunAgentError('AGENT_NOT_FOUND');

  if (!isSafeAgentCommandName(params.commandName)) {
    throw toRunAgentError('COMMAND_INVALID');
  }

  const commandName = params.commandName.trim();
  const startStep = params.startStep ?? 1;
  const sourceId =
    typeof params.sourceId === 'string' && params.sourceId.trim().length > 0
      ? params.sourceId.trim()
      : undefined;
  const conversationId = params.conversationId ?? crypto.randomUUID();

  append({
    level: 'info',
    message: 'DEV_0000040_T02_START_STEP_VALIDATION',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      stage: 'service_received',
      agentName: params.agentName,
      commandName,
      startStep,
      source: params.source,
    },
  });
  append({
    level: 'info',
    message: 'DEV_0000040_T03_RUNNER_START_STEP',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      stage: 'service_defaulted',
      path: 'startAgentCommand',
      agentName: params.agentName,
      commandName,
      startStep,
      source: params.source,
    },
  });

  if (!tryAcquireConversationLock(conversationId)) {
    throw toRunAgentError(
      'RUN_IN_PROGRESS',
      'A run is already in progress for this conversation.',
    );
  }
  const ownership = getActiveRunOwnership(conversationId);
  if (!ownership) {
    releaseConversationLock(conversationId);
    throw new Error('Conversation run ownership could not be resolved.');
  }
  const { runToken } = ownership;

  let backgroundScheduled = false;
  let modelId = 'gpt-5.1-codex-max';
  let providerId: ChatProviderId = 'codex';
  let warnings: string[] = [];

  try {
    const ingestRootsResult = await loadKnownRepositoryPathsStateForAgentRuns();
    const ingestRoots = ingestRootsResult.repos;
    const matchingRoot = sourceId
      ? ingestRoots.find((repo) => repo.containerPath === sourceId)
      : undefined;
    if (sourceId && !matchingRoot) {
      throw toRunAgentError('COMMAND_NOT_FOUND');
    }
    if (matchingRoot) {
      logTransitiveContractRead({
        consumer: 'agents.service.startAgentCommand',
        sourceId: matchingRoot.containerPath,
        repo: matchingRoot,
      });
    }

    const existingConversation = await getConversation(conversationId);
    const isNewConversation = !existingConversation;
    if (existingConversation?.archivedAt) {
      throw toRunAgentError('CONVERSATION_ARCHIVED');
    }
    if (
      existingConversation &&
      (existingConversation.agentName ?? '') !== params.agentName
    ) {
      throw toRunAgentError('AGENT_MISMATCH');
    }

    const effectiveWorkingFolder = await resolveConversationWorkingFolderForRun(
      {
        conversationId,
        conversation: existingConversation,
        requestedWorkingFolder: params.working_folder,
        surface: 'agent_command_run',
        knownRepositoryPathsState: ingestRootsResult.knownRepositoryPathsState,
      },
    );

    const resolution = await resolveDirectCommandSelection({
      agentName: agent.name,
      agentHome: agent.home,
      commandName,
      workingRepositoryPath: effectiveWorkingFolder,
      sourceId,
      repos: ingestRoots,
    });

    const parsed = await loadAgentCommandFile({
      filePath: resolution.commandFilePath,
    });
    if (!parsed.ok) {
      throw toRunAgentError('COMMAND_INVALID');
    }
    validateDirectCommandStartStepOrThrow(
      startStep,
      parsed.command.items.length,
    );

    const bootstrap = await prepareDirectCommandBootstrap({
      agentName: params.agentName,
      commandName,
      agentHome: agent.home,
      configPath: agent.configPath,
      conversationId,
      commandFilePath: resolution.commandFilePath,
      startStep,
      source: params.source,
      workingFolder: effectiveWorkingFolder,
    });
    modelId = bootstrap.initialModelId;
    providerId = bootstrap.providerId;
    warnings = bootstrap.warnings ?? [];

    if (isNewConversation && !bootstrap.conversationEnsured) {
      const title = buildCommandConversationTitle({
        commandName,
        parsedCommand: parsed,
        startIndex: startStep - 1,
      });
      await ensureAgentConversation({
        conversationId,
        agentName: params.agentName,
        providerId,
        modelId,
        title,
        source: params.source,
        workingFolder: effectiveWorkingFolder,
        endpointId: bootstrap.endpointId ?? null,
      });
      if (effectiveWorkingFolder) {
        appendWorkingFolderDecisionLog({
          conversationId,
          recordType: 'agent',
          surface: 'agent_command_run',
          action: 'save',
          decisionReason: 'request_value_persisted_on_create',
          workingFolder: effectiveWorkingFolder,
        });
      }
    }

    backgroundScheduled = true;
    appendAgentRuntimeDiagnostic('agents.test.start_command.accepted', {
      agentName: params.agentName,
      commandName,
      conversationId,
      providerId,
      modelId,
      source: params.source,
      runToken,
      startStep,
      warningCount: warnings.length,
      selectedRepositoryPath: resolution.selectedRepositoryPath ?? null,
      workingFolder: effectiveWorkingFolder ?? null,
    });
    appendAgentRuntimeDiagnostic('agents.test.start_command.background_scheduled', {
      agentName: params.agentName,
      commandName,
      conversationId,
      source: params.source,
      runToken,
      startStep,
      selectedRepositoryPath: resolution.selectedRepositoryPath ?? null,
      workingFolder: effectiveWorkingFolder ?? null,
    });

    void (async () => {
      try {
        appendAgentRuntimeDiagnostic('agents.test.start_command.background_entered', {
          agentName: params.agentName,
          commandName,
          conversationId,
          source: params.source,
          runToken,
          startStep,
          selectedRepositoryPath: resolution.selectedRepositoryPath ?? null,
          workingFolder: effectiveWorkingFolder ?? null,
        });
        appendAgentRuntimeDiagnostic('agents.test.start_command.runner_begin', {
          agentName: params.agentName,
          commandName,
          conversationId,
          source: params.source,
          runToken,
          startStep,
          selectedRepositoryPath: resolution.selectedRepositoryPath ?? null,
          workingFolder: effectiveWorkingFolder ?? null,
        });
        await runAgentCommandRunner({
          agentName: params.agentName,
          agentHome: agent.home,
          commandsRoot: resolution.commandsRoot,
          commandFilePath: resolution.commandFilePath,
          commandName,
          startStep,
          conversationId,
          sourceId: resolution.selectedRepositoryPath,
          listIngestedRepositories:
            getEffectiveAgentServiceDeps().listIngestedRepositories,
          working_folder: effectiveWorkingFolder,
          signal: undefined,
          source: params.source,
          initialModelId: modelId,
          lookupSummary: resolution.lookupSummary,
          runtimeLookupSummary: resolution.runtimeLookupSummary,
          onPrestartFailure: async (failure) => {
            appendAgentRuntimeDiagnostic('agents.test.start_command.prestart_failure', {
              agentName: params.agentName,
              commandName,
              conversationId,
              source: params.source,
              runToken,
              startStep,
              stepIndex: failure.command.stepIndex,
              totalSteps: failure.command.totalSteps,
              errorCode: failure.errorCode ?? null,
              message: failure.message,
            });
            await emitFailedAgentCommandStep({
              conversationId,
              inflightId: crypto.randomUUID(),
              instruction: failure.instruction,
              providerId,
              modelId,
              source: params.source,
              message: failure.message,
              errorCode: failure.errorCode,
              command: failure.command,
            });
          },
          runAgentInstructionUnlocked: (runParams) =>
            runAgentInstructionUnlocked({
              ...runParams,
              chatFactory: params.chatFactory,
          }),
          lockAlreadyHeld: true,
          runToken,
        });
        appendAgentRuntimeDiagnostic('agents.test.start_command.runner_complete', {
          agentName: params.agentName,
          commandName,
          conversationId,
          source: params.source,
          runToken,
          startStep,
        });
      } catch (err) {
        appendAgentRuntimeDiagnostic('agents.test.start_command.runner_failed', {
          agentName: params.agentName,
          commandName,
          conversationId,
          source: params.source,
          runToken,
          startStep,
          error:
            err instanceof Error ? err.message : String(err ?? 'unknown error'),
        });
        baseLogger.error(
          { agentName: params.agentName, commandName, conversationId, err },
          'agents command run failed (background)',
        );
      }
    })();

    return {
      agentName: params.agentName,
      commandName,
      conversationId,
      providerId,
      modelId,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } finally {
    if (!backgroundScheduled) {
      cleanupPendingConversationCancel({ conversationId, runToken });
      releaseConversationLock(conversationId, runToken);
    }
  }
}

export async function runAgentCommand(params: {
  agentName: string;
  commandName: string;
  startStep?: number;
  conversationId?: string;
  working_folder?: string;
  sourceId?: string;
  signal?: AbortSignal;
  source: 'REST' | 'MCP';
  inflightId?: string;
  chatFactory?: typeof getChatInterface;
}): Promise<{
  agentName: string;
  commandName: string;
  conversationId: string;
  providerId: ChatProviderId;
  modelId: string;
  warnings?: string[];
}> {
  const discovered = await discoverAgents();
  const agent = discovered.find((item) => item.name === params.agentName);
  if (!agent) throw toRunAgentError('AGENT_NOT_FOUND');

  const sourceId =
    typeof params.sourceId === 'string' && params.sourceId.trim().length > 0
      ? params.sourceId.trim()
      : undefined;
  const startStep = params.startStep ?? 1;
  const conversationId = params.conversationId ?? crypto.randomUUID();

  append({
    level: 'info',
    message: 'DEV_0000040_T02_START_STEP_VALIDATION',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      stage: 'service_received',
      agentName: params.agentName,
      commandName: params.commandName,
      startStep,
      source: params.source,
    },
  });
  append({
    level: 'info',
    message: 'DEV_0000040_T03_RUNNER_START_STEP',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      stage: 'service_defaulted',
      path: 'runAgentCommand',
      agentName: params.agentName,
      commandName: params.commandName,
      startStep,
      source: params.source,
    },
  });

  const ingestRootsResult = await loadKnownRepositoryPathsStateForAgentRuns();
  const ingestRoots = ingestRootsResult.repos;
  const matchingRoot = sourceId
    ? ingestRoots.find((repo) => repo.containerPath === sourceId)
    : undefined;
  if (sourceId && !matchingRoot) {
    throw toRunAgentError('COMMAND_NOT_FOUND');
  }
  if (matchingRoot) {
    logTransitiveContractRead({
      consumer: 'agents.service.runAgentCommand',
      sourceId: matchingRoot.containerPath,
      repo: matchingRoot,
    });
  }
  const existingConversation = await getConversation(conversationId);
  const effectiveWorkingFolder = await resolveConversationWorkingFolderForRun({
    conversationId,
    conversation: existingConversation,
    requestedWorkingFolder: params.working_folder,
    surface: 'agent_command_run',
    knownRepositoryPathsState: ingestRootsResult.knownRepositoryPathsState,
  });

  const resolution = await resolveDirectCommandSelection({
    agentName: agent.name,
    agentHome: agent.home,
    commandName: params.commandName.trim(),
    workingRepositoryPath: effectiveWorkingFolder,
    sourceId,
    repos: ingestRoots,
  });

  const parsed = await loadAgentCommandFile({
    filePath: resolution.commandFilePath,
  }).catch(() => ({ ok: false }) as const);
  if (!parsed.ok) {
    throw toRunAgentError('COMMAND_INVALID');
  }
  validateDirectCommandStartStepOrThrow(startStep, parsed.command.items.length);

  const { initialModelId, warnings } = await prepareDirectCommandBootstrap({
    agentName: params.agentName,
    commandName: params.commandName.trim(),
    agentHome: agent.home,
    configPath: agent.configPath,
    conversationId,
    commandFilePath: resolution.commandFilePath,
    startStep,
    source: params.source,
    workingFolder: effectiveWorkingFolder,
  });

  const result = await runAgentCommandRunner({
    agentName: params.agentName,
    agentHome: agent.home,
    commandsRoot: resolution.commandsRoot,
    commandFilePath: resolution.commandFilePath,
    commandName: params.commandName,
    startStep,
    conversationId,
    sourceId: resolution.selectedRepositoryPath,
    listIngestedRepositories:
      getEffectiveAgentServiceDeps().listIngestedRepositories,
    working_folder: effectiveWorkingFolder,
    signal: params.signal,
    source: params.source,
    initialModelId,
    lookupSummary: resolution.lookupSummary,
    runtimeLookupSummary: resolution.runtimeLookupSummary,
    runAgentInstructionUnlocked: (runParams) =>
      runAgentInstructionUnlocked({
        ...runParams,
        chatFactory: params.chatFactory,
      }),
  });
  const conversation = await getConversation(conversationId);
  return {
    ...result,
    providerId:
      (conversation?.provider as ChatProviderId | undefined) ?? 'codex',
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function runAgentInstructionUnlocked(params: {
  agentName: string;
  instruction: string;
  working_folder?: string;
  conversationId: string;
  mustExist?: boolean;
  startPathWasNewConversation?: boolean;
  command?: TurnCommandMetadata;
  runtime?: TurnRuntimeMetadata;
  envOverrides?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  source: 'REST' | 'MCP';
  inflightId?: string;
  chatFactory?: typeof getChatInterface;
  runToken?: string;
  cleanupInflightFn?: InstructionRuntimeCleanupFn;
  releaseConversationLockFn?: InstructionReleaseLockFn;
}): Promise<RunAgentInstructionResult> {
  const managesInstructionLifecycle =
    !params.command && typeof params.runToken === 'string';
  const cleanupInflightFn = params.cleanupInflightFn ?? cleanupInflight;
  const releaseConversationLockFn =
    params.releaseConversationLockFn ?? releaseConversationLock;

  const discovered = await discoverAgents();
  const agent = discovered.find((item) => item.name === params.agentName);
  if (!agent) {
    throw toRunAgentError('AGENT_NOT_FOUND');
  }

  const conversationId = params.conversationId;
  const runToken = params.runToken;
  let finalizedInstructionRuntime = false;
  let activeInflightId: string | undefined;

  const consumePendingInstructionStop = (inflightId: string) => {
    if (!managesInstructionLifecycle || !runToken) return false;
    const boundPending = bindPendingConversationCancelToInflight({
      conversationId,
      runToken,
      inflightId,
    });
    if (!boundPending.ok) {
      return boundPending.reason !== 'PENDING_CANCEL_NOT_FOUND';
    }

    const pendingCancel = consumePendingConversationCancel({
      conversationId,
      runToken,
      inflightId,
    });
    if (!pendingCancel) return false;

    return abortInflight({ conversationId, inflightId }).ok;
  };

  const finalizeInstructionRuntime = () => {
    if (
      !managesInstructionLifecycle ||
      !runToken ||
      finalizedInstructionRuntime
    )
      return;
    finalizedInstructionRuntime = true;

    const inflightState = activeInflightId
      ? getInflight(conversationId)
      : undefined;
    const activeInflight =
      inflightState && inflightState.inflightId === activeInflightId
        ? inflightState
        : undefined;

    try {
      if (activeInflight) {
        cleanupInflightFn({ conversationId, inflightId: activeInflightId });
      }
    } catch (cleanupError) {
      baseLogger.error(
        {
          agentName: params.agentName,
          conversationId,
          inflightId: activeInflightId,
          cleanupError,
        },
        'agents instruction cleanup failed; falling back to direct runtime cleanup',
      );
      if (activeInflightId) {
        cleanupInflight({ conversationId, inflightId: activeInflightId });
      }
    } finally {
      cleanupPendingConversationCancel({
        conversationId,
        runToken,
        inflightId: activeInflightId,
      });
      releaseConversationLockFn(conversationId, runToken);
    }
  };

  try {
    const existingConversation = await getConversation(conversationId);
    const isNewConversation = !existingConversation;
    const startedAsNewConversation =
      params.startPathWasNewConversation ?? isNewConversation;
    if (params.mustExist && isNewConversation) {
      throw toRunAgentError('AGENT_NOT_FOUND');
    }
    if (existingConversation?.archivedAt) {
      throw toRunAgentError('CONVERSATION_ARCHIVED');
    }
    if (
      existingConversation &&
      (existingConversation.agentName ?? '') !== params.agentName
    ) {
      throw toRunAgentError('AGENT_MISMATCH');
    }

    const effectiveWorkingFolder =
      params.working_folder ??
      (typeof existingConversation?.flags?.workingFolder === 'string'
        ? existingConversation.flags.workingFolder
        : undefined);
    const preparedExecution = await prepareDirectAgentExecution({
      agentName: params.agentName,
      configPath: agent.configPath,
      workingFolder: effectiveWorkingFolder,
      source: params.source,
      surface: params.source === 'MCP' ? 'mcp.agents.run' : 'agents.run',
      pinnedProviderId: existingConversation?.provider,
      pinnedModelId: existingConversation?.model,
      pinnedRequestedProviderId:
        getSavedRequestedProviderId(existingConversation),
      pinnedEndpointId: existingConversation?.flags?.endpointId,
      allowFallback: !existingConversation,
    });
    const executionProviderId = preparedExecution.executionProviderId;
    const modelId = preparedExecution.modelId;
    const title =
      params.instruction.trim().slice(0, 80) || 'Untitled conversation';
    const conversation = await persistDirectAgentConversation({
      conversationId,
      existingConversation,
      agentName: params.agentName,
      providerId: executionProviderId,
      modelId,
      requestedProviderId: preparedExecution.requestedProviderId,
      endpointId: preparedExecution.endpointId ?? null,
      title,
      source: params.source,
      workingFolder: effectiveWorkingFolder,
      threadId:
        executionProviderId === 'codex' &&
        typeof existingConversation?.flags?.threadId === 'string'
          ? existingConversation.flags.threadId
          : null,
    });

    let systemPrompt: string | undefined;
    if (isNewConversation && agent.systemPromptPath) {
      try {
        systemPrompt = await fs.readFile(agent.systemPromptPath, 'utf8');
      } catch {
        systemPrompt = undefined;
      }
    }

    const envOverrides: NodeJS.ProcessEnv = {
      CODEINFO_ROOT: codeInfo2RootForAgent(agent.home),
      ...(params.envOverrides ?? {}),
    };

    const resolvedChatFactory = params.chatFactory ?? getChatInterface;

    let chat;
    try {
      chat = resolvedChatFactory(
        executionProviderId,
        executionProviderId === 'copilot'
          ? { copilotEnv: { ...process.env, ...envOverrides } }
          : undefined,
      );
    } catch (err) {
      if (err instanceof UnsupportedProviderError) {
        throw new Error(err.message);
      }
      throw err;
    }

    const inflightId = params.inflightId ?? crypto.randomUUID();
    activeInflightId = inflightId;
    const nowIso = new Date().toISOString();
    createInflight({
      conversationId,
      inflightId,
      provider: executionProviderId,
      model: modelId,
      source: params.source,
      command: params.command,
      userTurn: { content: params.instruction, createdAt: nowIso },
      externalSignal: params.signal,
    });

    consumePendingInstructionStop(inflightId);

    append({
      level: 'info',
      message: 'DEV-0000021[T2] agents.inflight created',
      timestamp: nowIso,
      source: 'server',
      context: {
        conversationId,
        inflightId,
        provider: executionProviderId,
        model: modelId,
        source: params.source,
        userTurnCreatedAt: nowIso,
      },
    });

    publishUserTurn({
      conversationId,
      inflightId,
      content: params.instruction,
      createdAt: nowIso,
    });

    append({
      level: 'info',
      message: 'DEV-0000021[T2] agents.ws user_turn published',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        conversationId,
        inflightId,
        createdAt: nowIso,
        contentLen: params.instruction.length,
      },
    });

    const bridge = attachChatStreamBridge({
      conversationId,
      inflightId,
      provider: executionProviderId,
      model: modelId,
      chat,
    });

    const responder = new McpResponder();
    chat.on('analysis', (ev: ChatAnalysisEvent) => responder.handle(ev));
    chat.on('tool-result', (ev: ChatToolResultEvent) => responder.handle(ev));
    chat.on('final', (ev: ChatFinalEvent) => responder.handle(ev));
    chat.on('error', (ev) => responder.handle(ev));

    let runError: unknown;
    try {
      append({
        level: 'info',
        message: 'DEV-0000021[T2] agents.chat.run flags include inflightId',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          conversationId,
          inflightId,
          flagsInflightId: inflightId,
          provider: executionProviderId,
          model: modelId,
          source: params.source,
        },
      });

      consumePendingInstructionStop(inflightId);

      const shouldResumeCopilotSession =
        conversation.provider === 'copilot' && !startedAsNewConversation;
      const historyForRun =
        executionProviderId === 'codex'
          ? undefined
          : await loadTurnsChronological(conversationId);

      await chat.run(
        params.instruction,
        {
          provider: executionProviderId,
          inflightId,
          ...(executionProviderId === 'codex'
            ? {
                threadId:
                  typeof conversation.flags?.threadId === 'string'
                    ? conversation.flags.threadId
                    : undefined,
                useConfigDefaults: true,
                runtimeConfig: preparedExecution.runtimeConfig,
                forceWebSearchModeWhenUsingConfigDefaults:
                  shouldForceUnslothBuiltInWebSearch({
                    endpoint: preparedExecution.openAiCompatEndpoint,
                    runtimeConfig: preparedExecution.runtimeConfig,
                  })
                    ? 'live'
                    : undefined,
                workingDirectoryOverride:
                  preparedExecution.workingDirectoryOverride,
              }
            : {
                history: historyForRun,
                repositoryContext: preparedExecution.repositoryContext,
                ...(executionProviderId === 'copilot'
                  ? {
                      codeinfoOpenAiEndpoint:
                        preparedExecution.openAiCompatEndpoint,
                      copilotModels: preparedExecution.copilotModels,
                      resumeConversation: shouldResumeCopilotSession,
                      runtimeConfig: preparedExecution.runtimeConfig,
                      workingDirectoryOverride:
                        preparedExecution.workingDirectoryOverride,
                    }
                  : {}),
              }),
          envOverrides,
          disableSystemContext: true,
          systemPrompt,
          ...(managesInstructionLifecycle
            ? { deferInflightCleanup: true }
            : {}),
          signal: getInflight(conversationId)?.abortController.signal,
          source: params.source,
          ...(params.command ? { command: params.command } : {}),
          runtime: {
            ...(preparedExecution.executionContext.runtime ?? {}),
            ...(params.runtime ?? {}),
          },
        },
        conversationId,
        modelId,
      );
    } catch (err) {
      runError = err;
      throw err;
    } finally {
      bridge.cleanup();
      if (managesInstructionLifecycle) {
        const inflightState = getInflight(conversationId);
        const activeInflight =
          inflightState && inflightState.inflightId === inflightId
            ? inflightState
            : undefined;
        const cancelled = Boolean(
          activeInflight?.abortController.signal.aborted,
        );
        const errorMessage =
          runError instanceof Error ? runError.message : undefined;

        bridge.finalize({
          fallback: {
            status: cancelled ? 'stopped' : 'failed',
            threadId: null,
            ...(cancelled || !errorMessage
              ? {}
              : {
                  error: {
                    code: 'PROVIDER_ERROR',
                    message: errorMessage,
                  },
                }),
          },
        });
        finalizeInstructionRuntime();
      } else {
        const leftover = getInflight(conversationId);
        if (leftover && leftover.inflightId === inflightId) {
          cleanupInflight({ conversationId, inflightId });
        }
      }
    }

    const transientReconnectCount = responder.getTransientReconnectCount();
    if (transientReconnectCount > 0) {
      baseLogger.warn(
        {
          agentName: params.agentName,
          conversationId,
          modelId,
          commandName: params.command?.name,
          stepIndex: params.command?.stepIndex,
          totalSteps: params.command?.totalSteps,
          transientReconnectCount,
          transientReconnectLastMessage:
            responder.getTransientReconnectLastMessage(),
        },
        'transient reconnect events observed during agent run',
      );
    }

    const { segments } = responder.toResult(modelId, conversationId);
    return {
      agentName: params.agentName,
      conversationId,
      providerId: executionProviderId,
      modelId,
      segments,
      warnings:
        preparedExecution.warnings.length > 0
          ? [...preparedExecution.warnings]
          : undefined,
    };
  } catch (err) {
    finalizeInstructionRuntime();
    throw err;
  }
}

export type AgentCommandSummary = {
  name: string;
  description: string;
  disabled: boolean;
  stepCount: number;
  sourceId?: string;
  sourceLabel?: string;
};

export type AgentPromptSummary = {
  relativePath: string;
  fullPath: string;
};

const PROMPTS_SEGMENTS = ['.github', 'prompts'] as const;

async function resolveCaseInsensitiveDirectory(params: {
  root: string;
  segment: string;
}): Promise<string | null> {
  const entries = await fs
    .readdir(params.root, { withFileTypes: true })
    .catch((error) => {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw error;
    });
  if (!entries) return null;

  const wanted = params.segment.toLowerCase();
  for (const entry of entries) {
    if (entry.name.toLowerCase() !== wanted) continue;
    const abs = path.join(params.root, entry.name);
    const stat = await fs.lstat(abs).catch(() => null);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) continue;
    return abs;
  }
  return null;
}

async function resolvePromptsRoot(
  resolvedWorkingFolder: string,
): Promise<string | null> {
  let current = resolvedWorkingFolder;
  for (const segment of PROMPTS_SEGMENTS) {
    const next = await resolveCaseInsensitiveDirectory({
      root: current,
      segment,
    });
    if (!next) return null;
    current = next;
  }
  return current;
}

async function collectPromptMarkdownFiles(params: {
  promptsRoot: string;
}): Promise<AgentPromptSummary[]> {
  const prompts: AgentPromptSummary[] = [];
  const stack: string[] = [params.promptsRoot];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) break;
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(currentDir, entry.name);
      const stat = await fs.lstat(abs).catch(() => null);
      if (!stat || stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!stat.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.md')) continue;

      const fullPath = path.resolve(abs);
      const relFromRoot = path.relative(params.promptsRoot, fullPath);
      if (!relFromRoot || relFromRoot === '.') continue;
      if (path.isAbsolute(relFromRoot)) continue;
      if (relFromRoot.split(path.sep).some((segment) => segment === '..')) {
        continue;
      }

      const relativePath = relFromRoot.split(path.sep).join('/');
      if (path.posix.isAbsolute(relativePath)) continue;

      prompts.push({
        relativePath,
        fullPath,
      });
    }
  }

  prompts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return prompts;
}

export async function listAgentCommands(
  params: {
    agentName: string;
  },
  deps: {
    listIngestedRepositories?: typeof listIngestedRepositories;
  } = {},
): Promise<{ commands: AgentCommandSummary[] }> {
  const discovered = await discoverAgents();
  const agent = discovered.find((item) => item.name === params.agentName);
  if (!agent) throw toRunAgentError('AGENT_NOT_FOUND');

  const listCommandsFromDir = async (params: {
    commandsDir: string;
    sourceId?: string;
    sourceLabel?: string;
  }): Promise<AgentCommandSummary[]> => {
    const dirents = await fs
      .readdir(params.commandsDir, { withFileTypes: true })
      .catch((error) => {
        if ((error as { code?: string }).code === 'ENOENT') return null;
        throw error;
      });

    if (!dirents) return [];

    const jsonEntries = dirents.filter(
      (dirent) =>
        dirent.isFile() &&
        dirent.name.toLowerCase().endsWith('.json') &&
        dirent.name.length > '.json'.length,
    );

    const commands = await Promise.all(
      jsonEntries.map(async (dirent) => {
        const name = path.basename(dirent.name, path.extname(dirent.name));
        const filePath = path.join(params.commandsDir, dirent.name);
        const summary = await loadAgentCommandSummary({ filePath, name });
        if (params.sourceId && params.sourceLabel) {
          return {
            ...summary,
            sourceId: params.sourceId,
            sourceLabel: params.sourceLabel,
          } satisfies AgentCommandSummary;
        }
        return summary;
      }),
    );

    return commands;
  };

  const commandsDir = path.join(agent.home, 'commands');
  const localCommands = await listCommandsFromDir({ commandsDir });

  let ingestedCommands: AgentCommandSummary[] = [];
  const resolvedListIngestedRepositories =
    deps.listIngestedRepositories ?? listIngestedRepositories;
  const ingestRoots = await resolvedListIngestedRepositories()
    .then((result) => result.repos)
    .catch(() => null);

  if (ingestRoots) {
    const ingestResults = await Promise.all(
      ingestRoots.map(async (repo) => {
        const sourceId = repo.containerPath;
        const sourceLabel =
          repo.id?.trim() || path.posix.basename(sourceId.replace(/\\/g, '/'));
        if (!sourceLabel) return [];
        logTransitiveContractRead({
          consumer: 'agents.service.listAgentCommands',
          sourceId,
          repo,
        });
        const resolvedAgentHome = await resolveAgentHomeForRepository({
          repositoryRoot: sourceId,
          agentName: agent.name,
        });
        if (!resolvedAgentHome.home) return [];
        const ingestedCommandsDir = path.join(
          resolvedAgentHome.home,
          'commands',
        );
        return await listCommandsFromDir({
          commandsDir: ingestedCommandsDir,
          sourceId,
          sourceLabel,
        });
      }),
    );
    ingestedCommands = ingestResults.flat();
  }

  const commands = [...localCommands, ...ingestedCommands];
  const displayLabel = (command: AgentCommandSummary) =>
    command.sourceLabel
      ? `${command.name} - [${command.sourceLabel}]`
      : command.name;

  commands.sort((a, b) => displayLabel(a).localeCompare(displayLabel(b)));

  append({
    level: 'info',
    message: 'DEV-0000034:T1:commands_listed',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      agentName: params.agentName,
      localCount: localCommands.length,
      ingestedCount: ingestedCommands.length,
      totalCount: commands.length,
    },
  });

  append({
    level: 'info',
    message: 'DEV_0000040_T01_STEP_COUNT_RESPONSE',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      agentName: params.agentName,
      commandStepCounts: commands.map((command) => ({
        name: command.name,
        sourceLabel: command.sourceLabel ?? null,
        disabled: command.disabled,
        stepCount: command.stepCount,
      })),
    },
  });

  return { commands };
}

export async function listAgentPrompts(params: {
  agentName: string;
  working_folder: string;
}): Promise<{ prompts: AgentPromptSummary[] }> {
  const discovered = await discoverAgents();
  const agent = discovered.find((item) => item.name === params.agentName);
  if (!agent) throw toRunAgentError('AGENT_NOT_FOUND');

  const resolvedWorkingFolder = await resolveWorkingFolderWorkingDirectory(
    params.working_folder,
  );
  if (!resolvedWorkingFolder) {
    return { prompts: [] };
  }

  baseLogger.info(
    {
      agentName: params.agentName,
      workingFolder: resolvedWorkingFolder,
    },
    `[agents.prompts.discovery.start] agentName=${params.agentName} workingFolder=${resolvedWorkingFolder}`,
  );

  const promptsRoot = await resolvePromptsRoot(resolvedWorkingFolder);
  if (!promptsRoot) {
    baseLogger.info(
      {
        reason: 'prompts_dir_missing_or_no_markdown',
        workingFolder: resolvedWorkingFolder,
      },
      '[agents.prompts.discovery.empty] reason=prompts_dir_missing_or_no_markdown',
    );
    return { prompts: [] };
  }

  const prompts = await collectPromptMarkdownFiles({ promptsRoot });
  if (prompts.length === 0) {
    baseLogger.info(
      {
        reason: 'prompts_dir_missing_or_no_markdown',
        promptsRoot,
      },
      '[agents.prompts.discovery.empty] reason=prompts_dir_missing_or_no_markdown',
    );
    return { prompts: [] };
  }

  baseLogger.info(
    {
      promptsRoot,
      promptsCount: prompts.length,
    },
    `[agents.prompts.discovery.complete] promptsRoot=${promptsRoot} promptsCount=${prompts.length}`,
  );
  return { prompts };
}
