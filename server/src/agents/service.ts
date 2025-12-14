import crypto from 'node:crypto';
import fs from 'node:fs/promises';

import { UnsupportedProviderError, getChatInterface } from '../chat/factory.js';
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
import { ConversationModel } from '../mongo/conversation.js';
import type { Conversation } from '../mongo/conversation.js';
import { createConversation } from '../mongo/repo.js';
import { detectCodexForHome } from '../providers/codexDetection.js';

import { readAgentModelId } from './config.js';
import { discoverAgents } from './discovery.js';
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
  conversationId?: string;
  signal?: AbortSignal;
  source: 'REST' | 'MCP';
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
  | 'CODEX_UNAVAILABLE';

type RunAgentError = {
  code: RunAgentErrorCode;
  reason?: string;
};

const toRunAgentError = (code: RunAgentErrorCode, reason?: string) =>
  ({ code, reason }) satisfies RunAgentError;

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

  const conversationId = params.conversationId ?? crypto.randomUUID();
  const isNewConversation = !params.conversationId;

  let existingConversation: Conversation | null = null;
  if (!isNewConversation) {
    existingConversation = await getConversation(conversationId);
    if (!existingConversation) throw toRunAgentError('AGENT_NOT_FOUND');
    if (existingConversation.archivedAt)
      throw toRunAgentError('CONVERSATION_ARCHIVED');
    if ((existingConversation.agentName ?? '') !== params.agentName) {
      throw toRunAgentError('AGENT_MISMATCH');
    }
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

  let chat;
  try {
    chat = getChatInterface('codex');
  } catch (err) {
    if (err instanceof UnsupportedProviderError) {
      throw new Error(err.message);
    }
    throw err;
  }

  const responder = new McpResponder();
  chat.on('analysis', (ev: ChatAnalysisEvent) => responder.handle(ev));
  chat.on('tool-result', (ev: ChatToolResultEvent) => responder.handle(ev));
  chat.on('final', (ev: ChatFinalEvent) => responder.handle(ev));
  chat.on('error', (ev) => responder.handle(ev));

  await chat.run(
    params.instruction,
    {
      provider: 'codex',
      threadId,
      useConfigDefaults: true,
      codexHome: agent.home,
      disableSystemContext: true,
      systemPrompt,
      signal: params.signal,
      source: params.source,
    },
    conversationId,
    modelId,
  );

  const { segments } = responder.toResult(modelId, conversationId);
  return {
    agentName: params.agentName,
    conversationId,
    modelId,
    segments,
  };
}
