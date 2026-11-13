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
      ...Array(12).fill('llm'),
      'startLoop',
      ...Array(5).fill('llm'),
      'if',
      ...Array(6).fill('llm'),
      'subflowWave',
      'llm',
      'if',
      'llm',
      'llm',
    ],
  );
  const loop = flow.steps[12];
  const loopExitPrompt = 'codeinfo2_implement_story/loop_exit.md';
  assert.ok(!textOf(loop.steps?.[2] as Step).includes(loopExitPrompt));
  assert.ok(textOf(flow.steps[16]).includes(loopExitPrompt));
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
  const decision = flow.steps[18];
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
    /kadshow|\bSHW\b|\bJira\b|\bADF\b|\bVR\b|\b2D\b|Patreon|\bdevelop\b|\/home\//iu,
  );
});

test('completion and halt decisions preserve failure handling flags', () => {
  const loop = flow.steps[12].steps ?? [];
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

test('remote review applicability preserves the local child and generic fallback', () => {
  const local = flow.steps[25];
  assert.equal(local.type, 'subflowWave');
  assert.equal(local.groups?.[0]?.flowName, 'implement_current_plan');

  const remote = flow.steps[27];
  assert.equal(remote.type, 'if');
  assert.equal(remote.agentType, 'research_agent');
  assert.equal(remote.identifier, 'codeinfo2_research_agent');
  assert.equal(remote.then?.length, 1);
  assert.equal(remote.then?.[0]?.type, 'subflowWave');
  assert.equal(remote.then?.[0]?.failureMode, 'best_effort');
  assert.equal(remote.then?.[0]?.groups?.[0]?.id, 'codeinfo2_pr_current_plan');
  assert.equal(remote.then?.[0]?.groups?.[0]?.flowName, 'pr_current_plan');
  assert.equal(remote.else?.length, 1);
  assert.equal(remote.else?.[0]?.type, 'llm');
  assert.equal(remote.else?.[0]?.continueOnFailure, true);
  assert.equal(remote.else?.[0]?.agentType, 'research_agent');
  assert.equal(remote.else?.[0]?.identifier, 'codeinfo2_research_agent');
  assert.equal(
    remote.else?.[0]?.markdownFile,
    'codeinfo2_implement_story/remote_review.md',
  );
  assert.ok(!flatten([remote]).some((step) => step.type === 'startLoop'));
});

test('proposal self-assessment stages reference their intended prompt', () => {
  for (const stage of [flow.steps[7], flow.steps[12].steps?.[7] as Step]) {
    assert.match(
      textOf(stage),
      /\$CODEINFO_ROOT\/codeinfo_markdown\/codeinfo2_implement_story\/self_review\.md/u,
    );
    assert.doesNotMatch(
      textOf(stage),
      /codeinfo2_implement_story\/propose_plan\.md/u,
    );
  }
});
