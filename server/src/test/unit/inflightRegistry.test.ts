import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendAnalysisDelta,
  appendAssistantDelta,
  appendToolEvent,
  cleanupInflight,
  createInflight,
  getCompletedInflight,
  getCompletedInflightByReplayId,
  markInflightFinal,
  markInflightPersisted,
  recordInflightUpdate,
  setAssistantText,
  snapshotInflight,
  snapshotInflightTurns,
} from '../../chat/inflightRegistry.js';

test('receipt clocks follow accepted updates and survive snapshots/completion without restamping', (t) => {
  const conversationId = 'receipt-clock-registry';
  const inflightId = 'receipt-clock-run';
  const replayId = 'receipt-clock-replay';
  const identity = { conversationId, inflightId };
  const startedAt = Date.parse('2026-01-01T00:00:00.000Z');
  t.mock.timers.enable({ apis: ['Date'], now: startedAt });
  const state = createInflight({
    ...identity,
    replayId,
    userTurn: {
      content: 'question',
      createdAt: new Date(startedAt).toISOString(),
    },
  });

  try {
    assert.equal(state.firstUpdateAt, undefined);
    assert.equal(state.lastUpdateAt, undefined);
    const orderingDate = state.assistantCreatedAt;
    t.mock.timers.tick(100);
    appendAssistantDelta({ ...identity, delta: 'answer' });
    const firstUpdateAt = new Date(startedAt + 100).toISOString();
    assert.equal(state.firstUpdateAt, firstUpdateAt);
    assert.equal(state.lastUpdateAt, firstUpdateAt);

    t.mock.timers.tick(100);
    appendAnalysisDelta({ ...identity, delta: 'reasoning' });
    assert.equal(state.lastUpdateAt, new Date(startedAt + 200).toISOString());
    t.mock.timers.tick(100);
    appendToolEvent({
      ...identity,
      event: { type: 'tool-request', callId: 'call-1', name: 'lookup' },
    });
    assert.equal(state.lastUpdateAt, new Date(startedAt + 300).toISOString());
    t.mock.timers.tick(100);
    setAssistantText({ ...identity, text: 'corrected answer' });
    const lastContentAt = new Date(startedAt + 400).toISOString();
    assert.equal(state.lastUpdateAt, lastContentAt);
    assert.equal(state.assistantCreatedAt, orderingDate);

    t.mock.timers.tick(100);
    setAssistantText({ ...identity, text: 'corrected answer' });
    appendAssistantDelta({ ...identity, delta: '' });
    appendAnalysisDelta({ ...identity, delta: '' });
    assert.deepEqual(
      appendAssistantDelta({
        ...identity,
        inflightId: 'stale-run',
        delta: 'late',
      }),
      { ok: false },
    );
    assert.deepEqual(
      recordInflightUpdate({ ...identity, inflightId: 'stale-run' }),
      { ok: false },
    );
    assert.equal(state.lastUpdateAt, lastContentAt);
    const snapshot = snapshotInflight(conversationId);
    assert.equal(snapshot?.firstUpdateAt, firstUpdateAt);
    assert.equal(snapshot?.lastUpdateAt, lastContentAt);
    const assistant = snapshotInflightTurns(conversationId).find(
      (turn) => turn.role === 'assistant',
    );
    assert.equal(assistant?.createdAt.toISOString(), orderingDate);
    assert.equal(assistant?.firstUpdateAt?.toISOString(), firstUpdateAt);
    assert.equal(assistant?.lastUpdateAt?.toISOString(), lastContentAt);

    t.mock.timers.tick(100);
    markInflightFinal({ ...identity, status: 'ok' });
    const terminalAt = new Date(startedAt + 600).toISOString();
    assert.equal(state.lastUpdateAt, terminalAt);
    t.mock.timers.tick(1000);
    markInflightFinal({ ...identity, status: 'failed' });
    markInflightPersisted({
      ...identity,
      role: 'assistant',
      turnId: 'canonical-turn',
    });
    cleanupInflight(identity);
    for (const completed of [
      getCompletedInflight(identity),
      getCompletedInflightByReplayId({ conversationId, replayId }),
    ]) {
      assert.equal(completed?.firstUpdateAt, firstUpdateAt);
      assert.equal(completed?.lastUpdateAt, terminalAt);
      assert.equal(completed?.persistedTurnIds?.assistant, 'canonical-turn');
      assert.equal(completed?.finalStatus, 'ok');
    }
  } finally {
    cleanupInflight(identity);
  }
});

test('cleanupInflight detaches shared external abort listeners after successful child cleanup', () => {
  const conversationId = 'inflight-external-abort-cleanup';
  cleanupInflight({ conversationId });

  const externalController = new AbortController();
  const originalAdd = externalController.signal.addEventListener.bind(
    externalController.signal,
  ) as (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  const originalRemove = externalController.signal.removeEventListener.bind(
    externalController.signal,
  ) as (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => void;

  let addedListener: EventListener | null = null;
  let removedListener: EventListener | null = null;
  let addCalls = 0;
  let removeCalls = 0;

  externalController.signal.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'abort' && listener) {
      addCalls += 1;
      addedListener = listener as EventListener;
    }
    return originalAdd(
      type,
      listener as EventListenerOrEventListenerObject,
      options,
    );
  }) as AbortSignal['addEventListener'];

  externalController.signal.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) => {
    if (type === 'abort' && listener) {
      removeCalls += 1;
      removedListener = listener as EventListener;
    }
    return originalRemove(
      type,
      listener as EventListenerOrEventListenerObject,
      options,
    );
  }) as AbortSignal['removeEventListener'];

  const inflight = createInflight({
    conversationId,
    inflightId: 'inflight-1',
    externalSignal: externalController.signal,
  });
  inflight.finalStatus = 'ok';

  cleanupInflight({ conversationId, inflightId: 'inflight-1' });

  assert.equal(addCalls, 1);
  assert.equal(removeCalls, 1);
  assert.equal(removedListener, addedListener);

  externalController.abort();
  assert.equal(inflight.abortController.signal.aborted, false);
});
