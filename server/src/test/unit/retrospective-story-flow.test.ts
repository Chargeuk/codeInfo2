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
      [8, 'plan_scope'],
      [16, 'plan_scope'],
    ],
  );

  const prompts = steps
    .filter((step) => step.type === 'llm')
    .map((step) => ({
      agent: step.agentType,
      identifier: step.identifier,
      file: 'markdownFile' in step ? step.markdownFile : null,
    }));
  assert.deepEqual(
    prompts.map(({ agent }) => agent),
    [
      'planning_agent',
      'planning_agent_lite',
      'planning_agent',
      'planning_agent_lite',
      'planning_agent',
      'planning_agent_lite',
      'planning_agent_lite',
      'tasking_agent',
      'tasking_agent',
      'tasking_agent_lite',
      'tasking_agent_lite',
      'tasking_agent_lite',
      'planning_agent',
      'planning_agent_lite',
    ],
  );
  assert.ok(
    prompts
      .filter(({ agent }) => agent === 'planning_agent_lite')
      .every(({ identifier }) => identifier === 'retrospective_planner_lite'),
  );
  assert.equal(steps.filter((step) => step.type === 'break').length, 0);
  assert.deepEqual(
    prompts
      .filter(({ agent }) => agent.startsWith('tasking_agent'))
      .map(({ file }) => file),
    [
      'retrospective_story/tasking/01-inventory.md',
      'retrospective_story/tasking/02-completed-tasks.md',
      'retrospective_story/tasking/03-final-validation.md',
      'retrospective_story/tasking/04-check.md',
      'retrospective_story/tasking/05-repair.md',
    ],
  );
  assert.ok(
    prompts
      .filter(({ agent }) => agent === 'tasking_agent_lite')
      .every(({ identifier }) => identifier === 'retrospective_tasker_lite'),
  );
  for (const { file } of prompts) {
    assert.ok(file);
    assert.ok(fs.existsSync(path.join(repoRoot, 'codeinfo_markdown', file)));
  }
  assert.equal(steps.at(-2)?.type, 'llm');
  assert.equal(steps.at(-1)?.type, 'reingest');
});

test('lite tasker is available in both supported agent catalogs', () => {
  const agent = 'tasking_agent_lite';
  const catalogRoot = `codeinfo_agents/${agent}`;
  const manualRoot = `manual_testing/codeinfo_agents/${agent}`;

  for (const file of ['config.toml', 'system_prompt.txt', 'description.md']) {
    assert.equal(read(`${catalogRoot}/${file}`), read(`${manualRoot}/${file}`));
  }
  const config = read(`${catalogRoot}/config.toml`);
  assert.match(config, /^model = "gpt-6-luna"$/mu);
  assert.match(config, /^model_reasoning_effort = "medium"$/mu);
  assert.match(config, /^\[mcp_servers\.code_info\]$/mu);
});

test('retrospective prompts preserve an open full-validation task and best-effort push', () => {
  const finalTask = read(
    'codeinfo_markdown/retrospective_story/tasking/03-final-validation.md',
  );
  const audit = read('codeinfo_markdown/retrospective_story/10-audit.md');
  const publish = read(
    'codeinfo_markdown/retrospective_story/11-commit-and-push.md',
  );

  for (const required of [
    'Task Status: __to_do__',
    'only supported lint and formatting checklist-item types',
    'every relevant full automated suite',
    'Manual Testing Guidance',
    'Do not run the final task now',
  ]) {
    assert.ok(finalTask.includes(required), required);
  }
  assert.ok(audit.includes('final task is the only open task'));
  assert.ok(publish.includes('git diff --cached --check'));
  assert.ok(publish.includes('git push -u origin HEAD'));
  assert.ok(publish.includes('A commit or push failure is nonfatal'));
});

test('tasking uses separate inventory, creation, final task, check, and repair passes', () => {
  const taskingRoot = 'codeinfo_markdown/retrospective_story/tasking';
  const inventory = read(`${taskingRoot}/01-inventory.md`);
  const completed = read(`${taskingRoot}/02-completed-tasks.md`);
  const finalTask = read(`${taskingRoot}/03-final-validation.md`);
  const check = read(`${taskingRoot}/04-check.md`);
  const repair = read(`${taskingRoot}/05-repair.md`);

  assert.ok(inventory.includes('Do not edit the plan'));
  assert.ok(completed.includes('Do not create the final validation task'));
  assert.ok(finalTask.includes('Append exactly one dedicated'));
  assert.ok(check.includes('Do not edit, commit, or push'));
  assert.ok(repair.includes('Repair concrete omissions and contradictions'));
  assert.ok(repair.includes('plan_status.py'));
});

test('acceptance and audit passes enforce the three standing code-quality criteria', () => {
  const acceptance = read(
    'codeinfo_markdown/retrospective_story/03-acceptance.md',
  );
  const tasking = read(
    'codeinfo_markdown/retrospective_story/tasking/02-completed-tasks.md',
  );
  const audit = read('codeinfo_markdown/retrospective_story/10-audit.md');

  for (const required of [
    'no unused variables, parameters, functions, statements, or redundant lines',
    'both what it does and why the change was made',
    'previously existing code unused',
  ]) {
    assert.ok(acceptance.includes(required), required);
  }
  assert.ok(acceptance.includes('record the concrete affected files'));
  assert.ok(
    tasking.includes('three standing code-quality acceptance criteria'),
  );
  assert.ok(audit.includes('restore it'));
  assert.ok(
    audit.includes('Preserve the distinction between observed implementation'),
  );

  const flow = JSON.parse(
    read('flows/document_completed_branch_story.json'),
  ) as {
    steps: Array<{ type: string; markdownFile?: string }>;
  };
  assert.ok(flow.steps.every((step) => step.type !== 'break'));
  assert.ok(
    flow.steps.every(
      (step) => step.markdownFile !== 'retrospective_story/07-questions.md',
    ),
  );
});
