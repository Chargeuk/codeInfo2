import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { CodexOptions } from '@openai/codex-sdk';

import { executeCommandItem } from '../agents/commandItemExecutor.js';
import type { ExecuteCommandItemReingestResult } from '../agents/commandItemExecutor.js';
import { loadAgentCommandFile } from '../agents/commandsLoader.js';
import type { AgentCommandFile } from '../agents/commandsSchema.js';
import { discoverAgents } from '../agents/discovery.js';
import {
  resolveAgentHomeEnv,
  resolveAgentHomeForRepository,
  validateRepositoryBackedAgentType,
} from '../agents/roots.js';
import {
  getActiveRunOwnership,
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../agents/runLock.js';
import { prepareFlowOwnedAgentExecution } from '../agents/service.js';
import { isTransientReconnect } from '../agents/transientReconnect.js';
import { attachChatStreamBridge } from '../chat/chatStreamBridge.js';
import { getChatInterface, UnsupportedProviderError } from '../chat/factory.js';
import {
  abortInflight,
  abortInflightByConversation,
  bindPendingConversationCancelToInflight,
  cleanupPendingConversationCancel,
  cleanupInflight,
  consumePendingConversationCancel,
  createInflight,
  getInflight,
  getPendingConversationCancel,
  markInflightPersisted,
  registerPendingConversationCancel,
  setAssistantText,
} from '../chat/inflightRegistry.js';
import type {
  ChatCompleteEvent,
  ChatErrorEvent,
  ChatFinalEvent,
  ChatTokenEvent,
  ChatToolResultEvent,
} from '../chat/interfaces/ChatInterface.js';
import { ChatInterface } from '../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
  recordMemoryTurn,
  shouldUseMemoryPersistence,
  updateMemoryConversationMeta,
  updateMemoryConversationWorkingFolder,
} from '../chat/memoryPersistence.js';
import { runReingestStepLifecycle } from '../chat/reingestStepLifecycle.js';
import { buildReingestToolResult } from '../chat/reingestToolResult.js';
import { getFlowAndCommandRetries } from '../config/flowAndCommandRetries.js';
import { getProviderBootstrapStatus } from '../config/runtimeConfig.js';
import { formatReingestPrestartReason } from '../ingest/reingestError.js';
import { executeReingestRequest } from '../ingest/reingestExecution.js';
import type { ReingestResult } from '../ingest/reingestService.js';
import { runReingestRepository } from '../ingest/reingestService.js';
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
  listTurns,
  updateConversationFlowChildExecution,
  updateConversationMeta,
  updateConversationFlowState,
  updateConversationThreadId,
  updateConversationWorkingFolder,
} from '../mongo/repo.js';
import type {
  TurnCommandMetadata,
  Turn,
  TurnRuntimeMetadata,
  TurnStatus,
  TurnTimingMetadata,
  TurnUsageMetadata,
} from '../mongo/turn.js';
import { formatRetryInstruction } from '../utils/retryContext.js';
import { resolveSharedExecutionContext } from '../workingFolders/executionContext.js';
import {
  appendWorkingFolderDecisionLog,
  getConversationRecordType,
  knownRepositoryPathsAvailable,
  knownRepositoryPathsUnavailable,
  restoreSavedWorkingFolder,
  validateRequestedWorkingFolder,
} from '../workingFolders/state.js';
import { publishInflightSnapshot, publishUserTurn } from '../ws/server.js';

const snapshotFlowRuntimeCleanupState = (conversationId: string) => {
  const pendingCancel = getPendingConversationCancel(conversationId);
  return {
    inflightId: getInflight(conversationId)?.inflightId ?? null,
    ownershipRunToken: getActiveRunOwnership(conversationId)?.runToken ?? null,
    pendingCancelRunToken: pendingCancel?.runToken ?? null,
    pendingCancelInflightId: pendingCancel?.boundInflightId ?? null,
  };
};

import {
  clearCodexReviewPointerFile,
  resolveCodexReviewModel,
  resolveCodexReviewReasoningEffort,
  runCodexReviewStep,
  type CodexReviewReasoningEffort,
} from './codexReview.js';
import { discoverFlows, type FlowSummary } from './discovery.js';
import {
  parseFlowFile,
  type FlowFile,
  type FlowBreakStep,
  type FlowContinueStep,
  type FlowCommandStep,
  type FlowCodexReviewStep,
  type FlowLlmStep,
  type FlowPrepareReviewBaseStep,
  type FlowReingestStep,
  type FlowResetStep,
  type FlowStartLoopStep,
  type FlowSubflowStep,
  type FlowValidateReviewArtifactsStep,
  type FlowStep,
} from './flowSchema.js';
import type {
  FlowActiveSubflow,
  FlowPendingLoopControl,
  FlowResumeState,
  FreshRunRetryOwnershipCompletion,
} from './flowState.js';
import {
  normalizeSourceLabel,
  prepareMarkdownInstruction,
} from './markdownFileResolver.js';
import {
  buildRepositoryCandidateLookupSummary,
  buildRepositoryCandidateOrderLogContext,
  buildRepositoryCandidateOrder,
  DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER,
  type RepositoryCandidateLookupSummary,
  type RepositoryCandidateOrderResult,
  type RepositoryCandidateOrderSlot,
} from './repositoryCandidateOrder.js';
import { validateReviewArtifacts } from './reviewArtifacts.js';
import { prepareReviewBase } from './reviewBase.js';
import type {
  FlowAgentState,
  FlowChatFactory,
  FlowExecutionRuntimeState,
  FlowRunError,
  FlowRunErrorCode,
  FlowRunStartParams,
  FlowRunStartResult,
} from './types.js';

const FALLBACK_MODEL_ID = 'gpt-5.6-sol';
const FLOW_STEP_BASE_DELAY_MS = 500;
const T07_SUCCESS_LOG =
  '[DEV-0000037][T07] event=runtime_overrides_applied_flow_mcp result=success';
const T07_ERROR_LOG =
  '[DEV-0000037][T07] event=runtime_overrides_applied_flow_mcp result=error';
const DEV_0000040_T11_FLOW_RESOLUTION_ORDER =
  'DEV_0000040_T11_FLOW_RESOLUTION_ORDER';
type FlowServiceDeps = {
  runReingestRepository: (args: {
    sourceId?: string;
  }) => Promise<ReingestResult>;
  buildReingestToolResult: typeof buildReingestToolResult;
  runReingestStepLifecycle: typeof runReingestStepLifecycle;
  createCallId: () => string;
};

const defaultFlowServiceDeps: FlowServiceDeps = {
  runReingestRepository,
  buildReingestToolResult,
  runReingestStepLifecycle,
  createCallId: () => crypto.randomUUID(),
};

export async function listFlows(params?: {
  baseDir?: string;
  listIngestedRepositories?: typeof listIngestedRepositories;
}): Promise<{ flows: FlowSummary[] }> {
  const flows = await discoverFlows({
    baseDir: params?.baseDir,
    listIngestedRepositories: params?.listIngestedRepositories,
  });
  return { flows };
}

export async function getFlowDetails(params: {
  flowName: string;
  sourceId?: string;
  baseDir?: string;
  listIngestedRepositories?: typeof listIngestedRepositories;
}): Promise<FlowSummary> {
  const flows = await discoverFlows({
    baseDir: params.baseDir,
    listIngestedRepositories: params.listIngestedRepositories,
  });
  const flow = flows.find(
    (entry) =>
      entry.name === params.flowName &&
      (params.sourceId ? entry.sourceId === params.sourceId : !entry.sourceId),
  );
  if (!flow) {
    const error = new Error(`Flow "${params.flowName}" not found`) as Error & {
      code?: string;
    };
    error.code = 'FLOW_NOT_FOUND';
    throw error;
  }
  return flow;
}

const flowServiceDeps: FlowServiceDeps = {
  ...defaultFlowServiceDeps,
};

type FreshRunRetryOwnershipRecord = {
  runToken: string;
  result: FlowRunStartResult;
  launchSignature: string;
};

type FreshRunRetryOwnershipCompletionRecord = {
  retryOwnershipId: string;
  sourceId?: string;
  result: FlowRunStartResult;
  launchSignature: string;
  completedAt: number;
};

const FRESH_RUN_RETRY_OWNERSHIP_COMPLETION_WINDOW_MS = 10 * 60 * 1000;

type FreshRunRetryOwnershipLaunch = {
  flowName: string;
  source: 'REST' | 'MCP';
  sourceId?: string;
  codexReviewModelId?: string;
  workingFolder?: string;
  customTitle?: string;
};

const freshRunRetryOwnershipByKey = new Map<
  string,
  FreshRunRetryOwnershipRecord
>();

const freshRunRetryOwnershipCompletedByKey = new Map<
  string,
  FreshRunRetryOwnershipCompletionRecord
>();

const makeFreshRunRetryOwnershipKey = (params: {
  flowName: string;
  sourceId?: string;
  retryOwnershipId: string;
}) =>
  `${params.flowName}::${params.sourceId?.trim() || ''}::${params.retryOwnershipId.trim()}`;

const normalizeFreshRunRetryOwnershipLaunch = (params: {
  flowName: string;
  source: 'REST' | 'MCP';
  sourceId?: string;
  codexReviewModelId?: string;
  working_folder?: string;
  customTitle?: string;
}): FreshRunRetryOwnershipLaunch => ({
  flowName: params.flowName.trim(),
  source: params.source,
  sourceId: params.sourceId?.trim() || undefined,
  codexReviewModelId: params.codexReviewModelId?.trim() || undefined,
  workingFolder: params.working_folder?.trim() || undefined,
  customTitle: params.customTitle?.trim() || undefined,
});

const makeFreshRunRetryOwnershipLaunchSignature = (
  launch: FreshRunRetryOwnershipLaunch,
) => JSON.stringify(launch);

const cloneFlowRunStartResult = (
  result: FlowRunStartResult,
): FlowRunStartResult => ({
  ...result,
  ...(result.warnings ? { warnings: [...result.warnings] } : {}),
});

const rememberFreshRunRetryOwnership = (params: {
  flowName: string;
  sourceId?: string;
  retryOwnershipId: string;
  runToken: string;
  result: FlowRunStartResult;
  launch: FreshRunRetryOwnershipLaunch;
}) => {
  freshRunRetryOwnershipByKey.set(makeFreshRunRetryOwnershipKey(params), {
    runToken: params.runToken,
    result: cloneFlowRunStartResult(params.result),
    launchSignature: makeFreshRunRetryOwnershipLaunchSignature(params.launch),
  });
};

const rememberFreshRunRetryOwnershipCompletion = (params: {
  flowName: string;
  sourceId?: string;
  retryOwnershipId: string;
  result: FlowRunStartResult;
  launch: FreshRunRetryOwnershipLaunch;
}) => {
  freshRunRetryOwnershipCompletedByKey.set(
    makeFreshRunRetryOwnershipKey(params),
    {
      retryOwnershipId: params.retryOwnershipId,
      sourceId: params.sourceId?.trim() || undefined,
      result: cloneFlowRunStartResult(params.result),
      launchSignature: makeFreshRunRetryOwnershipLaunchSignature(params.launch),
      completedAt: Date.now(),
    },
  );
};

const parseFreshRunRetryOwnershipCompletion = (
  completion: unknown,
): FreshRunRetryOwnershipCompletionRecord | null => {
  if (!isRecord(completion)) return null;
  const retryOwnershipId =
    typeof completion.retryOwnershipId === 'string' &&
    completion.retryOwnershipId.trim().length > 0
      ? completion.retryOwnershipId.trim()
      : undefined;
  const sourceId =
    typeof completion.sourceId === 'string' &&
    completion.sourceId.trim().length > 0
      ? completion.sourceId.trim()
      : undefined;
  const launchSignature =
    typeof completion.launchSignature === 'string' &&
    completion.launchSignature.trim().length > 0
      ? completion.launchSignature.trim()
      : undefined;
  const completedAt =
    typeof completion.completedAt === 'number' &&
    Number.isFinite(completion.completedAt)
      ? completion.completedAt
      : undefined;
  const result = completion.result;
  if (
    !retryOwnershipId ||
    !launchSignature ||
    completedAt === undefined ||
    !isRecord(result)
  ) {
    return null;
  }
  const flowName =
    typeof result.flowName === 'string' && result.flowName.trim().length > 0
      ? result.flowName.trim()
      : undefined;
  const conversationId =
    typeof result.conversationId === 'string' &&
    result.conversationId.trim().length > 0
      ? result.conversationId.trim()
      : undefined;
  const inflightId =
    typeof result.inflightId === 'string' && result.inflightId.trim().length > 0
      ? result.inflightId.trim()
      : undefined;
  const providerId =
    typeof result.providerId === 'string' && result.providerId.trim().length > 0
      ? result.providerId.trim()
      : undefined;
  const modelId =
    typeof result.modelId === 'string' && result.modelId.trim().length > 0
      ? result.modelId.trim()
      : undefined;
  const warnings =
    Array.isArray(result.warnings) &&
    result.warnings.every((item) => typeof item === 'string')
      ? result.warnings.filter(
          (item): item is string => typeof item === 'string',
        )
      : undefined;
  if (!flowName || !conversationId || !inflightId || !providerId || !modelId) {
    return null;
  }
  return {
    retryOwnershipId,
    sourceId,
    launchSignature,
    completedAt,
    result: {
      flowName,
      conversationId,
      inflightId,
      providerId,
      modelId,
      ...(warnings ? { warnings: [...warnings] } : {}),
    },
  };
};

const getFreshRunRetryOwnershipCompletionFromConversation = (
  conversation: Conversation | null | undefined,
  params: {
    flowName: string;
    retryOwnershipId: string;
    launch: FreshRunRetryOwnershipLaunch;
  },
): FreshRunRetryOwnershipCompletionRecord | null => {
  if (!conversation || conversation.flowName !== params.flowName) return null;
  const flow = conversation.flags?.flow;
  if (!isRecord(flow)) return null;
  const completion = parseFreshRunRetryOwnershipCompletion(
    flow.retryOwnershipCompletion,
  );
  if (!completion) return null;
  if (completion.retryOwnershipId !== params.retryOwnershipId) return null;
  if (params.launch.sourceId) {
    if (completion.sourceId !== params.launch.sourceId) return null;
  } else if (completion.sourceId) {
    return null;
  }
  return completion;
};

const clearFreshRunRetryOwnershipCompletion = async (params: {
  conversationId: string;
  conversation: Conversation | null | undefined;
}) => {
  const conversation = params.conversation;
  if (!conversation) return;
  const flow = conversation.flags?.flow;
  if (!isRecord(flow) || !flow.retryOwnershipCompletion) return;
  const nextFlow = { ...flow } as Record<string, unknown>;
  delete nextFlow.retryOwnershipCompletion;
  if (shouldUseMemoryPersistence()) {
    updateMemoryConversationMeta(params.conversationId, {
      flags: {
        ...(conversation.flags ?? {}),
        flow: nextFlow,
      },
    });
    return;
  }
  await updateConversationFlowState({
    conversationId: params.conversationId,
    flow: nextFlow as FlowResumeState,
  });
};

const persistFreshRunRetryOwnershipCompletion = async (params: {
  conversationId: string;
  retryOwnershipId: string;
  result: FlowRunStartResult;
  launch: FreshRunRetryOwnershipLaunch;
}) => {
  const conversation = await getConversation(params.conversationId);
  if (!conversation) return;
  const completion: FreshRunRetryOwnershipCompletion = {
    retryOwnershipId: params.retryOwnershipId,
    sourceId: params.launch.sourceId,
    launchSignature: makeFreshRunRetryOwnershipLaunchSignature(params.launch),
    completedAt: Date.now(),
    result: cloneFlowRunStartResult(params.result),
  };
  const nextFlow = {
    ...(isRecord(conversation.flags?.flow)
      ? (conversation.flags.flow as Record<string, unknown>)
      : {}),
    retryOwnershipCompletion: completion,
  } as FlowResumeState;
  if (shouldUseMemoryPersistence()) {
    updateMemoryConversationMeta(params.conversationId, {
      flags: {
        ...(conversation.flags ?? {}),
        flow: nextFlow,
      },
    });
    return;
  }
  await updateConversationFlowState({
    conversationId: params.conversationId,
    flow: nextFlow,
  });
};

const getPersistedFreshRunRetryOwnershipCompletion = async (params: {
  flowName: string;
  sourceId?: string;
  retryOwnershipId: string;
  launch: FreshRunRetryOwnershipLaunch;
}): Promise<FreshRunRetryOwnershipCompletionRecord | null> => {
  const loadCompletedConversation = async (): Promise<Conversation | null> => {
    if (shouldUseMemoryPersistence()) {
      const conversation = [...memoryConversations.values()]
        .filter((item) => item.flowName === params.flowName)
        .filter((item) =>
          Boolean(
            getFreshRunRetryOwnershipCompletionFromConversation(item, params),
          ),
        )
        .sort((a, b) => {
          const first =
            getFreshRunRetryOwnershipCompletionFromConversation(a, params)
              ?.completedAt ?? 0;
          const second =
            getFreshRunRetryOwnershipCompletionFromConversation(b, params)
              ?.completedAt ?? 0;
          return second - first;
        })[0];
      return conversation ?? null;
    }

    return (await ConversationModel.findOne({
      flowName: params.flowName,
      'flags.flow.retryOwnershipCompletion.retryOwnershipId':
        params.retryOwnershipId,
      ...(params.sourceId
        ? {
            'flags.flow.retryOwnershipCompletion.sourceId': params.sourceId,
          }
        : {
            'flags.flow.retryOwnershipCompletion.sourceId': { $exists: false },
          }),
    })
      .sort({ 'flags.flow.retryOwnershipCompletion.completedAt': -1 })
      .lean()
      .exec()) as Conversation | null;
  };

  const conversation = await loadCompletedConversation();
  if (!conversation) return null;
  const completion = getFreshRunRetryOwnershipCompletionFromConversation(
    conversation,
    params,
  );
  if (!completion) {
    await clearFreshRunRetryOwnershipCompletion({
      conversationId: conversation._id,
      conversation,
    });
    return null;
  }
  const completedAt = completion.completedAt;
  if (
    Date.now() - completedAt >
    FRESH_RUN_RETRY_OWNERSHIP_COMPLETION_WINDOW_MS
  ) {
    await clearFreshRunRetryOwnershipCompletion({
      conversationId: conversation._id,
      conversation,
    });
    return null;
  }
  if (
    completion.launchSignature !==
    makeFreshRunRetryOwnershipLaunchSignature(params.launch)
  ) {
    throw toFlowRunError(
      'INVALID_REQUEST',
      'retryOwnershipId already belongs to a different fresh-run launch',
    );
  }
  return {
    retryOwnershipId: completion.retryOwnershipId,
    sourceId: completion.sourceId,
    result: cloneFlowRunStartResult(completion.result),
    launchSignature: completion.launchSignature,
    completedAt: completion.completedAt,
  };
};

const getFreshRunRetryOwnershipCompletion = async (params: {
  flowName: string;
  sourceId?: string;
  retryOwnershipId: string;
  launch: FreshRunRetryOwnershipLaunch;
}): Promise<FreshRunRetryOwnershipCompletionRecord | null> => {
  const key = makeFreshRunRetryOwnershipKey(params);
  const record = freshRunRetryOwnershipCompletedByKey.get(key);
  if (!record) return null;
  if (
    Date.now() - record.completedAt >
    FRESH_RUN_RETRY_OWNERSHIP_COMPLETION_WINDOW_MS
  ) {
    freshRunRetryOwnershipCompletedByKey.delete(key);
    return null;
  }
  if (
    record.launchSignature !==
    makeFreshRunRetryOwnershipLaunchSignature(params.launch)
  ) {
    throw toFlowRunError(
      'INVALID_REQUEST',
      'retryOwnershipId already belongs to a different fresh-run launch',
    );
  }
  return {
    retryOwnershipId: record.retryOwnershipId,
    sourceId: record.sourceId,
    result: cloneFlowRunStartResult(record.result),
    launchSignature: record.launchSignature,
    completedAt: record.completedAt,
  };
};

const getFreshRunRetryOwnership = async (params: {
  flowName: string;
  sourceId?: string;
  retryOwnershipId: string;
  launch: FreshRunRetryOwnershipLaunch;
}): Promise<FreshRunRetryOwnershipRecord | null> => {
  const key = makeFreshRunRetryOwnershipKey(params);
  const launchSignature = makeFreshRunRetryOwnershipLaunchSignature(
    params.launch,
  );
  const activeRecord = freshRunRetryOwnershipByKey.get(key);
  if (activeRecord) {
    if (activeRecord.launchSignature !== launchSignature) {
      throw toFlowRunError(
        'INVALID_REQUEST',
        'retryOwnershipId already belongs to a different fresh-run launch',
      );
    }
    return {
      runToken: activeRecord.runToken,
      result: cloneFlowRunStartResult(activeRecord.result),
      launchSignature: activeRecord.launchSignature,
    };
  }
  const completedRecord =
    (await getFreshRunRetryOwnershipCompletion(params)) ??
    (await getPersistedFreshRunRetryOwnershipCompletion(params));
  if (!completedRecord) return null;
  return {
    runToken: key,
    result: cloneFlowRunStartResult(completedRecord.result),
    launchSignature: completedRecord.launchSignature,
  };
};

const clearFreshRunRetryOwnership = (params: {
  flowName: string;
  sourceId?: string;
  retryOwnershipId: string;
  expectedRunToken?: string;
}) => {
  const key = makeFreshRunRetryOwnershipKey(params);
  const existing = freshRunRetryOwnershipByKey.get(key);
  if (!existing) return false;
  if (
    params.expectedRunToken !== undefined &&
    existing.runToken !== params.expectedRunToken
  ) {
    return false;
  }
  freshRunRetryOwnershipByKey.delete(key);
  return true;
};

export function __setFlowServiceDepsForTests(
  overrides: Partial<FlowServiceDeps>,
) {
  Object.assign(flowServiceDeps, overrides);
}

export function __resetFlowServiceDepsForTests() {
  Object.assign(flowServiceDeps, defaultFlowServiceDeps);
  freshRunRetryOwnershipByKey.clear();
  freshRunRetryOwnershipCompletedByKey.clear();
}

export function __resetFreshRunRetryOwnershipCompletionForTests() {
  freshRunRetryOwnershipCompletedByKey.clear();
}

export async function __getPersistedFreshRunRetryOwnershipCompletionForTests(params: {
  flowName: string;
  sourceId?: string;
  retryOwnershipId: string;
  launch: FreshRunRetryOwnershipLaunch;
}) {
  return getPersistedFreshRunRetryOwnershipCompletion(params);
}

const toFlowRunError = (
  code: FlowRunErrorCode,
  reason?: string,
  causeCode?: string,
) =>
  ({
    code,
    ...(reason ? { reason } : {}),
    ...(causeCode ? { causeCode } : {}),
  }) satisfies FlowRunError;

const isFlowRunError = (error: unknown): error is FlowRunError =>
  Boolean(error) &&
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof (error as { code?: unknown }).code === 'string';

const isSafeFlowName = (raw: string): boolean => {
  const name = raw.trim();
  if (!name) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('..')) return false;
  return true;
};

const isSafeCommandName = (raw: string): boolean => {
  const name = raw.trim();
  if (!name) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('..')) return false;
  return true;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const buildFlowConversationTitle = (params: {
  flowName: string;
  customTitle?: string;
}) => params.customTitle ?? `Flow: ${params.flowName}`;

const buildFlowAgentConversationTitle = (params: {
  flowName: string;
  identifier: string;
  customTitle?: string;
}) =>
  params.customTitle
    ? `${params.customTitle} (${params.identifier})`
    : `Flow: ${params.flowName} (${params.identifier})`;

const buildSubflowConversationTitle = (params: {
  parentFlowName: string;
  parentPersistedTitle?: string;
  parentCustomTitle?: string;
  stepLabel?: string;
  childFlowName: string;
  multipleChildren?: boolean;
}) => {
  const parentTitle =
    params.parentPersistedTitle?.trim() ||
    params.parentCustomTitle?.trim() ||
    params.parentFlowName;
  const trimmedStepLabel = params.stepLabel?.trim();
  const stepTitle =
    params.multipleChildren && trimmedStepLabel
      ? `${trimmedStepLabel}-${params.childFlowName}`
      : trimmedStepLabel || params.childFlowName;
  return `${parentTitle}-${stepTitle}`;
};

const buildFlowPathEntry = (params: { flowName: string; sourceId?: string }) =>
  params.sourceId?.trim()
    ? `${params.flowName.trim()}@${params.sourceId.trim()}`
    : params.flowName.trim();

const normalizeNumberArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item) => typeof item === 'number' && Number.isFinite(item),
  );
};

const normalizeOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;

const normalizeStringMap = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).filter(
    ([, item]) => typeof item === 'string',
  ) as Array<[string, string]>;
  return Object.fromEntries(entries);
};

const normalizeActiveSubflow = (value: unknown): FlowActiveSubflow | null => {
  if (!isRecord(value)) return null;
  const flowName = normalizeOptionalString(value.flowName);
  const conversationId = normalizeOptionalString(value.conversationId);
  const runToken = normalizeOptionalString(value.runToken);
  if (!flowName || !conversationId || !runToken) return null;
  return {
    stepPath: normalizeNumberArray(value.stepPath),
    flowName,
    conversationId,
    runToken,
    ...(normalizeOptionalString(value.title)
      ? { title: normalizeOptionalString(value.title) }
      : {}),
  };
};

const buildFlowReingestRequestLogContext = (params: {
  flowName: string;
  stepIndex: number;
  step: FlowReingestStep;
}) => ({
  surface: 'flow',
  targetMode: 'sourceId' in params.step ? 'sourceId' : params.step.target,
  requestedSelector: 'sourceId' in params.step ? params.step.sourceId : null,
  schemaSource: 'flow',
  flowName: params.flowName,
  stepIndex: params.stepIndex,
});

const parseFlowResumeState = (
  flags: Record<string, unknown> | undefined,
): FlowResumeState | null => {
  const flow = flags?.flow;
  if (!isRecord(flow)) return null;
  const executionId =
    typeof flow.executionId === 'string' && flow.executionId.trim().length > 0
      ? flow.executionId.trim()
      : undefined;

  const stepPath = normalizeNumberArray(flow.stepPath);
  const loopStack = Array.isArray(flow.loopStack)
    ? flow.loopStack
        .map((item) => {
          if (!isRecord(item)) return null;
          const rawStepPath =
            item.loopStepPath ?? (item.stepPath as unknown | undefined);
          return {
            loopStepPath: normalizeNumberArray(rawStepPath),
            iteration:
              typeof item.iteration === 'number' &&
              Number.isFinite(item.iteration)
                ? item.iteration
                : 0,
          };
        })
        .filter((item): item is { loopStepPath: number[]; iteration: number } =>
          Boolean(item),
        )
    : [];

  const agentConversations = normalizeStringMap(flow.agentConversations);
  const agentWorkingFolders = normalizeStringMap(flow.agentWorkingFolders);
  const agentThreads = normalizeStringMap(flow.agentThreads);
  const agentProviders = normalizeStringMap(flow.agentProviders);
  const agentModels = normalizeStringMap(flow.agentModels);
  const agentRequestedProviders = normalizeStringMap(
    flow.agentRequestedProviders,
  );
  const agentEndpointIds = normalizeStringMap(flow.agentEndpointIds);
  const retryOwnershipCompletion = parseFreshRunRetryOwnershipCompletion(
    flow.retryOwnershipCompletion,
  );
  const activeSubflows = Array.isArray(flow.activeSubflows)
    ? flow.activeSubflows
        .map((item) => normalizeActiveSubflow(item))
        .filter((item): item is FlowActiveSubflow => Boolean(item))
    : (() => {
        const legacyActiveSubflow = normalizeActiveSubflow(
          (flow as { activeSubflow?: unknown }).activeSubflow,
        );
        return legacyActiveSubflow ? [legacyActiveSubflow] : [];
      })();
  const pendingLoopControl = isRecord(flow.pendingLoopControl)
    ? flow.pendingLoopControl.kind === 'continue'
      ? {
          kind: 'continue' as const,
          loopStepPath: normalizeNumberArray(
            flow.pendingLoopControl.loopStepPath,
          ),
        }
      : null
    : null;

  return {
    executionId: executionId ?? crypto.randomUUID(),
    stepPath,
    loopStack,
    ...(pendingLoopControl
      ? {
          pendingLoopControl,
        }
      : {}),
    ...(activeSubflows.length > 0 ? { activeSubflows } : {}),
    ...(typeof flow.codexReviewModelId === 'string' &&
    flow.codexReviewModelId.trim()
      ? { codexReviewModelId: flow.codexReviewModelId.trim() }
      : {}),
    ...(typeof flow.workingFolder === 'string' && flow.workingFolder.trim()
      ? { workingFolder: flow.workingFolder.trim() }
      : {}),
    agentConversations,
    ...(Object.keys(agentWorkingFolders).length > 0
      ? { agentWorkingFolders }
      : {}),
    agentThreads,
    ...(Object.keys(agentProviders).length > 0 ? { agentProviders } : {}),
    ...(Object.keys(agentModels).length > 0 ? { agentModels } : {}),
    ...(Object.keys(agentRequestedProviders).length > 0
      ? { agentRequestedProviders }
      : {}),
    ...(Object.keys(agentEndpointIds).length > 0 ? { agentEndpointIds } : {}),
    ...(retryOwnershipCompletion ? { retryOwnershipCompletion } : {}),
  };
};

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

const getFlowChildExecutionId = (
  conversation: Conversation | null | undefined,
): string | null => {
  const flags = (conversation?.flags ?? {}) as {
    flowChild?: { executionId?: unknown };
  };
  if (
    typeof flags.flowChild?.executionId === 'string' &&
    flags.flowChild.executionId.trim().length > 0
  ) {
    return flags.flowChild.executionId.trim();
  }
  return null;
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

const persistFlowChildExecutionId = async (params: {
  conversationId: string;
  executionId: string;
}) => {
  if (shouldUseMemoryPersistence()) {
    const existing = memoryConversations.get(params.conversationId);
    if (!existing) return;
    if (getFlowChildExecutionId(existing)) return;
    updateMemoryConversationMeta(params.conversationId, {
      flags: {
        ...(existing.flags ?? {}),
        flowChild: {
          ...((
            (existing.flags ?? {}) as { flowChild?: Record<string, unknown> }
          ).flowChild ?? {}),
          executionId: params.executionId,
        },
      },
    });
    return;
  }

  await updateConversationFlowChildExecution(params);
};

const ensureFlowChildConversationOwnership = async (params: {
  conversationId: string;
  agentType: string;
  executionId: string;
}): Promise<{ needsExecutionIdBackfill: boolean }> => {
  const conversation = await getConversation(params.conversationId);
  if (!conversation) {
    throw toFlowRunError(
      'INVALID_REQUEST',
      `Missing child conversation for ${params.agentType}`,
    );
  }
  if (conversation.agentName !== params.agentType) {
    throw toFlowRunError(
      'AGENT_MISMATCH',
      `Agent mismatch for ${params.agentType}`,
    );
  }

  const childExecutionId = getFlowChildExecutionId(conversation);
  if (
    childExecutionId &&
    childExecutionId.trim() !== params.executionId.trim()
  ) {
    throw toFlowRunError(
      'INVALID_REQUEST',
      `Child conversation execution mismatch for ${params.agentType}`,
    );
  }

  return {
    needsExecutionIdBackfill: !childExecutionId,
  };
};

type FlowResumeTestDeps = {
  ensureFlowChildConversationOwnership: typeof ensureFlowChildConversationOwnership;
  persistFlowChildExecutionId: typeof persistFlowChildExecutionId;
};

const defaultFlowResumeTestDeps: FlowResumeTestDeps = {
  ensureFlowChildConversationOwnership,
  persistFlowChildExecutionId,
};

const flowResumeTestDeps: FlowResumeTestDeps = {
  ...defaultFlowResumeTestDeps,
};

export function __setFlowResumeTestDepsForTests(
  overrides: Partial<FlowResumeTestDeps>,
) {
  Object.assign(flowResumeTestDeps, overrides);
}

export function __resetFlowResumeTestDepsForTests() {
  Object.assign(flowResumeTestDeps, defaultFlowResumeTestDeps);
}

export function __getFlowResumeTestDepsForTests(): FlowResumeTestDeps {
  return defaultFlowResumeTestDeps;
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
  surface: 'flow_run';
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

const ensureFlowConversation = async (params: {
  conversationId: string;
  flowName: string;
  providerId: ConversationProvider;
  modelId: string;
  customTitle?: string;
  source: 'REST' | 'MCP';
  workingFolder?: string;
}): Promise<void> => {
  const now = new Date();
  const title = buildFlowConversationTitle({
    flowName: params.flowName,
    customTitle: params.customTitle,
  });
  if (shouldUseMemoryPersistence()) {
    const existing = memoryConversations.get(params.conversationId);
    if (existing) {
      updateMemoryConversationMeta(params.conversationId, {
        provider: params.providerId,
        model: params.modelId,
        flowName: existing.flowName ?? params.flowName,
        lastMessageAt: now,
      });
      return;
    }
    memoryConversations.set(params.conversationId, {
      _id: params.conversationId,
      provider: params.providerId,
      model: params.modelId,
      title,
      flowName: params.flowName,
      source: params.source,
      flags: params.workingFolder
        ? { workingFolder: params.workingFolder }
        : {},
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);
    if (params.customTitle) {
      baseLogger.info(
        {
          flowName: params.flowName,
          conversationId: params.conversationId,
          agentName: undefined,
          customTitle: params.customTitle,
        },
        'flows.run.custom_title.applied',
      );
    }
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
    title,
    flowName: params.flowName,
    source: params.source,
    flags: params.workingFolder ? { workingFolder: params.workingFolder } : {},
    lastMessageAt: now,
  });
  if (params.customTitle) {
    baseLogger.info(
      {
        flowName: params.flowName,
        conversationId: params.conversationId,
        agentName: undefined,
        customTitle: params.customTitle,
      },
      'flows.run.custom_title.applied',
    );
  }
};

const ensureFlowAgentConversation = async (params: {
  conversationId: string;
  flowName: string;
  agentType: string;
  identifier: string;
  executionId: string;
  providerId: ConversationProvider;
  modelId: string;
  requestedProviderId?: string;
  endpointId?: string | null;
  customTitle?: string;
  source: 'REST' | 'MCP';
  workingFolder?: string;
}): Promise<void> => {
  const now = new Date();
  const title = buildFlowAgentConversationTitle({
    flowName: params.flowName,
    identifier: params.identifier,
    customTitle: params.customTitle,
  });
  if (shouldUseMemoryPersistence()) {
    const existing = memoryConversations.get(params.conversationId);
    if (existing) {
      const nextFlags = {
        ...(existing.flags ?? {}),
        ...(params.requestedProviderId?.trim()
          ? { requestedProviderId: params.requestedProviderId.trim() }
          : {}),
        ...(params.endpointId?.trim()
          ? { endpointId: params.endpointId.trim() }
          : {}),
      } as Record<string, unknown>;
      if (params.endpointId === null) {
        delete nextFlags.endpointId;
      }
      updateMemoryConversationMeta(params.conversationId, {
        provider: params.providerId,
        model: params.modelId,
        agentName: params.agentType,
        flags: nextFlags,
        lastMessageAt: now,
      });
      if (params.workingFolder) {
        updateMemoryConversationWorkingFolder({
          conversationId: params.conversationId,
          workingFolder: params.workingFolder,
        });
      }
      return;
    }
    memoryConversations.set(params.conversationId, {
      _id: params.conversationId,
      provider: params.providerId,
      model: params.modelId,
      title,
      agentName: params.agentType,
      source: params.source,
      flags: {
        ...(params.workingFolder
          ? { workingFolder: params.workingFolder }
          : {}),
        ...(params.requestedProviderId?.trim()
          ? { requestedProviderId: params.requestedProviderId.trim() }
          : {}),
        ...(params.endpointId?.trim()
          ? { endpointId: params.endpointId.trim() }
          : {}),
        flowChild: { executionId: params.executionId },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);
    if (params.customTitle) {
      baseLogger.info(
        {
          flowName: params.flowName,
          conversationId: params.conversationId,
          agentName: params.agentType,
          customTitle: params.customTitle,
        },
        'flows.run.custom_title.applied',
      );
    }
    return;
  }

  const existing = (await ConversationModel.findById(params.conversationId)
    .lean()
    .exec()) as Conversation | null;
  if (existing) {
    const nextFlags = {
      ...(existing.flags ?? {}),
      ...(params.requestedProviderId?.trim()
        ? { requestedProviderId: params.requestedProviderId.trim() }
        : {}),
      ...(params.endpointId?.trim()
        ? { endpointId: params.endpointId.trim() }
        : {}),
    } as Record<string, unknown>;
    if (params.endpointId === null) {
      delete nextFlags.endpointId;
    }
    const metaOutcome = await updateConversationMeta({
      conversationId: params.conversationId,
      provider: params.providerId,
      model: params.modelId,
      flags: nextFlags,
      replaceFlags: true,
      lastMessageAt: now,
    });
    if (metaOutcome.outcome === 'not_found') {
      throw toFlowRunError('CONVERSATION_ARCHIVED');
    }
    if (metaOutcome.outcome === 'retry_exhausted') {
      throw new Error('flow conversation metadata update exhausted');
    }
    if (params.workingFolder) {
      await updateConversationWorkingFolder({
        conversationId: params.conversationId,
        workingFolder: params.workingFolder,
      });
    }
    return;
  }

  await createConversation({
    conversationId: params.conversationId,
    provider: params.providerId,
    model: params.modelId,
    title,
    agentName: params.agentType,
    source: params.source,
    flags: {
      ...(params.workingFolder ? { workingFolder: params.workingFolder } : {}),
      ...(params.requestedProviderId?.trim()
        ? { requestedProviderId: params.requestedProviderId.trim() }
        : {}),
      ...(params.endpointId?.trim()
        ? { endpointId: params.endpointId.trim() }
        : {}),
      flowChild: { executionId: params.executionId },
    },
    lastMessageAt: now,
  });
  if (params.customTitle) {
    baseLogger.info(
      {
        flowName: params.flowName,
        conversationId: params.conversationId,
        agentName: params.agentType,
        customTitle: params.customTitle,
      },
      'flows.run.custom_title.applied',
    );
  }
};

const flowsDirForRun = () => {
  if (process.env.FLOWS_DIR) return path.resolve(process.env.FLOWS_DIR);
  const { codeInfoRoot } = resolveAgentHomeEnv();
  if (codeInfoRoot) return path.join(codeInfoRoot, 'flows');
  return path.resolve('flows');
};

const codeInfo2RootForRun = () => resolveAgentHomeEnv().codeInfoRoot;

const resolveFlowFilePath = (flowName: string, flowsRoot: string) => {
  if (!isSafeFlowName(flowName)) {
    throw toFlowRunError('FLOW_NOT_FOUND', 'Invalid flow name');
  }

  const filePath = path.resolve(flowsRoot, `${flowName}.json`);
  const relativePath = path.relative(flowsRoot, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw toFlowRunError('FLOW_NOT_FOUND', 'Invalid flow path');
  }
  return filePath;
};

const loadFlowFile = async (params: {
  flowName: string;
  flowsRoot: string;
  sourceId?: string;
}): Promise<FlowFile> => {
  const filePath = resolveFlowFilePath(params.flowName, params.flowsRoot);
  append({
    level: 'info',
    message: 'DEV-0000034:T4:flow_run_resolved',
    source: 'server',
    timestamp: new Date().toISOString(),
    context: {
      flowName: params.flowName,
      sourceId: params.sourceId ?? 'local',
      flowPath: filePath,
    },
  });
  const jsonText = await fs.readFile(filePath, 'utf8').catch((error) => {
    if ((error as { code?: string }).code === 'ENOENT') {
      throw toFlowRunError('FLOW_NOT_FOUND');
    }
    throw error;
  });

  const parsed = parseFlowFile(jsonText, {
    flowName: params.flowName,
    emitSchemaParseLogs: true,
  });
  if (!parsed.ok) {
    throw toFlowRunError('FLOW_INVALID');
  }

  return parsed.flow;
};

const getAgentKey = (agentType: string, identifier: string) =>
  `${agentType}:${identifier}`;

const getStepPathKey = (stepPath: number[]) => stepPath.join('.');

const ensureAgentState = async (params: {
  runtimeState: FlowExecutionRuntimeState;
  agentType: string;
  identifier: string;
  executionId: string;
  flowName: string;
  providerId: ConversationProvider;
  modelId: string;
  requestedProviderId?: string;
  endpointId?: string | null;
  workingFolder?: string;
  customTitle?: string;
  source: 'REST' | 'MCP';
}): Promise<{ state: FlowAgentState; isNew: boolean }> => {
  const key = getAgentKey(params.agentType, params.identifier);
  const existing = params.runtimeState.get(key);
  if (existing) {
    // Prefer explicit requestedProviderId from params, otherwise consult existing conversation flags.
    const existingConversation = await getConversation(existing.conversationId);
    const requestedProviderIdToUse =
      typeof params.requestedProviderId === 'string' &&
      params.requestedProviderId.trim()
        ? params.requestedProviderId.trim()
        : getSavedRequestedProviderId(existingConversation);
    const savedEndpointId =
      typeof existingConversation?.flags?.endpointId === 'string' &&
      existingConversation.flags.endpointId.trim().length > 0
        ? existingConversation.flags.endpointId.trim()
        : undefined;
    if (savedEndpointId && !existing.endpointId) {
      existing.endpointId = savedEndpointId;
    }
    const endpointIdToUse =
      params.endpointId !== undefined ? params.endpointId : savedEndpointId;

    await ensureFlowChildConversationOwnership({
      conversationId: existing.conversationId,
      agentType: params.agentType,
      executionId: params.executionId,
    });

    await ensureFlowAgentConversation({
      conversationId: existing.conversationId,
      flowName: params.flowName,
      agentType: params.agentType,
      identifier: params.identifier,
      executionId: params.executionId,
      providerId: params.providerId,
      modelId: params.modelId,
      requestedProviderId: requestedProviderIdToUse,
      endpointId: endpointIdToUse ?? null,
      customTitle: params.customTitle,
      source: params.source,
      workingFolder: params.workingFolder,
    });
    existing.workingFolder = params.workingFolder;
    existing.providerId = params.providerId;
    existing.modelId = params.modelId;
    if (requestedProviderIdToUse)
      existing.requestedProviderId = requestedProviderIdToUse;
    if (params.endpointId !== undefined) {
      if (params.endpointId === null) {
        delete existing.endpointId;
      } else if (params.endpointId.trim()) {
        existing.endpointId = params.endpointId.trim();
      }
    } else if (savedEndpointId && !existing.endpointId) {
      existing.endpointId = savedEndpointId;
    }
    return { state: existing, isNew: false };
  }

  const state = {
    conversationId: crypto.randomUUID(),
    providerId: params.providerId,
    modelId: params.modelId,
    ...(params.requestedProviderId
      ? { requestedProviderId: params.requestedProviderId }
      : {}),
    ...(params.endpointId?.trim()
      ? { endpointId: params.endpointId.trim() }
      : {}),
    ...(params.workingFolder ? { workingFolder: params.workingFolder } : {}),
  } satisfies FlowAgentState;
  params.runtimeState.set(key, state);
  await ensureFlowAgentConversation({
    conversationId: state.conversationId,
    flowName: params.flowName,
    agentType: params.agentType,
    identifier: params.identifier,
    executionId: params.executionId,
    providerId: params.providerId,
    modelId: params.modelId,
    requestedProviderId: params.requestedProviderId,
    endpointId: params.endpointId ?? null,
    customTitle: params.customTitle,
    source: params.source,
    workingFolder: params.workingFolder,
  });
  await ensureFlowChildConversationOwnership({
    conversationId: state.conversationId,
    agentType: params.agentType,
    executionId: params.executionId,
  });
  return { state, isNew: true };
};

const getAgentModelId = async (params: {
  agentName: string;
  configPath: string;
  workingFolder?: string;
  defaultRepositoryRoot?: string;
  source?: 'REST' | 'MCP';
}): Promise<string> => {
  const { modelId } = await resolveFlowAgentRuntimeExecution({
    agentName: params.agentName,
    configPath: params.configPath,
    workingFolder: params.workingFolder,
    defaultRepositoryRoot: params.defaultRepositoryRoot,
    source: params.source,
  });
  return modelId;
};

const getFailureModelId = async (params: {
  agentName: string;
  configPath: string;
  workingFolder?: string;
  defaultRepositoryRoot?: string;
  source?: 'REST' | 'MCP';
}): Promise<string> => {
  try {
    return await getAgentModelId(params);
  } catch {
    return FALLBACK_MODEL_ID;
  }
};

const resolveFlowAgentRuntimeExecution = async (params: {
  agentName: string;
  configPath: string;
  workingFolder?: string;
  defaultRepositoryRoot?: string;
  source?: 'REST' | 'MCP';
  pinnedProviderId?: ConversationProvider;
  pinnedModelId?: string;
  pinnedRequestedProviderId?: string;
  pinnedEndpointId?: string | null;
  allowFallback?: boolean;
}) => {
  try {
    const resolved = await prepareFlowOwnedAgentExecution({
      agentName: params.agentName,
      configPath: params.configPath,
      workingFolder: params.workingFolder,
      defaultRepositoryRoot: params.defaultRepositoryRoot,
      source: params.source ?? 'REST',
      pinnedProviderId: params.pinnedProviderId,
      pinnedModelId: params.pinnedModelId,
      pinnedRequestedProviderId: params.pinnedRequestedProviderId,
      pinnedEndpointId: params.pinnedEndpointId ?? undefined,
      allowFallback: params.allowFallback ?? true,
    });
    if (params.source) {
      console.info(T07_SUCCESS_LOG, {
        surface: 'flow.run',
        source: params.source,
        hasModel: Boolean(resolved.modelId),
      });
    }
    return {
      modelId: resolved.modelId ?? FALLBACK_MODEL_ID,
      providerId: resolved.executionProviderId,
      requestedProviderId: resolved.requestedProviderId,
      endpointId: resolved.endpointId,
      runtimeConfig: resolved.runtimeConfig as CodexOptions['config'],
      workingDirectoryOverride: resolved.workingDirectoryOverride,
      warnings: resolved.warnings,
    };
  } catch (error) {
    if (params.source) {
      const code =
        error &&
        typeof error === 'object' &&
        typeof (error as { code?: unknown }).code === 'string'
          ? String((error as { code?: string }).code)
          : 'UNKNOWN_ERROR';
      console.error(
        `${T07_ERROR_LOG} surface=flow.run source=${params.source} code=${code}`,
      );
    }
    const flowErrorCode =
      error &&
      typeof error === 'object' &&
      typeof (error as { code?: unknown }).code === 'string'
        ? String((error as { code?: string }).code)
        : undefined;
    if (
      flowErrorCode === 'INVALID_PROVIDER' ||
      flowErrorCode === 'PROVIDER_UNAVAILABLE'
    ) {
      throw toFlowRunError(
        flowErrorCode,
        (error as { reason?: string; message?: string }).reason ??
          (error as { message?: string }).message,
      );
    }
    throw error;
  }
};

const CODEX_REVIEW_REASONING_EFFORTS = new Set<CodexReviewReasoningEffort>([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

const resolveCodexReviewAgentProfile = async (params: {
  step: FlowCodexReviewStep;
  agentByName: Map<string, { configPath: string }>;
  workingFolder?: string;
  defaultRepositoryRoot?: string;
  source: 'REST' | 'MCP';
}): Promise<{
  agentType?: string;
  modelId?: string;
  reasoningEffort?: CodexReviewReasoningEffort;
  warnings: string[];
}> => {
  if (params.step.modelSource !== 'flow_request_or_step_or_agent') {
    return { warnings: [] };
  }

  const agentType = params.step.agentType;
  if (!agentType) {
    throw toFlowRunError(
      'INVALID_REQUEST',
      'codexReview requires agentType when modelSource is flow_request_or_step_or_agent.',
    );
  }

  const validatedAgentType = validateRepositoryBackedAgentType(agentType);
  if (!validatedAgentType.ok) {
    throw toFlowRunError(
      'INVALID_REQUEST',
      `Flow agent "${agentType}" ${validatedAgentType.message}.`,
    );
  }

  const agent = params.agentByName.get(agentType);
  if (!agent) {
    throw toFlowRunError('AGENT_NOT_FOUND', `Agent ${agentType} not found`);
  }

  const prepared = await resolveFlowAgentRuntimeExecution({
    agentName: agentType,
    configPath: agent.configPath,
    workingFolder: params.workingFolder,
    defaultRepositoryRoot: params.defaultRepositoryRoot,
    source: params.source,
    allowFallback: false,
  });
  if (prepared.providerId !== 'codex') {
    throw toFlowRunError(
      'INVALID_REQUEST',
      `codexReview agent ${agentType} must resolve to the codex provider.`,
    );
  }

  const configuredReasoningEffort =
    prepared.runtimeConfig?.model_reasoning_effort;
  if (
    configuredReasoningEffort !== undefined &&
    !CODEX_REVIEW_REASONING_EFFORTS.has(
      configuredReasoningEffort as CodexReviewReasoningEffort,
    )
  ) {
    throw toFlowRunError(
      'INVALID_REQUEST',
      `codexReview agent ${agentType} has unsupported model_reasoning_effort "${configuredReasoningEffort}".`,
    );
  }

  return {
    agentType,
    modelId: prepared.modelId,
    reasoningEffort: configuredReasoningEffort as
      | CodexReviewReasoningEffort
      | undefined,
    warnings: prepared.warnings ?? [],
  };
};

const hydrateFlowAgentState = (resumeState: FlowResumeState | null) => {
  const runtimeState: FlowExecutionRuntimeState = new Map();
  if (!resumeState) return runtimeState;
  Object.entries(resumeState.agentConversations).forEach(
    ([key, conversationId]) => {
      const threadId = resumeState.agentThreads[key];
      const workingFolder = resumeState.agentWorkingFolders?.[key];
      const providerId = resumeState.agentProviders?.[key];
      const modelId = resumeState.agentModels?.[key];
      const requestedProviderId = resumeState.agentRequestedProviders?.[key];
      const endpointId = resumeState.agentEndpointIds?.[key];
      runtimeState.set(key, {
        conversationId,
        threadId,
        ...(providerId ? { providerId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(requestedProviderId ? { requestedProviderId } : {}),
        ...(endpointId ? { endpointId } : {}),
        ...(workingFolder ? { workingFolder } : {}),
      });
    },
  );
  return runtimeState;
};

const persistAgentThreadId = async (params: {
  conversationId: string;
  threadId: string;
}) => {
  if (shouldUseMemoryPersistence()) {
    const existing = memoryConversations.get(params.conversationId);
    if (!existing) return;
    updateMemoryConversationMeta(params.conversationId, {
      flags: {
        ...(existing.flags ?? {}),
        threadId: params.threadId,
      },
    });
    return;
  }

  await updateConversationThreadId({
    conversationId: params.conversationId,
    threadId: params.threadId,
  });
};

const shouldStopAfter = (status: TurnStatus): boolean => status !== 'ok';

const deriveStatusFromError = (message: string | undefined): TurnStatus => {
  const text = (message ?? '').toLowerCase();
  if (text.includes('abort') || text.includes('stop')) return 'stopped';
  return 'failed';
};

const joinMessageContent = (content: string[]) => content.join('\n');

type FlowTurnCommandMetadata = Extract<TurnCommandMetadata, { name: 'flow' }>;

const buildFlowCommandMetadata = (params: {
  step:
    | FlowLlmStep
    | FlowBreakStep
    | FlowContinueStep
    | FlowCommandStep
    | FlowResetStep
    | FlowPrepareReviewBaseStep
    | FlowCodexReviewStep
    | FlowValidateReviewArtifactsStep
    | FlowSubflowStep
    | FlowReingestStep;
  stepIndex: number;
  totalSteps: number;
  loopDepth: number;
}): FlowTurnCommandMetadata => {
  const rawLabel = params.step.label?.trim();
  const label = rawLabel && rawLabel.length > 0 ? rawLabel : params.step.type;
  return {
    name: 'flow',
    stepIndex: params.stepIndex,
    totalSteps: params.totalSteps,
    loopDepth: params.loopDepth,
    label,
    ...('agentType' in params.step && 'identifier' in params.step
      ? {
          agentType: params.step.agentType,
          identifier: params.step.identifier,
        }
      : {}),
  };
};

type FlowInstructionResult = {
  status: TurnStatus;
  content: string;
  toolCalls: Record<string, unknown> | null;
  usage?: TurnUsageMetadata;
  timing?: TurnTimingMetadata;
};

type FlowInstructionPostProcess = (result: FlowInstructionResult) => {
  status?: TurnStatus;
  content?: string;
  finalOverride?: {
    status: TurnStatus;
    error?: { code?: string; message?: string };
  };
};

type FlowInstructionResultDecision = {
  persist: boolean;
  finalize: boolean;
};

async function persistFlowTurn(params: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  model: string;
  provider: string;
  source: 'REST' | 'MCP';
  status: TurnStatus;
  toolCalls: Record<string, unknown> | null;
  command?: TurnCommandMetadata;
  runtime?: TurnRuntimeMetadata;
  usage?: TurnUsageMetadata;
  timing?: TurnTimingMetadata;
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
      usage: params.usage,
      timing: params.timing,
      createdAt: params.createdAt,
    } as Turn);
    updateMemoryConversationMeta(params.conversationId, {
      lastMessageAt: params.createdAt,
      model: params.model,
    });
    return {};
  }

  const metaOutcome = await updateConversationMeta({
    conversationId: params.conversationId,
    lastMessageAt: params.createdAt,
    model: params.model,
  });
  if (metaOutcome.outcome === 'not_found') {
    throw toFlowRunError('CONVERSATION_ARCHIVED');
  }
  if (metaOutcome.outcome === 'retry_exhausted') {
    throw new Error('flow turn metadata update exhausted');
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
    usage: params.usage,
    timing: params.timing,
    createdAt: params.createdAt,
  });

  const turnId =
    turn && typeof turn === 'object' && '_id' in (turn as object)
      ? String((turn as { _id?: unknown })._id ?? '')
      : undefined;

  return turnId?.length ? { turnId } : {};
}

const logAgentTurnPersisted = (params: {
  flowConversationId: string;
  agentConversationId: string;
  agentType: string;
  identifier: string;
  role: 'user' | 'assistant';
  turnId?: string;
}) => {
  const timestamp = new Date().toISOString();
  append({
    level: 'info',
    message: 'flows.agent.turn_persisted',
    timestamp,
    source: 'server',
    context: {
      flowConversationId: params.flowConversationId,
      agentConversationId: params.agentConversationId,
      agentType: params.agentType,
      identifier: params.identifier,
      role: params.role,
      turnId: params.turnId,
    },
  });
  baseLogger.info(
    {
      flowConversationId: params.flowConversationId,
      agentConversationId: params.agentConversationId,
      agentType: params.agentType,
      identifier: params.identifier,
      role: params.role,
      turnId: params.turnId,
    },
    'flows.agent.turn_persisted',
  );
};

const logFlowInstructionStatusReclassified = (params: {
  flowConversationId: string;
  agentConversationId: string;
  inflightId: string;
  fromStatus: TurnStatus;
  toStatus: TurnStatus;
}) => {
  const timestamp = new Date().toISOString();
  append({
    level: 'info',
    message: 'DEV-0000049:T03:flow_instruction_status_reclassified',
    timestamp,
    source: 'server',
    context: {
      flowConversationId: params.flowConversationId,
      agentConversationId: params.agentConversationId,
      inflightId: params.inflightId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      reason: 'inflight-signal-aborted-after-complete',
    },
  });
  baseLogger.info(
    {
      flowConversationId: params.flowConversationId,
      agentConversationId: params.agentConversationId,
      inflightId: params.inflightId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      reason: 'inflight-signal-aborted-after-complete',
    },
    'DEV-0000049:T03:flow_instruction_status_reclassified',
  );
};

const logFlowTurnStatusPersisted = (params: {
  flowConversationId: string;
  agentConversationId: string;
  inflightId: string;
  turnId?: string;
  threadId?: string;
  status: TurnStatus;
  stepIndex?: number;
  scope: 'flow_assistant' | 'agent_assistant';
  targetConversationId: string;
}) => {
  const timestamp = new Date().toISOString();
  append({
    level: 'info',
    message: 'DEV-0000049:T03:flow_turn_status_persisted',
    timestamp,
    source: 'server',
    context: {
      flowConversationId: params.flowConversationId,
      agentConversationId: params.agentConversationId,
      turnId: params.turnId,
      inflightId: params.inflightId,
      threadId: params.threadId ?? null,
      status: params.status,
      stepIndex: params.stepIndex ?? null,
      scope: params.scope,
      targetConversationId: params.targetConversationId,
    },
  });
  baseLogger.info(
    {
      flowConversationId: params.flowConversationId,
      agentConversationId: params.agentConversationId,
      turnId: params.turnId,
      inflightId: params.inflightId,
      threadId: params.threadId ?? null,
      status: params.status,
      stepIndex: params.stepIndex ?? null,
      scope: params.scope,
      targetConversationId: params.targetConversationId,
    },
    'DEV-0000049:T03:flow_turn_status_persisted',
  );
};

const runFlowInstruction = async (params: {
  flowConversationId: string;
  inflightId: string;
  instruction: string;
  agentType: string;
  identifier: string;
  agentConversationId: string;
  providerId: ConversationProvider;
  modelId: string;
  endpointId?: string | null;
  runtimeConfig: CodexOptions['config'];
  threadId?: string;
  systemPrompt?: string;
  workingDirectoryOverride?: string;
  source: 'REST' | 'MCP';
  chatFactory?: FlowChatFactory;
  deferFinal?: boolean;
  postProcess?: FlowInstructionPostProcess;
  onResult?: (
    result: FlowInstructionResult,
    context: { attempt: number },
  ) => FlowInstructionResultDecision;
  attempt?: number;
  onThreadId: (threadId: string) => void;
  command?: TurnCommandMetadata;
  runtime?: TurnRuntimeMetadata;
  envOverrides?: NodeJS.ProcessEnv;
  runToken?: string;
  onStopUnwindCheckpoint?: (params: {
    checkpoint: string;
    conversationId: string;
    detail?: string;
  }) => void | Promise<void>;
  cleanupInflightFn?: typeof cleanupInflight;
}): Promise<FlowInstructionResult> => {
  const createdAtIso = new Date().toISOString();
  createInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: params.providerId,
    model: params.modelId,
    source: params.source,
    command: params.command,
    userTurn: { content: params.instruction, createdAt: createdAtIso },
  });

  publishUserTurn({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    content: params.instruction,
    createdAt: createdAtIso,
  });

  const resolvedChatFactory = params.chatFactory ?? getChatInterface;
  let chat;
  try {
    chat = resolvedChatFactory(
      params.providerId,
      params.providerId === 'copilot'
        ? { copilotEnv: { ...process.env, ...params.envOverrides } }
        : undefined,
    );
  } catch (err) {
    if (err instanceof UnsupportedProviderError) {
      throw new Error(err.message);
    }
    throw err;
  }

  const bridge = attachChatStreamBridge({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: params.providerId,
    model: params.modelId,
    chat,
    deferFinal: params.deferFinal,
  });

  const tokenBuffer: string[] = [];
  const toolResults = new Map<string, ChatToolResultEvent>();
  let finalContent = '';
  let status: TurnStatus = 'ok';
  let lastErrorMessage: string | undefined;
  let sawComplete = false;
  let latestUsage: TurnUsageMetadata | undefined;
  let latestTiming: TurnTimingMetadata | undefined;

  const onToken = (event: ChatTokenEvent) => {
    tokenBuffer.push(event.content);
  };
  const onFinal = (event: ChatFinalEvent) => {
    finalContent = event.content;
  };
  const onToolResult = (event: ChatToolResultEvent) => {
    toolResults.set(event.callId, event);
  };
  const onError = (event: ChatErrorEvent) => {
    if (isTransientReconnect(event.message)) return;
    lastErrorMessage = event.message;
    status = deriveStatusFromError(event.message);
  };
  const onComplete = (event: ChatCompleteEvent) => {
    sawComplete = true;
    if (event.usage) latestUsage = event.usage;
    if (event.timing) latestTiming = event.timing;
  };
  const onThread = (event: { threadId?: string }) => {
    if (event.threadId) params.onThreadId(event.threadId);
  };

  chat.on('token', onToken);
  chat.on('final', onFinal);
  chat.on('tool-result', onToolResult);
  chat.on('error', onError);
  chat.on('complete', onComplete);
  chat.on('thread', onThread);

  const inflightSignal = getInflight(params.flowConversationId)?.abortController
    .signal;
  const cleanupInflightFn = params.cleanupInflightFn ?? cleanupInflight;
  const consumePendingFlowStop = () => {
    if (!params.runToken) return false;
    const boundPending = bindPendingConversationCancelToInflight({
      conversationId: params.flowConversationId,
      runToken: params.runToken,
      inflightId: params.inflightId,
    });
    if (!boundPending.ok) {
      return boundPending.reason !== 'PENDING_CANCEL_NOT_FOUND';
    }

    const aborted = abortInflight({
      conversationId: params.flowConversationId,
      inflightId: params.inflightId,
    });
    if (!aborted.ok) return false;

    cleanupPendingConversationCancel({
      conversationId: params.flowConversationId,
      runToken: params.runToken,
      inflightId: params.inflightId,
    });
    return true;
  };

  try {
    const pendingStopConsumed = consumePendingFlowStop();
    if (pendingStopConsumed) {
      status = 'stopped';
      lastErrorMessage = 'aborted';
    } else {
      await chat.run(
        params.instruction,
        {
          provider: params.providerId,
          endpointId: params.endpointId ?? undefined,
          inflightId: params.inflightId,
          threadId: params.threadId,
          useConfigDefaults: true,
          runtimeConfig: params.runtimeConfig,
          ...(params.workingDirectoryOverride !== undefined
            ? { workingDirectoryOverride: params.workingDirectoryOverride }
            : {}),
          ...(params.envOverrides ? { envOverrides: params.envOverrides } : {}),
          disableSystemContext: true,
          systemPrompt: params.systemPrompt,
          deferInflightCleanup: true,
          signal: inflightSignal,
          source: params.source,
          skipPersistence: true,
        },
        params.agentConversationId,
        params.modelId,
      );
    }
  } catch (err) {
    const errorMessage =
      err && typeof err === 'object'
        ? (err as { message?: string }).message
        : undefined;
    lastErrorMessage = lastErrorMessage ?? errorMessage;
    if (status === 'ok') {
      status = deriveStatusFromError(errorMessage);
    }
  } finally {
    chat.off('token', onToken);
    chat.off('final', onFinal);
    chat.off('tool-result', onToolResult);
    chat.off('error', onError);
    chat.off('complete', onComplete);
    chat.off('thread', onThread);
    bridge.cleanup();
  }

  if (inflightSignal?.aborted && status !== 'stopped') {
    const previousStatus = status;
    status = 'stopped';
    if (sawComplete) {
      logFlowInstructionStatusReclassified({
        flowConversationId: params.flowConversationId,
        agentConversationId: params.agentConversationId,
        inflightId: params.inflightId,
        fromStatus: previousStatus,
        toStatus: status,
      });
    }
  }
  if (status === 'ok' && !sawComplete && lastErrorMessage) {
    status = deriveStatusFromError(lastErrorMessage);
  }
  if (status === 'ok' && params.runToken) {
    const pendingStopAfterStep = consumePendingConversationCancel({
      conversationId: params.flowConversationId,
      runToken: params.runToken,
      inflightId: params.inflightId,
    });
    if (pendingStopAfterStep) {
      status = 'stopped';
      finalContent = '';
      tokenBuffer.length = 0;
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'runFlowInstruction.postStepPendingStopConsumed',
        conversationId: params.flowConversationId,
        detail: `inflightId=${params.inflightId}`,
      });
    }
  }

  let content = finalContent || tokenBuffer.join('');
  if (!content.trim().length && status !== 'ok') {
    content =
      lastErrorMessage?.trim() ||
      (status === 'stopped' ? 'Stopped' : 'Request failed');
  }

  const toolCalls =
    toolResults.size > 0
      ? {
          calls: Array.from(toolResults.values()),
        }
      : null;

  const result: FlowInstructionResult = {
    status,
    content,
    toolCalls,
    usage: latestUsage,
    timing: latestTiming,
  };

  const postProcessed = params.postProcess?.(result);
  if (postProcessed?.status) result.status = postProcessed.status;
  if (postProcessed?.content) result.content = postProcessed.content;

  const resultDecision = params.onResult?.(result, {
    attempt: params.attempt ?? 1,
  }) ?? { persist: true, finalize: true };

  if (resultDecision.persist) {
    const userCreatedAt = new Date(createdAtIso);
    const userPersisted = await persistFlowTurn({
      conversationId: params.flowConversationId,
      role: 'user',
      content: params.instruction,
      model: params.modelId,
      provider: params.providerId,
      source: params.source,
      status: 'ok',
      toolCalls: null,
      command: params.command,
      runtime: params.runtime,
      createdAt: userCreatedAt,
    });

    const assistantCreatedAt = new Date();
    const assistantPersisted = await persistFlowTurn({
      conversationId: params.flowConversationId,
      role: 'assistant',
      content: result.content,
      model: params.modelId,
      provider: params.providerId,
      source: params.source,
      status: result.status,
      toolCalls,
      command: params.command,
      runtime: params.runtime,
      usage: result.usage,
      timing: result.timing,
      createdAt: assistantCreatedAt,
    });
    logFlowTurnStatusPersisted({
      flowConversationId: params.flowConversationId,
      agentConversationId: params.agentConversationId,
      inflightId: params.inflightId,
      turnId: assistantPersisted.turnId,
      threadId: params.threadId,
      status: result.status,
      stepIndex: params.command?.stepIndex,
      scope: 'flow_assistant',
      targetConversationId: params.flowConversationId,
    });

    const agentUserPersisted = await persistFlowTurn({
      conversationId: params.agentConversationId,
      role: 'user',
      content: params.instruction,
      model: params.modelId,
      provider: params.providerId,
      source: params.source,
      status: 'ok',
      toolCalls: null,
      command: params.command,
      runtime: params.runtime,
      createdAt: userCreatedAt,
    });
    logAgentTurnPersisted({
      flowConversationId: params.flowConversationId,
      agentConversationId: params.agentConversationId,
      agentType: params.agentType,
      identifier: params.identifier,
      role: 'user',
      turnId: agentUserPersisted.turnId,
    });

    const agentAssistantPersisted = await persistFlowTurn({
      conversationId: params.agentConversationId,
      role: 'assistant',
      content: result.content,
      model: params.modelId,
      provider: params.providerId,
      source: params.source,
      status: result.status,
      toolCalls,
      command: params.command,
      runtime: params.runtime,
      usage: result.usage,
      timing: result.timing,
      createdAt: assistantCreatedAt,
    });
    logFlowTurnStatusPersisted({
      flowConversationId: params.flowConversationId,
      agentConversationId: params.agentConversationId,
      inflightId: params.inflightId,
      turnId: agentAssistantPersisted.turnId,
      threadId: params.threadId,
      status: result.status,
      stepIndex: params.command?.stepIndex,
      scope: 'agent_assistant',
      targetConversationId: params.agentConversationId,
    });
    logAgentTurnPersisted({
      flowConversationId: params.flowConversationId,
      agentConversationId: params.agentConversationId,
      agentType: params.agentType,
      identifier: params.identifier,
      role: 'assistant',
      turnId: agentAssistantPersisted.turnId,
    });

    markInflightPersisted({
      conversationId: params.flowConversationId,
      inflightId: params.inflightId,
      role: 'user',
      turnId: userPersisted.turnId,
    });
    markInflightPersisted({
      conversationId: params.flowConversationId,
      inflightId: params.inflightId,
      role: 'assistant',
      turnId: assistantPersisted.turnId,
    });
  }

  if (params.deferFinal && resultDecision.finalize) {
    bridge.finalize({
      override: postProcessed?.finalOverride,
      fallback: {
        status: result.status,
        threadId: params.threadId,
      },
    });
    params.onStopUnwindCheckpoint?.({
      checkpoint: 'runFlowInstruction.afterBridgeFinalize',
      conversationId: params.flowConversationId,
      detail: `status=${result.status}`,
    });
  }

  try {
    cleanupInflightFn({
      conversationId: params.flowConversationId,
      inflightId: params.inflightId,
    });
    params.onStopUnwindCheckpoint?.({
      checkpoint: 'runFlowInstruction.afterCleanupInflight',
      conversationId: params.flowConversationId,
      detail: `inflightId=${params.inflightId}`,
    });
  } catch (cleanupError) {
    baseLogger.error(
      {
        flowConversationId: params.flowConversationId,
        inflightId: params.inflightId,
        cleanupError,
      },
      'flows instruction cleanup failed; falling back to direct runtime cleanup',
    );
    cleanupInflight({
      conversationId: params.flowConversationId,
      inflightId: params.inflightId,
    });
  } finally {
    // Preserve a stop request that arrives after an `ok` step finishes so the
    // next loop boundary can still observe it. This cleanup path should only
    // clear pending cancellation when the current instruction actually stopped
    // or failed and is now unwinding the run.
    const shouldClearPendingCancel = result.status !== 'ok';
    const pendingCancelCleared = shouldClearPendingCancel
      ? cleanupPendingConversationCancel({
          conversationId: params.flowConversationId,
          runToken: params.runToken,
          inflightId: params.inflightId,
        })
      : false;
    params.onStopUnwindCheckpoint?.({
      checkpoint: 'runFlowInstruction.afterCleanupPendingConversationCancel',
      conversationId: params.flowConversationId,
      detail: `cleared=${String(pendingCancelCleared)} shouldClear=${String(shouldClearPendingCancel)}`,
    });
  }

  params.onStopUnwindCheckpoint?.({
    checkpoint: 'runFlowInstruction.returnResult',
    conversationId: params.flowConversationId,
    detail: `status=${result.status}`,
  });
  return result;
};

const createNoopChat = () =>
  new (class extends ChatInterface {
    async execute() {
      return undefined;
    }
  })();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getFlowConversationTerminalStatus = async (params: {
  conversationId: string;
  runToken: string;
}): Promise<TurnStatus | null> => {
  const activeOwnership = getActiveRunOwnership(params.conversationId);
  if (activeOwnership?.runToken === params.runToken) {
    return null;
  }

  if (activeOwnership && activeOwnership.runToken !== params.runToken) {
    throw toFlowRunError(
      'INVALID_REQUEST',
      `Subflow conversation ${params.conversationId} is now owned by a different run.`,
    );
  }

  if (shouldUseMemoryPersistence()) {
    const turns = memoryTurns.get(params.conversationId) ?? [];
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn?.role === 'assistant') {
        return turn.status;
      }
    }
    return null;
  }

  const persistedTurns = await listTurns({
    conversationId: params.conversationId,
    limit: 10,
  });
  const assistantTurn = persistedTurns.items.find(
    (turn) => turn.role === 'assistant',
  );
  return assistantTurn?.status ?? null;
};

const persistUnexpectedFlowFailureIfNeeded = async (params: {
  conversationId: string;
  modelId: string;
  providerId?: ConversationProvider;
  source: 'REST' | 'MCP';
  message: string;
}) => {
  const latestAssistantTurn = shouldUseMemoryPersistence()
    ? (() => {
        const turns = memoryTurns.get(params.conversationId) ?? [];
        for (let index = turns.length - 1; index >= 0; index -= 1) {
          const turn = turns[index];
          if (turn?.role === 'assistant') {
            return turn;
          }
        }
        return null;
      })()
    : (
        await listTurns({
          conversationId: params.conversationId,
          limit: 10,
        })
      ).items.find((turn) => turn.role === 'assistant');

  if (
    latestAssistantTurn &&
    (latestAssistantTurn.status === 'failed' ||
      latestAssistantTurn.status === 'stopped')
  ) {
    return;
  }

  await persistFlowTurn({
    conversationId: params.conversationId,
    role: 'assistant',
    content: params.message,
    model: params.modelId,
    provider: params.providerId ?? 'codex',
    source: params.source,
    status: 'failed',
    toolCalls: null,
    createdAt: new Date(),
  });
};

const emitFailedFlowStep = async (params: {
  flowConversationId: string;
  inflightId: string;
  instruction: string;
  modelId: string;
  providerId?: ConversationProvider;
  source: 'REST' | 'MCP';
  message: string;
  errorCode?: string;
  command?: TurnCommandMetadata;
}) => {
  const createdAtIso = new Date().toISOString();
  const providerId = params.providerId ?? 'codex';
  createInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: providerId,
    model: params.modelId,
    source: params.source,
    command: params.command,
    userTurn: { content: params.instruction, createdAt: createdAtIso },
  });

  publishUserTurn({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    content: params.instruction,
    createdAt: createdAtIso,
  });

  const bridge = attachChatStreamBridge({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: providerId,
    model: params.modelId,
    chat: createNoopChat(),
    deferFinal: true,
  });

  const userCreatedAt = new Date(createdAtIso);
  const userPersisted = await persistFlowTurn({
    conversationId: params.flowConversationId,
    role: 'user',
    content: params.instruction,
    model: params.modelId,
    provider: providerId,
    source: params.source,
    status: 'ok',
    toolCalls: null,
    command: params.command,
    createdAt: userCreatedAt,
  });

  const assistantCreatedAt = new Date();
  const assistantPersisted = await persistFlowTurn({
    conversationId: params.flowConversationId,
    role: 'assistant',
    content: params.message,
    model: params.modelId,
    provider: providerId,
    source: params.source,
    status: 'failed',
    toolCalls: null,
    command: params.command,
    createdAt: assistantCreatedAt,
  });

  markInflightPersisted({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    role: 'user',
    turnId: userPersisted.turnId,
  });
  markInflightPersisted({
    conversationId: params.flowConversationId,
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
  bridge.cleanup();

  cleanupInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
  });
};

const emitStoppedFlowStep = async (params: {
  flowConversationId: string;
  inflightId: string;
  instruction: string;
  modelId: string;
  providerId?: ConversationProvider;
  source: 'REST' | 'MCP';
  command?: TurnCommandMetadata;
}) => {
  const createdAtIso = new Date().toISOString();
  const providerId = params.providerId ?? 'codex';
  createInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: providerId,
    model: params.modelId,
    source: params.source,
    command: params.command,
    userTurn: { content: params.instruction, createdAt: createdAtIso },
  });

  publishUserTurn({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    content: params.instruction,
    createdAt: createdAtIso,
  });

  const bridge = attachChatStreamBridge({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: providerId,
    model: params.modelId,
    chat: createNoopChat(),
    deferFinal: true,
  });

  const userCreatedAt = new Date(createdAtIso);
  const userPersisted = await persistFlowTurn({
    conversationId: params.flowConversationId,
    role: 'user',
    content: params.instruction,
    model: params.modelId,
    provider: providerId,
    source: params.source,
    status: 'ok',
    toolCalls: null,
    command: params.command,
    createdAt: userCreatedAt,
  });

  const assistantCreatedAt = new Date();
  const assistantPersisted = await persistFlowTurn({
    conversationId: params.flowConversationId,
    role: 'assistant',
    content: 'Stopped',
    model: params.modelId,
    provider: providerId,
    source: params.source,
    status: 'stopped',
    toolCalls: null,
    command: params.command,
    createdAt: assistantCreatedAt,
  });

  markInflightPersisted({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    role: 'user',
    turnId: userPersisted.turnId,
  });
  markInflightPersisted({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    role: 'assistant',
    turnId: assistantPersisted.turnId,
  });

  bridge.finalize({
    fallback: {
      status: 'stopped',
    },
  });
  baseLogger.info(
    {
      flowConversationId: params.flowConversationId,
      inflightId: params.inflightId,
      stoppedStateBeforeCleanup: snapshotFlowRuntimeCleanupState(
        params.flowConversationId,
      ),
    },
    'flows stopped final emitted before cleanup',
  );
  bridge.cleanup();

  cleanupInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
  });
};

const emitCompletedFlowStep = async (params: {
  flowConversationId: string;
  inflightId: string;
  instruction: string;
  response: string;
  modelId: string;
  providerId?: ConversationProvider;
  source: 'REST' | 'MCP';
  command?: TurnCommandMetadata;
}) => {
  const createdAtIso = new Date().toISOString();
  const providerId = params.providerId ?? 'codex';
  createInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: providerId,
    model: params.modelId,
    source: params.source,
    command: params.command,
    userTurn: { content: params.instruction, createdAt: createdAtIso },
  });

  publishUserTurn({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    content: params.instruction,
    createdAt: createdAtIso,
  });

  const bridge = attachChatStreamBridge({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: providerId,
    model: params.modelId,
    chat: createNoopChat(),
    deferFinal: true,
  });

  setAssistantText({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    text: params.response,
  });
  publishInflightSnapshot(params.flowConversationId);

  const userCreatedAt = new Date(createdAtIso);
  const userPersisted = await persistFlowTurn({
    conversationId: params.flowConversationId,
    role: 'user',
    content: params.instruction,
    model: params.modelId,
    provider: providerId,
    source: params.source,
    status: 'ok',
    toolCalls: null,
    command: params.command,
    createdAt: userCreatedAt,
  });

  const assistantCreatedAt = new Date();
  const assistantPersisted = await persistFlowTurn({
    conversationId: params.flowConversationId,
    role: 'assistant',
    content: params.response,
    model: params.modelId,
    provider: providerId,
    source: params.source,
    status: 'ok',
    toolCalls: null,
    command: params.command,
    createdAt: assistantCreatedAt,
  });

  markInflightPersisted({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    role: 'user',
    turnId: userPersisted.turnId,
  });
  markInflightPersisted({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    role: 'assistant',
    turnId: assistantPersisted.turnId,
  });

  bridge.finalize({
    fallback: {
      status: 'ok',
    },
  });
  bridge.cleanup();

  cleanupInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
  });
};

type FlowStepOutcome = TurnStatus | 'break' | 'continue';

type LoopFrame = {
  loopStepPath: number[];
  iteration: number;
};

const buildFlowResumeState = (params: {
  executionId: string;
  runtimeState: FlowExecutionRuntimeState;
  stepPath: number[];
  loopStack: LoopFrame[];
  pendingLoopControl?: FlowPendingLoopControl | null;
  activeSubflows?: FlowResumeState['activeSubflows'];
  codexReviewModelId?: string;
  workingFolder?: string;
}): FlowResumeState => {
  const agentConversations: Record<string, string> = {};
  const agentWorkingFolders: Record<string, string> = {};
  const agentThreads: Record<string, string> = {};
  const agentProviders: Record<string, string> = {};
  const agentModels: Record<string, string> = {};
  const agentRequestedProviders: Record<string, string> = {};
  const agentEndpointIds: Record<string, string> = {};
  params.runtimeState.forEach((state, key) => {
    agentConversations[key] = state.conversationId;
    if (state.workingFolder) {
      agentWorkingFolders[key] = state.workingFolder;
    }
    if (state.threadId) {
      agentThreads[key] = state.threadId;
    }
    if (state.providerId) {
      agentProviders[key] = state.providerId;
    }
    if (state.modelId) {
      agentModels[key] = state.modelId;
    }
    if (state.requestedProviderId) {
      agentRequestedProviders[key] = state.requestedProviderId;
    }
    if (state.endpointId) {
      agentEndpointIds[key] = state.endpointId;
    }
  });

  return {
    executionId: params.executionId,
    stepPath: [...params.stepPath],
    loopStack: params.loopStack.map((frame) => ({
      loopStepPath: [...frame.loopStepPath],
      iteration: frame.iteration,
    })),
    ...(params.pendingLoopControl
      ? {
          pendingLoopControl: {
            kind: params.pendingLoopControl.kind,
            loopStepPath: [...params.pendingLoopControl.loopStepPath],
          },
        }
      : {}),
    ...(params.activeSubflows && params.activeSubflows.length > 0
      ? {
          activeSubflows: params.activeSubflows.map((activeSubflow) => ({
            stepPath: [...activeSubflow.stepPath],
            flowName: activeSubflow.flowName,
            conversationId: activeSubflow.conversationId,
            runToken: activeSubflow.runToken,
            ...(activeSubflow.title ? { title: activeSubflow.title } : {}),
          })),
        }
      : {}),
    ...(params.codexReviewModelId
      ? { codexReviewModelId: params.codexReviewModelId }
      : {}),
    ...(params.workingFolder ? { workingFolder: params.workingFolder } : {}),
    agentConversations,
    ...(Object.keys(agentWorkingFolders).length > 0
      ? { agentWorkingFolders }
      : {}),
    agentThreads,
    ...(Object.keys(agentProviders).length > 0 ? { agentProviders } : {}),
    ...(Object.keys(agentModels).length > 0 ? { agentModels } : {}),
    ...(Object.keys(agentRequestedProviders).length > 0
      ? { agentRequestedProviders }
      : {}),
    ...(Object.keys(agentEndpointIds).length > 0 ? { agentEndpointIds } : {}),
  };
};

const persistFlowResumeState = async (params: {
  conversationId: string;
  executionId: string;
  runtimeState: FlowExecutionRuntimeState;
  stepPath: number[];
  loopStack: LoopFrame[];
  pendingLoopControl?: FlowPendingLoopControl | null;
  activeSubflows?: FlowResumeState['activeSubflows'];
  codexReviewModelId?: string;
  workingFolder?: string;
}) => {
  const flowState = buildFlowResumeState({
    executionId: params.executionId,
    runtimeState: params.runtimeState,
    stepPath: params.stepPath,
    loopStack: params.loopStack,
    pendingLoopControl: params.pendingLoopControl,
    activeSubflows: params.activeSubflows,
    codexReviewModelId: params.codexReviewModelId,
    workingFolder: params.workingFolder,
  });
  const existingConversation = await getConversation(params.conversationId);
  const existingFlowState = parseFlowResumeState(
    isRecord(existingConversation?.flags?.flow)
      ? (existingConversation.flags.flow as Record<string, unknown>)
      : undefined,
  );
  if (existingFlowState?.retryOwnershipCompletion) {
    flowState.retryOwnershipCompletion =
      existingFlowState.retryOwnershipCompletion;
  }

  if (shouldUseMemoryPersistence()) {
    const existing = memoryConversations.get(params.conversationId);
    if (existing) {
      updateMemoryConversationMeta(params.conversationId, {
        flags: {
          ...(existing.flags ?? {}),
          flow: flowState,
        },
      });
    }
  } else {
    await updateConversationFlowState({
      conversationId: params.conversationId,
      flow: flowState,
    });
  }

  append({
    level: 'info',
    message: 'flows.resume.state_saved',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      conversationId: params.conversationId,
      stepPath: params.stepPath,
    },
  });
};

type BreakParseStrategy = 'strict' | 'fenced_json' | 'balanced_object';
type BreakParseReasonCode =
  | 'ANSWER_FOUND'
  | 'INVALID_JSON'
  | 'NOT_JSON_OBJECT'
  | 'INVALID_SCHEMA'
  | 'NO_VALID_CANDIDATE';

type BreakParseAttempt = {
  strategy: BreakParseStrategy;
  candidateCount: number;
};

type BreakParseSuccess = {
  ok: true;
  answer: 'yes' | 'no';
  normalizedContent: string;
  attempts: BreakParseAttempt[];
  reasonCode: BreakParseReasonCode;
};

type BreakParseFailure = {
  ok: false;
  message: string;
  attempts: BreakParseAttempt[];
  reasonCode: BreakParseReasonCode;
};

type FlowDecisionKind = 'break' | 'continue';

const MAX_BREAK_PARSE_SCAN_LENGTH = 20_000;
const MAX_BREAK_PARSE_CANDIDATES = 100;

const getFlowDecisionLabel = (kind: FlowDecisionKind) =>
  kind === 'break' ? 'Break' : 'Continue';

const validateFlowDecisionPayload = (
  kind: FlowDecisionKind,
  parsed: unknown,
): { ok: true; answer: 'yes' | 'no' } | { ok: false; reason: string } => {
  const responseLabel = getFlowDecisionLabel(kind);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: `${responseLabel} response must be a JSON object with {"answer":"yes"|"no"}.`,
    };
  }

  const payload = parsed as Record<string, unknown>;
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'answer') {
    return {
      ok: false,
      reason: `${responseLabel} response must be exactly {"answer":"yes"} or {"answer":"no"}.`,
    };
  }

  const answer = payload.answer;
  if (answer !== 'yes' && answer !== 'no') {
    return {
      ok: false,
      reason: `${responseLabel} response must include answer "yes" or "no".`,
    };
  }

  return { ok: true, answer };
};

const tryParseFlowDecisionCandidate = (
  kind: FlowDecisionKind,
  candidate: string,
):
  | { ok: true; answer: 'yes' | 'no' }
  | { ok: false; errorKind: 'json' | 'schema'; message: string } => {
  const responseLabel = getFlowDecisionLabel(kind);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return {
      ok: false,
      errorKind: 'json',
      message: `${responseLabel} response must be valid JSON with {"answer":"yes"|"no"}.`,
    };
  }

  const validated = validateFlowDecisionPayload(kind, parsed);
  if (!validated.ok) {
    return { ok: false, errorKind: 'schema', message: validated.reason };
  }

  return { ok: true, answer: validated.answer };
};

const extractFencedJsonCandidates = (content: string): string[] => {
  const candidates: string[] = [];
  const regex = /```\s*json\b[^\n]*\n?([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = regex.exec(content);
  while (match && candidates.length < MAX_BREAK_PARSE_CANDIDATES) {
    const candidate = match[1]?.trim();
    if (candidate?.startsWith('{') && candidate.endsWith('}')) {
      candidates.push(candidate);
    }
    match = regex.exec(content);
  }
  return candidates;
};

const extractBalancedObjectCandidates = (content: string): string[] => {
  const candidates: string[] = [];
  const text = content.slice(0, MAX_BREAK_PARSE_SCAN_LENGTH);
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1).trim();
        if (candidate.length > 1) {
          candidates.push(candidate);
          if (candidates.length >= MAX_BREAK_PARSE_CANDIDATES) break;
        }
        start = -1;
      }
    }
  }

  return candidates;
};

export const parseFlowDecisionAnswer = (
  kind: FlowDecisionKind,
  content: string,
): BreakParseSuccess | BreakParseFailure => {
  const responseLabel = getFlowDecisionLabel(kind);
  const attempts: BreakParseAttempt[] = [];
  let lastSchemaMessage = `${responseLabel} response must include answer "yes" or "no".`;

  attempts.push({ strategy: 'strict', candidateCount: 1 });
  const strict = tryParseFlowDecisionCandidate(kind, content);
  if (strict.ok) {
    return {
      ok: true,
      answer: strict.answer,
      normalizedContent: JSON.stringify({ answer: strict.answer }),
      attempts,
      reasonCode: 'ANSWER_FOUND',
    };
  }
  if (strict.errorKind === 'schema') {
    lastSchemaMessage = strict.message;
  }

  const fencedCandidates = extractFencedJsonCandidates(content);
  attempts.push({
    strategy: 'fenced_json',
    candidateCount: fencedCandidates.length,
  });
  for (const candidate of fencedCandidates) {
    const parsed = tryParseFlowDecisionCandidate(kind, candidate);
    if (parsed.ok) {
      return {
        ok: true,
        answer: parsed.answer,
        normalizedContent: JSON.stringify({ answer: parsed.answer }),
        attempts,
        reasonCode: 'ANSWER_FOUND',
      };
    }
    if (parsed.errorKind === 'schema') {
      lastSchemaMessage = parsed.message;
    }
  }

  const balancedCandidates = extractBalancedObjectCandidates(content);
  attempts.push({
    strategy: 'balanced_object',
    candidateCount: balancedCandidates.length,
  });
  for (const candidate of balancedCandidates) {
    const parsed = tryParseFlowDecisionCandidate(kind, candidate);
    if (parsed.ok) {
      return {
        ok: true,
        answer: parsed.answer,
        normalizedContent: JSON.stringify({ answer: parsed.answer }),
        attempts,
        reasonCode: 'ANSWER_FOUND',
      };
    }
    if (parsed.errorKind === 'schema') {
      lastSchemaMessage = parsed.message;
    }
  }

  const sawCandidates =
    fencedCandidates.length > 0 || balancedCandidates.length > 0;
  return {
    ok: false,
    message: sawCandidates
      ? lastSchemaMessage
      : `${responseLabel} response must be valid JSON with {"answer":"yes"|"no"}.`,
    attempts,
    reasonCode: sawCandidates ? 'INVALID_SCHEMA' : 'NO_VALID_CANDIDATE',
  };
};

export const parseBreakAnswer = (content: string) =>
  parseFlowDecisionAnswer('break', content);

export const parseContinueAnswer = (content: string) =>
  parseFlowDecisionAnswer('continue', content);

const findFirstAgentStep = (
  steps: FlowStep[],
):
  | FlowLlmStep
  | FlowBreakStep
  | FlowContinueStep
  | FlowCommandStep
  | undefined => {
  for (const step of steps) {
    if (
      step.type === 'llm' ||
      step.type === 'break' ||
      step.type === 'continue' ||
      step.type === 'command'
    ) {
      return step;
    }
    if (step.type === 'startLoop') {
      const nested = findFirstAgentStep(step.steps);
      if (nested) return nested;
    }
  }
  return undefined;
};

const findFirstCodexReviewStep = (
  steps: FlowStep[],
): FlowCodexReviewStep | undefined => {
  for (const step of steps) {
    if (step.type === 'codexReview') {
      return step;
    }
    if (step.type === 'startLoop') {
      const nested = findFirstCodexReviewStep(step.steps);
      if (nested) return nested;
    }
  }
  return undefined;
};

const findRuntimeIdentityStep = (
  steps: FlowStep[],
  resumeStepPath?: number[] | null,
):
  | FlowLlmStep
  | FlowBreakStep
  | FlowContinueStep
  | FlowCommandStep
  | undefined => {
  let resumePathRemaining =
    resumeStepPath && resumeStepPath.length > 0 ? [...resumeStepPath] : null;
  let resumeIndex = resumePathRemaining?.[0];

  for (const [index, step] of steps.entries()) {
    if (
      resumePathRemaining &&
      resumeIndex !== undefined &&
      index < resumeIndex
    ) {
      continue;
    }

    if (resumePathRemaining && resumeIndex === index) {
      if (resumePathRemaining.length === 1) {
        resumePathRemaining = null;
        resumeIndex = undefined;
        continue;
      }
      if (step.type !== 'startLoop') {
        return undefined;
      }
      const nested = findRuntimeIdentityStep(
        step.steps,
        resumePathRemaining.slice(1),
      );
      if (nested) {
        return nested;
      }
      resumePathRemaining = null;
      resumeIndex = undefined;
      continue;
    }

    if (
      step.type === 'llm' ||
      step.type === 'break' ||
      step.type === 'continue' ||
      step.type === 'command'
    ) {
      return step;
    }
    if (step.type === 'startLoop') {
      const nested = findRuntimeIdentityStep(step.steps, null);
      if (nested) return nested;
    }
  }

  return undefined;
};

const findRuntimeCodexReviewStep = (
  steps: FlowStep[],
  resumeStepPath?: number[] | null,
): FlowCodexReviewStep | undefined => {
  let resumePathRemaining =
    resumeStepPath && resumeStepPath.length > 0 ? [...resumeStepPath] : null;
  let resumeIndex = resumePathRemaining?.[0];

  for (const [index, step] of steps.entries()) {
    if (
      resumePathRemaining &&
      resumeIndex !== undefined &&
      index < resumeIndex
    ) {
      continue;
    }

    if (resumePathRemaining && resumeIndex === index) {
      if (resumePathRemaining.length === 1) {
        resumePathRemaining = null;
        resumeIndex = undefined;
        continue;
      }
      if (step.type !== 'startLoop') {
        return undefined;
      }
      const nested = findRuntimeCodexReviewStep(
        step.steps,
        resumePathRemaining.slice(1),
      );
      if (nested) {
        return nested;
      }
      resumePathRemaining = null;
      resumeIndex = undefined;
      continue;
    }

    if (step.type === 'codexReview') {
      return step;
    }
    if (step.type === 'startLoop') {
      const nested = findRuntimeCodexReviewStep(step.steps, null);
      if (nested) return nested;
    }
  }

  return undefined;
};

const validateCommandSteps = async (params: {
  flowName: string;
  steps: FlowStep[];
  flowsRoot: string;
  sourceId?: string;
  agentByName: Map<string, { home: string }>;
  repositoryContext: FlowCommandRepositoryContext;
  resumeStepPath?: number[] | null;
  visited?: Set<string>;
}): Promise<void> => {
  const visited = params.visited ?? new Set<string>();
  visited.add(params.flowName);
  let resumePathRemaining =
    params.resumeStepPath && params.resumeStepPath.length > 0
      ? [...params.resumeStepPath]
      : null;
  let resumeIndex = resumePathRemaining?.[0];

  for (const [index, step] of params.steps.entries()) {
    if (
      resumePathRemaining &&
      resumeIndex !== undefined &&
      index < resumeIndex
    ) {
      continue;
    }

    if (resumePathRemaining && resumeIndex === index) {
      if (resumePathRemaining.length === 1) {
        resumePathRemaining = null;
        resumeIndex = undefined;
        continue;
      }
      if (step.type !== 'startLoop') {
        throw toFlowRunError(
          'INVALID_REQUEST',
          'resumeStepPath must reference loop steps for nested indices',
        );
      }
      await validateCommandSteps({
        flowName: params.flowName,
        steps: step.steps,
        flowsRoot: params.flowsRoot,
        sourceId: params.sourceId,
        agentByName: params.agentByName,
        repositoryContext: params.repositoryContext,
        resumeStepPath: resumePathRemaining.slice(1),
        visited,
      });
      resumePathRemaining = null;
      resumeIndex = undefined;
      continue;
    }

    if (step.type === 'startLoop') {
      await validateCommandSteps({
        flowName: params.flowName,
        steps: step.steps,
        flowsRoot: params.flowsRoot,
        sourceId: params.sourceId,
        agentByName: params.agentByName,
        repositoryContext: params.repositoryContext,
        resumeStepPath: null,
        visited,
      });
      continue;
    }
    if (step.type === 'subflow') {
      continue;
    }
    if (step.type === 'command') {
      const validatedAgentType = validateRepositoryBackedAgentType(
        step.agentType,
      );
      if (!validatedAgentType.ok) {
        throw toFlowRunError(
          'INVALID_REQUEST',
          `Flow agent "${step.agentType}" ${validatedAgentType.message}.`,
        );
      }
      const agent = params.agentByName.get(step.agentType);
      if (!agent) {
        throw toFlowRunError(
          'AGENT_NOT_FOUND',
          `Agent ${step.agentType} not found`,
        );
      }
      const commandLoad = await resolveFlowCommandForAgent({
        step,
        context: params.repositoryContext,
        phase: 'validation',
      });
      if (!commandLoad.ok) {
        throw toFlowRunError('COMMAND_INVALID', commandLoad.message);
      }
    }
  }
};

const validateCodexReviewSteps = async (params: {
  flowName: string;
  steps: FlowStep[];
  flowsRoot: string;
  sourceId?: string;
  codexReviewModelId?: string;
  resumeStepPath?: number[] | null;
  visited?: Set<string>;
}): Promise<void> => {
  const visited = params.visited ?? new Set<string>();
  visited.add(params.flowName);
  let resumePathRemaining =
    params.resumeStepPath && params.resumeStepPath.length > 0
      ? [...params.resumeStepPath]
      : null;
  let resumeIndex = resumePathRemaining?.[0];

  for (const [index, step] of params.steps.entries()) {
    if (
      resumePathRemaining &&
      resumeIndex !== undefined &&
      index < resumeIndex
    ) {
      continue;
    }

    if (resumePathRemaining && resumeIndex === index) {
      if (resumePathRemaining.length === 1) {
        resumePathRemaining = null;
        resumeIndex = undefined;
        continue;
      }
      if (step.type !== 'startLoop') {
        throw toFlowRunError(
          'INVALID_REQUEST',
          'resumeStepPath must reference loop steps for nested indices',
        );
      }
      await validateCodexReviewSteps({
        flowName: params.flowName,
        steps: step.steps,
        flowsRoot: params.flowsRoot,
        sourceId: params.sourceId,
        codexReviewModelId: params.codexReviewModelId,
        resumeStepPath: resumePathRemaining.slice(1),
        visited,
      });
      resumePathRemaining = null;
      resumeIndex = undefined;
      continue;
    }

    if (step.type === 'startLoop') {
      await validateCodexReviewSteps({
        flowName: params.flowName,
        steps: step.steps,
        flowsRoot: params.flowsRoot,
        sourceId: params.sourceId,
        codexReviewModelId: params.codexReviewModelId,
        visited,
      });
      continue;
    }
    if (step.type === 'subflow') {
      continue;
    }
    if (step.type !== 'codexReview') {
      continue;
    }
  }
};

const validateResumeStepPath = (
  steps: FlowStep[],
  resumeStepPath: number[],
): void => {
  let currentSteps = steps;
  for (let index = 0; index < resumeStepPath.length; index += 1) {
    const stepIndex = resumeStepPath[index];
    if (!Number.isInteger(stepIndex) || stepIndex < 0) {
      throw toFlowRunError(
        'INVALID_REQUEST',
        'resumeStepPath must contain non-negative integers',
      );
    }

    const step = currentSteps[stepIndex];
    if (!step) {
      throw toFlowRunError('INVALID_REQUEST', 'resumeStepPath out of range');
    }

    if (index < resumeStepPath.length - 1) {
      if (step.type !== 'startLoop') {
        throw toFlowRunError(
          'INVALID_REQUEST',
          'resumeStepPath must reference loop steps for nested indices',
        );
      }
      currentSteps = step.steps;
    }
  }
};

const validateResumeAgentConversations = async (
  resumeState: FlowResumeState | null,
): Promise<string[]> => {
  if (!resumeState) return [];
  const childExecutionBackfills: string[] = [];
  const entries = Object.entries(resumeState.agentConversations);
  for (const [key, conversationId] of entries) {
    const agentType = key.split(':')[0] ?? '';
    const validation =
      await flowResumeTestDeps.ensureFlowChildConversationOwnership({
        conversationId,
        agentType,
        executionId: resumeState.executionId,
      });
    if (validation.needsExecutionIdBackfill) {
      childExecutionBackfills.push(conversationId);
    }
  }
  return childExecutionBackfills;
};

type LoadCommandResult =
  | {
      ok: true;
      commandName: string;
      command: AgentCommandFile;
      sourceId: string;
      sourceLabel: string;
      sourceRank: RepositoryCandidateOrderSlot;
      lookupSummary: RepositoryCandidateLookupSummary;
    }
  | {
      ok: false;
      message: string;
      reason: 'NOT_FOUND' | 'INVALID' | 'READ_FAILED' | 'INVALID_NAME';
    };

type FlowCommandRepositoryContext = {
  flowName: string;
  workingRepositoryPath?: string;
  defaultRepositoryRoot?: string;
  flowSourceId?: string;
  flowSourceLabel?: string;
  codeInfo2Root: string;
  listIngestedRepositories: () => Promise<{
    repos: RepoEntry[];
    lockedModelId: string | null;
  }>;
  repos: Array<{ sourceId: string; sourceLabel: string }>;
};

const resolveFlowGitBackedRepositoryPath = (
  context: FlowCommandRepositoryContext,
) => context.workingRepositoryPath ?? context.flowSourceId;

type FlowCommandCandidate = {
  sourceId: string;
  sourceLabel: string;
  slot: RepositoryCandidateOrderSlot;
  agentHome: string;
};

const buildFlowCommandCandidates = (params: {
  context: FlowCommandRepositoryContext;
  agentType: string;
}): Promise<{
  orderedCandidates: RepositoryCandidateOrderResult;
  candidates: FlowCommandCandidate[];
}> => {
  const validatedAgentType = validateRepositoryBackedAgentType(
    params.agentType,
  );
  if (!validatedAgentType.ok) {
    return Promise.reject(
      new Error(
        `Flow agent "${params.agentType}" ${validatedAgentType.message}.`,
      ),
    );
  }
  const ownerRepositoryPath = params.context.flowSourceId?.trim()
    ? params.context.flowSourceId
    : params.context.codeInfo2Root;
  const ownerRepositoryLabel = params.context.flowSourceId?.trim()
    ? params.context.flowSourceLabel
    : normalizeSourceLabel({ sourceId: params.context.codeInfo2Root });

  const orderedCandidates = buildRepositoryCandidateOrder({
    caller: 'flow-command',
    workingRepositoryPath: params.context.workingRepositoryPath,
    ownerRepositoryPath,
    ownerRepositoryLabel,
    codeInfo2Root: params.context.codeInfo2Root,
    otherRepositoryRoots: params.context.repos,
  });

  return Promise.resolve(orderedCandidates.candidates).then(
    async (candidates) => ({
      orderedCandidates,
      candidates: await Promise.all(
        candidates.map(async (candidate) => {
          const resolvedAgentHome = await resolveAgentHomeForRepository({
            repositoryRoot: candidate.sourceId,
            agentName: validatedAgentType.agentType,
          });
          return {
            sourceId: candidate.sourceId,
            sourceLabel: candidate.sourceLabel,
            slot: candidate.slot,
            agentHome:
              resolvedAgentHome.home ??
              path.join(
                candidate.sourceId,
                'codeinfo_agents',
                validatedAgentType.agentType,
              ),
          } satisfies FlowCommandCandidate;
        }),
      ),
    }),
  );
};

const appendFlowCommandResolutionLog = (params: {
  level: 'info' | 'warn';
  phase: 'validation' | 'execution';
  flowName: string;
  commandName: string;
  agentType: string;
  flowSourceId?: string;
  decision: 'selected' | 'fail_fast' | 'not_found';
  orderedCandidates: RepositoryCandidateOrderResult;
  selectedCandidate?: FlowCommandCandidate;
  failureReason?: string;
  failureMessage?: string;
}) => {
  append({
    level: params.level,
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
    level: params.level,
    message: DEV_0000040_T11_FLOW_RESOLUTION_ORDER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      phase: params.phase,
      flowName: params.flowName,
      commandName: params.commandName,
      agentType: params.agentType,
      flowSourceId: params.flowSourceId ?? null,
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

const loadCommandForAgent = async (params: {
  agentHome: string;
  commandName: string;
}): Promise<LoadCommandResult> => {
  const rawName = params.commandName;
  if (!isSafeCommandName(rawName)) {
    return {
      ok: false,
      reason: 'INVALID_NAME',
      message: 'commandName must be a valid file name',
    };
  }

  const commandName = rawName.trim();
  const commandsDir = path.join(params.agentHome, 'commands');
  const filePath = path.join(commandsDir, `${commandName}.json`);
  const commandStat = await fs.stat(filePath).catch((error) => {
    if ((error as { code?: string }).code === 'ENOENT') return null;
    return error;
  });
  if (commandStat instanceof Error) {
    return {
      ok: false,
      reason: 'READ_FAILED',
      message: `Command ${commandName} read failed`,
    };
  }
  if (!commandStat?.isFile()) {
    return {
      ok: false,
      reason: 'NOT_FOUND',
      message: `Command ${commandName} not found for agent`,
    };
  }

  const parsed = await loadAgentCommandFile({ filePath }).catch(() => null);
  if (!parsed) {
    return {
      ok: false,
      reason: 'READ_FAILED',
      message: `Command ${commandName} read failed`,
    };
  }
  if (!parsed.ok) {
    return {
      ok: false,
      reason: 'INVALID',
      message: `Command ${commandName} failed schema validation`,
    };
  }

  return {
    ok: true,
    commandName,
    command: parsed.command,
    sourceId: params.agentHome,
    sourceLabel: path.posix.basename(params.agentHome.replace(/\\/g, '/')),
    sourceRank: 'other_repository',
    lookupSummary: {
      selectedRepositoryPath: params.agentHome,
      fallbackUsed: false,
      workingRepositoryAvailable: false,
    },
  };
};

const resolveFlowCommandForAgent = async (params: {
  step: FlowCommandStep;
  context: FlowCommandRepositoryContext;
  phase: 'validation' | 'execution';
}): Promise<LoadCommandResult> => {
  const validatedAgentType = validateRepositoryBackedAgentType(
    params.step.agentType,
  );
  if (!validatedAgentType.ok) {
    return {
      ok: false,
      reason: 'INVALID_NAME',
      message: `Flow agent "${params.step.agentType}" ${validatedAgentType.message}.`,
    };
  }

  const { orderedCandidates, candidates } = await buildFlowCommandCandidates({
    context: params.context,
    agentType: validatedAgentType.agentType,
  });

  for (const candidate of candidates) {
    const loaded = await loadCommandForAgent({
      agentHome: candidate.agentHome,
      commandName: params.step.commandName,
    });
    if (loaded.ok) {
      const lookupSummary = buildRepositoryCandidateLookupSummary({
        orderedCandidates,
        selectedRepositoryPath: candidate.sourceId,
      });
      appendFlowCommandResolutionLog({
        level: 'info',
        phase: params.phase,
        flowName: params.context.flowName,
        commandName: params.step.commandName,
        agentType: params.step.agentType,
        flowSourceId: params.context.flowSourceId,
        decision: 'selected',
        orderedCandidates,
        selectedCandidate: candidate,
      });
      return {
        ...loaded,
        sourceId: candidate.sourceId,
        sourceLabel: candidate.sourceLabel,
        sourceRank: candidate.slot,
        lookupSummary,
      };
    }
    if (loaded.reason !== 'NOT_FOUND') {
      appendFlowCommandResolutionLog({
        level: 'warn',
        phase: params.phase,
        flowName: params.context.flowName,
        commandName: params.step.commandName,
        agentType: params.step.agentType,
        flowSourceId: params.context.flowSourceId,
        decision: 'fail_fast',
        orderedCandidates,
        selectedCandidate: candidate,
        failureReason: loaded.reason,
        failureMessage: loaded.message,
      });
      return loaded;
    }
  }

  appendFlowCommandResolutionLog({
    level: 'warn',
    phase: params.phase,
    flowName: params.context.flowName,
    commandName: params.step.commandName,
    agentType: params.step.agentType,
    flowSourceId: params.context.flowSourceId,
    decision: 'not_found',
    orderedCandidates,
  });

  return {
    ok: false,
    reason: 'NOT_FOUND',
    message: `Command ${params.step.commandName.trim()} not found for agent`,
  };
};

async function runFlowUnlocked(params: {
  flowName: string;
  flow: FlowFile;
  flowPath: string[];
  repositoryContext: FlowCommandRepositoryContext;
  conversationId: string;
  executionId: string;
  inflightId: string;
  modelId: string;
  providerId: ConversationProvider;
  workingDirectoryOverride?: string;
  codexReviewModelId?: string;
  source: 'REST' | 'MCP';
  chatFactory?: FlowChatFactory;
  resumeState?: FlowResumeState | null;
  resumeStepPath?: number[];
  customTitle?: string;
  runToken: string;
  onStopUnwindCheckpoint?: (params: {
    checkpoint: string;
    conversationId: string;
    detail?: string;
  }) => void | Promise<void>;
  cleanupInflightFn?: typeof cleanupInflight;
  releaseConversationLockFn?: typeof releaseConversationLock;
}) {
  const discovered = await discoverAgents();
  const agentByName = new Map(discovered.map((agent) => [agent.name, agent]));
  const runtimeState = hydrateFlowAgentState(params.resumeState ?? null);

  const loopStack: LoopFrame[] = [];
  const maxStepAttempts = getFlowAndCommandRetries();
  let stepInflightId = params.inflightId;
  let finalizedFlowRuntime = false;
  const resumeStepPath = params.resumeStepPath ?? null;
  let lastCompletedStepPath =
    resumeStepPath ?? params.resumeState?.stepPath ?? [];
  let pendingLoopControl = params.resumeState?.pendingLoopControl
    ? {
        kind: params.resumeState.pendingLoopControl.kind,
        loopStepPath: [...params.resumeState.pendingLoopControl.loopStepPath],
      }
    : null;
  let activeSubflows = params.resumeState?.activeSubflows?.map(
    (activeSubflow) => ({
      stepPath: [...activeSubflow.stepPath],
      flowName: activeSubflow.flowName,
      conversationId: activeSubflow.conversationId,
      runToken: activeSubflow.runToken,
      ...(activeSubflow.title ? { title: activeSubflow.title } : {}),
    }),
  );
  let continueBoundaryLoopKey: string | null = null;
  const resumeLoopIterations = new Map<string, number>();
  if (params.resumeState) {
    params.resumeState.loopStack.forEach((frame) => {
      resumeLoopIterations.set(
        getStepPathKey(frame.loopStepPath),
        frame.iteration,
      );
    });
  }
  const cleanupInflightFn = params.cleanupInflightFn ?? cleanupInflight;
  const releaseConversationLockFn =
    params.releaseConversationLockFn ?? releaseConversationLock;
  const flowEnvOverrides: NodeJS.ProcessEnv = {
    CODEINFO_ROOT: params.repositoryContext.codeInfo2Root,
  };
  const persistRuntimeResumeState = async (stepPath: number[]) =>
    persistFlowResumeState({
      conversationId: params.conversationId,
      executionId: params.executionId,
      runtimeState,
      stepPath,
      loopStack,
      pendingLoopControl,
      activeSubflows,
      codexReviewModelId: params.codexReviewModelId,
      workingFolder: params.repositoryContext.workingRepositoryPath,
    });
  const clearContinueBoundaryForActiveLoop = () => {
    if (!continueBoundaryLoopKey) return;
    const activeLoopFrame = loopStack[loopStack.length - 1];
    if (!activeLoopFrame) return;
    if (
      getStepPathKey(activeLoopFrame.loopStepPath) !== continueBoundaryLoopKey
    ) {
      return;
    }
    pendingLoopControl = null;
    continueBoundaryLoopKey = null;
  };

  const finalizeFlowRuntime = () => {
    if (finalizedFlowRuntime) return;
    finalizedFlowRuntime = true;
    params.onStopUnwindCheckpoint?.({
      checkpoint: 'runFlowUnlocked.finalize.enter',
      conversationId: params.conversationId,
    });

    const inflightState = getInflight(params.conversationId);
    const activeInflight =
      inflightState && inflightState.inflightId === stepInflightId
        ? inflightState
        : undefined;
    baseLogger.info(
      {
        flowName: params.flowName,
        conversationId: params.conversationId,
        stepInflightId,
        runToken: params.runToken,
        cleanupStartState: snapshotFlowRuntimeCleanupState(
          params.conversationId,
        ),
      },
      'flows runtime cleanup starting',
    );

    try {
      if (activeInflight) {
        cleanupInflightFn({
          conversationId: params.conversationId,
          inflightId: stepInflightId,
        });
        baseLogger.info(
          {
            flowName: params.flowName,
            conversationId: params.conversationId,
            stepInflightId,
            runToken: params.runToken,
            stateAfterCleanupInflight: snapshotFlowRuntimeCleanupState(
              params.conversationId,
            ),
          },
          'flows runtime cleanupInflight completed',
        );
      } else {
        baseLogger.info(
          {
            flowName: params.flowName,
            conversationId: params.conversationId,
            stepInflightId,
            runToken: params.runToken,
            inflightStateSeen: inflightState?.inflightId ?? null,
          },
          'flows runtime cleanupInflight skipped because active inflight did not match',
        );
      }
    } catch (cleanupError) {
      baseLogger.error(
        {
          flowName: params.flowName,
          conversationId: params.conversationId,
          inflightId: stepInflightId,
          cleanupError,
        },
        'flows runtime cleanup failed; falling back to direct runtime cleanup',
      );
      cleanupInflight({
        conversationId: params.conversationId,
        inflightId: stepInflightId,
      });
    } finally {
      const pendingCancelCleared = cleanupPendingConversationCancel({
        conversationId: params.conversationId,
        runToken: params.runToken,
        inflightId: stepInflightId,
      });
      const lockReleased = releaseConversationLockFn(
        params.conversationId,
        params.runToken,
      );
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'runFlowUnlocked.finalize.exit',
        conversationId: params.conversationId,
        detail: `pendingCancelCleared=${String(pendingCancelCleared)} lockReleased=${String(lockReleased)}`,
      });
      baseLogger.info(
        {
          flowName: params.flowName,
          conversationId: params.conversationId,
          stepInflightId,
          runToken: params.runToken,
          pendingCancelCleared,
          lockReleased,
          cleanupEndState: snapshotFlowRuntimeCleanupState(
            params.conversationId,
          ),
        },
        'flows runtime cleanup finished',
      );
    }
  };

  const resolveFlowInstructionPrerequisites = async (params: {
    agentType: string;
    identifier: string;
    configPath?: string;
    workingFolder?: string;
    defaultRepositoryRoot?: string;
    source: 'REST' | 'MCP';
  }): Promise<{
    providerId: ConversationProvider;
    modelId: string;
    requestedProviderId?: string;
    endpointId?: string | null;
    runtimeConfig: CodexOptions['config'];
    workingDirectoryOverride?: string;
  }> => {
    const agent = agentByName.get(params.agentType);
    if (!agent) {
      throw toFlowRunError(
        'AGENT_NOT_FOUND',
        `Agent ${params.agentType} not found`,
      );
    }

    const agentState = runtimeState.get(
      getAgentKey(params.agentType, params.identifier),
    );
    if (agentState?.conversationId) {
      const persistedConversation = await getConversation(
        agentState.conversationId,
      );
      if (persistedConversation?.agentName === params.agentType) {
        const savedEndpointId =
          typeof persistedConversation.flags?.endpointId === 'string' &&
          persistedConversation.flags.endpointId.trim().length > 0
            ? persistedConversation.flags.endpointId.trim()
            : undefined;
        if (!agentState.providerId || !agentState.modelId) {
          agentState.providerId = persistedConversation.provider;
          agentState.modelId = persistedConversation.model;
          agentState.requestedProviderId = getSavedRequestedProviderId(
            persistedConversation,
          );
        }
        if (savedEndpointId) {
          agentState.endpointId = savedEndpointId;
        }
      }
    }
    const providerBootstrapReady =
      agentState?.providerId !== undefined
        ? getProviderBootstrapStatus(
            agentState.providerId as ConversationProvider,
          ).healthy
        : true;

    return resolveFlowAgentRuntimeExecution({
      agentName: params.agentType,
      configPath: params.configPath ?? agent.configPath,
      workingFolder: params.workingFolder,
      defaultRepositoryRoot: params.defaultRepositoryRoot,
      source: params.source,
      pinnedProviderId: agentState?.providerId as
        | ConversationProvider
        | undefined,
      pinnedModelId: agentState?.modelId,
      pinnedRequestedProviderId: agentState?.requestedProviderId,
      pinnedEndpointId: providerBootstrapReady
        ? agentState?.endpointId
        : undefined,
      allowFallback: !agentState?.providerId,
    });
  };

  const runInstruction = async (instructionParams: {
    agentType: string;
    identifier: string;
    instruction: string;
    deferFinal?: boolean;
    postProcess?: FlowInstructionPostProcess;
    command?: TurnCommandMetadata;
    runtime?: TurnRuntimeMetadata;
  }): Promise<FlowInstructionResult> => {
    const agent = agentByName.get(instructionParams.agentType);
    if (!agent) {
      throw toFlowRunError(
        'AGENT_NOT_FOUND',
        `Agent ${instructionParams.agentType} not found`,
      );
    }

    const runtime = await resolveFlowInstructionPrerequisites({
      agentType: instructionParams.agentType,
      identifier: instructionParams.identifier,
      configPath: agent.configPath,
      workingFolder: params.repositoryContext.workingRepositoryPath,
      defaultRepositoryRoot: params.repositoryContext.defaultRepositoryRoot,
      source: params.source,
    });
    const modelId = runtime.modelId;

    const { state: agentState, isNew } = await ensureAgentState({
      runtimeState,
      agentType: instructionParams.agentType,
      identifier: instructionParams.identifier,
      executionId: params.executionId,
      flowName: params.flowName,
      providerId: runtime.providerId,
      modelId,
      requestedProviderId: runtime.requestedProviderId,
      endpointId: runtime.endpointId ?? null,
      workingFolder: params.repositoryContext.workingRepositoryPath,
      customTitle: params.customTitle,
      source: params.source,
    });
    if (isNew) {
      await persistRuntimeResumeState(lastCompletedStepPath);
    }

    let systemPrompt: string | undefined;
    if (!agentState.threadId && agent.systemPromptPath) {
      try {
        systemPrompt = await fs.readFile(agent.systemPromptPath, 'utf8');
      } catch {
        systemPrompt = undefined;
      }
    }

    let previousError: unknown = null;
    let sanitizedErrorLength = 0;

    for (let attempt = 1; attempt <= maxStepAttempts; attempt += 1) {
      const retryInstruction =
        attempt > 1
          ? formatRetryInstruction({
              originalInstruction: instructionParams.instruction,
              previousError,
            })
          : null;
      if (retryInstruction) {
        sanitizedErrorLength = retryInstruction.sanitizedErrorLength;
      }

      let shouldRetry = false;
      const result = await runFlowInstruction({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction:
          retryInstruction?.instruction ?? instructionParams.instruction,
        agentType: instructionParams.agentType,
        identifier: instructionParams.identifier,
        agentConversationId: agentState.conversationId,
        providerId: runtime.providerId,
        modelId,
        endpointId: agentState.endpointId ?? runtime.endpointId ?? null,
        runtimeConfig: runtime.runtimeConfig,
        threadId: agentState.threadId,
        systemPrompt,
        workingDirectoryOverride:
          runtime.workingDirectoryOverride ?? params.workingDirectoryOverride,
        envOverrides: flowEnvOverrides,
        source: params.source,
        chatFactory: params.chatFactory,
        deferFinal: true,
        postProcess: instructionParams.postProcess,
        command: instructionParams.command,
        runtime: instructionParams.runtime,
        attempt,
        runToken: params.runToken,
        onStopUnwindCheckpoint: params.onStopUnwindCheckpoint,
        cleanupInflightFn,
        onResult: (candidate) => {
          if (
            candidate.status === 'failed' &&
            deriveStatusFromError(candidate.content) === 'stopped'
          ) {
            candidate.status = 'stopped';
          }
          shouldRetry =
            candidate.status === 'failed' && attempt < maxStepAttempts;
          return {
            persist: !shouldRetry,
            finalize: !shouldRetry,
          };
        },
        onThreadId: (threadId) => {
          agentState.threadId = threadId;
          void persistAgentThreadId({
            conversationId: agentState.conversationId,
            threadId,
          });
          void persistRuntimeResumeState(lastCompletedStepPath);
        },
      });

      if (shouldRetry) {
        previousError = result.content;
        const reason = result.content;
        append({
          level: 'warn',
          message: 'DEV-0000036:T5:step_retry_attempt',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            surface: 'flow',
            attempt,
            maxAttempts: maxStepAttempts,
            reason,
            retryPromptInjected: attempt >= 1,
            sanitizedErrorLength,
          },
        });
        baseLogger.warn(
          {
            surface: 'flow',
            attempt,
            maxAttempts: maxStepAttempts,
            reason,
            retryPromptInjected: attempt >= 1,
            sanitizedErrorLength,
          },
          'DEV-0000036:T5:step_retry_attempt',
        );
        stepInflightId = crypto.randomUUID();
        continue;
      }

      if (result.status === 'failed' && attempt >= maxStepAttempts) {
        append({
          level: 'error',
          message: 'DEV-0000036:T5:step_retry_exhausted',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            surface: 'flow',
            attempt,
            maxAttempts: maxStepAttempts,
            reason: result.content,
            retryPromptInjected: attempt > 1,
            sanitizedErrorLength,
            terminalStatus: result.status,
          },
        });
        baseLogger.error(
          {
            surface: 'flow',
            attempt,
            maxAttempts: maxStepAttempts,
            reason: result.content,
            retryPromptInjected: attempt > 1,
            sanitizedErrorLength,
            terminalStatus: result.status,
          },
          'DEV-0000036:T5:step_retry_exhausted',
        );
      }

      if (!shouldStopAfter(result.status)) {
        stepInflightId = crypto.randomUUID();
      } else {
        params.onStopUnwindCheckpoint?.({
          checkpoint: 'runInstruction.return.stop',
          conversationId: params.conversationId,
          detail: `status=${result.status} step=${instructionParams.command?.stepIndex ?? 'none'}`,
        });
      }
      return result;
    }

    throw toFlowRunError('INVALID_REQUEST', 'Flow retry loop exhausted');
  };

  const runLlmStep = async (
    step: FlowLlmStep,
    command: TurnCommandMetadata,
  ): Promise<TurnStatus> => {
    if ('messages' in step) {
      for (const message of step.messages) {
        const instruction = joinMessageContent(message.content);
        let result: FlowInstructionResult;
        try {
          result = await runInstruction({
            agentType: step.agentType,
            identifier: step.identifier,
            instruction,
            command,
          });
        } catch (error) {
          const agent = agentByName.get(step.agentType);
          const agentKey = getAgentKey(step.agentType, step.identifier);
          const message = isFlowRunError(error)
            ? (error.reason ?? error.code)
            : error instanceof Error
              ? error.message
              : 'Failed to execute flow llm step';
          const errorCode = isFlowRunError(error)
            ? error.code
            : 'INVALID_REQUEST';
          await emitFailedFlowStep({
            flowConversationId: params.conversationId,
            inflightId: stepInflightId,
            instruction,
            modelId: agent
              ? await getFailureModelId({
                  agentName: step.agentType,
                  configPath: agent.configPath,
                  workingFolder: params.repositoryContext.workingRepositoryPath,
                  defaultRepositoryRoot:
                    params.repositoryContext.defaultRepositoryRoot,
                  source: params.source,
                })
              : FALLBACK_MODEL_ID,
            providerId: (runtimeState.get(agentKey)?.providerId ??
              'codex') as ConversationProvider,
            source: params.source,
            message,
            errorCode,
            command,
          });
          return 'failed';
        }
        if (shouldStopAfter(result.status)) return result.status;
      }
      return 'ok';
    }

    let preparedMarkdownInstruction;
    try {
      await resolveFlowInstructionPrerequisites({
        agentType: step.agentType,
        identifier: step.identifier,
        defaultRepositoryRoot: params.repositoryContext.defaultRepositoryRoot,
        source: params.source,
      });
      preparedMarkdownInstruction = await prepareMarkdownInstruction({
        markdownFile: step.markdownFile,
        workingRepositoryPath: params.repositoryContext.workingRepositoryPath,
        flowSourceId: params.repositoryContext.flowSourceId,
        surface: 'flow',
        flowName: params.flowName,
        stepIndex: command.stepIndex,
      });
    } catch (error) {
      const agent = agentByName.get(step.agentType);
      const message = isFlowRunError(error)
        ? (error.reason ?? error.code)
        : error instanceof Error
          ? error.message
          : 'Failed to resolve flow llm markdownFile';
      const errorCode = isFlowRunError(error) ? error.code : 'INVALID_REQUEST';
      await emitFailedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction: `Markdown file: ${step.markdownFile}`,
        modelId: agent
          ? await getFailureModelId({
              agentName: step.agentType,
              configPath: agent.configPath,
              workingFolder: params.repositoryContext.workingRepositoryPath,
              defaultRepositoryRoot:
                params.repositoryContext.defaultRepositoryRoot,
              source: params.source,
            })
          : FALLBACK_MODEL_ID,
        source: params.source,
        message,
        errorCode,
        command,
      });
      return 'failed';
    }

    if (preparedMarkdownInstruction.kind === 'skip') {
      return 'ok';
    }

    append({
      level: 'info',
      message: 'DEV-0000045:T5:flow_llm_markdown_loaded',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        flowName: params.flowName,
        stepIndex: command.stepIndex,
        markdownFile: step.markdownFile,
        resolvedSourceId: preparedMarkdownInstruction.resolvedSourceId,
        instructionLength: preparedMarkdownInstruction.instruction.length,
      },
    });

    const result = await runInstruction({
      agentType: step.agentType,
      identifier: step.identifier,
      instruction: preparedMarkdownInstruction.instruction,
      command,
      runtime: {
        ...(params.repositoryContext.workingRepositoryPath
          ? { workingFolder: params.repositoryContext.workingRepositoryPath }
          : {}),
        lookupSummary: preparedMarkdownInstruction.lookupSummary,
      },
    });
    return result.status;
  };

  const runBreakStep = async (
    step: FlowBreakStep,
    command: TurnCommandMetadata,
  ): Promise<{
    status: TurnStatus;
    shouldBreak: boolean;
  }> => {
    let breakAnswer: 'yes' | 'no' | undefined;
    const instruction = [
      'Answer with JSON only: {"answer":"yes"} or {"answer":"no"}.',
      `Question: ${step.question}`,
    ].join('\n');

    const result = await runInstruction({
      agentType: step.agentType,
      identifier: step.identifier,
      instruction,
      deferFinal: true,
      command,
      postProcess: (candidate) => {
        const parsed = parseBreakAnswer(candidate.content);
        parsed.attempts.forEach((attempt) => {
          append({
            level: 'info',
            message: 'DEV-0000036:T4:break_parse_strategy_attempted',
            timestamp: new Date().toISOString(),
            source: 'server',
            context: {
              strategy: attempt.strategy,
              candidateCount: attempt.candidateCount,
            },
          });
        });
        append({
          level: parsed.ok ? 'info' : 'warn',
          message: 'DEV-0000036:T4:break_parse_result',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            accepted: parsed.ok,
            reasonCode: parsed.reasonCode,
          },
        });

        if (!parsed.ok) {
          return {
            status: 'failed',
            content: parsed.message,
            finalOverride: {
              status: 'failed',
              error: {
                code: 'INVALID_BREAK_RESPONSE',
                message: parsed.message,
              },
            },
          };
        }

        breakAnswer = parsed.answer;
        return {
          content: parsed.normalizedContent,
        };
      },
    });

    if (shouldStopAfter(result.status)) {
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'runBreakStep.return.stop',
        conversationId: params.conversationId,
        detail: `status=${result.status} step=${command.stepIndex}`,
      });
      return { status: result.status, shouldBreak: false };
    }

    if (!breakAnswer) {
      return { status: 'failed', shouldBreak: false };
    }

    append({
      level: 'info',
      message: 'flows.run.break_decision',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        flowName: params.flowName,
        answer: breakAnswer,
        breakOn: step.breakOn,
        loopDepth: loopStack.length,
      },
    });

    return {
      status: 'ok',
      shouldBreak: breakAnswer === step.breakOn,
    };
  };

  const runContinueStep = async (
    step: FlowContinueStep,
    command: TurnCommandMetadata,
  ): Promise<{
    status: TurnStatus;
    shouldContinue: boolean;
  }> => {
    let continueAnswer: 'yes' | 'no' | undefined;
    const instruction = [
      'Answer with JSON only: {"answer":"yes"} or {"answer":"no"}.',
      `Question: ${step.question}`,
    ].join('\n');

    const result = await runInstruction({
      agentType: step.agentType,
      identifier: step.identifier,
      instruction,
      deferFinal: true,
      command,
      postProcess: (candidate) => {
        const parsed = parseContinueAnswer(candidate.content);
        parsed.attempts.forEach((attempt) => {
          append({
            level: 'info',
            message: 'DEV-0000036:T4:continue_parse_strategy_attempted',
            timestamp: new Date().toISOString(),
            source: 'server',
            context: {
              strategy: attempt.strategy,
              candidateCount: attempt.candidateCount,
            },
          });
        });
        append({
          level: parsed.ok ? 'info' : 'warn',
          message: 'DEV-0000036:T4:continue_parse_result',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            accepted: parsed.ok,
            reasonCode: parsed.reasonCode,
          },
        });

        if (!parsed.ok) {
          return {
            status: 'failed',
            content: parsed.message,
            finalOverride: {
              status: 'failed',
              error: {
                code: 'INVALID_CONTINUE_RESPONSE',
                message: parsed.message,
              },
            },
          };
        }

        continueAnswer = parsed.answer;
        return {
          content: parsed.normalizedContent,
        };
      },
    });

    if (shouldStopAfter(result.status)) {
      return { status: result.status, shouldContinue: false };
    }

    if (!continueAnswer) {
      return { status: 'failed', shouldContinue: false };
    }

    append({
      level: 'info',
      message: 'flows.run.continue_decision',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        flowName: params.flowName,
        answer: continueAnswer,
        continueOn: step.continueOn,
        loopDepth: loopStack.length,
      },
    });

    return {
      status: 'ok',
      shouldContinue: continueAnswer === step.continueOn,
    };
  };

  const getActiveSubflowsForStep = (stepPath: number[]) => {
    const stepPathKey = getStepPathKey(stepPath);
    return (activeSubflows ?? []).filter(
      (activeSubflow) => getStepPathKey(activeSubflow.stepPath) === stepPathKey,
    );
  };

  const setActiveSubflowsForStep = (
    stepPath: number[],
    nextSubflows: FlowActiveSubflow[],
  ) => {
    const stepPathKey = getStepPathKey(stepPath);
    const retainedSubflows = (activeSubflows ?? []).filter(
      (activeSubflow) => getStepPathKey(activeSubflow.stepPath) !== stepPathKey,
    );
    const mergedSubflows = [...retainedSubflows, ...nextSubflows];
    activeSubflows = mergedSubflows.length > 0 ? mergedSubflows : undefined;
  };

  const requestActiveSubflowStop = (params: {
    conversationId: string;
    runToken?: string;
  }) => {
    const childRunToken =
      params.runToken ?? getActiveRunOwnership(params.conversationId)?.runToken;
    if (!childRunToken) return false;

    registerPendingConversationCancel({
      conversationId: params.conversationId,
      runToken: childRunToken,
    });
    const aborted = abortInflightByConversation(params.conversationId);
    return aborted.ok || aborted.reason === 'INFLIGHT_NOT_FOUND';
  };

  const runSubflowStep = async (
    step: FlowSubflowStep,
    command: TurnCommandMetadata,
    nextPath: number[],
  ): Promise<TurnStatus> => {
    const childFlowNames = [...step.flowNames];
    const launchesMultipleChildren = childFlowNames.length > 1;
    const instruction = launchesMultipleChildren
      ? `Run subflows ${childFlowNames.join(', ')}`
      : `Run subflow ${childFlowNames[0]}`;
    const parentTurnCreatedAtIso = new Date().toISOString();
    const parentTurnCreatedAt = new Date(parentTurnCreatedAtIso);
    const parentConversation = await getConversation(params.conversationId);
    const rememberedSubflowsByName = new Map(
      getActiveSubflowsForStep(nextPath)
        .filter((activeSubflow) =>
          childFlowNames.includes(activeSubflow.flowName),
        )
        .map((activeSubflow) => [activeSubflow.flowName, activeSubflow]),
    );
    const childRuns = childFlowNames
      .map((flowName) => rememberedSubflowsByName.get(flowName))
      .filter((activeSubflow): activeSubflow is FlowActiveSubflow =>
        Boolean(activeSubflow),
      );
    const buildTrackedSubflowTitle = (flowName: string) =>
      rememberedSubflowsByName.get(flowName)?.title ??
      buildSubflowConversationTitle({
        parentFlowName: params.flowName,
        parentPersistedTitle: parentConversation?.title,
        parentCustomTitle: params.customTitle,
        stepLabel: step.label,
        childFlowName: flowName,
        multipleChildren: launchesMultipleChildren,
      });
    const buildSubflowSummaryText = (prefix: string) =>
      launchesMultipleChildren
        ? `${prefix} ${childFlowNames
            .map((flowName) => buildTrackedSubflowTitle(flowName))
            .join(', ')}`
        : `${prefix} ${buildTrackedSubflowTitle(childFlowNames[0] ?? '')}`;
    const runningText = buildSubflowSummaryText(
      launchesMultipleChildren ? 'Running subflows' : 'Running subflow',
    );
    const childOutcomes = new Map<
      string,
      {
        title: string;
        status: 'ok' | 'failed' | 'stopped';
        reason?: string;
      }
    >();
    const recordChildOutcome = (params: {
      flowName: string;
      status: 'ok' | 'failed' | 'stopped';
      reason?: string;
    }) => {
      childOutcomes.set(params.flowName, {
        title: buildTrackedSubflowTitle(params.flowName),
        status: params.status,
        ...(params.reason ? { reason: params.reason } : {}),
      });
    };
    const buildBestEffortSummary = () => {
      const outcomes = childFlowNames.map(
        (flowName) =>
          childOutcomes.get(flowName) ?? {
            title: buildTrackedSubflowTitle(flowName),
            status: 'failed' as const,
          },
      );
      const successCount = outcomes.filter(
        (entry) => entry.status === 'ok',
      ).length;
      const failedCount = outcomes.filter(
        (entry) => entry.status === 'failed',
      ).length;
      const stoppedCount = outcomes.filter(
        (entry) => entry.status === 'stopped',
      ).length;
      const parts = [`${successCount} succeeded`];
      if (failedCount > 0) {
        parts.push(`${failedCount} failed`);
      }
      if (stoppedCount > 0) {
        parts.push(`${stoppedCount} stopped`);
      }
      return `${buildSubflowSummaryText(
        launchesMultipleChildren ? 'Completed subflows' : 'Completed subflow',
      )} (best effort: ${parts.join(', ')})`;
    };

    const stopSubflowBeforeLaunch = async (): Promise<boolean> => {
      const pendingCancel = getPendingConversationCancel(params.conversationId);
      if (!pendingCancel || pendingCancel.runToken !== params.runToken) {
        return false;
      }

      for (const childRun of childRuns) {
        const childStatus = await getFlowConversationTerminalStatus({
          conversationId: childRun.conversationId,
          runToken: childRun.runToken,
        });
        if (!childStatus) return false;
      }

      const consumedPendingCancel = consumePendingConversationCancel({
        conversationId: params.conversationId,
        runToken: params.runToken,
      });
      if (!consumedPendingCancel) return false;

      setActiveSubflowsForStep(nextPath, []);
      await emitStoppedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        command,
      });
      return true;
    };

    if (await stopSubflowBeforeLaunch()) {
      return 'stopped';
    }

    createInflight({
      conversationId: params.conversationId,
      inflightId: stepInflightId,
      provider: params.providerId,
      model: params.modelId,
      source: params.source,
      command,
      userTurn: { content: instruction, createdAt: parentTurnCreatedAtIso },
    });
    setAssistantText({
      conversationId: params.conversationId,
      inflightId: stepInflightId,
      text: runningText,
    });
    publishUserTurn({
      conversationId: params.conversationId,
      inflightId: stepInflightId,
      content: instruction,
      createdAt: parentTurnCreatedAtIso,
    });

    const bridge = attachChatStreamBridge({
      conversationId: params.conversationId,
      inflightId: stepInflightId,
      provider: params.providerId,
      model: params.modelId,
      chat: createNoopChat(),
      deferFinal: true,
    });

    try {
      const resumableChildRuns: FlowActiveSubflow[] = [];
      for (const childRun of childRuns) {
        const status = await getFlowConversationTerminalStatus({
          conversationId: childRun.conversationId,
          runToken: childRun.runToken,
        });
        if (status || getActiveRunOwnership(childRun.conversationId)) {
          resumableChildRuns.push(childRun);
          continue;
        }
        recordChildOutcome({
          flowName: childRun.flowName,
          status: 'failed',
          reason: `Subflow ${childRun.flowName} could not be resumed because child conversation ${childRun.conversationId} has no active run and no terminal result.`,
        });
      }
      childRuns.length = 0;
      childRuns.push(...resumableChildRuns);
      setActiveSubflowsForStep(nextPath, childRuns);

      for (const flowName of childFlowNames) {
        if (
          rememberedSubflowsByName.has(flowName) ||
          childOutcomes.has(flowName)
        ) {
          continue;
        }
        if (
          getPendingConversationCancel(params.conversationId)?.runToken ===
          params.runToken
        ) {
          break;
        }

        let childConversationId: string | undefined;
        let childRunToken: string | undefined;
        try {
          const started = await startFlowRun({
            flowName,
            sourceId: params.repositoryContext.flowSourceId,
            flowPath: params.flowPath,
            codexReviewModelId: params.codexReviewModelId,
            working_folder: params.repositoryContext.workingRepositoryPath,
            customTitle: buildTrackedSubflowTitle(flowName),
            source: params.source,
            chatFactory: params.chatFactory,
            listIngestedRepositories:
              params.repositoryContext.listIngestedRepositories,
            onOwnershipReady: ({ conversationId, runToken }) => {
              childConversationId = conversationId;
              childRunToken = runToken;
            },
          });
          childConversationId = started.conversationId;

          if (!childConversationId || !childRunToken) {
            recordChildOutcome({
              flowName,
              status: 'failed',
              reason: `Subflow ${flowName} did not start correctly.`,
            });
            continue;
          }

          const trackedSubflow = {
            stepPath: [...nextPath],
            flowName,
            conversationId: childConversationId,
            runToken: childRunToken,
            title: buildTrackedSubflowTitle(flowName),
          };
          rememberedSubflowsByName.set(flowName, trackedSubflow);
          childRuns.push(trackedSubflow);
          setActiveSubflowsForStep(nextPath, childRuns);
          await persistRuntimeResumeState(lastCompletedStepPath);
        } catch (error) {
          recordChildOutcome({
            flowName,
            status: 'failed',
            reason: isFlowRunError(error)
              ? (error.reason ?? error.code)
              : error instanceof Error
                ? error.message
                : `Subflow ${flowName} failed to start.`,
          });
        }
      }

      let terminalStatus: TurnStatus;
      let parentStopRequested = false;
      let allChildrenOkObservedAt: number | null = null;
      while (true) {
        const parentPendingCancel = consumePendingConversationCancel({
          conversationId: params.conversationId,
          runToken: params.runToken,
        });
        if (parentPendingCancel) {
          parentStopRequested = true;
          childRuns.forEach((childRun) => {
            void requestActiveSubflowStop({
              conversationId: childRun.conversationId,
              runToken: childRun.runToken,
            });
          });
        }

        const childStatuses = await Promise.all(
          childRuns.map(async (childRun) => {
            const status = await getFlowConversationTerminalStatus({
              conversationId: childRun.conversationId,
              runToken: childRun.runToken,
            });
            return {
              childRun,
              status,
            };
          }),
        );
        const staleChildren = childStatuses.filter(
          ({ childRun, status }) =>
            !status && !getActiveRunOwnership(childRun.conversationId),
        );
        if (staleChildren.length > 0) {
          const staleConversationIds = new Set<string>();
          staleChildren.forEach(({ childRun }) => {
            staleConversationIds.add(childRun.conversationId);
            recordChildOutcome({
              flowName: childRun.flowName,
              status: 'failed',
              reason: `Subflow ${childRun.flowName} could not be resumed because child conversation ${childRun.conversationId} has no active run and no terminal result.`,
            });
          });
          const remainingChildRuns = childRuns.filter(
            (childRun) => !staleConversationIds.has(childRun.conversationId),
          );
          childRuns.length = 0;
          childRuns.push(...remainingChildRuns);
          setActiveSubflowsForStep(nextPath, childRuns);
          await persistRuntimeResumeState(lastCompletedStepPath);
          allChildrenOkObservedAt = null;
          continue;
        }
        const hasIncompleteChild = childStatuses.some(({ status }) => !status);
        if (!hasIncompleteChild) {
          const lateParentPendingCancel = consumePendingConversationCancel({
            conversationId: params.conversationId,
            runToken: params.runToken,
          });
          if (lateParentPendingCancel) {
            parentStopRequested = true;
          }
          const terminalStatuses = childStatuses.map(({ status }) => status);
          const everyChildSucceeded = terminalStatuses.every(
            (status): status is 'ok' => status === 'ok',
          );
          if (everyChildSucceeded && !parentStopRequested) {
            allChildrenOkObservedAt ??= Date.now();
            if (Date.now() - allChildrenOkObservedAt < 50) {
              await sleep(25);
              continue;
            }
          }
          childStatuses.forEach(({ childRun, status }) => {
            if (!status) {
              return;
            }
            recordChildOutcome({
              flowName: childRun.flowName,
              status,
            });
          });
          terminalStatus = parentStopRequested ? 'stopped' : 'ok';
          break;
        }
        allChildrenOkObservedAt = null;

        await sleep(25);
      }

      setActiveSubflowsForStep(nextPath, []);

      const nonOkChildCount = [...childOutcomes.values()].filter(
        (entry) => entry.status !== 'ok',
      ).length;
      const finalMessage =
        terminalStatus === 'stopped'
          ? buildSubflowSummaryText(
              launchesMultipleChildren ? 'Stopped subflows' : 'Stopped subflow',
            )
          : nonOkChildCount === 0
            ? buildSubflowSummaryText(
                launchesMultipleChildren
                  ? 'Completed subflows'
                  : 'Completed subflow',
              )
            : buildBestEffortSummary();
      setAssistantText({
        conversationId: params.conversationId,
        inflightId: stepInflightId,
        text: finalMessage,
      });
      publishInflightSnapshot(params.conversationId);

      const userPersisted = await persistFlowTurn({
        conversationId: params.conversationId,
        role: 'user',
        content: instruction,
        model: params.modelId,
        provider: params.providerId,
        source: params.source,
        status: 'ok',
        toolCalls: null,
        command,
        createdAt: parentTurnCreatedAt,
      });
      const assistantPersisted = await persistFlowTurn({
        conversationId: params.conversationId,
        role: 'assistant',
        content: finalMessage,
        model: params.modelId,
        provider: params.providerId,
        source: params.source,
        status: terminalStatus,
        toolCalls: null,
        command,
        createdAt: new Date(),
      });

      markInflightPersisted({
        conversationId: params.conversationId,
        inflightId: stepInflightId,
        role: 'user',
        turnId: userPersisted.turnId,
      });
      markInflightPersisted({
        conversationId: params.conversationId,
        inflightId: stepInflightId,
        role: 'assistant',
        turnId: assistantPersisted.turnId,
      });

      bridge.finalize({
        fallback: {
          status: terminalStatus,
        },
      });
      return terminalStatus;
    } catch (error) {
      childRuns.forEach((childRun) => {
        void requestActiveSubflowStop({
          conversationId: childRun.conversationId,
          runToken: childRun.runToken,
        });
      });
      setActiveSubflowsForStep(nextPath, []);
      const message = isFlowRunError(error)
        ? (error.reason ?? error.code)
        : error instanceof Error
          ? error.message
          : launchesMultipleChildren
            ? `Failed to run subflows ${childFlowNames.join(', ')}`
            : `Failed to run subflow ${childFlowNames[0]}`;
      setAssistantText({
        conversationId: params.conversationId,
        inflightId: stepInflightId,
        text: message,
      });
      publishInflightSnapshot(params.conversationId);

      const userPersisted = await persistFlowTurn({
        conversationId: params.conversationId,
        role: 'user',
        content: instruction,
        model: params.modelId,
        provider: params.providerId,
        source: params.source,
        status: 'ok',
        toolCalls: null,
        command,
        createdAt: parentTurnCreatedAt,
      });
      const assistantPersisted = await persistFlowTurn({
        conversationId: params.conversationId,
        role: 'assistant',
        content: message,
        model: params.modelId,
        provider: params.providerId,
        source: params.source,
        status: 'failed',
        toolCalls: null,
        command,
        createdAt: new Date(),
      });
      markInflightPersisted({
        conversationId: params.conversationId,
        inflightId: stepInflightId,
        role: 'user',
        turnId: userPersisted.turnId,
      });
      markInflightPersisted({
        conversationId: params.conversationId,
        inflightId: stepInflightId,
        role: 'assistant',
        turnId: assistantPersisted.turnId,
      });
      bridge.finalize({
        fallback: {
          status: 'failed',
          error: {
            code: isFlowRunError(error) ? error.code : 'SUBFLOW_FAILED',
            message,
          },
        },
      });
      return 'failed';
    } finally {
      bridge.cleanup();
      cleanupInflight({
        conversationId: params.conversationId,
        inflightId: stepInflightId,
      });
    }
  };

  const runCommandStep = async (
    step: FlowCommandStep,
    command: TurnCommandMetadata,
  ): Promise<TurnStatus> => {
    const agent = agentByName.get(step.agentType);
    if (!agent) {
      throw toFlowRunError(
        'AGENT_NOT_FOUND',
        `Agent ${step.agentType} not found`,
      );
    }

    append({
      level: 'info',
      message: 'flows.run.command_step',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        commandName: step.commandName,
        agentType: step.agentType,
      },
    });

    let commandRuntimeIdentity:
      | Awaited<ReturnType<typeof resolveFlowInstructionPrerequisites>>
      | undefined;
    const resolveCommandRuntimeIdentity = async () => {
      commandRuntimeIdentity ??= await resolveFlowInstructionPrerequisites({
        agentType: step.agentType,
        identifier: step.identifier,
        configPath: agent.configPath,
        workingFolder: params.repositoryContext.workingRepositoryPath,
        defaultRepositoryRoot: params.repositoryContext.defaultRepositoryRoot,
        source: params.source,
      });
      return commandRuntimeIdentity;
    };

    const stopCommandBeforeHandoff = async (): Promise<boolean> => {
      const pendingCancel = consumePendingConversationCancel({
        conversationId: params.conversationId,
        runToken: params.runToken,
      });
      if (!pendingCancel) return false;

      const runtimeIdentity = await resolveCommandRuntimeIdentity();
      await emitStoppedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction: `Command: ${step.commandName}`,
        modelId: runtimeIdentity.modelId,
        providerId: runtimeIdentity.providerId,
        source: params.source,
        command,
      });
      return true;
    };

    for (let attempt = 1; attempt <= maxStepAttempts; attempt += 1) {
      if (await stopCommandBeforeHandoff()) {
        return 'stopped';
      }
      const commandLoad = await resolveFlowCommandForAgent({
        step,
        context: params.repositoryContext,
        phase: 'execution',
      });
      if (!commandLoad.ok) {
        if (attempt < maxStepAttempts) {
          append({
            level: 'warn',
            message: 'DEV-0000036:T5:step_retry_attempt',
            timestamp: new Date().toISOString(),
            source: 'server',
            context: {
              surface: 'flow',
              attempt,
              maxAttempts: maxStepAttempts,
              reason: commandLoad.message,
              retryPromptInjected: false,
              sanitizedErrorLength: 0,
            },
          });
          await new Promise((resolve) =>
            setTimeout(resolve, FLOW_STEP_BASE_DELAY_MS * 2 ** (attempt - 1)),
          );
          continue;
        }
        const runtimeIdentity = await resolveCommandRuntimeIdentity();
        await emitFailedFlowStep({
          flowConversationId: params.conversationId,
          inflightId: stepInflightId,
          instruction: `Command: ${step.commandName}`,
          modelId: runtimeIdentity.modelId,
          providerId: runtimeIdentity.providerId,
          source: params.source,
          message: commandLoad.message,
          errorCode: 'COMMAND_INVALID',
          command,
        });
        append({
          level: 'error',
          message: 'DEV-0000036:T5:step_retry_exhausted',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            surface: 'flow',
            attempt,
            maxAttempts: maxStepAttempts,
            reason: commandLoad.message,
            retryPromptInjected: false,
            sanitizedErrorLength: 0,
            terminalStatus: 'failed',
          },
        });
        return 'failed';
      }

      const commandRuntime: TurnRuntimeMetadata = {
        ...(params.repositoryContext.workingRepositoryPath
          ? { workingFolder: params.repositoryContext.workingRepositoryPath }
          : {}),
        lookupSummary: commandLoad.lookupSummary,
      };

      for (const [itemIndex, item] of commandLoad.command.items.entries()) {
        if (await stopCommandBeforeHandoff()) {
          return 'stopped';
        }
        let executedItem:
          | { itemType: 'message'; result: FlowInstructionResult }
          | { itemType: 'skip' }
          | { itemType: 'reingest'; result: ExecuteCommandItemReingestResult };
        try {
          executedItem = (await executeCommandItem({
            item,
            itemIndex,
            commandName: step.commandName,
            workingRepositoryPath:
              params.repositoryContext.workingRepositoryPath,
            sourceId: commandLoad.sourceId,
            flowSourceId: params.repositoryContext.flowSourceId,
            flowContext: {
              flowName: params.flowName,
              stepIndex: command.stepIndex,
            },
            executeInstruction: async ({ instruction, lookupSummary }) =>
              runInstruction({
                agentType: step.agentType,
                identifier: step.identifier,
                instruction,
                command,
                runtime: {
                  ...commandRuntime,
                  lookupSummary: lookupSummary ?? commandRuntime.lookupSummary,
                },
              }),
            executeReingest: async (reingestItem) => {
              const result = await executeReingestRequest({
                request: reingestItem,
                surface: 'flow_command',
                workingRepositoryPath:
                  params.repositoryContext.workingRepositoryPath,
                deps: {
                  listIngestedRepositories:
                    params.repositoryContext.listIngestedRepositories,
                  runReingestRepository: flowServiceDeps.runReingestRepository,
                  appendLog: append,
                },
              });

              if (!result.ok) {
                throw new Error(formatReingestPrestartReason(result.error));
              }

              const pendingCancelAfterWait = consumePendingConversationCancel({
                conversationId: params.conversationId,
                runToken: params.runToken,
              });

              const callId = flowServiceDeps.createCallId();
              const toolResult = flowServiceDeps.buildReingestToolResult({
                callId,
                execution: result.value,
              });
              const runtimeIdentity = await resolveCommandRuntimeIdentity();

              await flowServiceDeps.runReingestStepLifecycle({
                conversationId: params.conversationId,
                modelId: runtimeIdentity.modelId,
                source: params.source,
                command,
                toolResult,
              });
              append({
                level: 'info',
                message: 'DEV-0000052:T7:flow-reingest',
                timestamp: new Date().toISOString(),
                source: 'server',
                context: {
                  surface: 'flow',
                  flowSurface: 'flow_command',
                  flowName: params.flowName,
                  commandName: step.commandName,
                  stepIndex: command.stepIndex,
                  itemIndex,
                  targetMode: result.value.targetMode,
                },
              });

              if (result.value.kind === 'single') {
                let stopAfter = false;
                if (pendingCancelAfterWait) {
                  const runtimeIdentity = await resolveCommandRuntimeIdentity();
                  await emitStoppedFlowStep({
                    flowConversationId: params.conversationId,
                    inflightId: stepInflightId,
                    instruction: `Command: ${step.commandName}`,
                    modelId: runtimeIdentity.modelId,
                    providerId: runtimeIdentity.providerId,
                    source: params.source,
                    command,
                  });
                  stopAfter = true;
                } else {
                  stopAfter = await stopCommandBeforeHandoff();
                }
                const continuedToNextItem =
                  itemIndex < commandLoad.command.items.length - 1 &&
                  !stopAfter;
                return {
                  ...result.value,
                  callId,
                  continuedToNextItem,
                  stopAfter,
                };
              }

              let stopAfter = false;
              if (pendingCancelAfterWait) {
                const runtimeIdentity = await resolveCommandRuntimeIdentity();
                await emitStoppedFlowStep({
                  flowConversationId: params.conversationId,
                  inflightId: stepInflightId,
                  instruction: `Command: ${step.commandName}`,
                  modelId: runtimeIdentity.modelId,
                  providerId: runtimeIdentity.providerId,
                  source: params.source,
                  command,
                });
                stopAfter = true;
              } else {
                stopAfter = await stopCommandBeforeHandoff();
              }
              const continuedToNextItem =
                itemIndex < commandLoad.command.items.length - 1 && !stopAfter;
              return {
                ...result.value,
                continuedToNextItem,
                stopAfter,
              };
            },
          })) as
            | { itemType: 'message'; result: FlowInstructionResult }
            | { itemType: 'skip' }
            | {
                itemType: 'reingest';
                result: ExecuteCommandItemReingestResult;
              };
        } catch (error) {
          const runtimeIdentity = await resolveCommandRuntimeIdentity();
          await emitFailedFlowStep({
            flowConversationId: params.conversationId,
            inflightId: stepInflightId,
            instruction: `Command: ${step.commandName}`,
            modelId: runtimeIdentity.modelId,
            providerId: runtimeIdentity.providerId,
            source: params.source,
            message:
              error instanceof Error
                ? error.message
                : 'Failed to execute flow command message item',
            errorCode: 'COMMAND_INVALID',
            command,
          });
          return 'failed';
        }
        if (
          executedItem.itemType === 'message' &&
          shouldStopAfter(executedItem.result.status)
        ) {
          return executedItem.result.status;
        }
        if (executedItem.itemType === 'skip') {
          continue;
        }
        if (
          executedItem.itemType === 'reingest' &&
          executedItem.result.stopAfter
        ) {
          return 'stopped';
        }
      }
      return 'ok';
    }

    return 'failed';
  };

  const runPrepareReviewBaseStep = async (
    step: FlowPrepareReviewBaseStep,
    command: TurnCommandMetadata,
  ): Promise<TurnStatus> => {
    const reviewRepositoryPath = resolveFlowGitBackedRepositoryPath(
      params.repositoryContext,
    );
    if (!reviewRepositoryPath) {
      await emitFailedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction: `Prepare review base: ${step.outputKey}`,
        modelId: params.modelId,
        source: params.source,
        message:
          'prepareReviewBase requires a resolved working repository path.',
        errorCode: 'INVALID_REQUEST',
        command,
      });
      return 'failed';
    }

    const instruction = `Prepare review base: ${step.outputKey}`;
    const inflightState = createInflight({
      conversationId: params.conversationId,
      inflightId: stepInflightId,
      provider: params.providerId,
      model: params.modelId,
      source: params.source,
      command,
    });
    const inflightSignal = inflightState.abortController.signal;
    const consumePendingPrepareStop = () => {
      if (!params.runToken) return false;
      const boundPending = bindPendingConversationCancelToInflight({
        conversationId: params.conversationId,
        runToken: params.runToken,
        inflightId: stepInflightId,
      });
      if (!boundPending.ok) {
        return false;
      }

      const aborted = abortInflight({
        conversationId: params.conversationId,
        inflightId: stepInflightId,
      });
      if (!aborted.ok) return false;

      cleanupPendingConversationCancel({
        conversationId: params.conversationId,
        runToken: params.runToken,
        inflightId: stepInflightId,
      });
      return true;
    };
    if (consumePendingPrepareStop()) {
      await emitStoppedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        command,
      });
      return 'stopped';
    }
    try {
      const result = await prepareReviewBase({
        workingRepositoryPath: reviewRepositoryPath,
        outputKey: step.outputKey,
        basePolicy: step.basePolicy,
        parentExecutionId: params.executionId,
        initializeReviewPointers: step.initializeReviewPointers,
        signal: inflightSignal,
      });
      if (inflightSignal.aborted) {
        await emitStoppedFlowStep({
          flowConversationId: params.conversationId,
          inflightId: stepInflightId,
          instruction,
          modelId: params.modelId,
          providerId: params.providerId,
          source: params.source,
          command,
        });
        return 'stopped';
      }
      await emitCompletedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        response: [
          'Prepared shared review base.',
          `Artifact: ${path.relative(reviewRepositoryPath, result.artifactPath)}`,
          `Comparison base: ${result.artifact.comparison_base_ref}`,
        ].join('\n'),
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        command,
      });
      return 'ok';
    } catch (error) {
      if (
        inflightSignal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        await emitStoppedFlowStep({
          flowConversationId: params.conversationId,
          inflightId: stepInflightId,
          instruction,
          modelId: params.modelId,
          providerId: params.providerId,
          source: params.source,
          command,
        });
        return 'stopped';
      }
      await emitFailedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        message:
          error instanceof Error
            ? error.message
            : 'prepareReviewBase failed unexpectedly',
        errorCode: 'INVALID_REQUEST',
        command,
      });
      return 'failed';
    }
  };

  const runCodexReviewFlowStep = async (
    step: FlowCodexReviewStep,
    command: TurnCommandMetadata,
  ): Promise<TurnStatus> => {
    const reviewRepositoryPath = resolveFlowGitBackedRepositoryPath(
      params.repositoryContext,
    );
    const agentProfile = await resolveCodexReviewAgentProfile({
      step,
      agentByName,
      workingFolder: reviewRepositoryPath,
      defaultRepositoryRoot: params.repositoryContext.defaultRepositoryRoot,
      source: params.source,
    });
    const resolvedModelId = resolveCodexReviewModel({
      requestedModelId: params.codexReviewModelId,
      stepModelId: step.model,
      agentModelId: agentProfile.modelId,
    });
    const resolvedReasoningEffort = resolveCodexReviewReasoningEffort({
      stepReasoningEffort: step.reasoningEffort,
      agentReasoningEffort: agentProfile.reasoningEffort,
    });
    const codexBootstrapStatus = getProviderBootstrapStatus('codex');
    const codexStepModelId = resolvedModelId ?? step.model ?? FALLBACK_MODEL_ID;
    const clearStaleCodexReviewPointer = async () => {
      if (reviewRepositoryPath) {
        try {
          await clearCodexReviewPointerFile({
            workingRepositoryPath: reviewRepositoryPath,
            outputKey: step.outputKey,
          });
        } catch (error) {
          await emitFailedFlowStep({
            flowConversationId: params.conversationId,
            inflightId: stepInflightId,
            instruction: `Codex review: ${step.outputKey}`,
            modelId: codexStepModelId,
            providerId: 'codex',
            source: params.source,
            message: [
              'codexReview could not clear the stale stable review pointer before starting.',
              `Cleanup error: ${
                error instanceof Error
                  ? error.message
                  : 'codexReview pointer cleanup failed unexpectedly'
              }`,
            ].join('\n'),
            errorCode: 'INVALID_REQUEST',
            command,
          });
          return 'failed' as const;
        }
      }
      return 'ok' as const;
    };
    const emitSkippedCodexReviewStep = async (message: string) => {
      await emitCompletedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction: `Codex review: ${step.outputKey}`,
        response: `Codex review skipped.\nReason: ${message}`,
        modelId: codexStepModelId,
        providerId: 'codex',
        source: params.source,
        command,
      });
      return 'ok' as const;
    };
    const clearedStalePointer = await clearStaleCodexReviewPointer();
    if (clearedStalePointer !== 'ok') {
      return clearedStalePointer;
    }
    if (!resolvedModelId) {
      return emitSkippedCodexReviewStep(
        'codexReview requires codexReviewModelId, a model on the flow step, or a model from its configured agent.',
      );
    }

    if (!codexBootstrapStatus.healthy) {
      return emitSkippedCodexReviewStep(
        codexBootstrapStatus.reason ?? 'codex unavailable',
      );
    }

    if (!reviewRepositoryPath) {
      return emitSkippedCodexReviewStep(
        'codexReview requires a resolved working repository path.',
      );
    }

    const instruction = `Codex review: ${step.outputKey}`;
    const inflightState = createInflight({
      conversationId: params.conversationId,
      inflightId: stepInflightId,
      provider: 'codex',
      model: resolvedModelId,
      source: params.source,
      command,
    });
    const inflightSignal = inflightState.abortController.signal;
    const consumePendingCodexStop = () => {
      if (!params.runToken) return false;
      const boundPending = bindPendingConversationCancelToInflight({
        conversationId: params.conversationId,
        runToken: params.runToken,
        inflightId: stepInflightId,
      });
      if (!boundPending.ok) {
        return false;
      }

      const aborted = abortInflight({
        conversationId: params.conversationId,
        inflightId: stepInflightId,
      });
      if (!aborted.ok) return false;

      cleanupPendingConversationCancel({
        conversationId: params.conversationId,
        runToken: params.runToken,
        inflightId: stepInflightId,
      });
      return true;
    };
    if (consumePendingCodexStop()) {
      await emitStoppedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        modelId: resolvedModelId,
        providerId: 'codex',
        source: params.source,
        command,
      });
      return 'stopped';
    }

    try {
      const result = await runCodexReviewStep({
        workingRepositoryPath: reviewRepositoryPath,
        outputKey: step.outputKey,
        modelId: resolvedModelId,
        reasoningEffort: resolvedReasoningEffort,
        agentType: agentProfile.agentType,
        basePolicy: step.basePolicy,
        signal: inflightSignal,
      });
      if (inflightSignal.aborted) {
        await emitStoppedFlowStep({
          flowConversationId: params.conversationId,
          inflightId: stepInflightId,
          instruction,
          modelId: resolvedModelId,
          providerId: 'codex',
          source: params.source,
          command,
        });
        return 'stopped';
      }
      await emitCompletedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        response: [
          'Codex review completed.',
          `Model: ${result.modelId}`,
          ...(agentProfile.agentType
            ? [`Agent type: ${agentProfile.agentType}`]
            : []),
          ...(result.reasoningEffort
            ? [`Reasoning effort: ${result.reasoningEffort}`]
            : []),
          `Pointer: ${path.relative(reviewRepositoryPath, result.pointerPath)}`,
        ].join('\n'),
        modelId: resolvedModelId,
        providerId: 'codex',
        source: params.source,
        command,
      });
      return 'ok';
    } catch (error) {
      await clearCodexReviewPointerFile({
        workingRepositoryPath: reviewRepositoryPath,
        outputKey: step.outputKey,
      }).catch(() => undefined);
      if (
        inflightSignal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        await emitStoppedFlowStep({
          flowConversationId: params.conversationId,
          inflightId: stepInflightId,
          instruction,
          modelId: resolvedModelId,
          providerId: 'codex',
          source: params.source,
          command,
        });
        return 'stopped';
      }
      await emitCompletedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        response: `Codex review skipped.\nReason: ${
          error instanceof Error
            ? error.message
            : 'codexReview failed unexpectedly'
        }`,
        modelId: resolvedModelId,
        providerId: 'codex',
        source: params.source,
        command,
      });
      return 'ok';
    }
  };

  const runValidateReviewArtifactsStep = async (
    step: FlowValidateReviewArtifactsStep,
    command: TurnCommandMetadata,
  ): Promise<TurnStatus> => {
    const reviewRepositoryPath = resolveFlowGitBackedRepositoryPath(
      params.repositoryContext,
    );
    const instruction = 'Validate joined review artifacts';
    if (!reviewRepositoryPath) {
      await emitFailedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        message:
          'validateReviewArtifacts requires a resolved working repository path.',
        errorCode: 'INVALID_REQUEST',
        command,
      });
      return 'failed';
    }
    try {
      const result = await validateReviewArtifacts({
        workingRepositoryPath: reviewRepositoryPath,
        pointerKeys: step.pointerKeys,
      });
      await emitCompletedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        response: [
          result.status === 'passed'
            ? 'Validated all joined review artifacts.'
            : result.status === 'partial'
              ? 'Joined review validation completed with status partial; continuing with usable review evidence.'
              : 'Joined review validation completed with status blocked; continuing without usable review evidence.',
          `Review session: ${result.review_session_id}`,
          `Pointers: ${result.pointer_files.join(', ')}`,
          ...result.pointer_results.map(
            (pointer) =>
              `${pointer.pointer_key}: ${pointer.status}${pointer.errors.length > 0 ? ` (${pointer.errors.join(' | ')})` : ''}`,
          ),
        ].join('\n'),
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        command,
      });
      return 'ok';
    } catch (error) {
      await emitFailedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        message:
          error instanceof Error
            ? error.message
            : 'validateReviewArtifacts failed unexpectedly.',
        errorCode: 'INVALID_REQUEST',
        command,
      });
      return 'failed';
    }
  };

  const runReingestStep = async (
    step: FlowReingestStep,
    command: TurnCommandMetadata,
  ): Promise<TurnStatus> => {
    append({
      level: 'info',
      message: 'DEV-0000050:T01:reingest_request_shape_accepted',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: buildFlowReingestRequestLogContext({
        flowName: params.flowName,
        stepIndex: command.stepIndex,
        step,
      }),
    });

    const instruction =
      'sourceId' in step
        ? `Reingest repository: ${step.sourceId}`
        : `Reingest repository target: ${step.target}`;
    let result;
    try {
      result = await executeReingestRequest({
        request: step,
        surface: 'flow',
        workingRepositoryPath: params.repositoryContext.workingRepositoryPath,
        deps: {
          listIngestedRepositories:
            params.repositoryContext.listIngestedRepositories,
          runReingestRepository: flowServiceDeps.runReingestRepository,
          appendLog: append,
        },
      });
    } catch (error) {
      await emitFailedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        modelId: params.modelId,
        source: params.source,
        message:
          error instanceof Error
            ? error.message
            : 'Dedicated flow reingest failed unexpectedly',
        errorCode: 'INVALID_REQUEST',
        command,
      });
      return 'failed';
    }

    if (!result.ok) {
      const message = formatReingestPrestartReason(result.error);
      await emitFailedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        modelId: params.modelId,
        source: params.source,
        message,
        errorCode: 'INVALID_REQUEST',
        command,
      });
      return 'failed';
    }

    const callId = flowServiceDeps.createCallId();
    const toolResult = flowServiceDeps.buildReingestToolResult({
      callId,
      execution: result.value,
    });

    await flowServiceDeps.runReingestStepLifecycle({
      conversationId: params.conversationId,
      modelId: params.modelId,
      source: params.source,
      command,
      toolResult,
    });
    append({
      level: 'info',
      message: 'DEV-0000052:T7:flow-reingest',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        surface: 'flow',
        flowSurface: 'flow_step',
        flowName: params.flowName,
        stepIndex: command.stepIndex,
        targetMode: result.value.targetMode,
      },
    });

    const pendingCancel = consumePendingConversationCancel({
      conversationId: params.conversationId,
      runToken: params.runToken,
    });
    const continuedToNextStep = !pendingCancel;
    append({
      level: 'info',
      message: 'DEV-0000045:T10:flow_reingest_step_recorded',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        flowName: params.flowName,
        stepIndex: command.stepIndex,
        label: 'label' in command ? command.label : undefined,
        targetMode: result.value.targetMode,
        requestedSelector: result.value.requestedSelector,
        sourceId:
          result.value.kind === 'single' ? result.value.outcome.sourceId : null,
        status:
          result.value.kind === 'single' ? result.value.outcome.status : null,
        repositoryCount:
          result.value.kind === 'batch' ? result.value.repositories.length : 1,
        repositories:
          result.value.kind === 'batch' ? result.value.repositories : null,
        callId,
        continuedToNextStep,
      },
    });

    return pendingCancel ? 'stopped' : 'ok';
  };

  const runStartLoopStep = async (
    step: FlowStartLoopStep,
    nextPath: number[],
    resumePath: number[] | null,
  ): Promise<FlowStepOutcome> => {
    const loopFrame: LoopFrame = {
      loopStepPath: nextPath,
      iteration: 0,
    };
    const savedIteration = resumeLoopIterations.get(getStepPathKey(nextPath));
    const shouldResumeAfterContinue =
      pendingLoopControl?.kind === 'continue' &&
      getStepPathKey(pendingLoopControl.loopStepPath) ===
        getStepPathKey(nextPath) &&
      typeof savedIteration === 'number' &&
      savedIteration > 0;
    if (shouldResumeAfterContinue) {
      loopFrame.iteration = savedIteration;
    } else if (
      resumePath &&
      typeof savedIteration === 'number' &&
      savedIteration > 0
    ) {
      loopFrame.iteration = Math.max(savedIteration - 1, 0);
    }
    loopStack.push(loopFrame);
    let resumeForLoop = shouldResumeAfterContinue ? null : resumePath;
    if (shouldResumeAfterContinue) {
      continueBoundaryLoopKey = getStepPathKey(nextPath);
    }
    while (true) {
      const pendingCancelBeforeIteration = consumePendingConversationCancel({
        conversationId: params.conversationId,
        runToken: params.runToken,
      });
      if (pendingCancelBeforeIteration) {
        params.onStopUnwindCheckpoint?.({
          checkpoint:
            'runStartLoopStep.return.stop.pending_cancel.before_iteration',
          conversationId: params.conversationId,
          detail: `loopDepth=${loopStack.length} loopPath=${nextPath.join('.')}`,
        });
        loopStack.pop();
        return 'stopped';
      }
      loopFrame.iteration += 1;
      const outcome = await runSteps(step.steps, nextPath, resumeForLoop);
      if (resumeForLoop) resumeForLoop = null;
      if (outcome === 'continue') {
        continue;
      }
      if (outcome === 'break') {
        loopStack.pop();
        break;
      }
      if (outcome !== 'ok') {
        params.onStopUnwindCheckpoint?.({
          checkpoint: 'runStartLoopStep.return.non_ok',
          conversationId: params.conversationId,
          detail: `outcome=${outcome} loopDepth=${loopStack.length}`,
        });
        loopStack.pop();
        return outcome;
      }
      await params.onStopUnwindCheckpoint?.({
        checkpoint: 'runStartLoopStep.before_next_iteration',
        conversationId: params.conversationId,
        detail: `loopDepth=${loopStack.length} loopPath=${nextPath.join('.')}`,
      });
      const pendingCancel = consumePendingConversationCancel({
        conversationId: params.conversationId,
        runToken: params.runToken,
      });
      if (pendingCancel) {
        params.onStopUnwindCheckpoint?.({
          checkpoint: 'runStartLoopStep.return.stop.pending_cancel',
          conversationId: params.conversationId,
          detail: `loopDepth=${loopStack.length} loopPath=${nextPath.join('.')}`,
        });
        loopStack.pop();
        return 'stopped';
      }
    }
    lastCompletedStepPath = nextPath;
    clearContinueBoundaryForActiveLoop();
    await persistRuntimeResumeState(lastCompletedStepPath);
    return 'ok';
  };

  const runSteps = async (
    steps: FlowStep[],
    stepPath: number[],
    resumePath?: number[] | null,
  ): Promise<FlowStepOutcome> => {
    let resumePathRemaining =
      resumePath && resumePath.length > 0 ? [...resumePath] : null;
    let resumeIndex = resumePathRemaining?.[0];

    for (const [index, step] of steps.entries()) {
      if (
        resumePathRemaining &&
        resumeIndex !== undefined &&
        index < resumeIndex
      ) {
        continue;
      }

      const nextPath = [...stepPath, index];

      if (resumePathRemaining && resumeIndex === index) {
        if (resumePathRemaining.length === 1) {
          resumePathRemaining = null;
          resumeIndex = undefined;
          continue;
        }
        if (step.type !== 'startLoop') {
          throw toFlowRunError(
            'INVALID_REQUEST',
            'resumeStepPath must reference loop steps for nested indices',
          );
        }
        const outcome = await runStartLoopStep(
          step,
          nextPath,
          resumePathRemaining.slice(1),
        );
        resumePathRemaining = null;
        resumeIndex = undefined;
        if (outcome !== 'ok') return outcome;
        continue;
      }

      if (step.type === 'llm') {
        const command = buildFlowCommandMetadata({
          step,
          stepIndex: index + 1,
          totalSteps: steps.length,
          loopDepth: loopStack.length,
        });
        append({
          level: 'info',
          message: 'flows.turn.metadata_attached',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            stepIndex: command.stepIndex,
            agentType: command.agentType,
          },
        });
        const status = await runLlmStep(step, command);
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.llm',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          return status;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        stepInflightId = crypto.randomUUID();
        continue;
      }

      if (step.type === 'break') {
        const command = buildFlowCommandMetadata({
          step,
          stepIndex: index + 1,
          totalSteps: steps.length,
          loopDepth: loopStack.length,
        });
        append({
          level: 'info',
          message: 'flows.turn.metadata_attached',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            stepIndex: command.stepIndex,
            agentType: command.agentType,
          },
        });
        const { status, shouldBreak } = await runBreakStep(step, command);
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.break',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          return status;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        if (shouldBreak) return 'break';
        continue;
      }

      if (step.type === 'continue') {
        const command = buildFlowCommandMetadata({
          step,
          stepIndex: index + 1,
          totalSteps: steps.length,
          loopDepth: loopStack.length,
        });
        append({
          level: 'info',
          message: 'flows.turn.metadata_attached',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            stepIndex: command.stepIndex,
            agentType: command.agentType,
          },
        });
        const { status, shouldContinue } = await runContinueStep(step, command);
        if (shouldStopAfter(status)) {
          await persistRuntimeResumeState(lastCompletedStepPath);
          return status;
        }
        if (!shouldContinue) {
          clearContinueBoundaryForActiveLoop();
        }
        if (shouldContinue && loopStack.length === 0) {
          throw toFlowRunError(
            'CONTINUE_OUTSIDE_LOOP',
            'A continue step was reached outside of a startLoop context.',
          );
        }
        if (shouldContinue && loopStack.length > 0) {
          const activeLoopFrame = loopStack[loopStack.length - 1];
          pendingLoopControl = {
            kind: 'continue',
            loopStepPath: [...activeLoopFrame.loopStepPath],
          };
          continueBoundaryLoopKey = getStepPathKey(
            activeLoopFrame.loopStepPath,
          );
        }
        lastCompletedStepPath = nextPath;
        await persistRuntimeResumeState(lastCompletedStepPath);
        if (shouldContinue) return 'continue';
        continue;
      }

      if (step.type === 'startLoop') {
        const outcome = await runStartLoopStep(step, nextPath, null);
        if (outcome !== 'ok') return outcome;
        continue;
      }

      if (step.type === 'command') {
        const command = buildFlowCommandMetadata({
          step,
          stepIndex: index + 1,
          totalSteps: steps.length,
          loopDepth: loopStack.length,
        });
        append({
          level: 'info',
          message: 'flows.turn.metadata_attached',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            stepIndex: command.stepIndex,
            agentType: command.agentType,
          },
        });
        const status = await runCommandStep(step, command);
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.command',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          return status;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        stepInflightId = crypto.randomUUID();
        continue;
      }

      if (step.type === 'reset') {
        const command = buildFlowCommandMetadata({
          step,
          stepIndex: index + 1,
          totalSteps: steps.length,
          loopDepth: loopStack.length,
        });
        const agentKey = getAgentKey(step.agentType, step.identifier);
        const resetExistingSlot = runtimeState.delete(agentKey);
        const outcome = resetExistingSlot ? 'reset' : 'already_absent';
        append({
          level: 'info',
          message: 'flows.agent.reset',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            flowName: params.flowName,
            conversationId: params.conversationId,
            stepPath: nextPath,
            stepIndex: command.stepIndex,
            label: command.label,
            agentType: step.agentType,
            identifier: step.identifier,
            agentKey,
            outcome,
          },
        });
        baseLogger.info(
          {
            flowName: params.flowName,
            conversationId: params.conversationId,
            stepPath: nextPath,
            stepIndex: command.stepIndex,
            label: command.label,
            agentType: step.agentType,
            identifier: step.identifier,
            agentKey,
            outcome,
          },
          'flow agent slot reset completed',
        );
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        stepInflightId = crypto.randomUUID();
        continue;
      }

      if (step.type === 'prepareReviewBase') {
        const command = buildFlowCommandMetadata({
          step,
          stepIndex: index + 1,
          totalSteps: steps.length,
          loopDepth: loopStack.length,
        });
        append({
          level: 'info',
          message: 'flows.turn.metadata_attached',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            stepIndex: command.stepIndex,
            reviewBaseOutputKey: step.outputKey,
          },
        });
        const status = await runPrepareReviewBaseStep(step, command);
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.prepareReviewBase',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          return status;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        stepInflightId = crypto.randomUUID();
        continue;
      }

      if (step.type === 'codexReview') {
        const command = buildFlowCommandMetadata({
          step,
          stepIndex: index + 1,
          totalSteps: steps.length,
          loopDepth: loopStack.length,
        });
        append({
          level: 'info',
          message: 'flows.turn.metadata_attached',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            stepIndex: command.stepIndex,
            codexReviewOutputKey: step.outputKey,
          },
        });
        const status = await runCodexReviewFlowStep(step, command);
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.codexReview',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          return status;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        stepInflightId = crypto.randomUUID();
        continue;
      }

      if (step.type === 'validateReviewArtifacts') {
        const command = buildFlowCommandMetadata({
          step,
          stepIndex: index + 1,
          totalSteps: steps.length,
          loopDepth: loopStack.length,
        });
        append({
          level: 'info',
          message: 'flows.turn.metadata_attached',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            stepIndex: command.stepIndex,
            reviewPointerKeys: [...step.pointerKeys],
          },
        });
        const status = await runValidateReviewArtifactsStep(step, command);
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.validateReviewArtifacts',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          return status;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        stepInflightId = crypto.randomUUID();
        continue;
      }

      if (step.type === 'subflow') {
        const command = buildFlowCommandMetadata({
          step,
          stepIndex: index + 1,
          totalSteps: steps.length,
          loopDepth: loopStack.length,
        });
        append({
          level: 'info',
          message: 'flows.turn.metadata_attached',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            stepIndex: command.stepIndex,
            subflowNames: [...step.flowNames],
          },
        });
        const status = await runSubflowStep(step, command, nextPath);
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.subflow',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          return status;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        stepInflightId = crypto.randomUUID();
        continue;
      }

      if (step.type === 'reingest') {
        const command = buildFlowCommandMetadata({
          step,
          stepIndex: index + 1,
          totalSteps: steps.length,
          loopDepth: loopStack.length,
        });
        append({
          level: 'info',
          message: 'flows.turn.metadata_attached',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            stepIndex: command.stepIndex,
            agentType: command.agentType,
          },
        });
        const status = await runReingestStep(step, command);
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.reingest',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          return status;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        continue;
      }

      throw toFlowRunError(
        'UNSUPPORTED_STEP',
        'Flow step type not supported yet',
      );
    }

    return 'ok';
  };

  try {
    const outcome = await runSteps(params.flow.steps, [], resumeStepPath);
    if (outcome !== 'ok') {
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'runFlowUnlocked.return.non_ok',
        conversationId: params.conversationId,
        detail: `outcome=${outcome}`,
      });
      return;
    }
    params.onStopUnwindCheckpoint?.({
      checkpoint: 'runFlowUnlocked.return.ok',
      conversationId: params.conversationId,
    });
  } finally {
    finalizeFlowRuntime();
  }
}

export async function startFlowRun(
  params: FlowRunStartParams,
): Promise<FlowRunStartResult> {
  const flowName = params.flowName.trim();
  const sourceId = params.sourceId?.trim() || undefined;
  const flowPathEntry = buildFlowPathEntry({ flowName, sourceId });
  if (params.flowPath?.includes(flowPathEntry)) {
    const cyclePath = [...params.flowPath, flowPathEntry].join(' -> ');
    throw toFlowRunError(
      'INVALID_REQUEST',
      `Subflow cycle detected: ${cyclePath}.`,
    );
  }
  const flowPath = [...(params.flowPath ?? []), flowPathEntry];
  const retryOwnershipId = params.retryOwnershipId?.trim() || undefined;
  const requestedConversationId = params.conversationId?.trim() || undefined;
  const inflightId = params.inflightId ?? crypto.randomUUID();
  const resumeStepPath = params.resumeStepPath;
  const retryOwnershipLaunch = normalizeFreshRunRetryOwnershipLaunch({
    flowName,
    source: params.source,
    sourceId,
    codexReviewModelId: params.codexReviewModelId,
    working_folder: params.working_folder,
    customTitle: params.customTitle,
  });
  if (resumeStepPath && !requestedConversationId) {
    throw toFlowRunError(
      'INVALID_REQUEST',
      'resumeStepPath requires an existing conversationId',
    );
  }
  if (retryOwnershipId && !resumeStepPath) {
    const existingRetry = await getFreshRunRetryOwnership({
      flowName,
      sourceId,
      retryOwnershipId,
      launch: retryOwnershipLaunch,
    });
    if (existingRetry) {
      return existingRetry.result;
    }
  }
  const listRepos = params.listIngestedRepositories ?? listIngestedRepositories;
  let existingConversation = requestedConversationId
    ? await getConversation(requestedConversationId)
    : null;
  const conversationId =
    resumeStepPath || !existingConversation
      ? (requestedConversationId ?? crypto.randomUUID())
      : crypto.randomUUID();

  if (!tryAcquireConversationLock(conversationId)) {
    throw toFlowRunError(
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

  let flow: FlowFile;
  let modelId = FALLBACK_MODEL_ID;
  let providerId: ConversationProvider = 'codex';
  let resumeState: FlowResumeState | null = null;
  let repositoryContext: FlowCommandRepositoryContext | null = null;
  let executionId: string = crypto.randomUUID();
  let startupWarnings: string[] = [];
  let childExecutionBackfills: string[] = [];
  let completedSuccessfully = false;

  try {
    await params.onOwnershipReady?.({ conversationId, runToken });

    let flowsRoot = flowsDirForRun();
    const listedReposResult = await listRepos()
      .then((result) => ({
        repos: result.repos,
        knownRepositoryPathsState: knownRepositoryPathsAvailable(
          result.repos.map((repo) => repo.containerPath),
        ),
      }))
      .catch((error) => ({
        repos: [] as Awaited<ReturnType<typeof listRepos>>['repos'],
        knownRepositoryPathsState: knownRepositoryPathsUnavailable(error),
      }));
    const listedRepos = listedReposResult.repos;
    const sourceRepo = sourceId
      ? listedRepos.find((item) => item.containerPath === sourceId)
      : undefined;
    if (sourceId) {
      if (!sourceRepo) {
        throw toFlowRunError('FLOW_NOT_FOUND');
      }
      appendRepoBackedTransitiveConsumerLogs({
        consumer: 'flows.service.startFlowRun',
        subjectKind: 'repository',
        subjectId: sourceRepo.containerPath,
        sourceId,
        containerPath: sourceRepo.containerPath,
        repoIdentity: resolveRepoEmbeddingIdentity(sourceRepo),
      });
      flowsRoot = path.resolve(sourceRepo.containerPath, 'flows');
    }
    flow = await loadFlowFile({ flowName, flowsRoot, sourceId });
    if (!flow.steps.length) {
      throw toFlowRunError('NO_STEPS', 'Flow has no steps');
    }

    existingConversation =
      conversationId === requestedConversationId ? existingConversation : null;
    if (existingConversation?.archivedAt) {
      throw toFlowRunError('CONVERSATION_ARCHIVED');
    }

    const effectiveWorkingFolder = await resolveConversationWorkingFolderForRun(
      {
        conversationId,
        conversation: existingConversation,
        requestedWorkingFolder: params.working_folder,
        surface: 'flow_run',
        knownRepositoryPathsState: listedReposResult.knownRepositoryPathsState,
      },
    );

    if (resumeStepPath && params.customTitle && existingConversation) {
      baseLogger.info(
        {
          flowName,
          conversationId,
          customTitle: params.customTitle,
        },
        'flows.run.custom_title.resume_ignored',
      );
    }

    const existingFlags = (existingConversation?.flags ?? undefined) as
      | Record<string, unknown>
      | undefined;
    const trustedPersistedFlowState =
      existingConversation?.flowName === flowName ? existingFlags : undefined;
    resumeState = parseFlowResumeState(trustedPersistedFlowState);
    if (resumeStepPath) {
      if (!resumeState) {
        throw toFlowRunError(
          'INVALID_REQUEST',
          'resumeStepPath requires saved flow state',
        );
      }
      validateResumeStepPath(flow.steps, resumeStepPath);
      childExecutionBackfills =
        await validateResumeAgentConversations(resumeState);
    }
    executionId = resumeState?.executionId ?? executionId;
    const effectiveCodexReviewModelId =
      params.codexReviewModelId ?? resumeState?.codexReviewModelId;

    const runtimeIdentityStep = findRuntimeIdentityStep(
      flow.steps,
      resumeStepPath,
    );
    const firstAgentStep =
      runtimeIdentityStep ?? findFirstAgentStep(flow.steps);
    const runtimeCodexReviewStep = !firstAgentStep
      ? findRuntimeCodexReviewStep(flow.steps, resumeStepPath)
      : undefined;
    const firstCodexReviewStep =
      runtimeCodexReviewStep ??
      (!firstAgentStep ? findFirstCodexReviewStep(flow.steps) : undefined);
    const flowDefaultRepositoryRoot = sourceRepo?.containerPath
      ? path.resolve(sourceRepo.containerPath)
      : sourceId
        ? path.resolve(sourceId)
        : undefined;
    const flowRunDefaultRepositoryRoot = effectiveWorkingFolder
      ? flowDefaultRepositoryRoot
      : undefined;
    const discovered = await discoverAgents();
    const agentByName = new Map(discovered.map((item) => [item.name, item]));
    if (firstAgentStep) {
      const validatedAgentType = validateRepositoryBackedAgentType(
        firstAgentStep.agentType,
      );
      if (!validatedAgentType.ok) {
        throw toFlowRunError(
          'INVALID_REQUEST',
          `Flow agent "${firstAgentStep.agentType}" ${validatedAgentType.message}.`,
        );
      }
      const agent = agentByName.get(firstAgentStep.agentType);
      if (!agent) {
        throw toFlowRunError(
          'AGENT_NOT_FOUND',
          `Agent ${firstAgentStep.agentType} not found`,
        );
      }
      const prepared = await resolveFlowAgentRuntimeExecution({
        agentName: firstAgentStep.agentType,
        configPath: agent.configPath,
        workingFolder: effectiveWorkingFolder,
        defaultRepositoryRoot: flowRunDefaultRepositoryRoot,
        source: params.source,
      });
      modelId = prepared.modelId;
      providerId = prepared.providerId;
      startupWarnings = prepared.warnings ?? [];
    } else if (firstCodexReviewStep) {
      const agentProfile = await resolveCodexReviewAgentProfile({
        step: firstCodexReviewStep,
        agentByName,
        workingFolder: effectiveWorkingFolder,
        defaultRepositoryRoot: flowRunDefaultRepositoryRoot,
        source: params.source,
      });
      const resolvedModelId = resolveCodexReviewModel({
        requestedModelId: effectiveCodexReviewModelId,
        stepModelId: firstCodexReviewStep.model,
        agentModelId: agentProfile.modelId,
      });
      const codexBootstrapStatus = getProviderBootstrapStatus('codex');
      if (!codexBootstrapStatus.healthy) {
        throw toFlowRunError(
          'PROVIDER_UNAVAILABLE',
          codexBootstrapStatus.reason ?? 'codex unavailable',
        );
      }
      modelId = resolvedModelId ?? FALLBACK_MODEL_ID;
      providerId = 'codex';
      startupWarnings = [
        ...agentProfile.warnings,
        ...codexBootstrapStatus.warnings,
      ];
    }

    const codeInfo2Root = codeInfo2RootForRun();
    repositoryContext = {
      flowName,
      workingRepositoryPath: effectiveWorkingFolder,
      defaultRepositoryRoot: flowRunDefaultRepositoryRoot,
      flowSourceId: sourceRepo?.containerPath
        ? path.resolve(sourceRepo.containerPath)
        : sourceId
          ? path.resolve(sourceId)
          : undefined,
      flowSourceLabel: sourceRepo
        ? normalizeSourceLabel({
            sourceId: sourceRepo.containerPath,
            sourceLabel: sourceRepo.id,
          })
        : sourceId
          ? normalizeSourceLabel({ sourceId })
          : undefined,
      codeInfo2Root,
      listIngestedRepositories: listRepos,
      repos: listedRepos.map((repo) => ({
        sourceId: path.resolve(repo.containerPath),
        sourceLabel: normalizeSourceLabel({
          sourceId: repo.containerPath,
          sourceLabel: repo.id,
        }),
      })),
    };

    await validateCommandSteps({
      flowName,
      steps: flow.steps,
      flowsRoot,
      sourceId,
      agentByName,
      repositoryContext,
      resumeStepPath,
    });
    await validateCodexReviewSteps({
      flowName,
      steps: flow.steps,
      flowsRoot,
      sourceId,
      codexReviewModelId: effectiveCodexReviewModelId,
      resumeStepPath,
    });

    await ensureFlowConversation({
      conversationId,
      flowName,
      providerId,
      modelId,
      customTitle: params.customTitle,
      source: params.source,
      workingFolder: effectiveWorkingFolder,
    });
    if (!existingConversation && effectiveWorkingFolder) {
      appendWorkingFolderDecisionLog({
        conversationId,
        recordType: 'flow',
        surface: 'flow_run',
        action: 'save',
        decisionReason: 'request_value_persisted_on_create',
        workingFolder: effectiveWorkingFolder,
      });
    }
    if (resumeStepPath) {
      for (const childConversationId of childExecutionBackfills) {
        await flowResumeTestDeps.persistFlowChildExecutionId({
          conversationId: childConversationId,
          executionId,
        });
      }
    }
    // Build runtimeState from the persisted resumeState and backfill requestedProviderId
    // from the parent flow's canonical requested provider first, then fall back to
    // any existing child conversations only when the parent has no saved request.
    const runtimeStateForPersist = hydrateFlowAgentState(resumeState);
    const savedRequestedProviderId =
      getSavedRequestedProviderId(existingConversation);
    for (const [, state] of runtimeStateForPersist) {
      if (savedRequestedProviderId) {
        state.requestedProviderId = savedRequestedProviderId;
        continue;
      }
      if (!state.requestedProviderId) {
        const maybeConv = await getConversation(state.conversationId);
        const savedRequested = getSavedRequestedProviderId(maybeConv);
        if (savedRequested) {
          state.requestedProviderId = savedRequested;
        }
      }
    }

    await persistFlowResumeState({
      conversationId,
      executionId,
      runtimeState: runtimeStateForPersist,
      stepPath: resumeState?.stepPath ?? [],
      loopStack: (resumeState?.loopStack ?? []).map((frame) => ({
        loopStepPath: [...frame.loopStepPath],
        iteration: frame.iteration,
      })),
      pendingLoopControl: resumeState?.pendingLoopControl
        ? {
            kind: resumeState.pendingLoopControl.kind,
            loopStepPath: [...resumeState.pendingLoopControl.loopStepPath],
          }
        : null,
      activeSubflows: resumeState?.activeSubflows?.map((activeSubflow) => ({
        stepPath: [...activeSubflow.stepPath],
        flowName: activeSubflow.flowName,
        conversationId: activeSubflow.conversationId,
        runToken: activeSubflow.runToken,
        ...(activeSubflow.title ? { title: activeSubflow.title } : {}),
      })),
      codexReviewModelId:
        effectiveCodexReviewModelId ?? resumeState?.codexReviewModelId,
      workingFolder: effectiveWorkingFolder ?? resumeState?.workingFolder,
    });
    if (retryOwnershipId && !resumeStepPath) {
      rememberFreshRunRetryOwnership({
        flowName,
        sourceId,
        retryOwnershipId,
        runToken,
        launch: retryOwnershipLaunch,
        result: {
          flowName,
          conversationId,
          inflightId,
          providerId,
          modelId,
          ...(startupWarnings.length > 0 ? { warnings: startupWarnings } : {}),
        },
      });
    }
    params.working_folder = effectiveWorkingFolder;
  } catch (err) {
    cleanupPendingConversationCancel({ conversationId, runToken });
    releaseConversationLock(conversationId, runToken);
    throw err;
  }

  if (resumeStepPath) {
    append({
      level: 'info',
      message: 'flows.resume.requested',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: { conversationId, resumeStepPath },
    });
  }

  void (async () => {
    try {
      if (!repositoryContext) {
        throw toFlowRunError(
          'COMMAND_INVALID',
          'Flow command repository context unavailable',
        );
      }
      const workingDirectoryOverride = (
        await resolveSharedExecutionContext({
          workingFolder: params.working_folder,
          defaultRepositoryRoot: repositoryContext.defaultRepositoryRoot,
        })
      ).workingDirectoryOverride;
      await runFlowUnlocked({
        flowName,
        flow,
        flowPath,
        repositoryContext,
        conversationId,
        executionId,
        inflightId,
        modelId,
        providerId,
        workingDirectoryOverride,
        codexReviewModelId:
          params.codexReviewModelId ?? resumeState?.codexReviewModelId,
        source: params.source,
        chatFactory: params.chatFactory,
        resumeState,
        resumeStepPath,
        customTitle: params.customTitle,
        runToken,
        onStopUnwindCheckpoint: params.onStopUnwindCheckpoint,
        cleanupInflightFn: params.cleanupInflightFn,
        releaseConversationLockFn: params.releaseConversationLockFn,
      });
      completedSuccessfully = true;
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'startFlowRun.async.afterRunFlowUnlocked',
        conversationId,
      });
    } catch (err) {
      const failureMessage = isFlowRunError(err)
        ? (err.reason ?? err.code)
        : err instanceof Error
          ? err.message
          : 'Flow run failed unexpectedly.';
      try {
        await persistUnexpectedFlowFailureIfNeeded({
          conversationId,
          modelId,
          providerId,
          source: params.source,
          message: failureMessage,
        });
      } catch (persistErr) {
        baseLogger.error(
          {
            flowName,
            conversationId,
            inflightId,
            err: persistErr,
            originalError: err,
          },
          'flow run failure persistence skipped after terminal metadata error',
        );
      }
      if ((err as FlowRunError | undefined)?.code) {
        baseLogger.error(
          { flowName, conversationId, inflightId, err },
          'flow run failed',
        );
      } else {
        baseLogger.error(
          { flowName, conversationId, inflightId, err },
          'flow run failed (unexpected)',
        );
      }
    } finally {
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'startFlowRun.async.finally.enter',
        conversationId,
      });
      cleanupPendingConversationCancel({ conversationId, runToken });
      const releaseConversationLockFn =
        params.releaseConversationLockFn ?? releaseConversationLock;
      const released = releaseConversationLockFn(conversationId, runToken);
      if (retryOwnershipId && !resumeStepPath && completedSuccessfully) {
        const completedResult = {
          flowName,
          conversationId,
          inflightId,
          providerId,
          modelId,
          ...(startupWarnings.length > 0 ? { warnings: startupWarnings } : {}),
        };
        try {
          await persistFreshRunRetryOwnershipCompletion({
            conversationId,
            retryOwnershipId,
            launch: retryOwnershipLaunch,
            result: completedResult,
          });
        } catch (error) {
          baseLogger.error(
            { flowName, conversationId, inflightId, error },
            'fresh run retry completion persistence failed',
          );
        }
        rememberFreshRunRetryOwnershipCompletion({
          flowName,
          sourceId,
          retryOwnershipId,
          launch: retryOwnershipLaunch,
          result: completedResult,
        });
      }
      if (retryOwnershipId && !resumeStepPath) {
        clearFreshRunRetryOwnership({
          flowName,
          sourceId,
          retryOwnershipId,
          expectedRunToken: runToken,
        });
      }
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'startFlowRun.async.finally.exit',
        conversationId,
        detail: `lockReleased=${String(released)}`,
      });
    }
  })();

  append({
    level: 'info',
    message: 'flows.run.started',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: { flowName, conversationId, inflightId },
  });

  return {
    flowName,
    conversationId,
    inflightId,
    providerId,
    modelId,
    ...(startupWarnings.length > 0 ? { warnings: startupWarnings } : {}),
  };
}
