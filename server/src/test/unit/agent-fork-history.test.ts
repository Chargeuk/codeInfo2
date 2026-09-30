import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forkHandoverAt,
  resolveForkBoundary,
  selectForkSnapshot,
  type NativeForkTurn,
} from '../../agents/forkHistory.js';
import {
  assertForkCompatible,
  copyForkTurn,
} from '../../agents/forkService.js';
import type { prepareAgentForkTarget } from '../../agents/service.js';
import type { TurnSummary } from '../../mongo/repo.js';

const turn = (
  id: string,
  role: TurnSummary['role'],
  content = 'Repeated prompt',
): TurnSummary => ({
  turnId: id,
  conversationId: 'source',
  role,
  content,
  provider: 'codex',
  model: 'historic-model',
  status: 'ok',
  source: 'MCP',
  toolCalls: null,
  createdAt: new Date('2026-09-29T00:00:00Z'),
});
const native = (id: string): NativeForkTurn => ({
  id,
  completed: true,
  user: 'Repeated prompt',
  assistant: 'Repeated answer',
});

test('exact native IDs take priority over repeated text', () => {
  const response = {
    ...turn('a', 'assistant', 'Repeated answer'),
    native: { sessionId: 'native', turnId: 'second' },
  };
  assert.deepEqual(
    resolveForkBoundary(
      [turn('u', 'user'), response],
      [native('first'), native('second')],
    ),
    { turn: native('second'), estimated: false },
  );
});

test('legacy matching resolves repeated exchanges in provider order even with tied timestamps', () => {
  const snapshot = [
    turn('u1', 'user'),
    turn('a1', 'assistant', 'Repeated answer'),
    turn('u2', 'user'),
    turn('a2', 'assistant', 'Repeated answer'),
  ];
  assert.equal(
    resolveForkBoundary(snapshot, [native('first'), native('second')]).turn.id,
    'second',
  );
  assert.equal(
    resolveForkBoundary(snapshot, [native('first'), native('second')])
      .estimated,
    true,
  );
  assert.equal(snapshot[1].native, undefined);
});

for (const metadata of [
  { sessionId: 'native', turnId: 'missing' },
  { sessionId: 'native', eventId: 'missing', turnId: 'first' },
]) {
  test(`recorded ${metadata.eventId ? 'event' : 'turn'} ID cannot fall back to identical text`, () => {
    assert.throws(
      () =>
        resolveForkBoundary(
          [
            turn('u', 'user'),
            { ...turn('a', 'assistant', 'Repeated answer'), native: metadata },
          ],
          [native('first')],
        ),
      { code: 'FORK_HISTORY_UNAVAILABLE' },
    );
  });
}

test('a recorded native turn must be completed even when repeated text matches', () => {
  assert.throws(
    () =>
      resolveForkBoundary(
        [
          turn('u', 'user'),
          {
            ...turn('a', 'assistant', 'Repeated answer'),
            native: { sessionId: 'native', turnId: 'active' },
          },
        ],
        [native('first'), { ...native('active'), completed: false }],
      ),
    { code: 'FORK_HISTORY_UNAVAILABLE' },
  );
});

test('handover timestamp handles histories beyond the spread argument limit', () => {
  const row = turn('row', 'assistant');
  const history = Array<TurnSummary>(200_000).fill(row);
  const latest = new Date('2026-10-01T00:00:00Z');
  history.push({ ...row, createdAt: latest });
  assert.equal(forkHandoverAt(history, 0).getTime(), latest.getTime() + 1);
  assert.equal(
    forkHandoverAt(history, latest.getTime() + 100).getTime(),
    latest.getTime() + 101,
  );
});

test('earlier cutoff excludes the later source run; latest chooses the last completed response', () => {
  const history = [
    turn('u1', 'user'),
    turn('a1', 'assistant'),
    turn('u2', 'user'),
    turn('a2', 'assistant'),
    turn('later', 'user'),
  ];
  assert.deepEqual(
    selectForkSnapshot(history, 'a1').map((item) => item.turnId),
    ['u1', 'a1'],
  );
  assert.deepEqual(
    selectForkSnapshot(history).map((item) => item.turnId),
    ['u1', 'a1', 'u2', 'a2'],
  );
  assert.throws(() => selectForkSnapshot(history, 'later'), {
    code: 'FORK_BOUNDARY_UNAVAILABLE',
  });
  assert.throws(
    () =>
      selectForkSnapshot([
        { ...turn('failed', 'assistant'), status: 'failed' },
      ]),
    { code: 'FORK_BOUNDARY_UNAVAILABLE' },
  );
});

test('latest fork-of-fork keeps trailing handover; an explicit older point excludes it', () => {
  const handover = {
    ...turn('handover', 'user', 'Target prompt'),
    fork: { handover: true },
  };
  const history = [turn('u1', 'user'), turn('a1', 'assistant'), handover];
  assert.equal(selectForkSnapshot(history).length, 3);
  assert.equal(selectForkSnapshot(history, 'handover').length, 3);
  assert.equal(selectForkSnapshot(history, 'a1').length, 2);
});

test('legacy matching uses surrounding timestamps when native content was compacted, and fails only without usable evidence', () => {
  const candidate = {
    ...native('compacted'),
    user: '',
    assistant: '',
    timestamp: '2026-09-29T00:00:00Z',
  };
  assert.equal(
    resolveForkBoundary(
      [turn('u', 'user'), turn('a', 'assistant')],
      [candidate],
    ).turn.id,
    'compacted',
  );
  assert.throws(() => resolveForkBoundary([turn('a', 'assistant')], []), {
    code: 'FORK_HISTORY_UNAVAILABLE',
  });
});

test('copy preserves historic display metadata and removes live replay ownership', () => {
  const original = {
    ...turn('a1', 'assistant', 'Verbatim history'),
    command: {
      name: 'flow',
      stepIndex: 2,
      totalSteps: 4,
      loopDepth: 1,
      label: 'Historical command',
    } as const,
    toolCalls: { calls: [{ result: { value: 42 } }] },
    usage: { inputTokens: 4 },
    timing: { totalTimeSec: 2 },
    native: { sessionId: 'parent', turnId: 'turn-native' },
    runtime: {
      workingFolder: '/shared/folder',
      replay: { replayId: 'live', inflightId: 'running', completed: true },
    },
  };
  const copied = copyForkTurn(original, 'child', 'native-child', 7);
  assert.equal(copied.content, original.content);
  assert.deepEqual(copied.createdAt, original.createdAt);
  assert.deepEqual(copied.command, original.command);
  assert.deepEqual(copied.toolCalls, original.toolCalls);
  assert.deepEqual(copied.usage, original.usage);
  assert.deepEqual(copied.timing, original.timing);
  assert.equal(copied.model, 'historic-model');
  assert.equal(copied.native?.sessionId, 'native-child');
  assert.equal(copied.runtime?.workingFolder, '/shared/folder');
  assert.equal('replay' in copied.runtime!, false);
  assert.equal(copied.displayOrder, 7);
  assert.equal(original.runtime.replay.inflightId, 'running');
});

test('same/different agent providers can match, while fallback, cross-provider, and endpoint changes are rejected', () => {
  const target = {
    executionProviderId: 'codex',
    requestedProviderId: 'codex',
    endpointId: 'endpoint',
  } as Awaited<ReturnType<typeof prepareAgentForkTarget>>;
  assert.doesNotThrow(() =>
    assertForkCompatible(
      { provider: 'codex', flags: { endpointId: 'endpoint' } },
      target,
    ),
  );
  assert.throws(
    () => assertForkCompatible({ provider: 'copilot', flags: {} }, target),
    { code: 'FORK_UNSUPPORTED' },
  );
  assert.throws(
    () =>
      assertForkCompatible(
        { provider: 'codex', flags: { endpointId: 'other' } },
        target,
      ),
    { code: 'FORK_UNSUPPORTED' },
  );
  assert.throws(
    () =>
      assertForkCompatible(
        { provider: 'codex', flags: { endpointId: 'endpoint' } },
        { ...target, requestedProviderId: 'copilot' },
      ),
    { code: 'FORK_UNSUPPORTED' },
  );
});

test('unmatched old synthetic responses do not disqualify a usable selected boundary', () => {
  const history = [
    turn('summary', 'assistant', 'Synthetic warning'),
    turn('u', 'user'),
    turn('a', 'assistant', 'Repeated answer'),
  ];
  assert.equal(
    resolveForkBoundary(history, [native('actual')]).turn.id,
    'actual',
  );
});
