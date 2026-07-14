import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_FLOW_INPUT_BYTES,
  normalizeFlowInput,
  tryNormalizeFlowInput,
} from '../../flows/flowInput.js';

test('normalizeFlowInput returns a detached JSON-safe object', () => {
  const source = { target: { root: '/repo', branches: ['feature/64'] } };
  const normalized = normalizeFlowInput(source);
  source.target.root = '/changed';

  assert.deepEqual(normalized, {
    target: { root: '/repo', branches: ['feature/64'] },
  });
});

test('normalizeFlowInput rejects unsupported and cyclic values', () => {
  assert.throws(() => normalizeFlowInput({ value: undefined }));
  assert.throws(() => normalizeFlowInput({ value: Number.NaN }));
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => normalizeFlowInput(cyclic));
  assert.equal(tryNormalizeFlowInput({ value: undefined }), undefined);
});

test('normalizeFlowInput enforces its serialized size bound', () => {
  assert.throws(() =>
    normalizeFlowInput({ value: 'x'.repeat(MAX_FLOW_INPUT_BYTES) }),
  );
});
