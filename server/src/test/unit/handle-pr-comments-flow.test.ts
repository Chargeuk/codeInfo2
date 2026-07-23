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

function readTomlSection(content: string, section: string): string {
  const heading = `[${section}]`;
  const start = content.indexOf(heading);
  assert.notEqual(start, -1, `missing TOML section ${heading}`);
  const bodyStart = start + heading.length;
  const nextHeading = content.indexOf('\n[', bodyStart);
  return content.slice(bodyStart, nextHeading === -1 ? undefined : nextHeading);
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

    assert.match(regularConfig, /model = "gpt-5\.6-luna"/u);
    assert.match(regularConfig, /model_reasoning_effort = "medium"/u);
    assert.match(regularConfig, /\[mcp_servers\.agents\]/u);
    assert.match(regularConfig, /\$\{CODEINFO_AGENTS_MCP_PORT\}/u);
    assert.match(
      readTomlSection(regularConfig, 'mcp_servers.code_info'),
      /tool_timeout_sec = 1800/u,
    );
    assert.match(
      readTomlSection(regularConfig, 'mcp_servers.agents'),
      /tool_timeout_sec = 3600/u,
    );

    assert.match(strongConfig, /model = "gpt-5\.6-sol"/u);
    assert.match(strongConfig, /model_reasoning_effort = "high"/u);
    assert.match(
      readTomlSection(strongConfig, 'mcp_servers.code_info'),
      /tool_timeout_sec = 1800/u,
    );
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

  assert.match(instruction, /visible final leaf/u);
  assert.match(instruction, /created within the last 24 hours/u);
  assert.match(instruction, /Order eligible leaves by creation time/u);
  assert.match(instruction, /top-level, inline-diff, and nested replies/u);
  assert.match(instruction, /complete path from the root/u);
  assert.match(instruction, /every grouped eligible leaf/u);
  assert.match(instruction, /Never silently ignore a leaf/u);
  assert.match(instruction, /parent must be the leaf being answered/u);
  assert.match(instruction, /may take up to one hour/u);
  assert.match(instruction, /do not start a duplicate escalation/u);
  assert.match(instruction, /same returned `conversationId`/u);
  assert.match(instruction, /operational failure is not/iu);
  assert.match(instruction, /Reuse a matching open task/u);
  assert.match(instruction, /Reopen a matching resolved task/u);
  assert.match(instruction, /Close a matching open task/u);
  assert.match(instruction, /Never `cat` a planning file/u);
  assert.match(regular, /Never create a cursor, queue, handoff, lock, cache/u);
  assert.match(regular, /Every visible non-AI leaf/u);
  assert.match(regular, /Never silently ignore or suppress/u);
  assert.match(regular, /eligible leaf comment ID as the parent/u);
  assert.match(regular, /Escalation is exceptional/u);
  assert.match(regular, /never start a duplicate escalation/u);
  assert.match(strong, /never post a pull-request comment or mutate a task/u);
});

test('valid code changes stage aggregate evidence and tasks before replies', () => {
  const regular = readRepoFile('codeinfo_agents/pr_agent/system_prompt.txt');
  const strong = readRepoFile(
    'codeinfo_agents/pr_agent_strong/system_prompt.txt',
  );
  const instruction = readRepoFile('codeinfo_markdown/handle_pr_comments.md');

  const aggregateStage = instruction.indexOf(
    '### 2. Create or reuse one aggregate annotation when needed',
  );
  const taskStage = instruction.indexOf('### 3. Create the aggregate task');
  const replyStage = instruction.indexOf('## Reply to every grouped leaf last');
  assert.ok(aggregateStage >= 0);
  assert.ok(taskStage > aggregateStage);
  assert.ok(replyStage > taskStage);

  for (const required of [
    'Do not post an acknowledgement to a source leaf',
    '--path <path> --line <line>',
    '--from <line>',
    'top-level aggregate comment',
    '--comment-id <aggregate-comment-id>',
    "primary source leaf's ID as `--comment-id`",
    '/_/diff#task-<task-id>',
    'do not create another task or a new aggregate annotation',
    'reuse any aggregate comments, tasks, or successful sibling replies',
    'required aggregate-PR comments, source-leaf replies, and aggregate task operations',
  ]) {
    assert.match(
      instruction,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'),
    );
  }

  assert.match(regular, /idempotent ordered sequence/u);
  assert.match(regular, /Only after all required aggregate writes succeed/u);
  assert.match(regular, /never post an early acknowledgement/u);
  assert.match(regular, /Every automated public comment and task body/u);
  assert.match(strong, /code-change and task recommendation/u);
  assert.match(strong, /justified aggregate diff anchor/u);
});

test('PR preflight remains tolerant while preserving write safety', () => {
  const regular = readRepoFile('codeinfo_agents/pr_agent/system_prompt.txt');
  const instruction = readRepoFile('codeinfo_markdown/handle_pr_comments.md');

  for (const required of [
    'Interpret it as ordinary Markdown',
    'indented `-`, `*`, or `+` list items',
    'case-insensitively with flexible whitespace',
    'exactly one distinct in-scope PR',
    'try the repository-approved installed paths',
    'Retry one likely transient read failure once',
    'Discard a partial snapshot',
    'continue with successfully retrieved PRs',
    'provisional roots',
    'its age cannot be determined',
  ]) {
    assert.match(
      instruction,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'),
    );
  }

  assert.match(regular, /ordinary Markdown rather than an exact template/u);
  assert.match(regular, /Retry one likely transient read failure once/u);
  assert.match(regular, /Discard partial pagination/u);
  assert.match(regular, /unknown timestamps as needing inspection/u);
  assert.match(regular, /exactly one distinct in-scope destination/u);
});
