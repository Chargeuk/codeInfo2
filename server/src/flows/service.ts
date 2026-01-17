import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

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
} from '../mongo/repo.js';
import type {
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
  type FlowLlmStep,
} from './flowSchema.js';
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

const ensureAgentState = (
  agentType: string,
  identifier: string,
): FlowAgentState => {
  const key = getAgentKey(agentType, identifier);
  const existing = agentConversationState.get(key);
  if (existing) return existing;
  const state = {
    conversationId: crypto.randomUUID(),
  } satisfies FlowAgentState;
  agentConversationState.set(key, state);
  return state;
};

const getAgentModelId = async (configPath: string): Promise<string> =>
  (await readAgentModelId(configPath)) ?? FALLBACK_MODEL_ID;

const shouldStopAfter = (status: TurnStatus): boolean => status !== 'ok';

const deriveStatusFromError = (message: string | undefined): TurnStatus => {
  const text = (message ?? '').toLowerCase();
  if (text.includes('abort') || text.includes('stop')) return 'stopped';
  return 'failed';
};

const joinMessageContent = (content: string[]) => content.join('\n');

async function persistFlowTurn(params: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  model: string;
  provider: string;
  source: 'REST' | 'MCP';
  status: TurnStatus;
  toolCalls: Record<string, unknown> | null;
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
  onThreadId: (threadId: string) => void;
}): Promise<TurnStatus> => {
  const createdAtIso = new Date().toISOString();
  createInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
    provider: 'codex',
    model: params.modelId,
    source: params.source,
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
    createdAt: userCreatedAt,
  });

  const assistantCreatedAt = new Date();
  const assistantPersisted = await persistFlowTurn({
    conversationId: params.flowConversationId,
    role: 'assistant',
    content,
    model: params.modelId,
    provider: 'codex',
    source: params.source,
    status,
    toolCalls,
    usage: latestUsage,
    timing: latestTiming,
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
  cleanupInflight({
    conversationId: params.flowConversationId,
    inflightId: params.inflightId,
  });

  return status;
};

async function runFlowUnlocked(params: {
  flowName: string;
  flow: FlowFile;
  conversationId: string;
  inflightId: string;
  workingDirectoryOverride?: string;
  source: 'REST' | 'MCP';
  chatFactory?: FlowChatFactory;
}) {
  const discovered = await discoverAgents();
  const agentByName = new Map(discovered.map((agent) => [agent.name, agent]));

  let stepInflightId = params.inflightId;

  for (const step of params.flow.steps) {
    if (step.type !== 'llm') {
      throw toFlowRunError(
        'UNSUPPORTED_STEP',
        `Flow step type ${step.type} not supported yet`,
      );
    }

    const llmStep = step as FlowLlmStep;
    const agent = agentByName.get(llmStep.agentType);
    if (!agent) {
      throw toFlowRunError(
        'AGENT_NOT_FOUND',
        `Agent ${llmStep.agentType} not found`,
      );
    }

    const detection = detectCodexForHome(agent.home);
    if (!detection.available) {
      throw toFlowRunError('CODEX_UNAVAILABLE', detection.reason);
    }

    const agentState = ensureAgentState(llmStep.agentType, llmStep.identifier);

    const modelId = await getAgentModelId(agent.configPath);

    for (const message of llmStep.messages) {
      const instruction = joinMessageContent(message.content);
      let systemPrompt: string | undefined;
      if (!agentState.threadId && agent.systemPromptPath) {
        try {
          systemPrompt = await fs.readFile(agent.systemPromptPath, 'utf8');
        } catch {
          systemPrompt = undefined;
        }
      }

      const status = await runFlowInstruction({
        flowConversationId: params.conversationId,
        inflightId: stepInflightId,
        instruction,
        agentConversationId: agentState.conversationId,
        agentHome: agent.home,
        modelId,
        threadId: agentState.threadId,
        systemPrompt,
        workingDirectoryOverride: params.workingDirectoryOverride,
        source: params.source,
        chatFactory: params.chatFactory,
        onThreadId: (threadId) => {
          agentState.threadId = threadId;
        },
      });

      if (shouldStopAfter(status)) return;

      stepInflightId = crypto.randomUUID();
    }
  }
}

export async function startFlowRun(
  params: FlowRunStartParams,
): Promise<FlowRunStartResult> {
  const flowName = params.flowName.trim();
  const conversationId = params.conversationId ?? crypto.randomUUID();
  const inflightId = params.inflightId ?? crypto.randomUUID();

  if (!tryAcquireConversationLock(conversationId)) {
    throw toFlowRunError(
      'RUN_IN_PROGRESS',
      'A run is already in progress for this conversation.',
    );
  }

  let flow: FlowFile;
  let modelId = FALLBACK_MODEL_ID;

  try {
    flow = await loadFlowFile(flowName);
    if (!flow.steps.length) {
      throw toFlowRunError('NO_STEPS', 'Flow has no steps');
    }
    if (flow.steps.some((step) => step.type !== 'llm')) {
      throw toFlowRunError(
        'UNSUPPORTED_STEP',
        'Only llm steps are supported in this flow run',
      );
    }

    const existingConversation = await getConversation(conversationId);
    if (existingConversation?.archivedAt) {
      throw toFlowRunError('CONVERSATION_ARCHIVED');
    }

    const firstLlmStep = flow.steps.find((step) => step.type === 'llm') as
      | FlowLlmStep
      | undefined;
    if (!firstLlmStep) {
      throw toFlowRunError('UNSUPPORTED_STEP', 'No llm steps found');
    }

    const discovered = await discoverAgents();
    const agent = discovered.find(
      (item) => item.name === firstLlmStep.agentType,
    );
    if (!agent) {
      throw toFlowRunError(
        'AGENT_NOT_FOUND',
        `Agent ${firstLlmStep.agentType} not found`,
      );
    }

    const detection = detectCodexForHome(agent.home);
    if (!detection.available) {
      throw toFlowRunError('CODEX_UNAVAILABLE', detection.reason);
    }

    modelId = await getAgentModelId(agent.configPath);

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
