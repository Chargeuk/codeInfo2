import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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
      'reviews:client:main',
      'reviews:client:codex',
      'reviews:client:ocr',
      'reviews:server:main',
      'reviews:server:codex',
      'reviews:server:ocr',
      'cross:cross_review',
    ],
  );
  assert.equal(jobs[0]?.workingFolder, '/repos/client');
  assert.deepEqual(jobs[0]?.input, {
    review_target: { repo_root: '/repos/client', target_id: 'client' },
  });
  assert.match(jobs[0]?.inputHash ?? '', /^[0-9a-f]{64}$/u);
});

test('expandSubflowWaveJobs distinguishes valid tuple components containing delimiters', () => {
  const jobs = expandSubflowWaveJobs({
    step: {
      type: 'subflowWave',
      groups: [
        {
          kind: 'matrix',
          id: 'reviews',
          itemsFrom: 'targets',
          itemName: 'target',
          flowNames: ['b:c', 'c'],
        },
      ],
    },
    input: {
      targets: [{ target_id: 'a' }, { target_id: 'a:b' }],
    },
  });

  assert.deepEqual(
    jobs.map((job) => job.instanceId),
    ['reviews:a:b%3Ac', 'reviews:a:c', 'reviews:a%3Ab:b%3Ac', 'reviews:a%3Ab:c'],
  );
  assert.equal(new Set(jobs.map((job) => job.instanceId)).size, jobs.length);
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

test('expandSubflowWaveJobs discovers dynamic groups and preserves literal scheduling input', () => {
  const jobs = expandSubflowWaveJobs({
    step: {
      type: 'subflowWave',
      groupsFrom: 'review_groups',
    },
    input: {
      targets: [{ target_id: 'client', repo_root: '/repos/client' }],
      review_groups: [
        {
          kind: 'matrix',
          id: 'reviews',
          itemsFrom: 'targets',
          itemName: 'target',
          flowNames: ['new_reviewer'],
          bindings: {
            workingFolderFrom: 'target.repo_root',
            inputValues: { scheduling_hint: 'configured by parent only' },
          },
        },
      ],
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.flowName, 'new_reviewer');
  assert.deepEqual(jobs[0]?.input, {
    scheduling_hint: 'configured by parent only',
  });
});

test('production review policy configures repeated and one-shot batches without review phase metadata', async () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const raw = await fs.readFile(
    path.join(repoRoot, 'flows/two_phase_review_cycle.json'),
    'utf8',
  );
  const parsed = JSON.parse(raw) as {
    steps: Array<{
      label?: string;
      steps?: FlowSubflowWaveStep[];
      type?: string;
      groups?: FlowSubflowWaveStep['groups'];
    }>;
  };
  const repeatedLoop = parsed.steps.find(
    (candidate) => candidate.label === 'Repeated Review Group',
  );
  const repeatedBatch = repeatedLoop?.steps?.find(
    (candidate) => candidate.type === 'subflowWave',
  );
  const oneShotBatch = parsed.steps.find(
    (candidate) => candidate.label === 'Run One-Shot Generic Review Batch',
  );
  assert(repeatedBatch?.groups);
  assert(oneShotBatch?.groups);
  const repeatedValues = repeatedBatch.groups[0]?.bindings?.inputValues;
  const oneShotValues = oneShotBatch.groups[0]?.bindings?.inputValues;
  assert(Array.isArray(repeatedValues?.review_groups));
  assert(Array.isArray(oneShotValues?.review_groups));
  assert.equal(JSON.stringify(repeatedValues).includes('reviewPhase'), false);
  assert.equal(JSON.stringify(oneShotValues).includes('reviewPhase'), false);
  assert.match(JSON.stringify(repeatedValues), /codex_review/u);
  assert.match(JSON.stringify(repeatedValues), /open_code_review/u);
  assert.match(JSON.stringify(oneShotValues), /review_artifacts_main/u);
});
