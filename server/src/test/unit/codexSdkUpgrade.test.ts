import assert from 'node:assert/strict';
import test from 'node:test';
import pkg from '../../../package.json' with { type: 'json' };

import {
  DEV_0000040_T10_CODEX_SDK_GUARD,
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
  assert.equal(logs.length, 2);
  assert.match(
    logs[0],
    new RegExp(
      `^\\[DEV-0000037\\]\\[T01\\] event=codex_sdk_upgraded result=success version=${DEV_0000037_T01_REQUIRED_VERSION}$`,
    ),
  );
  assert.match(
    logs[1],
    new RegExp(
      `^${DEV_0000040_T10_CODEX_SDK_GUARD} installed=${DEV_0000037_T01_REQUIRED_VERSION} required=${DEV_0000037_T01_REQUIRED_VERSION} decision=accepted stable=true matchesRequired=true$`,
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
  assert.equal(errors.length, 2);
  assert.match(
    errors[0],
    /^\[DEV-0000037\]\[T01\] event=codex_sdk_upgraded result=error version=0\.107\.0-alpha\.5 reason=non_stable_version$/,
  );
  assert.match(
    errors[1],
    new RegExp(
      `^${DEV_0000040_T10_CODEX_SDK_GUARD} installed=0\\.107\\.0-alpha\\.5 required=${DEV_0000037_T01_REQUIRED_VERSION} decision=rejected stable=false matchesRequired=false reason=non_stable_version$`,
    ),
  );
});

test('accepts exact required pinned stable version 0.107.0', () => {
  const result = validateAndLogCodexSdkUpgrade('0.107.0');
  assert.equal(result, true);
});

test('rejects higher stable version than required', () => {
  const result = validateAndLogCodexSdkUpgrade('0.108.0');
  assert.equal(result, false);
});

test('rejects lower stable version than required', () => {
  const result = validateAndLogCodexSdkUpgrade('0.106.0');
  assert.equal(result, false);
});
