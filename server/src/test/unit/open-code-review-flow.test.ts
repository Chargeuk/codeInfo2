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
      agentType: 'review_agent_heavy',
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
      agentType: 'review_agent_heavy',
      identifier: 'ocr_reviewer',
      continueOnFailure: true,
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

test('main proof catalog supplies the heavy review-only Codex agent without checked-in auth', () => {
  const agentRoot = 'manual_testing/codeinfo_agents/review_agent_heavy';
  const config = readRepoFile(`${agentRoot}/config.toml`);
  const systemPrompt = readRepoFile(`${agentRoot}/system_prompt.txt`);
  const manualTestingIgnore = readRepoFile('manual_testing/.gitignore');

  assert.match(config, /codeinfo_provider = "codex"/u);
  assert.match(config, /model = "gpt-5\.6-sol"/u);
  assert.match(config, /model_reasoning_effort = "high"/u);
  assert.match(config, /approval_policy = "never"/u);
  assert.match(config, /sandbox_mode = "danger-full-access"/u);
  assert.match(systemPrompt, /Do not edit source, commit, push/u);
  assert.match(systemPrompt, /do not call `code_info`/u);
  assert.match(systemPrompt, /continue with the usable pinned evidence/u);
  assert.match(manualTestingIgnore, /^\*\*\/auth\.json$/mu);
});

test('source heavy review agent yields to pinned OCR evidence', () => {
  const config = readRepoFile('codeinfo_agents/review_agent_heavy/config.toml');
  const systemPrompt = readRepoFile(
    'codeinfo_agents/review_agent_heavy/system_prompt.txt',
  );

  assert.match(config, /sandbox_mode = "danger-full-access"/u);
  assert.match(systemPrompt, /pinned review evidence/u);
  assert.match(systemPrompt, /do not call `code_info`/u);
  assert.match(systemPrompt, /continue with the usable evidence/u);
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
