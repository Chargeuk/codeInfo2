import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { __readCurrentPlanStoryContextForTests } from '../../flows/service.js';

const planFilename =
  '0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md';

test('current plan story context reads a repository-contained plan path', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'story-context-'));
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus/flow-state'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repoRoot, 'planning'), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus/flow-state/current-plan.json'),
      JSON.stringify(
        {
          plan_path: `planning/${planFilename}`,
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      path.join(repoRoot, 'planning', planFilename),
      '# Story 0000060 - Users can automate GitHub PR review cycles with conditional, script, and wait steps\n',
      'utf8',
    );

    const context = await __readCurrentPlanStoryContextForTests({
      workingRepositoryRoot: repoRoot,
    });

    assert.deepEqual(context, {
      workingRepositoryRoot: repoRoot,
      planPath: `planning/${planFilename}`,
      storyNumber: '0000060',
      title:
        'Users can automate GitHub PR review cycles with conditional, script, and wait steps',
    });
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('current plan story context rejects a plan path that escapes the worked repository root', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'story-context-'));
  const outsideRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'story-outside-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus/flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus/flow-state/current-plan.json'),
      JSON.stringify(
        {
          plan_path: path.relative(
            repoRoot,
            path.join(outsideRoot, 'escaped-plan.md'),
          ),
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      path.join(outsideRoot, 'escaped-plan.md'),
      '# Story 9999999 - Escaped Story Title\n',
      'utf8',
    );

    const context = await __readCurrentPlanStoryContextForTests({
      workingRepositoryRoot: repoRoot,
    });

    assert.equal(context, null);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(outsideRoot, { recursive: true, force: true });
  }
});
