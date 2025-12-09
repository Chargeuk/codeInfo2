import { SYSTEM_CONTEXT } from '@codeinfo2/common';
import { Codex } from '@openai/codex-sdk';
import type {
  ThreadOptions as CodexThreadOptions,
  TurnOptions as CodexTurnOptions,
} from '@openai/codex-sdk';
import mongoose from 'mongoose';
import { buildCodexOptions } from '../../config/codexConfig.js';
import { baseLogger } from '../../logger.js';
import { updateConversationMeta } from '../../mongo/repo.js';
import { getCodexDetection } from '../../providers/codexRegistry.js';
import { ChatInterface, type ChatToolResultEvent } from './ChatInterface.js';

type CodexRunFlags = {
  threadId?: string | null;
  codexFlags?: Partial<CodexThreadOptions>;
  requestId?: string;
  signal?: AbortSignal;
};

type CodexToolCallItem = {
  type?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  status?: string;
  result?: { content?: unknown; error?: unknown };
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

  async run(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ): Promise<void> {
    const { threadId, codexFlags, requestId, signal } = (flags ??
      {}) as CodexRunFlags;
    const detection = getCodexDetection();
    if (!detection.available) {
      const msg = detection.reason ?? 'codex unavailable';
      this.emitEvent({ type: 'error', message: msg });
      return;
    }

    const now = new Date();
    let assistantContent = '';
    let assistantStatus: 'ok' | 'failed' | 'stopped' = 'ok';
    const toolCallsForTurn: ChatToolResultEvent[] = [];
    let activeThreadId: string | null = threadId ?? null;

    const codexWorkingDirectory =
      process.env.CODEX_WORKDIR ??
      process.env.CODEINFO_CODEX_WORKDIR ??
      '/data';

    const threadOptions: CodexThreadOptions = {
      model,
      workingDirectory: codexWorkingDirectory,
      skipGitRepoCheck: true,
      sandboxMode: codexFlags?.sandboxMode ?? 'workspace-write',
      networkAccessEnabled: codexFlags?.networkAccessEnabled ?? true,
      webSearchEnabled: codexFlags?.webSearchEnabled ?? true,
      approvalPolicy: codexFlags?.approvalPolicy ?? 'on-failure',
      modelReasoningEffort: codexFlags?.modelReasoningEffort ?? 'high',
    };

    const codex = this.codexFactory();
    const priorTurns =
      mongoose.connection.readyState === 1
        ? await this.loadHistory(conversationId)
        : [];
    const promptHistory = [
      ...priorTurns.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user', content: message },
    ];

    const systemContext = SYSTEM_CONTEXT.trim();
    const userText = promptHistory
      .filter((entry) => entry.role === 'user')
      .map((entry) => entry.content)
      .join('\n\n');

    const prompt =
      !threadId && systemContext
        ? `Context:\n${systemContext}\n\nUser:\n${userText}`
        : userText;

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
      await updateConversationMeta({
        conversationId,
        flags: { threadId: incoming },
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
      toolCallsForTurn.push(resultEvent);
      this.emitEvent(resultEvent);
    };

    let finalText = '';
    let reasoningText = '';

    try {
      for await (const rawEvent of events as AsyncGenerator<unknown>) {
        const event = rawEvent as Record<string, unknown>;
        if (signal?.aborted) {
          assistantStatus = 'stopped';
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
              const text = (item as { text?: string }).text ?? '';
              const delta = text.slice(reasoningText.length);
              if (delta) {
                this.emitEvent({ type: 'analysis', content: delta });
                reasoningText = text;
              }
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
              assistantContent += delta;
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
            assistantStatus = 'failed';
            this.emitEvent({
              type: 'error',
              message: message ?? 'codex turn failed',
            });
            break;
          }
          case 'error': {
            assistantStatus = 'failed';
            this.emitEvent({
              type: 'error',
              message:
                (event as { message?: string })?.message ?? 'codex error',
            });
            break;
          }
          case 'turn.completed':
            await emitThreadId(activeThreadId);
            this.emitEvent({ type: 'complete', threadId: activeThreadId });
            break;
          default:
            break;
        }
      }
    } catch (err) {
      const messageText =
        (err as Error | undefined)?.message ?? 'codex unavailable';
      assistantStatus = signal?.aborted ? 'stopped' : 'failed';
      this.emitEvent({ type: 'error', message: messageText });
    } finally {
      if (assistantContent === '' && assistantStatus === 'stopped') {
        // explicit stopped bubble
        assistantStatus = 'stopped';
      }
      if (mongoose.connection.readyState === 1) {
        const toolCallsPayload =
          toolCallsForTurn.length > 0 ? { calls: toolCallsForTurn } : null;
        await this.persistTurn({
          conversationId,
          role: 'assistant',
          content: assistantContent,
          model,
          provider: 'codex',
          toolCalls: toolCallsPayload,
          status: assistantStatus,
          createdAt: now,
        }).catch((err) =>
          baseLogger.error(
            { err, conversationId },
            'failed to persist codex turn',
          ),
        );
      } else {
        baseLogger.info(
          { conversationId },
          'skipping codex persistTurn (mongo not connected)',
        );
      }
    }
  }
}
