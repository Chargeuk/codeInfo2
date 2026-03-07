import { act, renderHook, waitFor } from '@testing-library/react';
import useChatStream from '../hooks/useChatStream';
import type { ChatWsTranscriptEvent } from '../hooks/useChatWs';

describe('useChatStream inflight mismatch handling', () => {
  it('keeps the previous assistant bubble content when a stale delta arrives after the next Flow-style user_turn', async () => {
    const conversationId = 'flow-conversation';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    const stepOneUserTurn: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'user_turn',
      conversationId,
      seq: 1,
      inflightId: 'i1',
      content: 'Step 1 prompt',
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    const stepOneAssistantDelta: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'assistant_delta',
      conversationId,
      seq: 2,
      inflightId: 'i1',
      delta: 'First reply',
    };

    const stepTwoUserTurn: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'user_turn',
      conversationId,
      seq: 3,
      inflightId: 'i2',
      content: 'Step 2 prompt',
      createdAt: '2025-01-01T00:00:10.000Z',
    };

    const staleStepOneDelta: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'assistant_delta',
      conversationId,
      seq: 4,
      inflightId: 'i1',
      delta: ' late tail',
    };

    act(() => result.current.handleWsEvent(stepOneUserTurn));
    act(() => result.current.handleWsEvent(stepOneAssistantDelta));

    await waitFor(() => {
      const assistantMessages = result.current.messages.filter(
        (message) => message.role === 'assistant',
      );
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.content).toBe('First reply');
    });

    act(() => result.current.handleWsEvent(stepTwoUserTurn));

    await waitFor(() => {
      const assistantMessages = result.current.messages.filter(
        (message) => message.role === 'assistant',
      );
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[1]?.content).toBe('');
    });

    act(() => result.current.handleWsEvent(staleStepOneDelta));

    await waitFor(() => {
      const assistantMessages = result.current.messages.filter(
        (message) => message.role === 'assistant',
      );
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[1]?.content).toBe('');
    });
  });
});
