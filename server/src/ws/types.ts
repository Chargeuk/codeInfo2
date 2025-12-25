import { z } from 'zod';

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe_sidebar'), requestId: z.string() }),
  z.object({ type: z.literal('unsubscribe_sidebar'), requestId: z.string() }),
  z.object({
    type: z.literal('subscribe_conversation'),
    requestId: z.string(),
    conversationId: z.string().min(1),
  }),
  z.object({
    type: z.literal('unsubscribe_conversation'),
    requestId: z.string(),
    conversationId: z.string().min(1),
  }),
  z.object({
    type: z.literal('cancel_inflight'),
    requestId: z.string(),
    conversationId: z.string().min(1),
    inflightId: z.string().min(1),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ToolState = {
  id: string;
  name?: string;
  status: 'requesting' | 'done' | 'error';
  stage?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export type SidebarEvent =
  | {
      type: 'conversation_upsert';
      seq: number;
      conversation: {
        conversationId: string;
        title: string;
        provider: string;
        model: string;
        source: string;
        lastMessageAt: string;
        archived: boolean;
        agentName?: string;
      };
    }
  | { type: 'conversation_delete'; seq: number; conversationId: string };

export type TranscriptEvent =
  | {
      type: 'inflight_snapshot';
      conversationId: string;
      seq: number;
      inflight: {
        inflightId: string;
        assistantText: string;
        analysisText: string;
        tools: ToolState[];
        startedAt: string;
      };
    }
  | {
      type: 'assistant_delta';
      conversationId: string;
      seq: number;
      inflightId: string;
      delta: string;
    }
  | {
      type: 'analysis_delta';
      conversationId: string;
      seq: number;
      inflightId: string;
      delta: string;
    }
  | {
      type: 'tool_event';
      conversationId: string;
      seq: number;
      inflightId: string;
      event: unknown;
    }
  | {
      type: 'turn_final';
      conversationId: string;
      seq: number;
      inflightId: string;
      status: 'ok' | 'stopped' | 'failed';
    };

export type ServerErrorEvent = {
  type: 'error';
  requestId?: string;
  code:
    | 'invalid_json'
    | 'validation_error'
    | 'not_found'
    | 'conflict'
    | 'internal_error';
  message: string;
  details?: unknown;
};

export type ServerAckEvent = {
  type: 'ack';
  requestId: string;
};

export type ServerEvent =
  | SidebarEvent
  | TranscriptEvent
  | ServerErrorEvent
  | ServerAckEvent;
