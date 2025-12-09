import { SYSTEM_CONTEXT } from '@codeinfo2/common';
import type { ThreadEvent, ThreadOptions } from '@openai/codex-sdk';
import { Codex } from '@openai/codex-sdk';
import mongoose from 'mongoose';
import { z } from 'zod';

import { buildCodexOptions } from '../../config/codexConfig.js';
import { baseLogger } from '../../logger.js';
import { ConversationModel } from '../../mongo/conversation.js';
import type { Conversation } from '../../mongo/conversation.js';
import {
  appendTurn,
  createConversation,
  updateConversationMeta,
} from '../../mongo/repo.js';
import type { Turn, TurnStatus } from '../../mongo/turn.js';
import { ArchivedConversationError, InvalidParamsError } from '../errors.js';

export const CODEBASE_QUESTION_TOOL_NAME = 'codebase_question';

const paramsSchema = z
  .object({
    question: z.string().min(1),
    conversationId: z.string().min(1).optional(),
  })
  .strict();

export type CodebaseQuestionParams = z.infer<typeof paramsSchema>;

export type CodexThreadFactory = ReturnType<typeof createDefaultCodexFactory>;

export type CodexThread = {
  id: string | null;
  runStreamed: (
    input: string,
    opts?: ThreadOptions,
  ) => Promise<{ events: AsyncGenerator<unknown> }>;
};

export type CodexClient = {
  startThread: (opts?: ThreadOptions) => CodexThread;
  resumeThread: (id: string, opts?: ThreadOptions) => CodexThread;
};

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
  codexFactory: () => CodexClient;
};

const preferMemoryPersistence = process.env.NODE_ENV === 'test';
const shouldUseMemoryPersistence = () =>
  preferMemoryPersistence || mongoose.connection.readyState !== 1;
const memoryConversations = new Map<string, Conversation>();
const memoryTurns = new Map<string, Turn[]>();

export function createDefaultCodexFactory() {
  return new Codex(buildCodexOptions()) as unknown as CodexClient;
}

export function validateParams(params: unknown): CodebaseQuestionParams {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) {
    throw new InvalidParamsError('Invalid params', parsed.error.format());
  }
  return parsed.data;
}

function normalizeTitle(question: string): string {
  const trimmed = question.trim();
  return trimmed.slice(0, 80) || 'Untitled conversation';
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

type UpsertConversationInput = {
  conversationId: string;
  provider: Conversation['provider'];
  model: string;
  title: string;
  flags: Record<string, unknown>;
  lastMessageAt: Date;
};

async function upsertConversation(input: UpsertConversationInput) {
  const existing = await getConversation(input.conversationId);

  if (existing?.archivedAt) {
    throw new ArchivedConversationError(
      'Conversation is archived and must be restored before use',
    );
  }

  if (shouldUseMemoryPersistence()) {
    const mergedFlags = {
      ...(existing?.flags ?? {}),
      ...input.flags,
    } as Record<string, unknown>;
    const conversation: Conversation = existing
      ? {
          ...existing,
          model: input.model,
          title: existing.title || input.title,
          flags: mergedFlags,
          lastMessageAt: input.lastMessageAt,
          updatedAt: input.lastMessageAt,
        }
      : {
          _id: input.conversationId,
          provider: input.provider,
          model: input.model,
          title: input.title,
          flags: mergedFlags,
          lastMessageAt: input.lastMessageAt,
          archivedAt: null,
          createdAt: input.lastMessageAt,
          updatedAt: input.lastMessageAt,
        };
    memoryConversations.set(input.conversationId, conversation);
    return conversation;
  }

  if (!existing) {
    return createConversation({
      conversationId: input.conversationId,
      provider: input.provider,
      model: input.model,
      title: input.title,
      flags: input.flags,
      lastMessageAt: input.lastMessageAt,
    });
  }

  const mergedFlags = { ...(existing.flags ?? {}), ...input.flags } as Record<
    string,
    unknown
  >;

  return updateConversationMeta({
    conversationId: input.conversationId,
    model: input.model,
    flags: mergedFlags,
    lastMessageAt: input.lastMessageAt,
  });
}

async function recordTurn(
  turn: Omit<Turn, 'createdAt'> & { createdAt?: Date },
) {
  const createdAt = turn.createdAt ?? new Date();
  if (shouldUseMemoryPersistence()) {
    const turns = memoryTurns.get(turn.conversationId) ?? [];
    turns.push({ ...turn, createdAt } as Turn);
    memoryTurns.set(turn.conversationId, turns);
    const existing = memoryConversations.get(turn.conversationId);
    if (existing) {
      memoryConversations.set(turn.conversationId, {
        ...existing,
        lastMessageAt: createdAt,
        updatedAt: createdAt,
      });
    }
    return;
  }

  await appendTurn({
    conversationId: turn.conversationId,
    role: turn.role,
    content: turn.content,
    model: turn.model,
    provider: turn.provider,
    toolCalls: turn.toolCalls,
    status: turn.status as TurnStatus,
    createdAt,
  });
}

export async function runCodebaseQuestion(
  params: unknown,
  deps: Partial<CodebaseQuestionDeps> = {},
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const { question, conversationId } = validateParams(params);
  const codex = (deps.codexFactory ?? createDefaultCodexFactory)();
  const now = new Date();

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

  const thread = conversationId
    ? codex.resumeThread(conversationId, threadOpts)
    : codex.startThread(threadOpts);

  let activeThreadId = thread.id ?? conversationId ?? null;
  const segments: Segment[] = [];
  const vectorSummaries: Extract<Segment, { type: 'vector_summary' }>[] = [];
  const toolCallsForTurn: Array<Record<string, unknown>> = [];
  let reasoningText = '';
  let answerText = '';

  const prompt = buildPrompt(question);
  const { events } = await thread.runStreamed(prompt, {});

  const addReasoning = (text: string | undefined) => {
    if (!text) return;
    const delta = text.slice(reasoningText.length);
    if (!delta) return;
    reasoningText = text;
    segments.push({ type: 'thinking', text: delta });
  };

  for await (const event of events as AsyncGenerator<ThreadEvent>) {
    switch (event.type) {
      case 'thread.started':
        if (event.thread_id) activeThreadId = event.thread_id;
        break;
      case 'item.updated':
      case 'item.completed': {
        const item = (event as { item?: unknown }).item as
          | { type?: string; text?: string; result?: unknown }
          | undefined;
        if (!item) break;

        if (item.type === 'reasoning') {
          addReasoning(item.text);
          break;
        }

        if (item.type === 'mcp_tool_call' && event.type === 'item.completed') {
          const parsed = parseCodexToolResult(item);
          const name = (item as { name?: string }).name ?? 'VectorSearch';
          toolCallsForTurn.push({
            type: 'mcp_tool_call',
            name,
            result: parsed,
          });
          const summary = buildVectorSummary(parsed);
          if (summary) segments.push(summary);
          if (summary?.type === 'vector_summary') {
            vectorSummaries.push(summary);
          }
          break;
        }

        if (item.type === 'agent_message' && event.type === 'item.completed') {
          const text = item.text ?? '';
          if (text) {
            answerText = text;
            segments.push({ type: 'answer', text });
          }
        }
        break;
      }
      case 'turn.completed': {
        const turn = event as { thread_id?: string; threadId?: string };
        const nextId = turn.thread_id ?? turn.threadId;
        if (nextId) activeThreadId = nextId;
        break;
      }
      default:
        break;
    }
  }

  if (!segments.some((s) => s.type === 'answer')) {
    segments.push({ type: 'answer', text: answerText });
  }

  const payload: CodebaseQuestionResult = {
    conversationId: activeThreadId,
    modelId: threadOpts.model ?? 'gpt-5.1-codex-max',
    segments,
  };

  const resolvedConversationId =
    activeThreadId ?? conversationId ?? `codex-thread-${Date.now()}`;
  payload.conversationId = resolvedConversationId;
  const flags = {
    sandboxMode: threadOpts.sandboxMode,
    approvalPolicy: threadOpts.approvalPolicy,
    networkAccessEnabled: threadOpts.networkAccessEnabled,
    webSearchEnabled: threadOpts.webSearchEnabled,
    modelReasoningEffort: threadOpts.modelReasoningEffort,
    workingDirectory: codexWorkingDirectory,
  } as Record<string, unknown>;

  try {
    await upsertConversation({
      conversationId: resolvedConversationId,
      provider: 'codex',
      model: payload.modelId,
      title: normalizeTitle(question),
      flags,
      lastMessageAt: now,
    });
  } catch (err) {
    if (err instanceof ArchivedConversationError) throw err;
    baseLogger.error({ err }, 'failed to upsert MCP conversation');
  }

  try {
    await recordTurn({
      conversationId: resolvedConversationId,
      role: 'user',
      content: question,
      model: payload.modelId,
      provider: 'codex',
      toolCalls: null,
      status: 'ok',
      createdAt: now,
    });
  } catch (err) {
    baseLogger.error({ err }, 'failed to record MCP user turn');
  }

  const thinkingSegments = segments.filter(
    (s): s is Extract<Segment, { type: 'thinking' }> => s.type === 'thinking',
  );
  const assistantToolCalls =
    toolCallsForTurn.length || thinkingSegments.length || vectorSummaries.length
      ? {
          calls: toolCallsForTurn,
          thinking: thinkingSegments,
          vectorSummaries,
        }
      : null;

  // Stored turn example:
  // { "conversationId":"thread-1","role":"assistant","content":"Answer","provider":"codex","model":"gpt-5.1-codex-max","toolCalls":{"calls":[...]},"status":"ok","createdAt":"2025-12-09T12:00:00.000Z" }
  try {
    await recordTurn({
      conversationId: resolvedConversationId,
      role: 'assistant',
      content: answerText,
      model: payload.modelId,
      provider: 'codex',
      toolCalls: assistantToolCalls,
      status: 'ok',
    });
  } catch (err) {
    baseLogger.error({ err }, 'failed to record MCP assistant turn');
  }

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

function parseCodexToolResult(item: { result?: unknown; content?: unknown }) {
  const content = (item.result as { content?: unknown } | undefined)?.content;
  const picked = pickContent(content);
  if (picked !== null) return picked;
  return item.result ?? null;
}

function pickContent(content?: unknown): unknown | null {
  if (!Array.isArray(content)) return null;

  const jsonEntry = content.find(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      (entry as { type?: string }).type === 'application/json' &&
      'json' in (entry as Record<string, unknown>),
  ) as { json?: unknown } | undefined;

  if (jsonEntry && 'json' in jsonEntry) {
    return jsonEntry.json as unknown;
  }

  const textEntry = content.find(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      (entry as { type?: string }).type === 'text' &&
      typeof (entry as { text?: unknown }).text === 'string',
  ) as { text?: string } | undefined;

  if (textEntry?.text) {
    try {
      return JSON.parse(textEntry.text);
    } catch {
      return textEntry.text;
    }
  }

  return null;
}

function buildVectorSummary(payload: unknown): Segment | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const results = Array.isArray(obj.results) ? obj.results : [];
  const files = Array.isArray(obj.files) ? obj.files : [];
  if (!results.length && !files.length) return null;

  const relByHost = new Map<string, string>();
  const summaries = new Map<string, VectorSummaryFile>();

  const countLines = (text: unknown): number | null => {
    if (typeof text !== 'string') return null;
    if (!text.length) return 0;
    return text.split(/\r?\n/).length;
  };

  results.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const item = entry as Record<string, unknown>;
    const relPath = typeof item.relPath === 'string' ? item.relPath : undefined;
    const hostPath =
      typeof item.hostPath === 'string' ? item.hostPath : undefined;
    if (hostPath && relPath) relByHost.set(hostPath, relPath);
    const key = relPath ?? hostPath ?? `result-${index}`;
    const base: VectorSummaryFile = summaries.get(key) ?? {
      path: relPath ?? hostPath ?? key,
      relPath,
      match: null as number | null,
      chunks: 0,
      lines: null as number | null,
      repo: typeof item.repo === 'string' ? item.repo : undefined,
      modelId: typeof item.modelId === 'string' ? item.modelId : undefined,
      hostPathWarning:
        typeof item.hostPathWarning === 'string'
          ? item.hostPathWarning
          : undefined,
    };

    base.chunks += 1;
    if (typeof item.score === 'number') {
      base.match =
        base.match === null ? item.score : Math.max(base.match, item.score);
    }
    const lineCount =
      typeof item.lineCount === 'number'
        ? item.lineCount
        : countLines(item.chunk);
    if (typeof lineCount === 'number') {
      base.lines = (base.lines ?? 0) + lineCount;
    }

    summaries.set(key, base);
  });

  files.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const item = entry as Record<string, unknown>;
    const hostPath =
      typeof item.hostPath === 'string' ? item.hostPath : undefined;
    const relPath = hostPath ? relByHost.get(hostPath) : undefined;
    const key = hostPath ?? `file-${index}`;
    const base: VectorSummaryFile = summaries.get(key) ?? {
      path: relPath ?? hostPath ?? key,
      relPath,
      match: null as number | null,
      chunks: 0,
      lines: null as number | null,
      repo: typeof item.repo === 'string' ? item.repo : undefined,
      modelId: typeof item.modelId === 'string' ? item.modelId : undefined,
      hostPathWarning:
        typeof item.hostPathWarning === 'string'
          ? item.hostPathWarning
          : undefined,
    };

    const highest =
      typeof item.highestMatch === 'number' ? item.highestMatch : base.match;
    base.match = highest ?? base.match;
    const chunkCount =
      typeof item.chunkCount === 'number' ? item.chunkCount : undefined;
    base.chunks += chunkCount ?? 0;
    const lineCount =
      typeof item.lineCount === 'number' ? item.lineCount : null;
    if (lineCount !== null) {
      base.lines = (base.lines ?? 0) + lineCount;
    }

    summaries.set(key, base);
  });

  if (!summaries.size) return null;

  return {
    type: 'vector_summary',
    files: Array.from(summaries.values()),
  };
}
