import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import useChatStream from '../hooks/useChatStream';
import type { ChatWsTranscriptEvent } from '../hooks/useChatWs';

describe('useChatStream reasoning (analysis_delta)', () => {
  it('captures streamed analysis into think and turns it off on final', async () => {
    const conversationId = 'c1';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    const snapshot: ChatWsTranscriptEvent = {
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
    };

    const analysis: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'analysis_delta',
      conversationId,
      seq: 2,
      inflightId: 'i1',
      delta: 'Thinking... ',
    };

    const assistantDelta: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'assistant_delta',
      conversationId,
      seq: 3,
      inflightId: 'i1',
      delta: 'Answer',
    };

    const final: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'turn_final',
      conversationId,
      seq: 4,
      inflightId: 'i1',
      status: 'ok',
      threadId: 't1',
    };

    act(() => result.current.handleWsEvent(snapshot));
    act(() => result.current.handleWsEvent(analysis));

    await waitFor(() => {
      const assistant = result.current.messages.find(
        (msg) => msg.role === 'assistant',
      );
      expect(assistant?.think).toContain('Thinking');
      expect(assistant?.thinkStreaming).toBe(true);
    });

    act(() => result.current.handleWsEvent(assistantDelta));
    act(() => result.current.handleWsEvent(final));

    await waitFor(() => {
      const assistant = result.current.messages.find(
        (msg) => msg.role === 'assistant',
      );
      expect(assistant?.content).toContain('Answer');
      expect(assistant?.think).toContain('Thinking');
      expect(assistant?.thinkStreaming).toBe(false);
    });
  });
});
