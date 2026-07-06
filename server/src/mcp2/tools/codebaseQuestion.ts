import crypto from 'node:crypto';
import path from 'node:path';

import type { ModelInfo } from '@github/copilot-sdk';
import { LMStudioClient } from '@lmstudio/sdk';
import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import { z } from 'zod';

import { resolveAgentHomeEnv } from '../../agents/roots.js';
import { buildConversationFlags } from '../../chat/agentFlags.js';
import { attachChatStreamBridge } from '../../chat/chatStreamBridge.js';
import {
  normalizeImplicitCopilotRequestedModel,
  resolveCopilotDefaultModel,
} from '../../chat/copilotModelSupport.js';
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
  getMemoryTurns,
  memoryConversations,
  shouldUseMemoryPersistence,
} from '../../chat/memoryPersistence.js';
import { prepareProviderExecution } from '../../chat/providerExecution.js';
import { McpResponder } from '../../chat/responders/McpResponder.js';
import { resolveCodexCapabilities } from '../../codex/capabilityResolver.js';
import {
  buildUnavailableRuntimeProviderState,
  buildDefaultsAppliedMarkerPayload,
  prioritizeRuntimeProviderModels,
  resolveChatDefaults,
  resolveCodexChatDefaults,
  resolveProviderRuntimePreferredModel,
  STORY_47_TASK_1_LOG_MARKER,
  toChatResolutionSource,
  type ChatDefaultProvider,
} from '../../config/chatDefaults.js';
import {
  type RuntimeConfigAppMetadata,
  RuntimeConfigResolutionError,
  resolveChatRuntimeConfig,
} from '../../config/runtimeConfig.js';
import {
  buildManagedWebToolsWarning,
  resolveConfiguredWebSearchMode,
} from '../../config/webSearchMcp.js';
import {
  getAdvertisedRepositoryIdentityPaths,
  listIngestedRepositories,
} from '../../lmstudio/toolService.js';
import { append } from '../../logStore.js';
import { appendSummaryBackedTransitiveConsumerLogs } from '../../logging/transitiveConsumerMarkers.js';
import { ConversationModel } from '../../mongo/conversation.js';
import type { Conversation } from '../../mongo/conversation.js';
import {
  createConversation,
  listTurns,
  updateConversationMeta,
  updateConversationWorkingFolder,
} from '../../mongo/repo.js';
import type { TurnRuntimeMetadata } from '../../mongo/turn.js';
import {
  getCodexDetection,
  setCodexDetection,
} from '../../providers/codexRegistry.js';
import { resolveCopilotReadiness } from '../../providers/copilotReadiness.js';
import {
  getScopedEnvValue,
  getScopedProcessEnv,
} from '../../test/support/testEnvOverrideScope.js';
import { resolveSharedExecutionContext } from '../../workingFolders/executionContext.js';
import type { KnownRepositoryPathsState } from '../../workingFolders/state.js';
import {
  knownRepositoryPathsAvailable,
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
const GENERIC_CODEX_EXEC_STARTUP_BANNER =
  'Codex Exec exited with code 1: Reading prompt from stdin...';
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
  replay?:
    | {
        replayId: string;
        status: 'in_progress';
        inflightId?: string;
      }
    | {
        replayId: string;
        status: 'completed';
        inflightId?: string;
      };
};

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
    ...(params.completedReplay.replayId
      ? {
          replay: {
            replayId: params.completedReplay.replayId,
            status: 'completed' as const,
            ...(params.completedReplay.inflightId
              ? { inflightId: params.completedReplay.inflightId }
              : {}),
          },
        }
      : {}),
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

function buildInProgressReplayResult(params: {
  conversationId: string;
  replayId: string;
  modelId: string;
  inflightId?: string;
}): { content: [{ type: 'text'; text: string }] } {
  const payload: CodebaseQuestionResult = {
    conversationId: params.conversationId,
    modelId: params.modelId,
    segments: [],
    replay: {
      replayId: params.replayId,
      status: 'in_progress',
      ...(params.inflightId ? { inflightId: params.inflightId } : {}),
    },
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

const getReplayMetadata = (
  runtime: TurnRuntimeMetadata | undefined,
):
  | {
      replayId: string;
      inflightId?: string;
      completed: boolean;
    }
  | undefined => {
  if (!runtime?.replay) return undefined;
  const replayId = runtime.replay.replayId?.trim();
  if (!replayId) return undefined;
  return {
    replayId,
    ...(runtime.replay.inflightId?.trim()
      ? { inflightId: runtime.replay.inflightId.trim() }
      : {}),
    completed: runtime.replay.completed,
  };
};

async function getPersistedCompletedReplayResult(params: {
  conversationId?: string;
  replayId?: string;
}): Promise<{ content: [{ type: 'text'; text: string }] } | null> {
  if (!params.conversationId || !params.replayId) return null;

  const turns = shouldUseCodebaseQuestionMemoryPersistence()
    ? getMemoryTurns(params.conversationId)
    : (
        await listTurns({
          conversationId: params.conversationId,
          limit: Number.MAX_SAFE_INTEGER,
        })
      ).items;

  let matchedAssistant:
    | {
        content: string;
        model: string;
        status: 'ok' | 'warning' | 'stopped' | 'failed';
        createdAt: Date;
      }
    | undefined;
  for (const turn of turns) {
    if (turn.role !== 'assistant') continue;
    const replay = getReplayMetadata(turn.runtime);
    if (!replay || replay.replayId !== params.replayId || !replay.completed) {
      continue;
    }
    if (
      !matchedAssistant ||
      turn.createdAt.getTime() > matchedAssistant.createdAt.getTime()
    ) {
      matchedAssistant = {
        content: turn.content,
        model: turn.model,
        status: turn.status,
        createdAt: turn.createdAt,
      };
    }
  }

  if (matchedAssistant) {
    return buildReplayResult({
      conversationId: params.conversationId,
      completedReplay: {
        inflightId: `persisted-${params.replayId}`,
        replayId: params.replayId,
        model: matchedAssistant.model,
        source: 'MCP',
        assistantText: matchedAssistant.content,
        assistantThink: '',
        toolEvents: [],
        startedAt: matchedAssistant.createdAt.toISOString(),
        finalStatus: matchedAssistant.status,
        completedAt: matchedAssistant.createdAt.toISOString(),
      },
    });
  }

  let matchedInProgress:
    | {
        model: string;
        inflightId?: string;
        createdAt: Date;
      }
    | undefined;
  for (const turn of turns) {
    const replay = getReplayMetadata(turn.runtime);
    if (!replay || replay.replayId !== params.replayId || replay.completed) {
      continue;
    }
    if (
      !matchedInProgress ||
      turn.createdAt.getTime() > matchedInProgress.createdAt.getTime()
    ) {
      matchedInProgress = {
        model: turn.model,
        ...(replay.inflightId ? { inflightId: replay.inflightId } : {}),
        createdAt: turn.createdAt,
      };
    }
  }

  if (!matchedInProgress) return null;
  return buildInProgressReplayResult({
    conversationId: params.conversationId,
    replayId: params.replayId,
    modelId: matchedInProgress.model,
    inflightId: matchedInProgress.inflightId,
  });
}

async function getReplayResult(params: {
  conversationId?: string;
  replayId?: string;
}): Promise<{ content: [{ type: 'text'; text: string }] } | null> {
  const completedReplay = getCompletedReplayResult(params);
  if (completedReplay) return completedReplay;

  const persistedReplay = await getPersistedCompletedReplayResult(params);
  if (persistedReplay) return persistedReplay;

  if (!params.conversationId || !params.replayId) return null;
  const inflight = getInflight(params.conversationId);
  if (inflight?.replayId !== params.replayId) return null;
  return buildInProgressReplayResult({
    conversationId: params.conversationId,
    replayId: params.replayId,
    modelId: inflight.model ?? 'unknown',
    inflightId: inflight.inflightId,
  });
}

function makeActiveReplayKey(conversationId: string, replayId: string) {
  return `${conversationId}::${replayId}`;
}

const activeReplayRuns = new Map<
  string,
  {
    claimReady: Promise<void>;
    resolveClaimReady: () => void;
    runPromise: Promise<{ content: [{ type: 'text'; text: string }] }>;
  }
>();

function createReplayClaimGate() {
  let resolveClaimReady = () => {};
  const claimReady = new Promise<void>((resolve) => {
    resolveClaimReady = resolve;
  });
  return {
    claimReady,
    resolveClaimReady,
  };
}

async function waitForReplayClaimVisibility(params: {
  conversationId: string;
  replayId: string;
  inflightId: string;
  timeoutMs?: number;
}) {
  const timeoutMs = params.timeoutMs ?? 5000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const inflight = getInflight(params.conversationId);
    if (
      inflight?.inflightId === params.inflightId &&
      inflight.replayId === params.replayId &&
      inflight.persisted?.user
    ) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  throw new ToolExecutionError(
    -32002,
    'CODEBASE_QUESTION_REPLAY_CLAIM_UNAVAILABLE',
  );
}

const getSavedCodexThreadId = (
  conversation: Conversation | null | undefined,
): string | undefined => {
  const threadId = conversation?.flags?.threadId;
  return typeof threadId === 'string' && threadId.trim().length > 0
    ? threadId
    : undefined;
};

const getSavedEndpointId = (
  conversation: Conversation | null | undefined,
): string | undefined => {
  const endpointId = conversation?.flags?.endpointId;
  return typeof endpointId === 'string' && endpointId.trim().length > 0
    ? endpointId.trim()
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
  appendSummaryBackedTransitiveConsumerLogs({
    consumer: 'mcp2.codebase_question.summary',
    subjectKind: 'conversation',
    subjectId: params.conversationId,
    conversationId: params.conversationId,
    canonicalFieldsConsumed,
    aliasFallbackUsed,
    summaryFileCount: files.length,
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
    const metaOutcome = await updateConversationMeta({
      conversationId,
      provider,
      model,
      flags: sanitizeFlagsForProvider(provider, {
        ...(existing.flags ?? {}),
        ...(flags ?? {}),
      }),
      replaceFlags: true,
      lastMessageAt: now,
    });
    if (metaOutcome.outcome === 'not_found') {
      throw new ArchivedConversationError(
        'Conversation is archived and must be restored before use',
      );
    }
    if (metaOutcome.outcome === 'retry_exhausted') {
      throw new Error(
        'codebase question conversation metadata update exhausted',
      );
    }
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

function isGenericCodexExecStartupBanner(message: string): boolean {
  return message.trim() === GENERIC_CODEX_EXEC_STARTUP_BANNER;
}

function preferResponderErrorMessage(
  responderMessage: string | null,
  fallbackMessage: string,
): string {
  if (!responderMessage || responderMessage.trim().length === 0) {
    return fallbackMessage;
  }
  if (isGenericCodexExecStartupBanner(responderMessage)) {
    return fallbackMessage;
  }
  if (isGenericCodexExecStartupBanner(fallbackMessage)) {
    return responderMessage;
  }
  return responderMessage.length >= fallbackMessage.length
    ? responderMessage
    : fallbackMessage;
}

function logCodebaseQuestionExecutionFailure(params: {
  callerConversationId?: string;
  resolvedConversationId: string;
  replayId?: string;
  requestedProvider: string;
  requestedModel: string;
  executionProvider: string;
  executionModel: string;
  executionEndpointId?: string;
  effectiveWorkingFolder?: string;
  selectedRepositoryPath: string;
  reusedCodexThread: boolean;
  savedCodexThreadId?: string | null;
  providerThreadId?: string | null;
  message: string;
}) {
  append({
    level: 'error',
    message: 'DEV-0000053:T1:mcp_codebase_question_execution_failed',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      surface: 'mcp2.codebase_question',
      callerConversationId: params.callerConversationId ?? null,
      resolvedConversationId: params.resolvedConversationId,
      replayId: params.replayId ?? null,
      requestedProvider: params.requestedProvider,
      requestedModel: params.requestedModel,
      executionProvider: params.executionProvider,
      executionModel: params.executionModel,
      executionEndpointId: params.executionEndpointId ?? null,
      effectiveWorkingFolder: params.effectiveWorkingFolder ?? null,
      selectedRepositoryPath: params.selectedRepositoryPath,
      reusedCodexThread: params.reusedCodexThread,
      savedCodexThreadId: params.savedCodexThreadId ?? null,
      providerThreadId: params.providerThreadId ?? null,
      genericCodexBannerOnly: isGenericCodexExecStartupBanner(params.message),
      message: params.message,
    },
  });
}

export async function runCodebaseQuestion(
  params: unknown,
  deps: Partial<CodebaseQuestionDeps> = {},
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const parsed = validateParams(params);
  const replayId = parsed.replayId;
  const completedReplay = await getReplayResult({
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
      await activeReplay.claimReady;
      const claimedReplay = await getReplayResult({
        conversationId: parsed.conversationId,
        replayId,
      });
      if (claimedReplay) {
        return claimedReplay;
      }
      return await activeReplay.runPromise;
    }
  }

  const replayClaimGate = replayKey ? createReplayClaimGate() : null;
  const runPromise = executeCodebaseQuestion(parsed, deps, {
    onReplayClaimVisible: replayClaimGate?.resolveClaimReady,
  });
  if (!replayKey) {
    return await runPromise;
  }

  activeReplayRuns.set(replayKey, {
    claimReady: replayClaimGate!.claimReady,
    resolveClaimReady: replayClaimGate!.resolveClaimReady,
    runPromise,
  });
  try {
    return await runPromise;
  } finally {
    const activeReplay = activeReplayRuns.get(replayKey);
    activeReplay?.resolveClaimReady();
    if (activeReplay?.runPromise === runPromise) {
      activeReplayRuns.delete(replayKey);
    }
  }
}

async function executeCodebaseQuestion(
  parsed: CodebaseQuestionParams,
  deps: Partial<CodebaseQuestionDeps>,
  options?: {
    onReplayClaimVisible?: () => void;
  },
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const replayId = parsed.replayId;
  const completedReplay = await getReplayResult({
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
  const savedConversationProvider =
    existingConversation !== null &&
    (existingConversation.provider === 'codex' ||
      existingConversation.provider === 'copilot' ||
      existingConversation.provider === 'lmstudio')
      ? existingConversation.provider
      : undefined;
  const savedConversationModel =
    existingConversation !== null &&
    typeof existingConversation.model === 'string' &&
    existingConversation.model.trim().length > 0
      ? existingConversation.model.trim()
      : undefined;
  const pinSavedConversationExecutionIdentity =
    existingConversation !== null &&
    savedConversationProvider !== undefined &&
    savedConversationModel !== undefined;
  const resolvedDefaults = resolveChatDefaults({
    requestProvider: pinSavedConversationExecutionIdentity
      ? savedConversationProvider
      : (requestedProviderArg as ChatDefaultProvider | undefined),
    requestModel: pinSavedConversationExecutionIdentity
      ? savedConversationModel
      : requestedModelArg,
  });

  const requestedProvider = pinSavedConversationExecutionIdentity
    ? savedConversationProvider
    : resolvedDefaults.provider;
  const codexRequestedDefaults =
    requestedProvider === 'codex' &&
    requestedModelArg === undefined &&
    !pinSavedConversationExecutionIdentity
      ? await resolveCodexChatDefaults({
          codexHome: getScopedEnvValue('CODEX_HOME'),
        })
      : undefined;
  const requestedModel = pinSavedConversationExecutionIdentity
    ? savedConversationModel
    : requestedProvider === 'codex'
      ? (codexRequestedDefaults?.values.model ?? resolvedDefaults.model)
      : resolvedDefaults.model;
  const runtimeConfigResolver =
    deps.chatRuntimeConfigResolver ?? resolveChatRuntimeConfig;
  const runtimeConfigCache = new Map<
    Extract<ChatDefaultProvider, 'codex' | 'copilot'>,
    {
      config: Awaited<ReturnType<typeof resolveChatRuntimeConfig>>['config'];
      warnings: string[];
      endpoint?: RuntimeConfigAppMetadata['codeinfoOpenAiEndpoint'];
    }
  >();
  const loadProviderRuntimeConfig = async (
    provider: Extract<ChatDefaultProvider, 'codex' | 'copilot'>,
  ) => {
    const cached = runtimeConfigCache.get(provider);
    if (cached) {
      return cached;
    }
    try {
      const resolved = await runtimeConfigResolver(
        provider === 'copilot'
          ? {
              provider: 'copilot',
              copilotHome: getScopedEnvValue('CODEINFO_COPILOT_HOME'),
            }
          : undefined,
      );
      const normalized = {
        config: resolved.config,
        warnings: resolved.warnings.map((warning) => warning.message),
        endpoint: resolved.appMetadata?.codeinfoOpenAiEndpoint,
      };
      runtimeConfigCache.set(provider, normalized);
      return normalized;
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
  };
  let requestedCodexRuntimeConfig:
    | Awaited<ReturnType<typeof loadProviderRuntimeConfig>>
    | undefined;
  if (requestedProvider === 'codex') {
    try {
      requestedCodexRuntimeConfig = await loadProviderRuntimeConfig('codex');
    } catch {
      // Preserve the later runtime-config error path while still allowing
      // endpoint-backed requests to avoid poisoning native fallback models.
    }
  }

  if (
    getScopedEnvValue('MCP_FORCE_CODEX_AVAILABLE') === 'true' &&
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
    codexHome: getScopedEnvValue('CODEX_HOME'),
  });
  const codexWarnings = [
    ...new Set([...codexCapabilities.warnings, ...resolvedDefaults.warnings]),
  ];
  const requestedCodexUsesEndpoint =
    requestedProvider === 'codex' &&
    (Boolean(getSavedEndpointId(existingConversation)) ||
      requestedCodexRuntimeConfig?.endpoint !== undefined);
  const codexNativeModels = codexCapabilities.models
    .map((entry) => entry.model)
    .filter((model) => !requestedCodexUsesEndpoint || model !== requestedModel);
  const codexState = {
    available: codexAvailable,
    models: prioritizeRuntimeProviderModels(
      codexNativeModels,
      requestedProvider === 'codex'
        ? requestedCodexUsesEndpoint
          ? undefined
          : requestedModel
        : codexRequestedDefaults?.values.model,
      { includeMissingPreferred: !requestedCodexUsesEndpoint },
    ),
    reason: codexAvailable ? undefined : 'CODE_INFO_LLM_UNAVAILABLE',
    unavailableKind: codexAvailable
      ? undefined
      : getCodexDetection().authPresent
        ? ('other' as const)
        : ('authentication' as const),
  };

  const baseUrl =
    getScopedEnvValue('CODEINFO_LMSTUDIO_BASE_URL') ??
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
        const lmstudioPreferredModel = resolveProviderRuntimePreferredModel({
          provider: 'lmstudio',
          lmstudioHome: getScopedEnvValue('CODEINFO_LMSTUDIO_HOME'),
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

  const copilotReadiness =
    !explicitProviderSelected || requestedProvider === 'copilot'
      ? await (deps.copilotReadinessResolver ?? resolveCopilotReadiness)({
          toolsAvailable: true,
          env: getScopedProcessEnv(),
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
  const copilotDefaultModel = resolveCopilotDefaultModel({
    models: copilotReadiness.modelsRaw as ModelInfo[],
    copilotHome: getScopedEnvValue('CODEINFO_COPILOT_HOME'),
  }).defaultModel;

  const runtimeProviderStates = {
    codex: codexState,
    copilot: {
      available: copilotReadiness.available,
      models: prioritizeRuntimeProviderModels(
        copilotReadiness.models,
        copilotDefaultModel,
      ),
      reason: copilotReadiness.reason,
      unavailableKind: copilotReadiness.available
        ? undefined
        : copilotReadiness.blockingStage === 'authentication'
          ? ('authentication' as const)
          : copilotReadiness.blockingStage === 'connectivity'
            ? ('connectivity' as const)
            : copilotReadiness.blockingStage === 'models'
              ? ('models' as const)
              : ('other' as const),
    },
    lmstudio: lmstudioState,
  };
  let effectiveWorkingFolder: string | undefined;
  let mutableConversation = existingConversation;
  let knownRepositoryPathsState: KnownRepositoryPathsState | undefined =
    undefined;
  const persistWorkingFolder = async (
    workingFolder?: string | null,
    expectedWorkingFolder?: string | null,
  ): Promise<string | undefined> => {
    if (!conversationId) return;
    if (shouldUseCodebaseQuestionMemoryPersistence()) {
      const existing = memoryConversations.get(conversationId);
      if (!existing) return;
      const nextFlags = { ...(existing.flags ?? {}) };
      const trimmedExpectedWorkingFolder = expectedWorkingFolder?.trim();
      if (
        !workingFolder &&
        trimmedExpectedWorkingFolder &&
        (existing.flags?.workingFolder?.trim() ?? undefined) !==
          trimmedExpectedWorkingFolder
      ) {
        return;
      }
      if (workingFolder && workingFolder.trim().length > 0) {
        nextFlags.workingFolder = workingFolder;
      } else {
        delete nextFlags.workingFolder;
      }
      memoryConversations.set(conversationId, {
        ...existing,
        flags: nextFlags,
      } as Conversation);
      return memoryConversations
        .get(conversationId)
        ?.flags?.workingFolder?.trim();
    }
    const updated = await updateConversationWorkingFolder({
      conversationId,
      workingFolder,
      expectedWorkingFolder,
    });
    return updated?.flags?.workingFolder?.trim();
  };

  try {
    try {
      const repos = await (
        deps.listIngestedRepositoriesFn ?? listIngestedRepositories
      )();
      knownRepositoryPathsState = knownRepositoryPathsAvailable(
        repos.repos.flatMap((repo) =>
          getAdvertisedRepositoryIdentityPaths(repo).map((entry) =>
            path.resolve(entry),
          ),
        ),
      );
    } catch {
      // ignore and fall back to later retry logic when appropriate
    }

    if (mutableConversation) {
      effectiveWorkingFolder = await restoreSavedWorkingFolder({
        conversation: mutableConversation,
        surface: 'mcp_codebase_question',
        clearPersistedWorkingFolder: async (
          _conversationId,
          expectedWorkingFolder,
        ) => {
          const updatedWorkingFolder = await persistWorkingFolder(
            null,
            expectedWorkingFolder,
          );
          if (updatedWorkingFolder) {
            return updatedWorkingFolder;
          }
          const currentConversation = await getConversation(_conversationId);
          const currentWorkingFolder =
            currentConversation?.flags?.workingFolder?.trim();
          const trimmedExpectedWorkingFolder = expectedWorkingFolder?.trim();
          if (
            !trimmedExpectedWorkingFolder ||
            currentWorkingFolder === trimmedExpectedWorkingFolder
          ) {
            const nextFlags = { ...(mutableConversation?.flags ?? {}) };
            delete nextFlags.workingFolder;
            mutableConversation = {
              ...mutableConversation!,
              flags: nextFlags,
            } as Conversation;
            return mutableConversation.flags?.workingFolder?.trim();
          }
          return currentWorkingFolder;
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

    // If repository validation failed because repository membership couldn't
    // be validated, do a best-effort load of known repository paths and retry
    // once. If that still fails, surface the original working-folder error.
    if (
      workingFolderError.code === 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE' &&
      knownRepositoryPathsState === undefined
    ) {
      knownRepositoryPathsState = await resolveKnownRepositoryPathsState(
        async () =>
          (
            await (
              deps.listIngestedRepositoriesFn ?? listIngestedRepositories
            )()
          ).repos.flatMap((repo) =>
            getAdvertisedRepositoryIdentityPaths(repo).map((entry) =>
              path.resolve(entry),
            ),
          ),
      );

      try {
        if (mutableConversation) {
          effectiveWorkingFolder = await restoreSavedWorkingFolder({
            conversation: mutableConversation,
            surface: 'mcp_codebase_question',
            clearPersistedWorkingFolder: async (
              _conversationId,
              expectedWorkingFolder,
            ) => {
              const updatedWorkingFolder = await persistWorkingFolder(
                null,
                expectedWorkingFolder,
              );
              if (updatedWorkingFolder) {
                return updatedWorkingFolder;
              }
              const currentConversation =
                await getConversation(_conversationId);
              const currentWorkingFolder =
                currentConversation?.flags?.workingFolder?.trim();
              const trimmedExpectedWorkingFolder =
                expectedWorkingFolder?.trim();
              if (
                !trimmedExpectedWorkingFolder ||
                currentWorkingFolder === trimmedExpectedWorkingFolder
              ) {
                const nextFlags = { ...(mutableConversation?.flags ?? {}) };
                delete nextFlags.workingFolder;
                mutableConversation = {
                  ...mutableConversation!,
                  flags: nextFlags,
                } as Conversation;
                return mutableConversation.flags?.workingFolder?.trim();
              }
              return currentWorkingFolder;
            },
            knownRepositoryPathsState,
          });
        }
      } catch (err2) {
        const workingFolderError2 = err2 as {
          code?: string;
          reason?: string;
          causeCode?: string;
        };
        if (
          workingFolderError2.code === 'WORKING_FOLDER_UNAVAILABLE' ||
          workingFolderError2.code === 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE'
        ) {
          throw new ToolExecutionError(-32002, workingFolderError2.code, {
            reason: workingFolderError2.reason,
            ...(workingFolderError2.causeCode
              ? { causeCode: workingFolderError2.causeCode }
              : {}),
          });
        }
        throw err2;
      }
    } else if (
      workingFolderError.code === 'WORKING_FOLDER_UNAVAILABLE' ||
      workingFolderError.code === 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE'
    ) {
      throw new ToolExecutionError(-32002, workingFolderError.code, {
        reason: workingFolderError.reason,
        ...(workingFolderError.causeCode
          ? { causeCode: workingFolderError.causeCode }
          : {}),
      });
    } else {
      throw error;
    }
  }

  const replayAfterWorkingFolderRestore = await getReplayResult({
    conversationId,
    replayId,
  });
  if (replayAfterWorkingFolderRestore) {
    return replayAfterWorkingFolderRestore;
  }

  let preparedExecution;
  try {
    preparedExecution = await prepareProviderExecution({
      requestedProvider,
      requestedModel: normalizedRequestedModel,
      providerStates: runtimeProviderStates,
      loadRuntimeConfig: loadProviderRuntimeConfig,
      selectedEndpointId: getSavedEndpointId(existingConversation),
      respectConfiguredEndpoint: !(
        pinSavedConversationExecutionIdentity &&
        savedConversationProvider !== 'codex' &&
        !getSavedEndpointId(existingConversation)
      ),
      allowCrossProviderFallback: !explicitProviderSelected,
      failInPlaceOnEndpointUnavailable: Boolean(
        pinSavedConversationExecutionIdentity &&
          getSavedEndpointId(existingConversation),
      ),
      env: getScopedProcessEnv(),
    });
  } catch (error) {
    if (error instanceof ToolExecutionError) {
      throw error;
    }
    throw error;
  }
  const runtimeSelection = preparedExecution.runtimeSelection;
  const managedWebToolsWarning =
    preparedExecution.executionProvider === 'codex' &&
    preparedExecution.openAiCompatEndpoint
      ? buildManagedWebToolsWarning({
          provider: 'codex',
          webSearchMode: resolveConfiguredWebSearchMode(
            (preparedExecution.runtimeConfig as Record<string, unknown>) ?? {},
          ),
          usesOpenAiCompatEndpoint: true,
        })
      : undefined;
  const executionWarnings = [
    ...new Set([
      ...codexWarnings,
      ...preparedExecution.warnings,
      ...(managedWebToolsWarning ? [managedWebToolsWarning] : []),
    ]),
  ];
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
      runtimePath: runtimeSelection.executionPath,
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
      warnings: executionWarnings,
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
      warningCount: executionWarnings.length,
      warningFields: extractWarningFields(executionWarnings),
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
      runtimePath: runtimeSelection.executionPath,
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
      warnings: executionWarnings,
    }),
  );
  console.info(TASK8_LOG_MARKER, {
    surface: 'mcp2.codebase_question',
    requestedProvider: runtimeSelection.requestedProvider,
    executionProvider: runtimeSelection.executionProvider,
    executionModel: runtimeSelection.executionModel,
    warningCount: executionWarnings.length,
    warningFields: extractWarningFields(executionWarnings),
    defaults: codexCapabilities.defaults,
  });

  if (
    (explicitProviderSelected || pinSavedConversationExecutionIdentity) &&
    runtimeSelection.executionProvider !== requestedProvider
  ) {
    throw new ProviderUnavailableError('CODE_INFO_LLM_UNAVAILABLE');
  }

  if (runtimeSelection.unavailable) {
    throw new ProviderUnavailableError('CODE_INFO_LLM_UNAVAILABLE');
  }

  const executionProvider = preparedExecution.executionProvider;
  const executionModel = preparedExecution.executionModel;
  const executionUsesEndpoint = preparedExecution.executionUsesEndpoint;
  const executionEndpointId = preparedExecution.endpointId;
  const codexDefaults = codexCapabilities.defaults;
  const chatRuntimeConfig = preparedExecution.runtimeConfig;
  const resolvedConversationId =
    conversationId ?? `${executionProvider}-thread-${Date.now()}`;

  const agentHomeResolution = resolveAgentHomeEnv();
  const executionContext = await resolveSharedExecutionContext({
    workingFolder: effectiveWorkingFolder,
    defaultRepositoryRoot:
      agentHomeResolution.activeEnvName !== 'default'
        ? agentHomeResolution.codeInfoRoot
        : undefined,
    allowMissingWorkingFolder: effectiveWorkingFolder !== undefined,
  });
  const envOverrides: NodeJS.ProcessEnv = {
    CODEINFO_ROOT: executionContext.repositoryMetadata.selectedRepositoryPath,
  };

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

  const lateCompletedReplay = await getReplayResult({
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
  const existingConversationEndpointId =
    mutableConversation && mutableConversation._id === resolvedConversationId
      ? getSavedEndpointId(mutableConversation)
      : undefined;
  const canReuseCodexThread =
    executionProvider === 'codex' &&
    mutableConversation?.provider === 'codex' &&
    mutableConversation.model === executionModel &&
    existingConversationEndpointId === executionEndpointId;
  const shouldResumeCopilotConversation =
    mutableConversation?.provider === 'copilot' &&
    mutableConversation.model === executionModel &&
    existingConversationEndpointId === executionEndpointId;
  const conversationFlags = buildConversationFlags({
    provider: executionProvider,
    currentFlags: existingFlags,
    workingFolder: effectiveWorkingFolder,
    threadId: canReuseCodexThread
      ? getSavedCodexThreadId(mutableConversation)
      : undefined,
    endpointId: executionUsesEndpoint
      ? (executionEndpointId ?? existingConversationEndpointId ?? null)
      : null,
    preserveFlowState: false,
  });

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
      ...(executionProvider === 'copilot'
        ? { copilotEnv: { ...process.env, ...envOverrides } }
        : {}),
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
  const runtimeMetadata =
    replayId !== undefined
      ? {
          ...executionContext.runtime,
          replay: {
            replayId,
            inflightId,
            completed: false,
          },
        }
      : executionContext.runtime;

  try {
    try {
      const runChat = async () => {
        if (executionProvider === 'codex') {
          await chat.run(
            question,
            {
              provider: executionProvider,
              threadId: canReuseCodexThread
                ? getSavedCodexThreadId(mutableConversation)
                : undefined,
              runtimeConfig: chatRuntimeConfig,
              codexFlags: threadOpts,
              inflightId,
              workingDirectoryOverride:
                executionContext.workingDirectoryOverride,
              envOverrides,
              repositoryContext: executionContext.repositoryMetadata,
              runtime: runtimeMetadata,
              signal: getInflight(resolvedConversationId)?.abortController
                .signal,
              source: 'MCP',
            },
            resolvedConversationId,
            executionModel,
          );
          return;
        }

        await chat.run(
          question,
          {
            provider: executionProvider,
            baseUrl,
            inflightId,
            repositoryContext: executionContext.repositoryMetadata,
            runtime: runtimeMetadata,
            signal: getInflight(resolvedConversationId)?.abortController.signal,
            envOverrides,
            ...(executionProvider === 'copilot'
              ? {
                  copilotModels: copilotReadiness.modelsRaw as ModelInfo[],
                  resumeConversation: shouldResumeCopilotConversation,
                  runtimeConfig: chatRuntimeConfig,
                  workingDirectoryOverride:
                    executionContext.workingDirectoryOverride,
                }
              : {}),
            ...(executionUsesEndpoint && preparedExecution.openAiCompatEndpoint
              ? {
                  codeinfoOpenAiEndpoint:
                    preparedExecution.openAiCompatEndpoint,
                }
              : {}),
            source: 'MCP',
          },
          resolvedConversationId,
          executionModel,
        );
      };

      const runChatPromise = runChat();
      if (conversationId && replayId) {
        await waitForReplayClaimVisibility({
          conversationId: resolvedConversationId,
          replayId,
          inflightId,
        });
        options?.onReplayClaimVisible?.();
      }
      await runChatPromise;
    } catch (error) {
      options?.onReplayClaimVisible?.();
      if (error instanceof ToolExecutionError) throw error;
      const fallbackMessage =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'TOOL_EXECUTION_FAILED';
      const message = preferResponderErrorMessage(
        responder.getErrorMessage(),
        fallbackMessage,
      );
      logCodebaseQuestionExecutionFailure({
        callerConversationId: conversationId,
        resolvedConversationId,
        replayId,
        requestedProvider: runtimeSelection.requestedProvider,
        requestedModel: runtimeSelection.requestedModel,
        executionProvider,
        executionModel,
        executionEndpointId,
        effectiveWorkingFolder,
        selectedRepositoryPath:
          executionContext.repositoryMetadata.selectedRepositoryPath,
        reusedCodexThread: canReuseCodexThread,
        savedCodexThreadId: canReuseCodexThread
          ? getSavedCodexThreadId(mutableConversation)
          : null,
        providerThreadId: responder.getProviderThreadId(),
        message,
      });
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
    const nextFlags = buildConversationFlags({
      provider: executionProvider,
      currentFlags: conversationFlags,
      workingFolder: effectiveWorkingFolder,
      threadId: providerThreadId,
      endpointId: executionUsesEndpoint
        ? (executionEndpointId ?? existingConversationEndpointId ?? null)
        : null,
      preserveFlowState: false,
    });
    await ensureConversation(
      resolvedConversationId,
      executionProvider,
      executionModel,
      question.trim().slice(0, 80) || 'Untitled conversation',
      nextFlags,
    );
  }

  let payload: CodebaseQuestionResult;
  try {
    payload = responder.toResult(executionModel, resolvedConversationId, {
      preferFallbackConversationId: true,
    });
  } catch (error) {
    if (error instanceof ToolExecutionError) throw error;
    const fallbackMessage =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'TOOL_EXECUTION_FAILED';
    const message = preferResponderErrorMessage(
      responder.getErrorMessage(),
      fallbackMessage,
    );
    logCodebaseQuestionExecutionFailure({
      callerConversationId: conversationId,
      resolvedConversationId,
      replayId,
      requestedProvider: runtimeSelection.requestedProvider,
      requestedModel: runtimeSelection.requestedModel,
      executionProvider,
      executionModel,
      executionEndpointId,
      effectiveWorkingFolder,
      selectedRepositoryPath:
        executionContext.repositoryMetadata.selectedRepositoryPath,
      reusedCodexThread: canReuseCodexThread,
      savedCodexThreadId: canReuseCodexThread
        ? getSavedCodexThreadId(mutableConversation)
        : null,
      providerThreadId: responder.getProviderThreadId(),
      message,
    });
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
  if (replayId) {
    payload.replay = {
      replayId,
      status: 'completed',
      inflightId,
    };
  }

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
