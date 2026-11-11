import type { StoredTurn } from '../hooks/useConversationTurns';
import { mapFlowTurnsToMessages } from '../pages/flowTranscriptHistory';

const turn: StoredTurn = {
  conversationId: 'flow-history',
  turnId: 'saved-assistant',
  role: 'assistant',
  content: 'Saved response',
  model: 'saved-model',
  provider: 'codex',
  status: 'warning',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('mapFlowTurnsToMessages', () => {
  it('copies server receipt times without replacing creation time or transcript metadata', () => {
    const command = { name: 'flow', stepIndex: 1, totalSteps: 2 };
    const usage = { inputTokens: 11, outputTokens: 7 };
    const timing = { totalTimeSec: 2 };
    const firstUpdateAt = '2026-01-01T00:00:01.000Z';
    const lastUpdateAt = '2026-01-01T00:00:03.000Z';

    expect(
      mapFlowTurnsToMessages([
        { ...turn, command, usage, timing, firstUpdateAt, lastUpdateAt },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: 'turn-saved-assistant',
        role: 'assistant',
        content: turn.content,
        createdAt: turn.createdAt,
        firstUpdateAt,
        lastUpdateAt,
        streamStatus: 'warning',
        command,
        usage,
        timing,
      }),
    ]);
  });

  it.each(['user', 'assistant', 'system'] as const)(
    'keeps optional receipt times absent for legacy %s turns',
    (role) => {
      const [message] = mapFlowTurnsToMessages([{ ...turn, role }]);
      expect(message.createdAt).toBe(turn.createdAt);
      expect(message.firstUpdateAt).toBeUndefined();
      expect(message.lastUpdateAt).toBeUndefined();
      expect(message.role).toBe(role === 'system' ? 'assistant' : role);
    },
  );

  it('keeps a single available receipt time without inventing the other', () => {
    const [message] = mapFlowTurnsToMessages([
      { ...turn, lastUpdateAt: '2026-01-01T00:00:03.000Z' },
    ]);
    expect(message.firstUpdateAt).toBeUndefined();
    expect(message.lastUpdateAt).toBe('2026-01-01T00:00:03.000Z');
  });
});
