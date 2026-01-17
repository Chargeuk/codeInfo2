import { SYSTEM_CONTEXT } from '@codeinfo2/common';
import { Codex } from '@openai/codex-sdk';
import type {
  ModelReasoningEffort,
  ThreadOptions as CodexThreadOptions,
  TurnOptions as CodexTurnOptions,
} from '@openai/codex-sdk';
import { buildCodexOptions } from '../../config/codexConfig.js';
import { append } from '../../logStore.js';
import { baseLogger } from '../../logger.js';
import { updateConversationThreadId } from '../../mongo/repo.js';
import type { TurnUsageMetadata } from '../../mongo/turn.js';
import { detectCodexForHome } from '../../providers/codexDetection.js';
import { getCodexDetection } from '../../providers/codexRegistry.js';
import { ChatInterface, type ChatToolResultEvent } from './ChatInterface.js';

type CodexThreadOptionsCompat = Omit<
  CodexThreadOptions,
  'modelReasoningEffort'
> & {
  modelReasoningEffort?: ModelReasoningEffort | 'xhigh';
};

type CodexRunFlags = {
  workingDirectoryOverride?: string;
  threadId?: string | null;
  codexFlags?: Partial<CodexThreadOptionsCompat>;
  codexHome?: string;
  disableSystemContext?: boolean;
  systemPrompt?: string;
  useConfigDefaults?: boolean;
  requestId?: string;
  signal?: AbortSignal;
  skipPersistence?: boolean;
  source?: 'REST' | 'MCP';
};

type CodexToolCallItem = {
  type?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  status?: string;
  result?: { content?: unknown; error?: unknown };
};

type CodexUsagePayload = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const mapCodexUsage = (usage: unknown): TurnUsageMetadata | undefined => {
  if (!usage || typeof usage !== 'object') return undefined;
  const payload = usage as CodexUsagePayload;
  const cleaned: TurnUsageMetadata = {};

  if (isFiniteNumber(payload.input_tokens) && payload.input_tokens >= 0) {
    cleaned.inputTokens = payload.input_tokens;
  }
  if (isFiniteNumber(payload.output_tokens) && payload.output_tokens >= 0) {
    cleaned.outputTokens = payload.output_tokens;
  }
  if (
    isFiniteNumber(payload.cached_input_tokens) &&
    payload.cached_input_tokens >= 0
  ) {
    cleaned.cachedInputTokens = payload.cached_input_tokens;
  }
  if (isFiniteNumber(payload.total_tokens) && payload.total_tokens >= 0) {
    cleaned.totalTokens = payload.total_tokens;
  }

  if (
    !isFiniteNumber(cleaned.totalTokens) &&
    isFiniteNumber(cleaned.inputTokens) &&
    isFiniteNumber(cleaned.outputTokens)
  ) {
    cleaned.totalTokens = cleaned.inputTokens + cleaned.outputTokens;
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

export interface CodexLikeThread {
  runStreamed: (
    input: string,
    opts?: CodexTurnOptions,
  ) => Promise<{ events: AsyncGenerator<unknown> }>;
}

export interface CodexLike {
  startThread: (opts?: CodexThreadOptions) => CodexLikeThread;
  resumeThread: (id: string, opts?: CodexThreadOptions) => CodexLikeThread;
}

export class ChatInterfaceCodex extends ChatInterface {
  constructor(
    private readonly codexFactory: () => CodexLike = () =>
      new Codex(buildCodexOptions()) as unknown as CodexLike,
  ) {
    super();
  }

  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ): Promise<void> {
    const {
      threadId,
      codexFlags,
      requestId,
      signal,
      codexHome,
      disableSystemContext,
      systemPrompt,
      useConfigDefaults,
      workingDirectoryOverride,
    } = (flags ?? {}) as CodexRunFlags;
    const detection = codexHome
      ? detectCodexForHome(codexHome)
      : getCodexDetection();
    if (!detection.available) {
      const msg = detection.reason ?? 'codex unavailable';
      this.emitEvent({ type: 'error', message: msg });
      return;
    }

    let activeThreadId: string | null = threadId ?? null;

    const codexWorkingDirectory =
      workingDirectoryOverride ??
      process.env.CODEX_WORKDIR ??
      process.env.CODEINFO_CODEX_WORKDIR ??
      '/data';

    const threadOptions: CodexThreadOptions = useConfigDefaults
      ? {
          workingDirectory: codexWorkingDirectory,
          skipGitRepoCheck: true,
        }
      : {
          model,
          workingDirectory: codexWorkingDirectory,
          skipGitRepoCheck: true,
          sandboxMode: codexFlags?.sandboxMode,
          networkAccessEnabled: codexFlags?.networkAccessEnabled,
          webSearchEnabled: codexFlags?.webSearchEnabled,
          approvalPolicy: codexFlags?.approvalPolicy,
          modelReasoningEffort:
            codexFlags?.modelReasoningEffort as unknown as CodexThreadOptions['modelReasoningEffort'],
        };

    const undefinedFlags: string[] = [];
    const addUndefinedFlag = (label: string, value: unknown) => {
      if (value === undefined) undefinedFlags.push(label);
    };

    addUndefinedFlag('sandboxMode', codexFlags?.sandboxMode);
    addUndefinedFlag('networkAccessEnabled', codexFlags?.networkAccessEnabled);
    addUndefinedFlag('webSearchEnabled', codexFlags?.webSearchEnabled);
    addUndefinedFlag('approvalPolicy', codexFlags?.approvalPolicy);
    addUndefinedFlag('modelReasoningEffort', codexFlags?.modelReasoningEffort);

    baseLogger.info(
      {
        threadOptions,
        undefinedFlags,
      },
      '[codex-thread-options] prepared',
    );

    const codex = codexHome
      ? (new Codex(buildCodexOptions({ codexHome })) as unknown as CodexLike)
      : this.codexFactory();

    const systemContext = disableSystemContext ? '' : SYSTEM_CONTEXT.trim();
    const agentSystemPrompt = (systemPrompt ?? '').trim();

    const promptSections: string[] = [];
    if (!threadId && systemContext)
      promptSections.push(`Context:\n${systemContext}`);
    if (!threadId && agentSystemPrompt)
      promptSections.push(`System:\n${agentSystemPrompt}`);

    const prompt =
      !threadId && promptSections.length
        ? `${promptSections.join('\n\n')}\n\nUser:\n${message}`
        : message;

    const thread =
      typeof threadId === 'string' && threadId.length > 0
        ? codex.resumeThread(threadId, threadOptions)
        : codex.startThread(threadOptions);

    const { events } = await thread.runStreamed(prompt, {
      signal,
    } as CodexTurnOptions);

    const codexToolCtx = new Map<
      string,
      { name?: string; parameters?: unknown }
    >();

    const emitThreadId = async (incoming?: string | null) => {
      if (!incoming || incoming === activeThreadId) return;
      activeThreadId = incoming;
      this.emitEvent({ type: 'thread', threadId: incoming });
      await updateConversationThreadId({
        conversationId,
        threadId: incoming,
      }).catch((err) =>
        baseLogger.error(
          { requestId, provider: 'codex', err },
          'failed to persist codex thread id',
        ),
      );
    };

    const parseCodexToolParameters = (item: CodexToolCallItem): unknown => {
      const raw =
        (item as { arguments?: unknown; args?: unknown }).arguments ??
        (item as { args?: unknown }).args;
      if (raw === undefined) return undefined;
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
      return raw;
    };

    const pickContent = (content?: unknown): unknown | null => {
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
    };

    const parseCodexToolResult = (item: CodexToolCallItem): unknown => {
      const content = (item.result as { content?: unknown } | undefined)
        ?.content;
      const picked = pickContent(content);
      if (picked !== null) return picked;
      if ((item.result as { error?: unknown } | undefined)?.error) {
        return { error: (item.result as { error?: unknown }).error };
      }
      return item.result ?? null;
    };

    const trimCodexError = (
      err: unknown,
    ): { code?: string; message: string } | null => {
      if (!err) return null;
      if (typeof err === 'object') {
        const obj = err as Record<string, unknown>;
        const message =
          typeof obj.message === 'string' ? obj.message : String(err);
        const code = typeof obj.code === 'string' ? obj.code : undefined;
        return { code, message };
      }
      return { message: String(err) };
    };

    const deriveCodexToolName = (
      item: CodexToolCallItem,
    ): string | undefined => {
      const args = (item as { arguments?: Record<string, unknown> }).arguments;
      const argTool =
        args && typeof args === 'object' && typeof args.tool === 'string'
          ? args.tool
          : undefined;
      return (
        item.name ||
        (item as { tool_name?: string }).tool_name ||
        (item as { tool?: string }).tool ||
        argTool ||
        undefined
      );
    };

    const emitCodexToolRequest = (item: CodexToolCallItem) => {
      if (item.type !== 'mcp_tool_call') return;
      const callId = item.id ?? `codex-tool-${Date.now()}`;
      const name = deriveCodexToolName(item);
      const parameters = parseCodexToolParameters(item);
      codexToolCtx.set(String(callId), {
        name,
        parameters,
      });
      this.emitEvent({
        type: 'tool-request',
        callId,
        name: name ?? '',
        params: parameters,
        stage: 'started',
      });
    };

    const emitCodexToolResult = (item: CodexToolCallItem) => {
      if (item.type !== 'mcp_tool_call') return;
      const callId = item.id ?? 'codex-tool';
      const stored = codexToolCtx.get(String(callId));
      const parameters = stored?.parameters ?? parseCodexToolParameters(item);
      const name = stored?.name ?? deriveCodexToolName(item);
      const payload = parseCodexToolResult(item);
      const error = (item.result as { error?: unknown } | undefined)?.error;
      const errorTrimmed = trimCodexError(error);

      const resultEvent: ChatToolResultEvent = {
        type: 'tool-result',
        callId,
        name,
        params: parameters,
        result: payload,
        stage: error ? 'error' : 'success',
        error: errorTrimmed,
      };
      this.emitEvent(resultEvent);
    };

    let finalText = '';
    const reasoningByItemKey = new Map<string, string>();
    let hasEmittedReasoning = false;

    try {
      for await (const rawEvent of events as AsyncGenerator<unknown>) {
        const event = rawEvent as Record<string, unknown>;
        if (signal?.aborted) {
          // stop requested
          break;
        }
        switch (event.type as string) {
          case 'thread.started':
            await emitThreadId((event as { thread_id?: string }).thread_id);
            break;
          case 'item.started': {
            const item = (event as { item?: unknown })?.item as
              | CodexToolCallItem
              | undefined;
            if (item?.type === 'mcp_tool_call') emitCodexToolRequest(item);
            break;
          }
          case 'item.updated':
          case 'item.completed': {
            const item = (event as { item?: unknown })?.item as
              | CodexToolCallItem
              | { type?: string; text?: string }
              | undefined;

            if (item?.type === 'reasoning') {
              const itemKey =
                typeof (item as { id?: unknown }).id === 'string'
                  ? String((item as { id?: unknown }).id)
                  : '__anonymous__';
              const previous = reasoningByItemKey.get(itemKey) ?? '';
              const text = (item as { text?: string }).text ?? '';

              if (text.length === 0) {
                reasoningByItemKey.set(itemKey, '');
                break;
              }

              const isContinuation =
                previous.length > 0 && text.startsWith(previous);

              if (!hasEmittedReasoning) {
                const delta = isContinuation
                  ? text.slice(previous.length)
                  : text;
                if (delta) {
                  this.emitEvent({ type: 'analysis', content: delta });
                  hasEmittedReasoning = true;
                }
                reasoningByItemKey.set(itemKey, text);
                break;
              }

              if (isContinuation) {
                const delta = text.slice(previous.length);
                if (delta) this.emitEvent({ type: 'analysis', content: delta });
                reasoningByItemKey.set(itemKey, text);
                break;
              }

              // Non-prefix updates are treated as a new reasoning block (multi-item or reset).
              if (previous.length > 0) {
                append({
                  level: 'info',
                  message: 'chat.codex.reasoning_reset',
                  timestamp: new Date().toISOString(),
                  source: 'server',
                  requestId,
                  context: {
                    conversationId,
                    itemKey,
                    previousLength: previous.length,
                    nextLength: text.length,
                  },
                });
              }
              this.emitEvent({ type: 'analysis', content: `\n\n${text}` });
              reasoningByItemKey.set(itemKey, text);
              break;
            }

            if (item?.type === 'mcp_tool_call') {
              if (event.type === 'item.completed') emitCodexToolResult(item);
              break;
            }

            if (!item || item.type !== 'agent_message') break;
            const text = (item as { text?: string }).text ?? '';
            const delta = text.slice(finalText.length);
            if (delta) {
              this.emitEvent({ type: 'token', content: delta });
            }
            finalText = text;
            if (event.type === 'item.completed') {
              this.emitEvent({ type: 'final', content: finalText });
            }
            break;
          }
          case 'turn.failed': {
            const message = (event as { error?: { message?: string } })?.error
              ?.message;
            this.emitEvent({
              type: 'error',
              message: message ?? 'codex turn failed',
            });
            break;
          }
          case 'error': {
            this.emitEvent({
              type: 'error',
              message:
                (event as { message?: string })?.message ?? 'codex error',
            });
            break;
          }
          case 'turn.completed':
            await emitThreadId(activeThreadId);
            const usage = mapCodexUsage(
              (event as { usage?: unknown } | undefined)?.usage,
            );
            if (usage) {
              append({
                level: 'info',
                message: 'DEV-0000024:T3:codex_usage_received',
                timestamp: new Date().toISOString(),
                source: 'server',
                requestId,
                context: {
                  conversationId,
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  cachedInputTokens: usage.cachedInputTokens,
                  totalTokens: usage.totalTokens,
                },
              });
            }
            this.emitEvent({
              type: 'complete',
              threadId: activeThreadId,
              ...(usage ? { usage } : {}),
            });
            break;
          default:
            break;
        }
      }
    } catch (err) {
      const messageText =
        (err as Error | undefined)?.message ?? 'codex unavailable';
      this.emitEvent({ type: 'error', message: messageText });
    } finally {
      // persistence is handled by ChatInterface base
    }
  }
}
