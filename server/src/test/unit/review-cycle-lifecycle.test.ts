import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { memoryConversations, memoryTurns } from '../../chat/memoryPersistence.js';
import {
  finalizeActiveReviewCycle,
  finalizeActiveReviewCycleIfPending,
  initializeReviewCycle,
  inspectFinalReviewReadiness,
  readActiveFinalReviewCycleStatus,
  recordReviewInvocationAttempt,
} from '../../flows/reviewCycleLifecycle.js';
import { getFlowRunStatus } from '../../flows/service.js';

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

test('final review readiness accepts canonical unquoted task statuses', () => {
  const result = inspectFinalReviewReadiness(
    completePlan.replace('`__done__`', '__done__'),
  );
  assert.equal(result.eligible, true);
  assert.deepEqual(result.incomplete_tasks, []);
});

test('final review readiness recognizes unchecked bullet work in subtasks and testing', () => {
  const result = inspectFinalReviewReadiness(
    completePlan
      .replace('1. [x] Implement it.', '- [ ] Implement it.')
      .replace('1. [x] Prove it.', '* [ ] Prove it.'),
  );

  assert.equal(result.eligible, false);
  assert.deepEqual(result.unchecked_work, [
    { task_number: 1, section: 'Subtasks', text: 'Implement it.' },
    { task_number: 1, section: 'Testing', text: 'Prove it.' },
  ]);
});

test('final review readiness preserves canonical live blockers', () => {
  const result = inspectFinalReviewReadiness(
    `${completePlan}\n- **BLOCKER** Waiting for the required proof.\n`,
  );
  assert.equal(result.eligible, false);
  assert.deepEqual(result.live_blockers, [
    {
      task_number: 1,
      text: '- **BLOCKER** Waiting for the required proof.',
    },
  ]);
});

test('fresh final review archives stale disposition and records an in-progress cycle', async () => {
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
      mode: 'final',
    },
    { now: () => now, randomHex: () => '22222222' },
  );
  assert.equal(initialized.action, 'initialized');
  assert.equal(
    initialized.cycle?.review_cycle_id,
    '0000064-rc-20260718T120000Z-22222222',
  );
  assert.equal(initialized.cycle?.status, 'in_progress');
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

});

test('a stale execution-owned cycle never blocks a fresh final review', async () => {
  const repo = await makeRepo();
  const stateRoot = path.join(repo, 'codeInfoStatus', 'flow-state');
  const oldCycle = '0000064-rc-20260715T000000Z-11111111';
  await fs.writeFile(
    path.join(stateRoot, 'active-review-cycle.json'),
    JSON.stringify({
      schema_version: 'codeinfo-active-review-cycle/v1',
      review_cycle_id: oldCycle,
      review_mode: 'final',
      story_id: '0000064',
      plan_path: 'planning/0000064-review-cycle.md',
      parent_execution_id: 'orphaned-execution',
      created_at: '2026-07-15T00:00:00.000Z',
    }),
  );
  const initialized = await initializeReviewCycle(
    {
      workingRepositoryPath: repo,
      mode: 'final',
    },
    {
      now: () => new Date('2026-07-18T12:00:00.000Z'),
      randomHex: () => '22222222',
    },
  );
  const active = JSON.parse(
    await fs.readFile(path.join(stateRoot, 'active-review-cycle.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(active.review_cycle_id, initialized.cycle?.review_cycle_id);
  assert.equal(active.status, 'in_progress');
  assert.equal('parent_execution_id' in active, false);
});

test('cycle completion is durable and independent from a flow execution', async () => {
  const repo = await makeRepo();
  await initializeReviewCycle(
    { workingRepositoryPath: repo, mode: 'final' },
    {
      now: () => new Date('2026-07-18T12:00:00.000Z'),
      randomHex: () => '22222222',
    },
  );
  const completed = await finalizeActiveReviewCycle(
    { workingRepositoryPath: repo, status: 'incomplete', reason: 'review failed' },
    { now: () => new Date('2026-07-18T12:05:00.000Z') },
  );
  assert.equal(completed?.status, 'incomplete');
  assert.equal(completed?.incomplete_reason, 'review failed');
  assert.equal(completed?.completed_at, '2026-07-18T12:05:00.000Z');
  assert.equal('parent_execution_id' in (completed ?? {}), false);
});

test('final review status is readable for terminal wrapper reporting', async () => {
  const repo = await makeRepo();
  await initializeReviewCycle(
    { workingRepositoryPath: repo, mode: 'final' },
    {
      now: () => new Date('2026-07-18T12:00:00.000Z'),
      randomHex: () => '22222222',
    },
  );
  assert.equal(await readActiveFinalReviewCycleStatus(repo), 'in_progress');
  await finalizeActiveReviewCycle(
    {
      workingRepositoryPath: repo,
      status: 'incomplete',
      reason: 'review failed',
    },
    { now: () => new Date('2026-07-18T12:05:00.000Z') },
  );
  assert.equal(await readActiveFinalReviewCycleStatus(repo), 'incomplete');
});

test('flow status ignores an active review cycle owned by a different conversation', async () => {
  const repo = await makeRepo();
  const first = await initializeReviewCycle(
    { workingRepositoryPath: repo, mode: 'final' },
    {
      now: () => new Date('2026-07-18T12:00:00.000Z'),
      randomHex: () => '11111111',
    },
  );
  await initializeReviewCycle(
    { workingRepositoryPath: repo, mode: 'final' },
    {
      now: () => new Date('2026-07-18T12:05:00.000Z'),
      randomHex: () => '22222222',
    },
  );
  const conversationId =
    `review-cycle-status-first-conversation-${randomUUID()}`;
  const now = new Date();
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.6-sol',
    title: 'First review cycle',
    flowName: 'two_phase_review_cycle',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'first-review-execution',
        stepPath: [],
        loopStack: [],
        workingFolder: repo,
        values: {
          review_cycle: {
            action: 'initialized',
            review_mode: 'final',
            review_cycle_id: first.cycle?.review_cycle_id,
          },
        },
        agentConversations: {},
        agentThreads: {},
      },
    },
    lastMessageAt: now,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  try {
    assert.equal((await getFlowRunStatus(conversationId))?.reviewCycleStatus, null);
    const conversation = memoryConversations.get(conversationId);
    assert.ok(conversation);
    memoryConversations.set(conversationId, {
      ...conversation,
      flags: {
        ...conversation.flags,
        flow: {
          ...((conversation.flags.flow ?? {}) as Record<string, unknown>),
          values: {},
        },
      },
    });
    assert.equal((await getFlowRunStatus(conversationId))?.reviewCycleStatus, null);
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('review invocation evidence survives a failed launch without a batch workspace', async () => {
  const repo = await makeRepo();
  const cycle = await initializeReviewCycle(
    { workingRepositoryPath: repo, mode: 'final' },
    {
      now: () => new Date('2026-07-18T12:00:00.000Z'),
      randomHex: () => '22222222',
    },
  );
  const invocationId = '0.1@loop-2--one_shot_review_batch';
  const scheduledPath = await recordReviewInvocationAttempt(
    {
      workingRepositoryPath: repo,
      invocationId,
      flowName: 'review_batch',
      displayName: 'One-shot review batch',
      status: 'scheduled',
    },
    { now: () => new Date('2026-07-18T12:01:00.000Z') },
  );
  const failedPath = await recordReviewInvocationAttempt(
    {
      workingRepositoryPath: repo,
      invocationId,
      flowName: 'review_batch',
      displayName: 'One-shot review batch',
      status: 'failed',
      reason: 'FLOW_INVALID because the running schema rejected the child.',
    },
    { now: () => new Date('2026-07-18T12:01:01.000Z') },
  );

  assert.equal(failedPath, scheduledPath);
  assert.ok(failedPath);
  const evidence = await fs.readFile(failedPath!, 'utf8');
  assert.match(evidence, /not a machine-parsed review result schema/u);
  assert.match(evidence, new RegExp(cycle.cycle!.review_cycle_id, 'u'));
  assert.match(evidence, /## 2026-07-18T12:01:00.000Z — scheduled/u);
  assert.match(evidence, /## 2026-07-18T12:01:01.000Z — failed/u);
  assert.match(evidence, /FLOW_INVALID because the running schema rejected/u);
  await assert.rejects(
    fs.readdir(
      path.join(
        repo,
        'codeInfoTmp',
        'reviews',
        cycle.cycle!.review_cycle_id,
        'batches',
      ),
    ),
    /ENOENT/u,
  );
});

test('review invocation evidence keeps distinct invocation identities separate', async () => {
  const repo = await makeRepo();
  await initializeReviewCycle(
    { workingRepositoryPath: repo, mode: 'final' },
    {
      now: () => new Date('2026-07-18T12:00:00.000Z'),
      randomHex: () => '22222222',
    },
  );
  const firstPath = await recordReviewInvocationAttempt(
    {
      workingRepositoryPath: repo,
      invocationId: 'batch:b%3Ac',
      flowName: 'review_batch',
      displayName: 'First review batch',
      status: 'scheduled',
    },
    { now: () => new Date('2026-07-18T12:01:00.000Z') },
  );
  const secondPath = await recordReviewInvocationAttempt(
    {
      workingRepositoryPath: repo,
      invocationId: 'batch:b-3Ac',
      flowName: 'review_batch',
      displayName: 'Second review batch',
      status: 'scheduled',
    },
    { now: () => new Date('2026-07-18T12:01:01.000Z') },
  );

  assert.ok(firstPath);
  assert.ok(secondPath);
  assert.notEqual(firstPath, secondPath);
  assert.match(
    await fs.readFile(firstPath, 'utf8'),
    /Invocation: batch:b%3Ac/u,
  );
  assert.match(
    await fs.readFile(secondPath, 'utf8'),
    /Invocation: batch:b-3Ac/u,
  );
});

test('pending-only cleanup preserves an explicit agent-decided outcome', async () => {
  const repo = await makeRepo();
  await initializeReviewCycle(
    { workingRepositoryPath: repo, mode: 'final' },
    {
      now: () => new Date('2026-07-18T12:00:00.000Z'),
      randomHex: () => '22222222',
    },
  );
  const explicit = await finalizeActiveReviewCycle(
    {
      workingRepositoryPath: repo,
      status: 'incomplete',
      reason: 'The auditor could not settle one finding.',
    },
    { now: () => new Date('2026-07-18T12:05:00.000Z') },
  );

  const afterCleanup = await finalizeActiveReviewCycleIfPending(
    {
      workingRepositoryPath: repo,
      fallbackStatus: 'completed',
    },
    { now: () => new Date('2026-07-18T12:10:00.000Z') },
  );

  assert.deepEqual(afterCleanup, explicit);
  assert.equal(afterCleanup?.completed_at, '2026-07-18T12:05:00.000Z');
});

test('pending-only cleanup records an honest fallback when no agent outcome arrived', async () => {
  const repo = await makeRepo();
  await initializeReviewCycle(
    { workingRepositoryPath: repo, mode: 'final' },
    {
      now: () => new Date('2026-07-18T12:00:00.000Z'),
      randomHex: () => '22222222',
    },
  );

  const result = await finalizeActiveReviewCycleIfPending(
    {
      workingRepositoryPath: repo,
      fallbackStatus: 'incomplete',
      fallbackReason: 'No explicit settlement outcome arrived.',
    },
    { now: () => new Date('2026-07-18T12:10:00.000Z') },
  );

  assert.equal(result?.status, 'incomplete');
  assert.equal(
    result?.incomplete_reason,
    'No explicit settlement outcome arrived.',
  );
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
    mode: 'final',
  });
  assert.equal(result.action, 'skipped_incomplete_story');
  assert.equal(
    JSON.parse(await fs.readFile(statePath, 'utf8')).review_phase,
    'slow',
  );
});
