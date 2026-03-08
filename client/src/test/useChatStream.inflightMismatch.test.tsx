import { act, renderHook, waitFor } from '@testing-library/react';
import useChatStream from '../hooks/useChatStream';
import type { ChatWsTranscriptEvent } from '../hooks/useChatWs';

describe('useChatStream inflight mismatch handling', () => {
  const getAssistantMessages = (
    result: ReturnType<typeof renderHook<typeof useChatStream>>['result'],
  ) =>
    result.current.messages.filter((message) => message.role === 'assistant');

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

  it('ignores a finalized older-inflight user_turn replay after a newer inflight becomes active', async () => {
    const conversationId = 'flow-conversation-user-turn-finalized-replay';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'First reply',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 3,
        inflightId: 'i1',
        status: 'completed',
        turnId: 'turn-1',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 4,
        inflightId: 'i2',
        content: 'Step 2 prompt',
        createdAt: '2025-01-01T00:00:10.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 5,
        inflightId: 'i2',
        delta: 'Second reply',
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[0]?.streamStatus).toBe('complete');
      expect(assistantMessages[0]?.segments?.[0]?.content).toBe('First reply');
      expect(assistantMessages[1]?.content).toBe('Second reply');
      expect(assistantMessages[1]?.streamStatus).toBe('processing');
      expect(assistantMessages[1]?.segments?.[0]?.content).toBe('Second reply');
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 6,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      const userMessages = result.current.messages.filter(
        (message) => message.role === 'user',
      );
      expect(userMessages).toHaveLength(2);
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[0]?.streamStatus).toBe('complete');
      expect(assistantMessages[0]?.segments?.[0]?.content).toBe('First reply');
      expect(assistantMessages[1]?.content).toBe('Second reply');
      expect(assistantMessages[1]?.streamStatus).toBe('processing');
      expect(assistantMessages[1]?.segments?.[0]?.content).toBe('Second reply');
    });
  });

  it('allows a legitimate new inflight to advance normally after the previous inflight finalizes', async () => {
    const conversationId = 'flow-conversation-user-turn-next-after-final';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'First reply',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 3,
        inflightId: 'i1',
        status: 'completed',
        turnId: 'turn-1',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 4,
        inflightId: 'i2',
        content: 'Step 2 prompt',
        createdAt: '2025-01-01T00:00:10.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 5,
        inflightId: 'i2',
        delta: 'Second reply',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 6,
        inflightId: 'i2',
        status: 'completed',
        turnId: 'turn-2',
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[0]?.streamStatus).toBe('complete');
      expect(assistantMessages[0]?.segments?.[0]?.content).toBe('First reply');
      expect(assistantMessages[1]?.content).toBe('Second reply');
      expect(assistantMessages[1]?.streamStatus).toBe('complete');
      expect(assistantMessages[1]?.segments?.[0]?.content).toBe('Second reply');
    });
  });

  it('ignores a replayed same-inflight assistant delta after turn_final', async () => {
    const conversationId = 'flow-conversation-assistant-finalized-replay';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'First reply',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 3,
        inflightId: 'i1',
        status: 'completed',
        turnId: 'turn-1',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 4,
        inflightId: 'i1',
        delta: ' late tail',
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[0]?.streamStatus).toBe('complete');
      expect(assistantMessages[0]?.segments?.[0]?.content).toBe('First reply');
    });
  });

  it('ignores a replayed same-inflight analysis delta after turn_final', async () => {
    const conversationId = 'flow-conversation-analysis-finalized-replay';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'First reply',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'analysis_delta',
        conversationId,
        seq: 3,
        inflightId: 'i1',
        delta: 'First reasoning',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 4,
        inflightId: 'i1',
        status: 'completed',
        turnId: 'turn-1',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'analysis_delta',
        conversationId,
        seq: 5,
        inflightId: 'i1',
        delta: ' late tail',
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[0]?.think).toBe('First reasoning');
      expect(assistantMessages[0]?.streamStatus).toBe('complete');
    });
  });

  it('ignores a replayed same-inflight tool event after turn_final', async () => {
    const conversationId = 'flow-conversation-tool-finalized-replay';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'tool_event',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        event: {
          type: 'tool-request',
          callId: 'call-1',
          name: 'search_repo',
          stage: 'running',
        },
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 3,
        inflightId: 'i1',
        status: 'completed',
        turnId: 'turn-1',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'tool_event',
        conversationId,
        seq: 4,
        inflightId: 'i1',
        event: {
          type: 'tool-result',
          callId: 'call-1',
          name: 'search_repo',
          stage: 'completed',
          result: { matches: 10 },
        },
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.streamStatus).toBe('complete');
      expect(assistantMessages[0]?.tools).toEqual([
        expect.objectContaining({
          id: 'call-1',
          status: 'requesting',
        }),
      ]);
    });
  });

  it('ignores a replayed same-inflight stream warning after turn_final', async () => {
    const conversationId = 'flow-conversation-warning-finalized-replay';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'stream_warning',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        message: 'First warning',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 3,
        inflightId: 'i1',
        status: 'completed',
        turnId: 'turn-1',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'stream_warning',
        conversationId,
        seq: 4,
        inflightId: 'i1',
        message: 'late replay warning',
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.warnings).toEqual(['First warning']);
      expect(assistantMessages[0]?.streamStatus).toBe('complete');
    });
  });

  it('ignores a replayed same-inflight snapshot after turn_final', async () => {
    const conversationId = 'flow-conversation-snapshot-same-inflight-replay';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'First reply',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'analysis_delta',
        conversationId,
        seq: 3,
        inflightId: 'i1',
        delta: 'First reasoning',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'tool_event',
        conversationId,
        seq: 4,
        inflightId: 'i1',
        event: {
          type: 'tool-request',
          callId: 'call-1',
          name: 'search_repo',
          stage: 'running',
        },
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 5,
        inflightId: 'i1',
        status: 'completed',
        turnId: 'turn-1',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 6,
        inflight: {
          inflightId: 'i1',
          assistantText: 'overwrite',
          assistantThink: 'overwrite',
          toolEvents: [
            {
              type: 'tool-result',
              callId: 'call-1',
              name: 'search_repo',
              stage: 'completed',
              result: { matches: 99 },
            },
          ],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[0]?.think).toBe('First reasoning');
      expect(assistantMessages[0]?.streamStatus).toBe('complete');
      expect(assistantMessages[0]?.tools).toEqual([
        expect.objectContaining({
          id: 'call-1',
          status: 'requesting',
        }),
      ]);
    });
  });

  it('ignores a duplicate same-inflight turn_final replay after finalization', async () => {
    const conversationId = 'flow-conversation-turn-final-replay';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'First reply',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 3,
        inflightId: 'i1',
        status: 'completed',
        turnId: 'turn-1',
        usage: { outputTokens: 1 },
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 4,
        inflightId: 'i1',
        status: 'failed',
        turnId: 'turn-1-replay',
        usage: { outputTokens: 99 },
        error: { message: 'should be ignored' },
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[0]?.streamStatus).toBe('complete');
      expect(assistantMessages[0]?.usage).toEqual(
        expect.objectContaining({ outputTokens: 1 }),
      );
      expect(assistantMessages[0]?.kind).toBeUndefined();
    });
  });

  it('applies analysis deltas to the active inflight reasoning state', async () => {
    const conversationId = 'flow-conversation-analysis-happy-path';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'analysis_delta',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'First reasoning',
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.think).toBe('First reasoning');
    });
  });

  it('ignores stale analysis deltas for an older inflight', async () => {
    const conversationId = 'flow-conversation-analysis-stale';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'analysis_delta',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'First reasoning',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 3,
        inflightId: 'i2',
        content: 'Step 2 prompt',
        createdAt: '2025-01-01T00:00:10.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'analysis_delta',
        conversationId,
        seq: 4,
        inflightId: 'i2',
        delta: 'Second reasoning',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'analysis_delta',
        conversationId,
        seq: 5,
        inflightId: 'i1',
        delta: ' late tail',
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.think).toBe('First reasoning');
      expect(assistantMessages[1]?.think).toBe('Second reasoning');
    });
  });

  it('applies tool events to the active inflight tool state', async () => {
    const conversationId = 'flow-conversation-tool-happy-path';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'tool_event',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        event: {
          type: 'tool-request',
          callId: 'call-1',
          name: 'search_repo',
          stage: 'running',
          parameters: { query: 'bubble text' },
        },
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.tools).toEqual([
        expect.objectContaining({
          id: 'call-1',
          name: 'search_repo',
          status: 'requesting',
          parameters: { query: 'bubble text' },
        }),
      ]);
    });
  });

  it('ignores stale tool events for an older inflight', async () => {
    const conversationId = 'flow-conversation-tool-stale';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'tool_event',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        event: {
          type: 'tool-request',
          callId: 'call-1',
          name: 'search_repo',
          stage: 'running',
        },
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 3,
        inflightId: 'i2',
        content: 'Step 2 prompt',
        createdAt: '2025-01-01T00:00:10.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'tool_event',
        conversationId,
        seq: 4,
        inflightId: 'i2',
        event: {
          type: 'tool-request',
          callId: 'call-2',
          name: 'open_file',
          stage: 'running',
        },
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'tool_event',
        conversationId,
        seq: 5,
        inflightId: 'i1',
        event: {
          type: 'tool-result',
          callId: 'call-1',
          name: 'search_repo',
          stage: 'completed',
          result: { matches: 10 },
        },
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.tools).toEqual([
        expect.objectContaining({
          id: 'call-1',
          status: 'requesting',
        }),
      ]);
      expect(assistantMessages[1]?.tools).toEqual([
        expect.objectContaining({
          id: 'call-2',
          status: 'requesting',
        }),
      ]);
    });
  });

  it('applies stream warnings to the active inflight warning list', async () => {
    const conversationId = 'flow-conversation-warning-happy-path';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'stream_warning',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        message: 'Transient reconnect',
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.warnings).toEqual(['Transient reconnect']);
    });
  });

  it('ignores stale stream warnings for an older inflight', async () => {
    const conversationId = 'flow-conversation-warning-stale';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'stream_warning',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        message: 'First inflight warning',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 3,
        inflightId: 'i2',
        content: 'Step 2 prompt',
        createdAt: '2025-01-01T00:00:10.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'stream_warning',
        conversationId,
        seq: 4,
        inflightId: 'i2',
        message: 'Second inflight warning',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'stream_warning',
        conversationId,
        seq: 5,
        inflightId: 'i1',
        message: 'stale older warning',
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.warnings).toEqual([
        'First inflight warning',
      ]);
      expect(assistantMessages[1]?.warnings).toEqual([
        'Second inflight warning',
      ]);
    });
  });

  it('dedupes duplicate stream warnings for the same inflight', async () => {
    const conversationId = 'flow-conversation-warning-dedupe';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );

    const warningEvent: ChatWsTranscriptEvent = {
      protocolVersion: 'v1',
      type: 'stream_warning',
      conversationId,
      seq: 2,
      inflightId: 'i1',
      message: 'Transient reconnect',
    };

    act(() => result.current.handleWsEvent(warningEvent));
    act(() =>
      result.current.handleWsEvent({
        ...warningEvent,
        seq: 3,
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.warnings).toEqual(['Transient reconnect']);
    });
  });

  it('hydrates the active inflight from inflight snapshots', async () => {
    const conversationId = 'flow-conversation-snapshot-happy-path';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 2,
        inflight: {
          inflightId: 'i1',
          assistantText: 'Hydrated reply',
          assistantThink: 'Hydrated reasoning',
          toolEvents: [
            {
              type: 'tool-request',
              callId: 'call-1',
              name: 'search_repo',
              stage: 'running',
            },
          ],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]).toEqual(
        expect.objectContaining({
          content: 'Hydrated reply',
          think: 'Hydrated reasoning',
          tools: [
            expect.objectContaining({
              id: 'call-1',
              status: 'requesting',
            }),
          ],
          streamStatus: 'processing',
          createdAt: '2025-01-01T00:00:00.000Z',
        }),
      );
    });
  });

  it('ignores stale inflight snapshots for an older inflight', async () => {
    const conversationId = 'flow-conversation-snapshot-stale';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'First reply',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 3,
        inflightId: 'i2',
        content: 'Step 2 prompt',
        createdAt: '2025-01-01T00:00:10.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 4,
        inflightId: 'i2',
        delta: 'Second reply',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 5,
        inflight: {
          inflightId: 'i1',
          assistantText: 'stale overwrite',
          assistantThink: 'stale overwrite',
          toolEvents: [],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[1]?.content).toBe('Second reply');
      expect(assistantMessages[1]?.think).toBeUndefined();
    });
  });

  it('ignores a replayed inflight snapshot for a finalized older inflight after a newer inflight becomes active', async () => {
    const conversationId = 'flow-conversation-snapshot-finalized-replay';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'First reply',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 3,
        inflightId: 'i1',
        status: 'completed',
        turnId: 'turn-1',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 4,
        inflightId: 'i2',
        content: 'Step 2 prompt',
        createdAt: '2025-01-01T00:00:10.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 5,
        inflightId: 'i2',
        delta: 'Second reply',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 6,
        inflight: {
          inflightId: 'i1',
          assistantText: 'stale overwrite',
          assistantThink: 'stale overwrite',
          toolEvents: [],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[0]?.streamStatus).toBe('complete');
      expect(assistantMessages[1]?.content).toBe('Second reply');
      expect(assistantMessages[1]?.streamStatus).toBe('processing');
      expect(assistantMessages[1]?.think).toBeUndefined();
    });
  });

  it('hydrates the current inflight snapshot normally after the previous inflight finalized', async () => {
    const conversationId = 'flow-conversation-snapshot-current-after-final';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'First reply',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId,
        seq: 3,
        inflightId: 'i1',
        status: 'completed',
        turnId: 'turn-1',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 4,
        inflightId: 'i2',
        content: 'Step 2 prompt',
        createdAt: '2025-01-01T00:00:10.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 5,
        inflight: {
          inflightId: 'i2',
          assistantText: 'Second reply',
          assistantThink: 'Second reasoning',
          toolEvents: [
            {
              type: 'tool-request',
              callId: 'call-2',
              name: 'open_file',
              stage: 'running',
            },
          ],
          startedAt: '2025-01-01T00:00:10.000Z',
        },
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]?.content).toBe('First reply');
      expect(assistantMessages[0]?.streamStatus).toBe('complete');
      expect(assistantMessages[1]).toEqual(
        expect.objectContaining({
          content: 'Second reply',
          think: 'Second reasoning',
          streamStatus: 'processing',
          tools: [
            expect.objectContaining({
              id: 'call-2',
              status: 'requesting',
            }),
          ],
        }),
      );
    });
  });

  it('does not create a duplicate assistant bubble when hydrating the same inflight snapshot twice', async () => {
    const conversationId = 'flow-conversation-snapshot-dedupe';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );

    act(() =>
      result.current.hydrateInflightSnapshot(conversationId, {
        inflightId: 'i1',
        assistantText: 'Hydrated reply',
        assistantThink: 'Hydrated reasoning',
        toolEvents: [],
        startedAt: '2025-01-01T00:00:00.000Z',
        seq: 5,
      }),
    );

    act(() =>
      result.current.hydrateInflightSnapshot(conversationId, {
        inflightId: 'i1',
        assistantText: 'Hydrated reply',
        assistantThink: 'Hydrated reasoning',
        toolEvents: [],
        startedAt: '2025-01-01T00:00:00.000Z',
        seq: 5,
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]).toEqual(
        expect.objectContaining({
          content: 'Hydrated reply',
          think: 'Hydrated reasoning',
          streamStatus: 'processing',
        }),
      );
    });
  });

  it('preserves the active inflight assistant mapping during same-conversation history hydration', async () => {
    const conversationId = 'flow-conversation-history-active-refresh';

    const { result } = renderHook(() => useChatStream('m1', 'codex'));

    act(() => {
      result.current.setConversation(conversationId, { clearMessages: true });
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        conversationId,
        seq: 1,
        inflightId: 'i1',
        content: 'Step 1 prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'First reply',
      }),
    );

    act(() => {
      result.current.hydrateHistory(
        conversationId,
        result.current.messages.map((message) => ({ ...message })),
        'replace',
      );
    });

    act(() =>
      result.current.handleWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId,
        seq: 3,
        inflightId: 'i1',
        delta: ' continues',
      }),
    );

    await waitFor(() => {
      const assistantMessages = getAssistantMessages(result);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.content).toBe('First reply continues');
      expect(assistantMessages[0]?.streamStatus).toBe('processing');
    });
  });
});
