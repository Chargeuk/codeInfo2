import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseFlowFile } from '../../flows/flowSchema.js';
import { writeReviewUsageArtifact } from '../../flows/reviewUsage.js';
import type { FlowJsonObject } from '../../flows/types.js';

const repoRoot = path.resolve(process.cwd(), '..');

const makeReviewJob = async (root: string): Promise<FlowJsonObject> => {
  const jobDir = path.join(root, 'job');
  const workDir = path.join(jobDir, 'work');
  await fs.mkdir(workDir, { recursive: true });
  return {
    review_job: {
      job_dir: jobDir,
      work_dir: workDir,
    },
  };
};

test('LLM schema accepts optional actual-review usage recording', () => {
  const parsed = parseFlowFile(
    JSON.stringify({
      steps: [
        {
          type: 'llm',
          agentType: 'review_agent',
          identifier: 'reviewer',
          recordReviewUsage: true,
          messages: [{ role: 'user', content: ['Review the repository.'] }],
        },
      ],
    }),
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.flow.steps[0]?.type, 'llm');
  assert.equal(
    parsed.flow.steps[0]?.type === 'llm'
      ? parsed.flow.steps[0].recordReviewUsage
      : undefined,
    true,
  );
});

test('actual-review usage keeps input, cached input, and output separate', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-usage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = await makeReviewJob(root);

  const result = await writeReviewUsageArtifact({
    input,
    flowName: 'open_code_review',
    stepIndex: 1,
    stepLabel: 'Run OpenCode Workspace Review',
    stepIdentifier: 'ocr_reviewer',
    invocation: 1,
    attempt: 1,
    providerId: 'codex',
    modelId: 'gpt-5.6-sol',
    status: 'ok',
    usage: {
      inputTokens: 120,
      cachedInputTokens: 80,
      outputTokens: 30,
      totalTokens: 150,
    },
  });

  assert.equal(result.status, 'written');
  if (result.status !== 'written') return;
  const content = await fs.readFile(result.artifactPath, 'utf8');
  assert.match(content, /Input tokens: 120/u);
  assert.match(content, /Cached input tokens: 80/u);
  assert.match(content, /Output tokens: 30/u);
  assert.match(content, /Provider total tokens: 150/u);
  assert.match(content, /not an additional amount to add to input tokens/u);
});

test('missing usage writes honest non-blocking evidence', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-usage-empty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await writeReviewUsageArtifact({
    input: await makeReviewJob(root),
    flowName: 'cross_repository_review',
    stepIndex: 1,
    stepIdentifier: 'cross_repository_reviewer',
    invocation: 1,
    attempt: 1,
    providerId: 'codex',
    modelId: 'gpt-5.6-terra',
    status: 'failed',
  });

  assert.equal(result.status, 'written');
  if (result.status !== 'written') return;
  const content = await fs.readFile(result.artifactPath, 'utf8');
  assert.equal(
    content.match(/Not reported/gu)?.length,
    4,
    'every unavailable category should remain explicit',
  );
});

test('review usage is skipped outside an assigned contained job', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-usage-path-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const jobDir = path.join(root, 'job');
  const outsideWork = path.join(root, 'outside-work');
  await Promise.all([
    fs.mkdir(jobDir, { recursive: true }),
    fs.mkdir(outsideWork, { recursive: true }),
  ]);

  const result = await writeReviewUsageArtifact({
    input: {
      review_job: {
        job_dir: jobDir,
        work_dir: outsideWork,
      },
    },
    flowName: 'review',
    stepIndex: 1,
    stepIdentifier: 'reviewer',
    invocation: 1,
    attempt: 1,
    providerId: 'codex',
    modelId: 'model',
    status: 'ok',
  });

  assert.deepEqual(result, {
    status: 'skipped',
    reason: 'assigned review work directory escapes its job directory',
  });
});

test('only actual-review flow steps opt into usage evidence', async () => {
  const readFlow = async (name: string) =>
    parseFlowFile(
      await fs.readFile(path.join(repoRoot, 'flows', `${name}.json`), 'utf8'),
      { flowName: name },
    );

  for (const name of ['open_code_review', 'cross_repository_review']) {
    const parsed = await readFlow(name);
    assert.equal(parsed.ok, true, name);
    if (!parsed.ok) continue;
    assert.equal(parsed.flow.steps.length, 1);
    const step = parsed.flow.steps[0];
    assert.equal(step?.type, 'llm');
    assert.equal(
      step?.type === 'llm' ? step.recordReviewUsage : undefined,
      true,
      name,
    );
  }

  const slow = await readFlow('review_artifacts_main');
  assert.equal(slow.ok, true);
  if (slow.ok) {
    const llmSteps = slow.flow.steps.filter((step) => step.type === 'llm');
    assert.equal(llmSteps.length, 6);
    assert.equal(
      llmSteps.every((step) => step.recordReviewUsage === true),
      true,
    );
  }

  const codex = await readFlow('codex_review');
  assert.equal(codex.ok, true);
  if (codex.ok) {
    const step = codex.flow.steps[0];
    assert.equal(step?.type, 'llm');
    assert.equal(
      step?.type === 'llm' ? step.recordReviewUsage : undefined,
      undefined,
    );
  }
});
