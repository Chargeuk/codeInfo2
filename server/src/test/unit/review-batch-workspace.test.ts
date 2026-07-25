import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { prepareReviewBatchWorkspace } from '../../flows/reviewBatchWorkspace.js';
import type { ReviewTargetSnapshot } from '../../flows/reviewTargets.js';
import type { SubflowWaveJob } from '../../flows/subflowWave.js';

const execFile = promisify(execFileCb);

const initializeGitRepository = async (repoRoot: string) => {
  await execFile('git', ['init', '-b', 'feature/0000064-review'], {
    cwd: repoRoot,
  });
  await execFile('git', ['config', 'user.email', 'tests@example.com'], {
    cwd: repoRoot,
  });
  await execFile('git', ['config', 'user.name', 'Tests'], { cwd: repoRoot });
  await execFile('git', ['add', '.'], { cwd: repoRoot });
  await execFile('git', ['commit', '-m', 'initial'], { cwd: repoRoot });
  const { stdout } = await execFile('git', ['rev-parse', 'HEAD^{commit}'], {
    cwd: repoRoot,
  });
  return stdout.trim();
};

test('review batch workspace observes an already-aborted preparation signal', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    prepareReviewBatchWorkspace({
      snapshot: {} as ReviewTargetSnapshot,
      jobs: [],
      signal: controller.signal,
    }),
    /aborted/u,
  );
});

test('review batch workspace gives every job immutable private input and pre-creates discoverable jobs', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-batch-workspace-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'planning'), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, 'planning', '0000064-review.md'),
      [
        '# Story',
        '',
        '## Description',
        '',
        'Review every repository.',
        '',
        '## Acceptance Criteria',
        '',
        '- Review jobs run in parallel.',
        '',
        '## Out Of Scope',
        '',
        '- Concurrent top-level flows.',
      ].join('\n'),
    );
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({ plan_path: 'planning/0000064-review.md' }),
    );
    const headCommit = await initializeGitRepository(repoRoot);
    const snapshot: ReviewTargetSnapshot = {
      schema_version: 'codeinfo-review-targets/v1',
      story_id: '0000064',
      plan_path: 'planning/0000064-review.md',
      branched_from: 'main',
      plan_host_root: repoRoot,
      review_cycle_id: '0000064-rc-example',
      review_wave_id: '0000064-rw-example',
      targets_sha256: 'a'.repeat(64),
      created_at: '2026-07-21T00:00:00.000Z',
      targets: [
        {
          target_id: 'cross-repository',
          repo_alias: 'cross-repository',
          repo_root: repoRoot,
          repository_id: 'repo-1',
          branch: 'feature/0000064-review',
          head_commit: headCommit,
          comparison_base_commit: 'c'.repeat(40),
          story_id: '0000064',
          is_primary: true,
        },
      ],
    };
    const jobs: SubflowWaveJob[] = [
      {
        instanceId: 'target_reviews:cross-repository:codex_review',
        flowName: 'codex_review',
        targetId: 'cross-repository',
        displayName: 'codex_review [cross-repository]',
        workingFolder: repoRoot,
      },
      {
        instanceId: 'target_reviews:cross-repository:open_code_review',
        flowName: 'open_code_review',
        targetId: 'cross-repository',
        displayName: 'open_code_review [cross-repository]',
        workingFolder: repoRoot,
      },
      {
        instanceId: 'story_review:cross_repository_review',
        flowName: 'cross_repository_review',
        displayName: 'cross_repository_review',
      },
    ];

    const result = await prepareReviewBatchWorkspace({ snapshot, jobs });

    assert.match(result.batchRoot, /batches/u);
    assert.doesNotMatch(result.batchRoot, /fast|slow/iu);
    assert.equal(result.jobs.length, 3);
    const codexJob = result.jobs[0]?.input?.review_job as Record<
      string,
      unknown
    >;
    const openCodeJob = result.jobs[1]?.input?.review_job as Record<
      string,
      unknown
    >;
    const crossRepositoryJob = result.jobs[2]?.input?.review_job as Record<
      string,
      unknown
    >;
    assert.notEqual(codexJob.input_dir, openCodeJob.input_dir);
    assert.match(
      String(codexJob.input_dir),
      /jobs[\\/][0-9a-f]{64}[\\/]input$/u,
    );
    assert.match(
      String(crossRepositoryJob.input_dir),
      /jobs[\\/][0-9a-f]{64}[\\/]input$/u,
    );
    assert.notEqual(codexJob.input_dir, crossRepositoryJob.input_dir);
    assert.notEqual(codexJob.output_dir, openCodeJob.output_dir);
    assert.match(
      await fs.readFile(
        path.join(String(codexJob.input_dir), 'story-context.md'),
        'utf8',
      ),
      /Review every repository/u,
    );
    assert.equal(
      (await fs.stat(String(codexJob.input_dir))).mode & 0o222,
      0,
      'private input directories are read-only',
    );
    assert.equal(
      (await fs.stat(path.join(String(codexJob.input_dir), 'story-context.md')))
        .mode & 0o222,
      0,
      'private input files are read-only',
    );
    assert.deepEqual(
      await fs.readdir(String(codexJob.output_dir)),
      [],
      'empty output remains visible because the job directory exists',
    );
    assert.match(
      await fs.readFile(result.currentBatchHandoff, 'utf8'),
      /Scheduled job directories/u,
    );
    await assert.rejects(
      fs.access(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000064-current-codex_review-review-job.md',
        ),
      ),
      /ENOENT/u,
    );
    const distinctIdentityResult = await prepareReviewBatchWorkspace({
      snapshot: { ...snapshot, review_wave_id: '0000064-rw-distinct-identities' },
      jobs: [
        {
          instanceId: 'a-b:c:d',
          flowName: 'codex_review',
          displayName: 'first collision candidate',
        },
        {
          instanceId: 'a:b-c:d',
          flowName: 'open_code_review',
          displayName: 'second collision candidate',
        },
      ],
    });
    const firstJob = distinctIdentityResult.jobs[0]?.input
      ?.review_job as Record<string, unknown>;
    const secondJob = distinctIdentityResult.jobs[1]?.input
      ?.review_job as Record<string, unknown>;
    assert.notEqual(firstJob.job_dir, secondJob.job_dir);

    const longTargetId = 'target-identity-'.repeat(32);
    const longIdentityResult = await prepareReviewBatchWorkspace({
      snapshot: {
        ...snapshot,
        review_wave_id: '0000064-rw-long-identity',
        targets: [{ ...snapshot.targets[0]!, target_id: longTargetId }],
      },
      jobs: [
        {
          instanceId: `target_reviews:${longTargetId}:codex_review`,
          flowName: 'codex_review',
          targetId: longTargetId,
          displayName: 'codex_review [long identity]',
          workingFolder: repoRoot,
        },
      ],
    });
    const longIdentityJob = longIdentityResult.jobs[0]?.input
      ?.review_job as Record<string, unknown>;
    assert.equal(
      path.basename(path.dirname(String(longIdentityJob.input_dir))).length,
      64,
    );
    assert.equal(path.basename(String(longIdentityJob.job_dir)).length, 64);

    const incompleteBatch = await prepareReviewBatchWorkspace({
      snapshot: {
        ...snapshot,
        review_wave_id: '0000064-rw-interrupted-construction',
      },
      jobs,
    });
    await fs.rm(path.join(incompleteBatch.batchRoot, 'batch-launch.md'));
    const incompletePrivateInput = path.join(
      incompleteBatch.batchRoot,
      'jobs',
      path.basename(String(codexJob.job_dir)),
      'input',
      'story-context.md',
    );
    const incompleteInput = await fs.readFile(incompletePrivateInput, 'utf8');
    const completedInterruptedBatch = await prepareReviewBatchWorkspace({
      snapshot: {
        ...snapshot,
        review_wave_id: '0000064-rw-interrupted-construction',
      },
      jobs,
    });
    assert.equal(
      completedInterruptedBatch.batchRoot,
      incompleteBatch.batchRoot,
    );
    assert.equal(
      await fs.readFile(incompletePrivateInput, 'utf8'),
      incompleteInput,
      'an interrupted batch keeps its original private input untouched',
    );
    assert.match(
      await fs.readFile(
        path.join(incompleteBatch.batchRoot, 'batch-launch.md'),
        'utf8',
      ),
      /Scheduled job directories/u,
    );

    const originalTargetInput = await fs.readFile(
      path.join(String(codexJob.input_dir), 'review-target.md'),
      'utf8',
    );
    const originalLaunchRecord = await fs.readFile(
      path.join(result.batchRoot, 'batch-launch.md'),
      'utf8',
    );
    await fs.writeFile(
      path.join(String(codexJob.output_dir), 'review.md'),
      'original reviewer output',
    );
    await fs.writeFile(
      path.join(repoRoot, 'planning', '0000064-review.md'),
      [
        '# Story',
        '',
        '## Description',
        '',
        'Changed plan after launch.',
        '',
        '## Acceptance Criteria',
        '',
        '- Review jobs run in parallel.',
        '',
        '## Out Of Scope',
        '',
        '- Concurrent top-level flows.',
      ].join('\n'),
    );
    const resumed = await prepareReviewBatchWorkspace({ snapshot, jobs });
    assert.equal(resumed.batchRoot, result.batchRoot);
    assert.equal(resumed.jobs[0]?.inputHash, result.jobs[0]?.inputHash);
    assert.equal(
      await fs.readFile(
        path.join(String(codexJob.input_dir), 'review-target.md'),
        'utf8',
      ),
      originalTargetInput,
    );
    assert.equal(
      await fs.readFile(
        path.join(String(codexJob.output_dir), 'review.md'),
        'utf8',
      ),
      'original reviewer output',
    );
    assert.equal(
      await fs.readFile(path.join(result.batchRoot, 'batch-launch.md'), 'utf8'),
      originalLaunchRecord,
    );
    const codexJobRoot = String(codexJob.job_dir);
    const escapedJobRoot = path.join(repoRoot, 'escaped-review-job');
    await fs.cp(codexJobRoot, escapedJobRoot, { recursive: true });
    await fs.rm(codexJobRoot, { recursive: true, force: true });
    await fs.symlink(escapedJobRoot, codexJobRoot, 'dir');
    await assert.rejects(
      prepareReviewBatchWorkspace({ snapshot, jobs }),
      /job directory.*outside its assigned private boundary/u,
    );
    await fs.unlink(codexJobRoot);
    await fs.rename(escapedJobRoot, codexJobRoot);

    const codexOutputDir = path.join(codexJobRoot, 'output');
    const escapedOutputDir = path.join(repoRoot, 'escaped-review-output');
    await fs.cp(codexOutputDir, escapedOutputDir, { recursive: true });
    await fs.rm(codexOutputDir, { recursive: true, force: true });
    await fs.symlink(escapedOutputDir, codexOutputDir, 'dir');
    await assert.rejects(
      prepareReviewBatchWorkspace({ snapshot, jobs }),
      /output directory.*outside its assigned private boundary/u,
    );
    await fs.unlink(codexOutputDir);
    await fs.rename(escapedOutputDir, codexOutputDir);

    const openCodeResumeJob = result.jobs[1]?.input?.review_job as Record<
      string,
      unknown
    >;
    const openCodeContextPath = path.join(
      String(openCodeResumeJob.input_dir),
      'story-context.md',
    );
    const openCodeContext = await fs.readFile(openCodeContextPath, 'utf8');
    await fs.chmod(String(openCodeResumeJob.input_dir), 0o755);
    await fs.chmod(openCodeContextPath, 0o644);
    await fs.writeFile(openCodeContextPath, 'stale private input');
    await assert.rejects(
      prepareReviewBatchWorkspace({ snapshot, jobs }),
      /does not match the pinned source/u,
    );
    await fs.writeFile(openCodeContextPath, openCodeContext);
    await fs.chmod(openCodeContextPath, 0o444);
    await fs.chmod(String(openCodeResumeJob.input_dir), 0o555);
    await fs.chmod(String(codexJob.input_dir), 0o755);
    await fs.rm(String(codexJob.input_dir), { recursive: true, force: true });
    await assert.rejects(
      prepareReviewBatchWorkspace({ snapshot, jobs }),
      /private input directory/u,
    );
    await assert.rejects(
      prepareReviewBatchWorkspace({
        snapshot: {
          ...snapshot,
          review_wave_id: '0000064-rw-head-mismatch',
          targets: [{ ...snapshot.targets[0]!, head_commit: 'a'.repeat(40) }],
        },
        jobs,
      }),
      /HEAD does not match target cross-repository/u,
    );
    await assert.rejects(
      prepareReviewBatchWorkspace({
        snapshot: {
          ...snapshot,
          review_wave_id: '0000064-rw-branch-mismatch',
          targets: [
            { ...snapshot.targets[0]!, branch: 'feature/0000064-other' },
          ],
        },
        jobs,
      }),
      /branch does not match target cross-repository/u,
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('review batch workspace rejects a target job bound to another target root', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-batch-workspace-root-mismatch-'),
  );
  const otherRoot = path.join(repoRoot, 'other-target');
  try {
    await fs.mkdir(otherRoot, { recursive: true });
    await fs.mkdir(path.join(repoRoot, 'planning'), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, 'planning', '0000064-review.md'),
      [
        '# Story',
        '',
        '## Description',
        '',
        'Review targets.',
        '',
        '## Acceptance Criteria',
        '',
        '- Review jobs remain isolated.',
        '',
        '## Out Of Scope',
        '',
        '- Concurrent top-level flows.',
      ].join('\n'),
    );
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({ plan_path: 'planning/0000064-review.md' }),
    );
    const snapshot: ReviewTargetSnapshot = {
      schema_version: 'codeinfo-review-targets/v1',
      story_id: '0000064',
      plan_path: 'planning/0000064-review.md',
      branched_from: 'main',
      plan_host_root: repoRoot,
      review_wave_id: '0000064-rw-example',
      targets_sha256: 'a'.repeat(64),
      created_at: '2026-07-21T00:00:00.000Z',
      targets: [
        {
          target_id: 'primary',
          repo_alias: 'primary',
          repo_root: repoRoot,
          repository_id: 'repo-1',
          branch: 'feature/0000064-review',
          head_commit: 'b'.repeat(40),
          comparison_base_commit: 'c'.repeat(40),
          story_id: '0000064',
          is_primary: true,
        },
      ],
    };

    await assert.rejects(
      prepareReviewBatchWorkspace({
        snapshot,
        jobs: [
          {
            instanceId: 'target_reviews:primary:codex_review',
            flowName: 'codex_review',
            targetId: 'primary',
            displayName: 'codex_review [primary]',
            workingFolder: otherRoot,
          },
        ],
      }),
      /working folder does not match target primary/u,
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
