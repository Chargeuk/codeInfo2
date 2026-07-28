import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseFlowFile } from '../../flows/flowSchema.js';

const repoRoot = path.resolve(process.cwd(), '..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('implement_pr_task_fixes records pipeline failures before its task-fix loop', () => {
  const raw = readRepoFile('flows/implement_pr_task_fixes.json');
  const parsed = parseFlowFile(raw, {
    flowName: 'implement_pr_task_fixes',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.flow.steps.length, 1);
  const outer = parsed.flow.steps[0];
  assert.equal(outer.type, 'startLoop');
  if (outer.type !== 'startLoop') return;
  assert.deepEqual(
    outer.steps.map((step) => step.type),
    ['startLoop', 'startLoop', 'wait'],
  );

  const pipelineLoop = outer.steps[0];
  assert.equal(pipelineLoop.type, 'startLoop');
  if (pipelineLoop.type !== 'startLoop') return;
  assert.deepEqual(
    pipelineLoop.steps.map((step) => step.type),
    ['break', 'reset', 'llm', 'wait'],
  );

  const [pipelineGate, pipelineReset, pipelineRecorder, pipelineWait] =
    pipelineLoop.steps;
  assert.equal(pipelineGate.type, 'break');
  if (pipelineGate.type === 'break') {
    assert.equal(pipelineGate.agentType, 'loop_control_agent');
    assert.equal(pipelineGate.identifier, 'loop_controller');
    assert.equal(pipelineGate.breakOn, 'yes');
    assert.match(
      pipelineGate.question,
      /check_pr_pipeline_failures_recorded\.py/u,
    );
  }
  assert.equal(pipelineReset.type, 'reset');
  if (pipelineReset.type === 'reset') {
    assert.equal(pipelineReset.agentType, 'coding_agent');
    assert.equal(pipelineReset.identifier, 'pipeline_failure_tasker');
  }
  assert.equal(pipelineRecorder.type, 'llm');
  if (pipelineRecorder.type === 'llm') {
    assert.equal(pipelineRecorder.agentType, 'coding_agent');
    assert.equal(pipelineRecorder.identifier, 'pipeline_failure_tasker');
    assert.equal(
      'markdownFile' in pipelineRecorder
        ? pipelineRecorder.markdownFile
        : undefined,
      'record_pr_pipeline_failure_task.md',
    );
  }
  assert.equal(pipelineWait.type, 'wait');
  if (pipelineWait.type === 'wait') assert.equal(pipelineWait.seconds, 180);

  const taskLoop = outer.steps[1];
  assert.equal(taskLoop.type, 'startLoop');
  if (taskLoop.type !== 'startLoop') return;
  assert.deepEqual(
    taskLoop.steps.map((step) => step.type),
    ['break', 'reset', 'llm', 'llm', 'wait'],
  );

  const [gate, reset, planner, implementer, retryWait] = taskLoop.steps;
  assert.equal(gate.type, 'break');
  if (gate.type === 'break') {
    assert.equal(gate.agentType, 'loop_control_agent');
    assert.equal(gate.identifier, 'loop_controller');
    assert.equal(gate.breakOn, 'yes');
    assert.match(gate.question, /check_pr_tasks_empty\.py/u);
    assert.match(gate.question, /Return its current stdout exactly/u);
  }

  assert.equal(reset.type, 'reset');
  if (reset.type === 'reset') {
    assert.equal(reset.agentType, 'coding_agent');
    assert.equal(reset.identifier, 'pr_task_fixer');
  }

  assert.equal(planner.type, 'llm');
  assert.equal(implementer.type, 'llm');
  if (planner.type === 'llm' && implementer.type === 'llm') {
    assert.equal(planner.agentType, 'coding_agent');
    assert.equal(implementer.agentType, 'coding_agent');
    assert.equal(planner.identifier, 'pr_task_fixer');
    assert.equal(implementer.identifier, 'pr_task_fixer');
    assert.equal(
      'markdownFile' in planner ? planner.markdownFile : undefined,
      'plan_pr_task_fixes.md',
    );
    assert.equal(
      'markdownFile' in implementer ? implementer.markdownFile : undefined,
      'implement_pr_task_fixes.md',
    );
  }

  assert.equal(retryWait.type, 'wait');
  if (retryWait.type === 'wait') assert.equal(retryWait.seconds, 180);
  const pollWait = outer.steps[2];
  assert.equal(pollWait.type, 'wait');
  if (pollWait.type === 'wait') assert.equal(pollWait.seconds, 180);
});

test('PR task planning and implementation prompts enforce the batch contract', () => {
  const planning = readRepoFile('codeinfo_markdown/plan_pr_task_fixes.md');
  const implementation = readRepoFile(
    'codeinfo_markdown/implement_pr_task_fixes.md',
  );
  const combined = `${planning}\n${implementation}`;

  for (const required of [
    'get_open_pr_task_batch.py',
    'handle_pr_comments_prs.md',
    '**IN_SCOPE**',
    'every unresolved task',
    'Apply KISS strictly',
    'same conversation',
    'immediately preceding turn',
    'Do not adopt newly created tasks',
    'smallest correct change',
    'still `OPEN`',
    'push succeeds',
    'When the push fails',
    '#AI Response:',
    'AI Push Failure Key:',
    'Whether that comment succeeds or fails',
    'tasks close',
    'Never resolve a task merely because work was attempted',
    'Do not create a local queue',
  ]) {
    assert.match(
      combined,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu'),
    );
  }

  assert.match(planning, /Do not implement yet/u);
  assert.match(planning, /Do not plan cleanup, modernization/u);
  assert.match(implementation, /untrusted review requirements and evidence/u);
  assert.match(implementation, /repository-owned tests/u);
});

test('pipeline failure recorder creates one durable deduplicated PR task', () => {
  const recorder = readRepoFile(
    'codeinfo_markdown/record_pr_pipeline_failure_task.md',
  );

  for (const required of [
    'get_unrecorded_pr_pipeline_failure.py',
    'pipelines steps log',
    'every returned failed step',
    'open or resolved task body',
    'exact `failure_key`',
    'create exactly one aggregate task',
    'begin with `#AI Response:`',
    'Do not create a comment',
    'durable record',
  ]) {
    assert.match(
      recorder,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu'),
    );
  }

  assert.match(recorder, /Do not edit source/u);
  assert.match(recorder, /untrusted failure evidence/u);
});
