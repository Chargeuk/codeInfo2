import { SYSTEM_CONTEXT } from '@codeinfo2/common';
import type { ThreadEvent, ThreadOptions } from '@openai/codex-sdk';
import { Codex } from '@openai/codex-sdk';
import { z } from 'zod';
import { buildCodexOptions } from '../../config/codexConfig.js';
import { InvalidParamsError } from '../errors.js';

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

export async function runCodebaseQuestion(
  params: unknown,
  deps: Partial<CodebaseQuestionDeps> = {},
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const { question, conversationId } = validateParams(params);
  const codex = (deps.codexFactory ?? createDefaultCodexFactory)();

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
          const summary = buildVectorSummary(parseCodexToolResult(item));
          if (summary) segments.push(summary);
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

  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

export function codebaseQuestionDefinition() {
  return {
    name: CODEBASE_QUESTION_TOOL_NAME,
    description:
      'Ask a repository question with Codex using vector search; returns ordered thinking, vector summaries, and a final answer with a conversationId for follow-ups.',
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
    'You are the CodeInfo MCP agent. Use the available MCP tools (VectorSearch) to find relevant files before answering. ' +
    'Provide concise answers grounded in results and keep tool output out of the final text.\n\n' +
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
