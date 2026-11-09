import type { StoredTurn } from '../hooks/useConversationTurns';
import buildStoredTurnHydrationKey from '../utils/buildStoredTurnHydrationKey';

const turn: StoredTurn = {
  turnId: 't1',
  conversationId: 'c1',
  role: 'assistant',
  content: 'unchanged',
  model: 'm1',
  provider: 'codex',
  status: 'ok',
  createdAt: '2026-11-01T10:00:00.000Z',
};

it('changes the hydration key for first-update-only and last-update-only changes', () => {
  const legacy = buildStoredTurnHydrationKey('c1', [turn]);
  const first = { ...turn, firstUpdateAt: '2026-11-01T10:00:01.000Z' };
  expect(buildStoredTurnHydrationKey('c1', [first])).not.toBe(legacy);
  expect(
    buildStoredTurnHydrationKey('c1', [
      { ...first, lastUpdateAt: '2026-11-01T10:00:02.000Z' },
    ]),
  ).not.toBe(buildStoredTurnHydrationKey('c1', [first]));
  expect(buildStoredTurnHydrationKey('c1', [{ ...turn }])).toBe(legacy);
});

it('changes the hydration key when only persisted inflight identity is added or changed', () => {
  const user: StoredTurn = { ...turn, role: 'user' };
  const identified: StoredTurn = {
    ...user,
    runtime: { replay: { inflightId: 'i1' } },
  };
  expect(buildStoredTurnHydrationKey('c1', [identified])).not.toBe(
    buildStoredTurnHydrationKey('c1', [user]),
  );
  expect(
    buildStoredTurnHydrationKey('c1', [
      { ...identified, runtime: { replay: { inflightId: 'i2' } } },
    ]),
  ).not.toBe(buildStoredTurnHydrationKey('c1', [identified]));
  expect(
    buildStoredTurnHydrationKey('c1', [{ ...user, runtime: { replay: {} } }]),
  ).toBe(buildStoredTurnHydrationKey('c1', [user]));
});
