import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseFlowFile } from '../../flows/flowSchema.js';

const repoRoot = path.resolve(process.cwd(), '..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('retrospective story flow reingests around distinct planning and tasking passes', () => {
  const raw = read('flows/document_completed_branch_story.json');
  const parsed = parseFlowFile(raw, {
    flowName: 'document_completed_branch_story',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const steps = parsed.flow.steps;
  const reingestSteps = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.type === 'reingest');
  assert.deepEqual(
    reingestSteps.map(({ step, index }) => [
      index,
      step.type === 'reingest' && 'target' in step ? step.target : null,
    ]),
    [
      [0, 'working'],
      [11, 'plan_scope'],
      [16, 'plan_scope'],
    ],
  );

  const prompts = steps
    .filter((step) => step.type === 'llm')
    .map((step) => ({
      agent: step.agentType,
      file: 'markdownFile' in step ? step.markdownFile : null,
    }));
  assert.deepEqual(
    prompts.map(({ agent }) => agent),
    [
      ...Array(8).fill('planning_agent'),
      'tasking_agent',
      'planning_agent',
      'planning_agent',
    ],
  );
  for (const { file } of prompts) {
    assert.ok(file);
    assert.ok(fs.existsSync(path.join(repoRoot, 'codeinfo_markdown', file)));
  }
  assert.equal(steps.at(-2)?.type, 'llm');
  assert.equal(steps.at(-1)?.type, 'reingest');
  for (const step of steps.filter((candidate) => candidate.type === 'break')) {
    assert.equal(step.breakOn, 'yes');
    assert.equal(step.haltFlow, true);
  }
});

test('retrospective prompts preserve an open full-validation task and best-effort push', () => {
  const tasking = read(
    'codeinfo_markdown/retrospective_story/09-task-completed-work.md',
  );
  const audit = read('codeinfo_markdown/retrospective_story/10-audit.md');
  const publish = read(
    'codeinfo_markdown/retrospective_story/11-commit-and-push.md',
  );

  for (const required of [
    'Task Status: __to_do__',
    'only initial `#### Subtasks` checkbox types',
    'every relevant full automated test suite',
    'Manual Testing Guidance',
    'Do not mark this task complete',
  ]) {
    assert.ok(tasking.includes(required), required);
  }
  assert.ok(audit.includes('final task is the only open task'));
  assert.ok(publish.includes('git diff --cached --check'));
  assert.ok(publish.includes('git push -u origin HEAD'));
  assert.ok(publish.includes('A push failure is nonfatal'));
});
