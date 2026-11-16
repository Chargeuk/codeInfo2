import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseFlowFile } from '../../flows/flowSchema.js';

const repoRoot = path.resolve(process.cwd(), '..');
const raw = fs.readFileSync(
  path.join(repoRoot, 'flows/codeinfo2_implement_story.json'),
  'utf8',
);
type Step = {
  type: string;
  label: string;
  agentType?: string;
  identifier?: string;
  markdownFile?: string;
  continueOnFailure?: boolean;
  continueOnInvalidResponse?: boolean;
  breakOnFailure?: boolean;
  breakOn?: string;
  haltFlow?: boolean;
  question?: string;
  condition?: string;
  messages?: Array<{ content: string[] }>;
  failureMode?: string;
  groups?: Array<{ id: string; flowName: string }>;
  steps?: Step[];
  then?: Step[];
  else?: Step[];
};
const flow = JSON.parse(raw) as { description: string; steps: Step[] };
const flatten = (steps: Step[]): Step[] =>
  steps.flatMap((step) => [
    step,
    ...flatten(step.steps ?? []),
    ...flatten(step.then ?? []),
    ...flatten(step.else ?? []),
  ]);
const all = flatten(flow.steps);
const textOf = (step: Step) =>
  [
    step.question,
    step.condition,
    ...(step.messages ?? []).flatMap((m) => m.content),
  ]
    .filter(Boolean)
    .join('\n');

test('generic story flow parses and retains its recovery and native review graph', () => {
  const parsed = parseFlowFile(raw, { flowName: 'codeinfo2_implement_story' });
  assert.equal(parsed.ok, true);
  assert.deepEqual(
    flow.steps.map((step) => step.type),
    [
      ...Array(6).fill('llm'),
      'if',
      ...Array(5).fill('llm'),
      'if',
      ...Array(6).fill('llm'),
      'subflowWave',
      'llm',
      'subflowWave',
      'llm',
      'llm',
    ],
  );
  const labeling = flow.steps[4];
  assert.equal(
    flow.steps[3].markdownFile,
    'codeinfo2_implement_story/overview.md',
  );
  assert.match(labeling.label, /^4-label\./u);
  assert.match(flow.steps[5].label, /^4a\./u);
  assert.equal(labeling.type, 'llm');
  assert.equal(labeling.agentType, 'research_agent');
  assert.equal(labeling.identifier, 'codeinfo2_research_agent');
  assert.equal(labeling.continueOnFailure, true);
  assert.match(textOf(labeling), /CODEINFO2_AI_NAME.*dotenv data/u);
  assert.match(
    textOf(labeling),
    /preserving every existing label and all other ticket fields/u,
  );
  assert.match(textOf(labeling), /Confirm the result through read-back/u);
  const gate = flow.steps[6];
  assert.equal(gate.agentType, 'research_agent');
  assert.equal(gate.identifier, 'codeinfo2_research_agent');
  assert.equal(typeof gate.condition, 'string');
  assert.equal(gate.else, undefined);
  assert.deepEqual(
    gate.then?.map((step) => step.type),
    [...Array(7).fill('llm'), 'startLoop'],
  );
  const loop = gate.then?.[7] as Step;
  const loopExitPrompt = 'codeinfo2_implement_story/loop_exit.md';
  assert.ok(!textOf(loop.steps?.[2] as Step).includes(loopExitPrompt));
  assert.ok(textOf(flow.steps[10]).includes(loopExitPrompt));
  assert.deepEqual(
    loop.steps?.map((step) => step.type),
    [
      'llm',
      'break',
      'llm',
      'llm',
      'break',
      'llm',
      'llm',
      'llm',
      'llm',
      'llm',
      'llm',
    ],
  );
  assert.equal(all.length, 45);
  const decision = flow.steps[12];
  assert.equal(
    decision.then?.[0]?.groups?.[0]?.flowName,
    'document_completed_branch_story',
  );
  assert.equal(decision.else?.[0]?.type, 'llm');
  assert.deepEqual(
    all
      .filter((step) => step.type === 'subflowWave')
      .map((step) => [step.failureMode, step.groups?.[0]?.flowName]),
    [
      ['best_effort', 'document_completed_branch_story'],
      ['best_effort', 'implement_current_plan'],
      ['best_effort', 'pr_current_plan'],
    ],
  );
});

test('prompt references resolve inside the harness and avoid project-specific assumptions', () => {
  const prefix = '$CODEINFO_ROOT/codeinfo_markdown/';
  const promptRoot = path.resolve(
    repoRoot,
    'codeinfo_markdown/codeinfo2_implement_story',
  );
  const promptPaths = new Set<string>();
  const pending: string[] = [];
  const add = (relativePath: string) => {
    const resolved = path.resolve(repoRoot, 'codeinfo_markdown', relativePath);
    assert.ok(resolved.startsWith(`${promptRoot}${path.sep}`), relativePath);
    if (!promptPaths.has(relativePath)) {
      promptPaths.add(relativePath);
      pending.push(relativePath);
    }
  };
  const collectReferences = (body: string) => {
    const references = body.matchAll(
      /(?:\$CODEINFO_ROOT\/)?(?:codeinfo_markdown\/)?codeinfo2_implement_story\/[\w./-]+\.md/gu,
    );
    for (const match of references) {
      assert.ok(
        match[0].startsWith(prefix),
        `target-relative prompt reference: ${match[0]}`,
      );
      add(match[0].slice(prefix.length));
    }
  };
  for (const step of all) {
    if (step.markdownFile) add(step.markdownFile);
    collectReferences(textOf(step));
    if (step.identifier) assert.match(step.identifier, /^codeinfo2_/u);
  }
  while (pending.length > 0) {
    const prompt = pending.pop() as string;
    const file = path.join(repoRoot, 'codeinfo_markdown', prompt);
    assert.ok(fs.existsSync(file), prompt);
    collectReferences(fs.readFileSync(file, 'utf8'));
  }
  assert.ok(promptPaths.has('codeinfo2_implement_story/merge_base.md'));
  assert.ok(promptPaths.has('codeinfo2_implement_story/tracking.md'));
  assert.doesNotMatch(
    raw,
    /kadshow|\bSHW\b|\bADF\b|\bVR\b|\b2D\b|Patreon|\bdevelop\b|\/home\//iu,
  );
});

test('completion and halt decisions preserve failure handling flags', () => {
  const loop = flow.steps[6].then?.[7].steps ?? [];
  const completion = loop[1];
  const halt = loop[4];
  for (const decision of [completion, halt]) {
    assert.equal(decision.breakOn, 'yes');
    assert.equal(decision.continueOnFailure, true);
    assert.equal(decision.continueOnInvalidResponse, true);
    assert.equal(decision.breakOnFailure, false);
  }
  assert.equal(halt.haltFlow, true);
  for (const step of all.filter((item) => item.type === 'llm')) {
    assert.equal(step.continueOnFailure, true, step.label);
  }
});

test('local and PR review children are direct best-effort stages', () => {
  const local = flow.steps[19];
  assert.equal(local.type, 'subflowWave');
  assert.equal(local.groups?.[0]?.flowName, 'implement_current_plan');

  const remote = flow.steps[21];
  assert.equal(remote.type, 'subflowWave');
  assert.equal(remote.failureMode, 'best_effort');
  assert.equal(remote.groups?.[0]?.id, 'codeinfo2_pr_current_plan');
  assert.equal(remote.groups?.[0]?.flowName, 'pr_current_plan');
});

test('proposal self-assessment stages reference their intended prompt', () => {
  for (const stage of [
    flow.steps[6].then?.[2] as Step,
    flow.steps[6].then?.[7].steps?.[7] as Step,
  ]) {
    assert.match(
      textOf(stage),
      /\$CODEINFO_ROOT\/codeinfo_markdown\/codeinfo2_implement_story\/propose_plan\.md/u,
    );
  }
});

// These assertions cover instruction text, not future agent execution.
test('all base integrations preserve wanted human edits alongside existing boundaries', () => {
  const merges = all.filter((step) =>
    /^(?:1|18c|20a)\. Merge/u.test(step.label),
  );
  assert.equal(merges.length, 3);
  for (const merge of merges) {
    const instructions = textOf(merge);
    assert.match(
      instructions,
      /unexplained edits presumed intentional human changes/u,
      merge.label,
    );
    assert.match(
      instructions,
      /do not exclude preexisting story edits solely because of provenance/u,
      merge.label,
    );
    assert.match(
      instructions,
      /preserving newer desired edits rather than overwriting them from the baseline/u,
      merge.label,
    );
    assert.match(
      instructions,
      /Do not stage ephemeral\/ignored state or unrelated staged work/u,
      merge.label,
    );
    assert.match(
      instructions,
      /active\/unknown-writer and no-race safeguards/u,
      merge.label,
    );
    assert.match(instructions, /FULL integration merge commit/u, merge.label);
  }
});

test('human edit policy applies to readers and publication without authorship-only blocking', () => {
  const read = (name: string) =>
    fs.readFileSync(path.join(repoRoot, 'codeinfo_markdown', name), 'utf8');
  const shared = read('codeinfo2_implement_story/shared.md');
  assert.match(shared, /## Human edits and provenance/u);
  assert.match(
    shared,
    /Unexplained existing or newly observed in-scope file edits are presumed intentional wanted human changes/u,
  );
  assert.match(shared, /preserve and incorporate their latest contents/u);
  assert.match(
    shared,
    /do not pause, block, revert, or refuse their commit solely because authorship is unknown/u,
  );
  assert.match(
    shared,
    /genuine active or unresolved ownership of an actually dispatched worker/u,
  );
  assert.match(
    shared,
    /Forward this policy concisely with delegated assignments/u,
  );
  for (const name of [
    'shared/current-task-handoff.md',
    'shared/story_behavior_lock.md',
    'final_push.md',
  ]) {
    assert.match(
      read(name),
      /Human edits and provenance[^\n]+codeinfo2_implement_story\/shared\.md/u,
      name,
    );
  }
  assert.match(
    read('shared/story_behavior_lock.md'),
    /Before assessing drift or provenance[^\n]+Human edits and provenance/u,
  );
  const publish = read('codeinfo2_implement_story/publish.md');
  assert.match(
    publish,
    /Unknown file authorship alone does not make otherwise eligible in-scope work pending or unowned/u,
  );
  assert.match(
    publish,
    /include presumed wanted human edits in the verified repository scope/u,
  );
  assert.match(publish, /genuinely active or unresolved dispatched workers/u);
});
