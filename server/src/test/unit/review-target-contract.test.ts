import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { validateReviewTargetContract } from '../../flows/reviewTargetContract.js';

const execFile = promisify(execFileCb);

test('validateReviewTargetContract accepts only its exact repository, branch, HEAD, and base', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-target-contract-'),
  );
  try {
    await execFile('git', ['init', '-b', 'feature/0000064-target'], {
      cwd: root,
    });
    await execFile('git', ['config', 'user.email', 'tests@example.com'], {
      cwd: root,
    });
    await execFile('git', ['config', 'user.name', 'Tests'], { cwd: root });
    await fs.writeFile(path.join(root, 'README.md'), 'target\n');
    await execFile('git', ['add', 'README.md'], { cwd: root });
    await execFile('git', ['commit', '-m', 'initial'], { cwd: root });
    const head = (
      await execFile('git', ['rev-parse', 'HEAD'], { cwd: root })
    ).stdout.trim();
    const reviewDir = path.join(root, 'codeInfoTmp', 'reviews');
    await fs.mkdir(reviewDir, { recursive: true });
    await fs.writeFile(
      path.join(reviewDir, '0000064-current-review-base.json'),
      JSON.stringify({
        repo_root: root,
        target_id: 'target-a',
        story_id: '0000064',
        branch: 'feature/0000064-target',
        head_commit: head,
      }),
    );
    const target = {
      target_id: 'target-a',
      repo_root: root,
      branch: 'feature/0000064-target',
      head_commit: head,
      story_id: '0000064',
    };

    const valid = await validateReviewTargetContract({
      workingRepositoryPath: root,
      target,
    });
    assert.equal(valid.target.target_id, 'target-a');

    await assert.rejects(
      validateReviewTargetContract({
        workingRepositoryPath: root,
        target: { ...target, head_commit: '0'.repeat(40) },
      }),
      /drifted/u,
    );
    await assert.rejects(
      validateReviewTargetContract({
        workingRepositoryPath: root,
        target: { ...target, target_id: 'target-b' },
      }),
      /does not match bound target/u,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
