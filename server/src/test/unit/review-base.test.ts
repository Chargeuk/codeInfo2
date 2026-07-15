import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  prepareReviewBase,
  readPreparedReviewBase,
} from '../../flows/reviewBase.js';

const HEAD_SHA = 'd30c1246d30c1246d30c1246d30c1246d30c1246';
const BASE_SHA = 'a10ca1b2a10ca1b2a10ca1b2a10ca1b2a10ca1b2';
const CONTEXT_SHA = 'c'.repeat(64);
const PLAN_SHA = 'd'.repeat(64);

const prepareReviewContext = async (params: {
  repoRoot: string;
  storyNumber: string;
  planPath: string;
  branch: string;
}) => ({
  artifactPath: path.join(
    params.repoRoot,
    'codeInfoTmp',
    'reviews',
    `${params.storyNumber}-current-review-context.json`,
  ),
  artifact: {
    schema_version: 'codeinfo-review-context/v1' as const,
    story_id: params.storyNumber,
    plan_path: params.planPath,
    branch: params.branch,
    source_plan_sha256: PLAN_SHA,
    context_sha256: CONTEXT_SHA,
    sections: {
      overview: {
        source_heading: 'Overview',
        markdown: '## Overview\n\nStory.',
      },
      acceptance_criteria: {
        source_heading: 'Acceptance Criteria',
        markdown: '## Acceptance Criteria\n\n- Works.',
      },
      out_of_scope: null,
    },
    excluded_paths: ['planning/**'],
    warnings: [],
    status: 'completed' as const,
  },
});

test('prepareReviewBase writes a stable current-review-base artifact', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-base-'));
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return {
            stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
            stderr: '',
          };
        case 'fetch --prune origin':
          return { stdout: '', stderr: '' };
        case 'symbolic-ref --short refs/remotes/origin/HEAD':
          return { stdout: 'origin/main\n', stderr: '' };
        case 'rev-parse --verify origin/main':
        case 'rev-parse origin/main^{commit}':
          return { stdout: `${BASE_SHA}\n`, stderr: '' };
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    const result = await prepareReviewBase(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-review-base',
        parentExecutionId: 'execution-27',
        initializeReviewPointers: true,
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:30:00.000Z'),
        randomHex: () => 'c0ffee12',
      },
    );

    assert.equal(
      path.basename(result.artifactPath),
      '0000027-current-review-base.json',
    );
    assert.equal(result.artifact.story_id, '0000027');
    assert.equal(result.artifact.parent_execution_id, 'execution-27');
    assert.equal(
      result.artifact.review_session_id,
      '0000027-rs-20260705T163000Z-d30c1246d3-c0ffee12',
    );
    assert.equal(
      result.artifact.review_pass_id,
      '0000027-20260705T163000Z-d30c1246d3-c0ffee12',
    );
    assert.equal(result.artifact.comparison_base_ref, 'origin/main');
    assert.equal(result.artifact.comparison_base_commit, BASE_SHA);
    assert.equal(result.artifact.remote_fetch_status, 'success');
    assert.equal(
      result.artifact.review_context_file,
      'codeInfoTmp/reviews/0000027-current-review-context.json',
    );
    assert.equal(result.artifact.review_context_sha256, CONTEXT_SHA);
    assert.equal(result.artifact.review_context_source_plan_sha256, PLAN_SHA);
    assert.deepEqual(result.artifact.review_excluded_paths, ['planning/**']);

    const loaded = await readPreparedReviewBase(
      {
        workingRepositoryPath: repoRoot,
        storyNumber: '0000027',
        outputKey: 'current-review-base',
      },
      {
        execFile,
        prepareReviewContext,
      },
    );
    assert.ok(loaded);
    assert.equal(loaded?.artifact.comparison_base_ref, 'origin/main');

    const pendingMain = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000027-current-review.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const pendingCodex = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000027-current-codex-review.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const pendingOcr = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000027-current-open-code-review.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.equal(
      pendingMain.review_session_id,
      result.artifact.review_session_id,
    );
    assert.equal(pendingMain.status, 'preparing');
    assert.equal(
      pendingCodex.canonical_review_pass_id,
      result.artifact.review_pass_id,
    );
    assert.equal(pendingCodex.status, 'pending');
    for (const pointer of [pendingMain, pendingCodex, pendingOcr]) {
      assert.equal(pointer.repo_alias, result.artifact.repo_alias);
      assert.equal(pointer.repo_root, result.artifact.repo_root);
      assert.equal(pointer.branch, result.artifact.branch);
      assert.equal(
        pointer.comparison_base_commit,
        result.artifact.comparison_base_commit,
      );
      assert.equal(
        pointer.comparison_base_ref,
        result.artifact.comparison_base_ref,
      );
    }
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase resolves the git toplevel before reading flow-state files', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-base-subdir-'),
  );
  const workingSubdir = path.join(repoRoot, 'server');
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.mkdir(workingSubdir, { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return {
            stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
            stderr: '',
          };
        case 'fetch --prune origin':
          return { stdout: '', stderr: '' };
        case 'symbolic-ref --short refs/remotes/origin/HEAD':
          return { stdout: 'origin/main\n', stderr: '' };
        case 'rev-parse --verify origin/main':
        case 'rev-parse origin/main^{commit}':
          return { stdout: `${BASE_SHA}\n`, stderr: '' };
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    const result = await prepareReviewBase(
      {
        workingRepositoryPath: workingSubdir,
        outputKey: 'current-review-base',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:30:30.000Z'),
      },
    );

    assert.equal(result.artifact.repo_root, repoRoot);
    assert.equal(
      path.basename(result.artifactPath),
      '0000027-current-review-base.json',
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase uses a cached remote-tracking ref when fetch fails', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-base-cached-remote-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return {
            stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
            stderr: '',
          };
        case 'fetch --prune origin':
          throw Object.assign(new Error('network down'), {
            code: 1,
            stdout: '',
            stderr: 'fatal: network down',
          });
        case 'rev-parse --verify main':
        case 'rev-parse --verify origin/main':
        case 'rev-parse origin/main^{commit}':
          return { stdout: `${BASE_SHA}\n`, stderr: '' };
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    const result = await prepareReviewBase(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-review-base',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:31:00.000Z'),
      },
    );

    assert.equal(result.artifact.resolved_base_source, 'remote');
    assert.equal(result.artifact.remote_fetch_status, 'fetch_failed');
    assert.equal(result.artifact.local_fallback_reason, null);
    assert.equal(result.artifact.comparison_base_ref, 'origin/main');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase redacts credentials from persisted remote fetch errors', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-base-redacted-fetch-error-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return {
            stdout:
              'https://user:secret-token@github.com/Chargeuk/codeInfo2.git\n',
            stderr: '',
          };
        case 'fetch --prune origin':
          throw Object.assign(new Error('remote auth failed'), {
            code: 1,
            stdout: '',
            stderr:
              'fatal: could not read Username for https://user:secret-token@github.com/Chargeuk/codeInfo2.git',
          });
        case 'rev-parse --verify main':
        case 'rev-parse --verify origin/main':
        case 'rev-parse origin/main^{commit}':
          return { stdout: `${BASE_SHA}\n`, stderr: '' };
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    const result = await prepareReviewBase(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-review-base',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:31:30.000Z'),
      },
    );

    assert.equal(result.artifact.remote_fetch_status, 'fetch_failed');
    assert.match(
      result.artifact.remote_fetch_error ?? '',
      /https:\/\/<redacted>@github\.com\/Chargeuk\/codeInfo2\.git/u,
    );
    assert.doesNotMatch(
      result.artifact.remote_fetch_error ?? '',
      /secret-token|user:secret-token/u,
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase redacts query-string secrets from persisted remote fetch errors', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-base-redacted-query-fetch-error-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return {
            stdout: 'https://github.com/Chargeuk/codeInfo2.git\n',
            stderr: '',
          };
        case 'fetch --prune origin':
          throw Object.assign(new Error('remote token failed'), {
            code: 1,
            stdout: '',
            stderr:
              'fatal: repository https://github.com/Chargeuk/codeInfo2.git?access_token=secret-token&ref=main not found',
          });
        case 'rev-parse --verify main':
        case 'rev-parse --verify origin/main':
        case 'rev-parse origin/main^{commit}':
          return { stdout: `${BASE_SHA}\n`, stderr: '' };
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    const result = await prepareReviewBase(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-review-base',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:31:35.000Z'),
      },
    );

    assert.equal(result.artifact.remote_fetch_status, 'fetch_failed');
    assert.match(
      result.artifact.remote_fetch_error ?? '',
      /https:\/\/github\.com\/Chargeuk\/codeInfo2\.git\?<redacted>/u,
    );
    assert.doesNotMatch(
      result.artifact.remote_fetch_error ?? '',
      /secret-token|access_token=secret-token/u,
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase uses cached origin HEAD when fetch fails', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-base-cached-origin-head-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'trunk',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return {
            stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
            stderr: '',
          };
        case 'fetch --prune origin':
          throw Object.assign(new Error('network down'), {
            code: 1,
            stdout: '',
            stderr: 'fatal: network down',
          });
        case 'symbolic-ref --short refs/remotes/origin/HEAD':
          return { stdout: 'origin/trunk\n', stderr: '' };
        case 'rev-parse --verify origin/trunk':
        case 'rev-parse origin/trunk^{commit}':
          return { stdout: `${BASE_SHA}\n`, stderr: '' };
        case 'rev-parse --verify trunk':
        case 'rev-parse --verify main':
        case 'rev-parse --verify origin/main':
        case 'rev-parse --verify master':
        case 'rev-parse --verify origin/master':
        case 'rev-parse --verify develop':
        case 'rev-parse --verify origin/develop':
          throw Object.assign(new Error(`missing ref: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `fatal: Needed a single revision: ${key}`,
          });
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    const result = await prepareReviewBase(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-review-base',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:31:15.000Z'),
      },
    );

    assert.equal(result.artifact.logical_base_branch, 'trunk');
    assert.equal(result.artifact.resolved_base_branch, 'trunk');
    assert.equal(result.artifact.resolved_base_source, 'remote');
    assert.equal(result.artifact.remote_fetch_status, 'fetch_failed');
    assert.equal(result.artifact.local_fallback_reason, null);
    assert.equal(result.artifact.comparison_base_ref, 'origin/trunk');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase falls back to branched_from when origin HEAD is unavailable', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-base-branched-from-default-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'trunk',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return {
            stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
            stderr: '',
          };
        case 'fetch --prune origin':
          throw Object.assign(new Error('network down'), {
            code: 1,
            stdout: '',
            stderr: 'fatal: network down',
          });
        case 'symbolic-ref --short refs/remotes/origin/HEAD':
          throw Object.assign(new Error('missing origin head'), {
            code: 128,
            stdout: '',
            stderr: 'fatal: ref refs/remotes/origin/HEAD is not a symbolic ref',
          });
        case 'rev-parse --verify origin/trunk':
        case 'rev-parse origin/trunk^{commit}':
          return { stdout: `${BASE_SHA}\n`, stderr: '' };
        case 'rev-parse --verify trunk':
        case 'rev-parse --verify main':
        case 'rev-parse --verify origin/main':
        case 'rev-parse --verify master':
        case 'rev-parse --verify origin/master':
        case 'rev-parse --verify develop':
        case 'rev-parse --verify origin/develop':
          throw Object.assign(new Error(`missing ref: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `fatal: Needed a single revision: ${key}`,
          });
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    const result = await prepareReviewBase(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-review-base',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:31:20.000Z'),
      },
    );

    assert.equal(result.artifact.logical_base_branch, 'trunk');
    assert.equal(result.artifact.resolved_base_branch, 'trunk');
    assert.equal(result.artifact.resolved_base_source, 'remote');
    assert.equal(result.artifact.remote_fetch_status, 'fetch_failed');
    assert.equal(result.artifact.local_fallback_reason, null);
    assert.equal(result.artifact.comparison_base_ref, 'origin/trunk');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase prefers a nonstandard branched_from before generic default-branch fallbacks', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-base-nonstandard-default-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'trunk',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return {
            stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
            stderr: '',
          };
        case 'fetch --prune origin':
          throw Object.assign(new Error('network down'), {
            code: 1,
            stdout: '',
            stderr: 'fatal: network down',
          });
        case 'symbolic-ref --short refs/remotes/origin/HEAD':
          throw Object.assign(new Error('missing origin head'), {
            code: 128,
            stdout: '',
            stderr: 'fatal: ref refs/remotes/origin/HEAD is not a symbolic ref',
          });
        case 'rev-parse --verify trunk':
        case 'rev-parse --verify origin/trunk':
        case 'rev-parse origin/trunk^{commit}':
        case 'rev-parse --verify main':
        case 'rev-parse --verify origin/main':
          return { stdout: `${BASE_SHA}\n`, stderr: '' };
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    const result = await prepareReviewBase(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-review-base',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:31:25.000Z'),
      },
    );

    assert.equal(result.artifact.logical_base_branch, 'trunk');
    assert.equal(result.artifact.resolved_base_branch, 'trunk');
    assert.equal(result.artifact.comparison_base_ref, 'origin/trunk');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase still uses cached remote parent refs after fetch failure', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-base-cached-parent-'),
  );
  const parentBranch = 'feature/shared-parent';
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: parentBranch,
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return {
            stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
            stderr: '',
          };
        case 'fetch --prune origin':
          throw Object.assign(new Error('network down'), {
            code: 1,
            stdout: '',
            stderr: 'fatal: network down',
          });
        case 'rev-parse --verify origin/main':
        case `rev-parse --verify origin/${parentBranch}`:
          return { stdout: `${BASE_SHA}\n`, stderr: '' };
        case `merge-base --is-ancestor origin/${parentBranch} origin/main`:
          throw Object.assign(new Error('not merged'), {
            code: 1,
            stdout: '',
            stderr: '',
          });
        case `merge-base --is-ancestor origin/${parentBranch} HEAD`:
          return { stdout: '', stderr: '' };
        case `rev-parse origin/${parentBranch}^{commit}`:
          return { stdout: `${BASE_SHA}\n`, stderr: '' };
        case 'rev-parse --verify main':
        case `rev-parse --verify ${parentBranch}`:
          throw Object.assign(new Error(`missing local ref: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `fatal: Needed a single revision: ${key}`,
          });
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    const result = await prepareReviewBase(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-review-base',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:31:30.000Z'),
      },
    );

    assert.equal(result.artifact.logical_base_branch, parentBranch);
    assert.equal(result.artifact.resolved_base_source, 'remote');
    assert.equal(result.artifact.remote_fetch_status, 'fetch_failed');
    assert.equal(result.artifact.comparison_base_ref, `origin/${parentBranch}`);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase falls back to the default branch when HEAD no longer descends from branched_from', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-base-rebased-child-'),
  );
  const parentBranch = 'feature/shared-parent';
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: parentBranch,
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return {
            stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
            stderr: '',
          };
        case 'fetch --prune origin':
          return { stdout: '', stderr: '' };
        case 'symbolic-ref --short refs/remotes/origin/HEAD':
          return { stdout: 'origin/main\n', stderr: '' };
        case 'rev-parse --verify origin/main':
        case `rev-parse --verify origin/${parentBranch}`:
        case 'rev-parse origin/main^{commit}':
          return { stdout: `${BASE_SHA}\n`, stderr: '' };
        case `merge-base --is-ancestor origin/${parentBranch} origin/main`:
        case `merge-base --is-ancestor origin/${parentBranch} HEAD`:
          throw Object.assign(new Error('not merged'), {
            code: 1,
            stdout: '',
            stderr: '',
          });
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    const result = await prepareReviewBase(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-review-base',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:31:35.000Z'),
      },
    );

    assert.equal(result.artifact.logical_base_branch, 'main');
    assert.equal(result.artifact.resolved_base_source, 'remote');
    assert.equal(result.artifact.remote_fetch_status, 'success');
    assert.equal(result.artifact.comparison_base_ref, 'origin/main');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase does not treat a feature branched_from as the default-branch fallback when origin HEAD is unavailable', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-base-feature-fallback-'),
  );
  const parentBranch = 'feature/shared-parent';
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: parentBranch,
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return {
            stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
            stderr: '',
          };
        case 'fetch --prune origin':
          throw Object.assign(new Error('network down'), {
            code: 1,
            stdout: '',
            stderr: 'fatal: network down',
          });
        case 'symbolic-ref --short refs/remotes/origin/HEAD':
          throw Object.assign(new Error('missing origin head'), {
            code: 128,
            stdout: '',
            stderr: 'fatal: ref refs/remotes/origin/HEAD is not a symbolic ref',
          });
        case 'rev-parse --verify origin/main':
        case `rev-parse --verify origin/${parentBranch}`:
        case 'rev-parse origin/main^{commit}':
          return { stdout: `${BASE_SHA}\n`, stderr: '' };
        case `merge-base --is-ancestor origin/${parentBranch} origin/main`:
        case `merge-base --is-ancestor origin/${parentBranch} HEAD`:
          throw Object.assign(new Error('not merged'), {
            code: 1,
            stdout: '',
            stderr: '',
          });
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    const result = await prepareReviewBase(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-review-base',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:31:40.000Z'),
      },
    );

    assert.equal(result.artifact.logical_base_branch, 'main');
    assert.equal(result.artifact.remote_fetch_status, 'fetch_failed');
    assert.equal(result.artifact.comparison_base_ref, 'origin/main');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase propagates AbortSignal to git fetch and aborts promptly', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-base-abort-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );

    const controller = new AbortController();
    let fetchSignal: AbortSignal | undefined;
    const execFile = async (
      file: string,
      args: readonly string[],
      options?: { signal?: AbortSignal },
    ) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return {
            stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
            stderr: '',
          };
        case 'fetch --prune origin':
          fetchSignal = options?.signal;
          return await new Promise<{ stdout: string; stderr: string }>(
            (_resolve, reject) => {
              options?.signal?.addEventListener(
                'abort',
                () => {
                  const error = new Error('aborted');
                  error.name = 'AbortError';
                  reject(error);
                },
                { once: true },
              );
            },
          );
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    const pending = prepareReviewBase(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-review-base',
        signal: controller.signal,
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:32:00.000Z'),
      },
    );
    const deadline = Date.now() + 1000;
    while (!fetchSignal && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(fetchSignal, controller.signal);
    controller.abort();

    await assert.rejects(pending, /aborted/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase rejects non-story branches before writing artifacts', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-base-non-story-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      assert.equal(file, 'git');
      const key = args.slice(2).join(' ');
      switch (key) {
        case 'rev-parse --show-toplevel':
          return { stdout: `${repoRoot}\n`, stderr: '' };
        case 'branch --show-current':
          return { stdout: 'main\n', stderr: '' };
        default:
          throw Object.assign(new Error(`unexpected git command: ${key}`), {
            code: 128,
            stdout: '',
            stderr: `unexpected git command: ${key}`,
          });
      }
    };

    await assert.rejects(
      prepareReviewBase(
        {
          workingRepositoryPath: repoRoot,
          outputKey: 'current-review-base',
        },
        { execFile },
      ),
      /does not match plan story 0000027/u,
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
