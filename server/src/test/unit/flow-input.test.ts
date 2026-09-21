import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_FLOW_INPUT_BYTES,
  normalizeFlowInput,
  prependAssignedReviewContext,
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
  const instruction = prependAssignedReviewContext('Review the change.', {
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
    prependAssignedReviewContext('Implement the task.', {
      target: { repo_root: '/repo' },
    }),
    'Implement the task.',
  );
});

test('batch-only context pins the plan and batch without exposing unrelated flow input', () => {
  const instruction = prependAssignedReviewContext(
    'Disposition the current batch.',
    {
      review_batch: {
        story_id: '0000060',
        plan_path: '/repo/planning/0000060-story.md',
        batch_id: '0000060-rw-assigned',
        batch_root: '/repo/reviews/assigned',
      },
      unrelated: 'do not expose this value',
    },
  );
  assert.match(instruction, /Scheduler-assigned review batch/u);
  assert.match(
    instruction,
    /"plan_path": "\/repo\/planning\/0000060-story.md"/u,
  );
  assert.match(instruction, /"batch_root": "\/repo\/reviews\/assigned"/u);
  assert.match(instruction, /never select another batch or plan/u);
  assert.doesNotMatch(instruction, /do not expose this value/u);
  assert.ok(instruction.endsWith('Disposition the current batch.'));
});

test('batch context preserves the narrower assigned reviewer job boundary', () => {
  const instruction = prependAssignedReviewContext('Review.', {
    review_batch: { batch_root: '/reviews/assigned' },
    review_job: { output_dir: '/reviews/assigned/jobs/one/output' },
  });
  assert.match(instruction, /Scheduler-assigned review batch/u);
  assert.match(instruction, /Scheduler-assigned review job/u);
  assert.match(
    instruction,
    /"output_dir": "\/reviews\/assigned\/jobs\/one\/output"/u,
  );
  assert.match(instruction, /Job paths remain the write boundary/u);
});

test('invalid review input shapes leave ordinary instructions unchanged', () => {
  for (const value of [null, 'not an assignment', [], true]) {
    assert.equal(
      prependAssignedReviewContext('Ordinary instruction.', {
        review_batch: value,
        review_job: value,
      }),
      'Ordinary instruction.',
    );
  }
});
