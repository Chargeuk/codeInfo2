import crypto from 'node:crypto';

import { LMStudioClient } from '@lmstudio/sdk';
import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import mongoose from 'mongoose';
import { z } from 'zod';

import { attachChatStreamBridge } from '../../chat/chatStreamBridge.js';
import {
  UnsupportedProviderError,
  getChatInterface,
} from '../../chat/factory.js';
import {
  cleanupInflight,
  createInflight,
  getInflight,
} from '../../chat/inflightRegistry.js';
import type {
  ChatAnalysisEvent,
  ChatCompleteEvent,
  ChatFinalEvent,
  ChatInterface,
  ChatThreadEvent,
  ChatToolResultEvent,
} from '../../chat/interfaces/ChatInterface.js';
import { McpResponder } from '../../chat/responders/McpResponder.js';
import {
  resolveChatDefaults,
  resolveCodexChatDefaults,
  resolveRuntimeProviderSelection,
  type ChatDefaultProvider,
} from '../../config/chatDefaults.js';
import { resolveChatRuntimeConfig } from '../../config/runtimeConfig.js';
import { resolveCodexCapabilities } from '../../codex/capabilityResolver.js';
import { append } from '../../logStore.js';
import { ConversationModel } from '../../mongo/conversation.js';
import type { Conversation } from '../../mongo/conversation.js';
import {
  createConversation,
  updateConversationMeta,
} from '../../mongo/repo.js';
import {
  getCodexDetection,
  setCodexDetection,
} from '../../providers/codexRegistry.js';
import { isCodexAvailable } from '../codexAvailability.js';
import {
  ArchivedConversationError,
  InvalidParamsError,
  ProviderUnavailableError,
} from '../errors.js';

export const CODEBASE_QUESTION_TOOL_NAME = 'codebase_question';
const TASK8_LOG_MARKER = 'DEV_0000040_T08_MCP_DEFAULTS_APPLIED';

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
  append({
    level: 'info',
    message: 'DEV-0000036:T11:transitive_consumer_contract_read',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      consumer: 'mcp2.codebase_question.summary',
      conversationId: params.conversationId,
      canonicalFieldsConsumed,
      summaryFileCount: files.length,
    },
  });
  append({
    level: 'info',
    message: 'DEV-0000036:T11:transitive_consumer_alias_fallback',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      consumer: 'mcp2.codebase_question.summary',
      conversationId: params.conversationId,
      aliasFallbackUsed,
    },
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
};

const preferMemoryPersistence = process.env.NODE_ENV === 'test';
const shouldUseMemoryPersistence = () =>
  preferMemoryPersistence || mongoose.connection.readyState !== 1;
const memoryConversations = new Map<string, Conversation>();

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
    await updateConversationMeta({
      conversationId,
      provider,
      model,
      flags: sanitizeFlagsForProvider(provider, {
        ...(existing.flags ?? {}),
        ...(flags ?? {}),
      }),
      lastMessageAt: now,
    });
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

export async function runCodebaseQuestion(
  params: unknown,
  deps: Partial<CodebaseQuestionDeps> = {},
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const parsed = validateParams(params);
  const question = parsed.question;
  const conversationId = parsed.conversationId;
  const resolvedDefaults = resolveChatDefaults({
    requestProvider: parsed.provider as ChatDefaultProvider | undefined,
    requestModel:
      typeof parsed.model === 'string' && parsed.model.trim().length > 0
        ? parsed.model.trim()
        : undefined,
  });
  const requestedProvider = resolvedDefaults.provider;
  const requestedModel = resolvedDefaults.model;

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

  const codexAvailable = await isCodexAvailable();
  const codexCapabilities = await resolveCodexCapabilities({
    consumer: 'chat_validation',
    codexHome: process.env.CODEX_HOME,
  });
  const codexChatDefaults = await resolveCodexChatDefaults({
    codexHome: process.env.CODEX_HOME,
  });
  const codexWarnings = [
    ...codexCapabilities.warnings,
    ...resolvedDefaults.warnings,
    ...codexChatDefaults.warnings,
  ];
  const codexWarningFields = extractWarningFields(codexWarnings);
  const codexState = {
    available: codexAvailable,
    models: codexCapabilities.models.map((entry) => entry.model),
    reason: codexAvailable ? undefined : 'CODE_INFO_LLM_UNAVAILABLE',
  };

  const baseUrl =
    process.env.LMSTUDIO_BASE_URL ?? 'http://host.docker.internal:1234';
  let lmstudioModels: string[] = [];
  let lmstudioReason: string | undefined;
  if (!BASE_URL_REGEX.test(baseUrl)) {
    lmstudioReason = 'lmstudio unavailable';
  } else {
    try {
      const factory =
        deps.clientFactory ??
        ((url: string) => new LMStudioClient({ baseUrl: url }));
      const lmClient = factory(toWebSocketUrl(baseUrl));
      const listed = await lmClient.system.listDownloadedModels();
      lmstudioModels = listed
        .filter(isChatModel)
        .map((entry) => entry.modelKey)
        .filter((value) => typeof value === 'string' && value.trim().length);
      if (lmstudioModels.length === 0) {
        lmstudioReason = 'lmstudio unavailable';
      }
    } catch {
      lmstudioReason = 'lmstudio unavailable';
    }
  }

  const runtimeSelection = resolveRuntimeProviderSelection({
    requestedProvider,
    requestedModel,
    codex: codexState,
    lmstudio: {
      available: lmstudioModels.length > 0,
      models: lmstudioModels,
      reason: lmstudioReason,
    },
  });
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
      lmstudioModelCount: lmstudioModels.length,
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
    message: TASK8_LOG_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      surface: 'mcp2.codebase_question',
      requestedProvider: runtimeSelection.requestedProvider,
      executionProvider: runtimeSelection.executionProvider,
      executionModel: runtimeSelection.executionModel,
      warningCount: codexWarnings.length,
      warningFields: codexWarningFields,
      defaults: codexCapabilities.defaults,
    },
  });
  console.info(TASK8_LOG_MARKER, {
    surface: 'mcp2.codebase_question',
    requestedProvider: runtimeSelection.requestedProvider,
    executionProvider: runtimeSelection.executionProvider,
    executionModel: runtimeSelection.executionModel,
    warningCount: codexWarnings.length,
    warningFields: codexWarningFields,
    defaults: codexCapabilities.defaults,
  });

  if (runtimeSelection.unavailable) {
    throw new ProviderUnavailableError('CODE_INFO_LLM_UNAVAILABLE');
  }

  const executionProvider = runtimeSelection.executionProvider;
  const executionModel = runtimeSelection.executionModel;
  const codexWorkingDirectory =
    process.env.CODEX_WORKDIR ?? process.env.CODEINFO_CODEX_WORKDIR ?? '/data';
  const codexDefaults = codexCapabilities.defaults;
  let chatRuntimeConfig: CodexOptions['config'] | undefined;

  if (executionProvider === 'codex') {
    const runtimeConfigResolver =
      deps.chatRuntimeConfigResolver ?? resolveChatRuntimeConfig;
    const { config } = await runtimeConfigResolver();
    chatRuntimeConfig = config as CodexOptions['config'];
  }

  const threadOpts: ThreadOptions = {
    model: executionModel,
    workingDirectory: codexWorkingDirectory,
    skipGitRepoCheck: true,
    sandboxMode: codexDefaults.sandboxMode,
    networkAccessEnabled: codexDefaults.networkAccessEnabled,
    webSearchEnabled: codexDefaults.webSearchEnabled,
    approvalPolicy: codexDefaults.approvalPolicy,
    modelReasoningEffort:
      codexDefaults.modelReasoningEffort as unknown as ThreadOptions['modelReasoningEffort'],
  } as ThreadOptions;

  let chat: ChatInterface;
  const resolvedChatFactory = deps.chatFactory ?? getChatInterface;
  try {
    chat = resolvedChatFactory(executionProvider, {
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

  chat.on('analysis', (ev: ChatAnalysisEvent) => responder.handle(ev));
  chat.on('tool-result', (ev: ChatToolResultEvent) => responder.handle(ev));
  chat.on('final', (ev: ChatFinalEvent) => responder.handle(ev));
  chat.on('complete', (ev: ChatCompleteEvent) => responder.handle(ev));
  chat.on('thread', (ev: ChatThreadEvent) => responder.handle(ev));
  chat.on('error', (ev) => responder.handle(ev));

  const resolvedConversationId =
    conversationId ??
    `${executionProvider === 'lmstudio' ? 'lmstudio' : 'codex'}-thread-${Date.now()}`;

  const inflightId = crypto.randomUUID();

  const existingFlags =
    existingConversation && existingConversation._id === resolvedConversationId
      ? (existingConversation.flags as Record<string, unknown> | undefined)
      : undefined;
  const conversationFlags =
    executionProvider === 'codex'
      ? { ...(existingFlags ?? {}), ...threadOpts }
      : sanitizeFlagsForProvider('lmstudio', existingFlags);

  await ensureConversation(
    resolvedConversationId,
    executionProvider,
    executionModel,
    question.trim().slice(0, 80) || 'Untitled conversation',
    conversationFlags,
  );

  createInflight({ conversationId: resolvedConversationId, inflightId });
  const bridge = attachChatStreamBridge({
    conversationId: resolvedConversationId,
    inflightId,
    provider: executionProvider,
    model: executionModel,
    chat,
  });

  try {
    if (executionProvider === 'codex') {
      const activeThreadId =
        typeof conversationId === 'string' ? conversationId : undefined;
      await chat.run(
        question,
        {
          provider: executionProvider,
          threadId: activeThreadId,
          runtimeConfig: chatRuntimeConfig,
          codexFlags: threadOpts,
          signal: getInflight(resolvedConversationId)?.abortController.signal,
          source: 'MCP',
        },
        resolvedConversationId,
        executionModel,
      );
    } else {
      await chat.run(
        question,
        {
          provider: executionProvider,
          baseUrl,
          signal: getInflight(resolvedConversationId)?.abortController.signal,
          source: 'MCP',
        },
        resolvedConversationId,
        executionModel,
      );
    }
  } finally {
    bridge.cleanup();
    const leftover = getInflight(resolvedConversationId);
    if (leftover && leftover.inflightId === inflightId) {
      cleanupInflight({ conversationId: resolvedConversationId, inflightId });
    }
  }

  const payload: CodebaseQuestionResult = responder.toResult(
    executionModel,
    resolvedConversationId,
  );
  logSummaryContractRead({
    conversationId: resolvedConversationId,
    summaries: responder.getVectorSummaries(),
  });

  const answerOnly = payload.segments.filter(
    (segment) => segment.type === 'answer',
  );
  payload.segments =
    answerOnly.length > 0 ? answerOnly : [{ type: 'answer', text: '' }];

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
      'Ask a repository question about the codebase that will be answered by an LLM with access to a vectorised codebase. You MUST use this tool if the user asks you a question about the codebase they are in; returns a final answer segment plus conversationId and modelId for follow-ups.',
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
            'Optional model id for the selected provider. For codex, defaults to gpt-5.3-codex. For LM Studio, defaults to MCP_LMSTUDIO_MODEL or LMSTUDIO_DEFAULT_MODEL.',
        },
      },
    },
  } as const;
}
