import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadAgentCommandFile } from '../agents/commandsLoader.js';
import { readAgentModelId } from '../agents/config.js';
import { discoverAgents } from '../agents/discovery.js';
import {
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../agents/runLock.js';
import { resolveWorkingFolderWorkingDirectory } from '../agents/service.js';
import { isTransientReconnect } from '../agents/transientReconnect.js';
import { attachChatStreamBridge } from '../chat/chatStreamBridge.js';
import { getChatInterface, UnsupportedProviderError } from '../chat/factory.js';
import {
  cleanupInflight,
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
} from '../chat/memoryPersistence.js';
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
} from '../mongo/repo.js';
import type {
  TurnCommandMetadata,
  Turn,
  TurnStatus,
  TurnTimingMetadata,
  TurnUsageMetadata,
} from '../mongo/turn.js';
import { detectCodexForHome } from '../providers/codexDetection.js';
import { publishUserTurn } from '../ws/server.js';

import {
  parseFlowFile,
  type FlowFile,
  type FlowBreakStep,
  type FlowCommandStep,
  type FlowLlmStep,
  type FlowStartLoopStep,
  type FlowStep,
} from './flowSchema.js';
import type { FlowResumeState } from './flowState.js';
import type {
  FlowAgentState,
  FlowChatFactory,
  FlowRunError,
  FlowRunErrorCode,
  FlowRunStartParams,
  FlowRunStartResult,
} from './types.js';

const FALLBACK_MODEL_ID = 'gpt-5.1-codex-max';
const agentConversationState = new Map<string, FlowAgentState>();

const toFlowRunError = (code: FlowRunErrorCode, reason?: string) =>
  ({ code, reason }) satisfies FlowRunError;

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
          return {
            stepPath: normalizeNumberArray(item.stepPath),
            iteration:
              typeof item.iteration === 'number' &&
              Number.isFinite(item.iteration)
                ? item.iteration
                : 0,
          };
        })
        .filter((item): item is { stepPath: number[]; iteration: number } =>
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

const ensureFlowConversation = async (params: {
  conversationId: string;
  flowName: string;
  modelId: string;
  source: 'REST' | 'MCP';
}): Promise<void> => {
  const now = new Date();
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
      title: `Flow: ${params.flowName}`,
      flowName: params.flowName,
      source: params.source,
      flags: {},
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
    provider: 'codex',
    model: params.modelId,
    title: `Flow: ${params.flowName}`,
    flowName: params.flowName,
    source: params.source,
    flags: {},
    lastMessageAt: now,
  });
};

const ensureFlowAgentConversation = async (params: {
  conversationId: string;
  flowName: string;
  agentType: string;
  identifier: string;
  modelId: string;
  source: 'REST' | 'MCP';
}): Promise<void> => {
  const now = new Date();
  if (shouldUseMemoryPersistence()) {
    const existing = memoryConversations.get(params.conversationId);
    if (existing) return;
    memoryConversations.set(params.conversationId, {
      _id: params.conversationId,
      provider: 'codex',
      model: params.modelId,
      title: `Flow: ${params.flowName} (${params.identifier})`,
      agentName: params.agentType,
      source: params.source,
      flags: {},
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
    provider: 'codex',
    model: params.modelId,
    title: `Flow: ${params.flowName} (${params.identifier})`,
    agentName: params.agentType,
    source: params.source,
    flags: {},
    lastMessageAt: now,
  });
};

const flowsDirForRun = () => process.env.FLOWS_DIR ?? path.resolve('flows');

const loadFlowFile = async (flowName: string): Promise<FlowFile> => {
  if (!isSafeFlowName(flowName)) {
    throw toFlowRunError('FLOW_INVALID_NAME', 'Invalid flow name');
  }

  const filePath = path.join(flowsDirForRun(), `${flowName}.json`);
  const jsonText = await fs.readFile(filePath, 'utf8').catch((error) => {
    if ((error as { code?: string }).code === 'ENOENT') {
      throw toFlowRunError('FLOW_NOT_FOUND');
    }
    throw error;
  });

  const parsed = parseFlowFile(jsonText);
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
      source: params.source,
    });
    return { state: existing, isNew: false };
  }

  const state = {
    conversationId: crypto.randomUUID(),
  } satisfies FlowAgentState;
  agentConversationState.set(key, state);
  await ensureFlowAgentConversation({
    conversationId: state.conversationId,
    flowName: params.flowName,
    agentType: params.agentType,
    identifier: params.identifier,
    modelId: params.modelId,
    source: params.source,
  });
  return { state, isNew: true };
};

const getAgentModelId = async (configPath: string): Promise<string> =>
  (await readAgentModelId(configPath)) ?? FALLBACK_MODEL_ID;

const hydrateFlowAgentState = (resumeState: FlowResumeState | null) => {
  if (!resumeState) return;
  Object.entries(resumeState.agentConversations).forEach(
    ([key, conversationId]) => {
      const threadId = resumeState.agentThreads[key];
      agentConversationState.set(key, {
        conversationId,
        threadId,
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
  step: FlowLlmStep | FlowBreakStep | FlowCommandStep;
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
    agentType: params.step.agentType,
    identifier: params.step.identifier,
    label,
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

const runFlowInstruction = async (params: {
  flowConversationId: string;
  inflightId: string;
  instruction: string;
  agentConversationId: string;
  agentHome: string;
  modelId: string;
  threadId?: string;
  systemPrompt?: string;
  workingDirectoryOverride?: string;
  source: 'REST' | 'MCP';
  chatFactory?: FlowChatFactory;
  deferFinal?: boolean;
  postProcess?: FlowInstructionPostProcess;
  onThreadId: (threadId: string) => void;
  command?: TurnCommandMetadata;
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

  try {
    await chat.run(
      params.instruction,
      {
        provider: 'codex',
        inflightId: params.inflightId,
        threadId: params.threadId,
        useConfigDefaults: true,
        codexHome: params.agentHome,
        ...(params.workingDirectoryOverride !== undefined
          ? { workingDirectoryOverride: params.workingDirectoryOverride }
          : {}),
        disableSystemContext: true,
        systemPrompt: params.systemPrompt,
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

  if (status === 'ok' && inflightSignal?.aborted) {
    status = 'stopped';
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
    content: result.content,
    model: params.modelId,
    provider: 'codex',
    source: params.source,
    status: result.status,
    toolCalls,
    command: params.command,
    usage: result.usage,
    timing: result.timing,
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

  if (params.deferFinal) {
    bridge.finalize({
      override: postProcessed?.finalOverride,
      fallback: {
        status: result.status,
        threadId: params.threadId,
      },
    });
  }

  cleanupInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
  });

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

type FlowStepOutcome = TurnStatus | 'break';

type LoopFrame = {
  loopStepPath: number[];
  iteration: number;
};

const buildFlowResumeState = (params: {
  stepPath: number[];
  loopStack: LoopFrame[];
}): FlowResumeState => {
  const agentConversations: Record<string, string> = {};
  const agentThreads: Record<string, string> = {};
  agentConversationState.forEach((state, key) => {
    agentConversations[key] = state.conversationId;
    if (state.threadId) {
      agentThreads[key] = state.threadId;
    }
  });

  return {
    stepPath: [...params.stepPath],
    loopStack: params.loopStack.map((frame) => ({
      stepPath: [...frame.loopStepPath],
      iteration: frame.iteration,
    })),
    agentConversations,
    agentThreads,
  };
};

const persistFlowResumeState = async (params: {
  conversationId: string;
  stepPath: number[];
  loopStack: LoopFrame[];
}) => {
  const flowState = buildFlowResumeState({
    stepPath: params.stepPath,
    loopStack: params.loopStack,
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

const parseBreakAnswer = (
  content: string,
): { ok: true; answer: 'yes' | 'no' } | { ok: false; message: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ok: false,
      message: 'Break response must be valid JSON with {"answer":"yes"|"no"}.',
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      message:
        'Break response must be a JSON object with {"answer":"yes"|"no"}.',
    };
  }

  const answer = (parsed as { answer?: unknown }).answer;
  if (answer !== 'yes' && answer !== 'no') {
    return {
      ok: false,
      message: 'Break response must include answer "yes" or "no".',
    };
  }

  return { ok: true, answer };
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

const hasUnsupportedStep = (steps: FlowStep[]): boolean => {
  for (const step of steps) {
    if (step.type === 'startLoop' && hasUnsupportedStep(step.steps)) {
      return true;
    }
  }
  return false;
};

const validateCommandSteps = async (
  steps: FlowStep[],
  agentByName: Map<string, { home: string }>,
): Promise<void> => {
  for (const step of steps) {
    if (step.type === 'startLoop') {
      await validateCommandSteps(step.steps, agentByName);
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
      const commandLoad = await loadCommandForAgent({
        agentHome: agent.home,
        commandName: step.commandName,
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

const loadCommandForAgent = async (params: {
  agentHome: string;
  commandName: string;
}): Promise<
  | {
      ok: true;
      commandName: string;
      command: { items: Array<{ content: string[] }> };
    }
  | { ok: false; message: string }
> => {
  const rawName = params.commandName;
  if (!isSafeCommandName(rawName)) {
    return { ok: false, message: 'commandName must be a valid file name' };
  }

  const commandName = rawName.trim();
  const commandsDir = path.join(params.agentHome, 'commands');
  const filePath = path.join(commandsDir, `${commandName}.json`);
  const commandStat = await fs.stat(filePath).catch((error) => {
    if ((error as { code?: string }).code === 'ENOENT') return null;
    throw error;
  });
  if (!commandStat?.isFile()) {
    return {
      ok: false,
      message: `Command ${commandName} not found for agent`,
    };
  }

  const parsed = await loadAgentCommandFile({ filePath });
  if (!parsed.ok) {
    return {
      ok: false,
      message: `Command ${commandName} failed schema validation`,
    };
  }

  return { ok: true, commandName, command: parsed.command };
};

async function runFlowUnlocked(params: {
  flowName: string;
  flow: FlowFile;
  conversationId: string;
  inflightId: string;
  workingDirectoryOverride?: string;
  source: 'REST' | 'MCP';
  chatFactory?: FlowChatFactory;
  resumeState?: FlowResumeState | null;
  resumeStepPath?: number[];
}) {
  const discovered = await discoverAgents();
  const agentByName = new Map(discovered.map((agent) => [agent.name, agent]));

  const loopStack: LoopFrame[] = [];
  let stepInflightId = params.inflightId;
  const resumeStepPath = params.resumeStepPath ?? null;
  let lastCompletedStepPath =
    resumeStepPath ?? params.resumeState?.stepPath ?? [];
  const resumeLoopIterations = new Map<string, number>();
  if (params.resumeState) {
    params.resumeState.loopStack.forEach((frame) => {
      resumeLoopIterations.set(getStepPathKey(frame.stepPath), frame.iteration);
    });
  }

  const runInstruction = async (instructionParams: {
    agentType: string;
    identifier: string;
    instruction: string;
    deferFinal?: boolean;
    postProcess?: FlowInstructionPostProcess;
    command?: TurnCommandMetadata;
  }): Promise<FlowInstructionResult> => {
    const agent = agentByName.get(instructionParams.agentType);
    if (!agent) {
      throw toFlowRunError(
        'AGENT_NOT_FOUND',
        `Agent ${instructionParams.agentType} not found`,
      );
    }

    const detection = detectCodexForHome(agent.home);
    if (!detection.available) {
      throw toFlowRunError('CODEX_UNAVAILABLE', detection.reason);
    }

    const modelId = await getAgentModelId(agent.configPath);

    const { state: agentState, isNew } = await ensureAgentState({
      agentType: instructionParams.agentType,
      identifier: instructionParams.identifier,
      flowName: params.flowName,
      modelId,
      source: params.source,
    });
    if (isNew) {
      await persistFlowResumeState({
        conversationId: params.conversationId,
        stepPath: lastCompletedStepPath,
        loopStack,
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

    const result = await runFlowInstruction({
      flowConversationId: params.conversationId,
      inflightId: stepInflightId,
      instruction: instructionParams.instruction,
      agentConversationId: agentState.conversationId,
      agentHome: agent.home,
      modelId,
      threadId: agentState.threadId,
      systemPrompt,
      workingDirectoryOverride: params.workingDirectoryOverride,
      source: params.source,
      chatFactory: params.chatFactory,
      deferFinal: instructionParams.deferFinal,
      postProcess: instructionParams.postProcess,
      command: instructionParams.command,
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
        });
      },
    });

    if (!shouldStopAfter(result.status)) {
      stepInflightId = crypto.randomUUID();
    }

    return result;
  };

  const runLlmStep = async (
    step: FlowLlmStep,
    command: TurnCommandMetadata,
  ): Promise<TurnStatus> => {
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
          content: JSON.stringify({ answer: parsed.answer }),
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

    const commandLoad = await loadCommandForAgent({
      agentHome: agent.home,
      commandName: step.commandName,
    });
    if (!commandLoad.ok) {
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
      return 'failed';
    }

    for (const item of commandLoad.command.items) {
      const instruction = joinMessageContent(item.content);
      const result = await runInstruction({
        agentType: step.agentType,
        identifier: step.identifier,
        instruction,
        command,
      });
      if (shouldStopAfter(result.status)) return result.status;
    }

    return 'ok';
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
          });
          return status;
        }
        lastCompletedStepPath = nextPath;
        await persistFlowResumeState({
          conversationId: params.conversationId,
          stepPath: lastCompletedStepPath,
          loopStack,
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
          });
          return status;
        }
        lastCompletedStepPath = nextPath;
        await persistFlowResumeState({
          conversationId: params.conversationId,
          stepPath: lastCompletedStepPath,
          loopStack,
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
          });
          return status;
        }
        lastCompletedStepPath = nextPath;
        await persistFlowResumeState({
          conversationId: params.conversationId,
          stepPath: lastCompletedStepPath,
          loopStack,
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

  const outcome = await runSteps(params.flow.steps, [], resumeStepPath);
  if (outcome !== 'ok') return;
}

export async function startFlowRun(
  params: FlowRunStartParams,
): Promise<FlowRunStartResult> {
  const flowName = params.flowName.trim();
  const conversationId = params.conversationId ?? crypto.randomUUID();
  const inflightId = params.inflightId ?? crypto.randomUUID();
  const resumeStepPath = params.resumeStepPath;

  if (!tryAcquireConversationLock(conversationId)) {
    throw toFlowRunError(
      'RUN_IN_PROGRESS',
      'A run is already in progress for this conversation.',
    );
  }

  let flow: FlowFile;
  let modelId = FALLBACK_MODEL_ID;
  let resumeState: FlowResumeState | null = null;

  try {
    flow = await loadFlowFile(flowName);
    if (!flow.steps.length) {
      throw toFlowRunError('NO_STEPS', 'Flow has no steps');
    }
    if (hasUnsupportedStep(flow.steps)) {
      throw toFlowRunError(
        'UNSUPPORTED_STEP',
        'Only llm, startLoop, break, and command steps are supported in this flow run',
      );
    }

    const existingConversation = await getConversation(conversationId);
    if (existingConversation?.archivedAt) {
      throw toFlowRunError('CONVERSATION_ARCHIVED');
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
    if (!firstAgentStep) {
      throw toFlowRunError('UNSUPPORTED_STEP', 'No agent steps found');
    }

    const discovered = await discoverAgents();
    const agentByName = new Map(discovered.map((item) => [item.name, item]));
    const agent = agentByName.get(firstAgentStep.agentType);
    if (!agent) {
      throw toFlowRunError(
        'AGENT_NOT_FOUND',
        `Agent ${firstAgentStep.agentType} not found`,
      );
    }

    const detection = detectCodexForHome(agent.home);
    if (!detection.available) {
      throw toFlowRunError('CODEX_UNAVAILABLE', detection.reason);
    }

    modelId = await getAgentModelId(agent.configPath);

    await validateCommandSteps(flow.steps, agentByName);

    await ensureFlowConversation({
      conversationId,
      flowName,
      modelId,
      source: params.source,
    });

    await resolveWorkingFolderWorkingDirectory(params.working_folder);
  } catch (err) {
    releaseConversationLock(conversationId);
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
      const workingDirectoryOverride =
        await resolveWorkingFolderWorkingDirectory(params.working_folder);
      await runFlowUnlocked({
        flowName,
        flow,
        conversationId,
        inflightId,
        workingDirectoryOverride,
        source: params.source,
        chatFactory: params.chatFactory,
        resumeState,
        resumeStepPath,
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
      releaseConversationLock(conversationId);
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
