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

  it('appends assistant deltas to the active assistant bubble for the matching inflight', async () => {
    const conversationId = 'flow-conversation-happy-path';

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

    const firstDelta: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'assistant_delta',
      conversationId,
      seq: 2,
      inflightId: 'i1',
      delta: 'First reply',
    };

    const secondDelta: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'assistant_delta',
      conversationId,
      seq: 3,
      inflightId: 'i1',
      delta: ' continues',
    };

    act(() => result.current.handleWsEvent(stepOneUserTurn));
    act(() => result.current.handleWsEvent(firstDelta));
    act(() => result.current.handleWsEvent(secondDelta));

    await waitFor(() => {
      const assistantMessages = result.current.messages.filter(
        (message) => message.role === 'assistant',
      );
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.content).toBe('First reply continues');
    });
  });

  it('ignores a stale older-inflight user_turn after a newer inflight is active', async () => {
    const conversationId = 'flow-conversation-user-turn-stale';

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

    const staleStepOneUserTurnReplay: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'user_turn',
      conversationId,
      seq: 4,
      inflightId: 'i1',
      content: 'Step 1 prompt',
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    const stepTwoAssistantDelta: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'assistant_delta',
      conversationId,
      seq: 5,
      inflightId: 'i2',
      delta: 'Second reply',
    };

    act(() => result.current.handleWsEvent(stepOneUserTurn));
    act(() => result.current.handleWsEvent(stepOneAssistantDelta));
    act(() => result.current.handleWsEvent(stepTwoUserTurn));

    await waitFor(() => {
      const assistantMessages = result.current.messages.filter(
        (message) => message.role === 'assistant',
      );
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[1]?.content).toBe('');
    });

    act(() => result.current.handleWsEvent(staleStepOneUserTurnReplay));
    act(() => result.current.handleWsEvent(stepTwoAssistantDelta));

    await waitFor(() => {
      const assistantMessages = result.current.messages.filter(
        (message) => message.role === 'assistant',
      );
      const userMessages = result.current.messages.filter(
        (message) => message.role === 'user',
      );
      expect(userMessages).toHaveLength(2);
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[1]?.content).toBe('Second reply');
    });
  });

  it('treats a same-inflight user_turn replay as a no-op for active assistant targeting', async () => {
    const conversationId = 'flow-conversation-user-turn-same-inflight';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    const userTurn: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'user_turn',
      conversationId,
      seq: 1,
      inflightId: 'i1',
      content: 'Step 1 prompt',
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    const assistantDelta: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'assistant_delta',
      conversationId,
      seq: 2,
      inflightId: 'i1',
      delta: 'First reply',
    };

    const replayedUserTurn: ChatWsTranscriptEvent = {
      ...userTurn,
      seq: 3,
    };

    act(() => result.current.handleWsEvent(userTurn));
    act(() => result.current.handleWsEvent(assistantDelta));

    await waitFor(() => {
      const assistantMessages = result.current.messages.filter(
        (message) => message.role === 'assistant',
      );
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.content).toBe('First reply');
    });

    const assistantMessageIdsBeforeReplay = result.current.messages
      .filter((message) => message.role === 'assistant')
      .map((message) => message.id);

    act(() => result.current.handleWsEvent(replayedUserTurn));

    await waitFor(() => {
      const assistantMessages = result.current.messages.filter(
        (message) => message.role === 'assistant',
      );
      const userMessages = result.current.messages.filter(
        (message) => message.role === 'user',
      );
      expect(userMessages).toHaveLength(1);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages.map((message) => message.id)).toEqual(
        assistantMessageIdsBeforeReplay,
      );
    });
  });
});
