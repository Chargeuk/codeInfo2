import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_FLOW_INPUT_BYTES,
  normalizeFlowInput,
  prependAssignedReviewJobContext,
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

test('review job input is prepended as authoritative agent-readable path context', () => {
  const instruction = prependAssignedReviewJobContext('Review the change.', {
    review_job: {
      reviewer_flow: 'review_artifacts_main',
      job_dir: '/reviews/current/jobs/deep',
      input_dir: '/reviews/current/inputs/repository',
      output_dir: '/reviews/current/jobs/deep/output',
    },
    unrelated: 'not repeated in the prompt',
  });

  assert.match(instruction, /Scheduler-assigned review job/u);
  assert.match(instruction, /"reviewer_flow": "review_artifacts_main"/u);
  assert.match(instruction, /"job_dir": "\/reviews\/current\/jobs\/deep"/u);
  assert.doesNotMatch(instruction, /not repeated in the prompt/u);
  assert.match(instruction, /Review the change\.$/u);
});

test('ordinary flow instructions are unchanged without an assigned review job', () => {
  assert.equal(
    prependAssignedReviewJobContext('Implement the task.', {
      target: { repo_root: '/repo' },
    }),
    'Implement the task.',
  );
});
