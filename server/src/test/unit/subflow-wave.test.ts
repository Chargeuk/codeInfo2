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

test('production two-phase cycle expands fast 2N+1 and slow N jobs', async () => {
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
  const fastLoop = parsed.steps.find(
    (candidate) => candidate.label === 'Fast Review Convergence Loop',
  );
  const fastWave = fastLoop?.steps?.find(
    (candidate) => candidate.type === 'subflowWave',
  );
  const slowWave = parsed.steps.find(
    (candidate) => candidate.label === 'Run Slow Review Wave',
  );
  assert(fastWave);
  assert(slowWave?.groups);

  for (const targetCount of [1, 3]) {
    const targets = Array.from({ length: targetCount }, (_, index) => ({
      target_id: `repo-${index}`,
      repo_root: `/repos/repo-${index}`,
    }));
    const fastJobs = expandSubflowWaveJobs({
      step: fastWave,
      input: {
        fast_review_wave: {
          targets,
          plan_host_root: '/repos/repo-0',
        },
        fast_review_set: { review_phase: 'fast' },
      },
    });
    const slowJobs = expandSubflowWaveJobs({
      step: slowWave as FlowSubflowWaveStep,
      input: {
        slow_review_wave: {
          targets,
          plan_host_root: '/repos/repo-0',
        },
        slow_review_set: { review_phase: 'slow' },
      },
    });

    assert.equal(fastJobs.length, targetCount * 2 + 1);
    assert.equal(slowJobs.length, targetCount);
    assert.equal(
      fastJobs.filter((job) => job.flowName === 'cross_repository_review')
        .length,
      1,
    );
    assert.equal(
      slowJobs.every((job) => job.flowName === 'review_artifacts_main'),
      true,
    );
  }
});
