import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseBreakAnswer,
  parseContinueAnswer,
  parseIfAnswer,
  parseScriptFlowDecisionAnswer,
} from '../../flows/service.js';

const runDecisionParserSuite = (params: {
  kind: 'break' | 'continue' | 'if';
  label: 'Break' | 'Continue' | 'If';
  parse: (content: string) =>
    | {
        ok: true;
        answer: 'yes' | 'no';
        normalizedContent: string;
        attempts: Array<{ strategy: string; candidateCount: number }>;
      }
    | {
        ok: false;
        message: string;
        reasonCode: string;
        attempts: Array<{ strategy: string; candidateCount: number }>;
      };
}) => {
  test(`${params.kind} strict-body parse accepts direct JSON first`, () => {
    const parsed = params.parse('{"answer":"yes"}');
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.answer, 'yes');
    assert.equal(parsed.normalizedContent, '{"answer":"yes"}');
    assert.equal(parsed.attempts[0]?.strategy, 'strict');
    assert.equal(parsed.attempts[0]?.candidateCount, 1);
  });

  test(`${params.kind} fenced JSON fallback accepts json code block`, () => {
    const parsed = params.parse(
      'Here is the result:\n```json\n{"answer":"no"}\n```',
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.answer, 'no');
    assert.equal(parsed.attempts[1]?.strategy, 'fenced_json');
    assert.equal(parsed.attempts[1]?.candidateCount, 1);
  });

  test(`${params.kind} balanced-object fallback accepts embedded JSON object with wrappers`, () => {
    const parsed = params.parse(
      'Thoughts {not valid} and wrapper text then result => {"answer":"yes"} end',
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.answer, 'yes');
    assert.equal(parsed.attempts[2]?.strategy, 'balanced_object');
    assert.ok((parsed.attempts[2]?.candidateCount ?? 0) >= 1);
  });

  test(`${params.kind} strict parse precedence wins when strict body and fallback candidate both exist`, () => {
    const parsed = params.parse('{"answer":"yes"}');
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.answer, 'yes');
    assert.equal(parsed.attempts.length, 1);
  });

  test(`${params.kind} schema gate rejects extra keys`, () => {
    const parsed = params.parse('{"answer":"yes","extra":true}');
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.reasonCode, 'INVALID_SCHEMA');
    assert.match(parsed.message, /exactly/);
  });

  test(`${params.kind} schema gate rejects invalid answer values`, () => {
    const parsed = params.parse('{"answer":"maybe"}');
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.reasonCode, 'INVALID_SCHEMA');
    assert.equal(
      parsed.message,
      `${params.label} response must include answer "yes" or "no".`,
    );
  });

  test(`${params.kind} returns terminal failure when no valid JSON candidate exists`, () => {
    const parsed = params.parse('plain text only, no json answer');
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.reasonCode, 'NO_VALID_CANDIDATE');
    assert.equal(
      parsed.message,
      `${params.label} response must be valid JSON with {"answer":"yes"|"no"}.`,
    );
  });
};

runDecisionParserSuite({
  kind: 'break',
  label: 'Break',
  parse: parseBreakAnswer,
});

for (const kind of ['break', 'continue', 'if'] as const) {
  test(`${kind} script decisions require one exact JSON object`, () => {
    const accepted = parseScriptFlowDecisionAnswer(kind, '{"answer":"yes"}\n');
    assert.equal(accepted.ok, true);

    for (const ambiguous of [
      'debug {"answer":"yes"}',
      '```json\n{"answer":"yes"}\n```',
      '{"answer":"yes"}\n{"answer":"no"}',
      '{"answer":"yes","extra":true}',
    ]) {
      const rejected = parseScriptFlowDecisionAnswer(kind, ambiguous);
      assert.equal(rejected.ok, false, ambiguous);
    }
  });
}

runDecisionParserSuite({
  kind: 'continue',
  label: 'Continue',
  parse: parseContinueAnswer,
});

runDecisionParserSuite({
  kind: 'if',
  label: 'If',
  parse: parseIfAnswer,
});
