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
  externalSignal?: AbortSignal;
}): InflightState {
  const controller = new AbortController();
  const state: InflightState = {
    inflightId: params.inflightId,
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
