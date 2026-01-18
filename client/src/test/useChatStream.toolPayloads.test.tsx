import { jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import useChatStream, { type ChatMessage } from '../hooks/useChatStream';
import type { ChatWsTranscriptEvent } from '../hooks/useChatWs';

function Wrapper({
  conversationId,
  events,
  onUpdate,
}: {
  conversationId: string;
  events: ChatWsTranscriptEvent[];
  onUpdate: (messages: ChatMessage[]) => void;
}) {
  const { messages, setConversation, handleWsEvent } = useChatStream(
    'm1',
    'lmstudio',
  );

  useEffect(() => {
    setConversation(conversationId, { clearMessages: true });
  }, [conversationId, setConversation]);

  useEffect(() => {
    onUpdate(messages);
  }, [messages, onUpdate]);

  useEffect(() => {
    events.forEach((event) => handleWsEvent(event));
  }, [events, handleWsEvent]);

  return null;
}

describe('useChatStream tool payload handling (WS transcript events)', () => {
  it('stores parameters and payload for tool results', async () => {
    const onUpdate = jest.fn();

    const conversationId = 'c1';
    const events: ChatWsTranscriptEvent[] = [
      {
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 1,
        inflight: {
          inflightId: 'i1',
          assistantText: '',
          assistantThink: '',
          toolEvents: [],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      },
      {
        protocolVersion: 'v1',
        type: 'tool_event',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        event: {
          type: 'tool-request',
          callId: 't1',
          name: 'VectorSearch',
          parameters: { query: 'hi', limit: 5 },
        },
      },
      {
        protocolVersion: 'v1',
        type: 'tool_event',
        conversationId,
        seq: 3,
        inflightId: 'i1',
        event: {
          type: 'tool-result',
          callId: 't1',
          name: 'VectorSearch',
          stage: 'success',
          parameters: { query: 'hi', limit: 5 },
          result: {
            files: [
              { hostPath: '/host/file.txt', chunkCount: 1, highestMatch: 0.9 },
            ],
            results: [
              {
                repo: 'repo',
                relPath: 'file.txt',
                hostPath: '/host/file.txt',
                chunk: 'sample chunk',
                score: 0.9,
              },
            ],
          },
        },
      },
      {
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 4,
        inflightId: 'i1',
        status: 'ok',
        threadId: null,
      },
    ];

    render(
      <Wrapper
        conversationId={conversationId}
        events={events}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
      const assistant = (latest as ChatMessage[]).find(
        (msg) => msg.role === 'assistant',
      );
      expect(assistant?.tools?.length).toBe(1);
      expect(assistant?.tools?.[0].status).toBe('done');
      expect(assistant?.tools?.[0].parameters).toEqual({
        query: 'hi',
        limit: 5,
      });
      expect(assistant?.tools?.[0].payload).toBeDefined();
    });
  });

  it('stores trimmed and full errors for tool failures', async () => {
    const onUpdate = jest.fn();

    const conversationId = 'c2';
    const events: ChatWsTranscriptEvent[] = [
      {
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 1,
        inflight: {
          inflightId: 'i2',
          assistantText: '',
          assistantThink: '',
          toolEvents: [],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      },
      {
        protocolVersion: 'v1',
        type: 'tool_event',
        conversationId,
        seq: 2,
        inflightId: 'i2',
        event: {
          type: 'tool-request',
          callId: 't2',
          name: 'VectorSearch',
          parameters: { query: 'fail' },
        },
      },
      {
        protocolVersion: 'v1',
        type: 'tool_event',
        conversationId,
        seq: 3,
        inflightId: 'i2',
        event: {
          type: 'tool-result',
          callId: 't2',
          name: 'VectorSearch',
          stage: 'error',
          parameters: { query: 'fail' },
          errorTrimmed: {
            code: 'MODEL_UNAVAILABLE',
            message: 'embedding missing',
          },
          errorFull: {
            code: 'MODEL_UNAVAILABLE',
            message: 'embedding missing',
          },
        },
      },
      {
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 4,
        inflightId: 'i2',
        status: 'failed',
        threadId: null,
        error: { code: 'MODEL_UNAVAILABLE', message: 'embedding missing' },
      },
    ];

    render(
      <Wrapper
        conversationId={conversationId}
        events={events}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
      const assistant = (latest as ChatMessage[]).find(
        (msg) => msg.role === 'assistant',
      );
      expect(assistant?.tools?.length).toBe(1);
      expect(assistant?.tools?.[0].status).toBe('error');
      expect(assistant?.tools?.[0].errorTrimmed).toEqual({
        code: 'MODEL_UNAVAILABLE',
        message: 'embedding missing',
      });
      expect(assistant?.tools?.[0].errorFull).toBeDefined();
    });
  });

  it('preserves usage/timing metadata on turn_final', async () => {
    const onUpdate = jest.fn();

    const conversationId = 'c3';
    const events: ChatWsTranscriptEvent[] = [
      {
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 1,
        inflight: {
          inflightId: 'i3',
          assistantText: 'Hello',
          assistantThink: '',
          toolEvents: [],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      },
      {
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 2,
        inflightId: 'i3',
        status: 'ok',
        threadId: null,
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        timing: { totalTimeSec: 0.7, tokensPerSecond: 11.5 },
      },
    ];

    render(
      <Wrapper
        conversationId={conversationId}
        events={events}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
      const assistant = (latest as ChatMessage[]).find(
        (msg) => msg.role === 'assistant',
      );
      expect(assistant?.usage).toEqual({
        inputTokens: 5,
        outputTokens: 3,
        totalTokens: 8,
      });
      expect(assistant?.timing).toEqual({
        totalTimeSec: 0.7,
        tokensPerSecond: 11.5,
      });
    });
  });

  it('omits usage/timing metadata when missing', async () => {
    const onUpdate = jest.fn();

    const conversationId = 'c4';
    const events: ChatWsTranscriptEvent[] = [
      {
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 1,
        inflight: {
          inflightId: 'i4',
          assistantText: 'Hello',
          assistantThink: '',
          toolEvents: [],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      },
      {
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 2,
        inflightId: 'i4',
        status: 'ok',
        threadId: null,
      },
    ];

    render(
      <Wrapper
        conversationId={conversationId}
        events={events}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
      const assistant = (latest as ChatMessage[]).find(
        (msg) => msg.role === 'assistant',
      );
      expect(assistant?.usage).toBeUndefined();
      expect(assistant?.timing).toBeUndefined();
    });
  });

  it('uses inflight startedAt timestamp for assistant', async () => {
    const onUpdate = jest.fn();

    const conversationId = 'c5';
    const startedAt = '2025-02-01T10:00:00.000Z';
    const events: ChatWsTranscriptEvent[] = [
      {
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 1,
        inflight: {
          inflightId: 'i5',
          assistantText: 'Hello',
          assistantThink: '',
          toolEvents: [],
          startedAt,
        },
      },
    ];

    render(
      <Wrapper
        conversationId={conversationId}
        events={events}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
      const assistant = (latest as ChatMessage[]).find(
        (msg) => msg.role === 'assistant',
      );
      expect(assistant?.createdAt).toBe(startedAt);
    });
  });

  it('preserves inflight command metadata from snapshot', async () => {
    const onUpdate = jest.fn();

    const conversationId = 'c6';
    const events: ChatWsTranscriptEvent[] = [
      {
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 1,
        inflight: {
          inflightId: 'i6',
          assistantText: 'Hello',
          assistantThink: '',
          toolEvents: [],
          startedAt: '2025-01-01T00:00:00.000Z',
          command: {
            name: 'flow',
            stepIndex: 2,
            totalSteps: 4,
            loopDepth: 1,
            label: 'Draft outline',
            agentType: 'planning_agent',
            identifier: 'main',
          },
        },
      },
    ];

    render(
      <Wrapper
        conversationId={conversationId}
        events={events}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
      const assistant = (latest as ChatMessage[]).find(
        (msg) => msg.role === 'assistant',
      );
      expect(assistant?.command).toEqual({
        name: 'flow',
        stepIndex: 2,
        totalSteps: 4,
        loopDepth: 1,
        label: 'Draft outline',
        agentType: 'planning_agent',
        identifier: 'main',
      });
    });
  });

  it('omits inflight command metadata when missing', async () => {
    const onUpdate = jest.fn();

    const conversationId = 'c7';
    const events: ChatWsTranscriptEvent[] = [
      {
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 1,
        inflight: {
          inflightId: 'i7',
          assistantText: 'Hello',
          assistantThink: '',
          toolEvents: [],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      },
    ];

    render(
      <Wrapper
        conversationId={conversationId}
        events={events}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      const latest = onUpdate.mock.calls.at(-1)?.[0] ?? [];
      const assistant = (latest as ChatMessage[]).find(
        (msg) => msg.role === 'assistant',
      );
      expect(assistant?.command).toBeUndefined();
    });
  });
});
