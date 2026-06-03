import crypto from 'node:crypto';
import path from 'node:path';

import type { ModelInfo } from '@github/copilot-sdk';
import type { LMStudioClient } from '@lmstudio/sdk';
import type { CodexOptions } from '@openai/codex-sdk';
import { Router, json } from 'express';

import {
  getActiveRunOwnership,
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../agents/runLock.js';
import { buildConversationFlags } from '../chat/agentFlags.js';
import { attachChatStreamBridge } from '../chat/chatStreamBridge.js';
import { CopilotLifecycle } from '../chat/copilotLifecycle.js';
import {
  normalizeImplicitCopilotRequestedModel,
} from '../chat/copilotModelSupport.js';
import { UnsupportedProviderError, getChatInterface } from '../chat/factory.js';
import {
  abortInflight,
  bindPendingConversationCancelToInflight,
  cleanupPendingConversationCancel,
  cleanupInflight,
  consumePendingConversationCancel,
  createInflight,
  getCompletedInflight,
  getInflight,
} from '../chat/inflightRegistry.js';
import type { ChatInterface } from '../chat/interfaces/ChatInterface.js';
import type { CodexLike } from '../chat/interfaces/ChatInterfaceCodex.js';
import {
  getMemoryTurns,
  memoryConversations,
  shouldUseMemoryPersistence,
} from '../chat/memoryPersistence.js';
import {
  resolveOpenAiCompatEndpointRuntimeState,
} from '../chat/openaiCompatModelDiscovery.js';
import {
  resolveCodexCapabilities,
  type CodexCapabilityResolution,
} from '../codex/capabilityResolver.js';
import {
  buildUnavailableRuntimeProviderState,
  prioritizeRuntimeProviderModels,
  resolveProviderRuntimePreferredModel,
  resolveCodexChatDefaults,
  resolveRuntimeProviderSelection,
  type ChatDefaultProvider,
} from '../config/chatDefaults.js';
import { applyCodexOpenAiCompatEndpointToRuntimeConfig } from '../config/codexConfig.js';
import {
  type OpenAiCompatEndpointConfig,
  parseOpenAiCompatEndpointConfig,
  validateOpenAiCompatEndpointConfigForProvider,
} from '../config/openaiCompatEndpoints.js';
import {
  RuntimeConfigResolutionError,
  getProviderBootstrapStatus,
  loadProviderChatDefaultsSnapshotSync,
  materializeRepositoryBackedCodexChatHome,
  resolveChatRuntimeConfig,
} from '../config/runtimeConfig.js';
import { resolveExternalOpenAiCompatEndpoints } from '../config/startupEnv.js';
import { listIngestedRepositories } from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { baseLogger, resolveLogConfig } from '../logger.js';
import { ConversationModel, type Conversation } from '../mongo/conversation.js';
import { createConversation, updateConversationMeta } from '../mongo/repo.js';
import { TurnModel, type Turn } from '../mongo/turn.js';
import { getCodexDetection } from '../providers/codexRegistry.js';
import { resolveCopilotReadiness } from '../providers/copilotReadiness.js';
import { getMcpStatus } from '../providers/mcpStatus.js';
import { resolveSharedExecutionContext } from '../workingFolders/executionContext.js';
import {
  appendWorkingFolderDecisionLog,
  getConversationRecordType,
  getWorkingFolderClientMessage,
  resolveKnownRepositoryPathsState,
  restoreSavedWorkingFolder,
} from '../workingFolders/state.js';
import { publishUserTurn } from '../ws/server.js';
import {
  ChatValidationError,
  resolveChatAgentFlagsForProvider,
  validateChatRequest,
} from './chatValidators.js';
import { BASE_URL_REGEX, scrubBaseUrl } from './lmstudioUrl.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
type ToolFactory = (opts: Record<string, unknown>) => {
  tools: ReadonlyArray<unknown>;
};
type CodexFactory = (options?: CodexOptions) => CodexLike;

const T06_SUCCESS_LOG =
  '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=success';
const T06_ERROR_LOG =
  '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=error';
const TASK7_LOG_MARKER = 'DEV_0000040_T07_REST_DEFAULTS_APPLIED';

type LMContentItem =
  | { type: 'text'; text: string }
  | {
      type: 'toolCallRequest';
      toolCallRequest: {
        id: string;
        type: 'function';
        arguments: Record<string, unknown>;
        name: string;
      };
    }
  | {
      type: 'toolCallResult';
      toolCallId: string;
      content: string;
    };

type LMMessage = {
  data?: { role?: string; content?: LMContentItem[] };
  mutable?: boolean;
  role?: string; // fallback
  content?: unknown; // fallback
};

export const getMessageRole = (message: unknown): string | undefined => {
  const msg = message as LMMessage;
  return msg.data?.role ?? msg.role;
};

export const getContentItems = (message: unknown): LMContentItem[] => {
  const msg = message as LMMessage;
  const items = msg.data?.content;
  return Array.isArray(items) ? (items as LMContentItem[]) : [];
};

const toWebSocketUrl = (value: string) => {
  if (value.startsWith('http://')) return value.replace(/^http:/i, 'ws:');
  if (value.startsWith('https://')) return value.replace(/^https:/i, 'wss:');
  return value;
};

const omitCodexRuntimeModelForConfigDefaults = (
  runtimeConfig: CodexOptions['config'],
): CodexOptions['config'] => {
  if (!runtimeConfig || typeof runtimeConfig !== 'object') {
    return runtimeConfig;
  }

  const nextConfig = { ...(runtimeConfig as Record<string, unknown>) };
  delete nextConfig.model;
  return nextConfig as CodexOptions['config'];
};

function resolvePinnedOpenAiCompatEndpoint(params: {
  provider: ChatDefaultProvider;
  codexHome?: string;
  copilotHome?: string;
}): OpenAiCompatEndpointConfig | undefined {
  try {
    const snapshot = loadProviderChatDefaultsSnapshotSync({
      provider: params.provider,
      codexHome: params.codexHome,
      copilotHome: params.copilotHome,
    });
    const rawEndpoint = snapshot.config?.codeinfo_openai_endpoint;
    if (typeof rawEndpoint !== 'string') {
      return undefined;
    }

    return parseOpenAiCompatEndpointConfig(rawEndpoint, {
      pathLabel: `${snapshot.chatConfigPath}.codeinfo_openai_endpoint`,
    });
  } catch {
    return undefined;
  }
}

function resolveOpenAiCompatEndpointForChat(params: {
  provider: ChatDefaultProvider;
  endpointId?: string | null;
  codexHome?: string;
  copilotHome?: string;
  env?: NodeJS.ProcessEnv;
}): OpenAiCompatEndpointConfig | undefined {
  const normalizedEndpointId = params.endpointId?.trim();
  if (!normalizedEndpointId) {
    return undefined;
  }

  const envResolution = resolveExternalOpenAiCompatEndpoints({
    env: params.env ?? process.env,
  });
  const pinnedEndpoint = resolvePinnedOpenAiCompatEndpoint({
    provider: params.provider,
    codexHome: params.codexHome,
    copilotHome: params.copilotHome,
  });

  const endpoint = [...envResolution.endpoints, ...(pinnedEndpoint ? [pinnedEndpoint] : [])].find(
    (entry) => entry.endpointId === normalizedEndpointId,
  );
  if (!endpoint) {
    return undefined;
  }

  validateOpenAiCompatEndpointConfigForProvider({
    endpoint,
    provider: params.provider,
    pathLabel: 'chat.endpointId',
  });
  return endpoint;
}

const buildRuntimeSelectionWarning = (params: {
  executionPath: 'configured_endpoint' | 'same_endpoint_repair' | 'same_provider_native_fallback' | 'cross_provider_fallback' | 'unavailable';
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
      return `Endpoint "${params.endpointId ?? 'unknown'}" was unavailable; falling back to native ${params.executionProvider} model "${params.executionModel}".`;
    case 'cross_provider_fallback':
      return `Endpoint "${params.endpointId ?? 'unknown'}" was unavailable; fell back to provider "${params.executionProvider}" model "${params.executionModel}".`;
    case 'unavailable':
      return (
        params.endpointReason ??
        params.requestedReason ??
        params.fallbackReason ??
        `Endpoint "${params.endpointId ?? 'unknown'}" is unavailable.`
      );
    case 'configured_endpoint':
    default:
      return undefined;
  }
};

const isChatModel = (model: { type?: string; architecture?: string }) => {
  const kind = (model.type ?? '').toLowerCase();
  return kind !== 'embedding' && kind !== 'vector';
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

const applyBootstrapStatusToRuntimeProviderState = <
  T extends {
    available: boolean;
    reason?: string;
    models: string[];
  },
>(
  provider: ChatDefaultProvider,
  state: T,
): T => {
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

function buildCompletedReplayResponse(params: {
  conversationId: string;
  inflightId: string;
  finalStatus?: 'ok' | 'stopped' | 'failed';
}) {
  return {
    status: 'error' as const,
    code: 'INFLIGHT_ALREADY_COMPLETED' as const,
    message:
      'This inflightId has already completed for the conversation and cannot be replayed.',
    conversationId: params.conversationId,
    inflightId: params.inflightId,
    replayed: true,
    finalStatus: params.finalStatus ?? 'ok',
  };
}

export function createChatRouter({
  clientFactory,
  codexFactory,
  toolFactory,
  chatFactory = getChatInterface,
  listIngestedRepositoriesFn = listIngestedRepositories,
  codexCapabilityResolver = resolveCodexCapabilities,
  cleanupInflightFn = cleanupInflight,
  releaseConversationLockFn = releaseConversationLock,
  copilotLifecycleFactory,
}: {
  clientFactory: ClientFactory;
  codexFactory?: CodexFactory;
  toolFactory?: ToolFactory;
  chatFactory?: typeof getChatInterface;
  listIngestedRepositoriesFn?: typeof listIngestedRepositories;
  codexCapabilityResolver?: (options: {
    consumer: 'chat_models' | 'chat_validation';
  }) => Promise<CodexCapabilityResolution>;
  cleanupInflightFn?: typeof cleanupInflight;
  releaseConversationLockFn?: typeof releaseConversationLock;
  copilotLifecycleFactory?: (params?: {
    env?: NodeJS.ProcessEnv;
  }) => CopilotLifecycle;
}) {
  const router = Router();
  const { maxClientBytes } = resolveLogConfig();
  router.use(json({ limit: `${maxClientBytes}b`, strict: false }));

  router.post('/', async (req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const rawBody = req.body ?? {};
    const rawSize = JSON.stringify(rawBody).length;
    if (rawSize > maxClientBytes) {
      return res.status(400).json({
        status: 'error',
        code: 'VALIDATION_FAILED',
        message: 'payload too large',
      });
    }

    let validatedBody;
    const knownRepositoryPathsState = await resolveKnownRepositoryPathsState(
      async () =>
        (await listIngestedRepositoriesFn()).repos.map((repo) =>
          path.resolve(repo.containerPath),
        ),
    );
    try {
      validatedBody = await validateChatRequest(rawBody, {
        codexCapabilityResolver,
        knownRepositoryPathsState,
      });
    } catch (err) {
      if (err instanceof ChatValidationError) {
        if (err.code === 'PROVIDER_UNAVAILABLE') {
          return res.status(503).json({
            status: 'error',
            code: 'PROVIDER_UNAVAILABLE',
            message: err.message,
          });
        }
        return res.status(400).json({
          status: 'error',
          code: 'VALIDATION_FAILED',
          message: err.message,
        });
      }
      const workingFolderError = err as { code?: string; reason?: string };
      if (
        workingFolderError.code === 'WORKING_FOLDER_UNAVAILABLE' ||
        workingFolderError.code === 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE'
      ) {
        return res.status(503).json({
          status: 'error',
          code: workingFolderError.code,
          message: getWorkingFolderClientMessage(workingFolderError),
        });
      }
      throw err;
    }

    const {
      model,
      message,
      provider,
      conversationId,
      endpointId,
      threadId,
      inflightId: requestedInflightId,
      working_folder: requestedWorkingFolder,
      rawAgentFlags,
      agentFlags,
      warnings,
      defaultsResolution,
    } = validatedBody;

    const now = new Date();
    const defaultsLogContext = {
      requestId,
      conversationId,
      provider,
      model,
      endpointId,
      providerSource: defaultsResolution.providerSource,
      modelSource: defaultsResolution.modelSource,
      requestedProvider: defaultsResolution.requestedProvider,
      requestedModel: defaultsResolution.requestedModel,
      envProviderPresent:
        typeof process.env.CODEINFO_CHAT_DEFAULT_PROVIDER === 'string' &&
        process.env.CODEINFO_CHAT_DEFAULT_PROVIDER.trim().length > 0,
      envModelPresent:
        typeof process.env.CODEINFO_CHAT_DEFAULT_MODEL === 'string' &&
        process.env.CODEINFO_CHAT_DEFAULT_MODEL.trim().length > 0,
    };
    append({
      level: 'info',
      message: 'DEV-0000035:T1:defaults_resolution_evaluated',
      timestamp: now.toISOString(),
      source: 'server',
      requestId,
      context: defaultsLogContext,
    });
    baseLogger.info(
      defaultsLogContext,
      'DEV-0000035:T1:defaults_resolution_evaluated',
    );
    append({
      level: 'info',
      message: 'DEV-0000035:T1:defaults_resolution_result',
      timestamp: now.toISOString(),
      source: 'server',
      requestId,
      context: defaultsLogContext,
    });
    baseLogger.info(
      defaultsLogContext,
      'DEV-0000035:T1:defaults_resolution_result',
    );

    const requestedProvider = provider as ChatDefaultProvider;
    const requestedModel = model;
    const loadExistingConversation = async (): Promise<Conversation | null> =>
      shouldUseMemoryPersistence()
        ? (memoryConversations.get(conversationId) ?? null)
        : (((await ConversationModel.findById(conversationId)
            .lean()
            .exec()) as Conversation | null) ?? null);
    let existingConversation = await loadExistingConversation();
    if (existingConversation?.archivedAt) {
      return res.status(410).json({
        status: 'error',
        code: 'CONVERSATION_ARCHIVED',
        message: 'Conversation is archived and must be restored before use.',
      });
    }

    const resumedExecutionIdentity =
      existingConversation?.provider && existingConversation?.model
        ? {
            provider: existingConversation.provider as ChatDefaultProvider,
            model: existingConversation.model,
            endpointId:
              typeof existingConversation.flags?.endpointId === 'string' &&
              existingConversation.flags.endpointId.trim().length > 0
                ? existingConversation.flags.endpointId.trim()
                : undefined,
          }
        : null;
    const effectiveRequestedProvider =
      resumedExecutionIdentity?.provider ?? requestedProvider;
    const effectiveRequestedModel =
      resumedExecutionIdentity?.model ?? requestedModel;
    const explicitProviderSelected =
      resumedExecutionIdentity !== null ||
      defaultsResolution.providerSource === 'request';
    const baseUrl = process.env.CODEINFO_LMSTUDIO_BASE_URL ?? '';

    if (
      typeof requestedInflightId === 'string' &&
      requestedInflightId.length > 0
    ) {
      const completedReplay = getCompletedInflight({
        conversationId,
        inflightId: requestedInflightId,
      });
      if (completedReplay) {
        return res.status(409).json(
          buildCompletedReplayResponse({
            conversationId,
            inflightId: requestedInflightId,
            finalStatus: completedReplay.finalStatus,
          }),
        );
      }
    }
    const safeBase = scrubBaseUrl(baseUrl);
    const codexHome = process.env.CODEINFO_CODEX_HOME ?? process.env.CODEX_HOME;

    const codexDetection = getCodexDetection();
    const codexCapabilities = await codexCapabilityResolver({
      consumer: 'chat_validation',
    });
    const codexPreferredDefaults = await resolveCodexChatDefaults({
      codexHome,
    });
    const codexState = applyBootstrapStatusToRuntimeProviderState('codex', {
      available: codexDetection.available,
      models: prioritizeRuntimeProviderModels(
        codexCapabilities.models.map((entry) => entry.model),
        effectiveRequestedProvider === 'codex'
          ? effectiveRequestedModel
          : codexPreferredDefaults.values.model,
        { includeMissingPreferred: true },
      ),
      reason: codexDetection.reason ?? 'codex unavailable',
    });
    const mcp = await getMcpStatus();

    let lmstudioState = buildUnavailableRuntimeProviderState(
      explicitProviderSelected && effectiveRequestedProvider !== 'lmstudio'
        ? 'lmstudio probe skipped for explicit provider request'
        : 'lmstudio unavailable',
    );
    if (
      !explicitProviderSelected ||
      effectiveRequestedProvider === 'lmstudio'
    ) {
      if (!BASE_URL_REGEX.test(baseUrl)) {
        lmstudioState = buildUnavailableRuntimeProviderState(
          'lmstudio unavailable',
        );
      } else {
        try {
          const client = clientFactory(toWebSocketUrl(baseUrl));
          const models = await client.system.listDownloadedModels();
          const lmstudioModels = models
            .filter(isChatModel)
            .map((entry) => entry.modelKey)
            .filter(
              (value) => typeof value === 'string' && value.trim().length,
            );
          const lmstudioPreferredModel = resolveProviderRuntimePreferredModel({
            provider: 'lmstudio',
            lmstudioHome: process.env.CODEINFO_LMSTUDIO_HOME,
          }).model;
          lmstudioState =
            lmstudioModels.length > 0
              ? {
                  available: true,
                  models: prioritizeRuntimeProviderModels(
                    lmstudioModels,
                    lmstudioPreferredModel,
                  ),
                }
              : buildUnavailableRuntimeProviderState('lmstudio unavailable');
        } catch {
          lmstudioState = buildUnavailableRuntimeProviderState(
            'lmstudio unavailable',
          );
        }
      }
    }
    lmstudioState = applyBootstrapStatusToRuntimeProviderState(
      'lmstudio',
      lmstudioState,
    );
    const copilotReadiness =
      !explicitProviderSelected || effectiveRequestedProvider === 'copilot'
        ? await resolveCopilotReadiness({
            createRuntime: copilotLifecycleFactory
              ? () => copilotLifecycleFactory()
              : undefined,
            env: process.env,
            toolsAvailable: mcp.available,
            toolsReason: mcp.reason,
          })
        : {
            available: false,
            toolsAvailable: mcp.available,
            reason: 'copilot probe skipped for explicit provider request',
            blockingStage: 'connectivity' as const,
            models: [],
            modelsRaw: [],
            authSource: 'unauthenticated' as const,
          };
    const normalizedRequestedModel =
      effectiveRequestedProvider === 'copilot'
        ? normalizeImplicitCopilotRequestedModel({
            models: copilotReadiness.modelsRaw as ModelInfo[],
            requestedModel: effectiveRequestedModel,
            requestedModelSource: defaultsResolution.modelSource,
          })
        : effectiveRequestedModel;
    const copilotState = applyBootstrapStatusToRuntimeProviderState('copilot', {
      available: copilotReadiness.available,
      models: [...copilotReadiness.models],
      reason: copilotReadiness.reason,
    });

    const pinnedSelectedEndpoint = resolvePinnedOpenAiCompatEndpoint({
      provider: effectiveRequestedProvider,
      codexHome,
      copilotHome: process.env.CODEINFO_COPILOT_HOME,
    });
    const selectedEndpointId =
      resumedExecutionIdentity?.endpointId ??
      endpointId ??
      pinnedSelectedEndpoint?.endpointId ??
      undefined;
    let selectedOpenAiCompatEndpoint:
      | OpenAiCompatEndpointConfig
      | undefined;
    try {
      selectedOpenAiCompatEndpoint = resolveOpenAiCompatEndpointForChat({
        provider: effectiveRequestedProvider,
        endpointId: selectedEndpointId,
        codexHome,
        copilotHome: process.env.CODEINFO_COPILOT_HOME,
        env: process.env,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'endpointId validation failed';
      return res.status(400).json({
        status: 'error',
        code: 'VALIDATION_FAILED',
        message,
      });
    }
    if (selectedEndpointId && !selectedOpenAiCompatEndpoint) {
      return res.status(400).json({
        status: 'error',
        code: 'VALIDATION_FAILED',
        message: `endpointId "${selectedEndpointId}" does not match a configured external endpoint for provider "${effectiveRequestedProvider}"`,
      });
    }

    const selectedOpenAiCompatEndpointState =
      selectedOpenAiCompatEndpoint !== undefined
        ? await resolveOpenAiCompatEndpointRuntimeState({
            endpoint: selectedOpenAiCompatEndpoint,
          })
        : undefined;
    const resolvedEndpointUnavailable =
      selectedEndpointId !== undefined &&
      (selectedOpenAiCompatEndpointState === undefined ||
        !selectedOpenAiCompatEndpointState.available);
    const runtimeEndpointState =
      selectedOpenAiCompatEndpointState ??
      (resolvedEndpointUnavailable
        ? {
            endpointId: selectedEndpointId,
            available: false,
            models: [],
            reason: `Endpoint "${selectedEndpointId}" is unavailable.`,
          }
        : undefined);
    const runtimeRequestedModel =
      resolvedEndpointUnavailable && effectiveRequestedProvider === 'codex'
        ? codexPreferredDefaults.values.model
        : normalizedRequestedModel;
    const runtimeSelection = resolveRuntimeProviderSelection({
      requestedProvider: effectiveRequestedProvider,
      requestedModel: runtimeRequestedModel,
      endpoint: runtimeEndpointState,
      failInPlaceOnEndpointUnavailable: Boolean(
        resumedExecutionIdentity?.endpointId &&
          resumedExecutionIdentity.endpointId === selectedEndpointId,
      ),
      allowCrossProviderFallback:
        !explicitProviderSelected || effectiveRequestedProvider !== 'lmstudio',
      codex: codexState,
      copilot: copilotState,
      lmstudio: lmstudioState,
    });
    const executionProvider = runtimeSelection.executionProvider;
    const executionModel = runtimeSelection.executionModel;

    const runtimeSelectionWarning = buildRuntimeSelectionWarning({
      executionPath: runtimeSelection.executionPath,
      requestedProvider: runtimeSelection.requestedProvider,
      executionProvider: runtimeSelection.executionProvider,
      requestedModel: runtimeSelection.requestedModel,
      executionModel: runtimeSelection.executionModel,
      endpointId: runtimeSelection.endpointId,
      endpointReason: runtimeSelection.endpointReason,
      requestedReason: runtimeSelection.requestedReason,
      fallbackReason: runtimeSelection.fallbackReason,
    });
    const responseWarnings = mergeWarningMessages(
      warnings,
      runtimeSelectionWarning ? [runtimeSelectionWarning] : undefined,
    );
    if (threadId && executionProvider !== 'codex') {
      return res.status(400).json({
        status: 'error',
        code: 'VALIDATION_FAILED',
        message: `threadId is not supported for provider "${executionProvider}"`,
      });
    }

    let resolvedAgentFlags;
    try {
      resolvedAgentFlags =
        resumedExecutionIdentity !== null ||
        executionProvider !== provider ||
        executionModel !== model
          ? await resolveChatAgentFlagsForProvider({
              provider: executionProvider,
              rawAgentFlags,
              model: executionModel,
              codexCapabilities:
                executionProvider === 'codex' ? codexCapabilities : undefined,
              codexCapabilityResolver,
            })
          : { agentFlags, warnings: [] };
    } catch (error) {
      if (error instanceof ChatValidationError) {
        return res.status(400).json({
          status: 'error',
          code: 'VALIDATION_FAILED',
          message: error.message,
        });
      }
      throw error;
    }

    const effectiveAgentFlags = { ...resolvedAgentFlags.agentFlags };
    const responseWarningsWithAgentFlags = mergeWarningMessages(
      responseWarnings,
      resolvedAgentFlags.warnings,
    );
    const effectiveCodexFlags =
      executionProvider === 'codex'
        ? {
            sandboxMode: effectiveAgentFlags.sandboxMode,
            networkAccessEnabled: effectiveAgentFlags.networkAccessEnabled,
            webSearchMode: effectiveAgentFlags.webSearchMode,
            approvalPolicy: effectiveAgentFlags.approvalPolicy,
            modelReasoningEffort: effectiveAgentFlags.modelReasoningEffort,
            modelReasoningSummary: effectiveAgentFlags.modelReasoningSummary,
            modelVerbosity: effectiveAgentFlags.modelVerbosity,
          }
        : {};
    console.info(TASK7_LOG_MARKER, {
      surface: '/chat',
      provider: executionProvider,
      warningCount: responseWarningsWithAgentFlags.length,
      defaultsResolution,
    });
    const executionUsesEndpoint =
      runtimeSelection.executionPath === 'configured_endpoint' ||
      runtimeSelection.executionPath === 'same_endpoint_repair';

    let chatRuntimeConfig: CodexOptions['config'];

    if (executionProvider === 'codex') {
      try {
        const { config } = await resolveChatRuntimeConfig();
        chatRuntimeConfig = executionUsesEndpoint
          ? applyCodexOpenAiCompatEndpointToRuntimeConfig(
              config as CodexOptions['config'],
              selectedOpenAiCompatEndpoint,
            )
          : (config as CodexOptions['config']);
        console.info(T06_SUCCESS_LOG, {
          surface: '/chat',
          provider: 'codex',
          hasModel: typeof config.model === 'string',
        });
      } catch (error) {
        const code =
          error instanceof RuntimeConfigResolutionError
            ? error.code
            : 'UNKNOWN_ERROR';
        console.error(`${T06_ERROR_LOG} surface=/chat code=${code}`);
        return res.status(500).json({
          status: 'error',
          code,
          message:
            error instanceof Error
              ? error.message
              : 'chat runtime config resolution failed',
        });
      }
    }

    const fallbackLogContext = {
      requestId,
      conversationId,
      requestedProvider: runtimeSelection.requestedProvider,
      requestedModel: runtimeSelection.requestedModel,
      executionProvider: runtimeSelection.executionProvider,
      executionModel: runtimeSelection.executionModel,
      runtimePath: runtimeSelection.executionPath,
      fallbackApplied: runtimeSelection.fallbackApplied,
      decision: runtimeSelection.decision,
      requestedReason: runtimeSelection.requestedReason,
      fallbackReason: runtimeSelection.fallbackReason,
      lmstudioModelCount: lmstudioState.models.length,
      baseUrl: safeBase,
    };
    append({
      level: 'info',
      message: 'DEV-0000035:T2:provider_fallback_evaluated',
      timestamp: now.toISOString(),
      source: 'server',
      requestId,
      context: fallbackLogContext,
    });
    baseLogger.info(
      fallbackLogContext,
      'DEV-0000035:T2:provider_fallback_evaluated',
    );
    append({
      level: 'info',
      message: 'DEV-0000035:T2:provider_fallback_result',
      timestamp: now.toISOString(),
      source: 'server',
      requestId,
      context: fallbackLogContext,
    });
    baseLogger.info(
      fallbackLogContext,
      'DEV-0000035:T2:provider_fallback_result',
    );

    const existingConversationEndpointId =
      typeof existingConversation?.flags?.endpointId === 'string' &&
      existingConversation.flags.endpointId.trim().length > 0
        ? existingConversation.flags.endpointId.trim()
        : undefined;
    const shouldResumeCopilotSession =
      existingConversation?.provider === 'copilot' &&
      existingConversation.model === executionModel &&
      existingConversationEndpointId === selectedEndpointId;
    let effectiveWorkingFolder = requestedWorkingFolder;
    try {
      if (!effectiveWorkingFolder && existingConversation) {
        effectiveWorkingFolder = await restoreSavedWorkingFolder({
          conversation: existingConversation,
          surface: 'chat_run',
          clearPersistedWorkingFolder: async (
            id,
            expectedWorkingFolder,
          ): Promise<string | undefined> => {
            const trimmedExpectedWorkingFolder = expectedWorkingFolder?.trim();
            if (trimmedExpectedWorkingFolder) {
              const currentWorkingFolder = shouldUseMemoryPersistence()
                ? memoryConversations.get(id)?.flags?.workingFolder?.trim()
                : (
                    await ConversationModel.findById(id).lean().exec()
                  )?.flags?.workingFolder?.trim();
              if (currentWorkingFolder !== trimmedExpectedWorkingFolder) {
                return currentWorkingFolder ?? undefined;
              }
            }
            const nextFlags = { ...(existingConversation?.flags ?? {}) };
            delete nextFlags.workingFolder;
            existingConversation = {
              ...existingConversation!,
              flags: nextFlags,
            } as Conversation;
            void id;
            return existingConversation.flags?.workingFolder?.trim();
          },
          knownRepositoryPathsState,
        });
      }
    } catch (err) {
      const workingFolderError = err as { code?: string; reason?: string };
      if (
        workingFolderError.code === 'WORKING_FOLDER_UNAVAILABLE' ||
        workingFolderError.code === 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE'
      ) {
        return res.status(503).json({
          status: 'error',
          code: workingFolderError.code,
          message: getWorkingFolderClientMessage(workingFolderError),
        });
      }
      throw err;
    }

    const executionContext = await resolveSharedExecutionContext({
      workingFolder: effectiveWorkingFolder,
    });
    const envOverrides: NodeJS.ProcessEnv = {
      CODEINFO_ROOT: executionContext.repositoryMetadata.selectedRepositoryPath,
    };
    const repositoryBackedCodexRun =
      executionProvider === 'codex' &&
      executionContext.repositoryMetadata.workingRepositoryAvailable;
    let repositoryBackedCodexHome: string | undefined;

    const ensureConversation = async (): Promise<Conversation | null> => {
      const buildRuntimeConversationFlags = (
        currentFlags: Record<string, unknown> | undefined,
      ) => {
        const currentEndpointId =
          typeof currentFlags?.endpointId === 'string' &&
          currentFlags.endpointId.trim().length > 0
            ? currentFlags.endpointId.trim()
            : undefined;
        const persistedEndpointId = executionUsesEndpoint
          ? selectedEndpointId ?? currentEndpointId ?? null
          : null;
        const persistedThreadId =
          threadId ??
          (executionProvider === 'codex' &&
          existingConversation?.provider === 'codex' &&
          existingConversation?.model === executionModel &&
          typeof currentFlags?.threadId === 'string' &&
          currentFlags.threadId.trim()
            ? currentFlags.threadId.trim()
            : null);

        return buildConversationFlags({
          provider: executionProvider,
          currentFlags,
          agentFlags: effectiveAgentFlags,
          workingFolder: effectiveWorkingFolder,
          endpointId: persistedEndpointId,
          threadId: persistedThreadId,
          preserveFlowState: false,
        });
      };

      if (shouldUseMemoryPersistence()) {
        const existing =
          existingConversation ??
          memoryConversations.get(conversationId) ??
          null;
        if (existing?.archivedAt) return null;

        if (!existing) {
          const created: Conversation = {
            _id: conversationId,
            provider: executionProvider,
            model: executionModel,
            title: message.trim().slice(0, 80) || 'Untitled conversation',
            source: 'REST',
            flags: buildRuntimeConversationFlags(undefined),
            lastMessageAt: now,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
          } as Conversation;
          memoryConversations.set(conversationId, created);
          return created;
        }

        const updated: Conversation = {
          ...existing,
          provider: executionProvider,
          model: executionModel,
          flags: buildRuntimeConversationFlags(existing.flags),
          source: existing.source ?? 'REST',
          lastMessageAt: now,
          updatedAt: now,
        } as Conversation;
        memoryConversations.set(conversationId, updated);
        return updated;
      }

      const existing =
        existingConversation ??
        ((await ConversationModel.findById(conversationId)
          .lean()
          .exec()) as Conversation | null);
      if (existing?.archivedAt) return null;

      if (!existing) {
        await createConversation({
          conversationId,
          provider: executionProvider,
          model: executionModel,
          title: message.trim().slice(0, 80) || 'Untitled conversation',
          source: 'REST',
          flags: buildRuntimeConversationFlags(undefined),
          lastMessageAt: now,
        });
        const created = (await ConversationModel.findById(conversationId)
          .lean()
          .exec()) as Conversation | null;
        return created;
      }

      await updateConversationMeta({
        conversationId,
        provider: executionProvider,
        model: executionModel,
        flags: buildRuntimeConversationFlags(
          existing.flags,
        ),
        lastMessageAt: now,
      });
      const updated = (await ConversationModel.findById(conversationId)
        .lean()
        .exec()) as Conversation | null;
      return updated ?? existing;
    };

    const loadTurnsChronological = async (): Promise<Turn[]> =>
      shouldUseMemoryPersistence()
        ? getMemoryTurns(conversationId)
        : ((await TurnModel.find({ conversationId })
            .sort({ createdAt: 1, _id: 1 })
            .lean()
            .exec()) as Turn[]);

    responseWarningsWithAgentFlags.forEach((warning) => {
      append({
        level: 'warn',
        message: 'chat validation warning',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { provider: executionProvider, warning },
      });
      baseLogger.warn(
        { requestId, provider: executionProvider, warning },
        'chat validation warning',
      );
    });

    if (runtimeSelection.unavailable) {
      const message =
        runtimeSelection.requestedReason ?? 'provider unavailable';
      return res.status(503).json({
        status: 'error',
        code: 'PROVIDER_UNAVAILABLE',
        message,
      });
    }

    if (!tryAcquireConversationLock(conversationId)) {
      if (
        typeof requestedInflightId === 'string' &&
        requestedInflightId.length > 0
      ) {
        const activeInflight = getInflight(conversationId);
        if (
          activeInflight?.inflightId === requestedInflightId &&
          activeInflight.finalStatus
        ) {
          return res.status(409).json(
            buildCompletedReplayResponse({
              conversationId,
              inflightId: requestedInflightId,
              finalStatus: activeInflight.finalStatus,
            }),
          );
        }

        const completedReplay = getCompletedInflight({
          conversationId,
          inflightId: requestedInflightId,
        });
        if (completedReplay) {
          return res.status(409).json(
            buildCompletedReplayResponse({
              conversationId,
              inflightId: requestedInflightId,
              finalStatus: completedReplay.finalStatus,
            }),
          );
        }
      }

      return res.status(409).json({
        status: 'error',
        code: 'RUN_IN_PROGRESS',
        message: 'Conversation already has an active run.',
      });
    }

    const ownership = getActiveRunOwnership(conversationId);
    if (!ownership) {
      releaseConversationLockFn(conversationId);
      baseLogger.error(
        {
          requestId,
          conversationId,
        },
        'chat.run.ownership_missing_after_lock',
      );
      return res.status(500).json({
        status: 'error',
        code: 'RUN_STATE_UNAVAILABLE',
        message: 'Conversation run ownership could not be resolved.',
      });
    }
    const { runToken } = ownership;

    const inflightId =
      typeof requestedInflightId === 'string' && requestedInflightId.length > 0
        ? requestedInflightId
        : crypto.randomUUID();

    const completedReplay = getCompletedInflight({
      conversationId,
      inflightId,
    });
    if (completedReplay) {
      releaseConversationLockFn(conversationId, runToken);
      return res.status(409).json(
        buildCompletedReplayResponse({
          conversationId,
          inflightId,
          finalStatus: completedReplay.finalStatus,
        }),
      );
    }

    const ensuredConversation = await ensureConversation();
    if (!ensuredConversation) {
      releaseConversationLockFn(conversationId, runToken);
      return res.status(410).json({
        status: 'error',
        code: 'CONVERSATION_ARCHIVED',
        message: 'Conversation is archived and must be restored before use.',
      });
    }

    if (requestedWorkingFolder) {
      appendWorkingFolderDecisionLog({
        conversationId,
        recordType: getConversationRecordType(ensuredConversation),
        surface: 'chat_run',
        action: 'save',
        decisionReason: 'request_value_persisted',
        workingFolder: requestedWorkingFolder,
      });
    }

    if (repositoryBackedCodexRun) {
      try {
        const materializedRuntimeHome =
          await materializeRepositoryBackedCodexChatHome({
            conversationId,
            overrides: {
              model: executionModel,
              sandbox_mode:
                typeof effectiveCodexFlags.sandboxMode === 'string'
                  ? effectiveCodexFlags.sandboxMode
                  : undefined,
              approval_policy:
                typeof effectiveCodexFlags.approvalPolicy === 'string'
                  ? effectiveCodexFlags.approvalPolicy
                  : undefined,
              model_reasoning_effort:
                typeof effectiveCodexFlags.modelReasoningEffort === 'string'
                  ? effectiveCodexFlags.modelReasoningEffort
                  : undefined,
              model_reasoning_summary:
                typeof effectiveCodexFlags.modelReasoningSummary === 'string'
                  ? effectiveCodexFlags.modelReasoningSummary
                  : undefined,
              model_verbosity:
                typeof effectiveCodexFlags.modelVerbosity === 'string'
                  ? effectiveCodexFlags.modelVerbosity
                  : undefined,
              network_access_enabled:
                typeof effectiveCodexFlags.networkAccessEnabled === 'boolean'
                  ? effectiveCodexFlags.networkAccessEnabled
                  : undefined,
              web_search_mode:
                typeof effectiveCodexFlags.webSearchMode === 'string'
                  ? effectiveCodexFlags.webSearchMode
                  : undefined,
            },
          });
        repositoryBackedCodexHome = materializedRuntimeHome.runtimeCodexHome;
      } catch (error) {
        const code =
          error instanceof RuntimeConfigResolutionError
            ? error.code
            : 'RUNTIME_CONFIG_VALIDATION_FAILED';
        console.error(`${T06_ERROR_LOG} surface=/chat code=${code}`);
        releaseConversationLockFn(conversationId, runToken);
        return res.status(500).json({
          status: 'error',
          code,
          message:
            error instanceof Error
              ? error.message
              : 'repository-backed chat runtime config materialization failed',
        });
      }
    }

    createInflight({
      conversationId,
      inflightId,
      provider: executionProvider,
      model: executionModel,
      source: 'REST',
      userTurn: { content: message, createdAt: now.toISOString() },
    });

    const consumePendingChatStop = () => {
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

    consumePendingChatStop();

    publishUserTurn({
      conversationId,
      inflightId,
      content: message,
      createdAt: now.toISOString(),
    });

    let chat: ChatInterface;
    try {
      chat = chatFactory(executionProvider, {
        clientFactory,
        codexFactory,
        toolFactory,
        ...(executionProvider === 'copilot'
          ? {
              copilotLifecycle:
                copilotLifecycleFactory?.({
                  env: { ...process.env, ...envOverrides },
                }) ??
                new CopilotLifecycle({
                  env: { ...process.env, ...envOverrides },
                }),
            }
          : {}),
      });
    } catch (err) {
      releaseConversationLockFn(conversationId, runToken);
      cleanupInflight({ conversationId, inflightId });

      if (err instanceof UnsupportedProviderError) {
        return res.status(400).json({
          status: 'error',
          code: 'UNSUPPORTED_PROVIDER',
          message: err.message,
        });
      }
      throw err;
    }

    const bridge = attachChatStreamBridge({
      conversationId,
      inflightId,
      provider: executionProvider,
      model: executionModel,
      requestId,
      chat,
    });

    append({
      level: 'info',
      message: 'chat.run.started',
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId,
      context: {
        provider: executionProvider,
        model: executionModel,
        conversationId,
        inflightId,
      },
    });
    baseLogger.info(
      {
        requestId,
        provider: executionProvider,
        model: executionModel,
        conversationId,
        inflightId,
      },
      'chat.run.started',
    );

    // Respond immediately; execution continues in the background.
    res.status(202).json({
      status: 'started',
      conversationId,
      inflightId,
      provider: executionProvider,
      model: executionModel,
      warnings: responseWarningsWithAgentFlags,
    });

    void (async () => {
      let runError: unknown;
      try {
        consumePendingChatStop();

        if (executionProvider === 'codex') {
          const activeThreadId =
            threadId ??
            (ensuredConversation.provider === 'codex' &&
            ensuredConversation.model === executionModel &&
            existingConversationEndpointId === selectedEndpointId
              ? ((ensuredConversation.flags?.threadId as string | undefined) ??
                null)
              : null) ??
            null;
          const codexRuntimeConfig = repositoryBackedCodexRun
            ? omitCodexRuntimeModelForConfigDefaults(chatRuntimeConfig)
            : chatRuntimeConfig;

          await chat.run(
            message,
            {
              provider: 'codex',
              threadId: activeThreadId,
              ...(repositoryBackedCodexHome
                ? { codexHome: repositoryBackedCodexHome }
                : {}),
              useConfigDefaults: repositoryBackedCodexRun,
              runtimeConfig: codexRuntimeConfig,
              codexFlags: effectiveCodexFlags,
              workingDirectoryOverride:
                executionContext.workingDirectoryOverride,
              envOverrides,
              requestId,
              inflightId,
              repositoryContext: executionContext.repositoryMetadata,
              runtime: executionContext.runtime,
              deferInflightCleanup: true,
              signal: getInflight(conversationId)?.abortController.signal,
              source: 'REST',
            },
            conversationId,
            executionModel,
          );
          return;
        }

        const historyForRun = shouldUseMemoryPersistence()
          ? await loadTurnsChronological()
          : undefined;

        await chat.run(
          message,
          {
            provider: executionProvider,
            requestId,
            baseUrl,
            inflightId,
            agentFlags: effectiveAgentFlags,
            ...(executionUsesEndpoint && selectedOpenAiCompatEndpoint
              ? { codeinfoOpenAiEndpoint: selectedOpenAiCompatEndpoint }
              : {}),
            repositoryContext: executionContext.repositoryMetadata,
            runtime: executionContext.runtime,
            deferInflightCleanup: true,
            signal: getInflight(conversationId)?.abortController.signal,
            envOverrides,
            history: historyForRun,
            ...(executionProvider === 'copilot'
              ? {
                  copilotModels: copilotReadiness.modelsRaw as ModelInfo[],
                  resumeConversation: shouldResumeCopilotSession,
                  workingDirectoryOverride:
                    executionContext.workingDirectoryOverride,
                }
              : {}),
            source: 'REST',
          },
          conversationId,
          executionModel,
        );
      } catch (err) {
        runError = err;
        baseLogger.error(
          {
            requestId,
            provider: executionProvider,
            model: executionModel,
            conversationId,
            inflightId,
            err,
          },
          'chat run failed',
        );
      } finally {
        bridge.cleanup();
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

        try {
          if (activeInflight) {
            cleanupInflightFn({ conversationId, inflightId });
          }
        } catch (cleanupError) {
          baseLogger.error(
            {
              requestId,
              provider: executionProvider,
              model: executionModel,
              conversationId,
              inflightId,
              cleanupError,
            },
            'chat cleanup failed; falling back to direct runtime cleanup',
          );
          cleanupInflight({ conversationId, inflightId });
        } finally {
          cleanupPendingConversationCancel({
            conversationId,
            runToken,
            inflightId,
          });
          releaseConversationLockFn(conversationId, runToken);
        }
      }
    })();
  });

  return router;
}
