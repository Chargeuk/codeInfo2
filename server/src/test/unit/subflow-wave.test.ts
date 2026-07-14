import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FlowSubflowWaveStep } from '../../flows/flowSchema.js';
import { expandSubflowWaveJobs } from '../../flows/subflowWave.js';

const step: FlowSubflowWaveStep = {
  type: 'subflowWave',
  groups: [
    {
      kind: 'matrix',
      id: 'reviews',
      itemsFrom: 'targets',
      itemName: 'target',
      flowNames: ['main', 'codex', 'ocr'],
      bindings: {
        workingFolderFrom: 'target.repo_root',
        input: { review_target: 'target' },
      },
    },
    {
      kind: 'singleton',
      id: 'cross',
      flowName: 'cross_review',
      bindings: { input: { review_targets: 'targets' } },
    },
  ],
};

test('expandSubflowWaveJobs creates matrix and singleton jobs with stable bindings', () => {
  const jobs = expandSubflowWaveJobs({
    step,
    input: {
      targets: [
        { target_id: 'client', repo_root: '/repos/client' },
        { target_id: 'server', repo_root: '/repos/server' },
      ],
    },
  });

  assert.equal(jobs.length, 7);
  assert.deepEqual(
    jobs.map((job) => job.instanceId),
    [
      'reviews:0:main',
      'reviews:0:codex',
      'reviews:0:ocr',
      'reviews:1:main',
      'reviews:1:codex',
      'reviews:1:ocr',
      'cross:cross_review',
    ],
  );
  assert.equal(jobs[0]?.workingFolder, '/repos/client');
  assert.deepEqual(jobs[0]?.input, {
    review_target: { repo_root: '/repos/client', target_id: 'client' },
  });
  assert.match(jobs[0]?.inputHash ?? '', /^[0-9a-f]{64}$/u);
});

test('expandSubflowWaveJobs rejects missing arrays and unresolved bindings', () => {
  assert.throws(() => expandSubflowWaveJobs({ step, input: {} }));
  assert.throws(() =>
    expandSubflowWaveJobs({
      step,
      input: { targets: [{ target_id: 'client' }] },
    }),
  );
});
