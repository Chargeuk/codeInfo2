import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { FlowResumeState } from '../../flows/flowState.js';
import { reconcileInterruptedFlowResumeStateForStartup } from '../../flows/service.js';

const serverRoot = process.cwd();

const baseState = (): FlowResumeState => ({
  executionId: 'execution-1',
  stepPath: [0, 2],
  loopStack: [{ loopStepPath: [0], iteration: 3 }],
  activeSubflows: [
    {
      stepPath: [0, 2],
      flowName: 'codex_review',
      conversationId: 'child-1',
      runToken: 'run-1',
    },
  ],
  subflowWaveProgress: {
    stepPath: [0, 2],
    expected: 2,
    running: 1,
    completed: 1,
    failed: 0,
    stopped: 0,
    notApplicable: 0,
    jobs: [
      {
        instanceId: 'job-1',
        flowName: 'codex_review',
        title: 'Codex review',
        status: 'running',
      },
      {
        instanceId: 'job-2',
        flowName: 'open_code_review',
        title: 'Open Code review',
        status: 'completed',
      },
    ],
    updatedAt: '2026-07-18T00:00:00.000Z',
  },
  agentConversations: {},
  agentThreads: {},
});

test('startup reconciliation preserves tracked children for deduplicated explicit resume', () => {
  const reconciled = reconcileInterruptedFlowResumeStateForStartup(
    baseState(),
    '2026-07-18T08:00:00.000Z',
  );

  assert(reconciled);
  assert.deepEqual(reconciled.activeSubflows, baseState().activeSubflows);
  assert.deepEqual(
    reconciled.subflowWaveProgress,
    baseState().subflowWaveProgress,
  );
  assert.deepEqual(reconciled.restartReconciliation, {
    status: 'interrupted',
    reconciledAt: '2026-07-18T08:00:00.000Z',
    resumeStepPath: [0, 2],
    interruptedSubflowCount: 1,
    interruptedWaveRunningCount: 1,
  });
  assert.deepEqual(reconciled.loopStack, [{ loopStepPath: [0], iteration: 3 }]);
});

test('startup reconciliation leaves a non-running checkpoint untouched', () => {
  const state = baseState();
  state.activeSubflows = undefined;
  state.subflowWaveProgress = undefined;

  assert.equal(reconcileInterruptedFlowResumeStateForStartup(state), null);
});

test('startup reconciliation marks a pending-only wave as interrupted', () => {
  const state = baseState();
  state.activeSubflows = undefined;
  state.subflowWaveProgress = {
    ...state.subflowWaveProgress!,
    running: 0,
    completed: 0,
    jobs: state.subflowWaveProgress!.jobs.map((job) => ({
      ...job,
      status: 'pending',
    })),
  };

  const reconciled = reconcileInterruptedFlowResumeStateForStartup(
    state,
    '2026-07-18T09:00:00.000Z',
  );

  assert(reconciled);
  assert.equal(
    reconciled.restartReconciliation?.interruptedWaveRunningCount,
    2,
  );
  assert.equal(reconciled.runLifecycle?.status, 'orphaned');
});

test('server waits for startup reconciliation before accepting HTTP traffic', () => {
  const indexSource = fs.readFileSync(path.join(serverRoot, 'src/index.ts'), 'utf8');
  const reconciliationIndex = indexSource.indexOf(
    'await reconcileInterruptedFlowRunsForStartup()',
  );
  const listenIndex = indexSource.indexOf('server = httpServer.listen');

  assert.notEqual(reconciliationIndex, -1);
  assert.notEqual(listenIndex, -1);
  assert.ok(reconciliationIndex < listenIndex);
});
