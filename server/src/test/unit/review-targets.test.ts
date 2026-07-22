import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { prepareReviewTargets } from '../../flows/reviewTargets.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';

const execFile = promisify(execFileCb);

const repoEntry = (id: string, root: string): RepoEntry => ({
  id,
  description: null,
  containerPath: root,
  hostPath: root,
  lastIngestAt: '2026-07-14T00:00:00.000Z',
  embeddingProvider: 'lmstudio',
  embeddingModel: 'test-model',
  embeddingDimensions: 3,
  modelId: 'test-model',
  counts: { files: 1, chunks: 1, embedded: 1 },
  lastError: null,
});

const createRepository = async (
  parent: string,
  name: string,
  branch = 'feature/0000064-parallel-review',
) => {
  const root = path.join(parent, name);
  await fs.mkdir(root, { recursive: true });
  await execFile('git', ['init', '-b', branch], { cwd: root });
  await execFile('git', ['config', 'user.email', 'tests@example.com'], {
    cwd: root,
  });
  await execFile('git', ['config', 'user.name', 'Tests'], { cwd: root });
  await fs.writeFile(path.join(root, 'README.md'), `${name}\n`);
  await execFile('git', ['add', 'README.md'], { cwd: root });
  await execFile('git', ['commit', '-m', 'initial'], { cwd: root });
  await execFile('git', ['branch', 'main'], { cwd: root });
  return root;
};

const prepareFixture = async (additionalCount: number) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-targets-'));
  const primary = await createRepository(tempRoot, 'primary');
  const additional = await Promise.all(
    Array.from({ length: additionalCount }, (_, index) =>
      createRepository(tempRoot, `additional-${index + 1}`),
    ),
  );
  await fs.mkdir(path.join(primary, 'codeInfoStatus', 'flow-state'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(primary, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    JSON.stringify({
      plan_path: 'planning/0000064-parallel-review.md',
      additional_repositories: additional.map((repoRoot) => ({
        path: repoRoot,
      })),
    }),
  );
  const repositories = [
    repoEntry('primary', primary),
    ...additional.map((root, index) =>
      repoEntry(`additional-${index + 1}`, root),
    ),
  ];
  return { tempRoot, primary, additional, repositories };
};

test('prepareReviewTargets snapshots one and three canonical repository targets', async (t) => {
  for (const additionalCount of [0, 2]) {
    await t.test(`${additionalCount + 1} target(s)`, async () => {
      const fixture = await prepareFixture(additionalCount);
      try {
        const result = await prepareReviewTargets(
          {
            workingRepositoryPath: fixture.primary,
          },
          {
            listIngestedRepositories: async () => ({
              repos: fixture.repositories,
              lockedModelId: null,
            }),
            resolveWorkingDirectory: async (workingFolder) => workingFolder,
            now: () => new Date('2026-07-14T12:00:00.000Z'),
            randomHex: () => 'a1b2c3d4',
          },
        );

        assert.equal(result.snapshot.targets.length, additionalCount + 1);
        assert.equal(
          result.snapshot.targets[0]?.repo_alias,
          'current_repository',
        );
        assert.equal(result.snapshot.story_id, '0000064');
        assert.match(result.snapshot.targets_sha256, /^[a-f0-9]{64}$/u);
        assert.equal(
          result.snapshot.targets.every(
            (target) =>
              target.branch === 'feature/0000064-parallel-review' &&
              target.head_commit.length === 40 &&
              target.comparison_base_commit?.length === 40,
          ),
          true,
        );
        assert.deepEqual(
          JSON.parse(await fs.readFile(result.versionedPath, 'utf8')),
          result.snapshot,
        );
      } finally {
        await fs.rm(fixture.tempRoot, { recursive: true, force: true });
      }
    });
  }
});

test('prepareReviewTargets rejects duplicate roots and story-mismatched branches', async () => {
  const fixture = await prepareFixture(1);
  try {
    const currentPlanPath = path.join(
      fixture.primary,
      'codeInfoStatus',
      'flow-state',
      'current-plan.json',
    );
    await fs.writeFile(
      currentPlanPath,
      JSON.stringify({
        plan_path: 'planning/0000064-parallel-review.md',
        additional_repositories: [{ path: fixture.primary }],
      }),
    );
    const dependencies = {
      listIngestedRepositories: async () => ({
        repos: fixture.repositories,
        lockedModelId: null,
      }),
      resolveWorkingDirectory: async (workingFolder: string) => workingFolder,
    };
    await assert.rejects(
      prepareReviewTargets(
        {
          workingRepositoryPath: fixture.primary,
        },
        dependencies,
      ),
      /duplicates/u,
    );

    await fs.writeFile(
      currentPlanPath,
      JSON.stringify({
        plan_path: 'planning/0000065-parallel-review.md',
        additional_repositories: [],
      }),
    );
    await assert.rejects(
      prepareReviewTargets(
        {
          workingRepositoryPath: fixture.primary,
        },
        dependencies,
      ),
      /does not match plan story 0000065/u,
    );
  } finally {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('a saved target snapshot remains pinned when a repository HEAD later moves', async () => {
  const fixture = await prepareFixture(1);
  try {
    const result = await prepareReviewTargets(
      {
        workingRepositoryPath: fixture.primary,
      },
      {
        listIngestedRepositories: async () => ({
          repos: fixture.repositories,
          lockedModelId: null,
        }),
        resolveWorkingDirectory: async (workingFolder) => workingFolder,
      },
    );
    const pinnedHead = result.snapshot.targets[1]?.head_commit;
    const additionalRoot = fixture.additional[0] as string;
    await fs.writeFile(path.join(additionalRoot, 'next.txt'), 'next\n');
    await execFile('git', ['add', 'next.txt'], { cwd: additionalRoot });
    await execFile('git', ['commit', '-m', 'next'], { cwd: additionalRoot });
    const movedHead = (
      await execFile('git', ['rev-parse', 'HEAD'], { cwd: additionalRoot })
    ).stdout.trim();
    const persisted = JSON.parse(
      await fs.readFile(result.versionedPath, 'utf8'),
    ) as typeof result.snapshot;

    assert.notEqual(movedHead, pinnedHead);
    assert.equal(persisted.targets[1]?.head_commit, pinnedHead);
    assert.equal(persisted.targets_sha256, result.snapshot.targets_sha256);
  } finally {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('additional targets use only their repository-local comparison-base hints', async () => {
  const fixture = await prepareFixture(1);
  try {
    const additionalRoot = fixture.additional[0] as string;
    await fs.writeFile(path.join(additionalRoot, 'next.txt'), 'next\n');
    await execFile('git', ['add', 'next.txt'], { cwd: additionalRoot });
    await execFile('git', ['commit', '-m', 'next'], { cwd: additionalRoot });
    await execFile('git', ['branch', 'host-only'], { cwd: additionalRoot });
    await fs.writeFile(
      path.join(fixture.primary, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000064-parallel-review.md',
        branched_from: 'host-only',
        additional_repositories: [{ path: additionalRoot }],
      }),
    );

    const result = await prepareReviewTargets(
      { workingRepositoryPath: fixture.primary },
      {
        listIngestedRepositories: async () => ({
          repos: fixture.repositories,
          lockedModelId: null,
        }),
        resolveWorkingDirectory: async (workingFolder) => workingFolder,
      },
    );
    const additionalBase = (
      await execFile('git', ['rev-parse', 'main'], { cwd: additionalRoot })
    ).stdout.trim();

    assert.equal(
      result.snapshot.targets[1]?.comparison_base_commit,
      additionalBase,
    );
  } finally {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('diagnostic target preparation does not adopt an active final review cycle', async () => {
  const fixture = await prepareFixture(0);
  try {
    await fs.writeFile(
      path.join(
        fixture.primary,
        'codeInfoStatus',
        'flow-state',
        'active-review-cycle.json',
      ),
      JSON.stringify({
        review_cycle_id: '0000064-rc-final',
        review_mode: 'final',
        story_id: '0000064',
        plan_path: 'planning/0000064-parallel-review.md',
        status: 'in_progress',
      }),
    );
    const result = await prepareReviewTargets(
      { workingRepositoryPath: fixture.primary, reviewMode: 'diagnostic' },
      {
        listIngestedRepositories: async () => ({
          repos: fixture.repositories,
          lockedModelId: null,
        }),
        resolveWorkingDirectory: async (workingFolder) => workingFolder,
      },
    );

    assert.equal(result.snapshot.review_cycle_id, undefined);
    assert.equal(result.snapshot.review_mode, undefined);
  } finally {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});
