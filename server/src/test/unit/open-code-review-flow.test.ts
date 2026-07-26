import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseFlowFile } from '../../flows/flowSchema.js';

const repoRoot = path.resolve(process.cwd(), '..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('sandbox OpenCode flow uses the same generic workspace reviewer', () => {
  const raw = readRepoFile('flows-sandbox/open_code_review.json');
  const parsed = parseFlowFile(raw, { flowName: 'open_code_review' });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.deepEqual(parsed.flow.steps, [
    {
      type: 'llm',
      label: 'Run OpenCode Workspace Review',
      agentType: 'review_agent_max',
      identifier: 'ocr_reviewer',
      continueOnFailure: true,
      markdownFile: 'run_open_code_review_workspace.md',
    },
  ]);
});

test('production OpenCode flow uses only the scheduler-provided workspace', () => {
  const raw = readRepoFile('flows/open_code_review.json');
  const parsed = parseFlowFile(raw, { flowName: 'open_code_review' });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.deepEqual(parsed.flow.steps, [
    {
      type: 'llm',
      label: 'Run OpenCode Workspace Review',
      agentType: 'review_agent_max',
      identifier: 'ocr_reviewer',
      markdownFile: 'run_open_code_review_workspace.md',
    },
  ]);
});

test('OpenCode workspace prompt locks the agent-owned output contract', () => {
  const prompt = readRepoFile(
    'codeinfo_markdown/run_open_code_review_workspace.md',
  );

  for (const required of [
    'ocr agent prepare',
    "--exclude 'planning/**'",
    '--split',
    'ocr agent validate-comments',
    'ocr agent report',
    'review_job_workspace_contract.md',
    'output/',
    'Do not invoke `publish_open_code_review.py`',
    'do not write `current-open-code-review.json`',
  ]) {
    assert.match(
      prompt,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'),
    );
  }

  assert.match(prompt, /Continue past an invalid or unavailable bundle/u);
  assert.match(prompt, /self-describing review/u);
});

test('server image builds the exact Codex-enabled OCR fork and gates its commands', () => {
  const dockerfile = readRepoFile('server/Dockerfile');
  const globalPackages = readRepoFile('server/npm-global.txt');

  assert.match(
    dockerfile,
    /OPEN_CODE_REVIEW_REPOSITORY=https:\/\/github\.com\/Chargeuk\/open-code-review\.git/u,
  );
  assert.match(
    dockerfile,
    /OPEN_CODE_REVIEW_REF=codex\/fix-codex-owned-review/u,
  );
  assert.match(
    dockerfile,
    /OPEN_CODE_REVIEW_COMMIT=a93c4868a4b8b3adfb20895a1e0c3a95333b3ae9/u,
  );
  assert.match(
    dockerfile,
    /FROM golang:1\.25\.12-bookworm AS open-code-review-build/u,
  );
  assert.match(dockerfile, /ocr agent prepare --help/u);
  assert.match(dockerfile, /ocr agent context read --help/u);
  assert.match(dockerfile, /ocr agent validate-comments --help/u);
  assert.match(dockerfile, /ocr agent report --help/u);
  assert.match(dockerfile, /COPY scripts \/app\/scripts/u);
  assert.doesNotMatch(globalPackages, /@alibaba-group\/open-code-review/u);
});

test('main proof catalog supplies Terra-heavy and Sol-maximum review-only Codex agents without checked-in auth', () => {
  const heavyRoot = 'manual_testing/codeinfo_agents/review_agent_heavy';
  const maxRoot = 'manual_testing/codeinfo_agents/review_agent_max';
  const heavyConfig = readRepoFile(`${heavyRoot}/config.toml`);
  const maxConfig = readRepoFile(`${maxRoot}/config.toml`);
  const heavySystemPrompt = readRepoFile(`${heavyRoot}/system_prompt.txt`);
  const maxSystemPrompt = readRepoFile(`${maxRoot}/system_prompt.txt`);
  const manualTestingIgnore = readRepoFile('manual_testing/.gitignore');

  assert.match(heavyConfig, /codeinfo_provider = "codex"/u);
  assert.match(heavyConfig, /model = "gpt-5\.6-terra"/u);
  assert.match(heavyConfig, /model_reasoning_effort = "high"/u);
  assert.match(heavyConfig, /approval_policy = "never"/u);
  assert.match(heavyConfig, /sandbox_mode = "danger-full-access"/u);
  assert.match(maxConfig, /model = "gpt-5\.6-sol"/u);
  assert.match(maxConfig, /model_reasoning_effort = "high"/u);
  assert.match(maxConfig, /approval_policy = "never"/u);
  assert.match(maxConfig, /sandbox_mode = "danger-full-access"/u);
  assert.equal(maxSystemPrompt, heavySystemPrompt);
  assert.match(heavySystemPrompt, /Do not edit source, commit, push/u);
  assert.match(heavySystemPrompt, /do not call `code_info`/u);
  assert.match(heavySystemPrompt, /continue with the usable pinned evidence/u);
  assert.match(manualTestingIgnore, /^\*\*\/auth\.json$/mu);
});

test('source heavy and maximum review agents share the review boundary while retaining distinct model tiers', () => {
  const heavyConfig = readRepoFile(
    'codeinfo_agents/review_agent_heavy/config.toml',
  );
  const maxConfig = readRepoFile('codeinfo_agents/review_agent_max/config.toml');
  const heavySystemPrompt = readRepoFile(
    'codeinfo_agents/review_agent_heavy/system_prompt.txt',
  );
  const maxSystemPrompt = readRepoFile(
    'codeinfo_agents/review_agent_max/system_prompt.txt',
  );
  const heavyCommand = readRepoFile(
    'codeinfo_agents/review_agent_heavy/commands/code_review_findings.json',
  );
  const maxCommand = readRepoFile(
    'codeinfo_agents/review_agent_max/commands/code_review_findings.json',
  );

  assert.match(heavyConfig, /model = "gpt-5\.6-terra"/u);
  assert.match(heavyConfig, /model_reasoning_effort = "high"/u);
  assert.match(maxConfig, /model = "gpt-5\.6-sol"/u);
  assert.match(maxConfig, /model_reasoning_effort = "high"/u);
  assert.match(maxConfig, /sandbox_mode = "danger-full-access"/u);
  assert.equal(maxSystemPrompt, heavySystemPrompt);
  assert.equal(maxCommand, heavyCommand);
  assert.match(heavySystemPrompt, /pinned review evidence/u);
  assert.match(heavySystemPrompt, /do not call `code_info`/u);
  assert.match(heavySystemPrompt, /continue with the usable evidence/u);
});

test('common batch prompts preserve partial reviewer evidence', () => {
  const verify = readRepoFile('codeinfo_markdown/verify_review_batch_jobs.md');
  const reconcile = readRepoFile('codeinfo_markdown/reconcile_review_batch.md');
  const disposition = readRepoFile(
    'codeinfo_markdown/disposition_review_batch.md',
  );

  assert.match(verify, /recover or repair the output directly/u);
  assert.match(verify, /honest unavailable explanation/u);
  assert.match(reconcile, /Preserve useful sibling findings/u);
  assert.match(disposition, /reopen job evidence/u);
});
