import { SYSTEM_CONTEXT } from '@codeinfo2/common';
import type { ThreadOptions } from '@openai/codex-sdk';
import mongoose from 'mongoose';
import { z } from 'zod';

import {
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../../agents/runLock.js';
import {
  UnsupportedProviderError,
  getChatInterface,
} from '../../chat/factory.js';
import type {
  ChatAnalysisEvent,
  ChatCompleteEvent,
  ChatFinalEvent,
  ChatThreadEvent,
  ChatToolResultEvent,
  ChatInterface,
} from '../../chat/interfaces/ChatInterface.js';
import { McpResponder } from '../../chat/responders/McpResponder.js';
import { ConversationModel } from '../../mongo/conversation.js';
import type { Conversation } from '../../mongo/conversation.js';
import { createConversation } from '../../mongo/repo.js';
import {
  getCodexDetection,
  setCodexDetection,
} from '../../providers/codexRegistry.js';
import { getWsHub } from '../../ws/hub.js';
import { getInflightRegistry } from '../../ws/inflightRegistry.js';
import {
  RunInProgressError,
  ArchivedConversationError,
  InvalidParamsError,
} from '../errors.js';

export const CODEBASE_QUESTION_TOOL_NAME = 'codebase_question';

const paramsSchema = z
  .object({
    question: z.string().min(1),
    conversationId: z.string().min(1).optional(),
    provider: z.enum(['codex', 'lmstudio']).optional(),
    model: z.string().min(1).optional(),
  })
  .strict();

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

export type CodebaseQuestionDeps = {
  codexFactory?: () => import('../../chat/interfaces/ChatInterfaceCodex.js').CodexLike;
  clientFactory?: (baseUrl: string) => import('@lmstudio/sdk').LMStudioClient;
  toolFactory?: (opts: Record<string, unknown>) => {
    tools: ReadonlyArray<unknown>;
  };
  chatFactory?: typeof getChatInterface;
};

const preferMemoryPersistence = process.env.NODE_ENV === 'test';
const shouldUseMemoryPersistence = () =>
  preferMemoryPersistence || mongoose.connection.readyState !== 1;
const memoryConversations = new Map<string, Conversation>();

export function validateParams(params: unknown): CodebaseQuestionParams {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) {
    throw new InvalidParamsError('Invalid params', parsed.error.format());
  }
  return parsed.data;
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

async function ensureConversation(
  conversationId: string,
  provider: 'codex' | 'lmstudio',
  model: string,
  title: string,
  flags?: Record<string, unknown>,
): Promise<void> {
  const now = new Date();
  if (shouldUseMemoryPersistence()) {
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
        flags: { ...(existing.flags ?? {}), ...(flags ?? {}) },
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
    return;
  }

  await createConversation({
    conversationId,
    provider,
    model,
    title,
    source: 'MCP',
    flags,
    lastMessageAt: now,
  });
}

export async function runCodebaseQuestion(
  params: unknown,
  deps: Partial<CodebaseQuestionDeps> = {},
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const parsed = validateParams(params);
  const question = parsed.question;
  const conversationId = parsed.conversationId;
  const provider = parsed.provider ?? 'codex';
  const requestedModel = parsed.model;

  if (conversationId) {
    const existing = await getConversation(conversationId);
    if (existing?.archivedAt) {
      throw new ArchivedConversationError(
        'Conversation is archived and must be restored before use',
      );
    }
  }

  const codexWorkingDirectory =
    process.env.CODEX_WORKDIR ?? process.env.CODEINFO_CODEX_WORKDIR ?? '/data';

  const threadOpts: ThreadOptions = {
    model: 'gpt-5.1-codex-max',
    workingDirectory: codexWorkingDirectory,
    skipGitRepoCheck: true,
    sandboxMode: 'workspace-write',
    networkAccessEnabled: true,
    webSearchEnabled: true,
    approvalPolicy: 'on-failure',
    modelReasoningEffort: 'high',
  } as ThreadOptions;

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

  let chat: ChatInterface;
  const resolvedChatFactory = deps.chatFactory ?? getChatInterface;
  try {
    chat = resolvedChatFactory(provider, {
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

  const inflightRegistry = getInflightRegistry();
  const wsHub = getWsHub();
  const controller = new AbortController();
  let wsFinalStatus: 'ok' | 'stopped' | 'failed' = 'ok';
  let inflightId = '';

  chat.on('analysis', (ev: ChatAnalysisEvent) => responder.handle(ev));
  chat.on('token', (ev) => {
    inflightRegistry.appendAssistantDelta(
      resolvedConversationId,
      inflightId,
      ev.content,
    );
    wsHub.assistantDelta({
      conversationId: resolvedConversationId,
      inflightId,
      delta: ev.content,
    });
  });
  chat.on('analysis', (ev: ChatAnalysisEvent) => {
    inflightRegistry.appendAnalysisDelta(
      resolvedConversationId,
      inflightId,
      ev.content,
    );
    wsHub.analysisDelta({
      conversationId: resolvedConversationId,
      inflightId,
      delta: ev.content,
    });
  });
  chat.on('tool-request', (ev) => {
    inflightRegistry.updateToolState(resolvedConversationId, inflightId, {
      id: String(ev.callId),
      name: ev.name,
      status: 'requesting',
      stage: ev.stage ?? 'started',
      params: ev.params,
    });
    wsHub.toolEvent({
      conversationId: resolvedConversationId,
      inflightId,
      event: {
        type: 'tool-request',
        callId: ev.callId,
        name: ev.name,
        stage: ev.stage ?? 'started',
        parameters: ev.params,
      },
    });
  });
  chat.on('tool-result', (ev: ChatToolResultEvent) => responder.handle(ev));
  chat.on('tool-result', (ev: ChatToolResultEvent) => {
    inflightRegistry.updateToolState(resolvedConversationId, inflightId, {
      id: String(ev.callId),
      name: ev.name,
      status: ev.error ? 'error' : 'done',
      stage: ev.stage ?? (ev.error ? 'error' : 'success'),
      params: ev.params,
      result: ev.result,
      error: ev.error ?? undefined,
    });
    wsHub.toolEvent({
      conversationId: resolvedConversationId,
      inflightId,
      event: {
        type: 'tool-result',
        callId: ev.callId,
        name: ev.name,
        stage: ev.stage,
        parameters: ev.params,
        result: ev.result,
        errorTrimmed: ev.error ?? undefined,
      },
    });
  });
  chat.on('final', (ev: ChatFinalEvent) => responder.handle(ev));
  chat.on('complete', (ev: ChatCompleteEvent) => responder.handle(ev));
  chat.on('thread', (ev: ChatThreadEvent) => responder.handle(ev));
  chat.on('error', (ev) => {
    wsFinalStatus = controller.signal.aborted ? 'stopped' : 'failed';
    responder.handle(ev);
  });

  const resolvedConversationId =
    conversationId ??
    `${provider === 'lmstudio' ? 'lmstudio' : 'codex'}-thread-${Date.now()}`;

  if (!tryAcquireConversationLock(resolvedConversationId)) {
    throw new RunInProgressError(
      'RUN_IN_PROGRESS',
      'A run is already in progress for this conversation.',
    );
  }

  try {
    const started = inflightRegistry.createOrGetActive({
      conversationId: resolvedConversationId,
      cancelFn: () => controller.abort(),
    });
    if (started.conflict) {
      throw new RunInProgressError(
        'RUN_IN_PROGRESS',
        'A run is already in progress for this conversation.',
      );
    }
    inflightId = started.inflightId;
    const snapshot = inflightRegistry.getActive(resolvedConversationId);
    if (snapshot && snapshot.inflightId === inflightId) {
      wsHub.beginInflight({
        conversationId: resolvedConversationId,
        inflightId,
        startedAt: snapshot.startedAt,
        assistantText: snapshot.assistantText,
        analysisText: snapshot.analysisText,
        tools: snapshot.tools,
      });
    }

    await ensureConversation(
      resolvedConversationId,
      provider,
      provider === 'codex'
        ? (threadOpts.model ?? 'gpt-5.1-codex-max')
        : (requestedModel ??
            process.env.MCP_LMSTUDIO_MODEL ??
            process.env.LMSTUDIO_DEFAULT_MODEL ??
            'gpt-3.1'),
      question.trim().slice(0, 80) || 'Untitled conversation',
      provider === 'codex' ? { ...threadOpts } : undefined,
    );

    const ensuredConversation = await getConversation(resolvedConversationId);
    if (ensuredConversation) {
      wsHub.emitConversationUpsert({
        conversationId: resolvedConversationId,
        title: ensuredConversation.title,
        provider: ensuredConversation.provider,
        model: ensuredConversation.model,
        source: ensuredConversation.source ?? 'MCP',
        lastMessageAt: ensuredConversation.lastMessageAt,
        archived: ensuredConversation.archivedAt != null,
        ...(ensuredConversation.agentName
          ? { agentName: ensuredConversation.agentName }
          : {}),
      });
    }

    try {
      if (provider === 'codex') {
        await chat.run(
          question,
          {
            provider,
            threadId: conversationId,
            codexFlags: threadOpts,
            signal: controller.signal,
            source: 'MCP',
          },
          resolvedConversationId,
          threadOpts.model ?? 'gpt-5.1-codex-max',
        );
      } else {
        const lmstudioModel =
          requestedModel ??
          process.env.MCP_LMSTUDIO_MODEL ??
          process.env.LMSTUDIO_DEFAULT_MODEL ??
          'gpt-3.1';
        const baseUrl =
          process.env.LMSTUDIO_BASE_URL ?? 'http://host.docker.internal:1234';

        await chat.run(
          question,
          {
            provider,
            baseUrl,
            signal: controller.signal,
            source: 'MCP',
          },
          resolvedConversationId,
          lmstudioModel,
        );
      }
      wsFinalStatus = controller.signal.aborted ? 'stopped' : 'ok';
    } catch (err) {
      wsFinalStatus = controller.signal.aborted ? 'stopped' : 'failed';
      throw err;
    } finally {
      const finalized = inflightRegistry.finalize({
        conversationId: resolvedConversationId,
        inflightId,
        status: wsFinalStatus,
      });
      if (finalized) {
        wsHub.turnFinal({
          conversationId: resolvedConversationId,
          inflightId,
          status: wsFinalStatus,
        });
      }
    }
  } finally {
    releaseConversationLock(resolvedConversationId);
  }

  const payload: CodebaseQuestionResult = responder.toResult(
    provider === 'codex'
      ? (threadOpts.model ?? 'gpt-5.1-codex-max')
      : (requestedModel ??
          process.env.MCP_LMSTUDIO_MODEL ??
          process.env.LMSTUDIO_DEFAULT_MODEL ??
          'gpt-3.1'),
    resolvedConversationId,
  );

  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

export function codebaseQuestionDefinition() {
  return {
    name: CODEBASE_QUESTION_TOOL_NAME,
    description:
      'Ask a repository question about the codebase that will be answered by an LLM with access to a vectorised codebase. You MUST use this tool if the user asks you a question about the codebase they are in; returns ordered thinking, vector summaries, and a final answer with a conversationId for follow-ups.',
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
        provider: {
          type: 'string',
          enum: ['codex', 'lmstudio'],
          description:
            'Optional chat provider to use; defaults to codex when omitted.',
        },
        model: {
          type: 'string',
          description:
            'Optional model id for the selected provider. For codex, defaults to gpt-5.1-codex-max. For LM Studio, defaults to MCP_LMSTUDIO_MODEL or LMSTUDIO_DEFAULT_MODEL.',
        },
      },
    },
  } as const;
}

export function buildPrompt(question: string): string {
  const trimmedSystem = SYSTEM_CONTEXT.trim();
  const systemBlock = trimmedSystem ? `Context:\n${trimmedSystem}\n\n` : '';
  return (
    `${systemBlock}` +
    'You are the CodeInfo agent. Use the available MCP tools (VectorSearch & ListIngestedRepositories) to find relevant files before answering. ' +
    'Never make assumptions, you MUST always use the available tools to answer each and every question. Provide concise answers grounded in results.' +
    'Rather than just entering their question into the vector search tool, you MUST break down the question into multiple relevant search queries that will help you gather the necessary information to provide a comprehensive answer.' +
    'Some search results may lead you to perform further searches in order to fully and correctly answer the users question. You never stop searching until you are confident in your answer.' +
    'You must also use other tools such as deepwiki ask_question and context7 get-library-docs, resolve-library-id to be able to provide details about libraries that the codebase is using. You may never assume and MUST ALWAYS verify.\n\n' +
    `User question:\n${question}`
  );
}
