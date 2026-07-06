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
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return { stdout: 'git@github.com:Chargeuk/codeInfo2.git\n', stderr: '' };
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
      },
      {
        execFile,
        now: () => new Date('2026-07-05T16:30:00.000Z'),
      },
    );

    assert.equal(
      path.basename(result.artifactPath),
      '0000027-current-review-base.json',
    );
    assert.equal(result.artifact.story_id, '0000027');
    assert.equal(result.artifact.comparison_base_ref, 'origin/main');
    assert.equal(result.artifact.comparison_base_commit, BASE_SHA);
    assert.equal(result.artifact.remote_fetch_status, 'success');

    const loaded = await readPreparedReviewBase({
      workingRepositoryPath: repoRoot,
      storyNumber: '0000027',
      outputKey: 'current-review-base',
    });
    assert.ok(loaded);
    assert.equal(loaded?.artifact.comparison_base_ref, 'origin/main');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('prepareReviewBase resolves the git toplevel before reading flow-state files', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-base-subdir-'));
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
          return { stdout: 'git@github.com:Chargeuk/codeInfo2.git\n', stderr: '' };
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
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return { stdout: 'git@github.com:Chargeuk/codeInfo2.git\n', stderr: '' };
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
        now: () => new Date('2026-07-05T16:31:00.000Z'),
      },
    );

    assert.equal(result.artifact.resolved_base_source, 'remote');
    assert.equal(result.artifact.remote_fetch_status, 'success');
    assert.equal(result.artifact.local_fallback_reason, null);
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
        case 'branch --show-current':
          return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
        case 'rev-parse HEAD^{commit}':
          return { stdout: `${HEAD_SHA}\n`, stderr: '' };
        case 'remote get-url origin':
          return { stdout: 'git@github.com:Chargeuk/codeInfo2.git\n', stderr: '' };
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
