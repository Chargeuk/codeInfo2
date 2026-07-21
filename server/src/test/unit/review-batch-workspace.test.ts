import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareReviewBatchWorkspace } from '../../flows/reviewBatchWorkspace.js';
import type { ReviewTargetSnapshot } from '../../flows/reviewTargets.js';
import type { SubflowWaveJob } from '../../flows/subflowWave.js';

test('review batch workspace shares agent-readable input and pre-creates discoverable jobs', async () => {
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
          target_id: 'current_repository',
          repo_alias: 'current_repository',
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
    const jobs: SubflowWaveJob[] = [
      {
        instanceId: 'target_reviews:current_repository:codex_review',
        flowName: 'codex_review',
        targetId: 'current_repository',
        displayName: 'codex_review [current_repository]',
      },
      {
        instanceId: 'target_reviews:current_repository:open_code_review',
        flowName: 'open_code_review',
        targetId: 'current_repository',
        displayName: 'open_code_review [current_repository]',
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
    assert.equal(codexJob.input_dir, openCodeJob.input_dir);
    assert.notEqual(codexJob.output_dir, openCodeJob.output_dir);
    assert.match(
      await fs.readFile(
        path.join(String(codexJob.input_dir), 'story-context.md'),
        'utf8',
      ),
      /Review every repository/u,
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
    assert.match(
      await fs.readFile(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000064-current-codex_review-review-job.md',
        ),
        'utf8',
      ),
      /Job directory/u,
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
