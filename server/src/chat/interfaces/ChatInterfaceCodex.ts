import {
  SYSTEM_CONTEXT,
  VECTORSEARCH_PROTOCOL_REMINDER,
} from '@codeinfo2/common';
import { Codex } from '@openai/codex-sdk';
import type {
  CodexOptions,
  ThreadOptions as CodexThreadOptions,
  TurnOptions as CodexTurnOptions,
} from '@openai/codex-sdk';
import { buildCodexOptions } from '../../config/codexConfig.js';
import { append } from '../../logStore.js';
import { baseLogger } from '../../logger.js';
import { updateConversationThreadId } from '../../mongo/repo.js';
import type { TurnUsageMetadata } from '../../mongo/turn.js';
import { refreshCodexDetection } from '../../providers/codexDetection.js';
import { getCodexDetection } from '../../providers/codexRegistry.js';
import { getScopedEnvValue } from '../../test/support/testEnvOverrideScope.js';
import {
  memoryConversations,
  shouldUseMemoryPersistence,
  updateMemoryConversationMeta,
} from '../memoryPersistence.js';
import { ChatInterface, type ChatToolResultEvent } from './ChatInterface.js';

type CodexRunFlags = {
  workingDirectoryOverride?: string;
  envOverrides?: NodeJS.ProcessEnv;
  threadId?: string | null;
  codexFlags?: CodexExecutionFlags;
  forceWebSearchModeWhenUsingConfigDefaults?: 'live';
  codexHome?: string;
  disableSystemContext?: boolean;
  systemPrompt?: string;
  useConfigDefaults?: boolean;
  runtimeConfig?: CodexOptions['config'];
  requestId?: string;
  signal?: AbortSignal;
  skipPersistence?: boolean;
  source?: 'REST' | 'MCP';
};

type CodexExecutionFlags = Partial<
  Pick<
    CodexThreadOptions,
    | 'sandboxMode'
    | 'networkAccessEnabled'
    | 'webSearchMode'
    | 'webSearchEnabled'
    | 'approvalPolicy'
    | 'modelReasoningEffort'
  >
> & {
  modelReasoningSummary?: 'auto' | 'concise' | 'detailed' | 'none';
  modelVerbosity?: 'low' | 'medium' | 'high';
};

type CodexToolCallItem = {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  arguments?: unknown;
  status?: string;
  result?: { content?: unknown; error?: unknown };
};

type CodexAssistantMessageItem = {
  type?: string;
  id?: string;
  text?: string;
};

type CodexUsagePayload = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const GENERIC_CODEX_EXEC_STARTUP_BANNER =
  'Codex Exec exited with code 1: Reading prompt from stdin...';

const isGenericCodexExecStartupBanner = (value: unknown): boolean =>
  typeof value === 'string' &&
  trimDiagnosticText(value) === GENERIC_CODEX_EXEC_STARTUP_BANNER;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mergeRuntimeConfigOverrides = (
  baseConfig: CodexOptions['config'],
  overrides: {
    model_reasoning_summary?: CodexExecutionFlags['modelReasoningSummary'];
    model_verbosity?: CodexExecutionFlags['modelVerbosity'];
  },
): CodexOptions['config'] => {
  const entries = Object.entries(overrides).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return baseConfig;

  const merged: Record<string, unknown> = isRecord(baseConfig)
    ? { ...baseConfig }
    : {};
  for (const [key, value] of entries) {
    merged[key] = value;
  }
  return merged as CodexOptions['config'];
};

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

const runtimeConfigSupportsEndpointOnlyExecution = (
  runtimeConfig: CodexOptions['config'] | undefined,
): boolean => {
  if (!runtimeConfig || typeof runtimeConfig !== 'object') {
    return false;
  }

  const configRecord = runtimeConfig as Record<string, unknown>;
  const modelProvider = configRecord.model_provider;
  const modelProviders = configRecord.model_providers;
  if (typeof modelProvider !== 'string' || modelProvider.trim().length === 0) {
    return false;
  }
  if (!isRecord(modelProviders)) {
    return false;
  }
  return isRecord(modelProviders[modelProvider]);
};

type CodexErrorDiagnostic = {
  name?: string;
  code?: string;
  message?: string;
  stderr?: string;
  stdout?: string;
};

const trimDiagnosticText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const collectCodexErrorDiagnostics = (
  err: unknown,
  seen = new Set<unknown>(),
  depth = 0,
): CodexErrorDiagnostic[] => {
  if (!err || depth > 6 || seen.has(err)) return [];
  if (typeof err !== 'object') {
    const text = trimDiagnosticText(String(err));
    return text ? [{ message: text }] : [];
  }

  seen.add(err);
  const record = err as Record<string, unknown>;
  const current: CodexErrorDiagnostic = {
    name:
      typeof record.name === 'string' && record.name.trim().length > 0
        ? record.name
        : undefined,
    code:
      typeof record.code === 'string' && record.code.trim().length > 0
        ? record.code
        : undefined,
    message:
      typeof record.message === 'string' && record.message.trim().length > 0
        ? record.message
        : err instanceof Error
          ? trimDiagnosticText(err.message)
          : undefined,
    stderr: trimDiagnosticText(record.stderr),
    stdout: trimDiagnosticText(record.stdout),
  };

  const diagnostics: CodexErrorDiagnostic[] = [
    ...(current.message || current.stderr || current.stdout ? [current] : []),
  ];

  const nested = record.cause;
  if (nested !== undefined) {
    diagnostics.push(...collectCodexErrorDiagnostics(nested, seen, depth + 1));
  }

  if (Array.isArray(record.errors)) {
    for (const child of record.errors) {
      diagnostics.push(...collectCodexErrorDiagnostics(child, seen, depth + 1));
    }
  }

  return diagnostics;
};

const buildCodexExecutionError = (
  err: unknown,
): {
  message: string;
  diagnostics: CodexErrorDiagnostic[];
} => {
  const diagnostics = collectCodexErrorDiagnostics(err);
  const blocks: string[] = [];
  const seenBlocks = new Set<string>();
  for (const diagnostic of diagnostics) {
    for (const candidate of [
      diagnostic.message,
      diagnostic.stderr,
      diagnostic.stdout,
    ]) {
      const text = trimDiagnosticText(candidate);
      if (!text || seenBlocks.has(text)) continue;
      seenBlocks.add(text);
      blocks.push(text);
    }
  }

  return {
    message: blocks.length > 0 ? blocks.join('\n') : 'codex unavailable',
    diagnostics,
  };
};

export class ChatInterfaceCodex extends ChatInterface {
  constructor(
    private readonly codexFactory: (options?: CodexOptions) => CodexLike = (
      options?: CodexOptions,
    ) => new Codex(options ?? buildCodexOptions()) as unknown as CodexLike,
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
      envOverrides,
      runtimeConfig,
      forceWebSearchModeWhenUsingConfigDefaults,
    } = (flags ?? {}) as CodexRunFlags;
    const effectiveCodexFlags = codexFlags ?? {};
    const detection = codexHome
      ? refreshCodexDetection({ codexHome })
      : getCodexDetection();
    const endpointOnlyExecution =
      !detection.available &&
      runtimeConfigSupportsEndpointOnlyExecution(runtimeConfig);
    if (!detection.available && !endpointOnlyExecution) {
      const msg = detection.reason ?? 'codex unavailable';
      this.emitEvent({ type: 'error', message: msg });
      return;
    }

    let activeThreadId: string | null = threadId ?? null;

    const codexWorkingDirectory =
      workingDirectoryOverride ??
      getScopedEnvValue('CODEX_WORKDIR') ??
      getScopedEnvValue('CODEINFO_CODEX_WORKDIR') ??
      '/data';

    const effectiveRuntimeConfig =
      useConfigDefaults && runtimeConfig === undefined
        ? undefined
        : mergeRuntimeConfigOverrides(runtimeConfig, {
            model_reasoning_summary: effectiveCodexFlags.modelReasoningSummary,
            model_verbosity: effectiveCodexFlags.modelVerbosity,
          });

    const threadOptions: CodexThreadOptions = useConfigDefaults
      ? {
          workingDirectory: codexWorkingDirectory,
          skipGitRepoCheck: true,
          ...(forceWebSearchModeWhenUsingConfigDefaults === 'live'
            ? { webSearchMode: 'live' as const }
            : {}),
        }
      : {
          model,
          workingDirectory: codexWorkingDirectory,
          skipGitRepoCheck: true,
          sandboxMode: effectiveCodexFlags.sandboxMode,
          networkAccessEnabled: effectiveCodexFlags.networkAccessEnabled,
          webSearchMode: effectiveCodexFlags.webSearchMode,
          webSearchEnabled: effectiveCodexFlags.webSearchEnabled,
          approvalPolicy: effectiveCodexFlags.approvalPolicy,
          modelReasoningEffort: effectiveCodexFlags.modelReasoningEffort,
        };

    const undefinedFlags: string[] = [];
    const addUndefinedFlag = (label: string, value: unknown) => {
      if (value === undefined) undefinedFlags.push(label);
    };

    addUndefinedFlag('sandboxMode', effectiveCodexFlags.sandboxMode);
    addUndefinedFlag(
      'networkAccessEnabled',
      effectiveCodexFlags.networkAccessEnabled,
    );
    addUndefinedFlag('webSearchMode', effectiveCodexFlags.webSearchMode);
    addUndefinedFlag('webSearchEnabled', effectiveCodexFlags.webSearchEnabled);
    addUndefinedFlag('approvalPolicy', effectiveCodexFlags.approvalPolicy);
    addUndefinedFlag(
      'modelReasoningEffort',
      effectiveCodexFlags.modelReasoningEffort,
    );

    baseLogger.info(
      {
        threadOptions,
        undefinedFlags,
      },
      '[codex-thread-options] prepared',
    );

    const codexOptions = buildCodexOptions({
      codexHome,
      runtimeConfig: effectiveRuntimeConfig,
      envOverrides,
    });
    const codex = this.codexFactory(codexOptions);

    const systemContext = disableSystemContext ? '' : SYSTEM_CONTEXT;
    const agentSystemPrompt = (systemPrompt ?? '').trim();

    const promptSections: string[] = [];
    if (!threadId && systemContext)
      promptSections.push(`Context:\n${systemContext}`);
    if (!threadId && agentSystemPrompt)
      promptSections.push(`System:\n${agentSystemPrompt}`);

    if (!disableSystemContext && message?.trim().length) {
      message = `${message}\n- ${VECTORSEARCH_PROTOCOL_REMINDER}`;
    }

    const prompt =
      !threadId && promptSections.length
        ? `${promptSections.join('\n\n')}\n\nUser:\n${message}`
        : message;

    const thread =
      typeof threadId === 'string' && threadId.length > 0
        ? codex.resumeThread(threadId, threadOptions)
        : codex.startThread(threadOptions);

    const codexToolCtx = new Map<
      string,
      { name?: string; parameters?: unknown }
    >();

    const emitThreadId = async (incoming?: string | null) => {
      if (!incoming || incoming === activeThreadId) return;
      activeThreadId = incoming;
      this.emitEvent({ type: 'thread', threadId: incoming });
      if (shouldUseMemoryPersistence()) {
        const currentFlags = memoryConversations.get(conversationId)?.flags;
        updateMemoryConversationMeta(conversationId, {
          flags: {
            ...(typeof currentFlags === 'object' && currentFlags !== null
              ? currentFlags
              : {}),
            threadId: incoming,
          },
        });
        return;
      }
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

    const assistantByItemKey = new Map<
      string,
      { text: string; order: number; completed: boolean }
    >();
    let assistantOrderSeq = 0;
    let emittedAssistantText = '';
    const reasoningByItemKey = new Map<string, string>();
    let hasEmittedReasoning = false;
    let finalEmitted = false;

    const getAssistantItemKey = (item: CodexAssistantMessageItem): string =>
      typeof item.id === 'string' && item.id.length > 0
        ? item.id
        : '__anonymous_assistant__';

    const buildAssistantText = (): string =>
      [...assistantByItemKey.values()]
        .sort((a, b) => a.order - b.order)
        .map((entry) => entry.text)
        .join('');

    const emitAssistantDeltaFromComposed = () => {
      const composed = buildAssistantText();
      if (!composed.startsWith(emittedAssistantText)) {
        return;
      }
      const delta = composed.slice(emittedAssistantText.length);
      if (delta) {
        this.emitEvent({ type: 'token', content: delta });
      }
      emittedAssistantText = composed;
    };

    const emitFormattedCodexExecutionError = (err: unknown) => {
      const formattedError = buildCodexExecutionError(err);
      const genericStartupFailure =
        formattedError.diagnostics.length > 0 &&
        formattedError.diagnostics.every(
          (diagnostic) =>
            isGenericCodexExecStartupBanner(diagnostic.message) &&
            !diagnostic.stderr &&
            !diagnostic.stdout,
        ) &&
        isGenericCodexExecStartupBanner(formattedError.message);
      baseLogger.error(
        {
          requestId,
          provider: 'codex',
          model,
          conversationId,
          threadId: activeThreadId,
          diagnostics: formattedError.diagnostics,
          err,
        },
        'codex streamed execution failed',
      );
      if (genericStartupFailure) {
        append({
          level: 'error',
          message: 'DEV-0000053:T2:codex_generic_startup_failure',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: {
            provider: 'codex',
            model,
            conversationId,
            threadId: activeThreadId,
            requestedThreadId:
              typeof threadId === 'string' && threadId.trim().length > 0
                ? threadId
                : null,
            resumeRequested:
              typeof threadId === 'string' && threadId.trim().length > 0,
            workingDirectory: codexWorkingDirectory,
            codexHome:
              typeof codexOptions?.env?.CODEX_HOME === 'string'
                ? codexOptions.env.CODEX_HOME
                : null,
            runtimeConfigKeys: effectiveRuntimeConfig
              ? Object.keys(effectiveRuntimeConfig).sort()
              : [],
            envOverrideKeys: Object.keys(envOverrides ?? {}).sort(),
            useConfigDefaults: Boolean(useConfigDefaults),
            endpointOnlyExecution,
            undefinedFlags,
          },
        });
      }
      this.emitEvent({ type: 'error', message: formattedError.message });
    };

    let events: AsyncGenerator<unknown>;
    try {
      ({ events } = await thread.runStreamed(prompt, {
        signal,
      } as CodexTurnOptions));
    } catch (err) {
      emitFormattedCodexExecutionError(err);
      return;
    }

    try {
      for await (const rawEvent of events) {
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
              | CodexAssistantMessageItem
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
            const itemKey = getAssistantItemKey(item);
            const existing = assistantByItemKey.get(itemKey);

            if (existing?.completed && event.type === 'item.updated') {
              append({
                level: 'info',
                message: 'DEV-0000035:T8:codex_merge_evaluated',
                timestamp: new Date().toISOString(),
                source: 'server',
                requestId,
                context: {
                  conversationId,
                  eventType: event.type,
                  itemKey,
                  ignored: 'post_completion_update',
                  previousLength: existing.text.length,
                },
              });
              // Ignore stale post-completion updates for finalized items.
              break;
            }

            const nextText = item.text ?? '';
            const previousLength = existing?.text.length ?? 0;
            const isNonPrefixUpdate =
              previousLength > 0 && !nextText.startsWith(existing?.text ?? '');
            assistantByItemKey.set(itemKey, {
              text: nextText,
              order: existing?.order ?? assistantOrderSeq++,
              completed: existing?.completed ?? false,
            });

            append({
              level: 'info',
              message: 'DEV-0000035:T8:codex_merge_evaluated',
              timestamp: new Date().toISOString(),
              source: 'server',
              requestId,
              context: {
                conversationId,
                eventType: event.type,
                itemKey,
                previousLength,
                nextLength: nextText.length,
                nonPrefixUpdate: isNonPrefixUpdate,
              },
            });

            emitAssistantDeltaFromComposed();

            if (event.type === 'item.completed') {
              const afterComplete = assistantByItemKey.get(itemKey);
              if (afterComplete) {
                afterComplete.completed = true;
              }
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
            if (!finalEmitted) {
              const authoritativeFinal = buildAssistantText();
              if (authoritativeFinal.length > 0) {
                this.emitEvent({ type: 'final', content: authoritativeFinal });
                finalEmitted = true;
                emittedAssistantText = authoritativeFinal;
              }
            }
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
      emitFormattedCodexExecutionError(err);
    } finally {
      // persistence is handled by ChatInterface base
    }
  }
}
