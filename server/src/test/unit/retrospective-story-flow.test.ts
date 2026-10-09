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
  assert.deepEqual([...new Set(steps.map((step) => step.type))].sort(), [
    'llm',
    'reingest',
  ]);
  assert.equal(
    steps[0]?.type === 'llm' && 'markdownFile' in steps[0]
      ? steps[0].markdownFile
      : null,
    'retrospective_story/00-archive-existing-story.md',
  );
  assert.equal(steps[2]?.type, 'llm');
  assert.equal(
    steps[3]?.type === 'llm' && 'markdownFile' in steps[3]
      ? steps[3].markdownFile
      : null,
    'retrospective_story/01-publish-branch.md',
  );
  const reingestSteps = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.type === 'reingest');
  assert.deepEqual(
    reingestSteps.map(({ step, index }) => [
      index,
      step.type === 'reingest' && 'target' in step ? step.target : null,
    ]),
    [
      [1, 'working'],
      [9, 'plan_scope'],
      [17, 'plan_scope'],
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
      'planning_agent_lite',
      'planning_agent',
      'planning_agent_lite',
      'planning_agent_lite',
      'planning_agent',
      'planning_agent_lite',
      'planning_agent',
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
    const prompt = read(`codeinfo_markdown/${file}`);
    assert.ok(!prompt.includes('### Questions'), file);
    assert.ok(!prompt.includes('No Further Questions'), file);
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
  const earlyPublish = read(
    'codeinfo_markdown/retrospective_story/01-publish-branch.md',
  );
  const layout = read(
    'codeinfo_markdown/retrospective_story/01-create-layout.md',
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
  assert.ok(publish.includes('remove any `- **BLOCKER**` line'));
  assert.ok(publish.includes('git push -u origin HEAD'));
  assert.ok(publish.includes('A commit or push failure is nonfatal'));
  assert.ok(layout.includes('select_retrospective_story_number.py'));
  assert.ok(earlyPublish.includes('--owned-plan'));
  assert.ok(earlyPublish.includes('git push -u origin HEAD'));
  assert.ok(earlyPublish.includes('A failed push is nonfatal'));
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
  assert.ok(
    completed.includes(
      'do not copy its generic instruction to record implementation blockers',
    ),
  );
  assert.ok(finalTask.includes('Append exactly one dedicated'));
  assert.ok(check.includes('Do not edit, commit, or push'));
  assert.ok(repair.includes('Repair concrete omissions and contradictions'));
  assert.ok(repair.includes('plan_status.py'));
});

test('acceptance and audit passes enforce test coverage and code-quality criteria', () => {
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
  assert.ok(acceptance.includes('does not judge coverage'));
  assert.ok(
    acceptance.includes('Appropriate automated tests cover the new behavior'),
  );
  assert.ok(acceptance.includes('When the work is internal only'));
  assert.ok(acceptance.includes('no additional user-facing behavior'));
  assert.ok(tasking.includes('four standing acceptance requirements'));
  assert.ok(audit.includes('Restore missing criteria'));
  assert.ok(audit.includes('appropriate automated test coverage'));
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

test('retrospective scope stays tied to observed branch work for later review', () => {
  const flow = JSON.parse(
    read('flows/document_completed_branch_story.json'),
  ) as {
    steps: Array<{ markdownFile?: string }>;
  };
  assert.ok(
    flow.steps.every(
      (step) =>
        step.markdownFile !== 'retrospective_story/08-implementation-ideas.md',
    ),
  );

  const description = read(
    'codeinfo_markdown/retrospective_story/02-description.md',
  );
  const outOfScope = read(
    'codeinfo_markdown/retrospective_story/04-out-of-scope.md',
  );
  const inventory = read(
    'codeinfo_markdown/retrospective_story/tasking/01-inventory.md',
  );
  const audit = read('codeinfo_markdown/retrospective_story/10-audit.md');
  assert.ok(description.includes('Fill `## Implementation Ideas`'));
  assert.ok(
    outOfScope.includes(
      'Additional user-facing behavior beyond the observed implementation',
    ),
  );
  assert.ok(outOfScope.includes('For every implemented behavior or workflow'));
  assert.ok(outOfScope.includes('concrete conceptual boundary'));
  assert.ok(outOfScope.includes('shared file, subsystem, keyword'));
  assert.ok(outOfScope.includes('For internal-only work'));
  assert.ok(
    outOfScope.includes('further user-facing behavior or interface change'),
  );
  assert.ok(inventory.includes('observed changes'));
  assert.ok(audit.includes('inferred future behavior'));
  assert.ok(audit.includes('story-specific conceptual boundaries'));
});

test('retrospective steps recover inputs without a previous agent conversation', () => {
  const flow = JSON.parse(
    read('flows/document_completed_branch_story.json'),
  ) as {
    steps: Array<{ type: string; markdownFile?: string }>;
  };
  const shared = read('codeinfo_markdown/retrospective_story/shared.md');
  assert.ok(shared.includes('The initial layout step creates this flow'));
  assert.ok(shared.includes('recover needed facts from the plan, Git, source'));

  for (const step of flow.steps.filter((item) => item.type === 'llm')) {
    assert.ok(step.markdownFile);
    assert.ok(
      read(`codeinfo_markdown/${step.markdownFile}`).includes(
        'retrospective_story/shared.md',
      ),
      step.markdownFile,
    );
  }

  const taskingRoot = 'codeinfo_markdown/retrospective_story/tasking';
  assert.ok(
    read(`${taskingRoot}/02-completed-tasks.md`).includes(
      'Do not require or rely on the previous agent',
    ),
  );
  assert.ok(
    read(`${taskingRoot}/04-check.md`).includes(
      'not a required handoff artifact',
    ),
  );
  assert.ok(
    read(`${taskingRoot}/05-repair.md`).includes(
      'Independently repeat the task coverage and proof checks',
    ),
  );
});

test('retrospective story sections and tasks use code, comments, and commit messages as evidence', () => {
  const shared = read('codeinfo_markdown/retrospective_story/shared.md');
  const description = read(
    'codeinfo_markdown/retrospective_story/02-description.md',
  );
  const acceptance = read(
    'codeinfo_markdown/retrospective_story/03-acceptance.md',
  );
  const outOfScope = read(
    'codeinfo_markdown/retrospective_story/04-out-of-scope.md',
  );
  const inventory = read(
    'codeinfo_markdown/retrospective_story/tasking/01-inventory.md',
  );
  const tasking = read(
    'codeinfo_markdown/retrospective_story/tasking/02-completed-tasks.md',
  );
  const audit = read('codeinfo_markdown/retrospective_story/10-audit.md');

  assert.ok(shared.includes('newly added or modified comments'));
  assert.ok(
    shared.includes('subject and body of relevant implementation commits'),
  );
  assert.ok(
    shared.includes('verify against current code, tests, and the actual diff'),
  );
  for (const prompt of [
    description,
    acceptance,
    outOfScope,
    inventory,
    tasking,
    audit,
  ]) {
    assert.match(prompt, /comments/u);
    assert.match(prompt, /commit (?:subjects and bodies|messages)/u);
  }
  assert.ok(tasking.includes('In Implementation notes'));
});

test('retrospective agents document provenance without creating blockers or review findings', () => {
  const shared = read('codeinfo_markdown/retrospective_story/shared.md');
  const acceptance = read(
    'codeinfo_markdown/retrospective_story/03-acceptance.md',
  );
  const check = read(
    'codeinfo_markdown/retrospective_story/tasking/04-check.md',
  );
  const repair = read(
    'codeinfo_markdown/retrospective_story/tasking/05-repair.md',
  );
  const finalTask = read(
    'codeinfo_markdown/retrospective_story/tasking/03-final-validation.md',
  );
  const audit = read('codeinfo_markdown/retrospective_story/10-audit.md');

  assert.ok(shared.includes('Omit the Questions section'));
  assert.ok(shared.includes('do not create or consult it'));
  assert.ok(
    shared.includes('Never build, execute tests, run lint or formatting tools'),
  );
  assert.ok(
    shared.includes('It is not a code review or a test-adequacy review'),
  );
  assert.ok(shared.includes('Do not add `- **BLOCKER**` lines'));
  assert.ok(shared.includes('overrides blocker advice in `plan_format.md`'));
  assert.ok(
    acceptance.includes(
      'Do not assess whether the code or test coverage passes',
    ),
  );
  assert.ok(finalTask.includes('Do not add `- **BLOCKER**` lines'));
  assert.ok(
    check.includes('documentation consistency check, not a code review'),
  );
  assert.ok(check.includes('Flag any `- **BLOCKER**` line'));
  assert.ok(repair.includes('Remove blocker lines'));
  assert.ok(audit.includes('Remove every `- **BLOCKER**` line'));
});

test('archive prompts preserve ownership and keep relocation out of delivered scope', () => {
  const archive = read(
    'codeinfo_markdown/retrospective_story/00-archive-existing-story.md',
  );
  const shared = read('codeinfo_markdown/retrospective_story/shared.md');
  const layout = read(
    'codeinfo_markdown/retrospective_story/01-create-layout.md',
  );
  const commit = read(
    'codeinfo_markdown/retrospective_story/11-commit-and-push.md',
  );

  for (const required of [
    'FIRST step, before working reingest',
    'archive_retrospective_story.py',
    'fresh current branch',
    'never an old current-plan handoff',
    'No matching story is a normal no-op',
    'safe no-ops with reasons',
    'Do not select the archived one-shot filename',
    'retrospective-archive.json',
  ]) {
    assert.ok(archive.includes(required), required);
  }
  assert.ok(shared.includes('source deletion from delivered implementation'));
  assert.ok(shared.includes('planning/*.md'));
  assert.ok(shared.includes('Do not let the archive alter'));
  assert.ok(layout.includes('Copy a verified archived receipt'));
  assert.ok(layout.includes('new canonical numbered plan'));
  assert.ok(shared.includes('preserve it through branch publication'));
  assert.ok(
    shared.includes('all `retrospective_archive.entries` independently'),
  );
  assert.ok(
    shared.includes(
      'a prior receipt never suppresses a present replacement source',
    ),
  );
  assert.ok(
    shared.includes(
      'Several matching files are confirmed scope, not ambiguity',
    ),
  );
  assert.ok(shared.includes('positive integer suffix relationship'));
  assert.ok(archive.includes('deterministic filename order'));
  assert.ok(
    archive.includes('Exclusive destination creation retries occupied names'),
  );
  assert.ok(archive.includes('Per-file archive errors are nonfatal'));
  assert.ok(
    archive.includes('If no sources remain, recover verified prior entries'),
  );
  assert.ok(!archive.includes('destination collisions are safe no-ops'));
  assert.ok(!archive.includes('ambiguous matches'));
  assert.ok(commit.includes('Include ALL verified archive destinations'));
  assert.ok(commit.includes('Retain earlier verified pending mappings'));
  assert.ok(commit.includes('deduplicated explicit path list'));
  assert.ok(
    commit.includes('an absent untracked source is not a Git pathspec'),
  );
  assert.ok(commit.includes('git add -A -- <story paths>'));
  assert.ok(commit.includes('do not attempt a separate `git rm`'));
  assert.ok(commit.includes('Preserve unrelated staged files'));
  assert.ok(commit.includes('ignored archive receipt must remain uncommitted'));
  assert.ok(read('.gitignore').includes('retrospective-archive.json'));
});

test('every writing and checking pass applies branch documentation evidence rules', () => {
  const flow = JSON.parse(
    read('flows/document_completed_branch_story.json'),
  ) as {
    steps: Array<{ type: string; markdownFile?: string }>;
  };
  const shared = read('codeinfo_markdown/retrospective_story/shared.md');
  for (const required of [
    'story-owned staged, unstaged, and untracked documentation',
    'Current behavior claims must agree with current implementation and the actual diff',
    'Use relevant earlier commits and code for historical evolution',
    'abandoned or superseded approaches as historical',
    'code does not prove motivation',
    'Authored documentation and tests do not prove execution or test passes',
    'Original-plan proposals, template text, and unsupported documentation claims',
    'factual evidence limits, not blockers or code-review findings',
  ]) {
    assert.ok(shared.includes(required), required);
  }
  for (const step of flow.steps.filter((item) => item.type === 'llm')) {
    assert.ok(step.markdownFile);
    const prompt = read(`codeinfo_markdown/${step.markdownFile}`);
    if (step.markdownFile.endsWith('00-archive-existing-story.md')) {
      assert.ok(prompt.includes('Relevant branch-authored documentation'));
      continue;
    }
    // Individual prompts must invoke the contract even in independent agent turns.
    for (const required of [
      'shared documentation evidence contract',
      'branch-authored README/docs',
      'design and architecture notes, changelogs',
      'archived original story',
      'staged, unstaged, and untracked docs',
      'implementation and actual diff',
      'attribute documented rationale',
      'superseded approaches as historical',
      'never extra tasks, blockers, review findings, or proof of test passes',
      'Process all `retrospective_archive.entries` independently',
      'preserve every verified mapping in any handoff update',
      'exclude administrative archive changes from delivered implementation',
    ]) {
      assert.ok(prompt.includes(required), `${step.markdownFile}: ${required}`);
    }
  }
});
