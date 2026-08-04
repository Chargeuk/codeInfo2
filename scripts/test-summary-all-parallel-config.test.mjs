import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAllParallelEnvironment,
  resolveAllParallelConfiguration,
} from './test-summary-all-parallel-config.mjs';

test('normal all-parallel allocation uses the weighted shared budget', () => {
  const allocation = resolveAllParallelConfiguration({
    availableCores: 16,
  });

  assert.equal(allocation.mode, 'normal');
  assert.equal(allocation.effectiveBudget, 9);
  assert.equal(allocation.serverUnitSource, 'weighted-60pct-budget');
  assert.deepEqual(allocation.workerCounts, {
    client: 2,
    e2e: 1,
    'server:cucumber': 1,
    'server:unit': 5,
  });
});

test('stress allocation assigns only unused cores to server unit', () => {
  const allocation = resolveAllParallelConfiguration({
    availableCores: 16,
    stress: true,
  });

  assert.equal(allocation.mode, 'stress');
  assert.equal(allocation.effectiveBudget, 16);
  assert.equal(allocation.serverUnitSource, 'stress-unused-capacity');
  assert.deepEqual(allocation.workerCounts, {
    client: 2,
    e2e: 1,
    'server:cucumber': 1,
    'server:unit': 12,
  });
});

test('stress allocation does not add workers when minimums already exceed available cores', () => {
  const allocation = resolveAllParallelConfiguration({
    availableCores: 2,
    stress: true,
  });

  assert.equal(allocation.effectiveBudget, 5);
  assert.deepEqual(allocation.workerCounts, {
    client: 1,
    e2e: 1,
    'server:cucumber': 1,
    'server:unit': 2,
  });
});

test('explicit server unit override takes precedence and is capped to available cores', () => {
  const allocation = resolveAllParallelConfiguration({
    availableCores: 16,
    serverUnitOverride: '24',
    stress: true,
  });

  assert.equal(allocation.serverUnitSource, 'env-override');
  assert.equal(allocation.workerCounts['server:unit'], 16);
  assert.equal(allocation.effectiveBudget, 20);
});

test('invalid server unit override falls back to the stress allocation', () => {
  const allocation = resolveAllParallelConfiguration({
    availableCores: 16,
    serverUnitOverride: 'not-a-worker-count',
    stress: true,
  });

  assert.equal(allocation.serverUnitSource, 'stress-unused-capacity');
  assert.equal(allocation.workerCounts['server:unit'], 12);
});

test('stress environment enables runtime diagnostics without losing inherited values', () => {
  const environment = buildAllParallelEnvironment({
    environment: {
      CODEINFO_TEST_RUNTIME_DIAGNOSTICS: '0',
      KEEP_ME: 'yes',
    },
    stress: true,
  });

  assert.deepEqual(environment, {
    CODEINFO_TEST_RUNTIME_DIAGNOSTICS: '1',
    KEEP_ME: 'yes',
  });
});

test('normal environment preserves inherited runtime diagnostic configuration', () => {
  const environment = buildAllParallelEnvironment({
    environment: {
      CODEINFO_TEST_RUNTIME_DIAGNOSTICS: 'custom',
    },
  });

  assert.deepEqual(environment, {
    CODEINFO_TEST_RUNTIME_DIAGNOSTICS: 'custom',
  });
});
