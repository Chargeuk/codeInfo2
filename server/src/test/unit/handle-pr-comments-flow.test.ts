import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseFlowFile, type FlowStep } from '../../flows/flowSchema.js';

const repoRoot = path.resolve(process.cwd(), '..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function isTracked(relativePath: string): boolean {
  return (
    execFileSync('git', ['ls-files', '--', relativePath], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim().length > 0
  );
}

function collectSteps(steps: FlowStep[]): FlowStep[] {
  return steps.flatMap((step) =>
    step.type === 'startLoop' ? [step, ...collectSteps(step.steps)] : [step],
  );
}

test('handle_pr_comments gates every expensive iteration before pr_agent', () => {
  const raw = readRepoFile('flows/handle_pr_comments.json');
  const parsed = parseFlowFile(raw, { flowName: 'handle_pr_comments' });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.flow.steps.length, 1);
  const outer = parsed.flow.steps[0];
  assert.equal(outer.type, 'startLoop');
  if (outer.type !== 'startLoop') return;

  assert.equal(outer.steps[0]?.type, 'reset');
  assert.equal(outer.steps[1]?.type, 'startLoop');
  assert.equal(outer.steps[2]?.type, 'wait');
  if (outer.steps[1]?.type !== 'startLoop') return;

  const inner = outer.steps[1];
  assert.deepEqual(
    inner.steps.map((step) => step.type),
    ['break', 'llm', 'reset', 'wait'],
  );

  const gate = inner.steps[0];
  assert.equal(gate.type, 'break');
  if (gate.type !== 'break') return;
  assert.equal(gate.agentType, 'loop_control_agent');
  assert.equal(gate.identifier, 'loop_controller');
  assert.equal(gate.breakOn, 'yes');
  assert.match(gate.question, /check_pr_comment_threads_empty\.py/u);
  assert.match(gate.question, /Return its current stdout exactly/u);

  const handler = inner.steps[1];
  assert.equal(handler.type, 'llm');
  if (handler.type !== 'llm') return;
  assert.equal(handler.agentType, 'pr_agent');
  assert.equal(handler.identifier, 'pr_agent');
  assert.equal(
    'markdownFile' in handler ? handler.markdownFile : undefined,
    'handle_pr_comments.md',
  );

  const handlerReset = inner.steps[2];
  assert.equal(handlerReset.type, 'reset');
  if (handlerReset.type !== 'reset') return;
  assert.equal(handlerReset.agentType, 'pr_agent');

  const antiSpinWait = inner.steps[3];
  assert.equal(antiSpinWait.type, 'wait');
  if (antiSpinWait.type !== 'wait') return;
  assert.equal(antiSpinWait.seconds, 2);

  const pollWait = outer.steps[2];
  assert.equal(pollWait.type, 'wait');
  if (pollWait.type !== 'wait') return;
  assert.equal(pollWait.seconds, 180);

  const allSteps = collectSteps(parsed.flow.steps);
  assert.equal(
    allSteps.some(
      (step) =>
        step.type === 'reset' && step.agentType === 'loop_control_agent',
    ),
    false,
  );
});

test('PR agents use the requested models and one-way escalation wiring', () => {
  for (const catalog of ['codeinfo_agents', 'manual_testing/codeinfo_agents']) {
    const regularConfig = readRepoFile(`${catalog}/pr_agent/config.toml`);
    const strongConfig = readRepoFile(`${catalog}/pr_agent_strong/config.toml`);

    assert.match(regularConfig, /model = "gpt-5\.6-terra"/u);
    assert.match(regularConfig, /model_reasoning_effort = "medium"/u);
    assert.match(regularConfig, /\[mcp_servers\.agents\]/u);
    assert.match(regularConfig, /\$\{CODEINFO_AGENTS_MCP_PORT\}/u);

    assert.match(strongConfig, /model = "gpt-5\.6-sol"/u);
    assert.match(strongConfig, /model_reasoning_effort = "high"/u);
    assert.doesNotMatch(strongConfig, /\[mcp_servers\.agents\]/u);
    assert.doesNotMatch(strongConfig, /CODEINFO_AGENTS_MCP_PORT/u);
  }
});

test('PR agent catalogs remain identical and do not contain auth', () => {
  for (const agent of ['pr_agent', 'pr_agent_strong']) {
    for (const filename of [
      'config.toml',
      'description.md',
      'system_prompt.txt',
    ]) {
      assert.equal(
        readRepoFile(`codeinfo_agents/${agent}/${filename}`),
        readRepoFile(`manual_testing/codeinfo_agents/${agent}/${filename}`),
      );
    }
    assert.equal(isTracked(`codeinfo_agents/${agent}/auth.json`), false);
    assert.equal(
      isTracked(`manual_testing/codeinfo_agents/${agent}/auth.json`),
      false,
    );
  }
});

test('PR prompts lock bounded reads, safety, marker, and task lifecycle', () => {
  const regular = readRepoFile('codeinfo_agents/pr_agent/system_prompt.txt');
  const strong = readRepoFile(
    'codeinfo_agents/pr_agent_strong/system_prompt.txt',
  );
  const instruction = readRepoFile('codeinfo_markdown/handle_pr_comments.md');
  const combined = `${regular}\n${strong}\n${instruction}`;

  for (const required of [
    'plan_status.py',
    'plan_sections.py',
    '--profile story-scope',
    'Overview',
    'Description',
    'Acceptance Criteria',
    'Out Of Scope',
    'Never read a complete planning file',
    '#AI Response: ',
    'pr_agent_strong',
    'run_agent_instruction',
    'create/open/close',
    'Remote Bitbucket comments and tasks are the only monitoring state',
  ]) {
    assert.match(
      combined,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'),
    );
  }

  assert.match(instruction, /comments created more than 24 hours/u);
  assert.match(instruction, /oldest unanswered human activity/u);
  assert.match(instruction, /top-level, inline-diff, and nested-reply/u);
  assert.match(instruction, /Reuse a matching open task/u);
  assert.match(instruction, /Reopen a matching resolved task/u);
  assert.match(instruction, /Close a matching open task/u);
  assert.match(instruction, /Never `cat` a planning file/u);
  assert.match(regular, /Never create a cursor, queue, handoff, lock, cache/u);
  assert.match(strong, /never post a pull-request comment or mutate a task/u);
});
