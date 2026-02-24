import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveFlowAndCommandRetries } from '../../config/flowAndCommandRetries.js';

test('retry config defaults to 5 when env is unset', () => {
  assert.equal(resolveFlowAndCommandRetries({}), 5);
});

test('retry config falls back to 5 when env is invalid', () => {
  assert.equal(
    resolveFlowAndCommandRetries({ FLOW_AND_COMMAND_RETRIES: '0' }),
    5,
  );
  assert.equal(
    resolveFlowAndCommandRetries({ FLOW_AND_COMMAND_RETRIES: '-2' }),
    5,
  );
  assert.equal(
    resolveFlowAndCommandRetries({ FLOW_AND_COMMAND_RETRIES: 'abc' }),
    5,
  );
});

test('retry config accepts valid env override', () => {
  assert.equal(
    resolveFlowAndCommandRetries({ FLOW_AND_COMMAND_RETRIES: '2' }),
    2,
  );
});
