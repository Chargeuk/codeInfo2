import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { attachChatStreamBridge } from '../chat/chatStreamBridge.js';
import { UnsupportedProviderError, getChatInterface } from '../chat/factory.js';
import {
  createInflight,
  cleanupInflight,
  getInflight,
} from '../chat/inflightRegistry.js';
import type {
  ChatAnalysisEvent,
  ChatFinalEvent,
  ChatToolResultEvent,
} from '../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  shouldUseMemoryPersistence,
} from '../chat/memoryPersistence.js';
import { McpResponder } from '../chat/responders/McpResponder.js';
import { mapHostWorkingFolderToWorkdir } from '../ingest/pathMap.js';
import { baseLogger } from '../logger.js';
import { ConversationModel } from '../mongo/conversation.js';
import type { Conversation } from '../mongo/conversation.js';
import { createConversation } from '../mongo/repo.js';
import type { TurnCommandMetadata } from '../mongo/turn.js';
import { detectCodexForHome } from '../providers/codexDetection.js';

import { loadAgentCommandSummary } from './commandsLoader.js';
import { runAgentCommandRunner } from './commandsRunner.js';
import { readAgentModelId } from './config.js';
import { discoverAgents } from './discovery.js';
import {
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

type RunAgentErrorCode =
  | 'AGENT_NOT_FOUND'
  | 'CONVERSATION_ARCHIVED'
  | 'AGENT_MISMATCH'
  | 'RUN_IN_PROGRESS'
  | 'COMMAND_NOT_FOUND'
  | 'COMMAND_INVALID'
  | 'CODEX_UNAVAILABLE'
  | 'WORKING_FOLDER_INVALID'
  | 'WORKING_FOLDER_NOT_FOUND';

type RunAgentError = {
  code: RunAgentErrorCode;
  reason?: string;
};

const toRunAgentError = (code: RunAgentErrorCode, reason?: string) =>
  ({ code, reason }) satisfies RunAgentError;

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

export async function runAgentInstruction(
  params: RunAgentInstructionParams,
): Promise<RunAgentInstructionResult> {
  const conversationId = params.conversationId ?? crypto.randomUUID();
  if (!tryAcquireConversationLock(conversationId)) {
    throw toRunAgentError(
      'RUN_IN_PROGRESS',
      'A run is already in progress for this conversation.',
    );
  }

  try {
    return await runAgentInstructionUnlocked({
      ...params,
      conversationId,
      mustExist: Boolean(params.conversationId),
    });
  } finally {
    releaseConversationLock(conversationId);
  }
}

export async function runAgentCommand(params: {
  agentName: string;
  commandName: string;
  conversationId?: string;
  working_folder?: string;
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

  return await runAgentCommandRunner({
    agentName: params.agentName,
    agentHome: agent.home,
    commandName: params.commandName,
    conversationId: params.conversationId,
    working_folder: params.working_folder,
    signal: params.signal,
    source: params.source,
    runAgentInstructionUnlocked,
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
}): Promise<RunAgentInstructionResult> {
  const fallbackModelId = 'gpt-5.1-codex-max';

  const discovered = await discoverAgents();
  const agent = discovered.find((item) => item.name === params.agentName);
  if (!agent) {
    throw toRunAgentError('AGENT_NOT_FOUND');
  }

  const detection = detectCodexForHome(agent.home);
  if (!detection.available) {
    throw toRunAgentError('CODEX_UNAVAILABLE', detection.reason);
  }

  const conversationId = params.conversationId;

  const existingConversation = await getConversation(conversationId);
  const isNewConversation = !existingConversation;
  if (params.mustExist && isNewConversation)
    throw toRunAgentError('AGENT_NOT_FOUND');
  if (existingConversation?.archivedAt)
    throw toRunAgentError('CONVERSATION_ARCHIVED');
  if (
    existingConversation &&
    (existingConversation.agentName ?? '') !== params.agentName
  ) {
    throw toRunAgentError('AGENT_MISMATCH');
  }

  const configuredModelId = await readAgentModelId(agent.configPath);
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
    conversation?.flags &&
    typeof (conversation.flags as Record<string, unknown>).threadId === 'string'
      ? ((conversation.flags as Record<string, unknown>).threadId as string)
      : undefined;

  let systemPrompt: string | undefined;
  if (isNewConversation && agent.systemPromptPath) {
    try {
      systemPrompt = await fs.readFile(agent.systemPromptPath, 'utf8');
    } catch {
      // best-effort: missing/unreadable prompt should not block execution
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
  createInflight({ conversationId, inflightId, externalSignal: params.signal });

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

  try {
    await chat.run(
      params.instruction,
      {
        provider: 'codex',
        threadId,
        useConfigDefaults: true,
        codexHome: agent.home,
        ...(workingDirectoryOverride !== undefined
          ? { workingDirectoryOverride }
          : {}),
        disableSystemContext: true,
        systemPrompt,
        signal: getInflight(conversationId)?.abortController.signal,
        source: params.source,
        ...(params.command ? { command: params.command } : {}),
      },
      conversationId,
      modelId,
    );
  } finally {
    bridge.cleanup();
    const leftover = getInflight(conversationId);
    if (leftover && leftover.inflightId === inflightId) {
      cleanupInflight({ conversationId, inflightId });
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
}

export async function listAgentCommands(params: {
  agentName: string;
}): Promise<{
  commands: Array<{ name: string; description: string; disabled: boolean }>;
}> {
  const discovered = await discoverAgents();
  const agent = discovered.find((item) => item.name === params.agentName);
  if (!agent) throw toRunAgentError('AGENT_NOT_FOUND');

  const commandsDir = path.join(agent.home, 'commands');
  const dirents = await fs
    .readdir(commandsDir, { withFileTypes: true })
    .catch((error) => {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw error;
    });

  if (!dirents) return { commands: [] };

  const jsonEntries = dirents.filter(
    (dirent) =>
      dirent.isFile() &&
      dirent.name.toLowerCase().endsWith('.json') &&
      dirent.name.length > '.json'.length,
  );

  const commands = await Promise.all(
    jsonEntries.map(async (dirent) => {
      const name = path.basename(dirent.name, path.extname(dirent.name));
      const filePath = path.join(commandsDir, dirent.name);
      return loadAgentCommandSummary({ filePath, name });
    }),
  );

  commands.sort((a, b) => a.name.localeCompare(b.name));

  return { commands };
}
