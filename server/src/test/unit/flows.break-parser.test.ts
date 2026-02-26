import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBreakAnswer } from '../../flows/service.js';

test('strict-body parse accepts direct JSON first', () => {
  const parsed = parseBreakAnswer('{"answer":"yes"}');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.answer, 'yes');
  assert.equal(parsed.normalizedContent, '{"answer":"yes"}');
  assert.equal(parsed.attempts[0]?.strategy, 'strict');
  assert.equal(parsed.attempts[0]?.candidateCount, 1);
});

test('fenced JSON fallback accepts json code block', () => {
  const parsed = parseBreakAnswer(
    'Here is the result:\n```json\n{"answer":"no"}\n```',
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.answer, 'no');
  assert.equal(parsed.attempts[1]?.strategy, 'fenced_json');
  assert.equal(parsed.attempts[1]?.candidateCount, 1);
});

test('balanced-object fallback accepts embedded JSON object with wrappers', () => {
  const parsed = parseBreakAnswer(
    'Thoughts {not valid} and wrapper text then result => {"answer":"yes"} end',
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.answer, 'yes');
  assert.equal(parsed.attempts[2]?.strategy, 'balanced_object');
  assert.ok((parsed.attempts[2]?.candidateCount ?? 0) >= 1);
});

test('strict parse precedence wins when strict body and fallback candidate both exist', () => {
  const parsed = parseBreakAnswer('{"answer":"yes"}');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.answer, 'yes');
  assert.equal(parsed.attempts.length, 1);
});

test('schema gate rejects extra keys', () => {
  const parsed = parseBreakAnswer('{"answer":"yes","extra":true}');
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reasonCode, 'INVALID_SCHEMA');
  assert.match(parsed.message, /exactly/);
});

test('schema gate rejects invalid answer values', () => {
  const parsed = parseBreakAnswer('{"answer":"maybe"}');
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reasonCode, 'INVALID_SCHEMA');
  assert.equal(
    parsed.message,
    'Break response must include answer "yes" or "no".',
  );
});

test('returns terminal failure when no valid JSON candidate exists', () => {
  const parsed = parseBreakAnswer('plain text only, no json answer');
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reasonCode, 'NO_VALID_CANDIDATE');
  assert.equal(
    parsed.message,
    'Break response must be valid JSON with {"answer":"yes"|"no"}.',
  );
});
