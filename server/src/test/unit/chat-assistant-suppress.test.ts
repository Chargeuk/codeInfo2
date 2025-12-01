import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findAssistantToolResults,
  normalizeToolResults,
} from '../../routes/chat.js';

test('findAssistantToolResults returns tool entries when assistant payload includes toolCallId', () => {
  const toolCtx = new Map<number, unknown>([[1, {}]]);
  const toolNames = new Map<number, string>([[1, 'VectorSearch']]);
  const message = {
    role: 'assistant',
    content: JSON.stringify([
      {
        toolCallId: 1,
        name: 'VectorSearch',
        result: { ok: true },
      },
    ]),
  };

  const entries = findAssistantToolResults(message, toolCtx, toolNames);

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.callId, 1);
  assert.equal(entries[0]?.name, 'VectorSearch');
});

test('normalizeToolResults leaves plain assistant text untouched', () => {
  const entries = normalizeToolResults({ role: 'assistant', content: 'hello' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.callId, undefined);
  assert.equal(entries[0]?.result, 'hello');
});
