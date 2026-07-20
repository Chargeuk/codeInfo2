import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  initializeReviewCycle,
  inspectFinalReviewReadiness,
} from '../../flows/reviewCycleLifecycle.js';

const exec = promisify(execFile);

const completePlan = `# Plan

### Task 1. Complete

- Task Status: \`__done__\`

#### Subtasks

1. [x] Implement it.

#### Testing

1. [x] Prove it.
`;

const makeRepo = async (plan = completePlan) => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'review-cycle-'));
  await exec('git', ['init'], { cwd: repo });
  await fs.mkdir(path.join(repo, 'planning'), { recursive: true });
  await fs.mkdir(path.join(repo, 'codeInfoStatus', 'flow-state'), {
    recursive: true,
  });
  const planPath = 'planning/0000064-review-cycle.md';
  await fs.writeFile(path.join(repo, planPath), plan);
  await fs.writeFile(
    path.join(repo, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    JSON.stringify({ plan_path: planPath }),
  );
  return repo;
};

test('final review readiness requires done tasks and checked implementation and proof', () => {
  assert.equal(inspectFinalReviewReadiness(completePlan).eligible, true);
  const incomplete = completePlan
    .replace('__done__', '__in_progress__')
    .replace('[x] Prove it.', '[ ] Prove it.');
  const result = inspectFinalReviewReadiness(incomplete);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.incomplete_tasks, [
    { number: 1, status: '__in_progress__' },
  ]);
  assert.equal(result.unchecked_work[0]?.section, 'Testing');
});

test('fresh final review archives stale disposition and resume preserves the cycle', async () => {
  const repo = await makeRepo();
  const stateRoot = path.join(repo, 'codeInfoStatus', 'flow-state');
  const oldCycle = '0000064-rc-20260715T000000Z-11111111';
  await fs.writeFile(
    path.join(stateRoot, 'review-disposition-state.json'),
    JSON.stringify({ review_cycle_id: oldCycle, review_phase: 'slow' }),
  );
  await fs.writeFile(
    path.join(stateRoot, 'minor-review-fix-result.json'),
    JSON.stringify({ status: 'blocked' }),
  );
  const now = new Date('2026-07-18T12:00:00.000Z');
  const initialized = await initializeReviewCycle(
    {
      workingRepositoryPath: repo,
      parentExecutionId: 'execution-1',
      mode: 'final',
    },
    { now: () => now, randomHex: () => '22222222' },
  );
  assert.equal(initialized.action, 'initialized');
  assert.equal(
    initialized.cycle?.review_cycle_id,
    '0000064-rc-20260718T120000Z-22222222',
  );
  await assert.rejects(
    fs.readFile(path.join(stateRoot, 'review-disposition-state.json')),
    /ENOENT/u,
  );
  await assert.rejects(
    fs.readFile(path.join(stateRoot, 'minor-review-fix-result.json')),
    /ENOENT/u,
  );
  const archived = JSON.parse(
    await fs.readFile(
      path.join(
        stateRoot,
        'review-cycles',
        oldCycle,
        'review-disposition-state.json',
      ),
      'utf8',
    ),
  ) as { review_phase: string };
  assert.equal(archived.review_phase, 'slow');

  await fs.writeFile(
    path.join(repo, 'planning', '0000064-review-cycle.md'),
    completePlan.replace('__done__', '__in_progress__'),
  );
  const resumed = await initializeReviewCycle(
    {
      workingRepositoryPath: repo,
      parentExecutionId: 'execution-1',
      mode: 'final',
    },
    { now: () => new Date('2026-07-18T13:00:00.000Z') },
  );
  assert.equal(resumed.action, 'resumed');
  assert.equal(
    resumed.cycle?.review_cycle_id,
    initialized.cycle?.review_cycle_id,
  );
});

test('competing final review initialization preserves the winning active cycle and prior disposition', async () => {
  const repo = await makeRepo();
  const stateRoot = path.join(repo, 'codeInfoStatus', 'flow-state');
  const oldCycle = '0000064-rc-20260715T000000Z-11111111';
  await fs.writeFile(
    path.join(stateRoot, 'review-disposition-state.json'),
    JSON.stringify({ review_cycle_id: oldCycle, review_phase: 'slow' }),
  );

  let releaseActiveRename!: () => void;
  const activeRenameReleased = new Promise<void>((resolve) => {
    releaseActiveRename = resolve;
  });
  let activeRenameReached!: () => void;
  const activeRenameStarted = new Promise<void>((resolve) => {
    activeRenameReached = resolve;
  });
  const first = initializeReviewCycle(
    {
      workingRepositoryPath: repo,
      parentExecutionId: 'execution-winner',
      mode: 'final',
    },
    {
      now: () => new Date('2026-07-18T12:00:00.000Z'),
      randomHex: () => '22222222',
      rename: async (source, destination) => {
        if (destination === path.join(stateRoot, 'active-review-cycle.json')) {
          activeRenameReached();
          await activeRenameReleased;
        }
        await fs.rename(source, destination);
      },
    },
  );
  await activeRenameStarted;
  const loser = initializeReviewCycle(
    {
      workingRepositoryPath: repo,
      parentExecutionId: 'execution-loser',
      mode: 'final',
    },
    {
      now: () => new Date('2026-07-18T12:00:01.000Z'),
      randomHex: () => '33333333',
    },
  );
  releaseActiveRename();

  const initialized = await first;
  await assert.rejects(
    loser,
    /already owned by parent execution execution-winner/u,
  );
  assert.equal(initialized.cycle?.parent_execution_id, 'execution-winner');
  const active = JSON.parse(
    await fs.readFile(path.join(stateRoot, 'active-review-cycle.json'), 'utf8'),
  ) as { review_cycle_id: string; parent_execution_id: string };
  assert.equal(active.review_cycle_id, initialized.cycle?.review_cycle_id);
  assert.equal(active.parent_execution_id, 'execution-winner');
  const archived = JSON.parse(
    await fs.readFile(
      path.join(
        stateRoot,
        'review-cycles',
        oldCycle,
        'review-disposition-state.json',
      ),
      'utf8',
    ),
  ) as { review_cycle_id: string };
  assert.equal(archived.review_cycle_id, oldCycle);
});

test('incomplete final review exits without resetting prior state', async () => {
  const repo = await makeRepo(
    completePlan
      .replace('__done__', '__in_progress__')
      .replace('[x] Prove it.', '[ ] Prove it.'),
  );
  const statePath = path.join(
    repo,
    'codeInfoStatus',
    'flow-state',
    'review-disposition-state.json',
  );
  await fs.writeFile(
    statePath,
    JSON.stringify({ review_cycle_id: 'old-cycle', review_phase: 'slow' }),
  );
  const result = await initializeReviewCycle({
    workingRepositoryPath: repo,
    parentExecutionId: 'execution-2',
    mode: 'final',
  });
  assert.equal(result.action, 'skipped_incomplete_story');
  assert.equal(
    JSON.parse(await fs.readFile(statePath, 'utf8')).review_phase,
    'slow',
  );
});
