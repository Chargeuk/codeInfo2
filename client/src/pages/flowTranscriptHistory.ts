import type { ChatMessage, ToolCall } from '../hooks/useChatStream';
import type { StoredTurn } from '../hooks/useConversationTurns';

const mapToolCalls = (toolCalls: unknown): ToolCall[] => {
  const calls =
    toolCalls &&
    typeof toolCalls === 'object' &&
    'calls' in (toolCalls as Record<string, unknown>) &&
    Array.isArray((toolCalls as { calls?: unknown }).calls)
      ? ((toolCalls as { calls?: unknown[] }).calls as unknown[])
      : [];

  return calls.map((call, idx) => {
    const callObj = (call ?? {}) as Record<string, unknown>;
    const callId =
      typeof callObj.callId === 'string'
        ? callObj.callId
        : typeof callObj.callId === 'number'
          ? callObj.callId.toString()
          : `call-${idx}`;
    const stage = typeof callObj.stage === 'string' ? callObj.stage : undefined;
    const error =
      callObj.error && typeof callObj.error === 'object'
        ? (callObj.error as { code?: string; message?: string })
        : undefined;

    return {
      id: callId,
      name: typeof callObj.name === 'string' ? callObj.name : undefined,
      status: stage === 'error' ? 'error' : 'done',
      payload: callObj.result,
      parameters:
        callObj.parameters && typeof callObj.parameters === 'object'
          ? callObj.parameters
          : undefined,
      stage,
      errorTrimmed: error ?? null,
    } satisfies ToolCall;
  });
};

export const mapFlowTurnsToMessages = (items: StoredTurn[]) =>
  items.map(
    (turn) =>
      ({
        id:
          typeof turn.turnId === 'string' && turn.turnId.trim().length > 0
            ? `turn-${turn.turnId}`
            : `${turn.createdAt}-${turn.role}-${turn.provider}`,
        role: turn.role === 'system' ? 'assistant' : turn.role,
        content: turn.content,
        model: turn.model,
        tools: mapToolCalls(turn.toolCalls ?? null),
        streamStatus:
          turn.status === 'failed'
            ? 'failed'
            : turn.status === 'warning'
              ? 'warning'
              : turn.status === 'stopped'
                ? 'stopped'
                : 'complete',
        command: turn.command,
        usage: turn.usage,
        timing: turn.timing,
        createdAt: turn.createdAt,
      }) satisfies ChatMessage,
  );
