import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionEvent } from '@github/copilot-sdk';
import {
  completedCodexTurnId,
  hasCodexRolloutInjected,
  mapCopilotForkTurns,
} from '../../agents/forkNative.js';

const event = (
  id: string,
  type: string,
  data: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  ({
    id,
    type,
    data,
    timestamp: '2026-09-29T00:00:00Z',
    parentId: null,
    ...extra,
  }) as SessionEvent;

test('Copilot exclusive cutoff keeps terminal marker and excludes the next persisted event even while a later turn runs', () => {
  const events = [
    event('u1', 'user.message', { content: 'First prompt' }),
    event('start1', 'assistant.turn_start', { turnId: 'turn1' }),
    event('message1', 'assistant.message', { content: 'First answer' }),
    event('end1', 'assistant.turn_end', { turnId: 'turn1' }),
    event('idle', 'session.idle', {}, { ephemeral: true }),
    event('u2', 'user.message', { content: 'Later prompt' }),
    event('start2', 'assistant.turn_start', { turnId: 'turn2' }),
  ];
  const turns = mapCopilotForkTurns(events);
  assert.equal(turns[0].eventId, 'end1');
  assert.equal(turns[0].nextEventId, 'u2');
  assert.equal(turns[0].completed, true);
  assert.equal(turns[1].completed, false);
});

test('Copilot idle tail has no persisted successor, and subagent turns cannot replace main-agent boundaries', () => {
  const turns = mapCopilotForkTurns([
    event('u', 'user.message', { content: 'Prompt' }),
    event('main-start', 'assistant.turn_start', { turnId: 'main' }),
    event(
      'child-start',
      'assistant.turn_start',
      { turnId: 'child' },
      { agentId: 'child-agent' },
    ),
    event(
      'child-message',
      'assistant.message',
      { content: 'Subagent response' },
      { agentId: 'child-agent' },
    ),
    event('main-message', 'assistant.message', { content: 'Main response' }),
    event('main-end', 'assistant.turn_end', { turnId: 'main' }),
    event('idle', 'session.idle', {}, { ephemeral: true }),
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].assistant, 'Main response');
  assert.equal(turns[0].nextEventId, undefined);
});

test('Codex rollout injection check tolerates only an unterminated malformed tail', () => {
  const injected = JSON.stringify({
    type: 'response_item',
    payload: { role: 'user', content: [{ text: 'handover' }] },
  });
  assert.equal(hasCodexRolloutInjected('', 'handover'), false);
  assert.equal(hasCodexRolloutInjected(`${injected}\n`, 'handover'), true);
  assert.equal(
    hasCodexRolloutInjected(`${injected}\n{"partial":`, 'handover'),
    true,
  );
  assert.equal(hasCodexRolloutInjected('{"partial":', 'handover'), false);
  assert.throws(() => hasCodexRolloutInjected('{bad}\n', 'handover'));
  assert.throws(() =>
    hasCodexRolloutInjected(`{bad}\n${injected}`, 'handover'),
  );
});

test('Codex completed turn identity comes only from the newest native turn', () => {
  const completed = { id: 'completed', status: 'completed', items: [] };
  const unfinished = { id: 'unfinished', status: 'inProgress', items: [] };
  assert.equal(completedCodexTurnId([]), undefined);
  assert.equal(completedCodexTurnId([completed]), 'completed');
  assert.equal(completedCodexTurnId([completed, unfinished]), undefined);
});
