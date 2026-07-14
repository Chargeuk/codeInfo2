import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseFlowFile } from '../../flows/flowSchema.js';

const repoRoot = path.resolve(process.cwd(), '..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('standalone Open Code Review flow uses the Codex-backed review agent', () => {
  const raw = readRepoFile('flows-sandbox/open_code_review.json');
  const parsed = parseFlowFile(raw, { flowName: 'open_code_review' });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.deepEqual(parsed.flow.steps, [
    {
      type: 'prepareReviewBase',
      label: 'Prepare Shared Review Base And Context',
      outputKey: 'current-review-base',
      basePolicy: 'branched_from_or_default_if_merged',
    },
    {
      type: 'llm',
      label: 'Run Standalone Open Code Review',
      agentType: 'review_agent_heavy',
      identifier: 'ocr_reviewer',
      markdownFile: 'run_open_code_review.md',
    },
  ]);
});

test('production Open Code Review flow reuses the parent-prepared session', () => {
  const raw = readRepoFile('flows/open_code_review.json');
  const parsed = parseFlowFile(raw, { flowName: 'open_code_review' });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.deepEqual(parsed.flow.steps, [
    {
      type: 'validateReviewTarget',
      label: 'Validate Bound Review Target',
      targetFrom: 'target',
    },
    {
      type: 'llm',
      label: 'Run Session-Bound Open Code Review',
      agentType: 'review_agent_heavy',
      identifier: 'ocr_reviewer',
      markdownFile: 'run_open_code_review.md',
    },
  ]);
});

test('standalone Open Code Review prompt locks the host-agent safety contract', () => {
  const prompt = readRepoFile('codeinfo_markdown/run_open_code_review.md');

  for (const required of [
    'ocr agent prepare',
    "--exclude 'planning/**'",
    '--split',
    'codex-review-manifest/v1',
    'ocr agent context',
    'codex-review-comments/v1',
    'second-pass reflection',
    'ocr agent validate-comments',
    'ocr agent report',
    'codeinfo-open-code-review/v1',
    'codeinfo-review-context/v1',
    'current-review-base.json',
    'review_session_id',
    'canonical_review_pass_id',
    'current-open-code-review.json',
    'context hash',
    '/app/logs/open-code-review',
    'Publishing a partial pointer is required',
    'Do not merge findings into canonical review state.',
  ]) {
    assert.match(
      prompt,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'),
    );
  }

  assert.match(prompt, /Do not run legacy `ocr review` or `ocr scan`\./u);
  assert.match(prompt, /Do not edit source files/u);
  assert.match(prompt, /Do not commit, push, create branches/u);
  assert.match(prompt, /Do not request or use `OCR_LLM_URL`/u);
  assert.match(prompt, /write .*current-open-code-review\.json.*atomically/isu);
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
  assert.match(config, /sandbox_mode = "workspace-write"/u);
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

  assert.match(config, /sandbox_mode = "workspace-write"/u);
  assert.match(systemPrompt, /pinned review evidence/u);
  assert.match(systemPrompt, /do not call `code_info`/u);
  assert.match(systemPrompt, /continue with the usable evidence/u);
});

test('review merge and disposition prompts keep partial review evidence moving', () => {
  const codexMerge = readRepoFile(
    'codeinfo_markdown/merge_codex_review_findings_into_canonical_review.md',
  );
  const ocrMerge = readRepoFile(
    'codeinfo_markdown/merge_open_code_review_findings_into_canonical_review.md',
  );
  const classify = readRepoFile(
    'codeinfo_markdown/classify_review_disposition.md',
  );

  assert.match(codexMerge, /overall validation may be `partial`/u);
  assert.match(codexMerge, /server-owned fallback findings file/u);
  assert.match(ocrMerge, /Accept `passed` or `partial` OCR validation/u);
  assert.match(ocrMerge, /use only the bundle IDs listed as usable/u);
  assert.match(classify, /continue classifying trustworthy findings/u);
  assert.match(classify, /do not claim there were no findings/u);
});
