import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { CodexOptions } from '@openai/codex-sdk';

import { attachChatStreamBridge } from '../chat/chatStreamBridge.js';
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
  memoryConversations,
  recordMemoryTurn,
  shouldUseMemoryPersistence,
  updateMemoryConversationMeta,
} from '../chat/memoryPersistence.js';
import { McpResponder } from '../chat/responders/McpResponder.js';
import { RuntimeConfigResolutionError } from '../config/runtimeConfig.js';
import { mapHostWorkingFolderToWorkdir } from '../ingest/pathMap.js';
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
} from '../mongo/repo.js';
import type { Turn, TurnCommandMetadata, TurnSource } from '../mongo/turn.js';
import { refreshCodexDetection } from '../providers/codexDetection.js';
import { publishUserTurn } from '../ws/server.js';

import {
  loadAgentCommandFile,
  loadAgentCommandSummary,
} from './commandsLoader.js';
import { runAgentCommandRunner } from './commandsRunner.js';
import { resolveAgentRuntimeExecutionConfig } from './config.js';
import { discoverAgents } from './discovery.js';
import {
  getActiveRunOwnership,
  releaseConversationLock,
  tryAcquireConversationLock,
} from './runLock.js';
import type { AgentSummary } from './types.js';

export async function listAgents(): Promise<{ agents: AgentSummary[] }> {
  const discovered = await discoverAgents();
  return {
    agents: discovered.map((agent) => ({
      name: agent.name,
      description: agent.description,
      disabled: agent.disabled,
      warnings: agent.warnings,
    })),
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
  modelId: string;
  segments: unknown[];
};

type AgentServiceDeps = {
  listIngestedRepositories: typeof listIngestedRepositories;
};

type InstructionRuntimeCleanupFn = typeof cleanupInflight;
type InstructionReleaseLockFn = typeof releaseConversationLock;

type RunAgentErrorCode =
  | 'AGENT_NOT_FOUND'
  | 'CONVERSATION_ARCHIVED'
  | 'AGENT_MISMATCH'
  | 'RUN_IN_PROGRESS'
  | 'COMMAND_NOT_FOUND'
  | 'COMMAND_INVALID'
  | 'INVALID_START_STEP'
  | 'CODEX_UNAVAILABLE'
  | 'WORKING_FOLDER_INVALID'
  | 'WORKING_FOLDER_NOT_FOUND';

type RunAgentError = {
  code: RunAgentErrorCode;
  reason?: string;
};

const toRunAgentError = (code: RunAgentErrorCode, reason?: string) =>
  ({ code, reason }) satisfies RunAgentError;

const T06_SUCCESS_LOG =
  '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=success';
const T06_ERROR_LOG =
  '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=error';
const T07_SUCCESS_LOG =
  '[DEV-0000037][T07] event=runtime_overrides_applied_flow_mcp result=success';
const T07_ERROR_LOG =
  '[DEV-0000037][T07] event=runtime_overrides_applied_flow_mcp result=error';
const agentServiceDeps: AgentServiceDeps = {
  listIngestedRepositories,
};

export function __setAgentServiceDepsForTests(
  overrides: Partial<AgentServiceDeps>,
) {
  Object.assign(agentServiceDeps, overrides);
}

export function __resetAgentServiceDepsForTests() {
  agentServiceDeps.listIngestedRepositories = listIngestedRepositories;
}

function logTransitiveContractRead(params: {
  consumer: string;
  sourceId: string;
  repo: RepoEntry;
}) {
  const resolved = resolveRepoEmbeddingIdentity(params.repo);
  append({
    level: 'info',
    message: 'DEV-0000036:T11:transitive_consumer_contract_read',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      consumer: params.consumer,
      sourceId: params.sourceId,
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
      consumer: params.consumer,
      sourceId: params.sourceId,
      aliasFallbackUsed: resolved.aliasFallbackUsed,
    },
  });
}

export async function resolveWorkingFolderWorkingDirectory(
  working_folder: string | undefined,
): Promise<string | undefined> {
  if (!working_folder || !working_folder.trim()) return undefined;

  const workingFolder = working_folder;
  const normalized = workingFolder.replace(/\\/g, '/');
  const raw = workingFolder;
  if (!(path.posix.isAbsolute(normalized) || path.win32.isAbsolute(raw))) {
    throw {
      code: 'WORKING_FOLDER_INVALID',
      reason: 'working_folder must be an absolute path',
    } as const;
  }

  const hostIngestDir = process.env.HOST_INGEST_DIR;
  const codexWorkdir =
    process.env.CODEX_WORKDIR ?? process.env.CODEINFO_CODEX_WORKDIR ?? '/data';

  const isDirectory = async (dirPath: string): Promise<boolean> => {
    const stat = await fs.stat(dirPath).catch(() => null);
    return Boolean(stat && stat.isDirectory());
  };

  if (hostIngestDir && hostIngestDir.length > 0) {
    const normalizedHostIngestDir = hostIngestDir.replace(/\\/g, '/');
    if (
      path.posix.isAbsolute(normalizedHostIngestDir) &&
      path.posix.isAbsolute(normalized)
    ) {
      const mapped = mapHostWorkingFolderToWorkdir({
        hostIngestDir,
        codexWorkdir,
        hostWorkingFolder: workingFolder,
      });

      if ('mappedPath' in mapped) {
        if (await isDirectory(mapped.mappedPath)) return mapped.mappedPath;
      }
    }
  }

  if (await isDirectory(workingFolder)) return workingFolder;

  throw {
    code: 'WORKING_FOLDER_NOT_FOUND',
    reason: 'working_folder not found',
  } as const;
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

async function ensureAgentConversation(params: {
  conversationId: string;
  agentName: string;
  modelId: string;
  title: string;
  source: 'REST' | 'MCP';
  inflightId?: string;
  chatFactory?: typeof getChatInterface;
}): Promise<void> {
  const now = new Date();
  if (shouldUseMemoryPersistence()) {
    const existing = memoryConversations.get(params.conversationId);
    if (existing) return;
    memoryConversations.set(params.conversationId, {
      _id: params.conversationId,
      provider: 'codex',
      model: params.modelId,
      title: params.title,
      agentName: params.agentName,
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
    title: params.title,
    agentName: params.agentName,
    source: params.source,
    flags: {},
    lastMessageAt: now,
  });
}

class NoopChat extends ChatInterface {
  async execute(): Promise<void> {
    return undefined;
  }
}

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

async function emitFailedAgentCommandStep(params: {
  conversationId: string;
  inflightId: string;
  instruction: string;
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
    provider: 'codex',
    model: params.modelId,
    source: params.source,
    command: params.command,
    userTurn: { content: params.instruction, createdAt: createdAtIso },
  });

  const bridge = attachChatStreamBridge({
    conversationId: params.conversationId,
    inflightId: params.inflightId,
    provider: 'codex',
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
      provider: 'codex',
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
      provider: 'codex',
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
): Promise<{ conversationId: string; inflightId: string; modelId: string }> {
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

  try {
    const discovered = await discoverAgents();
    const agent = discovered.find((item) => item.name === params.agentName);
    if (!agent) {
      throw toRunAgentError('AGENT_NOT_FOUND');
    }

    const detection = refreshCodexDetection();
    if (!detection.available) {
      throw toRunAgentError('CODEX_UNAVAILABLE', detection.reason);
    }

    const existingConversation = await getConversation(conversationId);
    const isNewConversation = !existingConversation;
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

    const { modelId: configuredModelId } =
      await resolveAgentRuntimeExecutionConfig({
        configPath: agent.configPath,
        entrypoint: 'agents.service',
      });
    modelId =
      configuredModelId ?? existingConversation?.model ?? 'gpt-5.1-codex-max';

    const title =
      params.instruction.trim().slice(0, 80) || 'Untitled conversation';

    if (isNewConversation) {
      await ensureAgentConversation({
        conversationId,
        agentName: params.agentName,
        modelId,
        title,
        source: params.source,
      });
    }

    // Validate working folder before we return 202 so the client receives a
    // deterministic 4xx rather than a background failure.
    await resolveWorkingFolderWorkingDirectory(params.working_folder);
  } catch (err) {
    cleanupPendingConversationCancel({ conversationId, runToken });
    releaseConversationLock(conversationId, runToken);
    throw err;
  }

  void (async () => {
    try {
      await runAgentInstructionUnlocked({
        ...params,
        conversationId,
        mustExist,
        inflightId,
        // Intentionally omit any request-bound signal; cancellation happens only
        // via explicit WS cancel_inflight.
        signal: undefined,
        runToken,
        cleanupInflightFn: params.cleanupInflightFn,
        releaseConversationLockFn: params.releaseConversationLockFn,
      });
    } catch (err) {
      baseLogger.error(
        { agentName: params.agentName, conversationId, inflightId, err },
        'agents run failed (background)',
      );
    }
  })();

  return { conversationId, inflightId, modelId };
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

  return await runAgentInstructionUnlocked({
    ...params,
    conversationId,
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
}): Promise<{
  initialModelId: string;
}> {
  const parsed = await loadAgentCommandFile({
    filePath: params.commandFilePath,
  }).catch(() => ({ ok: false }) as const);
  if (!parsed.ok) {
    return { initialModelId: FALLBACK_COMMAND_MODEL_ID };
  }

  const remainingItems = parsed.command.items.slice(params.startStep - 1);
  const needsSyntheticBootstrap = remainingItems.some(
    (item) => item.type === 'reingest',
  );

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

  let configuredModelId: string | undefined;
  try {
    const resolved = await resolveAgentRuntimeExecutionConfig({
      configPath: params.configPath,
      entrypoint: 'agents.service',
    });
    configuredModelId = resolved.modelId;
  } catch (error) {
    const code =
      error instanceof RuntimeConfigResolutionError
        ? error.code
        : 'UNKNOWN_ERROR';
    console.error(
      `${T06_ERROR_LOG} surface=agents.run source=${params.source} code=${code}`,
    );
    if (params.source === 'MCP') {
      console.error(
        `${T07_ERROR_LOG} surface=mcp.agents.run source=${params.source} code=${code}`,
      );
    }
    throw error;
  }
  const initialModelId =
    configuredModelId ??
    existingConversation?.model ??
    FALLBACK_COMMAND_MODEL_ID;

  if (!needsSyntheticBootstrap || existingConversation) {
    return { initialModelId };
  }

  const title = buildCommandConversationTitle({
    commandName: params.commandName,
    parsedCommand: parsed,
    startIndex: params.startStep - 1,
  });

  await ensureAgentConversation({
    conversationId: params.conversationId,
    agentName: params.agentName,
    modelId: initialModelId,
    title,
    source: params.source,
  });

  return { initialModelId };
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
  modelId: string;
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

  try {
    const detection = refreshCodexDetection();
    if (!detection.available) {
      throw toRunAgentError('CODEX_UNAVAILABLE', detection.reason);
    }

    // Validate command file before returning 202 so errors map cleanly to 4xx.
    let commandsDir = path.join(agent.home, 'commands');
    let commandFilePath = path.join(commandsDir, commandName + '.json');

    if (sourceId) {
      const ingestRoots = await agentServiceDeps
        .listIngestedRepositories()
        .then((result) => result.repos)
        .catch(() => null);
      const matchingRoot = ingestRoots?.find(
        (repo) => repo.containerPath === sourceId,
      );
      if (!matchingRoot) {
        throw toRunAgentError('COMMAND_NOT_FOUND');
      }
      logTransitiveContractRead({
        consumer: 'agents.service.startAgentCommand',
        sourceId,
        repo: matchingRoot,
      });

      commandsDir = path.join(
        matchingRoot.containerPath,
        'codex_agents',
        agent.name,
        'commands',
      );

      const resolved = path.resolve(commandsDir, `${commandName}.json`);
      const relativePath = path.relative(commandsDir, resolved);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw toRunAgentError('COMMAND_INVALID');
      }
      commandFilePath = resolved;
    }

    append({
      level: 'info',
      message: 'DEV-0000034:T2:command_run_resolved',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        agentName: params.agentName,
        commandName,
        sourceId: sourceId ?? 'local',
        commandPath: commandFilePath,
      },
    });

    const commandStat = await fs.stat(commandFilePath).catch((error) => {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw error;
    });
    if (!commandStat?.isFile()) {
      throw toRunAgentError('COMMAND_NOT_FOUND');
    }

    const parsed = await loadAgentCommandFile({ filePath: commandFilePath });
    if (!parsed.ok) {
      throw toRunAgentError('COMMAND_INVALID');
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

    const { modelId: configuredModelId } =
      await resolveAgentRuntimeExecutionConfig({
        configPath: agent.configPath,
        entrypoint: 'agents.service',
      });
    modelId =
      configuredModelId ?? existingConversation?.model ?? 'gpt-5.1-codex-max';

    const firstItem = parsed.command.items[0];
    const firstInstruction =
      firstItem?.type === 'message'
        ? 'content' in firstItem
          ? firstItem.content.join('\n')
          : ''
        : '';
    const title =
      firstInstruction.trim().slice(0, 80) || 'Command: ' + commandName;

    if (isNewConversation) {
      await ensureAgentConversation({
        conversationId,
        agentName: params.agentName,
        modelId,
        title,
        source: params.source,
      });
    }

    await resolveWorkingFolderWorkingDirectory(params.working_folder);

    backgroundScheduled = true;

    void (async () => {
      try {
        await runAgentCommandRunner({
          agentName: params.agentName,
          agentHome: agent.home,
          commandsRoot: commandsDir,
          commandFilePath,
          commandName,
          startStep,
          conversationId,
          sourceId,
          working_folder: params.working_folder,
          signal: undefined,
          source: params.source,
          initialModelId: modelId,
          onPrestartFailure: async (failure) => {
            await emitFailedAgentCommandStep({
              conversationId,
              inflightId: crypto.randomUUID(),
              instruction: failure.instruction,
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
      } catch (err) {
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
      modelId,
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
  modelId: string;
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

  let commandsRoot: string | undefined;
  let commandFilePath: string | undefined;

  if (sourceId) {
    const ingestRoots = await agentServiceDeps
      .listIngestedRepositories()
      .then((result) => result.repos)
      .catch(() => null);
    const matchingRoot = ingestRoots?.find(
      (repo) => repo.containerPath === sourceId,
    );
    if (!matchingRoot) {
      throw toRunAgentError('COMMAND_NOT_FOUND');
    }
    logTransitiveContractRead({
      consumer: 'agents.service.runAgentCommand',
      sourceId,
      repo: matchingRoot,
    });

    commandsRoot = path.join(
      matchingRoot.containerPath,
      'codex_agents',
      agent.name,
      'commands',
    );
    const resolved = path.resolve(commandsRoot, `${params.commandName}.json`);
    const relativePath = path.relative(commandsRoot, resolved);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw toRunAgentError('COMMAND_INVALID');
    }
    commandFilePath = resolved;
  }

  append({
    level: 'info',
    message: 'DEV-0000034:T2:command_run_resolved',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      agentName: params.agentName,
      commandName: params.commandName,
      sourceId: sourceId ?? 'local',
      commandPath:
        commandFilePath ??
        path.join(agent.home, 'commands', `${params.commandName}.json`),
    },
  });

  const resolvedCommandFilePath =
    commandFilePath ??
    path.join(agent.home, 'commands', `${params.commandName}.json`);
  const { initialModelId } = await prepareDirectCommandBootstrap({
    agentName: params.agentName,
    commandName: params.commandName.trim(),
    agentHome: agent.home,
    configPath: agent.configPath,
    conversationId,
    commandFilePath: resolvedCommandFilePath,
    startStep,
    source: params.source,
  });

  return await runAgentCommandRunner({
    agentName: params.agentName,
    agentHome: agent.home,
    commandsRoot,
    commandFilePath,
    commandName: params.commandName,
    startStep,
    conversationId,
    sourceId,
    working_folder: params.working_folder,
    signal: params.signal,
    source: params.source,
    initialModelId,
    runAgentInstructionUnlocked: (runParams) =>
      runAgentInstructionUnlocked({
        ...runParams,
        chatFactory: params.chatFactory,
      }),
  });
}

export async function runAgentInstructionUnlocked(params: {
  agentName: string;
  instruction: string;
  working_folder?: string;
  conversationId: string;
  mustExist?: boolean;
  command?: TurnCommandMetadata;
  signal?: AbortSignal;
  source: 'REST' | 'MCP';
  inflightId?: string;
  chatFactory?: typeof getChatInterface;
  runToken?: string;
  cleanupInflightFn?: InstructionRuntimeCleanupFn;
  releaseConversationLockFn?: InstructionReleaseLockFn;
}): Promise<RunAgentInstructionResult> {
  const fallbackModelId = 'gpt-5.1-codex-max';
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

  const detection = refreshCodexDetection();
  if (!detection.available) {
    throw toRunAgentError('CODEX_UNAVAILABLE', detection.reason);
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

    let runtimeConfig: CodexOptions['config'];
    let configuredModelId: string | undefined;
    try {
      const resolved = await resolveAgentRuntimeExecutionConfig({
        configPath: agent.configPath,
        entrypoint: 'agents.service',
      });
      runtimeConfig = resolved.runtimeConfig as CodexOptions['config'];
      configuredModelId = resolved.modelId;
      console.info(T06_SUCCESS_LOG, {
        surface: 'agents.run',
        source: params.source,
        isCommandRun: Boolean(params.command),
        hasModel: Boolean(configuredModelId),
      });
      if (params.source === 'MCP') {
        console.info(T07_SUCCESS_LOG, {
          surface: 'mcp.agents.run',
          source: params.source,
          isCommandRun: Boolean(params.command),
          hasModel: Boolean(configuredModelId),
        });
      }
    } catch (error) {
      const code =
        error instanceof RuntimeConfigResolutionError
          ? error.code
          : 'UNKNOWN_ERROR';
      console.error(
        `${T06_ERROR_LOG} surface=agents.run source=${params.source} code=${code}`,
      );
      if (params.source === 'MCP') {
        console.error(
          `${T07_ERROR_LOG} surface=mcp.agents.run source=${params.source} code=${code}`,
        );
      }
      throw error;
    }

    const modelId =
      configuredModelId ?? existingConversation?.model ?? fallbackModelId;
    const title =
      params.instruction.trim().slice(0, 80) || 'Untitled conversation';

    if (isNewConversation) {
      await ensureAgentConversation({
        conversationId,
        agentName: params.agentName,
        modelId,
        title,
        source: params.source,
      });
    }

    const conversation =
      existingConversation ?? (await getConversation(conversationId));
    if (!conversation) throw toRunAgentError('AGENT_NOT_FOUND');

    const threadId =
      conversation.flags &&
      typeof (conversation.flags as Record<string, unknown>).threadId ===
        'string'
        ? ((conversation.flags as Record<string, unknown>).threadId as string)
        : undefined;

    let systemPrompt: string | undefined;
    if (isNewConversation && agent.systemPromptPath) {
      try {
        systemPrompt = await fs.readFile(agent.systemPromptPath, 'utf8');
      } catch {
        systemPrompt = undefined;
      }
    }

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

    const workingDirectoryOverride = await resolveWorkingFolderWorkingDirectory(
      params.working_folder,
    );

    const inflightId = params.inflightId ?? crypto.randomUUID();
    activeInflightId = inflightId;
    const nowIso = new Date().toISOString();
    createInflight({
      conversationId,
      inflightId,
      provider: 'codex',
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
        provider: 'codex',
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
      provider: 'codex',
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
          provider: 'codex',
          model: modelId,
          source: params.source,
        },
      });

      consumePendingInstructionStop(inflightId);

      await chat.run(
        params.instruction,
        {
          provider: 'codex',
          inflightId,
          threadId,
          useConfigDefaults: true,
          runtimeConfig,
          ...(workingDirectoryOverride !== undefined
            ? { workingDirectoryOverride }
            : {}),
          disableSystemContext: true,
          systemPrompt,
          ...(managesInstructionLifecycle
            ? { deferInflightCleanup: true }
            : {}),
          signal: getInflight(conversationId)?.abortController.signal,
          source: params.source,
          ...(params.command ? { command: params.command } : {}),
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
      modelId,
      segments,
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
        const ingestedCommandsDir = path.join(
          sourceId,
          'codex_agents',
          agent.name,
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
