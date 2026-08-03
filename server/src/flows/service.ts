import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as scheduleTimeout } from 'node:timers';

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
import { runCopilotReview } from '../copilot/reviewLauncher.js';
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
import {
  enterTestOverrideScope,
  getScopedFlowServiceDepsOverride,
  hasActiveTestOverrideScope,
} from '../test/support/testOverrideScope.js';
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

const flowRuntimeDiagnosticsEnabled =
  process.env.CODEINFO_TEST_RUNTIME_DIAGNOSTICS === '1';

const appendFlowRuntimeDiagnostic = (
  message: string,
  context: Record<string, unknown>,
) => {
  if (!flowRuntimeDiagnosticsEnabled) return;
  append({
    level: 'info',
    message,
    timestamp: new Date().toISOString(),
    source: 'server',
    context,
  });
};

const FLOW_RUNTIME_RESOLUTION_TIMEOUT_MS = 40_000;

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const withTimeout = async <T>(params: {
  promise: Promise<T>;
  timeoutMs: number;
  onTimeout?: () => void;
  timeoutErrorFactory: () => Error | FlowRunError;
}): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      params.promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          params.onTimeout?.();
          reject(params.timeoutErrorFactory());
        }, params.timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const snapshotFlowRuntimeCleanupState = (conversationId: string) => {
  const pendingCancel = getPendingConversationCancel(conversationId);
  return {
    inflightId: getInflight(conversationId)?.inflightId ?? null,
    ownershipRunToken: getActiveRunOwnership(conversationId)?.runToken ?? null,
    pendingCancelRunToken: pendingCancel?.runToken ?? null,
    pendingCancelInflightId: pendingCancel?.boundInflightId ?? null,
  };
};

import { prepareCopilotReviewGroups } from './copilotReviewGroups.js';
import { executeCopilotReviewStep } from './copilotReviewStep.js';
import {
  discoverFlows,
  resolveFlowAgentForDiscovery,
  type FlowSummary,
} from './discovery.js';
import { executeFlowDecisionScript } from './flowDecisionScript.js';
import {
  __resetFlowDefinitionCatalogForTests,
  getFlowDefinitionCatalogEntry,
  resolveConfiguredFlowsRoot,
} from './flowDefinitionCatalog.js';
import {
  hashFlowInput,
  normalizeFlowInput,
  prependAssignedReviewJobContext,
  tryNormalizeFlowInput,
} from './flowInput.js';
import {
  type FlowFile,
  type FlowBreakStep,
  type FlowContinueStep,
  type FlowCommandStep,
  type FlowIfStep,
  type FlowLlmStep,
  type FlowPrepareCopilotReviewGroupsStep,
  type FlowRunCopilotReviewStep,
  type FlowPrepareReviewTargetsStep,
  type FlowReingestStep,
  type FlowResetStep,
  type FlowInitializeReviewCycleStep,
  type FlowStartLoopStep,
  type FlowSubflowStep,
  type FlowWaitStep,
  type FlowSubflowWaveStep,
  type FlowStep,
} from './flowSchema.js';
import type {
  FlowActiveSubflow,
  FlowGitHubReviewContext,
  FlowPendingLoopControl,
  FlowResumeState,
  FlowWaitState,
  FlowSubflowWaveProgress,
  FreshRunRetryOwnershipCompletion,
  FreshRunRetryOwnershipPending,
} from './flowState.js';
import {
  appendGitHubReviewPlanNote,
  buildGitHubReviewScratchPaths,
  materializeGitHubExternalReviewInput,
  closePullRequest,
  createPullRequest,
  fetchPullRequestReviews,
  type GitHubCommandFailureDetail,
  type GitHubLookupRetryDiagnostic,
  type GitHubRepositoryState,
  lookupLatestOpenPullRequest,
  reconcileResumedGitHubReviewPullRequest,
  pushBranchToExistingUpstream,
  prepareGitHubReviewScratchOwnership,
  readGitHubReviewScratch,
  readWorkedRepositoryGitHubToken,
  resolveCanonicalGitHubReviewScratchPaths,
  resolveGitHubRepositoryState,
  writeGitHubReviewScratch,
} from './githubReview.js';
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
import { prepareReviewBatchWorkspace } from './reviewBatchWorkspace.js';
import {
  finalizeActiveReviewCycleIfPending,
  initializeReviewCycle,
  readActiveFinalReviewCycleStatus,
  recordReviewInvocationAttempt,
  type ReviewInvocationAttemptStatus,
} from './reviewCycleLifecycle.js';
import { prepareReviewTargets } from './reviewTargets.js';
import type { ReviewTargetSnapshot } from './reviewTargets.js';
import { writeReviewUsageArtifact } from './reviewUsage.js';
import {
  expandSubflowWaveJobs,
  resolveFlowValue,
  type SubflowWaveJob,
} from './subflowWave.js';
import type {
  FlowAgentState,
  FlowChatFactory,
  FlowExecutionRuntimeState,
  FlowJsonObject,
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
  runCopilotReview: typeof runCopilotReview;
  createCallId: () => string;
};

const defaultFlowServiceDeps: FlowServiceDeps = {
  runReingestRepository,
  buildReingestToolResult,
  runReingestStepLifecycle,
  runCopilotReview,
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

const getEffectiveFlowServiceDeps = (): FlowServiceDeps => {
  const scoped = getScopedFlowServiceDepsOverride() as
    | Partial<FlowServiceDeps>
    | undefined;
  if (!scoped) {
    return flowServiceDeps;
  }
  return {
    ...flowServiceDeps,
    ...scoped,
  };
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

type FreshRunRetryOwnershipPendingRecord = {
  retryOwnershipId: string;
  sourceId?: string;
  result: FlowRunStartResult;
  launchSignature: string;
};

const FRESH_RUN_RETRY_OWNERSHIP_COMPLETION_WINDOW_MS = 10 * 60 * 1000;

type FreshRunRetryOwnershipLaunch = {
  flowName: string;
  source: 'REST' | 'MCP';
  sourceId?: string;
  codexReviewModelId?: string;
  workingFolder?: string;
  customTitle?: string;
  inputHash?: string;
};

type ScheduledWaitHandle = {
  cancel: () => void;
};

type FlowWaitResumeDeps = {
  now: () => number;
  nowIso: () => string;
  scheduleWake: (params: {
    resumeAt: number;
    onWake: () => void;
  }) => ScheduledWaitHandle;
  loadConversation: typeof getConversation;
  loadLatestAssistantStatus: typeof latestAssistantStatusForConversation;
  resumeFlowRun: (params: {
    flowName: string;
    conversationId: string;
    resumeStepPath: number[];
    sourceId?: string;
    source: 'REST' | 'MCP';
  }) => Promise<unknown>;
};

export const FLOW_WAIT_STARTUP_RECOVERY_DEGRADED_EVENT =
  'FLOW_WAIT_STARTUP_RECOVERY_DEGRADED';
export const FLOW_WAIT_STARTUP_RECOVERY_DEGRADED_MESSAGE =
  'Persisted flow wait recovery degraded during startup';

export type FlowWaitStartupRecoveryResult =
  | {
      reachable: true;
      degraded: false;
      resumedCandidateCount: number;
      diagnosticEvent: null;
    }
  | {
      reachable: true;
      degraded: true;
      resumedCandidateCount: number;
      diagnosticEvent: typeof FLOW_WAIT_STARTUP_RECOVERY_DEGRADED_EVENT;
      causeMessage: string;
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
  inputHash?: string;
}): FreshRunRetryOwnershipLaunch => ({
  flowName: params.flowName.trim(),
  source: params.source,
  sourceId: params.sourceId?.trim() || undefined,
  codexReviewModelId: params.codexReviewModelId?.trim() || undefined,
  workingFolder: params.working_folder?.trim() || undefined,
  customTitle: params.customTitle?.trim() || undefined,
  inputHash: params.inputHash?.trim() || undefined,
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

const parseFreshRunRetryOwnershipPending = (
  pending: unknown,
): FreshRunRetryOwnershipPendingRecord | null => {
  if (!isRecord(pending)) return null;
  const retryOwnershipId =
    typeof pending.retryOwnershipId === 'string' &&
    pending.retryOwnershipId.trim().length > 0
      ? pending.retryOwnershipId.trim()
      : undefined;
  const sourceId =
    typeof pending.sourceId === 'string' && pending.sourceId.trim().length > 0
      ? pending.sourceId.trim()
      : undefined;
  const launchSignature =
    typeof pending.launchSignature === 'string' &&
    pending.launchSignature.trim().length > 0
      ? pending.launchSignature.trim()
      : undefined;
  const result = pending.result;
  if (!retryOwnershipId || !launchSignature || !isRecord(result)) {
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

const getFreshRunRetryOwnershipPendingFromConversation = (
  conversation: Conversation | null | undefined,
  params: {
    flowName: string;
    retryOwnershipId: string;
    launch: FreshRunRetryOwnershipLaunch;
  },
): FreshRunRetryOwnershipPendingRecord | null => {
  if (!conversation || conversation.flowName !== params.flowName) return null;
  const flow = conversation.flags?.flow;
  if (!isRecord(flow)) return null;
  const pending = parseFreshRunRetryOwnershipPending(
    flow.retryOwnershipPending,
  );
  if (!pending) return null;
  if (pending.retryOwnershipId !== params.retryOwnershipId) return null;
  if (params.launch.sourceId) {
    if (pending.sourceId !== params.launch.sourceId) return null;
  } else if (pending.sourceId) {
    return null;
  }
  return pending;
};

const clearFreshRunRetryOwnershipPending = async (params: {
  conversationId: string;
  conversation: Conversation | null | undefined;
}) => {
  const conversation = params.conversation;
  if (!conversation) return;
  const flow = conversation.flags?.flow;
  if (!isRecord(flow) || !flow.retryOwnershipPending) return;
  const nextFlow = { ...flow } as Record<string, unknown>;
  delete nextFlow.retryOwnershipPending;
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
  delete (nextFlow as Record<string, unknown>).retryOwnershipPending;
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

const getPersistedFreshRunRetryOwnershipPending = async (params: {
  flowName: string;
  sourceId?: string;
  retryOwnershipId: string;
  launch: FreshRunRetryOwnershipLaunch;
}): Promise<FreshRunRetryOwnershipPendingRecord | null> => {
  const loadPendingConversation = async (): Promise<Conversation | null> => {
    if (shouldUseMemoryPersistence()) {
      const conversation = [...memoryConversations.values()].find((item) =>
        Boolean(getFreshRunRetryOwnershipPendingFromConversation(item, params)),
      );
      return conversation ?? null;
    }

    return (await ConversationModel.findOne({
      flowName: params.flowName,
      'flags.flow.retryOwnershipPending.retryOwnershipId':
        params.retryOwnershipId,
      ...(params.sourceId
        ? {
            'flags.flow.retryOwnershipPending.sourceId': params.sourceId,
          }
        : {
            'flags.flow.retryOwnershipPending.sourceId': { $exists: false },
          }),
    })
      .sort({ updatedAt: -1, _id: -1 })
      .lean()
      .exec()) as Conversation | null;
  };

  const conversation = await loadPendingConversation();
  if (!conversation) return null;
  const pending = getFreshRunRetryOwnershipPendingFromConversation(
    conversation,
    params,
  );
  if (!pending) {
    await clearFreshRunRetryOwnershipPending({
      conversationId: conversation._id,
      conversation,
    });
    return null;
  }
  if (
    pending.launchSignature !==
    makeFreshRunRetryOwnershipLaunchSignature(params.launch)
  ) {
    throw toFlowRunError(
      'INVALID_REQUEST',
      'retryOwnershipId already belongs to a different fresh-run launch',
    );
  }
  if (getActiveRunOwnership(conversation._id)) {
    return {
      retryOwnershipId: pending.retryOwnershipId,
      sourceId: pending.sourceId,
      result: cloneFlowRunStartResult(pending.result),
      launchSignature: pending.launchSignature,
    };
  }
  const resumedState = parseFlowResumeState(
    isRecord(conversation.flags)
      ? (conversation.flags as Record<string, unknown>)
      : undefined,
  );
  if (resumedState?.wait) {
    return {
      retryOwnershipId: pending.retryOwnershipId,
      sourceId: pending.sourceId,
      result: cloneFlowRunStartResult(pending.result),
      launchSignature: pending.launchSignature,
    };
  }
  await clearFreshRunRetryOwnershipPending({
    conversationId: conversation._id,
    conversation,
  });
  return null;
};

const isPermanentPersistedWaitResumeFailure = (error: unknown): boolean => {
  if (!isFlowRunError(error)) return false;
  return (
    error.code === 'INVALID_REQUEST' ||
    error.code === 'FLOW_NOT_FOUND' ||
    error.code === 'CONVERSATION_ARCHIVED'
  );
};

const describeFlowRunFailure = (error: unknown): string => {
  if (isFlowRunError(error)) {
    return error.reason ?? error.code;
  }
  return error instanceof Error ? error.message : String(error);
};

const retirePersistedWaitRecoveryFailure = async (params: {
  conversationId: string;
  modelId: string;
  providerId?: ConversationProvider;
  source: 'REST' | 'MCP';
  flowName: string;
  waitStepPath: number[];
  recoveryReason: string;
}) => {
  await persistUnexpectedFlowFailureIfNeeded({
    conversationId: params.conversationId,
    modelId: params.modelId,
    providerId: params.providerId,
    source: params.source,
    message: `Persisted wait recovery retired a permanently invalid resume mismatch at step ${getStepPathKey(params.waitStepPath)}: ${params.recoveryReason}`,
  });
  baseLogger.warn(
    {
      conversationId: params.conversationId,
      flowName: params.flowName,
      waitStepPath: params.waitStepPath,
      recoveryReason: params.recoveryReason,
    },
    'flows.wait.resume.retired_permanent_invalid_state',
  );
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
    (await getPersistedFreshRunRetryOwnershipPending(params)) ??
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
  if (hasActiveTestOverrideScope()) {
    enterTestOverrideScope({
      flowServiceDeps: overrides as Record<string, unknown>,
    });
    return;
  }
  Object.assign(flowServiceDeps, overrides);
}

export function __resetFlowServiceDepsForTests() {
  if (hasActiveTestOverrideScope()) {
    enterTestOverrideScope({
      flowServiceDeps: null,
    });
    return;
  }
  Object.assign(flowServiceDeps, defaultFlowServiceDeps);
  freshRunRetryOwnershipByKey.clear();
  freshRunRetryOwnershipCompletedByKey.clear();
  __resetFlowDefinitionCatalogForTests();
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
  waveLabel?: string;
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
  return `${parentTitle}-${stepTitle}${
    params.waveLabel ? ` (${params.waveLabel})` : ''
  }`;
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

const normalizeOptionalFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

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
  const input = tryNormalizeFlowInput(value.input);
  const hasPersistedInput = Object.prototype.hasOwnProperty.call(
    value,
    'input',
  );
  if (hasPersistedInput && value.input !== undefined && !input) return null;
  return {
    stepPath: normalizeNumberArray(value.stepPath),
    flowName,
    conversationId,
    runToken,
    ...(normalizeOptionalString(value.instanceId)
      ? { instanceId: normalizeOptionalString(value.instanceId) }
      : {}),
    ...(normalizeOptionalString(value.waveInvocationId)
      ? { waveInvocationId: normalizeOptionalString(value.waveInvocationId) }
      : {}),
    ...(normalizeOptionalString(value.targetId)
      ? { targetId: normalizeOptionalString(value.targetId) }
      : {}),
    ...(normalizeOptionalString(value.workingFolder)
      ? { workingFolder: normalizeOptionalString(value.workingFolder) }
      : {}),
    ...(input ? { input } : {}),
    ...(normalizeOptionalString(value.inputHash)
      ? { inputHash: normalizeOptionalString(value.inputHash) }
      : {}),
    ...(normalizeOptionalString(value.title)
      ? { title: normalizeOptionalString(value.title) }
      : {}),
  };
};

const normalizeActiveSubflows = (params: {
  activeSubflows?: unknown;
  legacyActiveSubflow?: unknown;
}): FlowActiveSubflow[] => {
  if (Array.isArray(params.activeSubflows)) {
    return params.activeSubflows
      .map((item) => normalizeActiveSubflow(item))
      .filter((item): item is FlowActiveSubflow => Boolean(item));
  }
  const legacyActiveSubflow = normalizeActiveSubflow(
    params.legacyActiveSubflow,
  );
  return legacyActiveSubflow ? [legacyActiveSubflow] : [];
};

const parseFlowGitHubReviewContext = (
  value: unknown,
): FlowGitHubReviewContext | undefined => {
  if (!isRecord(value)) return undefined;
  const context: FlowGitHubReviewContext = {
    ...(normalizeOptionalString(value.executionId)
      ? { executionId: normalizeOptionalString(value.executionId) }
      : {}),
    ...(typeof value.prNumber === 'number' && Number.isFinite(value.prNumber)
      ? { prNumber: value.prNumber }
      : {}),
    ...(normalizeOptionalString(value.storyNumber)
      ? { storyNumber: normalizeOptionalString(value.storyNumber) }
      : {}),
    ...(normalizeOptionalString(value.branchName)
      ? { branchName: normalizeOptionalString(value.branchName) }
      : {}),
    ...(normalizeOptionalString(value.selectorPath)
      ? { selectorPath: normalizeOptionalString(value.selectorPath) }
      : {}),
    ...(normalizeOptionalString(value.handoffPath)
      ? { handoffPath: normalizeOptionalString(value.handoffPath) }
      : {}),
    ...(value.phase === 'opened' ||
    value.phase === 'fetched' ||
    value.phase === 'skipped'
      ? { phase: value.phase }
      : {}),
    ...(value.selectorPublicationPending === true
      ? { selectorPublicationPending: true }
      : {}),
    ...(typeof value.retryAttempt === 'number' &&
    Number.isInteger(value.retryAttempt) &&
    value.retryAttempt >= 0
      ? { retryAttempt: value.retryAttempt }
      : {}),
    ...(Array.isArray(value.retryStepPath)
      ? { retryStepPath: normalizeNumberArray(value.retryStepPath) }
      : {}),
    ...(normalizeOptionalString(value.warningMessage)
      ? { warningMessage: normalizeOptionalString(value.warningMessage) }
      : {}),
  };
  return Object.keys(context).length > 0 ? context : undefined;
};

const parseFlowWaitState = (value: unknown): FlowWaitState | null => {
  if (!isRecord(value)) return null;
  const executionId = normalizeOptionalString(value.executionId);
  const resumeAt = normalizeOptionalFiniteNumber(value.resumeAt);
  const stepPath = normalizeNumberArray(value.stepPath);
  const waitKind =
    value.kind === 'review_retry' ? 'review_retry' : 'authored_wait';
  const isFirstStepReviewRetry =
    waitKind === 'review_retry' &&
    Array.isArray(value.stepPath) &&
    value.stepPath.length === 0;
  if (
    !executionId ||
    resumeAt === undefined ||
    (stepPath.length === 0 && !isFirstStepReviewRetry)
  ) {
    return null;
  }

  const activeSubflows = normalizeActiveSubflows({
    activeSubflows: value.activeSubflows,
    legacyActiveSubflow: value.activeSubflow,
  });

  const githubReviewContext = parseFlowGitHubReviewContext(
    value.githubReviewContext,
  );

  return {
    kind: waitKind,
    executionId,
    stepPath,
    loopStack: Array.isArray(value.loopStack)
      ? value.loopStack
          .map((item) => {
            if (!isRecord(item)) return null;
            return {
              loopStepPath: normalizeNumberArray(item.loopStepPath),
              iteration:
                typeof item.iteration === 'number' &&
                Number.isFinite(item.iteration)
                  ? item.iteration
                  : 0,
            };
          })
          .filter(
            (item): item is { loopStepPath: number[]; iteration: number } =>
              Boolean(item),
          )
      : [],
    ...(activeSubflows.length > 0 ? { activeSubflows } : {}),
    ...(normalizeOptionalString(value.workingFolder)
      ? { workingFolder: normalizeOptionalString(value.workingFolder) }
      : {}),
    ...(normalizeOptionalString(value.sourceId)
      ? { sourceId: normalizeOptionalString(value.sourceId) }
      : {}),
    resumeAt,
    ...(value.continuedAfterFailure === true
      ? { continuedAfterFailure: true }
      : {}),
    ...(githubReviewContext && Object.keys(githubReviewContext).length > 0
      ? { githubReviewContext }
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

const normalizeSubflowWaveProgress = (
  value: unknown,
): FlowSubflowWaveProgress | undefined => {
  if (!isRecord(value) || !Array.isArray(value.jobs)) return undefined;
  const statuses = new Set([
    'pending',
    'running',
    'completed',
    'failed',
    'stopped',
    'not_applicable',
  ]);
  const jobs: FlowSubflowWaveProgress['jobs'] = [];
  for (const job of value.jobs) {
    if (!isRecord(job)) return undefined;
    const instanceId = normalizeOptionalString(job.instanceId);
    const flowName = normalizeOptionalString(job.flowName);
    const title = normalizeOptionalString(job.title);
    const status = normalizeOptionalString(job.status);
    if (
      !instanceId ||
      !flowName ||
      !title ||
      !status ||
      !statuses.has(status)
    ) {
      return undefined;
    }
    jobs.push({
      instanceId,
      flowName,
      ...(normalizeOptionalString(job.targetId)
        ? { targetId: normalizeOptionalString(job.targetId) }
        : {}),
      ...(normalizeOptionalString(job.conversationId)
        ? { conversationId: normalizeOptionalString(job.conversationId) }
        : {}),
      ...(normalizeOptionalString(job.reason)
        ? { reason: normalizeOptionalString(job.reason) }
        : {}),
      title,
      status: status as FlowSubflowWaveProgress['jobs'][number]['status'],
    });
  }
  const count = (key: string) =>
    typeof value[key] === 'number' && Number.isInteger(value[key])
      ? Math.max(0, value[key] as number)
      : 0;
  return {
    stepPath: normalizeNumberArray(value.stepPath),
    ...(normalizeOptionalString(value.label)
      ? { label: normalizeOptionalString(value.label) }
      : {}),
    expected: count('expected'),
    running: count('running'),
    completed: count('completed'),
    failed: count('failed'),
    stopped: count('stopped'),
    notApplicable: count('notApplicable'),
    jobs,
    updatedAt:
      normalizeOptionalString(value.updatedAt) ?? new Date(0).toISOString(),
  };
};

const parseFlowResumeState = (
  flags: Record<string, unknown> | undefined,
): FlowResumeState | null => {
  const flow = flags?.flow;
  if (!isRecord(flow)) return null;
  const executionId =
    typeof flow.executionId === 'string' && flow.executionId.trim().length > 0
      ? flow.executionId.trim()
      : undefined;
  const waveInvocationGeneration =
    typeof flow.waveInvocationGeneration === 'number' &&
    Number.isInteger(flow.waveInvocationGeneration) &&
    flow.waveInvocationGeneration > 0
      ? flow.waveInvocationGeneration
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
  const retryOwnershipPending = parseFreshRunRetryOwnershipPending(
    flow.retryOwnershipPending,
  );
  const retryOwnershipCompletion = parseFreshRunRetryOwnershipCompletion(
    flow.retryOwnershipCompletion,
  );
  const wait = parseFlowWaitState(flow.wait);
  const githubReviewContext = parseFlowGitHubReviewContext(
    flow.githubReviewContext,
  );
  const activeSubflows = normalizeActiveSubflows({
    activeSubflows: flow.activeSubflows,
    legacyActiveSubflow: (flow as { activeSubflow?: unknown }).activeSubflow,
  });
  const persistedActiveSubflows = Array.isArray(flow.activeSubflows)
    ? flow.activeSubflows
    : [(flow as { activeSubflow?: unknown }).activeSubflow].filter(
        (item) => item !== undefined,
      );
  const hasMalformedPersistedChildInput = persistedActiveSubflows.some(
    (item) =>
      isRecord(item) &&
      Object.prototype.hasOwnProperty.call(item, 'input') &&
      item.input !== undefined &&
      !tryNormalizeFlowInput(item.input),
  );
  if (hasMalformedPersistedChildInput) return null;
  const hasPersistedInput = Object.prototype.hasOwnProperty.call(flow, 'input');
  const input = tryNormalizeFlowInput(flow.input);
  if (hasPersistedInput && flow.input !== undefined && !input) return null;
  const hasPersistedValues = Object.prototype.hasOwnProperty.call(
    flow,
    'values',
  );
  const values = tryNormalizeFlowInput(flow.values);
  if (hasPersistedValues && flow.values !== undefined && !values) return null;
  const hasPersistedSubflowWaveProgress = Object.prototype.hasOwnProperty.call(
    flow,
    'subflowWaveProgress',
  );
  const subflowWaveProgress = normalizeSubflowWaveProgress(
    flow.subflowWaveProgress,
  );
  if (
    hasPersistedSubflowWaveProgress &&
    flow.subflowWaveProgress !== undefined &&
    !subflowWaveProgress
  ) {
    return null;
  }
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
  const lastLoopExit = isRecord(flow.lastLoopExit)
    ? (() => {
        const reason = normalizeOptionalString(flow.lastLoopExit.reason);
        const iteration = flow.lastLoopExit.iteration;
        if (
          (reason !== 'break' && reason !== 'max_iterations') ||
          typeof iteration !== 'number' ||
          !Number.isInteger(iteration) ||
          iteration < 1
        ) {
          return null;
        }
        return {
          loopStepPath: normalizeNumberArray(flow.lastLoopExit.loopStepPath),
          iteration,
          reason,
        } as const;
      })()
    : null;
  const restartReconciliation = isRecord(flow.restartReconciliation)
    ? (() => {
        const reconciledAt = normalizeOptionalString(
          flow.restartReconciliation.reconciledAt,
        );
        const interruptedSubflowCount =
          flow.restartReconciliation.interruptedSubflowCount;
        const interruptedWaveRunningCount =
          flow.restartReconciliation.interruptedWaveRunningCount;
        if (
          flow.restartReconciliation.status !== 'interrupted' ||
          !reconciledAt ||
          typeof interruptedSubflowCount !== 'number' ||
          !Number.isInteger(interruptedSubflowCount) ||
          interruptedSubflowCount < 0 ||
          typeof interruptedWaveRunningCount !== 'number' ||
          !Number.isInteger(interruptedWaveRunningCount) ||
          interruptedWaveRunningCount < 0
        ) {
          return null;
        }
        return {
          status: 'interrupted' as const,
          reconciledAt,
          resumeStepPath: normalizeNumberArray(
            flow.restartReconciliation.resumeStepPath,
          ),
          interruptedSubflowCount,
          interruptedWaveRunningCount,
        };
      })()
    : null;
  const runLifecycle = isRecord(flow.runLifecycle)
    ? (() => {
        const status = flow.runLifecycle.status;
        const updatedAt = normalizeOptionalString(flow.runLifecycle.updatedAt);
        return ['running', 'ok', 'warning', 'stopped', 'failed', 'orphaned'].includes(
          String(status),
        ) && updatedAt
          ? {
              status: status as NonNullable<
                FlowResumeState['runLifecycle']
              >['status'],
              updatedAt,
            }
          : null;
      })()
    : null;

  return {
    executionId: executionId ?? crypto.randomUUID(),
    ...(waveInvocationGeneration ? { waveInvocationGeneration } : {}),
    stepPath,
    loopStack,
    ...(lastLoopExit ? { lastLoopExit } : {}),
    ...(restartReconciliation ? { restartReconciliation } : {}),
    ...(pendingLoopControl
      ? {
          pendingLoopControl,
        }
      : {}),
    ...(activeSubflows.length > 0 ? { activeSubflows } : {}),
    ...(subflowWaveProgress ? { subflowWaveProgress } : {}),
    ...(flow.terminalOutcome === 'not_applicable'
      ? { terminalOutcome: 'not_applicable' as const }
      : {}),
    ...(runLifecycle ? { runLifecycle } : {}),
    ...(input ? { input } : {}),
    ...(normalizeOptionalString(flow.inputHash)
      ? { inputHash: normalizeOptionalString(flow.inputHash) }
      : {}),
    ...(values ? { values } : {}),
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
    ...(wait ? { wait } : {}),
    ...(githubReviewContext ? { githubReviewContext } : {}),
    ...(retryOwnershipPending ? { retryOwnershipPending } : {}),
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

const latestAssistantStatusForConversation = async (
  conversationId: string,
): Promise<TurnStatus | null> => {
  if (shouldUseMemoryPersistence()) {
    const turns = memoryTurns.get(conversationId) ?? [];
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn?.role === 'assistant') {
        return turn.status;
      }
    }
    return null;
  }

  const persistedTurns = await listTurns({
    conversationId,
    limit: 10,
  });
  const assistantTurn = persistedTurns.items.find(
    (turn) => turn.role === 'assistant',
  );
  return assistantTurn?.status ?? null;
};

const clearScheduledFlowWait = (conversationId: string) => {
  const scheduled = scheduledFlowWaits.get(conversationId);
  if (!scheduled) return;
  scheduled.handle.cancel();
  scheduledFlowWaits.delete(conversationId);
};

const clearScheduledFlowWaitIfMatches = (
  conversationId: string,
  wait: Pick<FlowWaitState, 'executionId' | 'resumeAt' | 'stepPath'>,
) => {
  const scheduled = scheduledFlowWaits.get(conversationId);
  if (
    !scheduled ||
    scheduled.executionId !== wait.executionId ||
    scheduled.resumeAt !== wait.resumeAt ||
    getStepPathKey(scheduled.stepPath) !== getStepPathKey(wait.stepPath)
  ) {
    return false;
  }
  scheduled.handle.cancel();
  scheduledFlowWaits.delete(conversationId);
  return true;
};

type ScheduledFlowWaitIdentity = Pick<
  FlowWaitState,
  'executionId' | 'resumeAt' | 'stepPath'
>;

const rearmPersistedWaitRecoveryOwnership = async (params: {
  conversation: Conversation;
  persistedState: FlowResumeState;
  persistedWait: FlowWaitState;
  flowName: string;
  source: 'REST' | 'MCP';
  recoveryReason: string;
}) => {
  const nextResumeAt = Math.max(
    flowWaitResumeDeps.now() + 1_000,
    params.persistedWait.resumeAt + 1_000,
  );
  const rearmedWait: FlowWaitState = {
    ...cloneFlowWaitState(params.persistedWait),
    resumeAt: nextResumeAt,
  };
  const nextFlowState: FlowResumeState = {
    ...params.persistedState,
    stepPath: [...params.persistedState.stepPath],
    loopStack: params.persistedState.loopStack.map((frame) => ({
      loopStepPath: [...frame.loopStepPath],
      iteration: frame.iteration,
    })),
    ...(params.persistedState.pendingLoopControl
      ? {
          pendingLoopControl: {
            kind: params.persistedState.pendingLoopControl.kind,
            loopStepPath: [
              ...params.persistedState.pendingLoopControl.loopStepPath,
            ],
          },
        }
      : {}),
    ...(params.persistedState.activeSubflows &&
    params.persistedState.activeSubflows.length > 0
      ? {
          activeSubflows: cloneActiveSubflows(
            params.persistedState.activeSubflows,
          ),
        }
      : {}),
    wait: rearmedWait,
  };

  if (shouldUseMemoryPersistence()) {
    updateMemoryConversationMeta(params.conversation._id, {
      flags: {
        ...(params.conversation.flags ?? {}),
        flow: nextFlowState,
      },
    });
  } else {
    await updateConversationFlowState({
      conversationId: params.conversation._id,
      flow: nextFlowState,
    });
  }

  schedulePersistedWaitResume({
    conversationId: params.conversation._id,
    flowName: params.flowName,
    source: params.source,
    wait: rearmedWait,
  });

  append({
    level: 'warn',
    message: 'flows.wait.resume.rearmed_after_preflight_failure',
    timestamp: flowWaitResumeDeps.nowIso(),
    source: 'server',
    context: {
      conversationId: params.conversation._id,
      flowName: params.flowName,
      stepPath: rearmedWait.stepPath,
      previousResumeAt: params.persistedWait.resumeAt,
      nextResumeAt,
      recoveryReason: params.recoveryReason,
    },
  });
};

const clearPersistedWaitStateIfPresent = async (conversationId: string) => {
  clearScheduledFlowWait(conversationId);
  const conversation = await getConversation(conversationId);
  if (!conversation) return;
  const flow = conversation.flags?.flow;
  if (!isRecord(flow) || !isRecord(flow.wait)) return;
  const nextFlow = { ...flow } as Record<string, unknown>;
  delete nextFlow.wait;
  if (shouldUseMemoryPersistence()) {
    updateMemoryConversationMeta(conversationId, {
      flags: {
        ...(conversation.flags ?? {}),
        flow: nextFlow,
      },
    });
    return;
  }
  await updateConversationFlowState({
    conversationId,
    flow: nextFlow as FlowResumeState,
  });
};

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

const getFlowChildWaveIdentity = (
  conversation: Conversation | null | undefined,
): {
  executionId: string;
  instanceId: string;
  waveInvocationId: string;
} | null => {
  const flags = conversation?.flags;
  const flowChild = isRecord(flags?.flowChild) ? flags.flowChild : null;
  const executionId = normalizeOptionalString(flowChild?.executionId);
  const instanceId = normalizeOptionalString(flowChild?.instanceId);
  const waveInvocationId = normalizeOptionalString(flowChild?.waveInvocationId);
  return executionId && instanceId && waveInvocationId
    ? { executionId, instanceId, waveInvocationId }
    : null;
};

const findFlowWaveChildren = async (params: {
  executionId: string;
  waveInvocationId: string;
  instanceIds: string[];
}): Promise<Conversation[]> => {
  const instanceIds = new Set(params.instanceIds);
  const matchesParentWave = (conversation: Conversation) => {
    const identity = getFlowChildWaveIdentity(conversation);
    return (
      identity?.executionId === params.executionId &&
      identity.waveInvocationId === params.waveInvocationId &&
      instanceIds.has(identity.instanceId)
    );
  };

  if (shouldUseMemoryPersistence()) {
    return Array.from(memoryConversations.values()).filter(matchesParentWave);
  }

  const conversations = (await ConversationModel.find({
    'flags.flowChild.executionId': params.executionId,
    'flags.flowChild.waveInvocationId': params.waveInvocationId,
    'flags.flowChild.instanceId': { $in: params.instanceIds },
  })
    .lean()
    .exec()) as Conversation[];
  return conversations.filter(matchesParentWave);
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

const defaultFlowWaitResumeDeps: FlowWaitResumeDeps = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
  scheduleWake: ({ resumeAt, onWake }) => {
    const delayMs = Math.max(resumeAt - Date.now(), 0);
    const timeout = scheduleTimeout(() => {
      onWake();
    }, delayMs);
    timeout.unref?.();
    return {
      cancel: () => clearTimeout(timeout),
    };
  },
  loadConversation: getConversation,
  loadLatestAssistantStatus: latestAssistantStatusForConversation,
  resumeFlowRun: async (params) =>
    await startFlowRun({
      flowName: params.flowName,
      conversationId: params.conversationId,
      resumeStepPath: params.resumeStepPath,
      sourceId: params.sourceId,
      source: params.source,
    }),
};

const flowWaitResumeDeps: FlowWaitResumeDeps = {
  ...defaultFlowWaitResumeDeps,
};

const scheduledFlowWaits = new Map<
  string,
  {
    executionId: string;
    resumeAt: number;
    stepPath: number[];
    handle: ScheduledWaitHandle;
  }
>();

const cloneFlowWaitState = (wait: FlowWaitState): FlowWaitState => ({
  kind: wait.kind ?? 'authored_wait',
  executionId: wait.executionId,
  stepPath: [...wait.stepPath],
  loopStack: wait.loopStack.map((frame) => ({
    loopStepPath: [...frame.loopStepPath],
    iteration: frame.iteration,
  })),
  ...(wait.activeSubflows && wait.activeSubflows.length > 0
    ? {
        activeSubflows: cloneActiveSubflows(wait.activeSubflows),
      }
    : {}),
  ...(wait.workingFolder ? { workingFolder: wait.workingFolder } : {}),
  ...(wait.sourceId ? { sourceId: wait.sourceId } : {}),
  resumeAt: wait.resumeAt,
  ...(wait.continuedAfterFailure ? { continuedAfterFailure: true } : {}),
  ...(wait.githubReviewContext
    ? {
        githubReviewContext: {
          ...wait.githubReviewContext,
        },
      }
    : {}),
});

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

export function __setFlowWaitResumeDepsForTests(
  overrides: Partial<FlowWaitResumeDeps>,
) {
  Object.assign(flowWaitResumeDeps, overrides);
}

export function __resetFlowWaitResumeDepsForTests() {
  Object.assign(flowWaitResumeDeps, defaultFlowWaitResumeDeps);
  for (const scheduled of scheduledFlowWaits.values()) {
    scheduled.handle.cancel();
  }
  scheduledFlowWaits.clear();
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
  parentWave?: FlowRunStartParams['parentWave'];
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
        flags: {
          ...(existing.flags ?? {}),
          ...(params.parentWave ? { flowChild: params.parentWave } : {}),
        },
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
      flags: {
        ...(params.workingFolder
          ? { workingFolder: params.workingFolder }
          : {}),
        ...(params.parentWave ? { flowChild: params.parentWave } : {}),
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
    flags: {
      ...(params.workingFolder ? { workingFolder: params.workingFolder } : {}),
      ...(params.parentWave ? { flowChild: params.parentWave } : {}),
    },
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

const flowsDirForRun = resolveConfiguredFlowsRoot;

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
  const entry = await getFlowDefinitionCatalogEntry({
    flowsRoot: params.flowsRoot,
    flowName: params.flowName,
  });
  if (!entry) throw toFlowRunError('FLOW_NOT_FOUND');
  if (!entry.parsed?.ok) {
    throw toFlowRunError('FLOW_INVALID');
  }

  return structuredClone(entry.parsed.flow);
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
  diagnosticsContext?: Record<string, unknown>;
}) => {
  let latestRuntimeDiagnostic:
    | { message: string; context: Record<string, unknown> }
    | undefined;
  const emitRuntimeDiagnostic = (
    message: string,
    context: Record<string, unknown>,
  ) => {
    latestRuntimeDiagnostic = { message, context };
    appendFlowRuntimeDiagnostic(message, context);
  };

  emitRuntimeDiagnostic('flows.test.runtime_resolution_entry', {
    ...(params.diagnosticsContext ?? {}),
    agentName: params.agentName,
    configPath: params.configPath,
    workingFolder: params.workingFolder ?? null,
    defaultRepositoryRoot: params.defaultRepositoryRoot ?? null,
    source: params.source ?? null,
    pinnedProviderId: params.pinnedProviderId ?? null,
    pinnedModelId: params.pinnedModelId ?? null,
    pinnedRequestedProviderId: params.pinnedRequestedProviderId ?? null,
    pinnedEndpointId: params.pinnedEndpointId ?? null,
    allowFallback: params.allowFallback ?? true,
    timeoutMs: FLOW_RUNTIME_RESOLUTION_TIMEOUT_MS,
  });
  try {
    emitRuntimeDiagnostic('flows.test.runtime_resolution_prepare_begin', {
      ...(params.diagnosticsContext ?? {}),
      agentName: params.agentName,
      source: params.source ?? null,
      pinnedProviderId: params.pinnedProviderId ?? null,
      pinnedModelId: params.pinnedModelId ?? null,
      timeoutMs: FLOW_RUNTIME_RESOLUTION_TIMEOUT_MS,
    });
    const resolved = await withTimeout({
      promise: prepareFlowOwnedAgentExecution({
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
        diagnostics: {
          emit: emitRuntimeDiagnostic,
          baseContext: params.diagnosticsContext,
        },
      }),
      timeoutMs: FLOW_RUNTIME_RESOLUTION_TIMEOUT_MS,
      onTimeout: () => {
        const timeoutDiagnostic = {
          ...(params.diagnosticsContext ?? {}),
          agentName: params.agentName,
          configPath: params.configPath,
          workingFolder: params.workingFolder ?? null,
          defaultRepositoryRoot: params.defaultRepositoryRoot ?? null,
          source: params.source ?? null,
          pinnedProviderId: params.pinnedProviderId ?? null,
          pinnedModelId: params.pinnedModelId ?? null,
          pinnedRequestedProviderId: params.pinnedRequestedProviderId ?? null,
          pinnedEndpointId: params.pinnedEndpointId ?? null,
          timeoutMs: FLOW_RUNTIME_RESOLUTION_TIMEOUT_MS,
          latestRuntimeDiagnostic: latestRuntimeDiagnostic ?? null,
        };
        appendFlowRuntimeDiagnostic(
          'flows.test.runtime_resolution_timeout',
          timeoutDiagnostic,
        );
        console.error(
          'flows.test.runtime_resolution_timeout_diagnostic',
          JSON.stringify(timeoutDiagnostic),
        );
      },
      timeoutErrorFactory: () =>
        toFlowRunError(
          'PROVIDER_UNAVAILABLE',
          `Flow runtime resolution timed out after ${FLOW_RUNTIME_RESOLUTION_TIMEOUT_MS}ms for agent ${params.agentName}.`,
          'RUNTIME_RESOLUTION_TIMEOUT',
        ),
    });
    appendFlowRuntimeDiagnostic(
      'flows.test.runtime_resolution_prepare_complete',
      {
        ...(params.diagnosticsContext ?? {}),
        agentName: params.agentName,
        source: params.source ?? null,
        executionProviderId: resolved.executionProviderId,
        requestedProviderId: resolved.requestedProviderId ?? null,
        modelId: resolved.modelId ?? null,
        endpointId: resolved.endpointId ?? null,
        warningCount: resolved.warnings?.length ?? 0,
        workingDirectoryOverride: resolved.workingDirectoryOverride ?? null,
      },
    );
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
    appendFlowRuntimeDiagnostic('flows.test.runtime_resolution_failed', {
      ...(params.diagnosticsContext ?? {}),
      agentName: params.agentName,
      source: params.source ?? null,
      code:
        error &&
        typeof error === 'object' &&
        typeof (error as { code?: unknown }).code === 'string'
          ? String((error as { code?: string }).code)
          : null,
      reason:
        error &&
        typeof error === 'object' &&
        typeof (error as { reason?: unknown }).reason === 'string'
          ? String((error as { reason?: string }).reason)
          : error instanceof Error
            ? error.message
            : String(error ?? 'unknown error'),
      causeCode:
        error &&
        typeof error === 'object' &&
        typeof (error as { causeCode?: unknown }).causeCode === 'string'
          ? String((error as { causeCode?: string }).causeCode)
          : null,
    });
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

const isTerminalFlowStatus = (status: TurnStatus): boolean =>
  status === 'warning' || status === 'stopped' || status === 'failed';

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
    | FlowIfStep
    | FlowCommandStep
    | FlowResetStep
    | FlowInitializeReviewCycleStep
    | FlowPrepareReviewTargetsStep
    | FlowPrepareCopilotReviewGroupsStep
    | FlowRunCopilotReviewStep
    | FlowSubflowStep
    | FlowSubflowWaveStep
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
  failureKind?: 'execution' | 'invalid_response';
  usage?: TurnUsageMetadata;
  timing?: TurnTimingMetadata;
};

type FlowInstructionPostProcess = (result: FlowInstructionResult) => {
  status?: TurnStatus;
  content?: string;
  failureKind?: 'execution' | 'invalid_response';
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
  const existingTurnCount = memoryTurns.get(params.conversationId)?.length ?? 0;
  if (
    flowRuntimeDiagnosticsEnabled &&
    params.command?.name === 'flow' &&
    existingTurnCount < 2
  ) {
    appendFlowRuntimeDiagnostic('flows.test.first_turn_persist_begin', {
      conversationId: params.conversationId,
      role: params.role,
      status: params.status,
      stepIndex: params.command.stepIndex,
      contentPreview: params.content.slice(0, 120),
    });
  }
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
    if (
      flowRuntimeDiagnosticsEnabled &&
      params.command?.name === 'flow' &&
      existingTurnCount < 2
    ) {
      appendFlowRuntimeDiagnostic('flows.test.first_turn_persisted', {
        conversationId: params.conversationId,
        role: params.role,
        status: params.status,
        stepIndex: params.command.stepIndex,
        turnCountAfterPersist:
          memoryTurns.get(params.conversationId)?.length ??
          existingTurnCount + 1,
        contentPreview: params.content.slice(0, 120),
      });
    }
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

  if (
    flowRuntimeDiagnosticsEnabled &&
    params.command?.name === 'flow' &&
    existingTurnCount < 2
  ) {
    appendFlowRuntimeDiagnostic('flows.test.first_turn_persist_complete', {
      conversationId: params.conversationId,
      role: params.role,
      status: params.status,
      stepIndex: params.command.stepIndex,
      turnId: turnId ?? null,
      contentPreview: params.content.slice(0, 120),
    });
  }

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

  appendFlowRuntimeDiagnostic('flows.test.first_turn_publish_begin', {
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    stepIndex:
      params.command?.name === 'flow' ? params.command.stepIndex : null,
    instructionPreview: params.instruction.slice(0, 120),
    phase: 'runFlowInstructionUnlocked',
  });
  publishUserTurn({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    content: params.instruction,
    createdAt: createdAtIso,
  });
  appendFlowRuntimeDiagnostic('flows.test.first_turn_publish_complete', {
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    stepIndex:
      params.command?.name === 'flow' ? params.command.stepIndex : null,
    instructionPreview: params.instruction.slice(0, 120),
    phase: 'runFlowInstructionUnlocked',
  });

  const resolvedChatFactory = params.chatFactory ?? getChatInterface;
  let chat;
  try {
    appendFlowRuntimeDiagnostic('flows.test.chat_factory_begin', {
      conversationId: params.flowConversationId,
      inflightId: params.inflightId,
      providerId: params.providerId,
      phase: 'runFlowInstructionUnlocked',
    });
    chat = resolvedChatFactory(
      params.providerId,
      params.providerId === 'copilot'
        ? { copilotEnv: { ...process.env, ...params.envOverrides } }
        : undefined,
    );
    appendFlowRuntimeDiagnostic('flows.test.chat_factory_complete', {
      conversationId: params.flowConversationId,
      inflightId: params.inflightId,
      providerId: params.providerId,
      phase: 'runFlowInstructionUnlocked',
    });
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
      appendFlowRuntimeDiagnostic('flows.test.chat_run_begin', {
        conversationId: params.flowConversationId,
        inflightId: params.inflightId,
        agentConversationId: params.agentConversationId,
        threadId: params.threadId ?? null,
        providerId: params.providerId,
        modelId: params.modelId,
      });
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
      appendFlowRuntimeDiagnostic('flows.test.chat_run_complete', {
        conversationId: params.flowConversationId,
        inflightId: params.inflightId,
        agentConversationId: params.agentConversationId,
        threadId: params.threadId ?? null,
        providerId: params.providerId,
        modelId: params.modelId,
      });
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
  if (postProcessed?.failureKind) {
    result.failureKind = postProcessed.failureKind;
  }

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

export type FlowChildLifecycleStatus =
  | NonNullable<FlowResumeState['runLifecycle']>['status']
  | 'missing';

const isTerminalFlowChildLifecycleStatus = (
  status: FlowChildLifecycleStatus,
): status is Extract<
  FlowChildLifecycleStatus,
  'ok' | 'warning' | 'failed' | 'stopped'
> =>
  status === 'ok' ||
  status === 'warning' ||
  status === 'failed' ||
  status === 'stopped';

const normalizeFlowChildTurnStatus = (
  status: TurnStatus | undefined,
): FlowChildLifecycleStatus =>
  status === 'warning' ? 'ok' : (status ?? 'missing');

export const getFlowConversationLifecycleStatus = async (params: {
  conversationId: string;
  runToken: string;
}): Promise<FlowChildLifecycleStatus> => {
  const activeOwnership = getActiveRunOwnership(params.conversationId);
  if (activeOwnership && activeOwnership.runToken !== params.runToken) {
    throw toFlowRunError(
      'INVALID_REQUEST',
      `Subflow conversation ${params.conversationId} is now owned by a different run.`,
    );
  }

  const conversation = await getConversation(params.conversationId);
  const resumeState = parseFlowResumeState(
    isRecord(conversation?.flags)
      ? (conversation.flags as Record<string, unknown>)
      : undefined,
  );
  if (resumeState?.restartReconciliation?.status === 'interrupted') {
    return 'orphaned';
  }
  if (resumeState?.runLifecycle) {
    if (resumeState.runLifecycle.status === 'running' && !activeOwnership) {
      return 'orphaned';
    }
    return resumeState.runLifecycle.status;
  }

  if (activeOwnership?.runToken === params.runToken) {
    return 'running';
  }

  if (shouldUseMemoryPersistence()) {
    const turns = memoryTurns.get(params.conversationId) ?? [];
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn?.role === 'assistant') {
        return normalizeFlowChildTurnStatus(turn.status);
      }
    }
    return 'missing';
  }

  const persistedTurns = await listTurns({
    conversationId: params.conversationId,
    limit: 10,
  });
  const assistantTurn = persistedTurns.items.find(
    (turn) => turn.role === 'assistant',
  );
  return normalizeFlowChildTurnStatus(assistantTurn?.status);
};

const getFlowConversationTerminalOutcome = async (
  conversationId: string,
): Promise<FlowResumeState['terminalOutcome']> => {
  const conversation = await getConversation(conversationId);
  const flow = isRecord(conversation?.flags?.flow)
    ? conversation.flags.flow
    : undefined;
  return flow?.terminalOutcome === 'not_applicable'
    ? 'not_applicable'
    : undefined;
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

  if (latestAssistantTurn && isTerminalFlowStatus(latestAssistantTurn.status)) {
    await clearPersistedWaitStateIfPresent(params.conversationId);
    return;
  }

  await clearPersistedWaitStateIfPresent(params.conversationId);
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
  await clearPersistedWaitStateIfPresent(params.flowConversationId);
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
  await clearPersistedWaitStateIfPresent(params.flowConversationId);
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

type FlowTerminalStepParams = {
  flowConversationId: string;
  inflightId: string;
  instruction: string;
  response: string;
  modelId: string;
  providerId?: ConversationProvider;
  source: 'REST' | 'MCP';
  command?: TurnCommandMetadata;
  status: Extract<TurnStatus, 'ok' | 'warning'>;
};

const emitTerminalFlowStep = async (params: FlowTerminalStepParams) => {
  if (params.status === 'warning') {
    await clearPersistedWaitStateIfPresent(params.flowConversationId);
  }
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
    status: params.status,
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
      status: params.status,
    },
  });
  bridge.cleanup();

  cleanupInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
  });
};

const emitWarningFlowStep = async (
  params: Omit<FlowTerminalStepParams, 'response' | 'status'> & {
    message: string;
  },
) =>
  await emitTerminalFlowStep({
    ...params,
    response: params.message,
    status: 'warning',
  });

const emitCompletedFlowStep = async (
  params: Omit<FlowTerminalStepParams, 'status'>,
) => await emitTerminalFlowStep({ ...params, status: 'ok' });

type FlowStepOutcome =
  | TurnStatus
  | 'break'
  | 'continue'
  | 'paused'
  | 'github_review_skipped'
  | 'exit';

type LoopFrame = {
  loopStepPath: number[];
  iteration: number;
};

const cloneActiveSubflow = (
  activeSubflow: FlowActiveSubflow,
): FlowActiveSubflow => ({
  stepPath: [...activeSubflow.stepPath],
  flowName: activeSubflow.flowName,
  conversationId: activeSubflow.conversationId,
  runToken: activeSubflow.runToken,
  ...(activeSubflow.instanceId ? { instanceId: activeSubflow.instanceId } : {}),
  ...(activeSubflow.waveInvocationId
    ? { waveInvocationId: activeSubflow.waveInvocationId }
    : {}),
  ...(activeSubflow.targetId ? { targetId: activeSubflow.targetId } : {}),
  ...(activeSubflow.workingFolder
    ? { workingFolder: activeSubflow.workingFolder }
    : {}),
  ...(activeSubflow.input
    ? { input: structuredClone(activeSubflow.input) }
    : {}),
  ...(activeSubflow.inputHash ? { inputHash: activeSubflow.inputHash } : {}),
  ...(activeSubflow.title ? { title: activeSubflow.title } : {}),
});

const cloneActiveSubflows = (
  activeSubflows: FlowActiveSubflow[] | undefined,
): FlowActiveSubflow[] | undefined =>
  activeSubflows?.map((activeSubflow) => cloneActiveSubflow(activeSubflow));

const getWaveInvocationId = (
  stepPath: number[],
  loopStack: LoopFrame[],
  generation: number,
): string =>
  JSON.stringify({
    stepPath,
    ...(generation > 0 ? { generation } : {}),
    loopStack: loopStack.map((frame) => ({
      loopStepPath: frame.loopStepPath,
      iteration: frame.iteration,
    })),
  });

const buildFlowResumeState = (params: {
  executionId: string;
  waveInvocationGeneration?: number;
  runtimeState: FlowExecutionRuntimeState;
  stepPath: number[];
  loopStack: LoopFrame[];
  lastLoopExit?: FlowResumeState['lastLoopExit'];
  pendingLoopControl?: FlowPendingLoopControl | null;
  wait?: FlowWaitState;
  githubReviewContext?: FlowGitHubReviewContext;
  activeSubflows?: FlowResumeState['activeSubflows'];
  subflowWaveProgress?: FlowSubflowWaveProgress;
  terminalOutcome?: FlowResumeState['terminalOutcome'];
  runLifecycle?: FlowResumeState['runLifecycle'];
  codexReviewModelId?: string;
  workingFolder?: string;
  retryOwnershipPending?: FreshRunRetryOwnershipPending | null;
  retryOwnershipCompletion?: FreshRunRetryOwnershipCompletion | null;
  input?: FlowJsonObject;
  inputHash?: string;
  values?: FlowJsonObject;
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
    ...(params.waveInvocationGeneration
      ? { waveInvocationGeneration: params.waveInvocationGeneration }
      : {}),
    stepPath: [...params.stepPath],
    loopStack: params.loopStack.map((frame) => ({
      loopStepPath: [...frame.loopStepPath],
      iteration: frame.iteration,
    })),
    ...(params.lastLoopExit
      ? {
          lastLoopExit: {
            loopStepPath: [...params.lastLoopExit.loopStepPath],
            iteration: params.lastLoopExit.iteration,
            reason: params.lastLoopExit.reason,
          },
        }
      : {}),
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
          activeSubflows: cloneActiveSubflows(params.activeSubflows),
        }
      : {}),
    ...(params.wait
      ? {
          wait: {
            kind: params.wait.kind ?? 'authored_wait',
            executionId: params.wait.executionId,
            stepPath: [...params.wait.stepPath],
            loopStack: params.wait.loopStack.map((frame) => ({
              loopStepPath: [...frame.loopStepPath],
              iteration: frame.iteration,
            })),
            ...(params.wait.activeSubflows &&
            params.wait.activeSubflows.length > 0
              ? {
                  activeSubflows: cloneActiveSubflows(
                    params.wait.activeSubflows,
                  ),
                }
              : {}),
            ...(params.wait.workingFolder
              ? { workingFolder: params.wait.workingFolder }
              : {}),
            ...(params.wait.sourceId ? { sourceId: params.wait.sourceId } : {}),
            resumeAt: params.wait.resumeAt,
            ...(params.wait.continuedAfterFailure
              ? { continuedAfterFailure: true }
              : {}),
            ...(params.wait.githubReviewContext
              ? {
                  githubReviewContext: {
                    ...params.wait.githubReviewContext,
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(params.githubReviewContext
      ? { githubReviewContext: { ...params.githubReviewContext } }
      : {}),
    ...(params.subflowWaveProgress
      ? { subflowWaveProgress: params.subflowWaveProgress }
      : {}),
    ...(params.terminalOutcome
      ? { terminalOutcome: params.terminalOutcome }
      : {}),
    ...(params.runLifecycle ? { runLifecycle: params.runLifecycle } : {}),
    ...(params.codexReviewModelId
      ? { codexReviewModelId: params.codexReviewModelId }
      : {}),
    ...(params.workingFolder ? { workingFolder: params.workingFolder } : {}),
    ...(params.input ? { input: params.input } : {}),
    ...(params.inputHash ? { inputHash: params.inputHash } : {}),
    ...(params.values ? { values: params.values } : {}),
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
    ...(params.retryOwnershipPending
      ? {
          retryOwnershipPending: {
            ...params.retryOwnershipPending,
            result: cloneFlowRunStartResult(
              params.retryOwnershipPending.result,
            ),
          },
        }
      : {}),
    ...(params.retryOwnershipCompletion
      ? {
          retryOwnershipCompletion: {
            ...params.retryOwnershipCompletion,
            result: cloneFlowRunStartResult(
              params.retryOwnershipCompletion.result,
            ),
          },
        }
      : {}),
  };
};

const persistFlowResumeState = async (params: {
  conversationId: string;
  executionId: string;
  waveInvocationGeneration?: number;
  runtimeState: FlowExecutionRuntimeState;
  stepPath: number[];
  loopStack: LoopFrame[];
  lastLoopExit?: FlowResumeState['lastLoopExit'];
  pendingLoopControl?: FlowPendingLoopControl | null;
  wait?: FlowWaitState;
  githubReviewContext?: FlowGitHubReviewContext;
  activeSubflows?: FlowResumeState['activeSubflows'];
  subflowWaveProgress?: FlowSubflowWaveProgress;
  terminalOutcome?: FlowResumeState['terminalOutcome'];
  runLifecycle?: FlowResumeState['runLifecycle'];
  codexReviewModelId?: string;
  workingFolder?: string;
  retryOwnershipPending?: FreshRunRetryOwnershipPending | null;
  retryOwnershipCompletion?: FreshRunRetryOwnershipCompletion | null;
  input?: FlowJsonObject;
  inputHash?: string;
  values?: FlowJsonObject;
}) => {
  const flowState = buildFlowResumeState({
    executionId: params.executionId,
    waveInvocationGeneration: params.waveInvocationGeneration,
    runtimeState: params.runtimeState,
    stepPath: params.stepPath,
    loopStack: params.loopStack,
    lastLoopExit: params.lastLoopExit,
    pendingLoopControl: params.pendingLoopControl,
    wait: params.wait,
    githubReviewContext: params.githubReviewContext,
    activeSubflows: params.activeSubflows,
    subflowWaveProgress: params.subflowWaveProgress,
    terminalOutcome: params.terminalOutcome,
    runLifecycle: params.runLifecycle,
    codexReviewModelId: params.codexReviewModelId,
    workingFolder: params.workingFolder,
    retryOwnershipPending: params.retryOwnershipPending,
    retryOwnershipCompletion: params.retryOwnershipCompletion,
    input: params.input,
    inputHash: params.inputHash,
    values: params.values,
  });
  const existingConversation = await getConversation(params.conversationId);
  const existingFlowState = parseFlowResumeState(
    isRecord(existingConversation?.flags)
      ? (existingConversation.flags as Record<string, unknown>)
      : undefined,
  );
  if (
    params.retryOwnershipPending === undefined &&
    existingFlowState?.retryOwnershipPending
  ) {
    flowState.retryOwnershipPending = existingFlowState.retryOwnershipPending;
  }
  if (
    params.retryOwnershipCompletion === undefined &&
    existingFlowState?.retryOwnershipCompletion
  ) {
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
  appendFlowRuntimeDiagnostic('flows.test.resume_state_saved', {
    conversationId: params.conversationId,
    executionId: params.executionId,
    stepPath: params.stepPath,
    loopDepth: params.loopStack.length,
    hasPendingLoopControl: Boolean(params.pendingLoopControl),
    hasWait: Boolean(params.wait),
    activeSubflowCount: params.activeSubflows?.length ?? 0,
    agentConversationCount: params.runtimeState.size,
    activeSubflowConversationIds:
      params.activeSubflows?.map((subflow) => subflow.conversationId) ?? [],
    agentConversationKeys: Array.from(params.runtimeState.keys()),
    workingFolder: params.workingFolder ?? null,
  });
};

const persistFlowRunLifecycleStatus = async (
  conversationId: string,
  status: NonNullable<FlowResumeState['runLifecycle']>['status'],
) => {
  const conversation = await getConversation(conversationId);
  const flowState = parseFlowResumeState(
    isRecord(conversation?.flags)
      ? (conversation.flags as Record<string, unknown>)
      : undefined,
  );
  if (!flowState) return;
  const updated = {
    ...flowState,
    runLifecycle: { status, updatedAt: new Date().toISOString() },
  } satisfies FlowResumeState;
  if (shouldUseMemoryPersistence()) {
    const existing = memoryConversations.get(conversationId);
    if (existing) {
      updateMemoryConversationMeta(conversationId, {
        flags: { ...(existing.flags ?? {}), flow: updated },
      });
    }
    return;
  }
  await updateConversationFlowState({ conversationId, flow: updated });
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

type FlowDecisionKind = 'break' | 'continue' | 'if';

const MAX_BREAK_PARSE_SCAN_LENGTH = 20_000;
const MAX_BREAK_PARSE_CANDIDATES = 100;
const FLOW_DECISION_SCRIPT_TIMEOUT_MS = 1000;
const GITHUB_REVIEW_RECOVERY_MAX_ATTEMPTS = 3;

const getFlowDecisionLabel = (kind: FlowDecisionKind) =>
  kind === 'break' ? 'Break' : kind === 'continue' ? 'Continue' : 'If';

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

export const parseIfAnswer = (content: string) =>
  parseFlowDecisionAnswer('if', content);

export const parseScriptFlowDecisionAnswer = (
  kind: FlowDecisionKind,
  content: string,
): BreakParseSuccess | BreakParseFailure => {
  const candidate = content.trim();
  const parsed = tryParseFlowDecisionCandidate(kind, candidate);
  if (!parsed.ok) {
    return {
      ok: false,
      message: parsed.message,
      attempts: [{ strategy: 'strict', candidateCount: 1 }],
      reasonCode:
        parsed.errorKind === 'schema' ? 'INVALID_SCHEMA' : 'NO_VALID_CANDIDATE',
    };
  }
  return {
    ok: true,
    answer: parsed.answer,
    normalizedContent: JSON.stringify({ answer: parsed.answer }),
    attempts: [{ strategy: 'strict', candidateCount: 1 }],
    reasonCode: 'ANSWER_FOUND',
  };
};

const isPathContainedWithinRoot = (rootPath: string, targetPath: string) => {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return (
    relative.length === 0 ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
};

export const __readCurrentPlanStoryContextForTests = async (params: {
  workingRepositoryRoot?: string;
  defaultRepositoryRoot?: string;
}) => {
  const workingRepositoryRoot =
    params.workingRepositoryRoot ?? params.defaultRepositoryRoot;
  if (!workingRepositoryRoot) {
    return null;
  }
  const currentPlanPath = path.join(
    workingRepositoryRoot,
    'codeInfoStatus/flow-state/current-plan.json',
  );
  try {
    const raw = await fs.readFile(currentPlanPath, 'utf8');
    const parsed = JSON.parse(raw) as { plan_path?: unknown };
    const planPath =
      typeof parsed.plan_path === 'string' && parsed.plan_path.trim().length > 0
        ? parsed.plan_path.trim()
        : undefined;
    if (!planPath) return null;
    const resolvedWorkingRepositoryRoot = await fs.realpath(
      workingRepositoryRoot,
    );
    const planFullPath = path.resolve(resolvedWorkingRepositoryRoot, planPath);
    const resolvedPlanFullPath = await fs.realpath(planFullPath);
    if (
      !isPathContainedWithinRoot(
        resolvedWorkingRepositoryRoot,
        resolvedPlanFullPath,
      )
    ) {
      return null;
    }
    const storyNumberMatch = path.basename(planPath).match(/^(\d+)/u);
    const storyNumber = storyNumberMatch?.[1];
    const planRaw = await fs.readFile(resolvedPlanFullPath, 'utf8');
    const headingMatch = planRaw.match(/^#\s+Story\s+\d+\s+-\s+(.+)$/mu);
    const title =
      headingMatch?.[1]?.trim() ||
      path.basename(planPath, '.md').replace(/^\d+-/u, '').replace(/-/gu, ' ');
    const storyRationale = (planRaw.split(/^### Description\s*$/mu)[1] ?? '')
      .split(/^###\s/mu)[0]
      ?.split(/\n\s*\n/u)
      .filter(Boolean)
      .slice(0, 2)
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 1200);
    let implementationSummary: string[] = [];
    if (storyNumber) {
      const prSummaryPath = path.join(
        workingRepositoryRoot,
        'codeInfoStatus/pr-summaries',
        `${storyNumber}-pr-summary.md`,
      );
      const prSummaryRaw = await fs
        .readFile(prSummaryPath, 'utf8')
        .catch(() => '');
      const finalSummarySection =
        (prSummaryRaw.split(/^## Final Summary\s*$/mu)[1] ?? '')
          .split(/^##\s/mu)[0]
          ?.trim() ?? '';
      implementationSummary = [
        ...finalSummarySection.matchAll(/^\d+\.\s+(.+)$/gmu),
      ]
        .map((match) => match[1]?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 4)
        .map((item) => item.slice(0, 600));
    }
    return {
      workingRepositoryRoot,
      planPath,
      storyNumber,
      title,
      ...(storyRationale ? { storyRationale } : {}),
      ...(implementationSummary.length > 0 ? { implementationSummary } : {}),
    };
  } catch {
    return null;
  }
};

const schedulePersistedWaitResume = (params: {
  conversationId: string;
  flowName: string;
  source: 'REST' | 'MCP';
  wait: FlowWaitState;
  replaceOnlyIfMatches?: ScheduledFlowWaitIdentity;
}): boolean => {
  const appendWaitWakeDiagnostic = (
    event: string,
    context: Record<string, unknown> = {},
  ) => {
    appendFlowRuntimeDiagnostic('flows.test.wait_wake_runtime', {
      event,
      conversationId: params.conversationId,
      flowName: params.flowName,
      executionId: params.wait.executionId,
      stepPath: params.wait.stepPath,
      resumeAt: params.wait.resumeAt,
      ...context,
    });
  };
  if (params.replaceOnlyIfMatches) {
    if (
      !clearScheduledFlowWaitIfMatches(
        params.conversationId,
        params.replaceOnlyIfMatches,
      )
    ) {
      appendWaitWakeDiagnostic('wake_rearm_skipped_scheduler_replaced');
      return false;
    }
  } else {
    clearScheduledFlowWait(params.conversationId);
  }
  const handle = flowWaitResumeDeps.scheduleWake({
    resumeAt: params.wait.resumeAt,
    onWake: () => {
      void (async () => {
        appendWaitWakeDiagnostic('wake_begin');
        const conversation = await flowWaitResumeDeps.loadConversation(
          params.conversationId,
        );
        if (!conversation || conversation.flowName !== params.flowName) {
          appendWaitWakeDiagnostic('wake_skipped_conversation_mismatch', {
            conversationFound: Boolean(conversation),
            persistedFlowName: conversation?.flowName ?? null,
          });
          clearScheduledFlowWaitIfMatches(params.conversationId, params.wait);
          return;
        }
        const persistedState = parseFlowResumeState(
          (conversation.flags ?? undefined) as
            | Record<string, unknown>
            | undefined,
        );
        const persistedWait = persistedState?.wait;
        appendWaitWakeDiagnostic('wake_persisted_state_loaded', {
          hasPersistedState: Boolean(persistedState),
          hasPersistedWait: Boolean(persistedWait),
          persistedExecutionId: persistedWait?.executionId ?? null,
          persistedStepPath: persistedWait?.stepPath ?? null,
        });
        if (!persistedState || !persistedWait) {
          appendWaitWakeDiagnostic('wake_skipped_missing_wait_state');
          clearScheduledFlowWaitIfMatches(params.conversationId, params.wait);
          return;
        }
        if (persistedWait.executionId !== params.wait.executionId) {
          appendWaitWakeDiagnostic('wake_skipped_execution_mismatch', {
            persistedExecutionId: persistedWait.executionId,
          });
          clearScheduledFlowWaitIfMatches(params.conversationId, params.wait);
          return;
        }
        if (
          getStepPathKey(persistedWait.stepPath) !==
          getStepPathKey(params.wait.stepPath)
        ) {
          appendWaitWakeDiagnostic('wake_skipped_step_path_mismatch', {
            persistedStepPath: persistedWait.stepPath,
          });
          clearScheduledFlowWaitIfMatches(params.conversationId, params.wait);
          return;
        }
        const latestAssistantStatus =
          await flowWaitResumeDeps.loadLatestAssistantStatus(
            params.conversationId,
          );
        if (
          params.wait.kind !== 'review_retry' &&
          latestAssistantStatus &&
          isTerminalFlowStatus(latestAssistantStatus) &&
          !persistedWait.continuedAfterFailure
        ) {
          appendWaitWakeDiagnostic('wake_terminal_guard_skip', {
            latestAssistantStatus,
          });
          clearScheduledFlowWaitIfMatches(params.conversationId, params.wait);
          return;
        }
        try {
          appendWaitWakeDiagnostic('wake_resume_dispatch_begin', {
            persistedWorkingFolder: persistedWait.workingFolder ?? null,
            persistedSourceId: persistedWait.sourceId ?? null,
          });
          await flowWaitResumeDeps.resumeFlowRun({
            flowName: params.flowName,
            conversationId: params.conversationId,
            resumeStepPath: persistedWait.stepPath,
            sourceId: persistedWait.sourceId,
            source: params.source,
          });
          appendWaitWakeDiagnostic('wake_resume_dispatch_complete');
          clearScheduledFlowWaitIfMatches(params.conversationId, params.wait);
        } catch (error) {
          if ((error as FlowRunError | undefined)?.code === 'RUN_IN_PROGRESS') {
            appendWaitWakeDiagnostic(
              'wake_resume_dispatch_skipped_run_in_progress',
            );
            baseLogger.info(
              {
                conversationId: params.conversationId,
                flowName: params.flowName,
                waitStepPath: persistedWait.stepPath,
              },
              'flows.wait.resume.skipped_run_in_progress',
            );
            const latestConversation =
              await flowWaitResumeDeps.loadConversation(params.conversationId);
            const latestWait = parseFlowResumeState(
              (latestConversation?.flags ?? undefined) as
                | Record<string, unknown>
                | undefined,
            )?.wait;
            if (
              !latestWait ||
              latestWait.executionId !== persistedWait.executionId ||
              getStepPathKey(latestWait.stepPath) !==
                getStepPathKey(persistedWait.stepPath)
            ) {
              appendWaitWakeDiagnostic(
                'wake_rearm_skipped_wait_advanced_by_active_run',
                {
                  latestExecutionId: latestWait?.executionId ?? null,
                  latestStepPath: latestWait?.stepPath ?? null,
                },
              );
              clearScheduledFlowWaitIfMatches(
                params.conversationId,
                params.wait,
              );
              return;
            }
            schedulePersistedWaitResume({
              conversationId: params.conversationId,
              flowName: params.flowName,
              source: params.source,
              replaceOnlyIfMatches: params.wait,
              wait: {
                ...cloneFlowWaitState(latestWait),
                resumeAt: flowWaitResumeDeps.now() + 1_000,
              },
            });
            return;
          }
          appendWaitWakeDiagnostic('wake_resume_dispatch_failed', {
            code:
              error &&
              typeof error === 'object' &&
              typeof (error as { code?: unknown }).code === 'string'
                ? String((error as { code?: string }).code)
                : null,
            reason:
              error &&
              typeof error === 'object' &&
              typeof (error as { reason?: unknown }).reason === 'string'
                ? String((error as { reason?: string }).reason)
                : error instanceof Error
                  ? error.message
                  : String(error ?? 'unknown error'),
          });
          const recoveryReason = describeFlowRunFailure(error);
          if (isPermanentPersistedWaitResumeFailure(error)) {
            await retirePersistedWaitRecoveryFailure({
              conversationId: params.conversationId,
              modelId: conversation.model,
              providerId: conversation.provider,
              source: params.source,
              flowName: params.flowName,
              waitStepPath: persistedWait.stepPath,
              recoveryReason,
            });
            return;
          }
          try {
            await rearmPersistedWaitRecoveryOwnership({
              conversation,
              persistedState,
              persistedWait,
              flowName: params.flowName,
              source: params.source,
              recoveryReason,
            });
            return;
          } catch (rearmError) {
            const rearmReason =
              rearmError instanceof Error
                ? rearmError.message
                : String(rearmError);
            await persistUnexpectedFlowFailureIfNeeded({
              conversationId: params.conversationId,
              modelId: conversation.model,
              providerId: conversation.provider,
              source: params.source,
              message: `Persisted wait recovery could not resume or rearm ownership: ${recoveryReason}; rearm failed: ${rearmReason}`,
            });
          }
          baseLogger.error(
            {
              conversationId: params.conversationId,
              flowName: params.flowName,
              error,
            },
            'flows.wait.resume.failed',
          );
        }
      })().catch((error) => {
        const recoveryReason =
          error instanceof Error ? error.message : String(error);
        appendWaitWakeDiagnostic('wake_preflight_failed_rearm', {
          recoveryReason,
        });
        baseLogger.warn(
          {
            conversationId: params.conversationId,
            flowName: params.flowName,
            error,
          },
          'flows.wait.wake_preflight_failed_rearm',
        );
        schedulePersistedWaitResume({
          ...params,
          replaceOnlyIfMatches: params.wait,
          wait: {
            ...cloneFlowWaitState(params.wait),
            resumeAt: flowWaitResumeDeps.now() + 1_000,
          },
        });
      });
    },
  });
  scheduledFlowWaits.set(params.conversationId, {
    executionId: params.wait.executionId,
    resumeAt: params.wait.resumeAt,
    stepPath: [...params.wait.stepPath],
    handle,
  });
  return true;
};

export async function __resumePendingFlowWaitsForTests(
  conversationIds?: string[],
) {
  const candidates: Conversation[] = shouldUseMemoryPersistence()
    ? [...memoryConversations.values()]
    : ((await ConversationModel.find({
        flowName: { $exists: true, $ne: null },
        'flags.flow.wait.resumeAt': { $exists: true },
      })
        .lean()
        .exec()) as Conversation[]);
  const candidateIds = conversationIds ? new Set(conversationIds) : null;
  let resumedCandidateCount = 0;
  for (const conversation of candidates) {
    if (candidateIds && !candidateIds.has(conversation._id)) continue;
    if (!conversation.flowName) continue;
    const state = parseFlowResumeState(
      (conversation.flags ?? undefined) as Record<string, unknown> | undefined,
    );
    if (!state?.wait) continue;
    schedulePersistedWaitResume({
      conversationId: conversation._id,
      flowName: conversation.flowName,
      source: conversation.source,
      wait: state.wait,
    });
    resumedCandidateCount += 1;
  }
  return resumedCandidateCount;
}

export async function resumePendingFlowWaitsForStartup(): Promise<FlowWaitStartupRecoveryResult> {
  try {
    const resumedCandidateCount = await __resumePendingFlowWaitsForTests();
    return {
      reachable: true,
      degraded: false,
      resumedCandidateCount,
      diagnosticEvent: null,
    };
  } catch (error) {
    const causeMessage =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : String(error);
    baseLogger.error(
      {
        event: FLOW_WAIT_STARTUP_RECOVERY_DEGRADED_EVENT,
        err: error,
        causeMessage,
      },
      FLOW_WAIT_STARTUP_RECOVERY_DEGRADED_EVENT,
    );
    append({
      level: 'error',
      message: FLOW_WAIT_STARTUP_RECOVERY_DEGRADED_EVENT,
      timestamp: flowWaitResumeDeps.nowIso(),
      source: 'server',
      context: {
        causeMessage,
        recoveryUnavailableMessage: FLOW_WAIT_STARTUP_RECOVERY_DEGRADED_MESSAGE,
      },
    });
    return {
      reachable: true,
      degraded: true,
      resumedCandidateCount: 0,
      diagnosticEvent: FLOW_WAIT_STARTUP_RECOVERY_DEGRADED_EVENT,
      causeMessage,
    };
  }
}

const isFlowDecisionScriptPath = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed.endsWith('.py') || path.isAbsolute(trimmed)) {
    return false;
  }
  const normalized = path.normalize(trimmed);
  return normalized !== '..' && !normalized.startsWith(`..${path.sep}`);
};

const isScriptBackedLoopDecision = (
  step: FlowBreakStep | FlowContinueStep,
): boolean =>
  isFlowDecisionScriptPath(step.question) ||
  (step.type === 'break' && Boolean(step.decisionScript));

const getInvalidDecisionResponseCode = (kind: FlowDecisionKind): string =>
  `INVALID_${kind.toUpperCase()}_RESPONSE`;

const getScriptDecisionFailureCode = (kind: FlowDecisionKind): string =>
  `${kind.toUpperCase()}_DECISION_SCRIPT_FAILED`;

const getFlowDecisionLogMessages = (kind: FlowDecisionKind) => ({
  attempted: `flows.run.${kind}_parse_strategy_attempted`,
  parsed: `flows.run.${kind}_parse_result`,
  decision: `flows.run.${kind}_decision`,
});

const appendFlowDecisionParseLogs = (
  kind: FlowDecisionKind,
  parsed: BreakParseSuccess | BreakParseFailure,
) => {
  const messages = getFlowDecisionLogMessages(kind);
  parsed.attempts.forEach((attempt) => {
    append({
      level: 'info',
      message: messages.attempted,
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
    message: messages.parsed,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      accepted: parsed.ok,
      reasonCode: parsed.reasonCode,
    },
  });
};

const findFirstAgentStep = (
  steps: FlowStep[],
):
  | FlowLlmStep
  | FlowBreakStep
  | FlowContinueStep
  | FlowIfStep
  | FlowCommandStep
  | undefined => {
  for (const step of steps) {
    if (step.type === 'llm' || step.type === 'command') {
      return step;
    }
    if (
      (step.type === 'break' || step.type === 'continue') &&
      !isScriptBackedLoopDecision(step)
    ) {
      return step;
    }
    if (step.type === 'if') {
      if (
        step.agentType &&
        step.identifier &&
        !isFlowDecisionScriptPath(step.condition)
      ) {
        return step;
      }
      const thenStep = findFirstAgentStep(step.then);
      if (thenStep) return thenStep;
      if (step.else) {
        const elseStep = findFirstAgentStep(step.else);
        if (elseStep) return elseStep;
      }
      continue;
    }
    if (step.type === 'startLoop') {
      const nested = findFirstAgentStep(step.steps);
      if (nested) return nested;
    }
  }
  return undefined;
};

const collectDirectFlowAgentTypes = (
  steps: FlowStep[],
  names = new Set<string>(),
): Set<string> => {
  for (const step of steps) {
    if (step.type === 'llm' || step.type === 'command') {
      names.add(step.agentType);
      continue;
    }
    if (
      (step.type === 'break' || step.type === 'continue') &&
      !isScriptBackedLoopDecision(step)
    ) {
      const agentType = step.agentType;
      if (agentType) {
        names.add(agentType);
      }
      continue;
    }
    if (step.type === 'if') {
      if (step.agentType && !isFlowDecisionScriptPath(step.condition)) {
        names.add(step.agentType);
      }
      collectDirectFlowAgentTypes(step.then, names);
      if (step.else) collectDirectFlowAgentTypes(step.else, names);
      continue;
    }
    if (step.type === 'startLoop') {
      collectDirectFlowAgentTypes(step.steps, names);
    }
  }
  return names;
};

const findImmediateResumeBoundaryStep = (
  steps: FlowStep[],
  resumeStepPath?: number[] | null,
): FlowStep | undefined => {
  if (!resumeStepPath || resumeStepPath.length === 0) {
    return steps[0];
  }

  const [stepIndex, ...rest] = resumeStepPath;
  const resumedStep = steps[stepIndex];
  if (!resumedStep) {
    return undefined;
  }
  if (rest.length > 0) {
    const nested = getNestedResumeSteps(resumedStep, rest);
    if (!nested) {
      return undefined;
    }
    return findImmediateResumeBoundaryStep(nested.steps, nested.resumeStepPath);
  }
  if (resumedStep.type === 'startLoop') {
    return findImmediateResumeBoundaryStep(resumedStep.steps, null);
  }
  return steps[stepIndex + 1];
};

const FLOW_IF_THEN_RESUME_INDEX = 0;
const FLOW_IF_ELSE_RESUME_INDEX = 1;

const getNestedResumeSteps = (
  step: FlowStep,
  nestedPath: number[],
): { steps: FlowStep[]; resumeStepPath: number[] } | null => {
  if (step.type === 'startLoop') {
    return { steps: step.steps, resumeStepPath: nestedPath };
  }
  if (step.type !== 'if' || nestedPath.length < 2) {
    return null;
  }

  const [branchIndex, ...branchResumePath] = nestedPath;
  if (branchIndex === FLOW_IF_THEN_RESUME_INDEX) {
    return { steps: step.then, resumeStepPath: branchResumePath };
  }
  if (branchIndex === FLOW_IF_ELSE_RESUME_INDEX && step.else) {
    return { steps: step.else, resumeStepPath: branchResumePath };
  }
  return null;
};

const stepRequiresProviderBootstrap = (step: FlowStep | undefined): boolean => {
  if (!step) return false;
  if (step.type === 'llm' || step.type === 'command') {
    return true;
  }
  if (step.type === 'break' || step.type === 'continue') {
    return !isScriptBackedLoopDecision(step);
  }
  if (step.type === 'if') {
    return Boolean(
      step.agentType &&
        step.identifier &&
        !isFlowDecisionScriptPath(step.condition),
    );
  }
  return false;
};

const findRuntimeIdentityStep = (
  steps: FlowStep[],
  resumeStepPath?: number[] | null,
):
  | FlowLlmStep
  | FlowBreakStep
  | FlowContinueStep
  | FlowIfStep
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
      const nestedResume = getNestedResumeSteps(
        step,
        resumePathRemaining.slice(1),
      );
      if (!nestedResume) {
        return undefined;
      }
      const nested = findRuntimeIdentityStep(
        nestedResume.steps,
        nestedResume.resumeStepPath,
      );
      if (nested) {
        return nested;
      }
      resumePathRemaining = null;
      resumeIndex = undefined;
      continue;
    }

    if (step.type === 'llm' || step.type === 'command') {
      return step;
    }
    if (
      (step.type === 'break' || step.type === 'continue') &&
      !isScriptBackedLoopDecision(step)
    ) {
      return step;
    }
    if (step.type === 'if') {
      if (
        step.agentType &&
        step.identifier &&
        !isFlowDecisionScriptPath(step.condition)
      ) {
        return step;
      }
      continue;
    }
    if (step.type === 'startLoop') {
      const nested = findRuntimeIdentityStep(step.steps, null);
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
      const nestedResume = getNestedResumeSteps(
        step,
        resumePathRemaining.slice(1),
      );
      if (!nestedResume) {
        throw toFlowRunError(
          'INVALID_REQUEST',
          'resumeStepPath must reference loop or conditional branch steps for nested indices',
        );
      }
      await validateCommandSteps({
        flowName: params.flowName,
        steps: nestedResume.steps,
        flowsRoot: params.flowsRoot,
        sourceId: params.sourceId,
        agentByName: params.agentByName,
        repositoryContext: params.repositoryContext,
        resumeStepPath: nestedResume.resumeStepPath,
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
    if (step.type === 'if') {
      if (
        !isFlowDecisionScriptPath(step.condition) &&
        (!step.agentType || !step.identifier)
      ) {
        throw toFlowRunError(
          'INVALID_REQUEST',
          'If steps that use the AI decision path must provide agentType and identifier.',
        );
      }
      if (step.agentType) {
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
      }
      continue;
    }
    if (
      (step.type === 'break' || step.type === 'continue') &&
      isFlowDecisionScriptPath(step.question)
    ) {
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

const validateResumeStepPath = (
  steps: FlowStep[],
  resumeStepPath: number[],
): void => {
  if (resumeStepPath.length === 0) return;
  const validateNestedPath = (
    currentSteps: FlowStep[],
    currentPath: number[],
  ): void => {
    const [stepIndex, ...rest] = currentPath;
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
    if (rest.length === 0) {
      return;
    }

    const nestedResume = getNestedResumeSteps(step, rest);
    if (!nestedResume) {
      throw toFlowRunError(
        'INVALID_REQUEST',
        'resumeStepPath must reference loop or conditional branch steps for nested indices',
      );
    }
    validateNestedPath(nestedResume.steps, nestedResume.resumeStepPath);
  };

  validateNestedPath(steps, resumeStepPath);
};

const resumesFromEarlierStep = (
  resumeStepPath: number[],
  savedStepPath: number[],
): boolean => {
  const sharedLength = Math.min(resumeStepPath.length, savedStepPath.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (resumeStepPath[index] === savedStepPath[index]) continue;
    return (resumeStepPath[index] ?? 0) < (savedStepPath[index] ?? 0);
  }
  return resumeStepPath.length < savedStepPath.length;
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
      commandFilePath?: string;
      candidateAgentHomes?: string[];
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
      candidateAgentHomes: [params.agentHome],
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
      commandFilePath: filePath,
      candidateAgentHomes: [params.agentHome],
    };
  }
  if (!commandStat?.isFile()) {
    return {
      ok: false,
      reason: 'NOT_FOUND',
      message: `Command ${commandName} not found for agent`,
      commandFilePath: filePath,
      candidateAgentHomes: [params.agentHome],
    };
  }

  const parsed = await loadAgentCommandFile({ filePath }).catch(() => null);
  if (!parsed) {
    return {
      ok: false,
      reason: 'READ_FAILED',
      message: `Command ${commandName} read failed`,
      commandFilePath: filePath,
      candidateAgentHomes: [params.agentHome],
    };
  }
  if (!parsed.ok) {
    return {
      ok: false,
      reason: 'INVALID',
      message: `Command ${commandName} failed schema validation`,
      commandFilePath: filePath,
      candidateAgentHomes: [params.agentHome],
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
  const candidateAgentHomes = candidates.map(
    (candidate) => candidate.agentHome,
  );

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
    candidateAgentHomes,
  };
};

async function runFlowUnlocked(params: {
  flowName: string;
  flow: FlowFile;
  flowPath: string[];
  repositoryContext: FlowCommandRepositoryContext;
  agentByName: Map<string, Awaited<ReturnType<typeof discoverAgents>>[number]>;
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
  input?: FlowJsonObject;
  inputHash?: string;
  onStopUnwindCheckpoint?: (params: {
    checkpoint: string;
    conversationId: string;
    detail?: string;
  }) => void | Promise<void>;
  cleanupInflightFn?: typeof cleanupInflight;
  releaseConversationLockFn?: typeof releaseConversationLock;
}): Promise<'ok' | 'warning' | 'paused' | 'stopped' | 'failed'> {
  const agentByName = params.agentByName;
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
  let activeSubflows = cloneActiveSubflows(params.resumeState?.activeSubflows);
  const flowValues: FlowJsonObject = {
    ...(params.resumeState?.values ?? {}),
  };
  let initializedFinalReviewCycle = Object.values(flowValues).some(
    (value) =>
      Boolean(value) &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as FlowJsonObject).action === 'initialized' &&
      (value as FlowJsonObject).review_mode === 'final' &&
      typeof (value as FlowJsonObject).review_cycle_id === 'string',
  );
  let subflowWaveProgress = params.resumeState?.subflowWaveProgress;
  const waveInvocationGeneration =
    params.resumeState?.waveInvocationGeneration ?? 0;
  let terminalOutcome = params.resumeState?.terminalOutcome;
  const runLifecycle: NonNullable<FlowResumeState['runLifecycle']> = {
    status: 'running',
    updatedAt: new Date().toISOString(),
  };
  let lastLoopExit = params.resumeState?.lastLoopExit;
  const interruptedWaveStepPathKey =
    params.resumeState?.restartReconciliation?.status === 'interrupted' &&
    params.resumeState.subflowWaveProgress
      ? getStepPathKey(params.resumeState.subflowWaveProgress.stepPath)
      : null;
  let activeWait = params.resumeState?.wait
    ? {
        kind: params.resumeState.wait.kind ?? 'authored_wait',
        executionId: params.resumeState.wait.executionId,
        stepPath: [...params.resumeState.wait.stepPath],
        loopStack: params.resumeState.wait.loopStack.map((frame) => ({
          loopStepPath: [...frame.loopStepPath],
          iteration: frame.iteration,
        })),
        ...(params.resumeState.wait.activeSubflows &&
        params.resumeState.wait.activeSubflows.length > 0
          ? {
              activeSubflows: cloneActiveSubflows(
                params.resumeState.wait.activeSubflows,
              ),
            }
          : {}),
        ...(params.resumeState.wait.workingFolder
          ? { workingFolder: params.resumeState.wait.workingFolder }
          : {}),
        ...(params.resumeState.wait.sourceId
          ? { sourceId: params.resumeState.wait.sourceId }
          : {}),
        resumeAt: params.resumeState.wait.resumeAt,
        ...(params.resumeState.wait.continuedAfterFailure
          ? { continuedAfterFailure: true }
          : {}),
        ...(params.resumeState.wait.githubReviewContext
          ? {
              githubReviewContext: {
                ...params.resumeState.wait.githubReviewContext,
              },
            }
          : {}),
      }
    : undefined;
  let hasContinuedAfterFailure = activeWait?.continuedAfterFailure === true;
  let hasPropagatedGitHubReviewWarning = false;
  let hasTerminalGitHubReviewWarning = false;
  let activeGitHubReviewContext =
    (params.resumeState?.githubReviewContext ??
    params.resumeState?.wait?.githubReviewContext)
      ? {
          ...(params.resumeState.githubReviewContext ??
            params.resumeState.wait?.githubReviewContext),
        }
      : undefined;
  const normalizeActiveGitHubReviewScratchAuthority = () => {
    if (
      !activeGitHubReviewContext?.executionId ||
      !activeGitHubReviewContext.storyNumber ||
      !params.repositoryContext.workingRepositoryPath
    ) {
      return;
    }
    const canonicalScratchPaths = resolveCanonicalGitHubReviewScratchPaths({
      workingRepositoryRoot: params.repositoryContext.workingRepositoryPath,
      storyNumber: activeGitHubReviewContext.storyNumber,
      executionId: activeGitHubReviewContext.executionId,
    });
    if (canonicalScratchPaths.kind !== 'ok') {
      return;
    }
    activeGitHubReviewContext = {
      ...activeGitHubReviewContext,
      selectorPath: canonicalScratchPaths.value.selectorPath,
      handoffPath: canonicalScratchPaths.value.handoffPath,
    };
  };
  normalizeActiveGitHubReviewScratchAuthority();
  let continueBoundaryLoopKey: string | null = null;
  let activeCommandDiagnosticState:
    | {
        commandName: string;
        attempt: number;
        stepPath: number[];
      }
    | undefined;
  const appendLoopContinueRuntimeDiagnostic = (
    event: string,
    context: Record<string, unknown> = {},
  ) => {
    appendFlowRuntimeDiagnostic('flows.test.loop_continue_runtime', {
      event,
      conversationId: params.conversationId,
      executionId: params.executionId,
      runToken: params.runToken,
      lastCompletedStepPath,
      pendingLoopControl,
      continueBoundaryLoopKey,
      loopStack: loopStack.map((frame) => ({
        loopStepPath: [...frame.loopStepPath],
        iteration: frame.iteration,
      })),
      ...context,
    });
  };
  const appendCommandRuntimeDiagnostic = (
    event: string,
    context: Record<string, unknown> = {},
  ) => {
    appendFlowRuntimeDiagnostic(`flows.test.command_${event}`, {
      conversationId: params.conversationId,
      executionId: params.executionId,
      runToken: params.runToken,
      lastCompletedStepPath,
      activeCommand: activeCommandDiagnosticState
        ? {
            commandName: activeCommandDiagnosticState.commandName,
            attempt: activeCommandDiagnosticState.attempt,
            stepPath: [...activeCommandDiagnosticState.stepPath],
          }
        : null,
      ...context,
    });
  };
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
  const buildFlowEnvOverrides = (): NodeJS.ProcessEnv => ({
    CODEINFO_ROOT: params.repositoryContext.codeInfo2Root,
    ...(activeGitHubReviewContext?.executionId
      ? {
          CODEINFO_GITHUB_REVIEW_EXECUTION_ID:
            activeGitHubReviewContext.executionId,
        }
      : {}),
    ...(typeof activeGitHubReviewContext?.prNumber === 'number'
      ? {
          CODEINFO_GITHUB_REVIEW_PR_NUMBER: String(
            activeGitHubReviewContext.prNumber,
          ),
        }
      : {}),
    ...(activeGitHubReviewContext?.selectorPath
      ? {
          CODEINFO_GITHUB_REVIEW_SELECTOR_PATH:
            activeGitHubReviewContext.selectorPath,
        }
      : {}),
    ...(activeGitHubReviewContext?.handoffPath
      ? {
          CODEINFO_GITHUB_REVIEW_HANDOFF_PATH:
            activeGitHubReviewContext.handoffPath,
        }
      : {}),
    ...(activeGitHubReviewContext?.phase === 'skipped'
      ? { CODEINFO_GITHUB_REVIEW_SKIPPED: '1' }
      : {}),
  });
  const appendGitHubReviewExecutionAuthority = (instruction: string) => {
    if (!activeGitHubReviewContext?.handoffPath) return instruction;
    return `${instruction}\n\n<github_review_execution_authority>\nThis flow is processing execution-scoped GitHub review state. Read the exact handoff path from \`CODEINFO_GITHUB_REVIEW_HANDOFF_PATH\`. It overrides any instruction that derives a story-global \`<story-number>-current-review.json\` path. Read the fetched feedback from that handoff's \`external_review_input_file\`, preserve the existing GitHub identity fields, and write any review artifact references back to that same execution-scoped handoff. Do not read or overwrite another execution's generic or latest review handoff.\n</github_review_execution_authority>`;
  };
  const persistRuntimeResumeState = async (stepPath: number[]) => {
    if (
      activeGitHubReviewContext?.phase !== 'skipped' &&
      activeGitHubReviewContext?.retryStepPath &&
      getStepPathKey(activeGitHubReviewContext.retryStepPath) ===
        getStepPathKey(stepPath)
    ) {
      const {
        retryAttempt: _retryAttempt,
        retryStepPath: _retryStepPath,
        warningMessage: _warningMessage,
        ...recoveredContext
      } = activeGitHubReviewContext;
      void _retryAttempt;
      void _retryStepPath;
      void _warningMessage;
      activeGitHubReviewContext = recoveredContext;
    }
    return persistFlowResumeState({
      conversationId: params.conversationId,
      executionId: params.executionId,
      waveInvocationGeneration,
      runtimeState,
      stepPath,
      loopStack,
      lastLoopExit,
      pendingLoopControl,
      wait: activeWait,
      githubReviewContext: activeGitHubReviewContext,
      activeSubflows,
      subflowWaveProgress,
      terminalOutcome,
      runLifecycle,
      codexReviewModelId: params.codexReviewModelId,
      workingFolder: params.repositoryContext.workingRepositoryPath,
      input: params.input,
      inputHash: params.inputHash,
      values: flowValues,
    });
  };
  const recoverGitHubReviewFailure = async (
    status: TurnStatus,
    failedStepPath: number[],
    skipScopeOnExhaustion: boolean,
  ): Promise<FlowStepOutcome> => {
    if (
      status === 'stopped' ||
      !activeGitHubReviewContext?.executionId ||
      activeGitHubReviewContext.phase === 'skipped'
    ) {
      return status;
    }

    const isSameFailedStep =
      activeGitHubReviewContext.retryStepPath !== undefined &&
      getStepPathKey(activeGitHubReviewContext.retryStepPath) ===
        getStepPathKey(failedStepPath);
    const retryAttempt = isSameFailedStep
      ? (activeGitHubReviewContext.retryAttempt ?? 0) + 1
      : 1;
    if (retryAttempt > GITHUB_REVIEW_RECOVERY_MAX_ATTEMPTS) {
      const warningMessage = `GitHub review recovery exhausted ${String(GITHUB_REVIEW_RECOVERY_MAX_ATTEMPTS)} attempts at step ${failedStepPath.join('.') || 'start'} with status ${status}${typeof activeGitHubReviewContext.prNumber === 'number' ? ` for pull request #${String(activeGitHubReviewContext.prNumber)}` : ''}. The flow will continue without further external review processing.`;
      activeGitHubReviewContext = {
        ...activeGitHubReviewContext,
        phase: 'skipped',
        retryAttempt,
        retryStepPath: [...failedStepPath],
        warningMessage,
      };
      activeWait = undefined;
      await appendGitHubStagePlanNote(warningMessage);
      await emitGitHubStepWarning({
        instruction: 'GitHub review recovery',
        message: warningMessage,
      });
      append({
        level: 'warn',
        message: 'flows.github.review_failure.recovery_exhausted',
        timestamp: flowWaitResumeDeps.nowIso(),
        source: 'server',
        context: {
          flowName: params.flowName,
          conversationId: params.conversationId,
          retryAttempt,
          maxAttempts: GITHUB_REVIEW_RECOVERY_MAX_ATTEMPTS,
          stepPath: lastCompletedStepPath,
          status,
          prNumber: activeGitHubReviewContext.prNumber ?? null,
        },
      });
      return skipScopeOnExhaustion ? 'github_review_skipped' : 'ok';
    }
    const retryDelayMs = Math.min(
      30_000 * 2 ** Math.min(retryAttempt - 1, 5),
      15 * 60_000,
    );
    const resumeAt = flowWaitResumeDeps.now() + retryDelayMs;
    activeGitHubReviewContext = {
      ...activeGitHubReviewContext,
      retryAttempt,
      retryStepPath: [...failedStepPath],
    };
    activeWait = {
      kind: 'review_retry',
      executionId: params.executionId,
      stepPath: [...lastCompletedStepPath],
      loopStack: loopStack.map((frame) => ({
        loopStepPath: [...frame.loopStepPath],
        iteration: frame.iteration,
      })),
      ...(activeSubflows && activeSubflows.length > 0
        ? { activeSubflows: cloneActiveSubflows(activeSubflows) }
        : {}),
      ...(params.repositoryContext.workingRepositoryPath
        ? { workingFolder: params.repositoryContext.workingRepositoryPath }
        : {}),
      ...(params.repositoryContext.flowSourceId
        ? { sourceId: params.repositoryContext.flowSourceId }
        : {}),
      resumeAt,
      githubReviewContext: { ...activeGitHubReviewContext },
    };
    await persistRuntimeResumeState(lastCompletedStepPath);
    schedulePersistedWaitResume({
      conversationId: params.conversationId,
      flowName: params.flowName,
      source: params.source,
      wait: activeWait,
    });
    append({
      level: 'warn',
      message: 'flows.github.review_failure.recovery_scheduled',
      timestamp: flowWaitResumeDeps.nowIso(),
      source: 'server',
      context: {
        flowName: params.flowName,
        conversationId: params.conversationId,
        retryAttempt,
        retryDelayMs,
        resumeAt,
        stepPath: lastCompletedStepPath,
        status,
      },
    });
    return 'paused';
  };
  const clearContinueBoundaryForActiveLoop = () => {
    if (!continueBoundaryLoopKey) return;
    const activeLoopFrame = loopStack[loopStack.length - 1];
    if (!activeLoopFrame) return;
    if (
      getStepPathKey(activeLoopFrame.loopStepPath) !== continueBoundaryLoopKey
    ) {
      return;
    }
    appendLoopContinueRuntimeDiagnostic(
      'clear_continue_boundary_for_active_loop',
      {
        activeLoopFrame: {
          loopStepPath: [...activeLoopFrame.loopStepPath],
          iteration: activeLoopFrame.iteration,
        },
      },
    );
    pendingLoopControl = null;
    continueBoundaryLoopKey = null;
  };
  const recoverGitHubReviewStepFailure = async (
    status: TurnStatus,
    nextPath: number[],
    options: {
      eligible: boolean;
      skipScopeOnExhaustion?: boolean;
    },
  ): Promise<FlowStepOutcome | null> => {
    if (!options.eligible) return status;
    const recoveryOutcome = await recoverGitHubReviewFailure(
      status,
      nextPath,
      options.skipScopeOnExhaustion === true,
    );
    if (recoveryOutcome !== 'ok') return recoveryOutcome;
    lastCompletedStepPath = nextPath;
    clearContinueBoundaryForActiveLoop();
    await persistRuntimeResumeState(lastCompletedStepPath);
    return null;
  };
  const stopAfterSuccessfulStepIfPendingCancel = async (stepParams: {
    checkpoint: string;
    detail: string;
  }): Promise<boolean> => {
    const pendingCancel = consumePendingConversationCancel({
      conversationId: params.conversationId,
      runToken: params.runToken,
    });
    if (!pendingCancel) return false;
    appendLoopContinueRuntimeDiagnostic('pending_cancel_consumed_after_step', {
      checkpoint: stepParams.checkpoint,
      detail: stepParams.detail,
      pendingCancel,
    });
    await params.onStopUnwindCheckpoint?.({
      checkpoint: stepParams.checkpoint,
      conversationId: params.conversationId,
      detail: stepParams.detail,
    });
    await persistRuntimeResumeState(lastCompletedStepPath);
    return true;
  };

  if (resumeStepPath && activeWait) {
    if (activeWait.executionId !== params.executionId) {
      throw toFlowRunError(
        'INVALID_REQUEST',
        'Persisted wait state executionId no longer matches the resumed flow execution.',
      );
    }
    if (
      getStepPathKey(activeWait.stepPath) !== getStepPathKey(resumeStepPath)
    ) {
      throw toFlowRunError(
        'INVALID_REQUEST',
        'Persisted wait state stepPath no longer matches the requested resumeStepPath.',
      );
    }
    if (
      activeWait.workingFolder &&
      params.repositoryContext.workingRepositoryPath &&
      activeWait.workingFolder !==
        params.repositoryContext.workingRepositoryPath
    ) {
      throw toFlowRunError(
        'INVALID_REQUEST',
        'Persisted wait state workingFolder no longer matches the resumed flow execution.',
      );
    }
    if (
      activeWait.sourceId &&
      params.repositoryContext.flowSourceId &&
      activeWait.sourceId !== params.repositoryContext.flowSourceId
    ) {
      throw toFlowRunError(
        'INVALID_REQUEST',
        'Persisted wait state sourceId no longer matches the resumed flow execution.',
      );
    }
    const savedLoopKey = activeWait.loopStack.map(
      (frame) => `${getStepPathKey(frame.loopStepPath)}:${frame.iteration}`,
    );
    const currentLoopKey = (params.resumeState?.loopStack ?? []).map(
      (frame) => `${getStepPathKey(frame.loopStepPath)}:${frame.iteration}`,
    );
    if (savedLoopKey.join('|') !== currentLoopKey.join('|')) {
      throw toFlowRunError(
        'INVALID_REQUEST',
        'Persisted wait state loop context no longer matches the resumed flow execution.',
      );
    }
    const savedActiveSubflowKeys = (activeWait.activeSubflows ?? [])
      .map(
        (activeSubflow) =>
          `${getStepPathKey(activeSubflow.stepPath)}:${activeSubflow.flowName}:${activeSubflow.conversationId}:${activeSubflow.runToken}`,
      )
      .sort();
    const currentActiveSubflowKeys = (activeSubflows ?? [])
      .map(
        (activeSubflow) =>
          `${getStepPathKey(activeSubflow.stepPath)}:${activeSubflow.flowName}:${activeSubflow.conversationId}:${activeSubflow.runToken}`,
      )
      .sort();
    if (
      savedActiveSubflowKeys.join('|') !== currentActiveSubflowKeys.join('|')
    ) {
      throw toFlowRunError(
        'INVALID_REQUEST',
        'Persisted wait state active subflows no longer match the resumed flow execution.',
      );
    }
    activeWait = undefined;
  }

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
      if (activeCommandDiagnosticState) {
        appendCommandRuntimeDiagnostic('cleanup_inflight_begin', {
          inflightId: stepInflightId,
          hadInflightBefore: Boolean(activeInflight),
          ownershipPresentBefore: Boolean(
            getActiveRunOwnership(params.conversationId),
          ),
        });
      }
      if (activeInflight) {
        cleanupInflightFn({
          conversationId: params.conversationId,
          inflightId: stepInflightId,
        });
        if (activeCommandDiagnosticState) {
          appendCommandRuntimeDiagnostic('cleanup_inflight_complete', {
            inflightId: stepInflightId,
            hadInflightBefore: true,
            hasInflightAfter: Boolean(getInflight(params.conversationId)),
          });
        }
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
        if (activeCommandDiagnosticState) {
          appendCommandRuntimeDiagnostic('cleanup_inflight_complete', {
            inflightId: stepInflightId,
            hadInflightBefore: false,
            hasInflightAfter: Boolean(getInflight(params.conversationId)),
          });
        }
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
      if (activeCommandDiagnosticState) {
        appendCommandRuntimeDiagnostic('release_lock_begin', {
          inflightId: stepInflightId,
          ownershipPresentBefore: Boolean(
            getActiveRunOwnership(params.conversationId),
          ),
        });
      }
      const lockReleased = releaseConversationLockFn(
        params.conversationId,
        params.runToken,
      );
      if (activeCommandDiagnosticState) {
        appendCommandRuntimeDiagnostic('release_lock_complete', {
          inflightId: stepInflightId,
          ownershipPresentAfter: Boolean(
            getActiveRunOwnership(params.conversationId),
          ),
          releaseResult: lockReleased,
        });
      }
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

  const resolveFlowInstructionPrerequisites = async (resolutionParams: {
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
    const agent = agentByName.get(resolutionParams.agentType);
    if (!agent) {
      throw toFlowRunError(
        'AGENT_NOT_FOUND',
        `Agent ${resolutionParams.agentType} not found`,
      );
    }

    appendFlowRuntimeDiagnostic(
      'flows.test.llm_instruction_prerequisites_begin',
      {
        conversationId: params.conversationId,
        executionId: params.executionId,
        flowName: params.flowName,
        agentType: resolutionParams.agentType,
        identifier: resolutionParams.identifier,
        configPath: resolutionParams.configPath ?? agent.configPath,
        workingFolder: resolutionParams.workingFolder ?? null,
        defaultRepositoryRoot: resolutionParams.defaultRepositoryRoot ?? null,
        source: resolutionParams.source,
      },
    );

    const agentState = runtimeState.get(
      getAgentKey(resolutionParams.agentType, resolutionParams.identifier),
    );
    appendFlowRuntimeDiagnostic(
      'flows.test.llm_instruction_prerequisites_agent_state_snapshot',
      {
        conversationId: params.conversationId,
        executionId: params.executionId,
        flowName: params.flowName,
        agentType: resolutionParams.agentType,
        identifier: resolutionParams.identifier,
        hasAgentState: Boolean(agentState),
        agentConversationId: agentState?.conversationId ?? null,
        providerId: agentState?.providerId ?? null,
        modelId: agentState?.modelId ?? null,
        endpointId: agentState?.endpointId ?? null,
      },
    );
    if (agentState?.conversationId) {
      appendFlowRuntimeDiagnostic(
        'flows.test.llm_instruction_prerequisites_conversation_lookup_begin',
        {
          conversationId: params.conversationId,
          executionId: params.executionId,
          flowName: params.flowName,
          agentType: resolutionParams.agentType,
          identifier: resolutionParams.identifier,
          agentConversationId: agentState.conversationId,
        },
      );
      const persistedConversation = await getConversation(
        agentState.conversationId,
      );
      appendFlowRuntimeDiagnostic(
        'flows.test.llm_instruction_prerequisites_conversation_lookup_complete',
        {
          conversationId: params.conversationId,
          executionId: params.executionId,
          flowName: params.flowName,
          agentType: resolutionParams.agentType,
          identifier: resolutionParams.identifier,
          agentConversationId: agentState.conversationId,
          persistedConversationFound: Boolean(persistedConversation),
          persistedProviderId: persistedConversation?.provider ?? null,
          persistedModelId: persistedConversation?.model ?? null,
          persistedEndpointId:
            typeof persistedConversation?.flags?.endpointId === 'string'
              ? persistedConversation.flags.endpointId
              : null,
        },
      );
      if (persistedConversation?.agentName === resolutionParams.agentType) {
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
    appendFlowRuntimeDiagnostic(
      'flows.test.llm_instruction_prerequisites_runtime_resolution_begin',
      {
        conversationId: params.conversationId,
        executionId: params.executionId,
        flowName: params.flowName,
        agentType: resolutionParams.agentType,
        identifier: resolutionParams.identifier,
        pinnedProviderId: agentState?.providerId ?? null,
        pinnedModelId: agentState?.modelId ?? null,
        pinnedRequestedProviderId: agentState?.requestedProviderId ?? null,
        pinnedEndpointId: providerBootstrapReady
          ? (agentState?.endpointId ?? null)
          : null,
        providerBootstrapReady,
      },
    );

    const resolvedRuntime = await resolveFlowAgentRuntimeExecution({
      agentName: resolutionParams.agentType,
      configPath: resolutionParams.configPath ?? agent.configPath,
      workingFolder: resolutionParams.workingFolder,
      defaultRepositoryRoot: resolutionParams.defaultRepositoryRoot,
      source: resolutionParams.source,
      pinnedProviderId: agentState?.providerId as
        | ConversationProvider
        | undefined,
      pinnedModelId: agentState?.modelId,
      pinnedRequestedProviderId: agentState?.requestedProviderId,
      pinnedEndpointId: providerBootstrapReady
        ? agentState?.endpointId
        : undefined,
      allowFallback: !agentState?.providerId,
      diagnosticsContext: {
        conversationId: params.conversationId,
        executionId: params.executionId,
        flowName: params.flowName,
        identifier: resolutionParams.identifier,
      },
    });
    appendFlowRuntimeDiagnostic(
      'flows.test.llm_instruction_prerequisites_runtime_resolution_complete',
      {
        conversationId: params.conversationId,
        executionId: params.executionId,
        flowName: params.flowName,
        agentType: resolutionParams.agentType,
        identifier: resolutionParams.identifier,
        providerId: resolvedRuntime.providerId,
        modelId: resolvedRuntime.modelId,
        requestedProviderId: resolvedRuntime.requestedProviderId ?? null,
        endpointId: resolvedRuntime.endpointId ?? null,
        workingDirectoryOverride:
          resolvedRuntime.workingDirectoryOverride ?? null,
      },
    );
    return resolvedRuntime;
  };

  const runInstruction = async (instructionParams: {
    agentType: string;
    identifier: string;
    instruction: string;
    deferFinal?: boolean;
    postProcess?: FlowInstructionPostProcess;
    command?: TurnCommandMetadata;
    runtime?: TurnRuntimeMetadata;
    onAttemptResult?: (
      result: FlowInstructionResult,
      metadata: {
        attempt: number;
        providerId: ConversationProvider;
        modelId: string;
      },
    ) => Promise<void>;
  }): Promise<FlowInstructionResult> => {
    const effectiveInstruction = appendGitHubReviewExecutionAuthority(
      instructionParams.instruction,
    );
    const agent = agentByName.get(instructionParams.agentType);
    if (!agent) {
      throw toFlowRunError(
        'AGENT_NOT_FOUND',
        `Agent ${instructionParams.agentType} not found`,
      );
    }

    const agentKey = getAgentKey(
      instructionParams.agentType,
      instructionParams.identifier,
    );
    const existingAgentState = runtimeState.get(agentKey);
    appendFlowRuntimeDiagnostic('flows.test.llm_instruction_begin', {
      conversationId: params.conversationId,
      executionId: params.executionId,
      flowName: params.flowName,
      stepIndex:
        instructionParams.command?.name === 'flow'
          ? instructionParams.command.stepIndex
          : null,
      agentType: instructionParams.agentType,
      identifier: instructionParams.identifier,
      agentKey,
      hadAgentState: Boolean(existingAgentState),
      existingAgentConversationId: existingAgentState?.conversationId ?? null,
      existingThreadId: existingAgentState?.threadId ?? null,
      instructionLength: effectiveInstruction.length,
      instructionPreview: effectiveInstruction.slice(0, 120),
    });

    const effectiveInstructionWorkingFolder =
      instructionParams.runtime?.workingFolder ??
      params.repositoryContext.workingRepositoryPath;
    const runtime = await resolveFlowInstructionPrerequisites({
      agentType: instructionParams.agentType,
      identifier: instructionParams.identifier,
      configPath: agent.configPath,
      workingFolder: effectiveInstructionWorkingFolder,
      defaultRepositoryRoot: params.repositoryContext.defaultRepositoryRoot,
      source: params.source,
    });
    const modelId = runtime.modelId;
    appendFlowRuntimeDiagnostic(
      'flows.test.llm_instruction_prerequisites_ready',
      {
        conversationId: params.conversationId,
        executionId: params.executionId,
        flowName: params.flowName,
        stepIndex:
          instructionParams.command?.name === 'flow'
            ? instructionParams.command.stepIndex
            : null,
        agentType: instructionParams.agentType,
        identifier: instructionParams.identifier,
        providerId: runtime.providerId,
        modelId,
        requestedProviderId: runtime.requestedProviderId ?? null,
        endpointId: runtime.endpointId ?? null,
        workingDirectoryOverride: runtime.workingDirectoryOverride ?? null,
        effectiveInstructionWorkingFolder:
          effectiveInstructionWorkingFolder ?? null,
      },
    );

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
      workingFolder: effectiveInstructionWorkingFolder,
      customTitle: params.customTitle,
      source: params.source,
    });
    appendFlowRuntimeDiagnostic(
      'flows.test.llm_instruction_agent_state_ready',
      {
        conversationId: params.conversationId,
        executionId: params.executionId,
        flowName: params.flowName,
        stepIndex:
          instructionParams.command?.name === 'flow'
            ? instructionParams.command.stepIndex
            : null,
        agentType: instructionParams.agentType,
        identifier: instructionParams.identifier,
        isNew,
        agentConversationId: agentState.conversationId,
        threadId: agentState.threadId ?? null,
        providerId: agentState.providerId,
        modelId: agentState.modelId,
        requestedProviderId: agentState.requestedProviderId ?? null,
        endpointId: agentState.endpointId ?? null,
        workingFolder: agentState.workingFolder ?? null,
      },
    );
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
              originalInstruction: effectiveInstruction,
              previousError,
            })
          : null;
      if (retryInstruction) {
        sanitizedErrorLength = retryInstruction.sanitizedErrorLength;
      }

      let shouldRetry = false;
      appendFlowRuntimeDiagnostic('flows.test.llm_instruction_dispatch_begin', {
        conversationId: params.conversationId,
        executionId: params.executionId,
        flowName: params.flowName,
        stepIndex:
          instructionParams.command?.name === 'flow'
            ? instructionParams.command.stepIndex
            : null,
        agentType: instructionParams.agentType,
        identifier: instructionParams.identifier,
        attempt,
        inflightId: stepInflightId,
        agentConversationId: agentState.conversationId,
        threadId: agentState.threadId ?? null,
      });
      const result = await runFlowInstruction({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction: retryInstruction?.instruction ?? effectiveInstruction,
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
        envOverrides: buildFlowEnvOverrides(),
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
          appendFlowRuntimeDiagnostic(
            'flows.test.llm_instruction_thread_observed',
            {
              conversationId: params.conversationId,
              executionId: params.executionId,
              flowName: params.flowName,
              stepIndex:
                instructionParams.command?.name === 'flow'
                  ? instructionParams.command.stepIndex
                  : null,
              agentType: instructionParams.agentType,
              identifier: instructionParams.identifier,
              agentConversationId: agentState.conversationId,
              threadId,
            },
          );
          agentState.threadId = threadId;
          void persistAgentThreadId({
            conversationId: agentState.conversationId,
            threadId,
          });
          void persistRuntimeResumeState(lastCompletedStepPath);
        },
      });
      appendFlowRuntimeDiagnostic(
        'flows.test.llm_instruction_dispatch_complete',
        {
          conversationId: params.conversationId,
          executionId: params.executionId,
          flowName: params.flowName,
          stepIndex:
            instructionParams.command?.name === 'flow'
              ? instructionParams.command.stepIndex
              : null,
          agentType: instructionParams.agentType,
          identifier: instructionParams.identifier,
          attempt,
          inflightId: stepInflightId,
          status: result.status,
          contentLength: result.content.length,
          threadId: agentState.threadId ?? null,
        },
      );

      await instructionParams.onAttemptResult?.(result, {
        attempt,
        providerId: runtime.providerId,
        modelId,
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
    const reviewUsageRecorder = (invocation: number) =>
      step.recordReviewUsage
        ? async (
            result: FlowInstructionResult,
            metadata: {
              attempt: number;
              providerId: ConversationProvider;
              modelId: string;
            },
          ) => {
            const recorded = await writeReviewUsageArtifact({
              input: params.input,
              flowName: params.flowName,
              stepIndex: command.stepIndex,
              stepLabel: step.label,
              stepIdentifier: step.identifier,
              invocation,
              attempt: metadata.attempt,
              providerId: metadata.providerId,
              modelId: metadata.modelId,
              status: result.status,
              usage: result.usage,
            });
            if (recorded.status === 'skipped') {
              baseLogger.warn(
                {
                  flowName: params.flowName,
                  stepIndex: command.stepIndex,
                  identifier: step.identifier,
                  invocation,
                  attempt: metadata.attempt,
                  reason: recorded.reason,
                },
                'optional actual-review usage evidence was not written',
              );
            }
          }
        : undefined;

    if ('messages' in step) {
      appendFlowRuntimeDiagnostic('flows.test.llm_step_messages_begin', {
        conversationId: params.conversationId,
        executionId: params.executionId,
        flowName: params.flowName,
        stepIndex: command.stepIndex,
        agentType: step.agentType,
        identifier: step.identifier,
        messageCount: step.messages.length,
      });
      for (const [messageIndex, message] of step.messages.entries()) {
        const instruction = prependAssignedReviewJobContext(
          joinMessageContent(message.content),
          params.input,
        );
        let result: FlowInstructionResult;
        try {
          result = await runInstruction({
            agentType: step.agentType,
            identifier: step.identifier,
            instruction,
            command,
            onAttemptResult: reviewUsageRecorder(messageIndex + 1),
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
      appendFlowRuntimeDiagnostic('flows.test.llm_step_messages_complete', {
        conversationId: params.conversationId,
        executionId: params.executionId,
        flowName: params.flowName,
        stepIndex: command.stepIndex,
        agentType: step.agentType,
        identifier: step.identifier,
        messageCount: step.messages.length,
      });
      return 'ok';
    }

    let preparedMarkdownInstruction;
    appendFlowRuntimeDiagnostic('flows.test.llm_markdown_prepare_begin', {
      conversationId: params.conversationId,
      executionId: params.executionId,
      flowName: params.flowName,
      stepIndex: command.stepIndex,
      agentType: step.agentType,
      identifier: step.identifier,
      markdownFile: step.markdownFile,
    });
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
      appendFlowRuntimeDiagnostic('flows.test.llm_markdown_prepare_ready', {
        conversationId: params.conversationId,
        executionId: params.executionId,
        flowName: params.flowName,
        stepIndex: command.stepIndex,
        agentType: step.agentType,
        identifier: step.identifier,
        markdownFile: step.markdownFile,
        preparedKind: preparedMarkdownInstruction.kind,
        resolvedSourceId: preparedMarkdownInstruction.resolvedSourceId,
        resolvedPath: preparedMarkdownInstruction.resolvedPath,
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
    const instruction = prependAssignedReviewJobContext(
      preparedMarkdownInstruction.instruction,
      params.input,
    );

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
        instructionLength: instruction.length,
      },
    });

    appendFlowRuntimeDiagnostic('flows.test.llm_markdown_dispatch_begin', {
      conversationId: params.conversationId,
      executionId: params.executionId,
      flowName: params.flowName,
      stepIndex: command.stepIndex,
      agentType: step.agentType,
      identifier: step.identifier,
      markdownFile: step.markdownFile,
      resolvedSourceId: preparedMarkdownInstruction.resolvedSourceId,
      resolvedPath: preparedMarkdownInstruction.resolvedPath,
      instructionLength: instruction.length,
    });
    const result = await runInstruction({
      agentType: step.agentType,
      identifier: step.identifier,
      instruction,
      command,
      onAttemptResult: reviewUsageRecorder(1),
      runtime: {
        ...(params.repositoryContext.workingRepositoryPath
          ? { workingFolder: params.repositoryContext.workingRepositoryPath }
          : {}),
        lookupSummary: preparedMarkdownInstruction.lookupSummary,
      },
    });
    appendFlowRuntimeDiagnostic('flows.test.llm_markdown_dispatch_complete', {
      conversationId: params.conversationId,
      executionId: params.executionId,
      flowName: params.flowName,
      stepIndex: command.stepIndex,
      agentType: step.agentType,
      identifier: step.identifier,
      markdownFile: step.markdownFile,
      status: result.status,
    });
    return result.status;
  };

  const runSharedDecisionStep = async (paramsForDecision: {
    kind: FlowDecisionKind;
    decisionInput: string;
    decisionScript?: string;
    command: TurnCommandMetadata;
    agentType?: string;
    identifier?: string;
    instructionLabel: string;
  }): Promise<{
    status: TurnStatus;
    answer?: 'yes' | 'no';
    source?: 'ai' | 'script';
    failureKind?: 'execution' | 'invalid_response';
  }> => {
    const implicitDecisionScript = isFlowDecisionScriptPath(
      paramsForDecision.decisionInput,
    )
      ? paramsForDecision.decisionInput
      : undefined;
    const decisionScript =
      paramsForDecision.decisionScript ?? implicitDecisionScript;
    if (decisionScript) {
      const workingRepositoryRoot =
        params.repositoryContext.workingRepositoryPath;
      if (!workingRepositoryRoot) {
        await emitFailedFlowStep({
          flowConversationId: params.conversationId,
          inflightId: stepInflightId,
          instruction: `${paramsForDecision.instructionLabel}: ${paramsForDecision.decisionInput}`,
          modelId: params.modelId,
          providerId: params.providerId,
          source: params.source,
          command: paramsForDecision.command,
          message:
            'Script-backed flow decisions require a worked repository root.',
          errorCode: getScriptDecisionFailureCode(paramsForDecision.kind),
        });
        return {
          status: 'failed',
          source: 'script',
          failureKind: 'execution',
        };
      }

      normalizeActiveGitHubReviewScratchAuthority();
      const decisionScriptEnv = {
        ...process.env,
        ...buildFlowEnvOverrides(),
      };
      const execution = await executeFlowDecisionScript({
        workingFolder: workingRepositoryRoot,
        decisionScript,
        timeoutMs: FLOW_DECISION_SCRIPT_TIMEOUT_MS,
        env: decisionScriptEnv,
      });
      if (!execution.ok) {
        await emitFailedFlowStep({
          flowConversationId: params.conversationId,
          inflightId: stepInflightId,
          instruction: `${paramsForDecision.instructionLabel}: ${paramsForDecision.decisionInput}`,
          modelId: params.modelId,
          providerId: params.providerId,
          source: params.source,
          command: paramsForDecision.command,
          message: execution.reason,
          errorCode: getScriptDecisionFailureCode(paramsForDecision.kind),
        });
        return {
          status: 'failed',
          source: 'script',
          failureKind: 'execution',
        };
      }

      const parsed = parseScriptFlowDecisionAnswer(
        paramsForDecision.kind,
        execution.stdout,
      );
      if (!parsed.ok) {
        await emitFailedFlowStep({
          flowConversationId: params.conversationId,
          inflightId: stepInflightId,
          instruction: `${paramsForDecision.instructionLabel}: ${decisionScript}`,
          modelId: params.modelId,
          providerId: params.providerId,
          source: params.source,
          command: paramsForDecision.command,
          message: `Script output failed decision parsing: ${parsed.message}`,
          errorCode: getScriptDecisionFailureCode(paramsForDecision.kind),
        });
        return {
          status: 'failed',
          source: 'script',
          failureKind: 'execution',
        };
      }
      return {
        status: 'ok',
        answer: parsed.answer,
        source: 'script',
      };
    }

    if (!paramsForDecision.agentType || !paramsForDecision.identifier) {
      await emitFailedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction: `${paramsForDecision.instructionLabel}: ${paramsForDecision.decisionInput}`,
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        command: paramsForDecision.command,
        message:
          'AI-backed flow decisions require both agentType and identifier.',
        errorCode: getInvalidDecisionResponseCode(paramsForDecision.kind),
      });
      return { status: 'failed', failureKind: 'execution' };
    }

    let answer: 'yes' | 'no' | undefined;
    let failureKind: 'execution' | 'invalid_response' | undefined;
    const instruction = [
      'Answer with JSON only: {"answer":"yes"} or {"answer":"no"}.',
      `Question: ${paramsForDecision.decisionInput}`,
    ].join('\n');

    const result = await runInstruction({
      agentType: paramsForDecision.agentType,
      identifier: paramsForDecision.identifier,
      instruction,
      deferFinal: true,
      command: paramsForDecision.command,
      postProcess: (candidate) => {
        const parsed = parseFlowDecisionAnswer(
          paramsForDecision.kind,
          candidate.content,
        );
        appendFlowDecisionParseLogs(paramsForDecision.kind, parsed);

        if (!parsed.ok) {
          failureKind = 'invalid_response';
          return {
            status: 'failed',
            content: parsed.message,
            finalOverride: {
              status: 'failed',
              error: {
                code: getInvalidDecisionResponseCode(paramsForDecision.kind),
                message: parsed.message,
              },
            },
          };
        }

        answer = parsed.answer;
        return {
          content: parsed.normalizedContent,
        };
      },
    });

    if (shouldStopAfter(result.status)) {
      return {
        status: result.status,
        failureKind: failureKind ?? 'execution',
      };
    }

    if (!answer) {
      return { status: 'failed', failureKind: 'invalid_response' };
    }

    return {
      status: 'ok',
      answer,
      source: 'ai',
    };
  };

  const runBreakStep = async (
    step: FlowBreakStep,
    command: TurnCommandMetadata,
  ): Promise<{
    status: TurnStatus;
    shouldBreak: boolean;
    source?: 'ai' | 'script';
    failureKind?: 'execution' | 'invalid_response';
  }> => {
    const result = await runSharedDecisionStep({
      kind: 'break',
      decisionInput: step.question,
      decisionScript: step.decisionScript,
      command,
      agentType: step.agentType,
      identifier: step.identifier,
      instructionLabel: 'Break decision',
    });

    if (shouldStopAfter(result.status)) {
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'runBreakStep.return.stop',
        conversationId: params.conversationId,
        detail: `status=${result.status} step=${command.stepIndex}`,
      });
      return {
        status: result.status,
        shouldBreak: false,
        source: result.source,
        failureKind: result.failureKind ?? 'execution',
      };
    }

    if (!result.answer) {
      return {
        status: 'failed',
        shouldBreak: false,
        source: result.source,
        failureKind: 'invalid_response',
      };
    }

    append({
      level: 'info',
      message: getFlowDecisionLogMessages('break').decision,
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        flowName: params.flowName,
        answer: result.answer,
        breakOn: step.breakOn,
        loopDepth: loopStack.length,
        source: result.source,
      },
    });

    return {
      status: 'ok',
      shouldBreak: result.answer === step.breakOn,
    };
  };

  const runContinueStep = async (
    step: FlowContinueStep,
    command: TurnCommandMetadata,
  ): Promise<{
    status: TurnStatus;
    shouldContinue: boolean;
    source?: 'ai' | 'script';
    failureKind?: 'execution' | 'invalid_response';
  }> => {
    const result = await runSharedDecisionStep({
      kind: 'continue',
      decisionInput: step.question,
      command,
      agentType: step.agentType,
      identifier: step.identifier,
      instructionLabel: 'Continue decision',
    });

    if (shouldStopAfter(result.status)) {
      return {
        status: result.status,
        shouldContinue: false,
        source: result.source,
        failureKind: result.failureKind ?? 'execution',
      };
    }

    if (!result.answer) {
      return {
        status: 'failed',
        shouldContinue: false,
        source: result.source,
        failureKind: 'invalid_response',
      };
    }

    append({
      level: 'info',
      message: getFlowDecisionLogMessages('continue').decision,
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        flowName: params.flowName,
        answer: result.answer,
        continueOn: step.continueOn,
        loopDepth: loopStack.length,
        source: result.source,
      },
    });

    return {
      status: 'ok',
      shouldContinue: result.answer === step.continueOn,
    };
  };

  const runIfStep = async (
    step: FlowIfStep,
    command: TurnCommandMetadata,
    nextPath: number[],
    resumeBranchPath?: number[] | null,
    githubReviewRecoveryScope = false,
  ): Promise<FlowStepOutcome> => {
    if (resumeBranchPath && resumeBranchPath.length > 0) {
      const nestedResume = getNestedResumeSteps(step, resumeBranchPath);
      if (!nestedResume) {
        throw toFlowRunError(
          'INVALID_REQUEST',
          'resumeStepPath contains an invalid conditional branch path',
        );
      }
      const branchIndex = resumeBranchPath[0];
      await validateCommandSteps({
        flowName: params.flowName,
        steps: nestedResume.steps,
        flowsRoot: params.repositoryContext.flowSourceId
          ? path.resolve(params.repositoryContext.flowSourceId, 'flows')
          : flowsDirForRun(),
        sourceId: params.repositoryContext.flowSourceId,
        agentByName,
        repositoryContext: params.repositoryContext,
        resumeStepPath: nestedResume.resumeStepPath,
      });
      const outcome = await runSteps(
        nestedResume.steps,
        [...nextPath, branchIndex],
        nestedResume.resumeStepPath,
        githubReviewRecoveryScope || step.githubReviewRecovery === true,
      );
      return outcome === 'github_review_skipped' && step.githubReviewRecovery
        ? 'ok'
        : outcome;
    }

    const result = await runSharedDecisionStep({
      kind: 'if',
      decisionInput: step.condition,
      command,
      agentType: step.agentType,
      identifier: step.identifier,
      instructionLabel: 'If condition',
    });

    if (shouldStopAfter(result.status)) {
      return result.status;
    }

    if (!result.answer) {
      return 'failed';
    }

    const branch = result.answer === 'yes' ? step.then : (step.else ?? []);
    append({
      level: 'info',
      message: getFlowDecisionLogMessages('if').decision,
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        flowName: params.flowName,
        answer: result.answer,
        branch: result.answer === 'yes' ? 'then' : 'else',
        branchLength: branch.length,
        loopDepth: loopStack.length,
        source: result.source,
      },
    });

    if (branch.length === 0) {
      return 'ok';
    }

    try {
      await validateCommandSteps({
        flowName: params.flowName,
        steps: branch,
        flowsRoot: params.repositoryContext.flowSourceId
          ? path.resolve(params.repositoryContext.flowSourceId, 'flows')
          : flowsDirForRun(),
        sourceId: params.repositoryContext.flowSourceId,
        agentByName,
        repositoryContext: params.repositoryContext,
      });
    } catch (error) {
      const message = isFlowRunError(error)
        ? (error.reason ?? error.code)
        : error instanceof Error
          ? error.message
          : 'Selected if branch failed validation.';
      const errorCode = isFlowRunError(error) ? error.code : 'INVALID_REQUEST';
      await emitFailedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction: `If branch: ${step.label ?? 'conditional flow branch'}`,
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        message,
        errorCode,
        command,
      });
      return 'failed';
    }

    const branchIndex =
      result.answer === 'yes'
        ? FLOW_IF_THEN_RESUME_INDEX
        : FLOW_IF_ELSE_RESUME_INDEX;
    const outcome = await runSteps(
      branch,
      [...nextPath, branchIndex],
      null,
      githubReviewRecoveryScope || step.githubReviewRecovery === true,
    );
    return outcome === 'github_review_skipped' && step.githubReviewRecovery
      ? 'ok'
      : outcome;
  };

  const runWaitStep = async (
    step: FlowWaitStep,
    nextPath: number[],
  ): Promise<'ok' | 'paused'> => {
    const resumeAt = flowWaitResumeDeps.now() + step.seconds * 1000;
    activeWait = {
      kind: 'authored_wait',
      executionId: params.executionId,
      stepPath: [...nextPath],
      loopStack: loopStack.map((frame) => ({
        loopStepPath: [...frame.loopStepPath],
        iteration: frame.iteration,
      })),
      ...(activeSubflows && activeSubflows.length > 0
        ? {
            activeSubflows: cloneActiveSubflows(activeSubflows),
          }
        : {}),
      ...(params.repositoryContext.workingRepositoryPath
        ? { workingFolder: params.repositoryContext.workingRepositoryPath }
        : {}),
      ...(params.repositoryContext.flowSourceId
        ? { sourceId: params.repositoryContext.flowSourceId }
        : {}),
      resumeAt,
      ...(hasContinuedAfterFailure ? { continuedAfterFailure: true } : {}),
      ...(activeGitHubReviewContext
        ? {
            githubReviewContext: {
              ...activeGitHubReviewContext,
            },
          }
        : {}),
    };
    lastCompletedStepPath = nextPath;
    await persistRuntimeResumeState(nextPath);
    schedulePersistedWaitResume({
      conversationId: params.conversationId,
      flowName: params.flowName,
      source: params.source,
      wait: activeWait,
    });
    append({
      level: 'info',
      message: 'flows.wait.persisted',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        flowName: params.flowName,
        conversationId: params.conversationId,
        stepPath: nextPath,
        seconds: step.seconds,
        resumeAt,
      },
    });
    return 'paused';
  };

  const readCurrentPlanStoryContext = async () => {
    return await __readCurrentPlanStoryContextForTests({
      workingRepositoryRoot: params.repositoryContext.workingRepositoryPath,
      defaultRepositoryRoot: params.repositoryContext.defaultRepositoryRoot,
    });
  };

  const buildGitHubReviewPullRequestContent = async (paramsForPr: {
    repositoryFullName: string;
    branchName: string;
  }) => {
    const storyContext = await readCurrentPlanStoryContext();
    const storyLabel = storyContext?.storyNumber
      ? `Story ${storyContext.storyNumber}`
      : 'Active Story';
    const storyTitle = storyContext?.title ?? params.flowName;
    const title = `${storyLabel} review: ${storyTitle}`;
    const implementationSummary = storyContext?.implementationSummary?.length
      ? storyContext.implementationSummary.map((item) => `- ${item}`)
      : [
          `- This branch contains the current implementation pass for ${storyLabel.toLowerCase()} on \`${paramsForPr.branchName}\`.`,
          `- The review request was generated by the opt-in GitHub review-cycle flow \`${params.flowName}\`.`,
        ];
    const body = [
      `${storyLabel}: ${storyTitle}`,
      '',
      `Repository: ${paramsForPr.repositoryFullName}`,
      `Branch: ${paramsForPr.branchName}`,
      `Flow: ${params.flowName}`,
      ...(storyContext?.storyRationale
        ? ['', 'Story rationale:', `- ${storyContext.storyRationale}`]
        : []),
      '',
      'Implemented work summary:',
      ...implementationSummary,
      '',
      'Reviewer instruction:',
      '- Please focus feedback on the active story scope and the implemented behavior on this branch.',
      '- Do not request behavior changes outside the active story scope in this review cycle.',
    ].join('\n');
    return { title, body };
  };

  const appendGitHubStagePlanNote = async (note: string) => {
    const workingRepositoryRoot =
      params.repositoryContext.workingRepositoryPath;
    if (!workingRepositoryRoot) return;
    const appended = await appendGitHubReviewPlanNote({
      workingRepositoryRoot,
      note,
    });
    if (appended.kind !== 'ok') {
      append({
        level: 'warn',
        message: 'flows.github.plan_note.failed',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          flowName: params.flowName,
          detail: appended.message,
          reason: appended.reason,
        },
      });
    }
  };

  const emitGitHubStepFailure = async (paramsForFailure: {
    instruction: string;
    message: string;
    errorCode: string;
  }) => {
    await emitFailedFlowStep({
      flowConversationId: params.conversationId,
      inflightId: stepInflightId,
      instruction: paramsForFailure.instruction,
      modelId: params.modelId,
      providerId: params.providerId,
      source: params.source,
      message: paramsForFailure.message,
      errorCode: paramsForFailure.errorCode,
    });
  };

  const emitGitHubStepWarning = async (paramsForWarning: {
    instruction: string;
    message: string;
  }) => {
    await emitWarningFlowStep({
      flowConversationId: params.conversationId,
      inflightId: stepInflightId,
      instruction: paramsForWarning.instruction,
      modelId: params.modelId,
      providerId: params.providerId,
      source: params.source,
      message: paramsForWarning.message,
    });
  };

  const emitGitHubStepWarnings = async (paramsForWarning: {
    instruction: string;
    warnings: string[];
    logMessage: string;
  }) => {
    for (const warningMessage of paramsForWarning.warnings) {
      await appendGitHubStagePlanNote(warningMessage);
      append({
        level: 'warn',
        message: paramsForWarning.logMessage,
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          flowName: params.flowName,
          detail: warningMessage,
        },
      });
      await emitGitHubStepWarning({
        instruction: paramsForWarning.instruction,
        message: warningMessage,
      });
    }
  };

  const markGitHubReviewCycleSkipped = (warningMessage: string) => {
    activeGitHubReviewContext = {
      ...activeGitHubReviewContext,
      executionId:
        activeGitHubReviewContext?.executionId ?? params.executionId,
      phase: 'skipped',
      retryAttempt: activeGitHubReviewContext?.retryAttempt ?? 0,
      warningMessage,
    };
    activeWait = undefined;
  };

  const terminalGitHubReviewWarning = (): TurnStatus => {
    hasTerminalGitHubReviewWarning = true;
    return 'warning';
  };

  const formatGitHubFailureDetail = (paramsForDetail: {
    message: string;
    stderr?: string;
    exitCode?: number | null;
  }) => {
    const lines = [paramsForDetail.message];
    if (paramsForDetail.exitCode !== undefined) {
      lines.push(`exitCode: ${String(paramsForDetail.exitCode)}`);
    }
    if (paramsForDetail.stderr) {
      lines.push(`stderr: ${paramsForDetail.stderr}`);
    }
    return lines.join('\n');
  };

  const buildGitHubLookupRetryWarningMessage = (
    diagnostic: GitHubLookupRetryDiagnostic,
  ) =>
    `GitHub review stage warning during PR open lookup retry ${diagnostic.attemptNumber} after waiting ${Math.round(diagnostic.waitMs / 1000)}s:\n${formatGitHubFailureDetail(
      {
        message: diagnostic.message,
        stderr: diagnostic.stderr,
        exitCode: diagnostic.exitCode,
      },
    )}`;

  const buildGitHubRecoveredCreateWarningMessage = (paramsForMessage: {
    pullRequestNumber: number;
    createFailure: GitHubCommandFailureDetail;
  }) =>
    `GitHub review stage warning during PR open: gh pr create reported a failure before reconciliation, but latest-open PR lookup resolved pull request #${String(paramsForMessage.pullRequestNumber)}.\n${formatGitHubFailureDetail(
      {
        message: paramsForMessage.createFailure.message,
        stderr: paramsForMessage.createFailure.stderr,
        exitCode: paramsForMessage.createFailure.exitCode,
      },
    )}`;

  const buildGitHubOpenPrFailureMessage = (paramsForMessage: {
    failure: GitHubCommandFailureDetail;
    lookupDiagnostics: GitHubLookupRetryDiagnostic[];
    createFailure?: GitHubCommandFailureDetail;
  }) => {
    const lines = ['GitHub review stage failed during PR open.'];
    if (paramsForMessage.createFailure) {
      lines.push(
        `Initial gh pr create failure before reconciliation:\n${formatGitHubFailureDetail(
          {
            message: paramsForMessage.createFailure.message,
            stderr: paramsForMessage.createFailure.stderr,
            exitCode: paramsForMessage.createFailure.exitCode,
          },
        )}`,
      );
    }
    for (const diagnostic of paramsForMessage.lookupDiagnostics.slice(0, -1)) {
      lines.push(
        `Lookup retry warning ${diagnostic.attemptNumber} after ${Math.round(diagnostic.waitMs / 1000)}s:\n${formatGitHubFailureDetail(
          {
            message: diagnostic.message,
            stderr: diagnostic.stderr,
            exitCode: diagnostic.exitCode,
          },
        )}`,
      );
    }
    if (paramsForMessage.lookupDiagnostics.length > 0) {
      const finalDiagnostic =
        paramsForMessage.lookupDiagnostics[
          paramsForMessage.lookupDiagnostics.length - 1
        ];
      lines.push(
        `Final lookup failure ${finalDiagnostic.attemptNumber} after ${Math.round(finalDiagnostic.waitMs / 1000)}s:\n${formatGitHubFailureDetail(
          {
            message: finalDiagnostic.message,
            stderr: finalDiagnostic.stderr,
            exitCode: finalDiagnostic.exitCode,
          },
        )}`,
      );
      return lines.join('\n\n');
    }
    lines.push(
      formatGitHubFailureDetail({
        message: paramsForMessage.failure.message,
        stderr: paramsForMessage.failure.stderr,
        exitCode: paramsForMessage.failure.exitCode,
      }),
    );
    return lines.join('\n\n');
  };

  const resolveGitHubStepContext = async () => {
    const workingRepositoryRoot =
      params.repositoryContext.workingRepositoryPath;
    if (!workingRepositoryRoot) {
      return {
        kind: 'error' as const,
        reason: 'INVALID_REQUEST' as const,
        message:
          'GitHub flow steps require a worked repository root for repository-local git and .env.local access.',
      };
    }
    const tokenResult = await readWorkedRepositoryGitHubToken({
      workingRepositoryRoot,
    });
    if (tokenResult.kind !== 'ok') {
      return tokenResult;
    }
    const repositoryResult = await resolveGitHubRepositoryState({
      workingRepositoryRoot,
    });
    if (repositoryResult.kind !== 'ok') {
      return repositoryResult;
    }
    return {
      kind: 'ok' as const,
      value: {
        token: tokenResult.value.token,
        repository: repositoryResult.value,
      },
    };
  };

  const runGitHubOpenPrStep = async (): Promise<TurnStatus> => {
    const context = await resolveGitHubStepContext();
    if (context.kind === 'skip') {
      const warningMessage = `GitHub review stage skipped during PR open: ${context.message}`;
      await appendGitHubStagePlanNote(warningMessage);
      append({
        level: 'warn',
        message: 'flows.github.open_pr.skipped',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          flowName: params.flowName,
          reason: context.reason,
          detail: context.message,
        },
      });
      await emitGitHubStepWarning({
        instruction: 'GitHub open PR step',
        message: warningMessage,
      });
      if (activeGitHubReviewContext?.prNumber) {
        activeGitHubReviewContext.warningMessage = warningMessage;
        return terminalGitHubReviewWarning();
      }
      markGitHubReviewCycleSkipped(warningMessage);
      return 'ok';
    }
    if (context.kind !== 'ok') {
      const warningMessage = `GitHub review stage skipped during PR open after setup failed: ${context.message}`;
      await appendGitHubStagePlanNote(warningMessage);
      await emitGitHubStepWarning({
        instruction: 'GitHub open PR step',
        message: warningMessage,
      });
      if (activeGitHubReviewContext?.prNumber) {
        activeGitHubReviewContext.warningMessage = warningMessage;
        return terminalGitHubReviewWarning();
      }
      markGitHubReviewCycleSkipped(warningMessage);
      return 'ok';
    }
    if (
      activeGitHubReviewContext?.phase === 'opened' &&
      typeof activeGitHubReviewContext.prNumber === 'number' &&
      !activeGitHubReviewContext.storyNumber
    ) {
      const scratchOwnershipClaim = await prepareGitHubReviewScratchOwnership({
        repository: context.value.repository,
        executionId: params.executionId,
      });
      if (scratchOwnershipClaim.kind !== 'ok') {
        const warningMessage = `GitHub review stage could not prepare scratch context for pull request #${String(activeGitHubReviewContext.prNumber)}: ${scratchOwnershipClaim.message}`;
        await appendGitHubStagePlanNote(warningMessage);
        await emitGitHubStepWarning({
          instruction: 'GitHub open PR step',
          message: warningMessage,
        });
        activeGitHubReviewContext.warningMessage = warningMessage;
        return terminalGitHubReviewWarning();
      }
      activeGitHubReviewContext = {
        ...activeGitHubReviewContext,
        storyNumber: scratchOwnershipClaim.value.story_number,
        branchName: scratchOwnershipClaim.value.branch_name,
        selectorPath: buildGitHubReviewScratchPaths(
          context.value.repository.workingRepositoryRoot,
          scratchOwnershipClaim.value.story_number,
        ).selectorPath,
        handoffPath: scratchOwnershipClaim.value.handoff_path,
        retryAttempt: 0,
      };
      return 'ok';
    }
    const pushResult = await pushBranchToExistingUpstream({
      repository: context.value.repository,
    });
    if (pushResult.kind === 'skip') {
      const warningMessage = `GitHub review stage skipped during PR open: ${pushResult.message}`;
      await appendGitHubStagePlanNote(warningMessage);
      append({
        level: 'warn',
        message: 'flows.github.open_pr.skipped',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          flowName: params.flowName,
          reason: pushResult.reason,
          detail: pushResult.message,
        },
      });
      await emitGitHubStepWarning({
        instruction: 'GitHub open PR step',
        message: warningMessage,
      });
      markGitHubReviewCycleSkipped(warningMessage);
      return 'ok';
    }
    if (pushResult.kind !== 'ok') {
      const warningMessage = `GitHub review stage skipped during PR open after branch push failed: ${pushResult.message}`;
      await appendGitHubStagePlanNote(warningMessage);
      await emitGitHubStepWarning({
        instruction: 'GitHub open PR step',
        message: warningMessage,
      });
      markGitHubReviewCycleSkipped(warningMessage);
      return 'ok';
    }
    const latestOpenPullRequest = await lookupLatestOpenPullRequest({
      repository: context.value.repository,
      token: context.value.token,
    });
    if (latestOpenPullRequest.kind !== 'ok') {
      const failureMessage = buildGitHubOpenPrFailureMessage({
        failure: {
          reason: latestOpenPullRequest.reason,
          message: latestOpenPullRequest.message,
          stderr: latestOpenPullRequest.stderr,
          exitCode: latestOpenPullRequest.exitCode,
        },
        lookupDiagnostics: [],
      });
      await appendGitHubStagePlanNote(failureMessage);
      await emitGitHubStepWarning({
        instruction: 'GitHub open PR step',
        message: failureMessage,
      });
      markGitHubReviewCycleSkipped(failureMessage);
      return 'ok';
    }
    let pullRequest = latestOpenPullRequest.value;
    const reusingOpenPullRequest = Boolean(pullRequest);
    if (!pullRequest) {
      const { title, body } = await buildGitHubReviewPullRequestContent({
        repositoryFullName: context.value.repository.repositoryFullName,
        branchName: context.value.repository.upstreamBranch,
      });
      const createResult = await createPullRequest({
        repository: context.value.repository,
        token: context.value.token,
        title,
        body,
      });
      const warningDiagnostics =
        createResult.kind === 'ok'
          ? createResult.lookupDiagnostics
          : createResult.lookupDiagnostics.slice(0, -1);
      for (const diagnostic of warningDiagnostics) {
        const warningMessage = buildGitHubLookupRetryWarningMessage(diagnostic);
        await appendGitHubStagePlanNote(warningMessage);
        append({
          level: 'warn',
          message: 'flows.github.open_pr.lookup_retry_failed',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            flowName: params.flowName,
            attemptNumber: diagnostic.attemptNumber,
            waitMs: diagnostic.waitMs,
            reason: diagnostic.reason,
            detail: diagnostic.message,
            stderr: diagnostic.stderr,
            exitCode: diagnostic.exitCode,
          },
        });
      }
      if (createResult.kind !== 'ok') {
        const failureMessage = buildGitHubOpenPrFailureMessage({
          failure: {
            reason: createResult.reason,
            message: createResult.message,
            stderr: createResult.stderr,
            exitCode: createResult.exitCode,
          },
          lookupDiagnostics: createResult.lookupDiagnostics,
          createFailure: createResult.createFailure,
        });
        await appendGitHubStagePlanNote(failureMessage);
        await emitGitHubStepWarning({
          instruction: 'GitHub open PR step',
          message: failureMessage,
        });
        markGitHubReviewCycleSkipped(failureMessage);
        return 'ok';
      }
      if (createResult.createFailure) {
        const recoveredCreateWarning = buildGitHubRecoveredCreateWarningMessage({
          pullRequestNumber: createResult.value.number,
          createFailure: createResult.createFailure,
        });
        await appendGitHubStagePlanNote(recoveredCreateWarning);
        append({
          level: 'warn',
          message: 'flows.github.open_pr.create_recovered',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            flowName: params.flowName,
            prNumber: createResult.value.number,
            detail: recoveredCreateWarning,
            reason: createResult.createFailure.reason,
            stderr: createResult.createFailure.stderr,
            exitCode: createResult.createFailure.exitCode,
          },
        });
      }
      pullRequest = createResult.value;
    }
    append({
      level: 'info',
      message: reusingOpenPullRequest
        ? 'flows.github.open_pr.reused'
        : 'flows.github.open_pr.created',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        flowName: params.flowName,
        repository: context.value.repository.repositoryFullName,
        branch: context.value.repository.upstreamBranch,
        prNumber: pullRequest.number,
        prUrl: pullRequest.url,
      },
    });
    activeGitHubReviewContext = {
      executionId: params.executionId,
      prNumber: pullRequest.number,
      branchName: context.value.repository.upstreamBranch,
      phase: 'opened',
      retryAttempt: 0,
    };
    const scratchOwnershipClaim = await prepareGitHubReviewScratchOwnership({
      repository: context.value.repository,
      executionId: params.executionId,
    });
    if (scratchOwnershipClaim.kind !== 'ok') {
      const warningMessage = `GitHub review stage could not prepare scratch context after selecting pull request #${String(pullRequest.number)}: ${scratchOwnershipClaim.message}`;
      await appendGitHubStagePlanNote(warningMessage);
      await emitGitHubStepWarning({
        instruction: 'GitHub open PR step',
        message: warningMessage,
      });
      activeGitHubReviewContext.warningMessage = warningMessage;
      return terminalGitHubReviewWarning();
    }
    activeGitHubReviewContext = {
      executionId: params.executionId,
      prNumber: pullRequest.number,
      storyNumber: scratchOwnershipClaim.value.story_number,
      branchName: scratchOwnershipClaim.value.branch_name,
      selectorPath: buildGitHubReviewScratchPaths(
        context.value.repository.workingRepositoryRoot,
        scratchOwnershipClaim.value.story_number,
      ).selectorPath,
      handoffPath: scratchOwnershipClaim.value.handoff_path,
      phase: 'opened',
      selectorPublicationPending: true,
      retryAttempt: 0,
    };
    return 'ok';
  };

  const resolveExecutionScopedGitHubReviewPullRequest = async (params: {
    repository: GitHubRepositoryState;
    token: string;
  }) => {
    if (!activeGitHubReviewContext?.executionId) {
      const latestOpenPullRequest = await lookupLatestOpenPullRequest({
        repository: params.repository,
        token: params.token,
      });
      if (latestOpenPullRequest.kind !== 'ok') {
        return {
          kind: latestOpenPullRequest.kind,
          reason: latestOpenPullRequest.reason,
          message: latestOpenPullRequest.message,
          stderr: latestOpenPullRequest.stderr,
          exitCode: latestOpenPullRequest.exitCode,
          warnings: [],
        } as const;
      }
      return {
        kind: 'ok',
        value: latestOpenPullRequest.value,
        warnings: [],
      } as const;
    }
    if (!activeGitHubReviewContext.storyNumber) {
      return {
        kind: 'error',
        reason: 'SCRATCH_INVALID',
        message:
          'Resumed GitHub review execution is missing its authoritative story number.',
        warnings: [],
      } as const;
    }

    const canonicalScratchPaths = resolveCanonicalGitHubReviewScratchPaths({
      workingRepositoryRoot: params.repository.workingRepositoryRoot,
      storyNumber: activeGitHubReviewContext.storyNumber,
      executionId: activeGitHubReviewContext.executionId,
      ...(activeGitHubReviewContext.selectorPath
        ? { selectorPath: activeGitHubReviewContext.selectorPath }
        : {}),
      ...(activeGitHubReviewContext.handoffPath
        ? { handoffPath: activeGitHubReviewContext.handoffPath }
        : {}),
    });
    if (canonicalScratchPaths.kind !== 'ok') {
      return {
        kind: 'error',
        reason: canonicalScratchPaths.reason,
        message: canonicalScratchPaths.message,
        warnings: [],
      } as const;
    }
    if (typeof activeGitHubReviewContext.prNumber !== 'number') {
      return {
        kind: 'error',
        reason: 'SCRATCH_INVALID',
        message:
          'Resumed GitHub review execution is missing its authoritative pull request number.',
        warnings: [],
      } as const;
    }

    const reconciled = await reconcileResumedGitHubReviewPullRequest({
      repository: params.repository,
      token: params.token,
      executionId: activeGitHubReviewContext.executionId,
      handoffPath: canonicalScratchPaths.value.handoffPath,
      resumedPullRequestNumber: activeGitHubReviewContext.prNumber,
      expectPersistedHandoff: activeGitHubReviewContext.phase === 'fetched',
    });
    if (reconciled.kind !== 'ok') {
      return reconciled;
    }
    activeGitHubReviewContext.prNumber = reconciled.value.number;
    activeGitHubReviewContext.selectorPath =
      canonicalScratchPaths.value.selectorPath;
    activeGitHubReviewContext.handoffPath =
      canonicalScratchPaths.value.handoffPath;
    return reconciled;
  };

  const runGitHubFetchReviewsStep = async (): Promise<TurnStatus> => {
    if (activeGitHubReviewContext?.phase === 'skipped') return 'ok';
    const context = await resolveGitHubStepContext();
    if (context.kind === 'skip') {
      const warningMessage = `GitHub review stage skipped during review fetch: ${context.message}`;
      await appendGitHubStagePlanNote(warningMessage);
      append({
        level: 'warn',
        message: 'flows.github.fetch_reviews.skipped',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          flowName: params.flowName,
          reason: context.reason,
          detail: context.message,
        },
      });
      await emitGitHubStepWarning({
        instruction: 'GitHub fetch reviews step',
        message: warningMessage,
      });
      markGitHubReviewCycleSkipped(warningMessage);
      return 'ok';
    }
    if (context.kind !== 'ok') {
      const warningMessage = `GitHub review stage skipped during review fetch after setup failed: ${context.message}`;
      await appendGitHubStagePlanNote(warningMessage);
      await emitGitHubStepWarning({
        instruction: 'GitHub fetch reviews step',
        message: warningMessage,
      });
      markGitHubReviewCycleSkipped(warningMessage);
      return 'ok';
    }
    const pullRequestResult =
      await resolveExecutionScopedGitHubReviewPullRequest({
        repository: context.value.repository,
        token: context.value.token,
      });
    await emitGitHubStepWarnings({
      instruction: 'GitHub fetch reviews step',
      warnings: [...pullRequestResult.warnings],
      logMessage: 'flows.github.fetch_reviews.execution_pr_reconciled',
    });
    if (pullRequestResult.kind !== 'ok') {
      await appendGitHubStagePlanNote(
        `GitHub review stage failed during review fetch: ${pullRequestResult.message}`,
      );
      await emitGitHubStepFailure({
        instruction: 'GitHub fetch reviews step',
        message: pullRequestResult.message,
        errorCode: pullRequestResult.reason,
      });
      return 'failed';
    }
    if (!pullRequestResult.value) {
      const warningMessage =
        'GitHub review stage stopped before review fetch because no latest open pull request was available for the current branch.';
      await appendGitHubStagePlanNote(warningMessage);
      append({
        level: 'info',
        message: 'flows.github.fetch_reviews.no_open_pr',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          flowName: params.flowName,
          repository: context.value.repository.repositoryFullName,
          branch: context.value.repository.upstreamBranch,
        },
      });
      await emitGitHubStepWarning({
        instruction: 'GitHub fetch reviews step',
        message: warningMessage,
      });
      return terminalGitHubReviewWarning();
    }
    const reviewArtifactResult = await fetchPullRequestReviews({
      repository: context.value.repository,
      token: context.value.token,
      pullRequest: pullRequestResult.value,
    });
    if (reviewArtifactResult.kind !== 'ok') {
      await appendGitHubStagePlanNote(
        `GitHub review stage failed during review fetch: ${reviewArtifactResult.message}`,
      );
      await emitGitHubStepFailure({
        instruction: 'GitHub fetch reviews step',
        message: reviewArtifactResult.message,
        errorCode: reviewArtifactResult.reason,
      });
      return 'failed';
    }
    const scratchWriteResult = await writeGitHubReviewScratch({
      repository: context.value.repository,
      executionId: params.executionId,
      pullRequest: pullRequestResult.value,
      artifact: reviewArtifactResult.value,
      preserveForeignSelectorOwnership: Boolean(
        activeGitHubReviewContext?.executionId,
      ),
      replaceForeignSelectorOwnership:
        activeGitHubReviewContext?.selectorPublicationPending === true,
    });
    if (scratchWriteResult.kind !== 'ok') {
      await appendGitHubStagePlanNote(
        `GitHub review stage failed during review fetch: ${scratchWriteResult.message}`,
      );
      await emitGitHubStepFailure({
        instruction: 'GitHub fetch reviews step',
        message: scratchWriteResult.message,
        errorCode: scratchWriteResult.reason,
      });
      return 'failed';
    }
    const canonicalScratchPaths = resolveCanonicalGitHubReviewScratchPaths({
      workingRepositoryRoot: context.value.repository.workingRepositoryRoot,
      storyNumber: scratchWriteResult.value.story_number,
      executionId: scratchWriteResult.value.execution_id,
      ...(activeGitHubReviewContext?.selectorPath
        ? { selectorPath: activeGitHubReviewContext.selectorPath }
        : {}),
      ...(activeGitHubReviewContext?.handoffPath
        ? { handoffPath: activeGitHubReviewContext.handoffPath }
        : {}),
    });
    if (canonicalScratchPaths.kind !== 'ok') {
      await appendGitHubStagePlanNote(
        `GitHub review stage failed during review fetch: ${canonicalScratchPaths.message}`,
      );
      await emitGitHubStepFailure({
        instruction: 'GitHub fetch reviews step',
        message: canonicalScratchPaths.message,
        errorCode: canonicalScratchPaths.reason,
      });
      return 'failed';
    }
    const handoffPath = canonicalScratchPaths.value.handoffPath;
    const handoffReadResult = await readGitHubReviewScratch({
      handoffPath,
      expectedExecutionId:
        activeGitHubReviewContext?.executionId ?? params.executionId,
    });
    if (handoffReadResult.kind !== 'ok') {
      await appendGitHubStagePlanNote(
        `GitHub review stage failed during review fetch: ${handoffReadResult.message}`,
      );
      await emitGitHubStepFailure({
        instruction: 'GitHub fetch reviews step',
        message: handoffReadResult.message,
        errorCode: handoffReadResult.reason,
      });
      return 'failed';
    }
    activeGitHubReviewContext = {
      executionId: handoffReadResult.value.execution_id,
      prNumber: pullRequestResult.value.number,
      storyNumber: handoffReadResult.value.story_number,
      branchName: handoffReadResult.value.branch_name,
      selectorPath: canonicalScratchPaths.value.selectorPath,
      handoffPath,
      phase: 'fetched',
      retryAttempt: 0,
    };
    const materializedReviewInput = await materializeGitHubExternalReviewInput({
      handoff: handoffReadResult.value,
    });
    if (materializedReviewInput.kind !== 'ok') {
      await appendGitHubStagePlanNote(
        `GitHub review stage failed during review fetch: ${materializedReviewInput.message}`,
      );
      await emitGitHubStepFailure({
        instruction: 'GitHub fetch reviews step',
        message: materializedReviewInput.message,
        errorCode: materializedReviewInput.reason,
      });
      return 'failed';
    }
    append({
      level: 'info',
      message: 'flows.github.fetch_reviews.recorded',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        flowName: params.flowName,
        repository: context.value.repository.repositoryFullName,
        branch: context.value.repository.upstreamBranch,
        prNumber: pullRequestResult.value.number,
        reviewCount: reviewArtifactResult.value.reviews.length,
        reviewCommentCount: reviewArtifactResult.value.reviewComments.length,
        handoffPath: activeGitHubReviewContext?.handoffPath ?? handoffPath,
        rawReviewArtifactPath:
          scratchWriteResult.value.raw_review_artifact_path,
        externalReviewInputPath:
          materializedReviewInput.value.externalReviewInputPath,
        filteredFeedbackCount: materializedReviewInput.value.feedback.length,
      },
    });
    return 'ok';
  };

  const runGitHubClosePrStep = async (): Promise<TurnStatus> => {
    if (activeGitHubReviewContext?.phase === 'skipped') return 'ok';
    const context = await resolveGitHubStepContext();
    if (context.kind === 'skip') {
      const warningMessage = `GitHub review stage skipped during PR close: ${context.message}`;
      await appendGitHubStagePlanNote(warningMessage);
      append({
        level: 'warn',
        message: 'flows.github.close_pr.skipped',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          flowName: params.flowName,
          reason: context.reason,
          detail: context.message,
        },
      });
      await emitGitHubStepWarning({
        instruction: 'GitHub close PR step',
        message: warningMessage,
      });
      return terminalGitHubReviewWarning();
    }
    if (context.kind !== 'ok') {
      await appendGitHubStagePlanNote(
        `GitHub review stage failed during PR close: ${context.message}`,
      );
      await emitGitHubStepFailure({
        instruction: 'GitHub close PR step',
        message: context.message,
        errorCode: context.reason,
      });
      return 'failed';
    }
    const pullRequestResult =
      await resolveExecutionScopedGitHubReviewPullRequest({
        repository: context.value.repository,
        token: context.value.token,
      });
    await emitGitHubStepWarnings({
      instruction: 'GitHub close PR step',
      warnings: [...pullRequestResult.warnings],
      logMessage: 'flows.github.close_pr.execution_pr_reconciled',
    });
    if (pullRequestResult.kind !== 'ok') {
      await appendGitHubStagePlanNote(
        `GitHub review stage failed during PR close: ${pullRequestResult.message}`,
      );
      await emitGitHubStepFailure({
        instruction: 'GitHub close PR step',
        message: pullRequestResult.message,
        errorCode: pullRequestResult.reason,
      });
      return 'failed';
    }
    if (!pullRequestResult.value) {
      const warningMessage =
        'GitHub review stage stopped before PR close because no latest open pull request was available for the current branch.';
      await appendGitHubStagePlanNote(warningMessage);
      await emitGitHubStepWarning({
        instruction: 'GitHub close PR step',
        message: warningMessage,
      });
      return terminalGitHubReviewWarning();
    }
    const closeResult = await closePullRequest({
      repository: context.value.repository,
      token: context.value.token,
      pullRequest: pullRequestResult.value,
    });
    if (closeResult.kind !== 'ok') {
      await appendGitHubStagePlanNote(
        `GitHub review stage failed during PR close: ${closeResult.message}`,
      );
      await emitGitHubStepFailure({
        instruction: 'GitHub close PR step',
        message: closeResult.message,
        errorCode: closeResult.reason,
      });
      return 'failed';
    }
    append({
      level: 'info',
      message: 'flows.github.close_pr.closed',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        flowName: params.flowName,
        repository: context.value.repository.repositoryFullName,
        branch: context.value.repository.upstreamBranch,
        prNumber: pullRequestResult.value.number,
      },
    });
    activeGitHubReviewContext = undefined;
    return 'ok';
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
    appendFlowRuntimeDiagnostic('flows.test.active_subflows_updated', {
      conversationId: params.conversationId,
      executionId: params.executionId,
      stepPath,
      nextCount: nextSubflows.length,
      mergedCount: mergedSubflows.length,
      flowNames: nextSubflows.map((subflow) => subflow.flowName),
      childConversationIds: nextSubflows.map(
        (subflow) => subflow.conversationId,
      ),
    });
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

  const runSubflowJobs = async (
    jobs: SubflowWaveJob[],
    stepLabel: string | undefined,
    command: TurnCommandMetadata,
    nextPath: number[],
    isWave = false,
    isReviewBatch = false,
    reviewAttemptIdentity?: {
      reviewCycleId?: string;
      reviewBatchId?: string;
    },
  ): Promise<TurnStatus> => {
    if (jobs.length === 0) {
      throw toFlowRunError(
        'INVALID_REQUEST',
        'Subflow wave must expand to at least one child job.',
      );
    }
    const childFlowNames = jobs.map((job) => job.flowName);
    const launchesMultipleChildren = jobs.length > 1;
    const instruction = launchesMultipleChildren
      ? `Run subflows ${childFlowNames.join(', ')}`
      : `Run subflow ${childFlowNames[0]}`;
    const parentTurnCreatedAtIso = new Date().toISOString();
    const parentTurnCreatedAt = new Date(parentTurnCreatedAtIso);
    const parentConversation = await getConversation(params.conversationId);
    const waveInvocationId = isWave
      ? getWaveInvocationId(nextPath, loopStack, waveInvocationGeneration)
      : undefined;
    const activeInstanceId = (activeSubflow: FlowActiveSubflow) =>
      activeSubflow.instanceId ?? activeSubflow.flowName;
    const jobByInstanceId = new Map(jobs.map((job) => [job.instanceId, job]));
    const rememberedSubflowsByInstance = new Map(
      getActiveSubflowsForStep(nextPath)
        .filter((activeSubflow) => {
          const job = jobByInstanceId.get(activeInstanceId(activeSubflow));
          if (!job) return false;
          return (
            (!waveInvocationId ||
              !activeSubflow.waveInvocationId ||
              activeSubflow.waveInvocationId === waveInvocationId) &&
            (!job.inputHash || activeSubflow.inputHash === job.inputHash)
          );
        })
        .map((activeSubflow) => [
          activeInstanceId(activeSubflow),
          activeSubflow,
        ]),
    );
    if (isWave && params.resumeState) {
      const persistedChildren = await findFlowWaveChildren({
        executionId: params.executionId,
        waveInvocationId: waveInvocationId!,
        instanceIds: jobs.map((job) => job.instanceId),
      });
      for (const childConversation of persistedChildren) {
        const identity = getFlowChildWaveIdentity(childConversation);
        if (
          !identity ||
          identity.waveInvocationId !== waveInvocationId ||
          rememberedSubflowsByInstance.has(identity.instanceId)
        ) {
          continue;
        }
        const job = jobByInstanceId.get(identity.instanceId);
        if (!job || childConversation.flowName !== job.flowName) continue;
        const childFlowState = parseFlowResumeState(
          isRecord(childConversation.flags)
            ? (childConversation.flags as Record<string, unknown>)
            : undefined,
        );
        if (job.inputHash && childFlowState?.inputHash !== job.inputHash) {
          continue;
        }

        rememberedSubflowsByInstance.set(identity.instanceId, {
          stepPath: [...nextPath],
          flowName: job.flowName,
          conversationId: childConversation._id,
          runToken:
            getActiveRunOwnership(childConversation._id)?.runToken ??
            `recovered-wave-child:${childConversation._id}`,
          instanceId: job.instanceId,
          waveInvocationId,
          ...(job.targetId ? { targetId: job.targetId } : {}),
          ...(job.workingFolder ? { workingFolder: job.workingFolder } : {}),
          ...(job.input ? { input: job.input } : {}),
          ...(job.inputHash ? { inputHash: job.inputHash } : {}),
          title: childConversation.title,
        });
      }
    }
    const childRuns = jobs
      .map((job) => rememberedSubflowsByInstance.get(job.instanceId))
      .filter((activeSubflow): activeSubflow is FlowActiveSubflow =>
        Boolean(activeSubflow),
      );
    const stopActiveSubflowsAndWaitForTerminalStatus = async (): Promise<
      Array<{
        childRun: FlowActiveSubflow;
        status: Extract<
          FlowChildLifecycleStatus,
          'ok' | 'warning' | 'failed' | 'stopped'
        >;
      }>
    > =>
      Promise.all(
        childRuns.map(async (childRun) => {
          let activeChildRun = childRun;
          requestActiveSubflowStop({
            conversationId: activeChildRun.conversationId,
            runToken: activeChildRun.runToken,
          });
          while (true) {
            const status = await getFlowConversationLifecycleStatus({
              conversationId: activeChildRun.conversationId,
              runToken: activeChildRun.runToken,
            });
            if (isTerminalFlowChildLifecycleStatus(status)) {
              return { childRun: activeChildRun, status };
            }
            if (status === 'orphaned') {
              const resumedChildRun = await resumeWaveChild(activeChildRun);
              if (resumedChildRun) {
                activeChildRun = resumedChildRun;
                requestActiveSubflowStop({
                  conversationId: activeChildRun.conversationId,
                  runToken: activeChildRun.runToken,
                });
                continue;
              }
              await persistFlowRunLifecycleStatus(
                activeChildRun.conversationId,
                'failed',
              );
              return { childRun: activeChildRun, status: 'failed' };
            }
            if (status === 'missing') {
              return { childRun: activeChildRun, status: 'failed' };
            }
            await sleep(25);
          }
        }),
      );
    const resumeWaveChild = async (
      childRun: FlowActiveSubflow,
    ): Promise<FlowActiveSubflow | null> => {
      const childConversation = await getConversation(childRun.conversationId);
      if (childConversation?.flowName !== childRun.flowName) return null;
      const childResumeState = parseFlowResumeState(
        isRecord(childConversation.flags)
          ? (childConversation.flags as Record<string, unknown>)
          : undefined,
      );
      if (!childResumeState) return null;

      const resumesInterruptedChild =
        params.resumeState?.restartReconciliation?.status === 'interrupted';
      const resumesStoppedChild =
        Boolean(params.resumeState) &&
        childResumeState.runLifecycle?.status === 'stopped';
      const resumesOrphanedChild =
        childResumeState.runLifecycle?.status === 'running' &&
        !getActiveRunOwnership(childRun.conversationId);
      if (
        !resumesInterruptedChild &&
        !resumesStoppedChild &&
        !resumesOrphanedChild
      ) {
        return null;
      }

      let resumedRunToken: string | undefined;
      await startFlowRun({
        flowName: childRun.flowName,
        sourceId: params.repositoryContext.flowSourceId,
        flowPath: params.flowPath,
        codexReviewModelId: params.codexReviewModelId,
        working_folder:
          childRun.workingFolder ??
          params.repositoryContext.workingRepositoryPath,
        input: childRun.input,
        customTitle: childRun.title,
        parentWave: {
          executionId: params.executionId,
          instanceId: activeInstanceId(childRun),
          waveInvocationId: childRun.waveInvocationId ?? waveInvocationId!,
          ...(childRun.targetId ? { targetId: childRun.targetId } : {}),
          displayName: childRun.title ?? childRun.flowName,
        },
        conversationId: childRun.conversationId,
        resumeStepPath:
          childResumeState.restartReconciliation?.resumeStepPath ??
          childResumeState.stepPath,
        source: params.source,
        chatFactory: params.chatFactory,
        listIngestedRepositories:
          params.repositoryContext.listIngestedRepositories,
        onOwnershipReady: ({ runToken }) => {
          resumedRunToken = runToken;
        },
      });
      if (!resumedRunToken) return null;
      return { ...childRun, runToken: resumedRunToken };
    };
    const buildTrackedSubflowTitle = (job: SubflowWaveJob) =>
      rememberedSubflowsByInstance.get(job.instanceId)?.title ??
      buildSubflowConversationTitle({
        parentFlowName: params.flowName,
        parentPersistedTitle: parentConversation?.title,
        parentCustomTitle: params.customTitle,
        stepLabel,
        childFlowName: job.displayName,
        multipleChildren: launchesMultipleChildren,
        waveLabel:
          isWave && loopStack.length > 0
            ? `wave ${loopStack.map((frame) => frame.iteration).join('.')}`
            : undefined,
      });
    const buildSubflowSummaryText = (prefix: string) =>
      launchesMultipleChildren
        ? `${prefix} ${jobs
            .map((job) => buildTrackedSubflowTitle(job))
            .join(', ')}`
        : `${prefix} ${buildTrackedSubflowTitle(jobs[0]!)}`;
    const childOutcomes = new Map<
      string,
      {
        title: string;
        status: 'ok' | 'warning' | 'failed' | 'stopped' | 'not_applicable';
        reason?: string;
        conversationId?: string;
      }
    >();
    const recordChildOutcome = (params: {
      instanceId: string;
      status: 'ok' | 'warning' | 'failed' | 'stopped' | 'not_applicable';
      reason?: string;
      conversationId?: string;
    }) => {
      const job = jobByInstanceId.get(params.instanceId);
      childOutcomes.set(params.instanceId, {
        title: job ? buildTrackedSubflowTitle(job) : params.instanceId,
        status: params.status,
        ...(params.reason ? { reason: params.reason } : {}),
        ...(params.conversationId
          ? { conversationId: params.conversationId }
          : {}),
      });
    };
    const refreshWaveProgress = () => {
      if (!isWave) return undefined;
      const runningInstances = new Set(
        childRuns.map((childRun) => activeInstanceId(childRun)),
      );
      const progressJobs: FlowSubflowWaveProgress['jobs'] = jobs.map((job) => {
        const childOutcome = childOutcomes.get(job.instanceId);
        const outcome = childOutcome?.status;
        const childConversationId =
          childOutcome?.conversationId ??
          rememberedSubflowsByInstance.get(job.instanceId)?.conversationId;
        const status = outcome
          ? outcome === 'ok'
            ? ('completed' as const)
            : outcome === 'warning'
              ? ('completed' as const)
            : outcome
          : runningInstances.has(job.instanceId)
            ? ('running' as const)
            : ('pending' as const);
        return {
          instanceId: job.instanceId,
          flowName: job.flowName,
          ...(job.targetId ? { targetId: job.targetId } : {}),
          ...(childConversationId
            ? { conversationId: childConversationId }
            : {}),
          ...(childOutcome?.reason ? { reason: childOutcome.reason } : {}),
          title: buildTrackedSubflowTitle(job),
          status,
        };
      });
      const count = (
        status: FlowSubflowWaveProgress['jobs'][number]['status'],
      ) => progressJobs.filter((job) => job.status === status).length;
      subflowWaveProgress = {
        stepPath: [...nextPath],
        ...(stepLabel ? { label: stepLabel } : {}),
        expected: jobs.length,
        running: count('running'),
        completed: count('completed'),
        failed: count('failed'),
        stopped: count('stopped'),
        notApplicable: count('not_applicable'),
        jobs: progressJobs,
        updatedAt: new Date().toISOString(),
      };
      append({
        level:
          subflowWaveProgress.failed > 0 || subflowWaveProgress.stopped > 0
            ? 'warn'
            : 'info',
        message: 'flows.run.subflow_wave_progress',
        timestamp: subflowWaveProgress.updatedAt,
        source: 'server',
        context: {
          flowName: params.flowName,
          stepPath: nextPath,
          expected: subflowWaveProgress.expected,
          running: subflowWaveProgress.running,
          completed: subflowWaveProgress.completed,
          failed: subflowWaveProgress.failed,
          stopped: subflowWaveProgress.stopped,
          notApplicable: subflowWaveProgress.notApplicable,
        },
      });
      return subflowWaveProgress;
    };
    const formatWaveCounts = (progress: FlowSubflowWaveProgress) =>
      `expected ${progress.expected}, running ${progress.running}, completed ${progress.completed}, failed ${progress.failed}, stopped ${progress.stopped}, not applicable ${progress.notApplicable}`;
    const initialWaveProgress = refreshWaveProgress();
    const runningText = initialWaveProgress
      ? `Running subflow wave: ${formatWaveCounts(initialWaveProgress)}`
      : buildSubflowSummaryText(
          launchesMultipleChildren ? 'Running subflows' : 'Running subflow',
        );
    const publishCurrentWaveProgress = () => {
      const progress = refreshWaveProgress();
      if (!progress || !getInflight(params.conversationId)) return progress;
      setAssistantText({
        conversationId: params.conversationId,
        inflightId: stepInflightId,
        text: `Running subflow wave: ${formatWaveCounts(progress)}`,
      });
      publishInflightSnapshot(params.conversationId);
      return progress;
    };
    const buildBestEffortSummary = () => {
      const outcomes = jobs.map(
        (job) =>
          childOutcomes.get(job.instanceId) ?? {
            title: buildTrackedSubflowTitle(job),
            status: 'failed' as const,
          },
      );
      const successCount = outcomes.filter(
        (entry) => entry.status === 'ok',
      ).length;
      const notApplicableCount = outcomes.filter(
        (entry) => entry.status === 'not_applicable',
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
      if (notApplicableCount > 0) {
        parts.push(`${notApplicableCount} not applicable`);
      }
      return `${buildSubflowSummaryText(
        launchesMultipleChildren ? 'Completed subflows' : 'Completed subflow',
      )} (best effort: ${parts.join(', ')})`;
    };
    const recordReviewCycleOutcome = async (paramsForOutcome: {
      flowName: string;
      status: TurnStatus;
      terminalOutcome?: FlowResumeState['terminalOutcome'];
      reason?: string;
    }) => {
      if (
        paramsForOutcome.flowName !== 'two_phase_review_cycle' ||
        paramsForOutcome.terminalOutcome === 'not_applicable'
      )
        return;
      const reviewRepositoryPath = resolveFlowGitBackedRepositoryPath(
        params.repositoryContext,
      );
      if (!reviewRepositoryPath) return;
      await finalizeActiveReviewCycleIfPending({
        workingRepositoryPath: reviewRepositoryPath,
        fallbackStatus: 'incomplete',
        fallbackReason:
          paramsForOutcome.status === 'ok'
            ? 'Two-phase review subflow ended without an explicit settlement outcome.'
            : (paramsForOutcome.reason ??
              `Two-phase review subflow ended with status ${paramsForOutcome.status}.`),
      });
    };
    const recordReviewBatchAttempt = async (paramsForAttempt: {
      job: SubflowWaveJob;
      status: ReviewInvocationAttemptStatus;
      conversationId?: string;
      reason?: string;
    }) => {
      if (!isReviewBatch || !waveInvocationId) {
        return;
      }
      const reviewRepositoryPath = resolveFlowGitBackedRepositoryPath(
        params.repositoryContext,
      );
      if (!reviewRepositoryPath) return;
      try {
        await recordReviewInvocationAttempt({
          workingRepositoryPath: reviewRepositoryPath,
          invocationId: `${waveInvocationId}--${paramsForAttempt.job.instanceId}`,
          flowName: paramsForAttempt.job.flowName,
          displayName: paramsForAttempt.job.displayName,
          status: paramsForAttempt.status,
          conversationId: paramsForAttempt.conversationId,
          reason: paramsForAttempt.reason,
          reviewCycleId: reviewAttemptIdentity?.reviewCycleId,
          reviewBatchId: reviewAttemptIdentity?.reviewBatchId,
        });
      } catch (error) {
        append({
          level: 'warn',
          message: 'flows.run.review_invocation_evidence_unavailable',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            flowName: params.flowName,
            reviewFlowName: paramsForAttempt.job.flowName,
            instanceId: paramsForAttempt.job.instanceId,
            reason: error instanceof Error ? error.message : String(error),
          },
        });
      }
    };

    const stopSubflowBeforeLaunch = async (): Promise<boolean> => {
      const pendingCancel = getPendingConversationCancel(params.conversationId);
      if (!pendingCancel || pendingCancel.runToken !== params.runToken) {
        return false;
      }

      for (const childRun of childRuns) {
        const childStatus = await getFlowConversationLifecycleStatus({
          conversationId: childRun.conversationId,
          runToken: childRun.runToken,
        });
        if (!isTerminalFlowChildLifecycleStatus(childStatus)) return false;
      }

      const consumedPendingCancel = consumePendingConversationCancel({
        conversationId: params.conversationId,
        runToken: params.runToken,
      });
      if (!consumedPendingCancel) return false;

      if (isWave) {
        jobs.forEach((job) =>
          recordChildOutcome({
            instanceId: job.instanceId,
            status: 'stopped',
          }),
        );
        await Promise.all(
          jobs.map((job) =>
            recordReviewBatchAttempt({
              job,
              status: 'stopped',
              reason:
                'The parent flow was stopped before this review batch launched.',
            }),
          ),
        );
      }
      setActiveSubflowsForStep(nextPath, []);
      refreshWaveProgress();
      await persistRuntimeResumeState(lastCompletedStepPath);
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
      await persistRuntimeResumeState(lastCompletedStepPath);
      const resumableChildRuns: FlowActiveSubflow[] = [];
      for (const childRun of childRuns) {
        const status = await getFlowConversationLifecycleStatus({
          conversationId: childRun.conversationId,
          runToken: childRun.runToken,
        });
        if (status === 'stopped') {
          const resumedChildRun = await resumeWaveChild(childRun);
          if (resumedChildRun) {
            resumableChildRuns.push(resumedChildRun);
            continue;
          }
        }
        if (
          status === 'running' ||
          isTerminalFlowChildLifecycleStatus(status)
        ) {
          resumableChildRuns.push(childRun);
          continue;
        }
        const resumedChildRun = await resumeWaveChild(childRun);
        if (resumedChildRun) {
          resumableChildRuns.push(resumedChildRun);
          continue;
        }
        recordChildOutcome({
          instanceId: activeInstanceId(childRun),
          status: 'failed',
          reason: `Subflow ${childRun.flowName} could not be resumed because child conversation ${childRun.conversationId} has no active run and no terminal result.`,
        });
      }
      childRuns.length = 0;
      childRuns.push(...resumableChildRuns);
      setActiveSubflowsForStep(nextPath, childRuns);
      publishCurrentWaveProgress();
      await persistRuntimeResumeState(lastCompletedStepPath);

      for (const job of jobs) {
        if (
          rememberedSubflowsByInstance.has(job.instanceId) ||
          childOutcomes.has(job.instanceId)
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
          await recordReviewBatchAttempt({
            job,
            status: 'scheduled',
          });
          const started = await startFlowRun({
            flowName: job.flowName,
            sourceId: params.repositoryContext.flowSourceId,
            flowPath: params.flowPath,
            codexReviewModelId: params.codexReviewModelId,
            working_folder:
              job.workingFolder ??
              params.repositoryContext.workingRepositoryPath,
            input: job.input,
            customTitle: buildTrackedSubflowTitle(job),
            ...(isWave
              ? {
                  parentWave: {
                    executionId: params.executionId,
                    instanceId: job.instanceId,
                    waveInvocationId: waveInvocationId!,
                    ...(job.targetId ? { targetId: job.targetId } : {}),
                    displayName: job.displayName,
                  },
                }
              : {}),
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
            const reason = `Subflow ${job.displayName} did not start correctly.`;
            recordChildOutcome({
              instanceId: job.instanceId,
              status: 'failed',
              reason,
              conversationId: childConversationId,
            });
            await recordReviewBatchAttempt({
              job,
              status: 'failed',
              conversationId: childConversationId,
              reason,
            });
            await recordReviewCycleOutcome({
              flowName: job.flowName,
              status: 'failed',
              reason,
            });
            publishCurrentWaveProgress();
            await persistRuntimeResumeState(lastCompletedStepPath);
            continue;
          }

          const trackedSubflow = {
            stepPath: [...nextPath],
            flowName: job.flowName,
            conversationId: childConversationId,
            runToken: childRunToken,
            instanceId: job.instanceId,
            ...(waveInvocationId ? { waveInvocationId } : {}),
            ...(job.targetId ? { targetId: job.targetId } : {}),
            ...(job.workingFolder ? { workingFolder: job.workingFolder } : {}),
            ...(job.input ? { input: job.input } : {}),
            ...(job.inputHash ? { inputHash: job.inputHash } : {}),
            title: buildTrackedSubflowTitle(job),
          };
          rememberedSubflowsByInstance.set(job.instanceId, trackedSubflow);
          childRuns.push(trackedSubflow);
          await recordReviewBatchAttempt({
            job,
            status: 'running',
            conversationId: childConversationId,
          });
          setActiveSubflowsForStep(nextPath, childRuns);
          publishCurrentWaveProgress();
          await persistRuntimeResumeState(lastCompletedStepPath);
        } catch (error) {
          const reason = isFlowRunError(error)
            ? (error.reason ?? error.code)
            : error instanceof Error
              ? error.message
              : `Subflow ${job.displayName} failed to start.`;
          recordChildOutcome({
            instanceId: job.instanceId,
            status: 'failed',
            reason,
            conversationId: childConversationId,
          });
          await recordReviewBatchAttempt({
            job,
            status: 'failed',
            conversationId: childConversationId,
            reason,
          });
          await recordReviewCycleOutcome({
            flowName: job.flowName,
            status: 'failed',
            reason,
          });
          publishCurrentWaveProgress();
          await persistRuntimeResumeState(lastCompletedStepPath);
        }
      }

      let terminalStatus: TurnStatus;
      let terminalSummary:
        | {
            completedChildTitles: string[];
            stoppedChildTitles: string[];
          }
        | undefined;
      let parentStopRequested = false;
      let allChildrenOkObservedAt: number | null = null;
      while (true) {
        const parentPendingCancel = consumePendingConversationCancel({
          conversationId: params.conversationId,
          runToken: params.runToken,
        });
        if (parentPendingCancel) {
          parentStopRequested = true;
          await stopActiveSubflowsAndWaitForTerminalStatus();
        }

        const childStatuses = await Promise.all(
          childRuns.map(async (childRun) => {
            const lifecycleStatus = await getFlowConversationLifecycleStatus({
              conversationId: childRun.conversationId,
              runToken: childRun.runToken,
            });
            const status = isTerminalFlowChildLifecycleStatus(lifecycleStatus)
              ? lifecycleStatus
              : null;
            return {
              childRun,
              lifecycleStatus,
              status,
              terminalOutcome: status
                ? await getFlowConversationTerminalOutcome(
                    childRun.conversationId,
                  )
                : undefined,
            };
          }),
        );
        let progressChanged = false;
        for (const { childRun, status, terminalOutcome } of childStatuses) {
          const instanceId = activeInstanceId(childRun);
          if (!status || childOutcomes.has(instanceId)) continue;
          recordChildOutcome({
            instanceId,
            status:
              status === 'ok' && terminalOutcome === 'not_applicable'
                ? 'not_applicable'
                : status,
            conversationId: childRun.conversationId,
          });
          const childJob = jobByInstanceId.get(instanceId);
          if (childJob) {
            await recordReviewBatchAttempt({
              job: childJob,
              status:
                status === 'ok' && terminalOutcome === 'not_applicable'
                  ? 'not_applicable'
                  : status === 'ok' || status === 'warning'
                    ? 'completed'
                    : status,
              conversationId: childRun.conversationId,
              ...(status === 'failed'
                ? {
                    reason:
                      'The review batch child flow ended with a failed status.',
                  }
                : {}),
            });
          }
          await recordReviewCycleOutcome({
            flowName: childRun.flowName,
            status,
            terminalOutcome,
          });
          progressChanged = true;
        }
        if (progressChanged) {
          publishCurrentWaveProgress();
          await persistRuntimeResumeState(lastCompletedStepPath);
        }
        const orphanedChildren = childStatuses.filter(
          ({ lifecycleStatus }) => lifecycleStatus === 'orphaned',
        );
        if (orphanedChildren.length > 0) {
          const resumedChildren = await Promise.all(
            orphanedChildren.map(async ({ childRun }) => {
              const resumedChildRun = await resumeWaveChild(childRun);
              return resumedChildRun
                ? { instanceId: activeInstanceId(childRun), resumedChildRun }
                : null;
            }),
          );
          const resumedByInstanceId = new Map<string, FlowActiveSubflow>(
            resumedChildren.flatMap((entry) =>
              entry ? [[entry.instanceId, entry.resumedChildRun]] : [],
            ),
          );
          if (resumedByInstanceId.size > 0) {
            childRuns.forEach((childRun, index) => {
              const instanceId = activeInstanceId(childRun);
              const resumedChildRun = resumedByInstanceId.get(instanceId);
              if (!resumedChildRun) return;
              childRuns[index] = resumedChildRun;
              rememberedSubflowsByInstance.set(instanceId, resumedChildRun);
            });
            setActiveSubflowsForStep(nextPath, childRuns);
            publishCurrentWaveProgress();
            await persistRuntimeResumeState(lastCompletedStepPath);
            allChildrenOkObservedAt = null;
            continue;
          }
        }
        const staleChildren = childStatuses.filter(
          ({ lifecycleStatus }) => lifecycleStatus === 'missing',
        );
        if (staleChildren.length > 0) {
          const staleConversationIds = new Set<string>();
          staleChildren.forEach(({ childRun }) => {
            staleConversationIds.add(childRun.conversationId);
            recordChildOutcome({
              instanceId: activeInstanceId(childRun),
              status: 'failed',
              reason: `Subflow ${childRun.flowName} could not be resumed because child conversation ${childRun.conversationId} has no active run and no terminal result.`,
              conversationId: childRun.conversationId,
            });
          });
          await Promise.all(
            staleChildren.map(({ childRun }) => {
              const childJob = jobByInstanceId.get(activeInstanceId(childRun));
              return childJob
                ? recordReviewBatchAttempt({
                    job: childJob,
                    status: 'failed',
                    conversationId: childRun.conversationId,
                    reason: `The child conversation has no active run and no terminal result.`,
                  })
                : Promise.resolve();
            }),
          );
          const remainingChildRuns = childRuns.filter(
            (childRun) => !staleConversationIds.has(childRun.conversationId),
          );
          childRuns.length = 0;
          childRuns.push(...remainingChildRuns);
          setActiveSubflowsForStep(nextPath, childRuns);
          publishCurrentWaveProgress();
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
          hasPropagatedGitHubReviewWarning ||= terminalStatuses.includes(
            'warning',
          );
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
          if (parentStopRequested || terminalStatuses.includes('stopped')) {
            const completedChildTitles = childStatuses
              .filter(({ status }) => status === 'ok')
              .map(({ childRun }) => childRun.title ?? childRun.flowName);
            const stoppedChildTitles = childStatuses
              .filter(({ status }) => status === 'stopped')
              .map(({ childRun }) => childRun.title ?? childRun.flowName);
            if (
              childStatuses.length === 0 ||
              stoppedChildTitles.length === childStatuses.length
            ) {
              terminalStatus = 'stopped';
            } else {
              terminalStatus = 'warning';
              terminalSummary = {
                completedChildTitles,
                stoppedChildTitles,
              };
            }
          } else if (terminalStatuses.includes('warning')) {
            terminalStatus = 'warning';
          } else {
            terminalStatus = 'ok';
          }
          break;
        }
        allChildrenOkObservedAt = null;

        await sleep(25);
      }

      if (parentStopRequested) {
        const newlyStoppedJobs: SubflowWaveJob[] = [];
        jobs.forEach((job) => {
          if (!childOutcomes.has(job.instanceId)) {
            recordChildOutcome({
              instanceId: job.instanceId,
              status: 'stopped',
            });
            newlyStoppedJobs.push(job);
          }
        });
        await Promise.all(
          newlyStoppedJobs.map((job) =>
            recordReviewBatchAttempt({
              job,
              status: 'stopped',
              reason:
                'The parent flow stopped before the review batch reached a terminal result.',
            }),
          ),
        );
      }
      setActiveSubflowsForStep(nextPath, []);
      const finalWaveProgress = refreshWaveProgress();

      const nonOkChildCount = [...childOutcomes.values()].filter(
        (entry) => entry.status === 'failed' || entry.status === 'stopped',
      ).length;
      const finalMessage = finalWaveProgress
        ? `${terminalStatus === 'stopped' ? 'Stopped' : terminalStatus === 'warning' ? 'Completed with warnings' : 'Completed'} subflow wave: ${formatWaveCounts(finalWaveProgress)}`
        : terminalStatus === 'stopped'
          ? buildSubflowSummaryText(
              launchesMultipleChildren ? 'Stopped subflows' : 'Stopped subflow',
            )
          : terminalStatus === 'warning'
            ? (() => {
                const completed =
                  terminalSummary?.completedChildTitles.join(', ') ?? '';
                const stopped =
                  terminalSummary?.stoppedChildTitles.join(', ') ?? '';
                if (stopped && completed) {
                  return `Subflow batch stop had mixed child outcomes (stopped: ${stopped}; completed: ${completed})`;
                }
                if (completed) {
                  return `Subflow stop request arrived after child completion (completed: ${completed})`;
                }
                return buildSubflowSummaryText(
                  launchesMultipleChildren
                    ? hasPropagatedGitHubReviewWarning
                      ? 'Completed subflows with warning'
                      : 'Subflow batch stop completed with warnings for'
                    : hasPropagatedGitHubReviewWarning
                      ? 'Completed subflow with warning'
                      : 'Subflow stop completed with warnings for',
                );
              })()
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
      const terminalChildren =
        await stopActiveSubflowsAndWaitForTerminalStatus();
      if (isWave) {
        for (const { childRun, status } of terminalChildren) {
          const instanceId = activeInstanceId(childRun);
          if (childOutcomes.has(instanceId)) continue;
          const terminalOutcome = await getFlowConversationTerminalOutcome(
            childRun.conversationId,
          );
          recordChildOutcome({
            instanceId,
            status:
              status === 'ok' && terminalOutcome === 'not_applicable'
                ? 'not_applicable'
                : status,
            conversationId: childRun.conversationId,
          });
          const childJob = jobByInstanceId.get(instanceId);
          if (childJob) {
            await recordReviewBatchAttempt({
              job: childJob,
              status:
                status === 'ok' && terminalOutcome === 'not_applicable'
                  ? 'not_applicable'
                  : status === 'ok' || status === 'warning'
                    ? 'completed'
                    : status,
              conversationId: childRun.conversationId,
            });
          }
          await recordReviewCycleOutcome({
            flowName: childRun.flowName,
            status,
            terminalOutcome,
          });
        }
        const newlyFailedJobs: SubflowWaveJob[] = [];
        jobs.forEach((job) => {
          if (!childOutcomes.has(job.instanceId)) {
            recordChildOutcome({
              instanceId: job.instanceId,
              status: 'failed',
            });
            newlyFailedJobs.push(job);
          }
        });
        await Promise.all(
          newlyFailedJobs.map((job) =>
            recordReviewBatchAttempt({
              job,
              status: 'failed',
              reason:
                'The parent wave failed before this review batch reached a terminal result.',
            }),
          ),
        );
      }
      setActiveSubflowsForStep(nextPath, []);
      const failedWaveProgress = refreshWaveProgress();
      await persistRuntimeResumeState(lastCompletedStepPath);
      const failureReason = isFlowRunError(error)
        ? (error.reason ?? error.code)
        : error instanceof Error
          ? error.message
          : launchesMultipleChildren
            ? `Failed to run subflows ${childFlowNames.join(', ')}`
            : `Failed to run subflow ${childFlowNames[0]}`;
      const message = failedWaveProgress
        ? `Failed subflow wave: ${formatWaveCounts(failedWaveProgress)}. ${failureReason}`
        : failureReason;
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

  const runSubflowStep = (
    step: FlowSubflowStep,
    command: TurnCommandMetadata,
    nextPath: number[],
  ) =>
    runSubflowJobs(
      step.flowNames.map((flowName) => ({
        instanceId: flowName,
        flowName,
        displayName: flowName,
      })),
      step.label,
      command,
      nextPath,
    );

  const runSubflowWaveStep = async (
    step: FlowSubflowWaveStep,
    command: TurnCommandMetadata,
    nextPath: number[],
  ) => {
    const root = { ...(params.input ?? {}), ...flowValues };
    let jobs = expandSubflowWaveJobs({ step, input: root });
    let reviewAttemptIdentity:
      | { reviewCycleId?: string; reviewBatchId?: string }
      | undefined;
    if (step.reviewWorkspace) {
      const snapshot = resolveFlowValue(
        root,
        step.reviewWorkspace.snapshotFrom,
      );
      if (
        !snapshot ||
        typeof snapshot !== 'object' ||
        Array.isArray(snapshot)
      ) {
        throw toFlowRunError(
          'INVALID_REQUEST',
          `Review workspace snapshot binding "${step.reviewWorkspace.snapshotFrom}" did not resolve.`,
        );
      }
      const reviewSnapshot = snapshot as ReviewTargetSnapshot;
      reviewAttemptIdentity = {
        reviewCycleId: reviewSnapshot.review_cycle_id,
        reviewBatchId: reviewSnapshot.review_wave_id,
      };
      try {
        const workspace = await prepareReviewBatchWorkspace({
          snapshot: reviewSnapshot,
          jobs,
          signal: getInflight(params.conversationId)?.abortController.signal,
        });
        jobs = workspace.jobs;
        append({
          level: 'info',
          message: 'flows.run.review_batch_workspace_prepared',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            flowName: params.flowName,
            batchId: workspace.batchId,
            batchRoot: workspace.batchRoot,
            jobCount: workspace.jobs.length,
          },
        });
      } catch (error) {
        const reviewRepositoryPath = resolveFlowGitBackedRepositoryPath(
          params.repositoryContext,
        );
        const waveInvocationId = getWaveInvocationId(
          nextPath,
          loopStack,
          waveInvocationGeneration,
        );
        const reason =
          error instanceof Error
            ? error.message
            : 'Review workspace preparation failed.';
        if (reviewRepositoryPath) {
          try {
            await Promise.all(
              jobs.map((job) =>
                recordReviewInvocationAttempt({
                  workingRepositoryPath: reviewRepositoryPath,
                  invocationId: `${waveInvocationId}--${job.instanceId}`,
                  flowName: job.flowName,
                  displayName: job.displayName,
                  status: 'failed',
                  reason,
                  reviewCycleId: reviewAttemptIdentity?.reviewCycleId,
                  reviewBatchId: reviewAttemptIdentity?.reviewBatchId,
                }),
              ),
            );
          } catch (attemptError) {
            append({
              level: 'warn',
              message: 'flows.run.review_invocation_evidence_unavailable',
              timestamp: new Date().toISOString(),
              source: 'server',
              context: {
                flowName: params.flowName,
                reason:
                  attemptError instanceof Error
                    ? attemptError.message
                    : String(attemptError),
              },
            });
          }
        }
        throw error;
      }
    }
    return runSubflowJobs(
      jobs,
      step.label,
      command,
      nextPath,
      true,
      Boolean(step.reviewWorkspace) ||
        jobs.some((job) => job.flowName === 'review_batch'),
      reviewAttemptIdentity,
    );
  };

  const runCommandStep = async (
    step: FlowCommandStep,
    command: TurnCommandMetadata,
    nextPath: number[],
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
    appendCommandRuntimeDiagnostic('step_begin', {
      commandName: step.commandName,
      agentType: step.agentType,
      identifier: step.identifier,
      stepPath: nextPath,
      retryBudget: maxStepAttempts,
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
      activeCommandDiagnosticState = {
        commandName: step.commandName,
        attempt,
        stepPath: [...nextPath],
      };
      if (await stopCommandBeforeHandoff()) {
        return 'stopped';
      }
      appendCommandRuntimeDiagnostic('load_attempt', {
        commandName: step.commandName,
        agentType: step.agentType,
        identifier: step.identifier,
        attempt,
        retryBudget: maxStepAttempts,
        stepPath: nextPath,
      });
      const commandLoad = await resolveFlowCommandForAgent({
        step,
        context: params.repositoryContext,
        phase: 'execution',
      });
      if (!commandLoad.ok) {
        appendCommandRuntimeDiagnostic('load_failure', {
          commandName: step.commandName,
          agentType: step.agentType,
          identifier: step.identifier,
          attempt,
          stepPath: nextPath,
          errorCode: commandLoad.reason,
          errorMessage: commandLoad.message,
          commandFilePath: commandLoad.commandFilePath ?? null,
          candidateAgentHomes: commandLoad.candidateAgentHomes ?? [],
        });
        appendCommandRuntimeDiagnostic('retry_decision', {
          commandName: step.commandName,
          attempt,
          maxRetries: maxStepAttempts - 1,
          willRetry: attempt < maxStepAttempts,
          terminalStatus: attempt < maxStepAttempts ? null : 'failed',
          nextAttemptDelayMs:
            attempt < maxStepAttempts
              ? FLOW_STEP_BASE_DELAY_MS * 2 ** (attempt - 1)
              : null,
        });
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
        appendCommandRuntimeDiagnostic('terminal_failure_publish_begin', {
          commandName: step.commandName,
          attempt,
          finalErrorCode: 'COMMAND_INVALID',
          finalErrorMessage: commandLoad.message,
          inflightId: stepInflightId,
          ownershipRunToken:
            getActiveRunOwnership(params.conversationId)?.runToken ?? null,
        });
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
        appendCommandRuntimeDiagnostic('terminal_failure_publish_complete', {
          commandName: step.commandName,
          attempt,
          finalStatus: 'failed',
          assistantTurnPersisted: true,
          inflightId: stepInflightId,
          ownershipRunToken:
            getActiveRunOwnership(params.conversationId)?.runToken ?? null,
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

      const commandWorkingFolder =
        params.repositoryContext.workingRepositoryPath ??
        (commandLoad.sourceRank === 'owner_repository' ||
        commandLoad.sourceRank === 'working_repository'
          ? commandLoad.sourceId
          : undefined);
      const commandRuntime: TurnRuntimeMetadata = {
        ...(commandWorkingFolder
          ? { workingFolder: commandWorkingFolder }
          : {}),
        lookupSummary: commandLoad.lookupSummary,
      };
      appendCommandRuntimeDiagnostic('runtime_context_ready', {
        commandName: step.commandName,
        attempt,
        stepPath: nextPath,
        commandSourceId: commandLoad.sourceId,
        commandSourceRank: commandLoad.sourceRank,
        commandWorkingFolder: commandWorkingFolder ?? null,
        lookupSelectedRepositoryPath:
          commandRuntime.lookupSummary?.selectedRepositoryPath ?? null,
        lookupFallbackUsed: commandRuntime.lookupSummary?.fallbackUsed ?? null,
      });

      for (const [itemIndex, item] of commandLoad.command.items.entries()) {
        if (await stopCommandBeforeHandoff()) {
          return 'stopped';
        }
        let executedItem:
          | { itemType: 'message'; result: FlowInstructionResult }
          | { itemType: 'skip' }
          | { itemType: 'reingest'; result: ExecuteCommandItemReingestResult };
        try {
          appendCommandRuntimeDiagnostic('item_dispatch_begin', {
            commandName: step.commandName,
            itemIndex,
            itemType: item.type,
            stepPath: nextPath,
            attempt,
          });
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
              const flowServiceDeps = getEffectiveFlowServiceDeps();
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
          appendCommandRuntimeDiagnostic('item_dispatch_complete', {
            commandName: step.commandName,
            itemIndex,
            itemType: item.type,
            stepPath: nextPath,
            attempt,
            resultType: executedItem.itemType,
            resultStatus:
              executedItem.itemType === 'message'
                ? executedItem.result.status
                : executedItem.itemType === 'reingest'
                  ? executedItem.result.stopAfter
                    ? 'stopped'
                    : 'ok'
                  : 'skip',
          });
        } catch (error) {
          appendCommandRuntimeDiagnostic('item_dispatch_failed', {
            commandName: step.commandName,
            itemIndex,
            itemType: item.type,
            stepPath: nextPath,
            attempt,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to execute flow command message item',
          });
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
      appendCommandRuntimeDiagnostic('step_complete', {
        commandName: step.commandName,
        stepPath: nextPath,
        attempt,
      });
      return 'ok';
    }

    return 'failed';
  };

  const runInitializeReviewCycleStep = async (
    step: FlowInitializeReviewCycleStep,
    command: TurnCommandMetadata,
  ): Promise<{ status: TurnStatus; exitFlow: boolean }> => {
    const reviewRepositoryPath = resolveFlowGitBackedRepositoryPath(
      params.repositoryContext,
    );
    const instruction = `Initialize ${step.mode} review cycle`;
    if (!reviewRepositoryPath) {
      await emitCompletedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        response:
          'Skipped review initialization because no working repository path was resolved.',
        command,
      });
      return { status: 'ok', exitFlow: true };
    }
    const inflightState = createInflight({
      conversationId: params.conversationId,
      inflightId: stepInflightId,
      provider: params.providerId,
      model: params.modelId,
      source: params.source,
      command,
    });
    try {
      const result = await initializeReviewCycle({
        workingRepositoryPath: reviewRepositoryPath,
        mode: step.mode,
        signal: inflightState.abortController.signal,
      });
      flowValues[step.outputKey] = normalizeFlowInput({
        action: result.action,
        review_mode: step.mode,
        story_id: result.storyId,
        plan_path: result.planPath,
        readiness: result.readiness,
        ...(result.cycle ?? {}),
      });
      if (step.mode === 'final' && result.action === 'initialized') {
        initializedFinalReviewCycle = true;
      }
      const exitFlow = false;
      await emitCompletedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        response:
          result.action === 'diagnostic'
            ? 'Initialized isolated diagnostic review without final-review disposition ownership.'
            : `Initialized review cycle ${result.cycle?.review_cycle_id}.`,
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        command,
      });
      return { status: 'ok', exitFlow };
    } catch (error) {
      if (inflightState.abortController.signal.aborted) {
        await emitStoppedFlowStep({
          flowConversationId: params.conversationId,
          inflightId: stepInflightId,
          instruction,
          modelId: params.modelId,
          providerId: params.providerId,
          source: params.source,
          command,
        });
        return { status: 'stopped', exitFlow: false };
      }
      if (reviewRepositoryPath) {
        const failurePath = path.join(
          reviewRepositoryPath,
          'codeInfoStatus',
          'flow-state',
          'review-initialization-failure.json',
        );
        const temporaryPath = `${failurePath}.tmp-${process.pid}-${Date.now()}`;
        await fs.mkdir(path.dirname(failurePath), { recursive: true });
        await fs.writeFile(
          temporaryPath,
          `${JSON.stringify(
            {
              schema_version: 'codeinfo-review-initialization-failure/v1',
              status: 'failed',
              reason: error instanceof Error ? error.message : String(error),
              completed_at: new Date().toISOString(),
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
        await fs.rename(temporaryPath, failurePath);
      }
      await emitFailedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        message: `Review initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: 'INVALID_REQUEST',
        command,
      });
      return { status: 'failed', exitFlow: false };
    }
  };

  const runPrepareReviewTargetsStep = async (
    step: FlowPrepareReviewTargetsStep,
    command: TurnCommandMetadata,
  ): Promise<TurnStatus> => {
    const reviewRepositoryPath = resolveFlowGitBackedRepositoryPath(
      params.repositoryContext,
    );
    if (!reviewRepositoryPath) {
      await emitFailedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction: `Prepare review targets: ${step.outputKey}`,
        modelId: params.modelId,
        providerId: params.providerId,
        source: params.source,
        message:
          'prepareReviewTargets requires a resolved working repository path.',
        errorCode: 'INVALID_REQUEST',
        command,
      });
      return 'failed';
    }

    const instruction = `Prepare review targets: ${step.outputKey}`;
    const inflightState = createInflight({
      conversationId: params.conversationId,
      inflightId: stepInflightId,
      provider: params.providerId,
      model: params.modelId,
      source: params.source,
      command,
    });
    const inflightSignal = inflightState.abortController.signal;
    try {
      const result = await prepareReviewTargets(
        {
          workingRepositoryPath: reviewRepositoryPath,
          reviewMode: step.reviewMode,
          signal: inflightSignal,
        },
        {
          listIngestedRepositories:
            params.repositoryContext.listIngestedRepositories,
        },
      );
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
      flowValues[step.outputKey] = normalizeFlowInput(result.snapshot);
      await emitCompletedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        response: [
          `Prepared ${result.snapshot.targets.length} immutable review target(s).`,
          `Review wave: ${result.snapshot.review_wave_id}`,
          `Artifact: ${path.relative(reviewRepositoryPath, result.versionedPath)}`,
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
            : 'prepareReviewTargets failed unexpectedly',
        errorCode: 'INVALID_REQUEST',
        command,
      });
      return 'failed';
    }
  };

  const runPrepareCopilotReviewGroupsStep = async (
    step: FlowPrepareCopilotReviewGroupsStep,
    command: TurnCommandMetadata,
  ): Promise<TurnStatus> => {
    const instruction = `Prepare Copilot review groups: ${step.outputKey}`;
    const inflightState = createInflight({
      conversationId: params.conversationId,
      inflightId: stepInflightId,
      provider: params.providerId,
      model: params.modelId,
      source: params.source,
      command,
    });
    const inflightSignal = inflightState.abortController.signal;
    try {
      const root = { ...(params.input ?? {}), ...flowValues };
      const reviewGroups = resolveFlowValue(root, step.groupsFrom);
      const repositoryTargets = resolveFlowValue(root, step.targetsFrom);
      const reviewWave = resolveFlowValue(root, step.reviewWaveFrom);
      const enabledValue = step.enabledFrom
        ? resolveFlowValue(root, step.enabledFrom)
        : undefined;
      if (reviewGroups === undefined) {
        throw new Error(
          `prepareCopilotReviewGroups binding "${step.groupsFrom}" did not resolve.`,
        );
      }
      if (repositoryTargets === undefined) {
        throw new Error(
          `prepareCopilotReviewGroups binding "${step.targetsFrom}" did not resolve.`,
        );
      }
      if (reviewWave === undefined) {
        throw new Error(
          `prepareCopilotReviewGroups binding "${step.reviewWaveFrom}" did not resolve.`,
        );
      }
      if (enabledValue !== undefined && typeof enabledValue !== 'boolean') {
        throw new Error(
          `prepareCopilotReviewGroups binding "${step.enabledFrom}" must resolve to a boolean when supplied.`,
        );
      }
      const reviewEnv =
        enabledValue === false
          ? { ...process.env, CODEINFO_COPILOT_REVIEW_MODELS: '' }
          : process.env;
      const result = await prepareCopilotReviewGroups({
        reviewGroups,
        repositoryTargets,
        targetItemsFrom: step.targetsFrom,
        reviewWaveFrom: step.reviewWaveFrom,
        env: reviewEnv,
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
      flowValues[step.outputKey] = normalizeFlowInput({
        groups: result.effectiveReviewGroups,
      }).groups!;
      await emitCompletedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        response: [
          `Prepared ${result.modelCount} Copilot review model(s) across ${result.repositoryCount} repository target(s).`,
          `Copilot jobs: ${result.copilotJobCount}`,
          `Configuration warnings: ${result.configurationWarnings.length}`,
          `Effective review groups: ${result.effectiveReviewGroups.length}`,
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
            : 'prepareCopilotReviewGroups failed unexpectedly',
        errorCode: 'INVALID_REQUEST',
        command,
      });
      return 'failed';
    }
  };

  const runCopilotReviewStep = async (
    step: FlowRunCopilotReviewStep,
    command: TurnCommandMetadata,
  ): Promise<TurnStatus> => {
    const instruction = 'Run scheduler-owned Copilot review';
    const inflightState = createInflight({
      conversationId: params.conversationId,
      inflightId: stepInflightId,
      provider: params.providerId,
      model: params.modelId,
      source: params.source,
      command,
    });
    const inflightSignal = inflightState.abortController.signal;
    try {
      const result = await executeCopilotReviewStep(
        params.input ?? {},
        step,
        inflightSignal,
        {
          runCopilotReview: getEffectiveFlowServiceDeps().runCopilotReview,
        },
      );
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
          `Copilot review status: ${result.status}`,
          `Copilot launched: ${result.launched ? 'yes' : 'no'}`,
          `Exit status: ${result.exitStatus}`,
          `Completed at: ${result.completedAt}`,
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
            : 'runCopilotReview failed unexpectedly',
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
          runReingestRepository:
            getEffectiveFlowServiceDeps().runReingestRepository,
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

    const flowServiceDeps = getEffectiveFlowServiceDeps();
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
    githubReviewRecoveryScope = false,
  ): Promise<FlowStepOutcome> => {
    appendFlowRuntimeDiagnostic('flows.test.loop_step_enter', {
      conversationId: params.conversationId,
      executionId: params.executionId,
      stepPath: nextPath,
      resumePath,
      loopDepth: loopStack.length,
      pendingLoopControlKind: pendingLoopControl?.kind ?? null,
      savedIteration:
        resumeLoopIterations.get(getStepPathKey(nextPath)) ?? null,
    });
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
      appendLoopContinueRuntimeDiagnostic('resume_after_continue_iteration', {
        loopStepPath: [...nextPath],
        savedIteration,
      });
    }
    while (true) {
      if (
        step.maxIterations !== undefined &&
        loopFrame.iteration >= step.maxIterations
      ) {
        lastLoopExit = {
          loopStepPath: [...nextPath],
          iteration: loopFrame.iteration,
          reason: 'max_iterations',
        };
        append({
          level: 'warn',
          message: 'flows.run.loop_max_iterations_reached',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            flowName: params.flowName,
            conversationId: params.conversationId,
            loopStepPath: nextPath,
            iteration: loopFrame.iteration,
            maxIterations: step.maxIterations,
          },
        });
        loopStack.pop();
        break;
      }
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
      appendLoopContinueRuntimeDiagnostic('loop_iteration_start', {
        loopStepPath: [...nextPath],
        iteration: loopFrame.iteration,
        resumeForLoop,
      });
      const outcome = await runSteps(
        step.steps,
        nextPath,
        resumeForLoop,
        githubReviewRecoveryScope,
      );
      if (resumeForLoop) resumeForLoop = null;
      appendLoopContinueRuntimeDiagnostic('loop_iteration_outcome', {
        loopStepPath: [...nextPath],
        iteration: loopFrame.iteration,
        outcome,
      });
      if (outcome === 'continue') {
        continue;
      }
      if (outcome === 'break') {
        lastLoopExit = {
          loopStepPath: [...nextPath],
          iteration: loopFrame.iteration,
          reason: 'break',
        };
        loopStack.pop();
        break;
      }
      if (outcome !== 'ok') {
        params.onStopUnwindCheckpoint?.({
          checkpoint: 'runStartLoopStep.return.non_ok',
          conversationId: params.conversationId,
          detail: `outcome=${outcome} loopDepth=${loopStack.length}`,
        });
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
    githubReviewRecoveryScope = false,
  ): Promise<FlowStepOutcome> => {
    const appendNextStepDispatchExpected = (
      currentPath: number[],
      stepIndex: number,
      nextSiblingIndex: number,
    ) => {
      appendFlowRuntimeDiagnostic('flows.test.next_step_dispatch_expected', {
        conversationId: params.conversationId,
        executionId: params.executionId,
        stepPath: currentPath,
        stepIndex,
        nextSiblingStepPath:
          nextSiblingIndex < steps.length
            ? [...stepPath, nextSiblingIndex]
            : null,
        nextSiblingStepType:
          nextSiblingIndex < steps.length
            ? (steps[nextSiblingIndex]?.type ?? null)
            : null,
        loopDepth: loopStack.length,
      });
    };
    let resumePathRemaining =
      resumePath && resumePath.length > 0 ? [...resumePath] : null;
    let resumeIndex = resumePathRemaining?.[0];
    const scopedGitHubRecovery = {
      eligible: githubReviewRecoveryScope,
      skipScopeOnExhaustion: githubReviewRecoveryScope,
    };
    const nativeGitHubRecovery = {
      eligible: true,
      skipScopeOnExhaustion: githubReviewRecoveryScope,
    };

    for (const [index, step] of steps.entries()) {
      const indexForExpectedNextStep = index + 1;
      if (
        resumePathRemaining &&
        resumeIndex !== undefined &&
        index < resumeIndex
      ) {
        continue;
      }

      const nextPath = [...stepPath, index];
      appendFlowRuntimeDiagnostic('flows.test.step_dispatch', {
        conversationId: params.conversationId,
        executionId: params.executionId,
        stepPath: nextPath,
        stepType: step.type,
        stepIndex: index + 1,
        totalSteps: steps.length,
        loopDepth: loopStack.length,
      });
      if (resumePathRemaining && resumeIndex === index) {
        if (resumePathRemaining.length === 1) {
          const reenterInterruptedWave =
            interruptedWaveStepPathKey === getStepPathKey(nextPath);
          resumePathRemaining = null;
          resumeIndex = undefined;
          if (!reenterInterruptedWave) {
            continue;
          }
        } else {
          const nestedResumePath = resumePathRemaining.slice(1);
          const outcome =
            step.type === 'startLoop'
              ? await runStartLoopStep(
                  step,
                  nextPath,
                  nestedResumePath,
                  githubReviewRecoveryScope,
                )
              : step.type === 'if'
                ? await runIfStep(
                    step,
                    buildFlowCommandMetadata({
                      step,
                      stepIndex: index + 1,
                      totalSteps: steps.length,
                      loopDepth: loopStack.length,
                    }),
                    nextPath,
                    nestedResumePath,
                    githubReviewRecoveryScope,
                  )
                : (() => {
                    throw toFlowRunError(
                      'INVALID_REQUEST',
                      'resumeStepPath must reference loop or conditional branch steps for nested indices',
                    );
                  })();
          resumePathRemaining = null;
          resumeIndex = undefined;
          if (outcome !== 'ok') return outcome;
          continue;
        }
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
        appendFlowRuntimeDiagnostic('flows.test.llm_step_completed', {
          conversationId: params.conversationId,
          executionId: params.executionId,
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          agentType: command.agentType,
          status,
          loopDepth: loopStack.length,
        });
        appendLoopContinueRuntimeDiagnostic('llm_step_completed', {
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          status,
        });
        if (status === 'failed' && step.continueOnFailure === true) {
          append({
            level: 'warn',
            message: 'flows.run.llm_failure_continued',
            timestamp: new Date().toISOString(),
            source: 'server',
            context: {
              flowName: params.flowName,
              stepIndex: command.stepIndex,
              label: step.label ?? null,
              agentType: step.agentType,
              identifier: step.identifier,
            },
          });
          baseLogger.warn(
            {
              flowName: params.flowName,
              stepIndex: command.stepIndex,
              label: step.label ?? null,
              agentType: step.agentType,
              identifier: step.identifier,
            },
            'flows.run.llm_failure_continued',
          );
          lastCompletedStepPath = nextPath;
          hasContinuedAfterFailure = true;
          clearContinueBoundaryForActiveLoop();
          await persistRuntimeResumeState(lastCompletedStepPath);
          stepInflightId = crypto.randomUUID();
          continue;
        }
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.llm',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          const recovery = await recoverGitHubReviewStepFailure(
            status,
            nextPath,
            scopedGitHubRecovery,
          );
          if (recovery) return recovery;
          continue;
        }
        lastCompletedStepPath = nextPath;
        hasContinuedAfterFailure = false;
        appendFlowRuntimeDiagnostic('flows.test.llm_step_state_advanced', {
          conversationId: params.conversationId,
          executionId: params.executionId,
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          loopDepth: loopStack.length,
        });
        clearContinueBoundaryForActiveLoop();
        if (
          await stopAfterSuccessfulStepIfPendingCancel({
            checkpoint: 'runSteps.return.stop.pending_cancel.after_llm',
            detail: `step=${command.stepIndex} loopDepth=${loopStack.length}`,
          })
        ) {
          return 'stopped';
        }
        appendFlowRuntimeDiagnostic(
          'flows.test.llm_step_resume_state_persist_begin',
          {
            conversationId: params.conversationId,
            executionId: params.executionId,
            stepPath: nextPath,
            stepIndex: command.stepIndex,
            loopDepth: loopStack.length,
          },
        );
        await persistRuntimeResumeState(lastCompletedStepPath);
        appendFlowRuntimeDiagnostic(
          'flows.test.llm_step_resume_state_persist_complete',
          {
            conversationId: params.conversationId,
            executionId: params.executionId,
            stepPath: nextPath,
            stepIndex: command.stepIndex,
            loopDepth: loopStack.length,
          },
        );
        appendFlowRuntimeDiagnostic('flows.test.llm_step_continue', {
          conversationId: params.conversationId,
          executionId: params.executionId,
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          nextSiblingStepIndex: index + 1 < steps.length ? index + 2 : null,
          loopDepth: loopStack.length,
        });
        appendNextStepDispatchExpected(
          nextPath,
          command.stepIndex,
          indexForExpectedNextStep,
        );
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
        const { status, shouldBreak, source, failureKind } = await runBreakStep(
          step,
          command,
        );
        appendLoopContinueRuntimeDiagnostic('break_step_completed', {
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          status,
          shouldBreak,
        });
        const shouldBreakAfterFailure =
          status === 'failed' &&
          source !== 'script' &&
          step.breakOnFailure === true;
        if (shouldBreakAfterFailure) {
          append({
            level: 'warn',
            message: 'flows.run.break_failure_broke_loop',
            timestamp: new Date().toISOString(),
            source: 'server',
            context: {
              flowName: params.flowName,
              stepIndex: command.stepIndex,
              label: step.label ?? null,
              agentType: step.agentType,
              identifier: step.identifier,
            },
          });
          baseLogger.warn(
            {
              flowName: params.flowName,
              stepIndex: command.stepIndex,
              label: step.label ?? null,
              agentType: step.agentType,
              identifier: step.identifier,
            },
            'flows.run.break_failure_broke_loop',
          );
          lastCompletedStepPath = nextPath;
          clearContinueBoundaryForActiveLoop();
          await persistRuntimeResumeState(lastCompletedStepPath);
          stepInflightId = crypto.randomUUID();
          return 'break';
        }
        if (shouldStopAfter(status)) {
          if (
            status === 'failed' &&
            ((source !== 'script' &&
              step.continueOnFailure &&
              failureKind === 'execution') ||
              (step.continueOnInvalidResponse &&
                failureKind === 'invalid_response'))
          ) {
            lastCompletedStepPath = nextPath;
            clearContinueBoundaryForActiveLoop();
            await persistRuntimeResumeState(lastCompletedStepPath);
            stepInflightId = crypto.randomUUID();
            continue;
          }
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.break',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          const recovery =
            source === 'script'
              ? null
              : await recoverGitHubReviewStepFailure(
                  status,
                  nextPath,
                  scopedGitHubRecovery,
                );
          if (recovery) return recovery;
          continue;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        if (shouldBreak && step.exitFlow) terminalOutcome = 'not_applicable';
        await persistRuntimeResumeState(lastCompletedStepPath);
        if (shouldBreak && step.exitFlow) return 'exit';
        if (shouldBreak && step.haltFlow) return 'stopped';
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
        const { status, shouldContinue, source } = await runContinueStep(
          step,
          command,
        );
        appendLoopContinueRuntimeDiagnostic('continue_step_completed', {
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          status,
          shouldContinue,
        });
        if (shouldStopAfter(status)) {
          await persistRuntimeResumeState(lastCompletedStepPath);
          const recovery =
            source === 'script'
              ? null
              : await recoverGitHubReviewStepFailure(
                  status,
                  nextPath,
                  scopedGitHubRecovery,
                );
          if (recovery) return recovery;
          continue;
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
          appendLoopContinueRuntimeDiagnostic('continue_boundary_marked', {
            activeLoopFrame: {
              loopStepPath: [...activeLoopFrame.loopStepPath],
              iteration: activeLoopFrame.iteration,
            },
          });
        }
        lastCompletedStepPath = nextPath;
        if (!shouldContinue) {
          clearContinueBoundaryForActiveLoop();
        }
        if (
          await stopAfterSuccessfulStepIfPendingCancel({
            checkpoint: 'runSteps.return.stop.pending_cancel.after_continue',
            detail: `step=${command.stepIndex} shouldContinue=${String(shouldContinue)} loopDepth=${loopStack.length}`,
          })
        ) {
          return 'stopped';
        }
        await persistRuntimeResumeState(lastCompletedStepPath);
        if (shouldContinue) return 'continue';
        continue;
      }

      if (step.type === 'if') {
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
        const outcome = await runIfStep(
          step,
          command,
          nextPath,
          null,
          githubReviewRecoveryScope,
        );
        if (outcome !== 'ok') {
          await persistRuntimeResumeState(lastCompletedStepPath);
          if (
            outcome !== 'failed' &&
            outcome !== 'warning' &&
            outcome !== 'stopped'
          ) {
            return outcome;
          }
          if (
            outcome === 'failed' &&
            isFlowDecisionScriptPath(step.condition)
          ) {
            return outcome;
          }
          const recovery = await recoverGitHubReviewStepFailure(
            outcome,
            nextPath,
            {
              eligible:
                githubReviewRecoveryScope || step.githubReviewRecovery === true,
              skipScopeOnExhaustion:
                githubReviewRecoveryScope || step.githubReviewRecovery === true,
            },
          );
          if (
            recovery === 'github_review_skipped' &&
            step.githubReviewRecovery === true
          ) {
            lastCompletedStepPath = nextPath;
            clearContinueBoundaryForActiveLoop();
            await persistRuntimeResumeState(lastCompletedStepPath);
            continue;
          }
          if (recovery) return recovery;
          continue;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        continue;
      }

      if (step.type === 'wait') {
        const outcome = await runWaitStep(step, nextPath);
        if (outcome === 'paused') {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.paused.wait',
            conversationId: params.conversationId,
            detail: `stepPath=${nextPath.join('.')} seconds=${step.seconds}`,
          });
          return 'paused';
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        continue;
      }

      if (step.type === 'github_open_pr') {
        const status = await runGitHubOpenPrStep();
        if (shouldStopAfter(status)) {
          await persistRuntimeResumeState(lastCompletedStepPath);
          const recovery = await recoverGitHubReviewStepFailure(
            status,
            nextPath,
            nativeGitHubRecovery,
          );
          if (recovery) return recovery;
          continue;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        continue;
      }

      if (step.type === 'github_fetch_reviews') {
        const status = await runGitHubFetchReviewsStep();
        if (shouldStopAfter(status)) {
          await persistRuntimeResumeState(lastCompletedStepPath);
          return status;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        continue;
      }

      if (step.type === 'github_close_pr') {
        const status = await runGitHubClosePrStep();
        if (shouldStopAfter(status)) {
          await persistRuntimeResumeState(lastCompletedStepPath);
          const recovery = await recoverGitHubReviewStepFailure(
            status,
            nextPath,
            nativeGitHubRecovery,
          );
          if (recovery) return recovery;
          continue;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        continue;
      }

      if (step.type === 'startLoop') {
        const outcome = await runStartLoopStep(
          step,
          nextPath,
          null,
          githubReviewRecoveryScope,
        );
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
        const status = await runCommandStep(step, command, nextPath);
        appendFlowRuntimeDiagnostic('flows.test.command_step_completed', {
          conversationId: params.conversationId,
          executionId: params.executionId,
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          status,
          loopDepth: loopStack.length,
        });
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.command',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          const recovery = await recoverGitHubReviewStepFailure(
            status,
            nextPath,
            scopedGitHubRecovery,
          );
          if (recovery) return recovery;
          continue;
        }
        lastCompletedStepPath = nextPath;
        appendFlowRuntimeDiagnostic('flows.test.command_step_state_advanced', {
          conversationId: params.conversationId,
          executionId: params.executionId,
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          loopDepth: loopStack.length,
        });
        clearContinueBoundaryForActiveLoop();
        if (
          await stopAfterSuccessfulStepIfPendingCancel({
            checkpoint: 'runSteps.return.stop.pending_cancel.after_command',
            detail: `step=${command.stepIndex} loopDepth=${loopStack.length}`,
          })
        ) {
          return 'stopped';
        }
        appendFlowRuntimeDiagnostic(
          'flows.test.command_step_resume_state_persist_begin',
          {
            conversationId: params.conversationId,
            executionId: params.executionId,
            stepPath: nextPath,
            stepIndex: command.stepIndex,
            loopDepth: loopStack.length,
          },
        );
        await persistRuntimeResumeState(lastCompletedStepPath);
        appendFlowRuntimeDiagnostic(
          'flows.test.command_step_resume_state_persist_complete',
          {
            conversationId: params.conversationId,
            executionId: params.executionId,
            stepPath: nextPath,
            stepIndex: command.stepIndex,
            loopDepth: loopStack.length,
          },
        );
        appendFlowRuntimeDiagnostic('flows.test.command_step_continue', {
          conversationId: params.conversationId,
          executionId: params.executionId,
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          nextSiblingStepIndex:
            indexForExpectedNextStep < steps.length
              ? indexForExpectedNextStep + 1
              : null,
          loopDepth: loopStack.length,
        });
        appendNextStepDispatchExpected(
          nextPath,
          command.stepIndex,
          indexForExpectedNextStep,
        );
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

      if (step.type === 'initializeReviewCycle') {
        const command = buildFlowCommandMetadata({
          step,
          stepIndex: index + 1,
          totalSteps: steps.length,
          loopDepth: loopStack.length,
        });
        const result = await runInitializeReviewCycleStep(step, command);
        if (shouldStopAfter(result.status)) {
          await persistRuntimeResumeState(lastCompletedStepPath);
          const recovery = await recoverGitHubReviewStepFailure(
            result.status,
            nextPath,
            scopedGitHubRecovery,
          );
          if (recovery) return recovery;
          return result.status;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        if (result.exitFlow) terminalOutcome = 'not_applicable';
        await persistRuntimeResumeState(lastCompletedStepPath);
        if (result.exitFlow) return 'ok';
        stepInflightId = crypto.randomUUID();
        continue;
      }

      if (step.type === 'prepareReviewTargets') {
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
            reviewTargetsOutputKey: step.outputKey,
          },
        });
        const status = await runPrepareReviewTargetsStep(step, command);
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.prepareReviewTargets',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          const recovery = await recoverGitHubReviewStepFailure(
            status,
            nextPath,
            scopedGitHubRecovery,
          );
          if (recovery) return recovery;
          continue;
        }
        lastCompletedStepPath = nextPath;
        clearContinueBoundaryForActiveLoop();
        await persistRuntimeResumeState(lastCompletedStepPath);
        stepInflightId = crypto.randomUUID();
        continue;
      }

      if (step.type === 'prepareCopilotReviewGroups') {
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
            copilotReviewGroupsOutputKey: step.outputKey,
          },
        });
        const status = await runPrepareCopilotReviewGroupsStep(step, command);
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.prepareCopilotReviewGroups',
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

      if (step.type === 'runCopilotReview') {
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
            nativeCopilotReview: true,
          },
        });
        const status = await runCopilotReviewStep(step, command);
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.runCopilotReview',
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

      if (step.type === 'subflowWave') {
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
            subflowWaveGroupIds: step.groups?.map((group) => group.id) ?? [
              step.groupsFrom ?? 'dynamic',
            ],
          },
        });
        const status = await runSubflowWaveStep(step, command, nextPath);
        appendFlowRuntimeDiagnostic('flows.test.subflow_step_completed', {
          conversationId: params.conversationId,
          executionId: params.executionId,
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          status,
          loopDepth: loopStack.length,
        });
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.subflowWave',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          const recovery = await recoverGitHubReviewStepFailure(
            status,
            nextPath,
            scopedGitHubRecovery,
          );
          if (recovery) return recovery;
          continue;
        }
        lastCompletedStepPath = nextPath;
        appendFlowRuntimeDiagnostic('flows.test.subflow_step_state_advanced', {
          conversationId: params.conversationId,
          executionId: params.executionId,
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          loopDepth: loopStack.length,
        });
        clearContinueBoundaryForActiveLoop();
        if (
          await stopAfterSuccessfulStepIfPendingCancel({
            checkpoint: 'runSteps.return.stop.pending_cancel.after_subflow',
            detail: `step=${command.stepIndex} loopDepth=${loopStack.length}`,
          })
        ) {
          return 'stopped';
        }
        appendFlowRuntimeDiagnostic(
          'flows.test.subflow_step_resume_state_persist_begin',
          {
            conversationId: params.conversationId,
            executionId: params.executionId,
            stepPath: nextPath,
            stepIndex: command.stepIndex,
            loopDepth: loopStack.length,
          },
        );
        await persistRuntimeResumeState(lastCompletedStepPath);
        appendFlowRuntimeDiagnostic(
          'flows.test.subflow_step_resume_state_persist_complete',
          {
            conversationId: params.conversationId,
            executionId: params.executionId,
            stepPath: nextPath,
            stepIndex: command.stepIndex,
            loopDepth: loopStack.length,
          },
        );
        stepInflightId = crypto.randomUUID();
        appendFlowRuntimeDiagnostic('flows.test.subflow_step_continue', {
          conversationId: params.conversationId,
          executionId: params.executionId,
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          nextSiblingStepIndex:
            indexForExpectedNextStep < steps.length
              ? indexForExpectedNextStep + 1
              : null,
          loopDepth: loopStack.length,
        });
        appendNextStepDispatchExpected(
          nextPath,
          command.stepIndex,
          indexForExpectedNextStep,
        );
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
        appendFlowRuntimeDiagnostic('flows.test.reingest_step_completed', {
          conversationId: params.conversationId,
          executionId: params.executionId,
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          status,
          loopDepth: loopStack.length,
        });
        if (shouldStopAfter(status)) {
          params.onStopUnwindCheckpoint?.({
            checkpoint: 'runSteps.return.stop.reingest',
            conversationId: params.conversationId,
            detail: `status=${status} step=${command.stepIndex}`,
          });
          await persistRuntimeResumeState(lastCompletedStepPath);
          const recovery = await recoverGitHubReviewStepFailure(
            status,
            nextPath,
            scopedGitHubRecovery,
          );
          if (recovery) return recovery;
          continue;
        }
        lastCompletedStepPath = nextPath;
        appendFlowRuntimeDiagnostic('flows.test.reingest_step_state_advanced', {
          conversationId: params.conversationId,
          executionId: params.executionId,
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          loopDepth: loopStack.length,
        });
        clearContinueBoundaryForActiveLoop();
        if (
          await stopAfterSuccessfulStepIfPendingCancel({
            checkpoint: 'runSteps.return.stop.pending_cancel.after_reingest',
            detail: `step=${command.stepIndex} loopDepth=${loopStack.length}`,
          })
        ) {
          return 'stopped';
        }
        appendFlowRuntimeDiagnostic(
          'flows.test.reingest_step_resume_state_persist_begin',
          {
            conversationId: params.conversationId,
            executionId: params.executionId,
            stepPath: nextPath,
            stepIndex: command.stepIndex,
            loopDepth: loopStack.length,
          },
        );
        await persistRuntimeResumeState(lastCompletedStepPath);
        appendFlowRuntimeDiagnostic(
          'flows.test.reingest_step_resume_state_persist_complete',
          {
            conversationId: params.conversationId,
            executionId: params.executionId,
            stepPath: nextPath,
            stepIndex: command.stepIndex,
            loopDepth: loopStack.length,
          },
        );
        appendFlowRuntimeDiagnostic('flows.test.reingest_step_continue', {
          conversationId: params.conversationId,
          executionId: params.executionId,
          stepPath: nextPath,
          stepIndex: command.stepIndex,
          nextSiblingStepIndex:
            indexForExpectedNextStep < steps.length
              ? indexForExpectedNextStep + 1
              : null,
          loopDepth: loopStack.length,
        });
        appendNextStepDispatchExpected(
          nextPath,
          command.stepIndex,
          indexForExpectedNextStep,
        );
        continue;
      }

      throw toFlowRunError(
        'UNSUPPORTED_STEP',
        'Flow step type not supported yet',
      );
    }

    return 'ok';
  };

  const persistTerminalOutcomeBeforeCleanup = async (
    outcome: FlowStepOutcome,
  ): Promise<'ok' | 'warning' | 'stopped' | 'failed'> => {
    const normalizedOutcome: 'ok' | 'warning' | 'stopped' | 'failed' =
      outcome === 'stopped'
        ? 'stopped'
        : outcome === 'failed'
          ? 'failed'
          : activeGitHubReviewContext?.phase === 'skipped' ||
              hasTerminalGitHubReviewWarning ||
              hasPropagatedGitHubReviewWarning
            ? 'warning'
            : 'ok';
    runLifecycle.status = normalizedOutcome;
    runLifecycle.updatedAt = new Date().toISOString();
    await persistRuntimeResumeState(lastCompletedStepPath);
    if (initializedFinalReviewCycle && terminalOutcome !== 'not_applicable') {
      const reviewRepositoryPath = resolveFlowGitBackedRepositoryPath(
        params.repositoryContext,
      );
      if (reviewRepositoryPath) {
        await finalizeActiveReviewCycleIfPending({
          workingRepositoryPath: reviewRepositoryPath,
          fallbackStatus: 'incomplete',
          fallbackReason:
            normalizedOutcome === 'ok'
              ? `Review flow ${params.flowName} ended without an explicit settlement outcome.`
              : `Review flow ${params.flowName} ended with status ${normalizedOutcome}.`,
        });
      }
    }
    return normalizedOutcome;
  };

  try {
    const outcome = await runSteps(params.flow.steps, [], resumeStepPath);
    if (outcome === 'paused') {
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'runFlowUnlocked.return.paused',
        conversationId: params.conversationId,
      });
      return 'paused';
    }
    if (outcome === 'stopped') {
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'runFlowUnlocked.return.stopped',
        conversationId: params.conversationId,
      });
      return await persistTerminalOutcomeBeforeCleanup(outcome);
    }
    if (outcome === 'exit') {
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'runFlowUnlocked.return.exit',
        conversationId: params.conversationId,
      });
      return await persistTerminalOutcomeBeforeCleanup(outcome);
    }
    if (outcome !== 'ok') {
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'runFlowUnlocked.return.non_ok',
        conversationId: params.conversationId,
        detail: `outcome=${outcome}`,
      });
      return await persistTerminalOutcomeBeforeCleanup(outcome);
    }
    if (activeGitHubReviewContext?.phase === 'skipped') {
      const latestAssistantStatus = await latestAssistantStatusForConversation(
        params.conversationId,
      );
      if (latestAssistantStatus !== 'warning') {
        await emitGitHubStepWarning({
          instruction: 'GitHub review cycle completion',
          message: `Flow completed with warning: ${activeGitHubReviewContext.warningMessage ?? 'The optional GitHub review cycle was skipped after it could not complete safely.'}`,
        });
      }
    }
    params.onStopUnwindCheckpoint?.({
      checkpoint: 'runFlowUnlocked.return.ok',
      conversationId: params.conversationId,
    });
    return await persistTerminalOutcomeBeforeCleanup(outcome);
  } finally {
    finalizeFlowRuntime();
  }
}

export async function startFlowRun(
  params: FlowRunStartParams,
): Promise<FlowRunStartResult> {
  const flowName = params.flowName.trim();
  let requestedInput: FlowJsonObject | undefined;
  try {
    requestedInput = params.input
      ? normalizeFlowInput(params.input)
      : undefined;
  } catch (error) {
    throw toFlowRunError(
      'INVALID_REQUEST',
      error instanceof Error ? error.message : 'Flow input is invalid.',
    );
  }
  const requestedInputHash = requestedInput
    ? hashFlowInput(requestedInput)
    : undefined;
  const requestedSourceId = params.sourceId?.trim() || undefined;
  const requestedConversationId = params.conversationId?.trim() || undefined;
  let existingConversation = requestedConversationId
    ? await getConversation(requestedConversationId)
    : null;
  const trustedRequestedFlowState =
    existingConversation?.flowName === flowName
      ? parseFlowResumeState(
          (existingConversation.flags ?? undefined) as
            | Record<string, unknown>
            | undefined,
        )
      : null;
  const sourceId =
    params.resumeStepPath && trustedRequestedFlowState?.wait?.sourceId
      ? trustedRequestedFlowState.wait.sourceId
      : requestedSourceId;
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
  const inflightId = params.inflightId ?? crypto.randomUUID();
  const resumeStepPath = params.resumeStepPath;
  const retryOwnershipLaunch = normalizeFreshRunRetryOwnershipLaunch({
    flowName,
    source: params.source,
    sourceId,
    codexReviewModelId: params.codexReviewModelId,
    working_folder: params.working_folder,
    customTitle: params.customTitle,
    inputHash: requestedInputHash,
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
  appendFlowRuntimeDiagnostic('flows.test.start.ownership_acquired', {
    flowName,
    conversationId,
    flowPath,
    flowPathDepth: flowPath.length,
    requestedConversationId,
    runToken,
    resumeStepPath: resumeStepPath ?? null,
    retryOwnershipId: retryOwnershipId ?? null,
    sourceId: sourceId ?? null,
    workingFolder: params.working_folder ?? null,
  });

  let flow: FlowFile;
  let modelId = FALLBACK_MODEL_ID;
  let providerId: ConversationProvider = 'codex';
  let resumeState: FlowResumeState | null = null;
  let repositoryContext: FlowCommandRepositoryContext | null = null;
  let flowAgentByName: Map<
    string,
    Awaited<ReturnType<typeof discoverAgents>>[number]
  > | null = null;
  let executionId: string = crypto.randomUUID();
  let startupWarnings: string[] = [];
  let childExecutionBackfills: string[] = [];
  let completedSuccessfully = false;
  let acceptedStartResult: FlowRunStartResult | null = null;
  let effectiveResumeStepPath = resumeStepPath;
  const asyncBeginSignal = createDeferred<void>();
  let effectiveFlowInput = requestedInput;
  let effectiveFlowInputHash = requestedInputHash;

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
    appendFlowRuntimeDiagnostic('flows.test.start.flow_loaded', {
      flowName,
      conversationId,
      flowPath,
      flowPathDepth: flowPath.length,
      sourceId: sourceId ?? null,
      flowsRoot,
      stepCount: flow.steps.length,
    });
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
    appendFlowRuntimeDiagnostic('flows.test.start.working_folder_resolved', {
      flowName,
      conversationId,
      flowPath,
      flowPathDepth: flowPath.length,
      workingFolder: effectiveWorkingFolder ?? null,
      requestedWorkingFolder: params.working_folder ?? null,
      sourceId: sourceId ?? null,
    });

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

      // An explicit rewind must launch a new wave instead of accepting
      // terminal children that belonged to the later saved step. Retaining
      // those entries makes validation appear to pass while its artifacts
      // still describe the earlier run.
      if (resumesFromEarlierStep(resumeStepPath, resumeState.stepPath)) {
        resumeState = {
          ...resumeState,
          waveInvocationGeneration:
            (resumeState.waveInvocationGeneration ?? 0) + 1,
          activeSubflows: undefined,
          subflowWaveProgress: undefined,
          terminalOutcome: undefined,
          restartReconciliation: undefined,
        };
      }
    }
    if (
      resumeState?.inputHash &&
      requestedInputHash &&
      resumeState.inputHash !== requestedInputHash
    ) {
      throw toFlowRunError(
        'INVALID_REQUEST',
        'Resumed flow input does not match the persisted immutable input.',
      );
    }
    if (resumeState?.input && !resumeState.inputHash) {
      if (
        !requestedInput ||
        JSON.stringify(resumeState.input) !== JSON.stringify(requestedInput)
      ) {
        throw toFlowRunError(
          'INVALID_REQUEST',
          'Persisted resume input lacks a trusted input hash and cannot be reused.',
        );
      }
    }
    effectiveFlowInput = resumeState?.input ?? requestedInput;
    effectiveFlowInputHash =
      resumeState?.inputHash ??
      (effectiveFlowInput ? hashFlowInput(effectiveFlowInput) : undefined);
    executionId = resumeState?.executionId ?? executionId;
    effectiveResumeStepPath = resumeStepPath;
    const runtimeIdentityStep = findRuntimeIdentityStep(
      flow.steps,
      effectiveResumeStepPath,
    );
    const immediateResumeBoundaryStep = findImmediateResumeBoundaryStep(
      flow.steps,
      effectiveResumeStepPath,
    );
    const shouldBootstrapRuntimeIdentity = stepRequiresProviderBootstrap(
      immediateResumeBoundaryStep,
    );
    const firstAgentStep = shouldBootstrapRuntimeIdentity
      ? (runtimeIdentityStep ?? findFirstAgentStep(flow.steps))
      : undefined;
    const flowDefaultRepositoryRoot = sourceRepo?.containerPath
      ? path.resolve(sourceRepo.containerPath)
      : sourceId
        ? path.resolve(sourceId)
        : undefined;
    const flowRunDefaultRepositoryRoot = effectiveWorkingFolder
      ? flowDefaultRepositoryRoot
      : undefined;
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
    const discovered = await discoverAgents();
    flowAgentByName = new Map(discovered.map((item) => [item.name, item]));
    for (const agentName of collectDirectFlowAgentTypes(flow.steps)) {
      const resolved = await resolveFlowAgentForDiscovery({
        agentName,
        discoveredAgentsByName: flowAgentByName,
        flowSourceId: repositoryContext.flowSourceId,
        flowSourceLabel: repositoryContext.flowSourceLabel,
        codeInfo2Root: repositoryContext.codeInfo2Root,
        repos: repositoryContext.repos,
      });
      if (!resolved.ok) continue;
      flowAgentByName.set(agentName, {
        name: agentName,
        home: path.dirname(resolved.configPath),
        configPath: resolved.configPath,
        warnings: resolved.warnings,
      });
    }
    if (firstAgentStep) {
      const firstAgentType = firstAgentStep.agentType;
      if (!firstAgentType) {
        throw toFlowRunError(
          'INVALID_REQUEST',
          'AI-backed flow decisions require an agentType.',
        );
      }
      const validatedAgentType =
        validateRepositoryBackedAgentType(firstAgentType);
      if (!validatedAgentType.ok) {
        throw toFlowRunError(
          'INVALID_REQUEST',
          `Flow agent "${firstAgentType}" ${validatedAgentType.message}.`,
        );
      }
      const agent = flowAgentByName.get(firstAgentType);
      if (!agent) {
        throw toFlowRunError(
          'AGENT_NOT_FOUND',
          `Agent ${firstAgentType} not found`,
        );
      }
      appendFlowRuntimeDiagnostic('flows.test.start.runtime_identity_begin', {
        flowName,
        conversationId,
        flowPath,
        flowPathDepth: flowPath.length,
        firstAgentType,
        effectiveWorkingFolder: effectiveWorkingFolder ?? null,
      });
      const prepared = await resolveFlowAgentRuntimeExecution({
        agentName: firstAgentType,
        configPath: agent.configPath,
        workingFolder: effectiveWorkingFolder,
        defaultRepositoryRoot: flowRunDefaultRepositoryRoot,
        source: params.source,
      });
      modelId = prepared.modelId;
      providerId = prepared.providerId;
      startupWarnings = prepared.warnings ?? [];
      appendFlowRuntimeDiagnostic(
        'flows.test.start.runtime_identity_resolved',
        {
          flowName,
          conversationId,
          flowPath,
          flowPathDepth: flowPath.length,
          firstAgentType,
          providerId,
          modelId,
          startupWarningsCount: startupWarnings.length,
        },
      );
    } else if (resumeStepPath && existingConversation) {
      providerId = existingConversation.provider;
      modelId = existingConversation.model;
      appendFlowRuntimeDiagnostic('flows.test.start.runtime_identity_reused', {
        flowName,
        conversationId,
        flowPath,
        flowPathDepth: flowPath.length,
        providerId,
        modelId,
        resumeStepPath,
      });
    }

    appendFlowRuntimeDiagnostic('flows.test.start.repository_context_ready', {
      flowName,
      conversationId,
      flowPath,
      flowPathDepth: flowPath.length,
      workingRepositoryPath: repositoryContext.workingRepositoryPath ?? null,
      defaultRepositoryRoot: repositoryContext.defaultRepositoryRoot ?? null,
      flowSourceId: repositoryContext.flowSourceId ?? null,
      repoCount: repositoryContext.repos.length,
    });

    appendFlowRuntimeDiagnostic(
      'flows.test.start.validate_command_steps_begin',
      {
        flowName,
        conversationId,
        flowPath,
        flowPathDepth: flowPath.length,
        stepCount: flow.steps.length,
      },
    );
    await validateCommandSteps({
      flowName,
      steps: flow.steps,
      flowsRoot,
      sourceId,
      agentByName: flowAgentByName,
      repositoryContext,
      resumeStepPath: effectiveResumeStepPath,
    });
    appendFlowRuntimeDiagnostic(
      'flows.test.start.validate_command_steps_complete',
      {
        flowName,
        conversationId,
        flowPath,
        flowPathDepth: flowPath.length,
        stepCount: flow.steps.length,
      },
    );

    appendFlowRuntimeDiagnostic('flows.test.start.conversation_ensure_begin', {
      flowName,
      conversationId,
      flowPath,
      flowPathDepth: flowPath.length,
      providerId,
      modelId,
      workingFolder: effectiveWorkingFolder ?? null,
      resumeStepPath: effectiveResumeStepPath ?? null,
    });
    await ensureFlowConversation({
      conversationId,
      flowName,
      providerId,
      modelId,
      customTitle: params.customTitle,
      source: params.source,
      workingFolder: effectiveWorkingFolder,
      parentWave: params.parentWave,
    });
    appendFlowRuntimeDiagnostic('flows.test.start.conversation_ensured', {
      flowName,
      conversationId,
      flowPath,
      flowPathDepth: flowPath.length,
      providerId,
      modelId,
      workingFolder: effectiveWorkingFolder ?? null,
      resumeStepPath: effectiveResumeStepPath ?? null,
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
    } else {
      clearScheduledFlowWait(conversationId);
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

    acceptedStartResult = {
      flowName,
      conversationId,
      inflightId,
      providerId,
      modelId,
      ...(startupWarnings.length > 0 ? { warnings: startupWarnings } : {}),
    };
    await persistFlowResumeState({
      conversationId,
      executionId,
      runtimeState: runtimeStateForPersist,
      stepPath: resumeState?.stepPath ?? [],
      loopStack: (resumeState?.loopStack ?? []).map((frame) => ({
        loopStepPath: [...frame.loopStepPath],
        iteration: frame.iteration,
      })),
      lastLoopExit: resumeState?.lastLoopExit,
      pendingLoopControl: resumeState?.pendingLoopControl
        ? {
            kind: resumeState.pendingLoopControl.kind,
            loopStepPath: [...resumeState.pendingLoopControl.loopStepPath],
          }
        : null,
      wait: resumeState?.wait,
      activeSubflows: cloneActiveSubflows(resumeState?.activeSubflows),
      subflowWaveProgress: resumeState?.subflowWaveProgress,
      terminalOutcome: resumeState?.terminalOutcome,
      runLifecycle: {
        status: 'running',
        updatedAt: new Date().toISOString(),
      },
      codexReviewModelId:
        params.codexReviewModelId ?? resumeState?.codexReviewModelId,
      workingFolder: effectiveWorkingFolder ?? resumeState?.workingFolder,
      input: effectiveFlowInput,
      inputHash: effectiveFlowInputHash,
      values: resumeState?.values as FlowJsonObject | undefined,
      retryOwnershipPending:
        retryOwnershipId && !resumeStepPath
          ? {
              retryOwnershipId,
              sourceId,
              launchSignature:
                makeFreshRunRetryOwnershipLaunchSignature(retryOwnershipLaunch),
              result: acceptedStartResult,
            }
          : null,
    });
    appendFlowRuntimeDiagnostic('flows.test.start.resume_state_persisted', {
      flowName,
      conversationId,
      flowPath,
      flowPathDepth: flowPath.length,
      executionId,
      stepPath: resumeState?.stepPath ?? [],
      effectiveResumeStepPath: effectiveResumeStepPath ?? null,
    });
    appendFlowRuntimeDiagnostic('flows.test.start.accepted', {
      flowName,
      conversationId,
      flowPath,
      flowPathDepth: flowPath.length,
      executionId,
      inflightId,
      providerId,
      modelId,
      effectiveResumeStepPath: effectiveResumeStepPath ?? null,
      startupWarningsCount: startupWarnings.length,
      childExecutionBackfillCount: childExecutionBackfills.length,
      workingFolder: effectiveWorkingFolder ?? null,
    });
    appendFlowRuntimeDiagnostic('flows.test.start.async_scheduled', {
      flowName,
      conversationId,
      flowPath,
      flowPathDepth: flowPath.length,
      executionId,
      inflightId,
      providerId,
      modelId,
      effectiveResumeStepPath: effectiveResumeStepPath ?? null,
      workingFolder: effectiveWorkingFolder ?? null,
    });
    if (retryOwnershipId && !resumeStepPath) {
      rememberFreshRunRetryOwnership({
        flowName,
        sourceId,
        retryOwnershipId,
        runToken,
        launch: retryOwnershipLaunch,
        result: acceptedStartResult,
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
    let failedTerminally = false;
    try {
      appendFlowRuntimeDiagnostic('flows.test.start.async_begin', {
        flowName,
        conversationId,
        flowPath,
        flowPathDepth: flowPath.length,
        executionId,
        inflightId,
        providerId,
        modelId,
        effectiveResumeStepPath: effectiveResumeStepPath ?? null,
      });
      asyncBeginSignal.resolve();
      await params.onAsyncBegin?.({
        conversationId,
        runToken,
        executionId,
        inflightId,
      });
      appendFlowRuntimeDiagnostic('flows.test.start.execution_context_begin', {
        flowName,
        conversationId,
        flowPath,
        flowPathDepth: flowPath.length,
        executionId,
        inflightId,
        requestedWorkingFolder: params.working_folder ?? null,
        defaultRepositoryRoot: repositoryContext?.defaultRepositoryRoot ?? null,
      });
      if (!repositoryContext) {
        throw toFlowRunError(
          'COMMAND_INVALID',
          'Flow command repository context unavailable',
        );
      }
      if (!flowAgentByName) {
        throw toFlowRunError(
          'COMMAND_INVALID',
          'Flow agent resolution context unavailable',
        );
      }
      const workingDirectoryOverride = (
        await resolveSharedExecutionContext({
          workingFolder: params.working_folder,
          defaultRepositoryRoot: repositoryContext.defaultRepositoryRoot,
        })
      ).workingDirectoryOverride;
      appendFlowRuntimeDiagnostic('flows.test.start.execution_context_ready', {
        flowName,
        conversationId,
        flowPath,
        flowPathDepth: flowPath.length,
        executionId,
        inflightId,
        workingDirectoryOverride: workingDirectoryOverride ?? null,
      });
      appendFlowRuntimeDiagnostic('flows.test.start.run_dispatch_begin', {
        flowName,
        conversationId,
        flowPath,
        flowPathDepth: flowPath.length,
        executionId,
        inflightId,
        effectiveResumeStepPath: effectiveResumeStepPath ?? null,
      });
      const runOutcome = await runFlowUnlocked({
        flowName,
        flow,
        flowPath,
        repositoryContext,
        agentByName: flowAgentByName,
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
        resumeStepPath: effectiveResumeStepPath,
        customTitle: params.customTitle,
        runToken,
        input: effectiveFlowInput,
        inputHash: effectiveFlowInputHash,
        onStopUnwindCheckpoint: params.onStopUnwindCheckpoint,
        cleanupInflightFn: params.cleanupInflightFn,
        releaseConversationLockFn: params.releaseConversationLockFn,
      });
      completedSuccessfully = runOutcome === 'ok';
      failedTerminally =
        runOutcome !== 'ok' &&
        runOutcome !== 'paused' &&
        runOutcome !== 'stopped';
      params.onStopUnwindCheckpoint?.({
        checkpoint: 'startFlowRun.async.afterRunFlowUnlocked',
        conversationId,
        detail: `outcome=${runOutcome}`,
      });
    } catch (err) {
      failedTerminally = true;
      await persistFlowRunLifecycleStatus(conversationId, 'failed').catch(
        () => undefined,
      );
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
      let released = false;
      if (retryOwnershipId && !resumeStepPath && completedSuccessfully) {
        const completedResult = {
          flowName,
          conversationId,
          inflightId,
          providerId,
          modelId,
          ...(startupWarnings.length > 0 ? { warnings: startupWarnings } : {}),
        };
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            await persistFreshRunRetryOwnershipCompletion({
              conversationId,
              retryOwnershipId,
              launch: retryOwnershipLaunch,
              result: completedResult,
            });
            break;
          } catch (error) {
            baseLogger.error(
              { flowName, conversationId, inflightId, attempt, error },
              'fresh run retry completion persistence failed',
            );
          }
        }
        rememberFreshRunRetryOwnershipCompletion({
          flowName,
          sourceId,
          retryOwnershipId,
          launch: retryOwnershipLaunch,
          result: completedResult,
        });
      }
      if (retryOwnershipId && !resumeStepPath && failedTerminally) {
        try {
          await clearFreshRunRetryOwnershipPending({
            conversationId,
            conversation: await getConversation(conversationId),
          });
        } catch (error) {
          baseLogger.error(
            { flowName, conversationId, inflightId, error },
            'fresh run retry pending cleanup failed after terminal error',
          );
        }
      }
      released = releaseConversationLockFn(conversationId, runToken);
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
  await asyncBeginSignal.promise;
  appendFlowRuntimeDiagnostic('flows.test.start.async_begin_confirmed', {
    flowName,
    conversationId,
    flowPath,
    flowPathDepth: flowPath.length,
    executionId,
    inflightId,
    providerId,
    modelId,
    effectiveResumeStepPath: effectiveResumeStepPath ?? null,
  });

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

export type FlowRunObservedStatus = {
  conversationId: string;
  status: 'running' | 'ok' | 'warning' | 'stopped' | 'failed' | 'orphaned';
  terminal: boolean;
  terminalOutcome: FlowResumeState['terminalOutcome'] | null;
  reviewCycleStatus?: 'in_progress' | 'completed' | 'incomplete' | null;
  executionId: string | null;
  activeSince: string | null;
  latestAssistantAt: string | null;
  subflowWaveProgress: FlowSubflowWaveProgress | null;
  resumeStepPath: number[] | null;
};

export const reconcileInterruptedFlowResumeStateForStartup = (
  resumeState: FlowResumeState,
  reconciledAt = new Date().toISOString(),
): FlowResumeState | null => {
  const interruptedSubflowCount = resumeState.activeSubflows?.length ?? 0;
  const interruptedWaveRunningCount = resumeState.subflowWaveProgress
    ? resumeState.subflowWaveProgress.running +
      resumeState.subflowWaveProgress.jobs.filter(
        (job) => job.status === 'pending',
      ).length
    : 0;
  if (interruptedSubflowCount === 0 && interruptedWaveRunningCount === 0) {
    return null;
  }
  return {
    ...resumeState,
    runLifecycle: { status: 'orphaned', updatedAt: reconciledAt },
    restartReconciliation: {
      status: 'interrupted',
      reconciledAt,
      resumeStepPath: [
        ...(resumeState.subflowWaveProgress?.stepPath ?? resumeState.stepPath),
      ],
      interruptedSubflowCount,
      interruptedWaveRunningCount,
    },
  };
};

export async function reconcileInterruptedFlowRunsForStartup(): Promise<number> {
  if (shouldUseMemoryPersistence()) return 0;
  const conversations = (await ConversationModel.find({
    $or: [
      { 'flags.flow.activeSubflows.0': { $exists: true } },
      { 'flags.flow.subflowWaveProgress.running': { $gt: 0 } },
      {
        'flags.flow.subflowWaveProgress.jobs': {
          $elemMatch: { status: 'pending' },
        },
      },
    ],
  })
    .lean()
    .exec()) as Conversation[];
  let reconciledCount = 0;
  const reconciledAt = new Date().toISOString();
  for (const conversation of conversations) {
    const resumeState = parseFlowResumeState(
      isRecord(conversation.flags)
        ? (conversation.flags as Record<string, unknown>)
        : undefined,
    );
    if (!resumeState) continue;
    const reconciled = reconcileInterruptedFlowResumeStateForStartup(
      resumeState,
      reconciledAt,
    );
    if (!reconciled) continue;
    await updateConversationFlowState({
      conversationId: conversation._id,
      flow: reconciled,
    });
    reconciledCount += 1;
    append({
      level: 'warn',
      message: 'flows.run.reconciled_after_restart',
      timestamp: reconciledAt,
      source: 'server',
      context: {
        conversationId: conversation._id,
        flowName: conversation.flowName,
        resumeStepPath: reconciled.restartReconciliation?.resumeStepPath,
        interruptedSubflowCount:
          reconciled.restartReconciliation?.interruptedSubflowCount,
        interruptedWaveRunningCount:
          reconciled.restartReconciliation?.interruptedWaveRunningCount,
      },
    });
  }
  return reconciledCount;
}

export async function getFlowRunStatus(
  conversationId: string,
): Promise<FlowRunObservedStatus | null> {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) return null;
  const conversation = await getConversation(normalizedConversationId);
  if (!conversation) return null;

  const ownership = getActiveRunOwnership(normalizedConversationId);
  const resumeState = parseFlowResumeState(
    isRecord(conversation.flags)
      ? (conversation.flags as Record<string, unknown>)
      : undefined,
  );
  const latestAssistant = shouldUseMemoryPersistence()
    ? (() => {
        const turns = memoryTurns.get(normalizedConversationId) ?? [];
        for (let index = turns.length - 1; index >= 0; index -= 1) {
          const turn = turns[index];
          if (turn?.role === 'assistant') return turn;
        }
        return null;
      })()
    : ((
        await listTurns({
          conversationId: normalizedConversationId,
          limit: 10,
        })
      ).items.find((turn) => turn.role === 'assistant') ?? null);

  const persistedChildrenStillRunning = Boolean(
    resumeState?.activeSubflows?.length ||
      (resumeState?.subflowWaveProgress?.running ?? 0) > 0,
  );
  const persistedLifecycle = resumeState?.runLifecycle?.status;
  const status =
    persistedLifecycle && persistedLifecycle !== 'running'
      ? persistedLifecycle
      : ownership
        ? ('running' as const)
        : resumeState?.restartReconciliation?.status === 'interrupted'
          ? ('orphaned' as const)
          : persistedChildrenStillRunning
            ? ('orphaned' as const)
            : persistedLifecycle === 'running'
              ? ('orphaned' as const)
              : latestAssistant?.status === 'warning'
                ? ('ok' as const)
                : (latestAssistant?.status ?? 'orphaned');
  const finalReviewCycle = Object.values(resumeState?.values ?? {}).find(
    (value) =>
      Boolean(value) &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as FlowJsonObject).action === 'initialized' &&
      (value as FlowJsonObject).review_mode === 'final' &&
      typeof (value as FlowJsonObject).review_cycle_id === 'string',
  ) as FlowJsonObject | undefined;
  const expectedReviewCycleId = finalReviewCycle?.review_cycle_id as
    | string
    | undefined;
  const reviewCycleStatus =
    conversation.flowName === 'two_phase_review_cycle' &&
    resumeState?.workingFolder &&
    expectedReviewCycleId
      ? await readActiveFinalReviewCycleStatus(
          resumeState.workingFolder,
          expectedReviewCycleId,
        )
      : null;

  return {
    conversationId: normalizedConversationId,
    status,
    terminal:
      status === 'ok' ||
      status === 'warning' ||
      status === 'stopped' ||
      status === 'failed',
    terminalOutcome: resumeState?.terminalOutcome ?? null,
    reviewCycleStatus,
    executionId: resumeState?.executionId ?? null,
    activeSince: ownership?.startedAt ?? null,
    latestAssistantAt: latestAssistant?.createdAt?.toISOString?.() ?? null,
    subflowWaveProgress: resumeState?.subflowWaveProgress ?? null,
    resumeStepPath:
      resumeState?.restartReconciliation?.resumeStepPath ??
      resumeState?.stepPath ??
      null,
  };
}

export async function stopFlowRun(conversationId: string): Promise<boolean> {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) return false;
  const conversation = await getConversation(normalizedConversationId);
  if (!conversation?.flowName?.trim()) return false;
  const ownership = getActiveRunOwnership(normalizedConversationId);
  if (!ownership) return false;
  registerPendingConversationCancel({
    conversationId: normalizedConversationId,
    runToken: ownership.runToken,
  });
  abortInflightByConversation(normalizedConversationId);
  return true;
}
