import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import type {
  CopilotReviewLauncherOptions,
  CopilotReviewLauncherResult,
} from '../../copilot/reviewLauncher.js';
import {
  executeCopilotReviewStep,
  prepareCopilotReviewLaunch,
} from '../../flows/copilotReviewStep.js';
import type { FlowJsonObject } from '../../flows/types.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

const createFixture = async (params?: {
  mode?: 'native' | 'external';
  available?: boolean;
}) => {
  const repository = await fs.mkdtemp(
    path.join(os.tmpdir(), 'copilot-review-step-repository-'),
  );
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), 'copilot-review-step-workspace-'),
  );
  temporaryRoots.push(repository, workspace);
  const inputDir = path.join(workspace, 'input');
  const workDir = path.join(workspace, 'work');
  const outputDir = path.join(workspace, 'output');
  const verificationDir = path.join(workspace, 'verification');
  await Promise.all(
    [inputDir, workDir, outputDir, verificationDir].map((directory) =>
      fs.mkdir(directory, { recursive: true }),
    ),
  );

  const mode = params?.mode ?? 'external';
  const available = params?.available ?? true;
  const target = {
    target_id: 'current_repository',
    repo_alias: 'current_repository',
    repo_root: repository,
    repository_id: 'repository-id',
    branch: 'feature/0000065-review',
    head_commit: 'b'.repeat(40),
    comparison_base_commit: 'a'.repeat(40),
    story_id: '0000065',
    is_primary: true,
  };
  const spec = {
    selector:
      mode === 'external'
        ? 'openrouter::deepseek/deepseek-v4-flash'
        : 'kimi-k2.7-code',
    mode,
    modelId:
      mode === 'external' ? 'deepseek/deepseek-v4-flash' : 'kimi-k2.7-code',
    reasoningEffort: 'none',
    stableId:
      mode === 'external' ? 'external-openrouter-deepseek' : 'native-kimi',
    available,
    ...(mode === 'external' ? { endpointLabel: 'openrouter' } : {}),
    ...(mode === 'external' && available
      ? { endpointId: 'https://openrouter.ai/api/v1' }
      : {}),
    ...(!available
      ? { unavailableReason: 'Copilot authentication is required.' }
      : {}),
  };
  const reviewWave = {
    schema_version: 'codeinfo-review-targets/v1',
    story_id: '0000065',
    plan_path: 'planning/0000065-review.md',
    branched_from: 'main',
    plan_host_root: repository,
    review_wave_id: '0000065-rw-test',
    targets_sha256: 'fixture',
    targets: [target],
    created_at: '2026-07-29T00:00:00.000Z',
  };
  const input: FlowJsonObject = {
    target,
    review_wave: reviewWave,
    copilot_review_spec: spec,
    review_job: {
      batch_id: reviewWave.review_wave_id,
      instance_id: 'copilot-model:current_repository:copilot_review',
      reviewer_flow: 'copilot_review',
      target_id: target.target_id,
      input_dir: inputDir,
      job_dir: workspace,
      work_dir: workDir,
      output_dir: outputDir,
      verification_dir: verificationDir,
    },
  };
  await Promise.all([
    fs.writeFile(
      path.join(inputDir, 'copilot-review-spec.json'),
      `${JSON.stringify(spec, null, 2)}\n`,
      'utf8',
    ),
    fs.writeFile(
      path.join(inputDir, 'review-target.md'),
      '# Review target\n\nPinned target evidence.\n',
      'utf8',
    ),
    fs.writeFile(
      path.join(inputDir, 'story-context.md'),
      '# Story context\n\nPinned acceptance criteria.\n',
      'utf8',
    ),
  ]);
  return { input, repository, workspace, workDir, outputDir };
};

test('native Copilot step derives every launcher input from the persisted child payload', async () => {
  const fixture = await createFixture();

  const options = await prepareCopilotReviewLaunch(fixture.input);

  assert.deepEqual(options, {
    repositoryPath: fixture.repository,
    workspacePath: fixture.workspace,
    targetId: 'current_repository',
    reviewWaveId: '0000065-rw-test',
    jobInstanceId: 'copilot-model:current_repository:copilot_review',
    baseCommit: 'a'.repeat(40),
    headCommit: 'b'.repeat(40),
    modelId: 'deepseek/deepseek-v4-flash',
    reasoningEffort: 'none',
    endpointLabel: 'openrouter',
    endpointId: 'https://openrouter.ai/api/v1',
  });
  const instructions = await fs.readFile(
    path.join(fixture.workDir, 'copilot-review-instructions.md'),
    'utf8',
  );
  assert.match(instructions, /immutable scheduler-owned review input/u);
  assert.match(
    instructions,
    new RegExp(`${'a'.repeat(40)}\\.\\.\\.${'b'.repeat(40)}`, 'u'),
  );
  assert.ok(
    instructions.includes(
      `git diff ${'a'.repeat(40)}...${'b'.repeat(40)} -- . ':(exclude)planning/**'`,
    ),
  );
  assert.match(instructions, /Pinned acceptance criteria/u);
});

test('native Copilot step rejects a caller-selected workspace directory mismatch', async () => {
  const fixture = await createFixture();
  const input = structuredClone(fixture.input);
  const reviewJob = input.review_job as FlowJsonObject;
  reviewJob.work_dir = fixture.outputDir;

  await assert.rejects(
    prepareCopilotReviewLaunch(input),
    /review_job\.work_dir does not match the assigned review workspace/u,
  );
});

test('native Copilot step rejects target data that differs from the immutable wave', async () => {
  const fixture = await createFixture();
  const input = structuredClone(fixture.input);
  input.target = {
    ...(input.target as FlowJsonObject),
    head_commit: 'c'.repeat(40),
  };

  await assert.rejects(
    prepareCopilotReviewLaunch(input),
    /target does not match the immutable review-wave target/u,
  );
});

test('native Copilot step awaits one launcher call and passes the cancellation signal', async () => {
  const fixture = await createFixture();
  const controller = new AbortController();
  let captured: CopilotReviewLauncherOptions | undefined;
  let release: ((result: CopilotReviewLauncherResult) => void) | undefined;
  const terminal = new Promise<CopilotReviewLauncherResult>((resolve) => {
    release = resolve;
  });
  let settled = false;

  const execution = executeCopilotReviewStep(fixture.input, controller.signal, {
    runCopilotReview: async (options) => {
      captured = options;
      return terminal;
    },
  }).then((result) => {
    settled = true;
    return result;
  });

  while (!captured) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(settled, false);
  assert.equal(captured.signal, controller.signal);
  controller.abort();
  assert.equal(captured.signal?.aborted, true);
  const expected: CopilotReviewLauncherResult = {
    launched: true,
    exitStatus: 130,
    status: 'partial',
    startedAt: '2026-07-29T00:00:00.000Z',
    completedAt: '2026-07-29T00:00:01.000Z',
  };
  release?.(expected);
  assert.deepEqual(await execution, expected);
});

test('unavailable native model remains a service-owned terminal launch request', async () => {
  const fixture = await createFixture({
    mode: 'native',
    available: false,
  });

  const options = await prepareCopilotReviewLaunch(fixture.input);

  assert.equal(options.modelId, 'kimi-k2.7-code');
  assert.equal(options.endpointLabel, undefined);
  assert.equal(options.endpointId, undefined);
});
