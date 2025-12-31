export type ToolEvent =
  | {
      type: 'tool-request';
      callId: string | number;
      name: string;
      stage?: string;
      parameters?: unknown;
    }
  | {
      type: 'tool-result';
      callId: string | number;
      name: string;
      stage?: string;
      parameters?: unknown;
      result?: unknown;
      errorTrimmed?: { code?: string; message?: string } | null;
      errorFull?: unknown;
    };

export type InflightState = {
  inflightId: string;
  provider?: string;
  model?: string;
  source?: 'REST' | 'MCP';
  userTurn?: { content: string; createdAt: string };
  assistantCreatedAt?: string;
  finalStatus?: 'ok' | 'stopped' | 'failed';
  persisted?: { user: boolean; assistant: boolean };
  persistedTurnIds?: { user?: string; assistant?: string };
  assistantText: string;
  assistantThink: string;
  toolEvents: ToolEvent[];
  startedAt: string;
  abortController: AbortController;
  seq: number;
};

const inflightByConversationId = new Map<string, InflightState>();

export function hasInflight(conversationId: string): boolean {
  return inflightByConversationId.has(conversationId);
}

export function getInflight(conversationId: string): InflightState | undefined {
  return inflightByConversationId.get(conversationId);
}

export function createInflight(params: {
  conversationId: string;
  inflightId: string;
  provider?: string;
  model?: string;
  source?: 'REST' | 'MCP';
  userTurn?: { content: string; createdAt: string };
  externalSignal?: AbortSignal;
}): InflightState {
  const controller = new AbortController();
  const state: InflightState = {
    inflightId: params.inflightId,
    provider: params.provider,
    model: params.model,
    source: params.source,
    userTurn: params.userTurn,
    assistantCreatedAt: params.userTurn?.createdAt
      ? new Date(Date.parse(params.userTurn.createdAt) + 1).toISOString()
      : undefined,
    finalStatus: undefined,
    persisted: { user: false, assistant: false },
    assistantText: '',
    assistantThink: '',
    toolEvents: [],
    startedAt: new Date().toISOString(),
    abortController: controller,
    seq: 0,
  };

  if (params.externalSignal) {
    if (params.externalSignal.aborted) {
      controller.abort();
    } else {
      params.externalSignal.addEventListener(
        'abort',
        () => controller.abort(),
        { once: true },
      );
    }
  }

  inflightByConversationId.set(params.conversationId, state);
  return state;
}

export function bumpSeq(conversationId: string): number {
  const state = inflightByConversationId.get(conversationId);
  if (!state) return 0;
  state.seq += 1;
  return state.seq;
}

export function appendAssistantDelta(params: {
  conversationId: string;
  inflightId: string;
  delta: string;
}): { ok: true; assistantText: string } | { ok: false } {
  const state = inflightByConversationId.get(params.conversationId);
  if (!state || state.inflightId !== params.inflightId) return { ok: false };
  state.assistantText += params.delta;
  return { ok: true, assistantText: state.assistantText };
}

export function setAssistantText(params: {
  conversationId: string;
  inflightId: string;
  text: string;
}): { ok: true; delta: string } | { ok: false } {
  const state = inflightByConversationId.get(params.conversationId);
  if (!state || state.inflightId !== params.inflightId) return { ok: false };
  const current = state.assistantText;
  const next = params.text;
  const delta = next.startsWith(current) ? next.slice(current.length) : next;
  state.assistantText = next;
  return { ok: true, delta };
}

export function appendAnalysisDelta(params: {
  conversationId: string;
  inflightId: string;
  delta: string;
}): { ok: true; assistantThink: string } | { ok: false } {
  const state = inflightByConversationId.get(params.conversationId);
  if (!state || state.inflightId !== params.inflightId) return { ok: false };
  state.assistantThink += params.delta;
  return { ok: true, assistantThink: state.assistantThink };
}

export function appendToolEvent(params: {
  conversationId: string;
  inflightId: string;
  event: ToolEvent;
}): { ok: true; toolEventCount: number } | { ok: false } {
  const state = inflightByConversationId.get(params.conversationId);
  if (!state || state.inflightId !== params.inflightId) return { ok: false };
  state.toolEvents.push(params.event);
  return { ok: true, toolEventCount: state.toolEvents.length };
}

export function abortInflight(params: {
  conversationId: string;
  inflightId: string;
}):
  | { ok: true; signal: AbortSignal; startedAt: string }
  | { ok: false; reason: 'INFLIGHT_NOT_FOUND' | 'INFLIGHT_MISMATCH' } {
  const state = inflightByConversationId.get(params.conversationId);
  if (!state) return { ok: false, reason: 'INFLIGHT_NOT_FOUND' };
  if (state.inflightId !== params.inflightId)
    return { ok: false, reason: 'INFLIGHT_MISMATCH' };
  state.abortController.abort();
  return {
    ok: true,
    signal: state.abortController.signal,
    startedAt: state.startedAt,
  };
}

export function cleanupInflight(params: {
  conversationId: string;
  inflightId?: string;
}) {
  const state = inflightByConversationId.get(params.conversationId);
  if (!state) return;
  if (params.inflightId && state.inflightId !== params.inflightId) return;
  inflightByConversationId.delete(params.conversationId);
}

export function setInflightUserTurn(params: {
  conversationId: string;
  inflightId: string;
  provider: string;
  model: string;
  source: 'REST' | 'MCP';
  content: string;
  createdAt: string;
}): { ok: true } | { ok: false } {
  const state = inflightByConversationId.get(params.conversationId);
  if (!state || state.inflightId !== params.inflightId) return { ok: false };
  state.provider = params.provider;
  state.model = params.model;
  state.source = params.source;
  state.userTurn = { content: params.content, createdAt: params.createdAt };
  if (!state.assistantCreatedAt) {
    state.assistantCreatedAt = new Date(
      Date.parse(params.createdAt) + 1,
    ).toISOString();
  }
  return { ok: true };
}

export function markInflightFinal(params: {
  conversationId: string;
  inflightId: string;
  status: 'ok' | 'stopped' | 'failed';
  finalizedAt?: string;
}): { ok: true } | { ok: false } {
  const state = inflightByConversationId.get(params.conversationId);
  if (!state || state.inflightId !== params.inflightId) return { ok: false };
  state.finalStatus = params.status;
  state.assistantCreatedAt = params.finalizedAt ?? new Date().toISOString();
  return { ok: true };
}

export function markInflightPersisted(params: {
  conversationId: string;
  inflightId: string;
  role: 'user' | 'assistant';
  turnId?: string;
}): { ok: true } | { ok: false } {
  const state = inflightByConversationId.get(params.conversationId);
  if (!state || state.inflightId !== params.inflightId) return { ok: false };
  if (!state.persisted) {
    state.persisted = { user: false, assistant: false };
  }
  state.persisted[params.role] = true;
  if (params.turnId) {
    if (!state.persistedTurnIds) {
      state.persistedTurnIds = {};
    }
    state.persistedTurnIds[params.role] = params.turnId;
  }
  return { ok: true };
}

export function isInflightFinalized(conversationId: string): boolean {
  const state = inflightByConversationId.get(conversationId);
  return Boolean(state?.finalStatus);
}

export type InflightMergedTurn = {
  turnId?: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  model: string;
  provider: string;
  source: 'REST' | 'MCP';
  toolCalls: Record<string, unknown> | null;
  status: 'ok' | 'stopped' | 'failed';
  createdAt: Date;
};

export function snapshotInflightTurns(
  conversationId: string,
): InflightMergedTurn[] {
  const state = inflightByConversationId.get(conversationId);
  if (!state) return [];
  const provider = state.provider ?? 'unknown';
  const model = state.model ?? 'unknown';
  const source = state.source ?? 'REST';

  const items: InflightMergedTurn[] = [];

  if (state.userTurn?.content?.length) {
    items.push({
      turnId: state.persistedTurnIds?.user,
      conversationId,
      role: 'user',
      content: state.userTurn.content,
      model,
      provider,
      source,
      toolCalls: null,
      status: 'ok',
      createdAt: new Date(state.userTurn.createdAt),
    });
  }

  const assistantContent = state.assistantText ?? '';
  const assistantHasContent = assistantContent.trim().length > 0;
  const assistantStatus = state.finalStatus ?? 'ok';
  const assistantCreatedAt =
    state.assistantCreatedAt ??
    (state.userTurn?.createdAt
      ? new Date(Date.parse(state.userTurn.createdAt) + 1).toISOString()
      : state.startedAt);

  if (assistantHasContent || state.finalStatus) {
    items.push({
      turnId: state.persistedTurnIds?.assistant,
      conversationId,
      role: 'assistant',
      content: assistantContent,
      model,
      provider,
      source,
      toolCalls: null,
      status: assistantStatus,
      createdAt: new Date(assistantCreatedAt),
    });
  }

  return items;
}

export function mergeInflightTurns<
  T extends { role: string; content: string; createdAt: Date; turnId?: string },
>(
  persisted: T[],
  inflight: InflightMergedTurn[],
  opts?: { dedupeWindowMs?: number },
): Array<T | InflightMergedTurn> {
  const windowMs = opts?.dedupeWindowMs ?? 10_000;
  const persistedWithInflight: Array<T | InflightMergedTurn> = [...persisted];

  const hasTurnIdMatch = (turnId: string) =>
    persisted.some((existing) => existing.turnId === turnId);

  const isDuplicate = (turn: InflightMergedTurn) => {
    if (turn.turnId && hasTurnIdMatch(turn.turnId)) return true;
    return persisted.some((existing) => {
      if (existing.role !== turn.role) return false;
      if (existing.content !== turn.content) return false;
      const delta = Math.abs(
        existing.createdAt.getTime() - turn.createdAt.getTime(),
      );
      return delta <= windowMs;
    });
  };

  inflight.forEach((turn) => {
    if (!isDuplicate(turn)) {
      persistedWithInflight.push(turn);
    }
  });

  return persistedWithInflight;
}

export function snapshotInflight(conversationId: string): {
  inflightId: string;
  assistantText: string;
  assistantThink: string;
  toolEvents: ToolEvent[];
  startedAt: string;
  seq: number;
} | null {
  const state = inflightByConversationId.get(conversationId);
  if (!state) return null;
  return {
    inflightId: state.inflightId,
    assistantText: state.assistantText,
    assistantThink: state.assistantThink,
    toolEvents: [...state.toolEvents],
    startedAt: state.startedAt,
    seq: state.seq,
  };
}
