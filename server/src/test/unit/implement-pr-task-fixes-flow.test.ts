import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseFlowFile } from '../../flows/flowSchema.js';

const repoRoot = path.resolve(process.cwd(), '..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('implement_pr_task_fixes uses two nested loops and one reset two-step coder', () => {
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
    ['startLoop', 'wait'],
  );

  const inner = outer.steps[0];
  assert.equal(inner.type, 'startLoop');
  if (inner.type !== 'startLoop') return;
  assert.deepEqual(
    inner.steps.map((step) => step.type),
    ['break', 'reset', 'llm', 'llm', 'wait'],
  );

  const [gate, reset, planner, implementer, retryWait] = inner.steps;
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
  const pollWait = outer.steps[1];
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
