import crypto from 'node:crypto';
import path from 'node:path';

import type { ModelInfo } from '@github/copilot-sdk';
import { LMStudioClient } from '@lmstudio/sdk';
import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import { z } from 'zod';

import { resolveAgentHomeEnv } from '../../agents/roots.js';
import { attachChatStreamBridge } from '../../chat/chatStreamBridge.js';
import { normalizeImplicitCopilotRequestedModel } from '../../chat/copilotModelSupport.js';
import {
  UnsupportedProviderError,
  getChatInterface,
} from '../../chat/factory.js';
import {
  cleanupInflight,
  createInflight,
  getCompletedInflightByReplayId,
  getInflight,
  type CompletedInflightState,
} from '../../chat/inflightRegistry.js';
import type {
  ChatAnalysisEvent,
  ChatCompleteEvent,
  ChatFinalEvent,
  ChatInterface,
  ChatThreadEvent,
  ChatToolResultEvent,
} from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  shouldUseMemoryPersistence,
} from '../../chat/memoryPersistence.js';
import { McpResponder } from '../../chat/responders/McpResponder.js';
import { resolveCodexCapabilities } from '../../codex/capabilityResolver.js';
import {
  buildUnavailableRuntimeProviderState,
  buildDefaultsAppliedMarkerPayload,
  resolveChatDefaults,
  resolveCodexChatDefaults,
  resolveRuntimeProviderSelection,
  STORY_47_TASK_1_LOG_MARKER,
  toChatResolutionSource,
  type ChatDefaultProvider,
} from '../../config/chatDefaults.js';
import {
  RuntimeConfigResolutionError,
  resolveChatRuntimeConfig,
} from '../../config/runtimeConfig.js';
import {
  getAdvertisedRepositoryIdentityPaths,
  listIngestedRepositories,
} from '../../lmstudio/toolService.js';
import { append } from '../../logStore.js';
import { ConversationModel } from '../../mongo/conversation.js';
import type { Conversation } from '../../mongo/conversation.js';
import {
  createConversation,
  updateConversationMeta,
  updateConversationWorkingFolder,
} from '../../mongo/repo.js';
import {
  getCodexDetection,
  setCodexDetection,
} from '../../providers/codexRegistry.js';
import { resolveCopilotReadiness } from '../../providers/copilotReadiness.js';
import { resolveSharedExecutionContext } from '../../workingFolders/executionContext.js';
import {
  resolveKnownRepositoryPathsState,
  restoreSavedWorkingFolder,
} from '../../workingFolders/state.js';
import { isCodexAvailable } from '../codexAvailability.js';
import {
  ArchivedConversationError,
  InvalidParamsError,
  ProviderUnavailableError,
  ToolExecutionError,
} from '../errors.js';

export const CODEBASE_QUESTION_TOOL_NAME = 'codebase_question';
const TASK8_LOG_MARKER = 'DEV_0000040_T08_MCP_DEFAULTS_APPLIED';
const REPLAY_ID_REGEX = /^[A-Za-z0-9._:-]{1,128}$/u;
const paramsSchema = z
  .object({
    question: z.string().min(1),
    conversationId: z.string().min(1).optional(),
    replayId: z.string().min(1).max(128).regex(REPLAY_ID_REGEX).optional(),
    provider: z.enum(['codex', 'copilot', 'lmstudio']).optional(),
    model: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.replayId && !value.conversationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replayId'],
        message:
          'replayId requires conversationId so follow-up retries stay scoped to one conversation.',
      });
    }
  });

export type CodebaseQuestionParams = z.infer<typeof paramsSchema>;

export type Segment =
  | { type: 'thinking'; text: string }
  | {
      type: 'vector_summary';
      files: VectorSummaryFile[];
    }
  | { type: 'answer'; text: string };

export type VectorSummaryFile = {
  path: string;
  relPath?: string;
  match: number | null;
  chunks: number;
  lines: number | null;
  repo?: string;
  modelId?: string;
  hostPathWarning?: string;
};

export type CodebaseQuestionResult = {
  conversationId: string | null;
  modelId: string;
  segments: Segment[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function buildReplayResult(params: {
  conversationId: string;
  completedReplay: CompletedInflightState;
}): { content: [{ type: 'text'; text: string }] } {
  const payload: CodebaseQuestionResult = {
    conversationId: params.conversationId,
    modelId: params.completedReplay.model ?? 'unknown',
    segments: [
      {
        type: 'answer',
        text: params.completedReplay.assistantText ?? '',
      },
    ],
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

function getCompletedReplayResult(params: {
  conversationId?: string;
  replayId?: string;
}): { content: [{ type: 'text'; text: string }] } | null {
  if (!params.conversationId || !params.replayId) return null;
  const completedReplay = getCompletedInflightByReplayId({
    conversationId: params.conversationId,
    replayId: params.replayId,
  });
  if (!completedReplay) return null;
  return buildReplayResult({
    conversationId: params.conversationId,
    completedReplay,
  });
}

function makeActiveReplayKey(conversationId: string, replayId: string) {
  return `${conversationId}::${replayId}`;
}

const activeReplayRuns = new Map<
  string,
  Promise<{ content: [{ type: 'text'; text: string }] }>
>();

const getSavedCodexThreadId = (
  conversation: Conversation | null | undefined,
): string | undefined => {
  const threadId = conversation?.flags?.threadId;
  return typeof threadId === 'string' && threadId.trim().length > 0
    ? threadId
    : undefined;
};

function logSummaryContractRead(params: {
  conversationId: string;
  summaries: ReturnType<McpResponder['getVectorSummaries']>;
}) {
  const files = params.summaries.flatMap((summary) => summary.files);
  const canonicalFieldsConsumed = files.some(
    (file) =>
      typeof (file as { embeddingModel?: unknown }).embeddingModel === 'string',
  );
  const aliasFallbackUsed = files.some(
    (file) =>
      typeof file.modelId === 'string' &&
      typeof (file as { embeddingModel?: unknown }).embeddingModel !== 'string',
  );
  append({
    level: 'info',
    message: 'DEV-0000036:T11:transitive_consumer_contract_read',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      consumer: 'mcp2.codebase_question.summary',
      conversationId: params.conversationId,
      canonicalFieldsConsumed,
      summaryFileCount: files.length,
    },
  });
  append({
    level: 'info',
    message: 'DEV-0000036:T11:transitive_consumer_alias_fallback',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      consumer: 'mcp2.codebase_question.summary',
      conversationId: params.conversationId,
      aliasFallbackUsed,
    },
  });
}

export type CodebaseQuestionDeps = {
  codexFactory?: (
    options?: CodexOptions,
  ) => import('../../chat/interfaces/ChatInterfaceCodex.js').CodexLike;
  clientFactory?: (baseUrl: string) => import('@lmstudio/sdk').LMStudioClient;
  toolFactory?: (opts: Record<string, unknown>) => {
    tools: ReadonlyArray<unknown>;
  };
  chatFactory?: typeof getChatInterface;
  chatRuntimeConfigResolver?: typeof resolveChatRuntimeConfig;
  copilotReadinessResolver?: typeof resolveCopilotReadiness;
  listIngestedRepositoriesFn?: typeof listIngestedRepositories;
};

const preferMemoryPersistence = process.env.NODE_ENV === 'test';
const shouldUseCodebaseQuestionMemoryPersistence = () =>
  preferMemoryPersistence || shouldUseMemoryPersistence();

export function __setCodebaseQuestionMemoryConversationForTests(
  conversation: Conversation,
) {
  memoryConversations.set(String(conversation._id), conversation);
}

export function __deleteCodebaseQuestionMemoryConversationForTests(
  conversationId: string,
) {
  memoryConversations.delete(conversationId);
}

const BASE_URL_REGEX = /^(https?|wss?):\/\//i;

const toWebSocketUrl = (value: string) => {
  if (value.startsWith('http://')) return value.replace(/^http:/i, 'ws:');
  if (value.startsWith('https://')) return value.replace(/^https:/i, 'wss:');
  return value;
};

const isChatModel = (model: { type?: string; architecture?: string }) => {
  const kind = (model.type ?? '').toLowerCase();
  return kind !== 'embedding' && kind !== 'vector';
};

const sanitizeFlagsForProvider = (
  provider: ChatDefaultProvider,
  flags: Record<string, unknown> | undefined,
) => {
  const current = { ...(flags ?? {}) };
  if (provider !== 'codex') {
    delete current.threadId;
    return current;
  }
  return current;
};

export function validateParams(params: unknown): CodebaseQuestionParams {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) {
    throw new InvalidParamsError('Invalid params', parsed.error.format());
  }
  return parsed.data;
}

const extractWarningFields = (warnings: string[]): string[] =>
  Array.from(
    new Set(
      warnings
        .map((warning) => warning.match(/"([^"]+)"/))
        .map((match) => match?.[1])
        .filter((field): field is string => typeof field === 'string'),
    ),
  );

async function getConversation(
  conversationId: string,
): Promise<Conversation | null> {
  if (shouldUseCodebaseQuestionMemoryPersistence()) {
    return memoryConversations.get(conversationId) ?? null;
  }

  return (await ConversationModel.findById(conversationId)
    .lean()
    .exec()) as Conversation | null;
}

async function ensureConversation(
  conversationId: string,
  provider: ChatDefaultProvider,
  model: string,
  title: string,
  flags?: Record<string, unknown>,
): Promise<void> {
  const now = new Date();
  if (shouldUseCodebaseQuestionMemoryPersistence()) {
    const existing = memoryConversations.get(conversationId);
    if (!existing) {
      memoryConversations.set(conversationId, {
        _id: conversationId,
        provider,
        model,
        title,
        source: 'MCP',
        flags: flags ?? {},
        lastMessageAt: now,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      } as Conversation);
    } else {
      memoryConversations.set(conversationId, {
        ...existing,
        provider,
        model,
        flags: sanitizeFlagsForProvider(provider, {
          ...(existing.flags ?? {}),
          ...(flags ?? {}),
        }),
        source: existing.source ?? 'MCP',
        lastMessageAt: now,
        updatedAt: now,
      } as Conversation);
    }
    return;
  }

  const existing = (await ConversationModel.findById(conversationId)
    .lean()
    .exec()) as Conversation | null;
  if (existing) {
    await updateConversationMeta({
      conversationId,
      provider,
      model,
      flags: sanitizeFlagsForProvider(provider, {
        ...(existing.flags ?? {}),
        ...(flags ?? {}),
      }),
      lastMessageAt: now,
    });
    return;
  }

  await createConversation({
    conversationId,
    provider,
    model,
    title,
    source: 'MCP',
    flags: sanitizeFlagsForProvider(provider, flags),
    lastMessageAt: now,
  });
}

export async function runCodebaseQuestion(
  params: unknown,
  deps: Partial<CodebaseQuestionDeps> = {},
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const parsed = validateParams(params);
  const replayId = parsed.replayId;
  const completedReplay = getCompletedReplayResult({
    conversationId: parsed.conversationId,
    replayId,
  });
  if (completedReplay) {
    return completedReplay;
  }

  const replayKey =
    parsed.conversationId && replayId
      ? makeActiveReplayKey(parsed.conversationId, replayId)
      : null;
  if (replayKey) {
    const activeReplay = activeReplayRuns.get(replayKey);
    if (activeReplay) {
      return await activeReplay;
    }
  }

  const runPromise = executeCodebaseQuestion(parsed, deps);
  if (!replayKey) {
    return await runPromise;
  }

  activeReplayRuns.set(replayKey, runPromise);
  try {
    return await runPromise;
  } finally {
    if (activeReplayRuns.get(replayKey) === runPromise) {
      activeReplayRuns.delete(replayKey);
    }
  }
}

async function executeCodebaseQuestion(
  parsed: CodebaseQuestionParams,
  deps: Partial<CodebaseQuestionDeps>,
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const replayId = parsed.replayId;
  const completedReplay = getCompletedReplayResult({
    conversationId: parsed.conversationId,
    replayId,
  });
  if (completedReplay) {
    return completedReplay;
  }
  const question = parsed.question;
  const conversationId = parsed.conversationId;
  const requestedProviderArg =
    typeof parsed.provider === 'string' && parsed.provider.trim().length > 0
      ? parsed.provider.trim()
      : undefined;
  const requestedModelArg =
    typeof parsed.model === 'string' && parsed.model.trim().length > 0
      ? parsed.model.trim()
      : undefined;
  const explicitProviderSelected = requestedProviderArg !== undefined;
  const resolvedDefaults = resolveChatDefaults({
    requestProvider: requestedProviderArg as ChatDefaultProvider | undefined,
    requestModel: requestedModelArg,
  });

  const existingConversation = conversationId
    ? await getConversation(conversationId)
    : null;
  if (conversationId) {
    if (existingConversation?.archivedAt) {
      throw new ArchivedConversationError(
        'Conversation is archived and must be restored before use',
      );
    }
  }

  const pinSavedConversationSelection =
    requestedProviderArg === undefined &&
    requestedModelArg === undefined &&
    existingConversation !== null &&
    existingConversation.provider === 'codex' &&
    typeof existingConversation.model === 'string' &&
    existingConversation.model.trim().length > 0;

  const requestedProvider = pinSavedConversationSelection
    ? (existingConversation!.provider as ChatDefaultProvider)
    : resolvedDefaults.provider;
  const codexRequestedDefaults =
    requestedProvider === 'codex' &&
    requestedModelArg === undefined &&
    !pinSavedConversationSelection
      ? await resolveCodexChatDefaults({
          codexHome: process.env.CODEX_HOME,
        })
      : undefined;
  const requestedModel = pinSavedConversationSelection
    ? existingConversation!.model.trim()
    : requestedProvider === 'codex'
      ? (codexRequestedDefaults?.values.model ?? resolvedDefaults.model)
      : resolvedDefaults.model;

  if (
    process.env.MCP_FORCE_CODEX_AVAILABLE === 'true' &&
    !getCodexDetection().available
  ) {
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });
  }

  const codexAvailable = await isCodexAvailable();
  const codexCapabilities = await resolveCodexCapabilities({
    consumer: 'chat_validation',
    codexHome: process.env.CODEX_HOME,
  });
  const codexWarnings = [
    ...new Set([...codexCapabilities.warnings, ...resolvedDefaults.warnings]),
  ];
  const codexState = {
    available: codexAvailable,
    models: codexCapabilities.models.map((entry) => entry.model),
    reason: codexAvailable ? undefined : 'CODE_INFO_LLM_UNAVAILABLE',
  };

  const baseUrl =
    process.env.CODEINFO_LMSTUDIO_BASE_URL ??
    'http://host.docker.internal:1234';
  let lmstudioState = buildUnavailableRuntimeProviderState(
    explicitProviderSelected && requestedProvider !== 'lmstudio'
      ? 'lmstudio probe skipped for explicit provider request'
      : 'lmstudio unavailable',
  );
  if (!explicitProviderSelected || requestedProvider === 'lmstudio') {
    if (!BASE_URL_REGEX.test(baseUrl)) {
      lmstudioState = buildUnavailableRuntimeProviderState(
        'lmstudio unavailable',
      );
    } else {
      try {
        const factory =
          deps.clientFactory ??
          ((url: string) => new LMStudioClient({ baseUrl: url }));
        const lmClient = factory(toWebSocketUrl(baseUrl));
        const listed = await lmClient.system.listDownloadedModels();
        const lmstudioModels = listed
          .filter(isChatModel)
          .map((entry) => entry.modelKey)
          .filter((value) => typeof value === 'string' && value.trim().length);
        lmstudioState =
          lmstudioModels.length > 0
            ? {
                available: true,
                models: lmstudioModels,
              }
            : buildUnavailableRuntimeProviderState('lmstudio unavailable');
      } catch {
        lmstudioState = buildUnavailableRuntimeProviderState(
          'lmstudio unavailable',
        );
      }
    }
  }

  const copilotReadiness =
    !explicitProviderSelected || requestedProvider === 'copilot'
      ? await (deps.copilotReadinessResolver ?? resolveCopilotReadiness)({
          toolsAvailable: true,
          env: process.env,
        })
      : {
          available: false,
          toolsAvailable: true,
          reason: 'copilot probe skipped for explicit provider request',
          blockingStage: 'connectivity' as const,
          models: [],
          modelsRaw: [],
          authSource: 'unauthenticated' as const,
        };
  const normalizedRequestedModel =
    requestedProvider === 'copilot'
      ? normalizeImplicitCopilotRequestedModel({
          models: copilotReadiness.modelsRaw as ModelInfo[],
          requestedModel,
          requestedModelSource: resolvedDefaults.modelSource,
        })
      : requestedModel;

  const runtimeSelection = resolveRuntimeProviderSelection({
    requestedProvider,
    requestedModel: normalizedRequestedModel,
    codex: codexState,
    copilot: {
      available: copilotReadiness.available,
      models: copilotReadiness.models,
      reason: copilotReadiness.reason,
    },
    lmstudio: lmstudioState,
  });
  append({
    level: 'info',
    message: 'DEV-0000035:T2:provider_fallback_evaluated',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      surface: 'mcp2.codebase_question',
      conversationId,
      requestedProvider: runtimeSelection.requestedProvider,
      requestedModel: runtimeSelection.requestedModel,
      executionProvider: runtimeSelection.executionProvider,
      executionModel: runtimeSelection.executionModel,
      fallbackApplied: runtimeSelection.fallbackApplied,
      decision: runtimeSelection.decision,
      requestedReason: runtimeSelection.requestedReason,
      fallbackReason: runtimeSelection.fallbackReason,
      lmstudioModelCount: lmstudioState.models.length,
    },
  });
  append({
    level: 'info',
    message: 'DEV-0000035:T2:provider_fallback_result',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      surface: 'mcp2.codebase_question',
      executionProvider: runtimeSelection.executionProvider,
      executionModel: runtimeSelection.executionModel,
      fallbackApplied: runtimeSelection.fallbackApplied,
      decision: runtimeSelection.decision,
    },
  });
  append({
    level: 'info',
    message: STORY_47_TASK_1_LOG_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: buildDefaultsAppliedMarkerPayload({
      surface: 'mcp2.codebase_question',
      requestedProvider: runtimeSelection.requestedProvider,
      requestedModel: runtimeSelection.requestedModel,
      resolvedModel: runtimeSelection.executionModel,
      modelSource:
        requestedProvider === 'codex'
          ? toChatResolutionSource(
              codexRequestedDefaults?.sources.model ?? 'hardcoded',
            )
          : resolvedDefaults.modelSource,
      codexModelSource:
        requestedProvider === 'codex'
          ? (codexRequestedDefaults?.sources.model ?? 'hardcoded')
          : undefined,
      warnings: codexWarnings,
    }),
  });
  append({
    level: 'info',
    message: TASK8_LOG_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      surface: 'mcp2.codebase_question',
      requestedProvider: runtimeSelection.requestedProvider,
      executionProvider: runtimeSelection.executionProvider,
      executionModel: runtimeSelection.executionModel,
      warningCount: codexWarnings.length,
      warningFields: extractWarningFields(codexWarnings),
      defaults: codexCapabilities.defaults,
    },
  });
  console.info(
    STORY_47_TASK_1_LOG_MARKER,
    buildDefaultsAppliedMarkerPayload({
      surface: 'mcp2.codebase_question',
      requestedProvider: runtimeSelection.requestedProvider,
      requestedModel: runtimeSelection.requestedModel,
      resolvedModel: runtimeSelection.executionModel,
      modelSource:
        requestedProvider === 'codex'
          ? toChatResolutionSource(
              codexRequestedDefaults?.sources.model ?? 'hardcoded',
            )
          : resolvedDefaults.modelSource,
      codexModelSource:
        requestedProvider === 'codex'
          ? (codexRequestedDefaults?.sources.model ?? 'hardcoded')
          : undefined,
      warnings: codexWarnings,
    }),
  );
  console.info(TASK8_LOG_MARKER, {
    surface: 'mcp2.codebase_question',
    requestedProvider: runtimeSelection.requestedProvider,
    executionProvider: runtimeSelection.executionProvider,
    executionModel: runtimeSelection.executionModel,
    warningCount: codexWarnings.length,
    warningFields: extractWarningFields(codexWarnings),
    defaults: codexCapabilities.defaults,
  });

  if (
    (explicitProviderSelected || pinSavedConversationSelection) &&
    runtimeSelection.decision !== 'selected'
  ) {
    throw new ProviderUnavailableError('CODE_INFO_LLM_UNAVAILABLE');
  }

  if (runtimeSelection.unavailable) {
    throw new ProviderUnavailableError('CODE_INFO_LLM_UNAVAILABLE');
  }

  const executionProvider = runtimeSelection.executionProvider;
  const executionModel = runtimeSelection.executionModel;
  const codexDefaults = codexCapabilities.defaults;
  let chatRuntimeConfig: CodexOptions['config'] | undefined;

  let effectiveWorkingFolder: string | undefined;
  let mutableConversation = existingConversation;
  const knownRepositoryPathsState = await resolveKnownRepositoryPathsState(
    async () =>
      (
        await (deps.listIngestedRepositoriesFn ?? listIngestedRepositories)()
      ).repos.flatMap((repo) =>
        getAdvertisedRepositoryIdentityPaths(repo).map((entry) =>
          path.resolve(entry),
        ),
      ),
  );
  const persistWorkingFolder = async (workingFolder?: string | null) => {
    if (!conversationId) return;
    if (shouldUseCodebaseQuestionMemoryPersistence()) {
      const existing = memoryConversations.get(conversationId);
      if (!existing) return;
      const nextFlags = { ...(existing.flags ?? {}) };
      if (workingFolder && workingFolder.trim().length > 0) {
        nextFlags.workingFolder = workingFolder;
      } else {
        delete nextFlags.workingFolder;
      }
      memoryConversations.set(conversationId, {
        ...existing,
        flags: nextFlags,
      } as Conversation);
      return;
    }
    await updateConversationWorkingFolder({
      conversationId,
      workingFolder,
    });
  };

  try {
    if (mutableConversation) {
      effectiveWorkingFolder = await restoreSavedWorkingFolder({
        conversation: mutableConversation,
        surface: 'mcp_codebase_question',
        clearPersistedWorkingFolder: async () => {
          await persistWorkingFolder(null);
          const nextFlags = { ...(mutableConversation?.flags ?? {}) };
          delete nextFlags.workingFolder;
          mutableConversation = {
            ...mutableConversation!,
            flags: nextFlags,
          } as Conversation;
        },
        knownRepositoryPathsState,
      });
    }
  } catch (error) {
    const workingFolderError = error as {
      code?: string;
      reason?: string;
      causeCode?: string;
    };
    if (
      workingFolderError.code === 'WORKING_FOLDER_UNAVAILABLE' ||
      workingFolderError.code === 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE'
    ) {
      throw new ToolExecutionError(-32002, workingFolderError.code, {
        reason: workingFolderError.reason,
        ...(workingFolderError.causeCode
          ? { causeCode: workingFolderError.causeCode }
          : {}),
      });
    }
    throw error;
  }

  const agentHomeResolution = resolveAgentHomeEnv();
  const executionContext = await resolveSharedExecutionContext({
    workingFolder: effectiveWorkingFolder,
    defaultRepositoryRoot:
      !explicitProviderSelected &&
      agentHomeResolution.activeEnvName !== 'default'
        ? agentHomeResolution.codeInfoRoot
        : undefined,
  });

  if (executionProvider === 'codex') {
    const runtimeConfigResolver =
      deps.chatRuntimeConfigResolver ?? resolveChatRuntimeConfig;
    try {
      const { config } = await runtimeConfigResolver();
      chatRuntimeConfig = config as CodexOptions['config'];
      if (
        pinSavedConversationSelection &&
        isRecord(chatRuntimeConfig) &&
        chatRuntimeConfig.model !== executionModel
      ) {
        chatRuntimeConfig = {
          ...chatRuntimeConfig,
          model: executionModel,
        } satisfies Record<string, unknown>;
      }
    } catch (err) {
      if (err instanceof RuntimeConfigResolutionError) {
        throw new ToolExecutionError(-32002, 'CODE_INFO_CHAT_CONFIG_INVALID', {
          code: err.code,
          surface: err.surface,
          configPath: err.configPath,
        });
      }
      throw err;
    }
  }

  const threadOpts: ThreadOptions = {
    model: executionModel,
    workingDirectory: executionContext.workingDirectoryOverride,
    skipGitRepoCheck: true,
    sandboxMode: codexDefaults.sandboxMode,
    networkAccessEnabled: codexDefaults.networkAccessEnabled,
    webSearchEnabled: codexDefaults.webSearchEnabled,
    approvalPolicy: codexDefaults.approvalPolicy,
    modelReasoningEffort:
      codexDefaults.modelReasoningEffort as unknown as ThreadOptions['modelReasoningEffort'],
  } as ThreadOptions;

  const resolvedConversationId =
    conversationId ?? `${executionProvider}-thread-${Date.now()}`;
  const lateCompletedReplay = getCompletedReplayResult({
    conversationId: resolvedConversationId,
    replayId,
  });
  if (lateCompletedReplay) {
    return lateCompletedReplay;
  }

  const inflightId = replayId ? `mcp-replay-${replayId}` : crypto.randomUUID();

  const existingFlags =
    mutableConversation && mutableConversation._id === resolvedConversationId
      ? (mutableConversation.flags as Record<string, unknown> | undefined)
      : undefined;
  const conversationFlags =
    executionProvider === 'codex'
      ? { ...(existingFlags ?? {}), ...threadOpts }
      : sanitizeFlagsForProvider(executionProvider, existingFlags);

  await ensureConversation(
    resolvedConversationId,
    executionProvider,
    executionModel,
    question.trim().slice(0, 80) || 'Untitled conversation',
    conversationFlags,
  );

  let chat: ChatInterface;
  const resolvedChatFactory = deps.chatFactory ?? getChatInterface;
  try {
    chat = resolvedChatFactory(executionProvider, {
      codexFactory: deps.codexFactory,
      clientFactory: deps.clientFactory,
      toolFactory: deps.toolFactory,
    });
  } catch (err) {
    if (err instanceof UnsupportedProviderError) {
      throw new InvalidParamsError(err.message);
    }
    throw err;
  }
  const responder = new McpResponder();

  chat.on('analysis', (ev: ChatAnalysisEvent) => responder.handle(ev));
  chat.on('tool-result', (ev: ChatToolResultEvent) => responder.handle(ev));
  chat.on('final', (ev: ChatFinalEvent) => responder.handle(ev));
  chat.on('complete', (ev: ChatCompleteEvent) => responder.handle(ev));
  chat.on('thread', (ev: ChatThreadEvent) => responder.handle(ev));
  chat.on('error', (ev) => responder.handle(ev));

  createInflight({
    conversationId: resolvedConversationId,
    inflightId,
    replayId,
    provider: executionProvider,
    model: executionModel,
    source: 'MCP',
  });
  const bridge = attachChatStreamBridge({
    conversationId: resolvedConversationId,
    inflightId,
    provider: executionProvider,
    model: executionModel,
    chat,
  });

  try {
    try {
      if (executionProvider === 'codex') {
        await chat.run(
          question,
          {
            provider: executionProvider,
            threadId: getSavedCodexThreadId(mutableConversation),
            runtimeConfig: chatRuntimeConfig,
            codexFlags: threadOpts,
            workingDirectoryOverride: executionContext.workingDirectoryOverride,
            repositoryContext: executionContext.repositoryMetadata,
            runtime: executionContext.runtime,
            signal: getInflight(resolvedConversationId)?.abortController.signal,
            source: 'MCP',
          },
          resolvedConversationId,
          executionModel,
        );
      } else {
        await chat.run(
          question,
          {
            provider: executionProvider,
            baseUrl,
            repositoryContext: executionContext.repositoryMetadata,
            runtime: executionContext.runtime,
            signal: getInflight(resolvedConversationId)?.abortController.signal,
            ...(executionProvider === 'copilot'
              ? {
                  copilotModels: copilotReadiness.modelsRaw as ModelInfo[],
                  resumeConversation:
                    mutableConversation?.provider === 'copilot' &&
                    mutableConversation.model === executionModel,
                  workingDirectoryOverride:
                    executionContext.workingDirectoryOverride,
                }
              : {}),
            source: 'MCP',
          },
          resolvedConversationId,
          executionModel,
        );
      }
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'TOOL_EXECUTION_FAILED';
      throw new ToolExecutionError(-32002, message);
    }
  } finally {
    bridge.cleanup();
    const leftover = getInflight(resolvedConversationId);
    if (leftover && leftover.inflightId === inflightId) {
      cleanupInflight({ conversationId: resolvedConversationId, inflightId });
    }
  }

  const providerThreadId = responder.getProviderThreadId();
  if (executionProvider === 'codex' && providerThreadId) {
    const nextFlags = {
      ...(conversationFlags ?? {}),
      threadId: providerThreadId,
    };
    await ensureConversation(
      resolvedConversationId,
      executionProvider,
      executionModel,
      question.trim().slice(0, 80) || 'Untitled conversation',
      nextFlags,
    );
    if (!conversationId && providerThreadId !== resolvedConversationId) {
      await ensureConversation(
        providerThreadId,
        executionProvider,
        executionModel,
        question.trim().slice(0, 80) || 'Untitled conversation',
        nextFlags,
      );
    }
  }

  let payload: CodebaseQuestionResult;
  try {
    payload = responder.toResult(executionModel, resolvedConversationId, {
      preferFallbackConversationId: typeof conversationId === 'string',
    });
  } catch (error) {
    if (error instanceof ToolExecutionError) throw error;
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'TOOL_EXECUTION_FAILED';
    throw new ToolExecutionError(-32002, message);
  }
  logSummaryContractRead({
    conversationId: resolvedConversationId,
    summaries: responder.getVectorSummaries(),
  });

  const answerOnly = payload.segments.filter(
    (segment) => segment.type === 'answer',
  );
  payload.segments =
    answerOnly.length > 0 ? answerOnly : [{ type: 'answer', text: '' }];

  append({
    level: 'info',
    message: 'DEV-0000025:T1:codebase_answer_only_filtered',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      conversationId: payload.conversationId,
      modelId: payload.modelId,
      segmentTypes: payload.segments.map((segment) => segment.type),
    },
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

export function codebaseQuestionDefinition() {
  return {
    name: CODEBASE_QUESTION_TOOL_NAME,
    description:
      'Retrieve repository facts, likely file locations, summaries of existing implementations, current contracts, and similar evidence-gathering context from the indexed codebase. After retrieval, inspect the relevant source files directly and do your own reasoning before deciding what to change. Returns a final answer segment plus conversationId and modelId for follow-ups.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['question'],
      properties: {
        question: {
          type: 'string',
          description: 'Natural-language question to ask about the codebase.',
        },
        conversationId: {
          type: 'string',
          description: 'Optional conversation/thread id for follow-up turns.',
        },
        replayId: {
          type: 'string',
          description:
            'Optional caller-supplied replay identity for one logical follow-up retry. Requires conversationId and must be reused verbatim on retries that should not duplicate provider work.',
        },
        provider: {
          type: 'string',
          enum: ['codex', 'copilot', 'lmstudio'],
          description:
            'Optional explicit provider override. Omit this unless the user specifically asked for a provider-specific run. When omitted, provider selection follows the normal shared server default-resolution contract.',
        },
        model: {
          type: 'string',
          description:
            'Optional explicit model override. Omit this unless the user specifically asked for a model-specific run. When omitted, model resolution follows the normal shared server default-resolution contract for the selected or resolved provider.',
        },
      },
    },
  } as const;
}
