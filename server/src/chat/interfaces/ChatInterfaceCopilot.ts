import {
  approveAll,
  type CopilotSession,
  type ModelInfo,
  type PermissionHandler,
  type ResumeSessionConfig,
  type SessionConfig,
  type SessionEvent,
  type SessionEventHandler,
  type SystemMessageConfig,
  type Tool,
} from '@github/copilot-sdk';
import { append } from '../../logStore.js';
import { baseLogger } from '../../logger.js';
import type { TurnSummary } from '../../mongo/repo.js';
import type {
  TurnTimingMetadata,
  TurnUsageMetadata,
} from '../../mongo/turn.js';
import { CopilotLifecycle } from '../copilotLifecycle.js';
import { copilotModelSupportsReasoningEffort } from '../copilotModelSupport.js';
import {
  resolveCopilotRuntimeAgentFlags,
  type CopilotRuntimeAgentFlags,
} from '../providerRuntimeFlags.js';
import { ChatInterface } from './ChatInterface.js';

const TASK7_LOG_MARKER = 'story.0000051.task07.chat_turn_completed';
const DEFAULT_COPILOT_SEND_AND_WAIT_TIMEOUT_SEC = 7200;

type CopilotRunFlags = {
  agentFlags?: Record<string, unknown>;
  systemPrompt?: string;
  workingDirectoryOverride?: string;
  history?: TurnSummary[];
  resumeConversation?: boolean;
  copilotModels?: ModelInfo[];
};

type CopilotSessionLike = Pick<
  CopilotSession,
  | 'sendAndWait'
  | 'disconnect'
  | 'registerHooks'
  | 'registerPermissionHandler'
  | 'registerTools'
>;
type CopilotSessionHooks = Parameters<CopilotSession['registerHooks']>[0];

type SessionPhase = 'create' | 'resume';

type ChatInterfaceCopilotOptions = {
  hooksFactory?: (
    phase: SessionPhase,
    flags: CopilotRunFlags,
  ) => CopilotSessionHooks | undefined;
  toolsFactory?: (
    phase: SessionPhase,
    flags: CopilotRunFlags,
  ) =>
    | {
        tools: Tool[];
        toolNames: string[];
      }
    | undefined;
  permissionHandler?: PermissionHandler;
};

const normalizeUsage = (event: SessionEvent): TurnUsageMetadata | undefined => {
  if (event.type !== 'assistant.usage') return undefined;

  const cleaned: TurnUsageMetadata = {};
  if (typeof event.data.inputTokens === 'number' && event.data.inputTokens >= 0)
    cleaned.inputTokens = event.data.inputTokens;
  if (
    typeof event.data.outputTokens === 'number' &&
    event.data.outputTokens >= 0
  )
    cleaned.outputTokens = event.data.outputTokens;
  if (
    typeof event.data.cacheReadTokens === 'number' &&
    event.data.cacheReadTokens >= 0
  ) {
    cleaned.cachedInputTokens = event.data.cacheReadTokens;
  }
  if (
    typeof cleaned.inputTokens === 'number' &&
    typeof cleaned.outputTokens === 'number'
  ) {
    cleaned.totalTokens = cleaned.inputTokens + cleaned.outputTokens;
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

const normalizeTiming = (
  event: SessionEvent,
): TurnTimingMetadata | undefined => {
  if (event.type !== 'assistant.usage') return undefined;

  if (typeof event.data.duration !== 'number' || event.data.duration <= 0) {
    return undefined;
  }

  const totalTimeSec = event.data.duration / 1000;
  const outputTokens =
    typeof event.data.outputTokens === 'number' ? event.data.outputTokens : 0;
  return {
    totalTimeSec,
    ...(outputTokens > 0
      ? { tokensPerSecond: outputTokens / totalTimeSec }
      : {}),
  };
};

const resolveCopilotSendAndWaitTimeoutMs = (
  env: NodeJS.ProcessEnv = process.env,
): number => {
  const rawValue = env.CODEINFO_COPILOT_SEND_AND_WAIT_TIMEOUT_SEC?.trim();
  const parsedSeconds =
    rawValue && rawValue.length > 0 ? Number(rawValue) : NaN;
  const effectiveSeconds =
    Number.isFinite(parsedSeconds) && parsedSeconds > 0
      ? parsedSeconds
      : DEFAULT_COPILOT_SEND_AND_WAIT_TIMEOUT_SEC;
  return effectiveSeconds * 1000;
};

export class ChatInterfaceCopilot extends ChatInterface {
  private readonly hooksFactory: NonNullable<
    ChatInterfaceCopilotOptions['hooksFactory']
  >;

  private readonly toolsFactory: NonNullable<
    ChatInterfaceCopilotOptions['toolsFactory']
  >;

  private readonly permissionHandler: PermissionHandler;

  constructor(
    private readonly lifecycle: CopilotLifecycle,
    options: ChatInterfaceCopilotOptions = {},
  ) {
    super();
    this.hooksFactory =
      options.hooksFactory ??
      (() => ({
        onSessionStart: async () => undefined,
      }));
    this.toolsFactory = options.toolsFactory ?? (() => undefined);
    this.permissionHandler = options.permissionHandler ?? approveAll;
  }

  private resolveSessionFlags(flags: CopilotRunFlags): {
    runtimeFlags: CopilotRuntimeAgentFlags;
    toolConfig?: ReturnType<
      NonNullable<ChatInterfaceCopilotOptions['toolsFactory']>
    >;
  } {
    const phase: SessionPhase = flags.resumeConversation ? 'resume' : 'create';
    const runtimeFlags = resolveCopilotRuntimeAgentFlags(flags.agentFlags);
    return {
      runtimeFlags,
      toolConfig:
        runtimeFlags.toolAccess === 'off'
          ? undefined
          : this.toolsFactory(phase, flags),
    };
  }

  buildCreateSessionConfig(
    conversationId: string,
    model: string,
    flags: Record<string, unknown>,
    onEvent?: SessionEventHandler,
  ): SessionConfig {
    const typedFlags = (flags ?? {}) as CopilotRunFlags;
    const { runtimeFlags, toolConfig } = this.resolveSessionFlags(typedFlags);
    const reasoningEffortSupported = Array.isArray(typedFlags.copilotModels)
      ? copilotModelSupportsReasoningEffort(typedFlags.copilotModels, model)
      : true;
    return {
      sessionId: conversationId,
      model,
      configDir: this.lifecycle.configDir,
      onPermissionRequest: this.permissionHandler,
      hooks: this.hooksFactory('create', typedFlags),
      tools: toolConfig?.tools,
      ...(onEvent ? { onEvent } : {}),
      ...(runtimeFlags.toolAccess === 'off' ? { availableTools: [] } : {}),
      ...(reasoningEffortSupported && runtimeFlags.modelReasoningEffort
        ? { reasoningEffort: runtimeFlags.modelReasoningEffort }
        : {}),
      ...(typedFlags.systemPrompt
        ? {
            systemMessage: {
              mode: 'append',
              content: typedFlags.systemPrompt,
            } satisfies SystemMessageConfig,
          }
        : {}),
      ...(typedFlags.workingDirectoryOverride
        ? { workingDirectory: typedFlags.workingDirectoryOverride }
        : {}),
    };
  }

  buildResumeSessionConfig(
    model: string,
    flags: Record<string, unknown>,
    onEvent?: SessionEventHandler,
  ): ResumeSessionConfig {
    const typedFlags = (flags ?? {}) as CopilotRunFlags;
    const { runtimeFlags, toolConfig } = this.resolveSessionFlags(typedFlags);
    const reasoningEffortSupported = Array.isArray(typedFlags.copilotModels)
      ? copilotModelSupportsReasoningEffort(typedFlags.copilotModels, model)
      : true;
    return {
      model,
      configDir: this.lifecycle.configDir,
      onPermissionRequest: this.permissionHandler,
      hooks: this.hooksFactory('resume', typedFlags),
      tools: toolConfig?.tools,
      ...(onEvent ? { onEvent } : {}),
      ...(runtimeFlags.toolAccess === 'off' ? { availableTools: [] } : {}),
      ...(reasoningEffortSupported && runtimeFlags.modelReasoningEffort
        ? { reasoningEffort: runtimeFlags.modelReasoningEffort }
        : {}),
      ...(typedFlags.systemPrompt
        ? {
            systemMessage: {
              mode: 'append',
              content: typedFlags.systemPrompt,
            } satisfies SystemMessageConfig,
          }
        : {}),
      ...(typedFlags.workingDirectoryOverride
        ? { workingDirectory: typedFlags.workingDirectoryOverride }
        : {}),
    };
  }

  async createConversationSession(
    conversationId: string,
    model: string,
    flags: Record<string, unknown>,
    onEvent?: SessionEventHandler,
  ) {
    return this.lifecycle.createSession(
      this.buildCreateSessionConfig(conversationId, model, flags, onEvent),
    );
  }

  async resumeConversationSession(
    conversationId: string,
    model: string,
    flags: Record<string, unknown>,
    onEvent?: SessionEventHandler,
  ) {
    return this.lifecycle.resumeSession(
      conversationId,
      this.buildResumeSessionConfig(model, flags, onEvent),
    );
  }

  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ): Promise<void> {
    const typedFlags = (flags ?? {}) as CopilotRunFlags;
    const phase: SessionPhase = typedFlags.resumeConversation
      ? 'resume'
      : 'create';
    let latestUsage: TurnUsageMetadata | undefined;
    let latestTiming: TurnTimingMetadata | undefined;
    let terminalLogged = false;
    let started = false;
    let session: CopilotSessionLike | undefined;
    const toolNameByCallId = new Map<string, string>();
    let sawProviderThreadEvent = false;

    const logTerminal = (status: 'completed' | 'stopped' | 'failed') => {
      if (terminalLogged) return;
      terminalLogged = true;
      const context = {
        provider: 'copilot',
        conversationId,
        phase,
        status,
      };
      append({
        level: 'info',
        message: TASK7_LOG_MARKER,
        timestamp: new Date().toISOString(),
        source: 'server',
        context,
      });
      baseLogger.info(context, TASK7_LOG_MARKER);
    };

    const onEvent: SessionEventHandler = (event) => {
      const usage = normalizeUsage(event);
      if (usage) latestUsage = usage;
      const timing = normalizeTiming(event);
      if (timing) latestTiming = timing;

      switch (event.type) {
        case 'session.start':
        case 'session.resume':
          sawProviderThreadEvent = true;
          this.emitEvent({ type: 'thread', threadId: conversationId });
          return;
        case 'assistant.message_delta':
          this.emitEvent({
            type: 'token',
            content: event.data.deltaContent,
          });
          return;
        case 'assistant.message':
          if (event.data.reasoningText?.trim()) {
            this.emitEvent({
              type: 'analysis',
              content: event.data.reasoningText,
            });
          }
          for (const request of event.data.toolRequests ?? []) {
            toolNameByCallId.set(request.toolCallId, request.name);
            this.emitEvent({
              type: 'tool-request',
              callId: request.toolCallId,
              name: request.name,
              params: request.arguments,
              stage: 'started',
            });
          }
          if (event.data.content.trim().length > 0) {
            this.emitEvent({
              type: 'final',
              content: event.data.content,
            });
          }
          return;
        case 'tool.execution_start':
          toolNameByCallId.set(event.data.toolCallId, event.data.toolName);
          this.emitEvent({
            type: 'tool-request',
            callId: event.data.toolCallId,
            name: event.data.toolName,
            params: event.data.arguments,
            stage: 'started',
          });
          return;
        case 'tool.execution_complete':
          this.emitEvent({
            type: 'tool-result',
            callId: event.data.toolCallId,
            name: toolNameByCallId.get(event.data.toolCallId),
            stage: event.data.success ? 'success' : 'error',
            result:
              event.data.result?.detailedContent ?? event.data.result?.content,
            error: event.data.success
              ? null
              : {
                  code: 'COPILOT_TOOL_ERROR',
                  message: event.data.error?.message ?? 'Copilot tool failed',
                },
          });
          return;
        case 'abort':
          this.emitEvent({
            type: 'error',
            message: event.data.reason || 'Copilot run stopped',
          });
          logTerminal('stopped');
          return;
        case 'session.error':
          this.emitEvent({
            type: 'error',
            message: event.data.message,
          });
          logTerminal('failed');
          return;
        case 'session.idle':
          this.emitEvent({
            type: 'complete',
            threadId: conversationId,
            usage: latestUsage,
            timing: latestTiming,
          });
          logTerminal('completed');
          return;
        default:
          return;
      }
    };

    try {
      await this.lifecycle.start();
      started = true;

      session =
        phase === 'resume'
          ? await this.resumeConversationSession(
              conversationId,
              model,
              flags,
              onEvent,
            ).catch((error) => {
              throw new Error(
                `Copilot session resume failed for conversation ${conversationId}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            })
          : await this.createConversationSession(
              conversationId,
              model,
              flags,
              onEvent,
            );

      if (!sawProviderThreadEvent) {
        this.emitEvent({ type: 'thread', threadId: conversationId });
      }

      await session.sendAndWait(
        { prompt: message },
        resolveCopilotSendAndWaitTimeoutMs(),
      );
    } finally {
      await session?.disconnect().catch(() => undefined);
      if (started) {
        await this.lifecycle.stop().catch(() => []);
      }
    }
  }
}
