import assert from 'node:assert/strict';
import test from 'node:test';
import pkg from '../../../package.json' with { type: 'json' };

import {
  DEV_0000037_T01_REQUIRED_VERSION,
  validateAndLogCodexSdkUpgrade,
} from '../../config/codexSdkUpgrade.js';

test('logs deterministic success for required stable codex sdk version', () => {
  const logs: string[] = [];
  const errors: string[] = [];

  const result = validateAndLogCodexSdkUpgrade(
    pkg.dependencies?.['@openai/codex-sdk'],
    {
      logger: (message) => logs.push(message),
      errorLogger: (message) => errors.push(message),
    },
  );

  assert.equal(result, true);
  assert.equal(errors.length, 0);
  assert.equal(logs.length, 1);
  assert.match(
    logs[0],
    new RegExp(
      `^\\[DEV-0000037\\]\\[T01\\] event=codex_sdk_upgraded result=success version=${DEV_0000037_T01_REQUIRED_VERSION}$`,
    ),
  );
});

test('logs deterministic error for non-stable prerelease version', () => {
  const logs: string[] = [];
  const errors: string[] = [];

  const result = validateAndLogCodexSdkUpgrade('0.107.0-alpha.5', {
    logger: (message) => logs.push(message),
    errorLogger: (message) => errors.push(message),
  });

  assert.equal(result, false);
  assert.equal(logs.length, 0);
  assert.equal(errors.length, 1);
  assert.match(
    errors[0],
    /^\[DEV-0000037\]\[T01\] event=codex_sdk_upgraded result=error version=0\.107\.0-alpha\.5 reason=non_stable_version$/,
  );
});
