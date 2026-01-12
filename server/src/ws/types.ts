import type { ToolEvent } from '../chat/inflightRegistry.js';
import type { IngestJobStatus } from '../ingest/ingestJob.js';
import type {
  TurnCommandMetadata,
  TurnTimingMetadata,
  TurnUsageMetadata,
} from '../mongo/turn.js';

export const WS_PROTOCOL_VERSION = 'v1' as const;

export type WsProtocolVersion = typeof WS_PROTOCOL_VERSION;

export type WsClientBase = {
  protocolVersion: WsProtocolVersion;
  requestId: string;
};

export type WsClientSubscribeSidebar = WsClientBase & {
  type: 'subscribe_sidebar';
};

export type WsClientUnsubscribeSidebar = WsClientBase & {
  type: 'unsubscribe_sidebar';
};

export type WsClientSubscribeIngest = WsClientBase & {
  type: 'subscribe_ingest';
};

export type WsClientUnsubscribeIngest = WsClientBase & {
  type: 'unsubscribe_ingest';
};

export type WsClientSubscribeConversation = WsClientBase & {
  type: 'subscribe_conversation';
  conversationId: string;
};

export type WsClientUnsubscribeConversation = WsClientBase & {
  type: 'unsubscribe_conversation';
  conversationId: string;
};

export type WsClientCancelInflight = WsClientBase & {
  type: 'cancel_inflight';
  conversationId: string;
  inflightId: string;
};

export type WsClientKnownMessage =
  | WsClientSubscribeSidebar
  | WsClientUnsubscribeSidebar
  | WsClientSubscribeIngest
  | WsClientUnsubscribeIngest
  | WsClientSubscribeConversation
  | WsClientUnsubscribeConversation
  | WsClientCancelInflight;

export type WsClientUnknownMessage = WsClientBase & {
  type: 'unknown';
  unknownType: string;
};

export type WsClientMessage = WsClientKnownMessage | WsClientUnknownMessage;

export type WsParseErrorCode =
  | 'MALFORMED_JSON'
  | 'INVALID_PROTOCOL'
  | 'VALIDATION_FAILED';

export type WsParseResult =
  | { ok: true; message: WsClientMessage }
  | { ok: false; code: WsParseErrorCode; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseClientMessage(payload: unknown): WsParseResult {
  if (!nonEmptyString(payload)) {
    return {
      ok: false,
      code: 'VALIDATION_FAILED',
      message: 'WebSocket message payload must be a JSON string.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return {
      ok: false,
      code: 'MALFORMED_JSON',
      message: 'Malformed JSON.',
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      code: 'VALIDATION_FAILED',
      message: 'Message must be a JSON object.',
    };
  }

  const protocolVersion = parsed.protocolVersion;
  if (protocolVersion !== WS_PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'INVALID_PROTOCOL',
      message: 'Invalid or missing protocolVersion.',
    };
  }

  if (!nonEmptyString(parsed.requestId)) {
    return {
      ok: false,
      code: 'VALIDATION_FAILED',
      message: 'Invalid or missing requestId.',
    };
  }

  if (!nonEmptyString(parsed.type)) {
    return {
      ok: false,
      code: 'VALIDATION_FAILED',
      message: 'Invalid or missing type.',
    };
  }

  const base = {
    protocolVersion: WS_PROTOCOL_VERSION,
    requestId: parsed.requestId,
  } as const;

  switch (parsed.type) {
    case 'subscribe_sidebar':
      return { ok: true, message: { ...base, type: 'subscribe_sidebar' } };

    case 'unsubscribe_sidebar':
      return { ok: true, message: { ...base, type: 'unsubscribe_sidebar' } };

    case 'subscribe_ingest':
      return { ok: true, message: { ...base, type: 'subscribe_ingest' } };

    case 'unsubscribe_ingest':
      return { ok: true, message: { ...base, type: 'unsubscribe_ingest' } };

    case 'subscribe_conversation': {
      if (!nonEmptyString(parsed.conversationId)) {
        return {
          ok: false,
          code: 'VALIDATION_FAILED',
          message: 'conversationId is required for conversation subscriptions.',
        };
      }
      return {
        ok: true,
        message: {
          ...base,
          type: 'subscribe_conversation',
          conversationId: parsed.conversationId,
        },
      };
    }

    case 'unsubscribe_conversation': {
      if (!nonEmptyString(parsed.conversationId)) {
        return {
          ok: false,
          code: 'VALIDATION_FAILED',
          message: 'conversationId is required for conversation subscriptions.',
        };
      }
      return {
        ok: true,
        message: {
          ...base,
          type: 'unsubscribe_conversation',
          conversationId: parsed.conversationId,
        },
      };
    }

    case 'cancel_inflight': {
      if (!nonEmptyString(parsed.conversationId)) {
        return {
          ok: false,
          code: 'VALIDATION_FAILED',
          message: 'conversationId is required for cancel_inflight.',
        };
      }
      if (!nonEmptyString(parsed.inflightId)) {
        return {
          ok: false,
          code: 'VALIDATION_FAILED',
          message: 'inflightId is required for cancel_inflight.',
        };
      }
      return {
        ok: true,
        message: {
          ...base,
          type: 'cancel_inflight',
          conversationId: parsed.conversationId,
          inflightId: parsed.inflightId,
        },
      };
    }

    default:
      return {
        ok: true,
        message: {
          ...base,
          type: 'unknown',
          unknownType: parsed.type,
        },
      };
  }
}

export type WsConversationSummary = {
  conversationId: string;
  title: string;
  provider: string;
  model: string;
  source: string;
  lastMessageAt: string;
  archived: boolean;
  agentName?: string;
  flags?: Record<string, unknown>;
};

export type WsSidebarConversationUpsertEvent = {
  protocolVersion: WsProtocolVersion;
  type: 'conversation_upsert';
  seq: number;
  conversation: WsConversationSummary;
};

export type WsSidebarConversationDeleteEvent = {
  protocolVersion: WsProtocolVersion;
  type: 'conversation_delete';
  seq: number;
  conversationId: string;
};

export type WsIngestSnapshotEvent = {
  protocolVersion: WsProtocolVersion;
  type: 'ingest_snapshot';
  seq: number;
  status: IngestJobStatus | null;
};

export type WsIngestUpdateEvent = {
  protocolVersion: WsProtocolVersion;
  type: 'ingest_update';
  seq: number;
  status: IngestJobStatus | null;
};

export type WsUserTurnEvent = {
  protocolVersion: WsProtocolVersion;
  type: 'user_turn';
  conversationId: string;
  seq: number;
  inflightId: string;
  content: string;
  createdAt: string;
};

export type WsInflightSnapshotEvent = {
  protocolVersion: WsProtocolVersion;
  type: 'inflight_snapshot';
  conversationId: string;
  seq: number;
  inflight: {
    inflightId: string;
    assistantText: string;
    assistantThink: string;
    toolEvents: ToolEvent[];
    startedAt: string;
    command?: TurnCommandMetadata;
  };
};

export type WsAssistantDeltaEvent = {
  protocolVersion: WsProtocolVersion;
  type: 'assistant_delta';
  conversationId: string;
  seq: number;
  inflightId: string;
  delta: string;
};

export type WsAnalysisDeltaEvent = {
  protocolVersion: WsProtocolVersion;
  type: 'analysis_delta';
  conversationId: string;
  seq: number;
  inflightId: string;
  delta: string;
};

export type WsToolEventEvent = {
  protocolVersion: WsProtocolVersion;
  type: 'tool_event';
  conversationId: string;
  seq: number;
  inflightId: string;
  event: ToolEvent;
};

export type WsStreamWarningEvent = {
  protocolVersion: WsProtocolVersion;
  type: 'stream_warning';
  conversationId: string;
  seq: number;
  inflightId: string;
  message: string;
};

export type WsTurnFinalEvent = {
  protocolVersion: WsProtocolVersion;
  type: 'turn_final';
  conversationId: string;
  seq: number;
  inflightId: string;
  status: 'ok' | 'stopped' | 'failed';
  threadId?: string | null;
  error?: { code?: string; message?: string } | null;
  usage?: TurnUsageMetadata;
  timing?: TurnTimingMetadata;
};

export type WsServerEvent =
  | WsSidebarConversationUpsertEvent
  | WsSidebarConversationDeleteEvent
  | WsIngestSnapshotEvent
  | WsIngestUpdateEvent
  | WsUserTurnEvent
  | WsInflightSnapshotEvent
  | WsAssistantDeltaEvent
  | WsAnalysisDeltaEvent
  | WsToolEventEvent
  | WsStreamWarningEvent
  | WsTurnFinalEvent;
