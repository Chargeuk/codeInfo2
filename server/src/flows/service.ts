import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { CodexOptions } from '@openai/codex-sdk';

import { executeCommandItem } from '../agents/commandItemExecutor.js';
import type { ExecuteCommandItemReingestResult } from '../agents/commandItemExecutor.js';
import { loadAgentCommandFile } from '../agents/commandsLoader.js';
import type { AgentCommandFile } from '../agents/commandsSchema.js';
import { resolveAgentRuntimeExecutionConfig } from '../agents/config.js';
import { discoverAgents } from '../agents/discovery.js';
import {
  getActiveRunOwnership,
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../agents/runLock.js';
import { isTransientReconnect } from '../agents/transientReconnect.js';
import { attachChatStreamBridge } from '../chat/chatStreamBridge.js';
import { getChatInterface, UnsupportedProviderError } from '../chat/factory.js';
import {
  abortInflight,
  bindPendingConversationCancelToInflight,
  cleanupPendingConversationCancel,
  cleanupInflight,
  consumePendingConversationCancel,
  createInflight,
  getInflight,
  markInflightPersisted,
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
  recordMemoryTurn,
  shouldUseMemoryPersistence,
  updateMemoryConversationMeta,
  updateMemoryConversationWorkingFolder,
} from '../chat/memoryPersistence.js';
import { runReingestStepLifecycle } from '../chat/reingestStepLifecycle.js';
import { buildReingestToolResult } from '../chat/reingestToolResult.js';
import { getFlowAndCommandRetries } from '../config/flowAndCommandRetries.js';
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
import { ConversationModel } from '../mongo/conversation.js';
import type { Conversation } from '../mongo/conversation.js';
import {
  appendTurn,
  createConversation,
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
import { refreshCodexDetection } from '../providers/codexDetection.js';
import { formatRetryInstruction } from '../utils/retryContext.js';
import {
  appendWorkingFolderDecisionLog,
  getConversationRecordType,
  knownRepositoryPathsAvailable,
  knownRepositoryPathsUnavailable,
  restoreSavedWorkingFolder,
  resolveWorkingFolderWorkingDirectory,
  validateRequestedWorkingFolder,
} from '../workingFolders/state.js';
import { publishUserTurn } from '../ws/server.js';

import {
  parseFlowFile,
  type FlowFile,
  type FlowBreakStep,
  type FlowCommandStep,
  type FlowLlmStep,
  type FlowReingestStep,
  type FlowStartLoopStep,
  type FlowStep,
} from './flowSchema.js';
import type { FlowResumeState } from './flowState.js';
import {
  normalizeSourceLabel,
  resolveMarkdownFileWithMetadata,
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
import type {
  FlowAgentState,
  FlowChatFactory,
  FlowRunError,
  FlowRunErrorCode,
  FlowRunStartParams,
  FlowRunStartResult,
} from './types.js';

const FALLBACK_MODEL_ID = 'gpt-5.1-codex-max';
const FLOW_STEP_BASE_DELAY_MS = 500;
const T07_SUCCESS_LOG =
  '[DEV-0000037][T07] event=runtime_overrides_applied_flow_mcp result=success';
const T07_ERROR_LOG =
  '[DEV-0000037][T07] event=runtime_overrides_applied_flow_mcp result=error';
const DEV_0000040_T11_FLOW_RESOLUTION_ORDER =
  'DEV_0000040_T11_FLOW_RESOLUTION_ORDER';
const agentConversationState = new Map<string, FlowAgentState>();

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

const flowServiceDeps: FlowServiceDeps = {
  ...defaultFlowServiceDeps,
};

export function __setFlowServiceDepsForTests(
  overrides: Partial<FlowServiceDeps>,
) {
  Object.assign(flowServiceDeps, overrides);
}

export function __resetFlowServiceDepsForTests() {
  Object.assign(flowServiceDeps, defaultFlowServiceDeps);
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

const normalizeNumberArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item) => typeof item === 'number' && Number.isFinite(item),
  );
};

const normalizeStringMap = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).filter(
    ([, item]) => typeof item === 'string',
  ) as Array<[string, string]>;
  return Object.fromEntries(entries);
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
  const agentThreads = normalizeStringMap(flow.agentThreads);

  return {
    stepPath,
    loopStack,
    agentConversations,
    agentThreads,
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

const persistConversationWorkingFolder = async (params: {
  conversationId: string;
  workingFolder?: string | null;
}) => {
  if (shouldUseMemoryPersistence()) {
    updateMemoryConversationWorkingFolder(params);
    return;
  }
  await updateConversationWorkingFolder(params);
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
    clearPersistedWorkingFolder: async (conversationId) => {
      await persistConversationWorkingFolder({
        conversationId,
        workingFolder: null,
      });
    },
    knownRepositoryPathsState: params.knownRepositoryPathsState,
  });
};

const ensureFlowConversation = async (params: {
  conversationId: string;
  flowName: string;
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
      if (!existing.flowName) {
        updateMemoryConversationMeta(params.conversationId, {
          flowName: params.flowName,
        });
      }
      return;
    }
    memoryConversations.set(params.conversationId, {
      _id: params.conversationId,
      provider: 'codex',
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
    provider: 'codex',
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
  modelId: string;
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
      provider: 'codex',
      model: params.modelId,
      title,
      agentName: params.agentType,
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
    provider: 'codex',
    model: params.modelId,
    title,
    agentName: params.agentType,
    source: params.source,
    flags: params.workingFolder ? { workingFolder: params.workingFolder } : {},
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
  const agentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  if (agentsHome) return path.resolve(agentsHome, '..', 'flows');
  return path.resolve('flows');
};

const codeInfo2RootForRun = () => {
  const agentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  if (agentsHome) return path.resolve(agentsHome, '..');
  return path.resolve('codex_agents', '..');
};

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
  agentType: string;
  identifier: string;
  flowName: string;
  modelId: string;
  workingFolder?: string;
  customTitle?: string;
  source: 'REST' | 'MCP';
}): Promise<{ state: FlowAgentState; isNew: boolean }> => {
  const key = getAgentKey(params.agentType, params.identifier);
  const existing = agentConversationState.get(key);
  if (existing) {
    await ensureFlowAgentConversation({
      conversationId: existing.conversationId,
      flowName: params.flowName,
      agentType: params.agentType,
      identifier: params.identifier,
      modelId: params.modelId,
      customTitle: params.customTitle,
      source: params.source,
      workingFolder: params.workingFolder,
    });
    existing.workingFolder = params.workingFolder;
    return { state: existing, isNew: false };
  }

  const state = {
    conversationId: crypto.randomUUID(),
    ...(params.workingFolder ? { workingFolder: params.workingFolder } : {}),
  } satisfies FlowAgentState;
  agentConversationState.set(key, state);
  await ensureFlowAgentConversation({
    conversationId: state.conversationId,
    flowName: params.flowName,
    agentType: params.agentType,
    identifier: params.identifier,
    modelId: params.modelId,
    customTitle: params.customTitle,
    source: params.source,
    workingFolder: params.workingFolder,
  });
  return { state, isNew: true };
};

const getAgentModelId = async (configPath: string): Promise<string> => {
  const { modelId } = await resolveFlowAgentRuntimeExecution({ configPath });
  return modelId;
};

const resolveFlowAgentRuntimeExecution = async (params: {
  configPath: string;
  source?: 'REST' | 'MCP';
}) => {
  try {
    const resolved = await resolveAgentRuntimeExecutionConfig({
      configPath: params.configPath,
      entrypoint: 'flows.service',
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
      runtimeConfig: resolved.runtimeConfig as CodexOptions['config'],
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
    throw error;
  }
};

const hydrateFlowAgentState = (resumeState: FlowResumeState | null) => {
  if (!resumeState) return;
  Object.entries(resumeState.agentConversations).forEach(
    ([key, conversationId]) => {
      const threadId = resumeState.agentThreads[key];
      const workingFolder = resumeState.agentWorkingFolders?.[key];
      agentConversationState.set(key, {
        conversationId,
        threadId,
        ...(workingFolder ? { workingFolder } : {}),
      });
    },
  );
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
  step: FlowLlmStep | FlowBreakStep | FlowCommandStep | FlowReingestStep;
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
    ...('agentType' in params.step
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

  await updateConversationMeta({
    conversationId: params.conversationId,
    lastMessageAt: params.createdAt,
    model: params.model,
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
  modelId: string;
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
  runToken?: string;
  cleanupInflightFn?: typeof cleanupInflight;
}): Promise<FlowInstructionResult> => {
  const createdAtIso = new Date().toISOString();
  createInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: 'codex',
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
    chat = resolvedChatFactory('codex');
  } catch (err) {
    if (err instanceof UnsupportedProviderError) {
      throw new Error(err.message);
    }
    throw err;
  }

  const bridge = attachChatStreamBridge({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: 'codex',
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

    const pendingCancel = consumePendingConversationCancel({
      conversationId: params.flowConversationId,
      runToken: params.runToken,
      inflightId: params.inflightId,
    });
    if (!pendingCancel) return false;

    return abortInflight({
      conversationId: params.flowConversationId,
      inflightId: params.inflightId,
    }).ok;
  };

  try {
    consumePendingFlowStop();

    await chat.run(
      params.instruction,
      {
        provider: 'codex',
        inflightId: params.inflightId,
        threadId: params.threadId,
        useConfigDefaults: true,
        runtimeConfig: params.runtimeConfig,
        ...(params.workingDirectoryOverride !== undefined
          ? { workingDirectoryOverride: params.workingDirectoryOverride }
          : {}),
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
      provider: 'codex',
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
      provider: 'codex',
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
      provider: 'codex',
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
      provider: 'codex',
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
  }

  try {
    cleanupInflightFn({
      conversationId: params.flowConversationId,
      inflightId: params.inflightId,
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
    cleanupPendingConversationCancel({
      conversationId: params.flowConversationId,
      runToken: params.runToken,
      inflightId: params.inflightId,
    });
  }

  return result;
};

const createNoopChat = () =>
  new (class extends ChatInterface {
    async execute() {
      return undefined;
    }
  })();

const emitFailedFlowStep = async (params: {
  flowConversationId: string;
  inflightId: string;
  instruction: string;
  modelId: string;
  source: 'REST' | 'MCP';
  message: string;
  errorCode?: string;
  command?: TurnCommandMetadata;
}) => {
  const createdAtIso = new Date().toISOString();
  createInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: 'codex',
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
    provider: 'codex',
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
    provider: 'codex',
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
    provider: 'codex',
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
  source: 'REST' | 'MCP';
  command?: TurnCommandMetadata;
}) => {
  const createdAtIso = new Date().toISOString();
  createInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: 'codex',
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
    provider: 'codex',
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
    provider: 'codex',
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
    provider: 'codex',
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
  bridge.cleanup();

  cleanupInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
  });
};

type FlowStepOutcome = TurnStatus | 'break';

type LoopFrame = {
  loopStepPath: number[];
  iteration: number;
};

const buildFlowResumeState = (params: {
  stepPath: number[];
  loopStack: LoopFrame[];
  workingFolder?: string;
}): FlowResumeState => {
  const agentConversations: Record<string, string> = {};
  const agentWorkingFolders: Record<string, string> = {};
  const agentThreads: Record<string, string> = {};
  agentConversationState.forEach((state, key) => {
    agentConversations[key] = state.conversationId;
    if (state.workingFolder) {
      agentWorkingFolders[key] = state.workingFolder;
    }
    if (state.threadId) {
      agentThreads[key] = state.threadId;
    }
  });

  return {
    stepPath: [...params.stepPath],
    loopStack: params.loopStack.map((frame) => ({
      loopStepPath: [...frame.loopStepPath],
      iteration: frame.iteration,
    })),
    ...(params.workingFolder ? { workingFolder: params.workingFolder } : {}),
    agentConversations,
    ...(Object.keys(agentWorkingFolders).length > 0
      ? { agentWorkingFolders }
      : {}),
    agentThreads,
  };
};

const persistFlowResumeState = async (params: {
  conversationId: string;
  stepPath: number[];
  loopStack: LoopFrame[];
  workingFolder?: string;
}) => {
  const flowState = buildFlowResumeState({
    stepPath: params.stepPath,
    loopStack: params.loopStack,
    workingFolder: params.workingFolder,
  });

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

const MAX_BREAK_PARSE_SCAN_LENGTH = 20_000;
const MAX_BREAK_PARSE_CANDIDATES = 100;

const validateBreakPayload = (
  parsed: unknown,
): { ok: true; answer: 'yes' | 'no' } | { ok: false; reason: string } => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      reason:
        'Break response must be a JSON object with {"answer":"yes"|"no"}.',
    };
  }

  const payload = parsed as Record<string, unknown>;
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'answer') {
    return {
      ok: false,
      reason:
        'Break response must be exactly {"answer":"yes"} or {"answer":"no"}.',
    };
  }

  const answer = payload.answer;
  if (answer !== 'yes' && answer !== 'no') {
    return {
      ok: false,
      reason: 'Break response must include answer "yes" or "no".',
    };
  }

  return { ok: true, answer };
};

const tryParseBreakCandidate = (
  candidate: string,
):
  | { ok: true; answer: 'yes' | 'no' }
  | { ok: false; errorKind: 'json' | 'schema'; message: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return {
      ok: false,
      errorKind: 'json',
      message: 'Break response must be valid JSON with {"answer":"yes"|"no"}.',
    };
  }

  const validated = validateBreakPayload(parsed);
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

export const parseBreakAnswer = (
  content: string,
): BreakParseSuccess | BreakParseFailure => {
  const attempts: BreakParseAttempt[] = [];
  let lastSchemaMessage = 'Break response must include answer "yes" or "no".';

  attempts.push({ strategy: 'strict', candidateCount: 1 });
  const strict = tryParseBreakCandidate(content);
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
    const parsed = tryParseBreakCandidate(candidate);
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
    const parsed = tryParseBreakCandidate(candidate);
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
      : 'Break response must be valid JSON with {"answer":"yes"|"no"}.',
    attempts,
    reasonCode: sawCandidates ? 'INVALID_SCHEMA' : 'NO_VALID_CANDIDATE',
  };
};

const findFirstAgentStep = (
  steps: FlowStep[],
): FlowLlmStep | FlowBreakStep | FlowCommandStep | undefined => {
  for (const step of steps) {
    if (
      step.type === 'llm' ||
      step.type === 'break' ||
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

const validateCommandSteps = async (
  steps: FlowStep[],
  agentByName: Map<string, { home: string }>,
  repositoryContext: FlowCommandRepositoryContext,
): Promise<void> => {
  for (const step of steps) {
    if (step.type === 'startLoop') {
      await validateCommandSteps(step.steps, agentByName, repositoryContext);
      continue;
    }
    if (step.type === 'command') {
      const agent = agentByName.get(step.agentType);
      if (!agent) {
        throw toFlowRunError(
          'AGENT_NOT_FOUND',
          `Agent ${step.agentType} not found`,
        );
      }
      const commandLoad = await resolveFlowCommandForAgent({
        step,
        context: repositoryContext,
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
): Promise<void> => {
  if (!resumeState) return;
  const entries = Object.entries(resumeState.agentConversations);
  for (const [key, conversationId] of entries) {
    const agentType = key.split(':')[0] ?? '';
    const conversation = await getConversation(conversationId);
    if (conversation && conversation.agentName !== agentType) {
      throw toFlowRunError('AGENT_MISMATCH', `Agent mismatch for ${agentType}`);
    }
  }
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
  flowSourceId?: string;
  flowSourceLabel?: string;
  codeInfo2Root: string;
  listIngestedRepositories: () => Promise<{
    repos: RepoEntry[];
    lockedModelId: string | null;
  }>;
  repos: Array<{ sourceId: string; sourceLabel: string }>;
};

type FlowCommandCandidate = {
  sourceId: string;
  sourceLabel: string;
  slot: RepositoryCandidateOrderSlot;
  agentHome: string;
};

const buildFlowCommandCandidates = (params: {
  context: FlowCommandRepositoryContext;
  agentType: string;
}): {
  orderedCandidates: RepositoryCandidateOrderResult;
  candidates: FlowCommandCandidate[];
} => {
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

  return {
    orderedCandidates,
    candidates: orderedCandidates.candidates.map((candidate) => ({
      sourceId: candidate.sourceId,
      sourceLabel: candidate.sourceLabel,
      slot: candidate.slot,
      agentHome: path.join(
        candidate.sourceId,
        'codex_agents',
        params.agentType,
      ),
    })),
  };
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
  const { orderedCandidates, candidates } = buildFlowCommandCandidates({
    context: params.context,
    agentType: params.step.agentType,
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
  repositoryContext: FlowCommandRepositoryContext;
  conversationId: string;
  inflightId: string;
  modelId: string;
  workingDirectoryOverride?: string;
  source: 'REST' | 'MCP';
  chatFactory?: FlowChatFactory;
  resumeState?: FlowResumeState | null;
  resumeStepPath?: number[];
  customTitle?: string;
  runToken: string;
  cleanupInflightFn?: typeof cleanupInflight;
  releaseConversationLockFn?: typeof releaseConversationLock;
}) {
  const discovered = await discoverAgents();
  const agentByName = new Map(discovered.map((agent) => [agent.name, agent]));

  const loopStack: LoopFrame[] = [];
  const maxStepAttempts = getFlowAndCommandRetries();
  let stepInflightId = params.inflightId;
  let finalizedFlowRuntime = false;
  const resumeStepPath = params.resumeStepPath ?? null;
  let lastCompletedStepPath =
    resumeStepPath ?? params.resumeState?.stepPath ?? [];
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

  const finalizeFlowRuntime = () => {
    if (finalizedFlowRuntime) return;
    finalizedFlowRuntime = true;

    const inflightState = getInflight(params.conversationId);
    const activeInflight =
      inflightState && inflightState.inflightId === stepInflightId
        ? inflightState
        : undefined;

    try {
      if (activeInflight) {
        cleanupInflightFn({
          conversationId: params.conversationId,
          inflightId: stepInflightId,
        });
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
      cleanupPendingConversationCancel({
        conversationId: params.conversationId,
        runToken: params.runToken,
        inflightId: stepInflightId,
      });
      releaseConversationLockFn(params.conversationId, params.runToken);
    }
  };

  const resolveFlowInstructionPrerequisites = async (params: {
    agentType: string;
    configPath?: string;
    source: 'REST' | 'MCP';
  }): Promise<{
    modelId: string;
    runtimeConfig: CodexOptions['config'];
  }> => {
    const agent = agentByName.get(params.agentType);
    if (!agent) {
      throw toFlowRunError(
        'AGENT_NOT_FOUND',
        `Agent ${params.agentType} not found`,
      );
    }

    const detection = refreshCodexDetection();
    if (!detection.available) {
      throw toFlowRunError('CODEX_UNAVAILABLE', detection.reason);
    }

    return resolveFlowAgentRuntimeExecution({
      configPath: params.configPath ?? agent.configPath,
      source: params.source,
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
      configPath: agent.configPath,
      source: params.source,
    });
    const modelId = runtime.modelId;

    const { state: agentState, isNew } = await ensureAgentState({
      agentType: instructionParams.agentType,
      identifier: instructionParams.identifier,
      flowName: params.flowName,
      modelId,
      workingFolder: params.repositoryContext.workingRepositoryPath,
      customTitle: params.customTitle,
      source: params.source,
    });
    if (isNew) {
      await persistFlowResumeState({
        conversationId: params.conversationId,
        stepPath: lastCompletedStepPath,
        loopStack,
        workingFolder: params.repositoryContext.workingRepositoryPath,
      });
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
        modelId,
        runtimeConfig: runtime.runtimeConfig,
        threadId: agentState.threadId,
        systemPrompt,
        workingDirectoryOverride: params.workingDirectoryOverride,
        source: params.source,
        chatFactory: params.chatFactory,
        deferFinal: true,
        postProcess: instructionParams.postProcess,
        command: instructionParams.command,
        runtime: instructionParams.runtime,
        attempt,
        runToken: params.runToken,
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
          void persistFlowResumeState({
            conversationId: params.conversationId,
            stepPath: lastCompletedStepPath,
            loopStack,
            workingFolder: params.repositoryContext.workingRepositoryPath,
          });
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
        const result = await runInstruction({
          agentType: step.agentType,
          identifier: step.identifier,
          instruction,
          command,
        });
        if (shouldStopAfter(result.status)) return result.status;
      }
      return 'ok';
    }

    let resolved;
    try {
      await resolveFlowInstructionPrerequisites({
        agentType: step.agentType,
        source: params.source,
      });
      resolved = await resolveMarkdownFileWithMetadata({
        markdownFile: step.markdownFile,
        workingRepositoryPath: params.repositoryContext.workingRepositoryPath,
        flowSourceId: params.repositoryContext.flowSourceId,
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
          ? await getAgentModelId(agent.configPath)
          : FALLBACK_MODEL_ID,
        source: params.source,
        message,
        errorCode,
        command,
      });
      return 'failed';
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
        resolvedSourceId: resolved.resolvedSourceId,
        instructionLength: resolved.content.length,
      },
    });

    const result = await runInstruction({
      agentType: step.agentType,
      identifier: step.identifier,
      instruction: resolved.content,
      command,
      runtime: {
        ...(params.repositoryContext.workingRepositoryPath
          ? { workingFolder: params.repositoryContext.workingRepositoryPath }
          : {}),
        lookupSummary: resolved.lookupSummary,
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

    const stopCommandBeforeHandoff = async (): Promise<boolean> => {
      const pendingCancel = consumePendingConversationCancel({
        conversationId: params.conversationId,
        runToken: params.runToken,
      });
      if (!pendingCancel) return false;

      const modelId = await getAgentModelId(agent.configPath);
      await emitStoppedFlowStep({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction: `Command: ${step.commandName}`,
        modelId,
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
        const modelId = await getAgentModelId(agent.configPath);
        await emitFailedFlowStep({
          flowConversationId: params.conversationId,
          inflightId: stepInflightId,
          instruction: `Command: ${step.commandName}`,
          modelId,
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
                currentOwnerSourceId: commandLoad.sourceId,
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

              await flowServiceDeps.runReingestStepLifecycle({
                conversationId: params.conversationId,
                modelId: await getAgentModelId(agent.configPath),
                source: params.source,
                command,
                toolResult,
              });

              if (result.value.kind === 'single') {
                let stopAfter = false;
                if (pendingCancelAfterWait) {
                  await emitStoppedFlowStep({
                    flowConversationId: params.conversationId,
                    inflightId: stepInflightId,
                    instruction: `Command: ${step.commandName}`,
                    modelId: await getAgentModelId(agent.configPath),
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
                await emitStoppedFlowStep({
                  flowConversationId: params.conversationId,
                  inflightId: stepInflightId,
                  instruction: `Command: ${step.commandName}`,
                  modelId: await getAgentModelId(agent.configPath),
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
            | {
                itemType: 'reingest';
                result: ExecuteCommandItemReingestResult;
              };
        } catch (error) {
          const modelId = await getAgentModelId(agent.configPath);
          await emitFailedFlowStep({
            flowConversationId: params.conversationId,
            inflightId: stepInflightId,
            instruction: `Command: ${step.commandName}`,
            modelId,
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
        currentOwnerSourceId: params.repositoryContext.flowSourceId,
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
    if (
      resumePath &&
      typeof savedIteration === 'number' &&
      savedIteration > 0
    ) {
      loopFrame.iteration = Math.max(savedIteration - 1, 0);
    }
    loopStack.push(loopFrame);
    let resumeForLoop = resumePath;
    while (true) {
      loopFrame.iteration += 1;
      const outcome = await runSteps(step.steps, nextPath, resumeForLoop);
      if (resumeForLoop) resumeForLoop = null;
      if (outcome === 'break') {
        loopStack.pop();
        break;
      }
      if (outcome !== 'ok') {
        loopStack.pop();
        return outcome;
      }
    }
    lastCompletedStepPath = nextPath;
    await persistFlowResumeState({
      conversationId: params.conversationId,
      stepPath: lastCompletedStepPath,
      loopStack,
      workingFolder: params.repositoryContext.workingRepositoryPath,
    });
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
          await persistFlowResumeState({
            conversationId: params.conversationId,
            stepPath: lastCompletedStepPath,
            loopStack,
            workingFolder: params.repositoryContext.workingRepositoryPath,
          });
          return status;
        }
        lastCompletedStepPath = nextPath;
        await persistFlowResumeState({
          conversationId: params.conversationId,
          stepPath: lastCompletedStepPath,
          loopStack,
          workingFolder: params.repositoryContext.workingRepositoryPath,
        });
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
          await persistFlowResumeState({
            conversationId: params.conversationId,
            stepPath: lastCompletedStepPath,
            loopStack,
            workingFolder: params.repositoryContext.workingRepositoryPath,
          });
          return status;
        }
        lastCompletedStepPath = nextPath;
        await persistFlowResumeState({
          conversationId: params.conversationId,
          stepPath: lastCompletedStepPath,
          loopStack,
          workingFolder: params.repositoryContext.workingRepositoryPath,
        });
        if (shouldBreak) return 'break';
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
          await persistFlowResumeState({
            conversationId: params.conversationId,
            stepPath: lastCompletedStepPath,
            loopStack,
            workingFolder: params.repositoryContext.workingRepositoryPath,
          });
          return status;
        }
        lastCompletedStepPath = nextPath;
        await persistFlowResumeState({
          conversationId: params.conversationId,
          stepPath: lastCompletedStepPath,
          loopStack,
          workingFolder: params.repositoryContext.workingRepositoryPath,
        });
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
          await persistFlowResumeState({
            conversationId: params.conversationId,
            stepPath: lastCompletedStepPath,
            loopStack,
            workingFolder: params.repositoryContext.workingRepositoryPath,
          });
          return status;
        }
        lastCompletedStepPath = nextPath;
        await persistFlowResumeState({
          conversationId: params.conversationId,
          stepPath: lastCompletedStepPath,
          loopStack,
          workingFolder: params.repositoryContext.workingRepositoryPath,
        });
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
    if (outcome !== 'ok') return;
  } finally {
    finalizeFlowRuntime();
  }
}

export async function startFlowRun(
  params: FlowRunStartParams,
): Promise<FlowRunStartResult> {
  const flowName = params.flowName.trim();
  const sourceId = params.sourceId?.trim() || undefined;
  const conversationId = params.conversationId ?? crypto.randomUUID();
  const inflightId = params.inflightId ?? crypto.randomUUID();
  const resumeStepPath = params.resumeStepPath;
  const listRepos = params.listIngestedRepositories ?? listIngestedRepositories;

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
  let resumeState: FlowResumeState | null = null;
  let repositoryContext: FlowCommandRepositoryContext | null = null;

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
      ? listedRepos.find(
          (item) => path.resolve(item.containerPath) === path.resolve(sourceId),
        )
      : undefined;
    if (sourceId) {
      if (!sourceRepo) {
        throw toFlowRunError('FLOW_NOT_FOUND');
      }
      const resolved = resolveRepoEmbeddingIdentity(sourceRepo);
      append({
        level: 'info',
        message: 'DEV-0000036:T11:transitive_consumer_contract_read',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          consumer: 'flows.service.startFlowRun',
          sourceId,
          embeddingProvider: resolved.embeddingProvider,
          embeddingModel: resolved.embeddingModel,
          embeddingDimensions: resolved.embeddingDimensions,
          modelId: resolved.modelId,
        },
      });
      append({
        level: 'info',
        message: 'DEV-0000036:T11:transitive_consumer_alias_fallback',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          consumer: 'flows.service.startFlowRun',
          sourceId,
          aliasFallbackUsed: resolved.aliasFallbackUsed,
        },
      });
      flowsRoot = path.resolve(sourceRepo.containerPath, 'flows');
    }
    flow = await loadFlowFile({ flowName, flowsRoot, sourceId });
    if (!flow.steps.length) {
      throw toFlowRunError('NO_STEPS', 'Flow has no steps');
    }

    const existingConversation = await getConversation(conversationId);
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

    resumeState = parseFlowResumeState(
      (existingConversation?.flags ?? undefined) as
        | Record<string, unknown>
        | undefined,
    );
    if (resumeStepPath) {
      validateResumeStepPath(flow.steps, resumeStepPath);
      await validateResumeAgentConversations(resumeState);
    }
    hydrateFlowAgentState(resumeState);

    const firstAgentStep = findFirstAgentStep(flow.steps);
    const discovered = await discoverAgents();
    const agentByName = new Map(discovered.map((item) => [item.name, item]));
    if (firstAgentStep) {
      const agent = agentByName.get(firstAgentStep.agentType);
      if (!agent) {
        throw toFlowRunError(
          'AGENT_NOT_FOUND',
          `Agent ${firstAgentStep.agentType} not found`,
        );
      }

      const detection = refreshCodexDetection();
      if (!detection.available) {
        throw toFlowRunError('CODEX_UNAVAILABLE', detection.reason);
      }

      modelId = await getAgentModelId(agent.configPath);
    }

    const codeInfo2Root = codeInfo2RootForRun();
    repositoryContext = {
      flowName,
      workingRepositoryPath: effectiveWorkingFolder,
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

    await validateCommandSteps(flow.steps, agentByName, repositoryContext);

    await ensureFlowConversation({
      conversationId,
      flowName,
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
      const workingDirectoryOverride =
        await resolveWorkingFolderWorkingDirectory(params.working_folder);
      await runFlowUnlocked({
        flowName,
        flow,
        repositoryContext,
        conversationId,
        inflightId,
        modelId,
        workingDirectoryOverride,
        source: params.source,
        chatFactory: params.chatFactory,
        resumeState,
        resumeStepPath,
        customTitle: params.customTitle,
        runToken,
        cleanupInflightFn: params.cleanupInflightFn,
        releaseConversationLockFn: params.releaseConversationLockFn,
      });
    } catch (err) {
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
      cleanupPendingConversationCancel({ conversationId, runToken });
      const releaseConversationLockFn =
        params.releaseConversationLockFn ?? releaseConversationLock;
      releaseConversationLockFn(conversationId, runToken);
    }
  })();

  append({
    level: 'info',
    message: 'flows.run.started',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: { flowName, conversationId, inflightId },
  });

  return { flowName, conversationId, inflightId, modelId };
}
